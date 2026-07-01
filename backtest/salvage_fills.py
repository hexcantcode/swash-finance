#!/usr/bin/env python3
"""
One-shot fill/funding/ledger salvage for a PRELIMINARY backtest.

HL fill retention is shallow + uneven (hours for hyper-bots, ~10 months for calm
wallets — see the master plan Part VIII), so this pulls whatever history each
roster wallet still has. Enough for a rough, caveated signal sanity-check while
the forward-capture (collect_snapshots.py) accrues the real dataset.

Forward-pages `userFillsByTime` from startTime=0 (oldest-first, 2000/page) until
caught up. Also pulls userFunding + userNonFundingLedgerUpdates. NDJSON out.
Stdlib only. Idempotent-ish: overwrites per-wallet files each run.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import datetime
from concurrent.futures import ThreadPoolExecutor

HL_INFO = "https://api.hyperliquid.xyz/info"
HD_GQL = "https://api.hyperdash.com/graphql"
HD_HEADERS = {"content-type": "application/json", "origin": "https://hyperdash.com",
              "referer": "https://hyperdash.com/", "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/124 Safari/537.36"}
ROSTER_SIZE = 80
MAX_PAGES = 200          # safety cap: 200 × 2000 = 400k fills/wallet
WORKERS = 2              # low concurrency — HL IP rate limit is 1200 weight/min
PAGE_SLEEP = 0.25        # pacing between pages
OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "salvage")


def _post(url, payload, headers=None, retries=6):
    """POST with exponential backoff on HTTP 429 (HL rate limit)."""
    body = json.dumps(payload).encode()
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers=headers or {"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(min(2 ** attempt, 20))  # 1,2,4,8,16,20s
                continue
            raise


def fetch_roster():
    """Prefer the latest roster captured by collect_snapshots.py (avoids a flaky
    Hyperdash round-trip); fall back to Hyperdash only if no snapshot exists yet."""
    roster_dir = os.path.join(os.path.dirname(__file__), "data", "roster")
    files = sorted(f for f in os.listdir(roster_dir) if f.endswith(".ndjson")) if os.path.isdir(roster_dir) else []
    if files:
        addrs, latest_ts = [], None
        with open(os.path.join(roster_dir, files[-1])) as f:
            rows = [json.loads(line) for line in f if line.strip()]
        if rows:
            latest_ts = max(r["ts"] for r in rows)
            addrs = [r["address"] for r in rows if r["ts"] == latest_ts]
        if addrs:
            print(f"roster from snapshot {files[-1]} (ts={latest_ts}): {len(addrs)} wallets")
            return addrs
    # Fallback: Hyperdash exploreTraders.
    q = ("query E($t:TraderTimeframe!,$s:TraderSortInput,$p:Int){exploreTraders(page:1,pageSize:$p,"
         "timeframe:$t,sortBy:$s){data{address}}}")
    d = _post(HD_GQL, {"operationName": "E", "query": q,
                       "variables": {"t": "all", "s": {"field": "pnl", "order": "desc"}, "p": ROSTER_SIZE}}, HD_HEADERS)
    data = (d or {}).get("data") or {}
    rows = ((data.get("exploreTraders") or {}).get("data")) or []
    if not rows:
        raise RuntimeError(f"could not load roster (Hyperdash returned {d})")
    return [t["address"] for t in rows]


def page_by_time(kind, wallet):
    """Forward-page a time-windowed endpoint (userFillsByTime) from 0."""
    out, start, pages = [], 0, 0
    while pages < MAX_PAGES:
        try:
            batch = _post(HL_INFO, {"type": kind, "user": wallet, "startTime": start})
        except Exception as e:  # noqa: BLE001
            print(f"  ! {wallet[:10]} {kind}: {e}", file=sys.stderr)
            break
        if not batch:
            break
        out.extend(batch)
        pages += 1
        mx = max(f["time"] for f in batch)
        if len(batch) < 2000:
            break
        nxt = mx + 1
        if nxt <= start:
            break
        start = nxt
        time.sleep(PAGE_SLEEP)
    return out


def salvage_wallet(wallet):
    fills = page_by_time("userFillsByTime", wallet)
    # funding + ledger accept startTime/endTime; one wide pull is usually enough.
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    try:
        funding = _post(HL_INFO, {"type": "userFunding", "user": wallet, "startTime": 0, "endTime": now})
    except Exception:
        funding = []
    try:
        ledger = _post(HL_INFO, {"type": "userNonFundingLedgerUpdates", "user": wallet, "startTime": 0, "endTime": now})
    except Exception:
        ledger = []

    for name, rows in (("fills", fills), ("funding", funding), ("ledger", ledger)):
        with open(os.path.join(OUT_DIR, f"{wallet}.{name}.ndjson"), "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")

    span = "—"
    if fills:
        t = [f["time"] for f in fills]
        span = f"{round((max(t) - min(t)) / 86400000, 1)}d ({datetime.datetime.fromtimestamp(min(t)/1000, datetime.timezone.utc).date()}→)"
    return wallet, len(fills), len(funding), len(ledger), span


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    roster = fetch_roster()
    print(f"salvaging {len(roster)} wallets → {os.path.relpath(OUT_DIR)}  (max {MAX_PAGES} pages/wallet)")
    tot_f = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for w, nf, nfund, nl, span in ex.map(salvage_wallet, roster):
            tot_f += nf
            print(f"  {w[:10]}  fills={nf:>6}  funding={nfund:>5}  ledger={nl:>4}  history={span}")
    print(f"done. total fills salvaged: {tot_f}")


if __name__ == "__main__":
    main()
