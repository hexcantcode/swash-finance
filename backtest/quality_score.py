#!/usr/bin/env python3
"""
Vault-grade quality score `q` — the gating build (master plan Part II).

Measures *risk-adjusted* skill per trader from a return series, not raw PnL.
Core pipeline implemented here:
  1. risk-adjusted   — Sharpe, Sortino, max-drawdown, Calmar
  2. luck/selection  — Probabilistic Sharpe (PSR) + Deflated Sharpe (DSR, corrects
                       for best-of-N selection across the cohort) — kept as a
                       reference column (`dsr`).
  q = cross-sectional percentile composite of the measured metrics:
      0.5·rank(Sharpe) + 0.3·rank(Sortino) + 0.2·rank(−maxDD)  ∈ [0,1].
  Rationale (2026-07-12): q is a VOTING WEIGHT, not a hypothesis test. The DSR
  read on raw 30-min equity returns is degenerate (median 0 — it zeroed 146/187
  wallets and starved the signal's breadth gate), and the old copyScore prior
  measured copier count, which we don't care about. Ranks keep every scored
  trader's voice alive while still ordering by measured skill.

Still TODO before it's fully vault-grade (need more data / factors):
  - flows-stripped TWR from the ledger (here: raw equity change — see build_returns)
  - alpha vs beta (strip market/leverage) and walk-forward persistence validation.

DATA-GATED: needs enough return observations per trader (MIN_OBS). With the snapshot
history still accruing, most wallets read "insufficient history" today — by design.
The engine is correct and ready; it produces real `q` as the snapshots pile up.

Env: PGURL / DATABASE_URL. Run: backtest/.venv/bin/python backtest/quality_score.py
"""

import os
import sys
import math
import urllib.parse
import numpy as np
from scipy.stats import norm, skew, kurtosis
import pg8000.dbapi

MIN_OBS = 20                 # min return observations to score (else q = null)
PERIODS_PER_YEAR = 365 * 48  # 30-min snapshots → annualization factor
EULER = 0.5772156649

PGURL = os.environ.get("PGURL") or os.environ.get("DATABASE_URL")
if not PGURL:
    sys.exit("Set PGURL / DATABASE_URL (Railway Postgres → DATABASE_PUBLIC_URL).")


# ── risk-adjusted metrics ───────────────────────────────────────────────────
def sharpe(r):
    sd = r.std(ddof=1)
    return float(r.mean() / sd) if sd > 0 else 0.0          # per-period Sharpe


def sortino(r):
    dn = r[r < 0]
    dd = dn.std(ddof=1) if dn.size > 1 else 0.0
    return float(r.mean() / dd) if dd > 0 else 0.0


def max_drawdown(r):
    eq = np.cumprod(1 + r)
    peak = np.maximum.accumulate(eq)
    return float((1 - eq / peak).max()) if eq.size else 0.0


# ── luck / selection correction (Bailey & López de Prado) ───────────────────
def probabilistic_sharpe(r, sr_benchmark_per_period=0.0):
    """P(true Sharpe > benchmark), adjusting for length, skew, kurtosis."""
    n = r.size
    if n < 2:
        return 0.0
    sr = sharpe(r)
    g3 = float(skew(r, bias=False)) if n > 2 else 0.0
    g4 = float(kurtosis(r, fisher=False, bias=False)) if n > 3 else 3.0  # raw kurtosis
    denom = math.sqrt(max(1e-12, 1 - g3 * sr + ((g4 - 1) / 4.0) * sr * sr))
    z = (sr - sr_benchmark_per_period) * math.sqrt(n - 1) / denom
    return float(norm.cdf(z))


def deflated_benchmark(sharpes, n_trials):
    """Selection-deflated benchmark Sharpe (per-period) for N trials."""
    var_sr = float(np.var(sharpes, ddof=1)) if len(sharpes) > 1 else 0.0
    if var_sr <= 0 or n_trials < 2:
        return 0.0
    z1 = norm.ppf(1 - 1.0 / n_trials)
    z2 = norm.ppf(1 - 1.0 / (n_trials * math.e))
    return math.sqrt(var_sr) * ((1 - EULER) * z1 + EULER * z2)


# ── data ────────────────────────────────────────────────────────────────────
def connect():
    u = urllib.parse.urlparse(PGURL)
    return pg8000.dbapi.connect(user=u.username, password=u.password, host=u.hostname,
                                port=u.port or 5432, database=u.path.lstrip("/"))


