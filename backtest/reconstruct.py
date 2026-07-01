#!/usr/bin/env python3
"""
Reconstruction + data audit for the Conviction Vault backtest.

Converts the raw NDJSON capture (forward-capture snapshots + salvaged fills/funding/
ledger) into Parquet, and prints a data-quality audit — how much usable history we
actually have per wallet, since HL fill retention is shallow/uneven. Later steps
(return series → quality `q` → signal → sim) build on these Parquet panels.

Run with the venv: `backtest/.venv/bin/python backtest/reconstruct.py`
"""

import os
import glob
import duckdb

BT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BT, "data")
OUT = os.path.join(DATA, "parquet")
os.makedirs(OUT, exist_ok=True)
con = duckdb.connect()


def has(pattern):
    return len(glob.glob(pattern)) > 0


def to_parquet(select_sql, name):
    path = os.path.join(OUT, f"{name}.parquet")
    con.execute(f"COPY ({select_sql}) TO '{path}' (FORMAT parquet)")
    return path


print("=" * 72)
print("RECONSTRUCTION + AUDIT")
print("=" * 72)

# ── 1. Forward-capture snapshots → clean position + equity panels ───────────
snap_pos = os.path.join(DATA, "snapshots", "*.positions.ndjson")
if has(snap_pos):
    p = to_parquet(
        f"SELECT * FROM read_json_auto('{snap_pos}', union_by_name=true)", "snap_positions"
    )
    n, w, c, dexes, t0, t1 = con.execute(
        f"SELECT count(*), count(distinct wallet), count(distinct coin), "
        f"count(distinct dex), min(ts), max(ts) FROM '{p}'"
    ).fetchone()
    snaps = con.execute(f"SELECT count(distinct ts) FROM '{p}'").fetchone()[0]
    print(f"\n[snapshots] {n} rows · {w} wallets · {c} coins · {dexes} dexes · {snaps} snapshot(s)")
    print(f"           position panel is the CLEAN source (position(t) direct, no reconstruction).")
else:
    print("\n[snapshots] none yet — the vault-snapshots pm2 job accrues these every 30 min.")

snap_eq = os.path.join(DATA, "snapshots", "*.equity.ndjson")
if has(snap_eq):
    to_parquet(f"SELECT * FROM read_json_auto('{snap_eq}', union_by_name=true)", "snap_equity")

# ── 2. Salvaged fills → Parquet + history-depth audit ───────────────────────
fills = os.path.join(DATA, "salvage", "*.fills.ndjson")
if has(fills):
    p = to_parquet(
        f"""SELECT regexp_extract(filename, '([^/]+)\\.fills\\.ndjson', 1) AS wallet, *
            FROM read_json_auto('{fills}', filename=true, union_by_name=true)""",
        "fills",
    )
    total, wallets = con.execute(f"SELECT count(*), count(distinct wallet) FROM '{p}'").fetchone()
    print(f"\n[salvaged fills] {total} fills across {wallets} wallets with data")
    audit = con.execute(
        f"""SELECT wallet[1:10] AS w,
                   count(*) AS fills,
                   count(DISTINCT coin) AS coins,
                   round((max(time) - min(time)) / 86400000.0, 1) AS span_days,
                   CAST(to_timestamp(min(time) / 1000) AS DATE) AS earliest
            FROM '{p}' GROUP BY wallet ORDER BY span_days DESC"""
    ).fetchdf()
    print("\nhistory depth per wallet (top 15 by span):")
    print(audit.head(15).to_string(index=False))
    print(f"\n  span_days — median {audit.span_days.median():.1f} · "
          f"max {audit.span_days.max():.1f} · "
          f"wallets with ≥30d {(audit.span_days >= 30).sum()} · ≥90d {(audit.span_days >= 90).sum()}")
    print("  → usable preliminary-backtest window is the intersection where depth is adequate.")

    # Rough realized-PnL proxy per wallet (full flows-stripped TWR comes later).
    pnl = con.execute(
        f"""SELECT wallet[1:10] AS w, round(sum(TRY_CAST(closedPnl AS DOUBLE)), 0) AS realized_pnl,
                   round(sum(TRY_CAST(fee AS DOUBLE)), 0) AS fees
            FROM '{p}' GROUP BY wallet ORDER BY realized_pnl DESC LIMIT 10"""
    ).fetchdf()
    print("\ntop realized-PnL (rough, from closedPnl — NOT the quality score):")
    print(pnl.to_string(index=False))
else:
    print("\n[salvaged fills] none yet — salvage_fills.py still running or no history.")

# ── 3. Funding + ledger → Parquet (for flows-stripping + funding-drag later) ─
for kind in ("funding", "ledger"):
    g = os.path.join(DATA, "salvage", f"*.{kind}.ndjson")
    if has(g):
        to_parquet(
            f"""SELECT regexp_extract(filename, '([^/]+)\\.{kind}\\.ndjson', 1) AS wallet, *
                FROM read_json_auto('{g}', filename=true, union_by_name=true)""",
            kind,
        )
        print(f"[{kind}] → parquet")

print(f"\nParquet written to {os.path.relpath(OUT)}/  — next: return series → quality q → signal → sim.")
