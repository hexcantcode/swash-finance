#!/usr/bin/env python3
"""
Forward-test engine — computes the Conviction Vault signal on the accruing
snapshots in Postgres (the cloud store) and appends it to a `signal_track` table.

For BTC and xyz:SP500, at each captured snapshot it computes the SWNP signal
`s = Σ q·c·d / Σ q·c` (quality × conviction × direction) with the breadth gate +
deadzone, and upserts (ts, coin, s, …) to `signal_track`. Run it anytime (or on a
schedule / as a Railway job) — each run catches up new snapshots, building a genuine
out-of-sample paper track. No look-ahead, no survivorship.

`q` is a PLACEHOLDER (Hyperdash copyScore, normalized) until the vault-grade score
(master plan Part II) exists — swapping it is one query.

Env: PGURL (or DATABASE_URL) = the Postgres connection string
     (Railway → Postgres service → DATABASE_PUBLIC_URL for local runs).
Run: backtest/.venv/bin/python backtest/forward_test.py
"""

import os
import sys
import urllib.parse
import pg8000.dbapi

UNIVERSE_N = 20        # compute the signal for the top-N assets by EP-cohort volume
                       # (the showcase page displays the top-12; extra headroom for rank shifts)
LEV_CAP = 3.0
CONV_POWER = 1.5       # emphasize conviction (weight = q · conviction^CONV_POWER).
                       # >1 makes high-conviction (big fraction of own book) dominate;
                       # raw notional size never enters. Calibrate in Part VII.
BREADTH_MIN = 3        # relaxed for the thin early sample (calibrate later)
S_ON, S_OFF = 0.12, 0.08

PGURL = os.environ.get("PGURL") or os.environ.get("DATABASE_URL")
if not PGURL:
    sys.exit("Set PGURL to the Postgres connection string (Railway Postgres → DATABASE_PUBLIC_URL).")


def connect():
    u = urllib.parse.urlparse(PGURL)
    return pg8000.dbapi.connect(user=u.username, password=u.password, host=u.hostname,
                                port=u.port or 5432, database=u.path.lstrip("/"))


def main():
    conn = connect()
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS signal_track (
        ts BIGINT, coin TEXT, s DOUBLE PRECISION, contributors INT, weight DOUBLE PRECISION,
        actionable TEXT, PRIMARY KEY (ts, coin))""")

    # Quality: vault-grade q (quality table) where it exists, else copyScore fallback.
    # As snapshots accrue and quality_score.py scores wallets, the signal auto-upgrades
    # from copyScore-weighted to vault-grade-q-weighted with no code change.
    q = {}
    try:
        cur.execute("SELECT wallet, q FROM quality WHERE q IS NOT NULL")
        q = {w: float(qq) for w, qq in cur.fetchall()}
    except Exception:
        conn.rollback()  # quality table not created yet
    n_vault_grade = len(q)
    cur.execute("SELECT address, copy_score FROM roster WHERE ts=(SELECT max(ts) FROM roster)")
    for a, s in cur.fetchall():
        if a not in q and s is not None:
            q[a] = s / 100.0
    print(f"quality: {n_vault_grade} vault-grade q + {len(q) - n_vault_grade} copyScore fallback")

    # Universe = top-N coins by EP-cohort volume in the latest snapshot.
    cur.execute("""WITH latest AS (SELECT max(ts) t FROM positions)
                   SELECT coin FROM positions, latest
                   WHERE ts = latest.t AND szi <> 0
                   GROUP BY coin ORDER BY sum(position_value) DESC LIMIT %s""", (UNIVERSE_N,))
    universe = [r[0] for r in cur.fetchall()]
    placeholders = ",".join(["%s"] * len(universe))
    cur.execute(f"""SELECT ts, wallet, coin, szi, position_value, account_value
                    FROM positions
                    WHERE coin IN ({placeholders}) AND szi <> 0 AND account_value > 0""", universe)
    agg = {}  # (ts, coin) -> [signed_w, w, n]
    for ts, wallet, coin, szi, notional, equity in cur.fetchall():
        if not notional or not equity:
            continue
        qi = q.get(wallet, 0.0)
        if qi <= 0:
            continue
        conv = min(notional / equity, LEV_CAP) ** CONV_POWER
        d = 1.0 if szi > 0 else -1.0
        w = qi * conv
        a = agg.setdefault((ts, coin), [0.0, 0.0, 0])
        a[0] += d * w
        a[1] += w
        a[2] += 1

    rows = []
    for (ts, coin), (sw, w, n) in sorted(agg.items()):
        s = sw / w if w > 0 else 0.0
        act = "FLAT" if (n < BREADTH_MIN or abs(s) < S_OFF) else ("LONG" if s > 0 else "SHORT")
        rows.append((ts, coin, round(s, 4), n, round(w, 3), act))

    for r in rows:
        cur.execute("""INSERT INTO signal_track VALUES (%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (ts, coin) DO UPDATE SET
                         s=EXCLUDED.s, contributors=EXCLUDED.contributors,
                         weight=EXCLUDED.weight, actionable=EXCLUDED.actionable""", r)
    conn.commit()

    print(f"{len(rows)} signal points upserted")
    print(f"{'ts':>16} {'coin':>10} {'s':>8} {'contrib':>8} {'actionable':>11}")
    for ts, coin, s, n, w, act in rows[-12:]:
        print(f"{ts:>16} {coin:>10} {s:>8.3f} {n:>8} {act:>11}")
    cur.execute("SELECT count(distinct ts), min(ts), max(ts) FROM signal_track")
    ns, t0, t1 = cur.fetchone()
    print(f"\nsignal_track now spans {ns} snapshot(s). Strengthens with every new snapshot.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