def build_returns(cur):
    """Per-wallet return series from equity snapshots: total account value across
    dexes per snapshot ts → simple returns. (Flows-stripping via ledger = TODO.)"""
    cur.execute("""SELECT wallet, ts, SUM(account_value) AS eq
                   FROM equity GROUP BY wallet, ts ORDER BY wallet, ts""")
    series = {}
    for wallet, ts, eq in cur.fetchall():
        series.setdefault(wallet, []).append((ts, float(eq) if eq else 0.0))
    out = {}
    for wallet, pts in series.items():
        eqs = np.array([e for _, e in pts])
        eqs = eqs[eqs > 0]
        if eqs.size >= 2:
            out[wallet] = np.diff(eqs) / eqs[:-1]
    return out


def main():
    conn = connect()
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS quality (
        wallet TEXT PRIMARY KEY, q DOUBLE PRECISION, sharpe_ann DOUBLE PRECISION,
        sortino_ann DOUBLE PRECISION, max_dd DOUBLE PRECISION, n_obs INT,
        updated_ts BIGINT)""")
    cur.execute("ALTER TABLE quality ADD COLUMN IF NOT EXISTS dsr DOUBLE PRECISION")
    cur.execute("SELECT max(ts) FROM equity")
    now_ts = cur.fetchone()[0] or 0

    returns = build_returns(cur)
    scored = {w: r for w, r in returns.items() if r.size >= MIN_OBS}
    print(f"wallets with returns: {len(returns)} · with ≥{MIN_OBS} obs (scorable): {len(scored)}")
    if not scored:
        med = int(np.median([r.size for r in returns.values()])) if returns else 0
        print(f"  insufficient history — median {med} obs/wallet. The engine is ready; "
              f"q fills in as snapshots accrue (~{MIN_OBS} × 30min ≈ {MIN_OBS/2:.0f}h minimum).")
        conn.commit(); cur.close(); conn.close(); return

    sharpes = [sharpe(r) for r in scored.values()]
    sr_star = deflated_benchmark(sharpes, n_trials=len(scored))
    print(f"selection-deflated benchmark Sharpe (per-period): {sr_star:.4f} over {len(scored)} trials")

    ann = math.sqrt(PERIODS_PER_YEAR)
    wallets = list(scored.keys())
    metrics = {w: (sharpe(scored[w]), sortino(scored[w]), max_drawdown(scored[w])) for w in wallets}

    def pct_rank(values):
        """Percentile rank in (0,1]: average rank / n (ties share the mean rank)."""
        order = np.argsort(np.argsort(values, kind="stable"), kind="stable").astype(float)
        # average tied ranks so identical metrics get identical q
        vals = np.asarray(values, dtype=float)
        ranks = np.empty_like(vals)
        for v in np.unique(vals):
            m = vals == v
            ranks[m] = order[m].mean()
        return (ranks + 1.0) / len(vals)

    sh_r = pct_rank([metrics[w][0] for w in wallets])
    so_r = pct_rank([metrics[w][1] for w in wallets])
    dd_r = pct_rank([-metrics[w][2] for w in wallets])   # smaller drawdown → higher rank

    for i, wallet in enumerate(wallets):
        r = scored[wallet]
        q = 0.5 * sh_r[i] + 0.3 * so_r[i] + 0.2 * dd_r[i]
        dsr = probabilistic_sharpe(r, sr_benchmark_per_period=sr_star)  # reference only
        cur.execute("""INSERT INTO quality (wallet, q, sharpe_ann, sortino_ann, max_dd, n_obs, updated_ts, dsr)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (wallet) DO UPDATE SET q=EXCLUDED.q,
                         sharpe_ann=EXCLUDED.sharpe_ann, sortino_ann=EXCLUDED.sortino_ann,
                         max_dd=EXCLUDED.max_dd, n_obs=EXCLUDED.n_obs, updated_ts=EXCLUDED.updated_ts,
                         dsr=EXCLUDED.dsr""",
                    (wallet, round(float(q), 4), round(metrics[wallet][0] * ann, 3),
                     round(metrics[wallet][1] * ann, 3), round(metrics[wallet][2], 4),
                     int(r.size), now_ts, round(dsr, 4)))
    conn.commit()

    cur.execute("SELECT wallet, q, dsr, sharpe_ann, max_dd, n_obs FROM quality ORDER BY q DESC LIMIT 12")
    print(f"\n{'wallet':>12} {'q(rank)':>8} {'DSR':>6} {'Sharpe':>8} {'maxDD':>7} {'n':>5}")
    for w, q, dsr, sh, dd, n in cur.fetchall():
        print(f"{w[:12]:>12} {q:>8.3f} {dsr if dsr is not None else -1:>6.3f} {sh:>8.2f} {dd:>7.2%} {n:>5}")
    cur.close(); conn.close()


if __name__ == "__main__":
    main()
