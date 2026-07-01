#!/usr/bin/env python3
"""
Forward-capture snapshotter for the Conviction Vault backtest.

Every run takes ONE point-in-time snapshot of the EP roster's positions + equity
(via Hyperliquid `clearinghouseState`, main + HIP-3 `xyz` dex) and appends it to
a dated NDJSON file. Run on a schedule (e.g. every 30 min) so the clean,
gap-free, no-look-ahead dataset accrues — HL fill retention is too shallow/uneven
to excavate history, so we build it forward. See
docs/plans/2026-07-01-conviction-vault-master-plan.md Part VIII.

Stdlib only (no deps) so it can run anywhere. NDJSON → Parquet + reconstruction
happens later in DuckDB. Append-only + crash-safe by construction.
"""

import json
import os
import sys
import glob
import time
import urllib.request
import urllib.parse
import datetime
from concurrent.futures import ThreadPoolExecutor


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_pg(ts, positions, equity, roster):
    """Additive: also write the snapshot to Postgres (DATABASE_URL) so the data is
    durable AND readable from anywhere. Never crashes the loop — the volume files
    remain the fallback."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        return
    try:
        import pg8000.dbapi
    except ImportError:
        print("  ! pg8000 not installed; skipping PG write", file=sys.stderr)
        return
    try:
        u = urllib.parse.urlparse(url)
        conn = pg8000.dbapi.connect(user=u.username, password=u.password, host=u.hostname,
                                    port=u.port or 5432, database=u.path.lstrip("/"))
        cur = conn.cursor()
        cur.execute("""CREATE TABLE IF NOT EXISTS positions (ts BIGINT, wallet TEXT, dex TEXT, coin TEXT,
            szi DOUBLE PRECISION, entry_px DOUBLE PRECISION, position_value DOUBLE PRECISION,
            unrealized_pnl DOUBLE PRECISION, leverage_type TEXT, leverage_value DOUBLE PRECISION,
            account_value DOUBLE PRECISION)""")
        cur.execute("""CREATE TABLE IF NOT EXISTS equity (ts BIGINT, wallet TEXT, dex TEXT,
            account_value DOUBLE PRECISION, total_ntl_pos DOUBLE PRECISION)""")
        cur.execute("""CREATE TABLE IF NOT EXISTS roster (ts BIGINT, address TEXT, display_name TEXT,
            copy_score DOUBLE PRECISION, pnl DOUBLE PRECISION, pnl_cohort TEXT)""")
        cur.executemany("INSERT INTO positions VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [(r["ts"], r["wallet"], r["dex"], r["coin"], _f(r["szi"]), _f(r["entryPx"]),
              _f(r["positionValue"]), _f(r["unrealizedPnl"]), r["leverageType"], _f(r["leverageValue"]),
              _f(r["accountValue"])) for r in positions])
        cur.executemany("INSERT INTO equity VALUES (%s,%s,%s,%s,%s)",
            [(r["ts"], r["wallet"], r["dex"], _f(r["accountValue"]), _f(r["totalNtlPos"])) for r in equity])
        cur.executemany("INSERT INTO roster VALUES (%s,%s,%s,%s,%s,%s)",
            [(ts, r["address"], r.get("displayName"), _f(r.get("copyScore")), _f(r.get("pnl")),
              r.get("pnlCohort")) for r in roster])
        conn.commit()
        cur.close()
        conn.close()
        print(f"  → Postgres +{len(positions)} positions +{len(equity)} equity +{len(roster)} roster")
    except Exception as e:  # noqa: BLE001
        print(f"  ! PG write failed: {e}", file=sys.stderr)

HL_INFO = "https://api.hyperliquid.xyz/info"
HD_GQL = "https://api.hyperdash.com/graphql"
HD_HEADERS = {
    "content-type": "application/json",
    "origin": "https://hyperdash.com",
    "referer": "https://hyperdash.com/",
    "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/124 Safari/537.36",
}
# Dexes to snapshot. None = main perps; "xyz" = the HIP-3 synthetics (SP500/GOLD/…)
# that dominate the EP cohort's volume. Extend if the roster uses more builder dexes.
DEXES = [None, "xyz"]
ROSTER_SIZE = 80
# Storage root — override with VAULT_DATA_ROOT so the same code writes to a Railway
# volume (e.g. /data) in the cloud, or a local dir in dev. Mac-independent.
DATA_ROOT = os.environ.get("VAULT_DATA_ROOT", os.path.join(os.path.dirname(__file__), "data"))
OUT_DIR = os.path.join(DATA_ROOT, "snapshots")
ROSTER_DIR = os.path.join(DATA_ROOT, "roster")


def _post(url, payload, headers=None):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers=headers or {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_roster():
    """EP cohort = Hyperdash exploreTraders. Resilient for the cloud runner, where
    Hyperdash may block the datacenter IP: live → latest captured file → baked seed."""
    q = ("query E($t:TraderTimeframe!,$s:TraderSortInput,$p:Int){"
         "exploreTraders(page:1,pageSize:$p,timeframe:$t,sortBy:$s){"
         "data{address displayName copyScore pnl pnlCohort}}}")
    try:
        d = _post(HD_GQL, {"operationName": "E", "query": q,
                           "variables": {"t": "all", "s": {"field": "pnl", "order": "desc"}, "p": ROSTER_SIZE}},
                  HD_HEADERS)
        rows = (((d or {}).get("data") or {}).get("exploreTraders") or {}).get("data") or []
        if rows:
            return rows
        raise RuntimeError(f"Hyperdash returned no roster ({d})")
    except Exception as e:  # noqa: BLE001
        print(f"  ! live roster fetch failed ({e}); falling back", file=sys.stderr)
    # Fallback 1: latest roster we captured (on the volume).
    files = sorted(glob.glob(os.path.join(ROSTER_DIR, "*.ndjson"))) if os.path.isdir(ROSTER_DIR) else []
    if files:
        with open(files[-1]) as f:
            rows = [json.loads(l) for l in f if l.strip()]
        if rows:
            latest = max(r["ts"] for r in rows)
            return [{k: v for k, v in r.items() if k != "ts"} for r in rows if r["ts"] == latest]
    # Fallback 2: baked seed shipped in the image.
    seed = os.path.join(os.path.dirname(__file__), "roster_seed.json")
    if os.path.exists(seed):
        return json.load(open(seed))["roster"]
    raise RuntimeError("no roster available (live + volume file + baked seed all failed)")


def fetch_state(wallet, dex):
    req = {"type": "clearinghouseState", "user": wallet}
    if dex:
        req["dex"] = dex
    return _post(HL_INFO, req)


def snapshot_wallet(wallet, ts):
    """Return (position_rows, equity_rows) for one wallet across all dexes."""
    prows, erows = [], []
    for dex in DEXES:
        dex_name = dex or "main"
        try:
            st = fetch_state(wallet, dex)
        except Exception as e:  # noqa: BLE001 — non-critical; skip this dex this tick
            print(f"  ! {wallet[:10]} dex={dex_name}: {e}", file=sys.stderr)
            continue
        ms = st.get("marginSummary", {}) or {}
        acct = ms.get("accountValue")
        erows.append({"ts": ts, "wallet": wallet, "dex": dex_name,
                      "accountValue": acct, "totalNtlPos": ms.get("totalNtlPos")})
        for ap in st.get("assetPositions", []) or []:
            p = ap.get("position", {}) or {}
            lev = p.get("leverage", {}) or {}
            prows.append({
                "ts": ts, "wallet": wallet, "dex": dex_name,
                "coin": p.get("coin"),
                "szi": p.get("szi"),                      # signed size (+long/−short)
                "entryPx": p.get("entryPx"),
                "positionValue": p.get("positionValue"),  # notional (unsigned)
                "unrealizedPnl": p.get("unrealizedPnl"),
                "leverageType": lev.get("type"),
                "leverageValue": lev.get("value"),
                "accountValue": acct,                     # this dex's equity (for conviction)
            })
    return prows, erows


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(ROSTER_DIR, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    ts = int(now.timestamp() * 1000)
    day = now.strftime("%Y-%m-%d")

    roster = fetch_roster()
    wallets = [t["address"] for t in roster]
    print(f"[{now.isoformat()}] snapshot ts={ts} roster={len(wallets)} dexes={[d or 'main' for d in DEXES]}")

    # Record roster membership + metadata for this tick (survivorship-aware).
    with open(os.path.join(ROSTER_DIR, f"{day}.ndjson"), "a") as f:
        for t in roster:
            f.write(json.dumps({"ts": ts, **t}) + "\n")

    # Snapshot all wallets (modest concurrency; 80 × 2 dexes = 160 calls/tick).
    all_p, all_e = [], []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for prows, erows in ex.map(lambda w: snapshot_wallet(w, ts), wallets):
            all_p.extend(prows)
            all_e.extend(erows)

    pos_path = os.path.join(OUT_DIR, f"{day}.positions.ndjson")
    eq_path = os.path.join(OUT_DIR, f"{day}.equity.ndjson")
    with open(pos_path, "a") as f:
        for r in all_p:
            f.write(json.dumps(r) + "\n")
    with open(eq_path, "a") as f:
        for r in all_e:
            f.write(json.dumps(r) + "\n")

    print(f"  wrote {len(all_p)} positions, {len(all_e)} equity rows → {os.path.relpath(OUT_DIR)}/{day}.*")
    to_pg(ts, all_p, all_e, roster)


if __name__ == "__main__":
    main()
