#!/usr/bin/env python3
"""
Forward-test engine — computes the Conviction Vault signal on the accruing
snapshots in Postgres (the cloud store) and appends it to a `signal_track` table.

For BTC and xyz:SP500, at each captured snapshot it computes the SWNP signal
`s = Σ q·c·d / Σ q·c` (quality × conviction × direction) with the breadth gate +
deadzone, and appends (ts, coin, s, …) to `signal_track` for snapshots newer than the
last one already computed. **Append-only: existing rows are never rewritten** — the
signal recorded at time t stays the one computed with the roster/quality known at t,
which is what a live keeper would have traded. (History before 2026-07-08 predates this
rule and was recomputed on each run; treat it as contaminated.) Run it anytime (or on a
schedule / as a Railway job) — each run catches up new snapshots, building a genuine
out-of-sample paper track. No look-ahead, no survivorship.

`q` is a shrinkage blend of the vault-grade DSR (quality_score.py) and the roster
copyScore prior, weighted by observation depth — trust migrates from prior to
measured skill as history accrues. Plain-language walkthrough of the whole
formula: docs/vault-signal-explained.md.

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
QUALITY_POWER = 2.0    # score is PRIMARY: q^2 stretches the quality spread so each
                       # head counts by how good the trader is (0.5→0.25 vs 1.0→1.0).
CONV_POWER = 0.5       # conviction is SECONDARY: sqrt dampens size-of-own-book so a
                       # 3x-book whale gets 1.73x, not dominance — many good traders
                       # agreeing outvotes one big position. (Was 1.5, which let size
                       # dominate; recalibrated 2026-07-03.) Raw notional never enters.
N0 = 180.0             # shrinkage horizon (obs): q_eff = λ·DSR + (1−λ)·prior with
                       # λ = n_obs/(n_obs+N0). Thin history → copyScore prior; the
                       # vault-grade DSR takes over as evidence accrues. Without this,
                       # squaring a degenerate (median-0) DSR hands one wallet ~90% of
                       # the vote (see docs/vault-signal-explained.md).
BREADTH_MIN = 3        # minimum EFFECTIVE voices: n_eff = (Σw)²/Σw² ≥ 3, not raw
                       # head-count — 17 heads with one 92% voice is a 1.2-voice vault.
M_EP, M_VP = 1.0, 0.25  # cohort voice multiplier (80/20 intent): an Extremely
                       # Profitable credential speaks at full volume, Very Profitable
                       # at a quarter — individual skill (q_eff²) still sets the level
                       # within the tier. Wallets off the latest roster default to VP.
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
    # Append-only: only compute snapshots newer than the last recorded one.
    cur.execute("SELECT coalesce(max(ts), 0) FROM signal_track")
    last_ts = cur.fetchone()[0]

    # Quality: shrinkage blend — q_eff = λ·DSR + (1−λ)·prior, λ = n_obs/(n_obs+N0).
    # prior = roster copyScore/100; DSR = vault-grade q from quality_score.py. Trust
    # migrates from prior to measured skill as observations accrue, with no cliff.
    dsr, nobs = {}, {}
    try:
        cur.execute("SELECT wallet, q, n_obs FROM quality WHERE q IS NOT NULL")
        for w, qq, n in cur.fetchall():
            dsr[w] = float(qq)
            nobs[w] = int(n or 0)
    except Exception:
        conn.rollback()  # quality table not created yet
    cur.execute("SELECT address, copy_score, pnl_cohort FROM roster WHERE ts=(SELECT max(ts) FROM roster)")
    q, mult = {}, {}
    for a, s, cohort in cur.fetchall():
        prior = (s or 0.0) / 100.0
        lam = nobs.get(a, 0) / (nobs.get(a, 0) + N0)
        q[a] = lam * dsr.get(a, 0.0) + (1 - lam) * prior
        mult[a] = M_EP if cohort == "Extremely Profitable" else M_VP
    # Scored wallets that fell off the latest roster still vote on their DSR alone.
    for a in dsr:
        if a not in q:
            lam = nobs[a] / (nobs[a] + N0)
            q[a] = lam * dsr[a]
    print(f"quality: {len(dsr)} vault-grade DSR blended into {len(q)} q_eff (N0={N0:.0f})")

    # Universe = top-N coins by EP-cohort volume in the latest snapshot.
    cur.execute("""WITH latest AS (SELECT max(ts) t FROM positions)
                   SELECT coin FROM positions, latest
                   WHERE ts = latest.t AND szi <> 0
                   GROUP BY coin ORDER BY sum(position_value) DESC LIMIT %s""", (UNIVERSE_N,))
    universe = [r[0] for r in cur.fetchall()]
    placeholders = ",".join(["%s"] * len(universe))
    cur.execute(f"""SELECT ts, wallet, coin, szi, position_value, account_value
                    FROM positions
                    WHERE coin IN ({placeholders}) AND szi <> 0 AND account_value > 0
                      AND ts > %s""", (*universe, last_ts))
    agg = {}  # (ts, coin) -> [signed_w, w, n]
    for ts, wallet, coin, szi, notional, equity in cur.fetchall():
        if not notional or not equity:
            continue
        qi = q.get(wallet, 0.0)
        if qi <= 0:
            continue
        conv = min(notional / equity, LEV_CAP) ** CONV_POWER
        d = 1.0 if szi > 0 else -1.0
        w = mult.get(wallet, M_VP) * (qi ** QUALITY_POWER) * conv
        a = agg.setdefault((ts, coin), [0.0, 0.0, 0, 0.0])
        a[0] += d * w
        a[1] += w
        a[2] += 1
        a[3] += w * w

    rows = []
    for (ts, coin), (sw, w, n, w2) in sorted(agg.items()):
        s = sw / w if w > 0 else 0.0
        n_eff = (w * w) / w2 if w2 > 0 else 0.0
        act = "FLAT" if (n_eff < BREADTH_MIN or abs(s) < S_OFF) else ("LONG" if s > 0 else "SHORT")
        rows.append((ts, coin, round(s, 4), n, round(w, 3), act))

    for r in rows:
        cur.execute("""INSERT INTO signal_track VALUES (%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (ts, coin) DO NOTHING""", r)
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
