# Conviction Vault — backtest / forward-test workstream

Data capture + signal forward-test for the Conviction Vault. Design & methodology:
`docs/plans/2026-07-01-conviction-vault-master-plan.md` (Parts VII–VIII).

## Deployed architecture (live)

**Runs in the cloud, Mac-independent** — Railway project `adventurous-alignment`:
- **`vault-snapshots` service** — every 30 min loops: (1) snapshot the EP roster's positions +
  equity (main + `xyz` dex) via `clearinghouseState`; (2) compute the BTC + `xyz:SP500` signal.
- **`Postgres` service** — durable store, readable from anywhere. Tables: `positions`, `equity`,
  `roster`, `signal_track`. (Snapshotter also writes NDJSON to a `/data` volume as a fallback.)

Why forward-test, not backtest: HL fill retention is too shallow/uneven to reconstruct a
cross-sectional history (median ~22d; only 1–4 wallets have deep BTC/SP500 fills), so we run the
signal **forward** on accruing snapshots — genuinely out-of-sample, no look-ahead/survivorship.

Python + DuckDB/pg8000, deliberately **separate from the TS app** and the prod Neon DB.

## Why forward-capture

HL fill retention is shallow and uneven — hours for hyper-active wallets, ~10 months for calm
ones — so there is **no uniform deep history to excavate**. The clean, gap-free, no-look-ahead
dataset is **built forward** from `clearinghouseState` snapshots. The sooner it runs, the sooner
we can backtest; every missed day is lost forever. Salvaged fills are a *preliminary* sample only.

## Scripts

- **`collect_snapshots.py`** — forward-capture. One run = one point-in-time snapshot of the EP
  roster's positions + equity (main + `xyz` HIP-3 dex) → `data/snapshots/YYYY-MM-DD.{positions,equity}.ndjson`
  and `data/roster/YYYY-MM-DD.ndjson`. **Runs every 30 min under pm2** (`vault-snapshots`).
- **`salvage_fills.py`** — one-shot. Pulls whatever `userFillsByTime` / funding / ledger history
  each wallet still has → `data/salvage/<wallet>.{fills,funding,ledger}.ndjson`. For a rough,
  caveated preliminary backtest.

## Scripts

- **`collect_snapshots.py`** — snapshot roster positions + equity → Postgres (`positions`,
  `equity`, `roster`) + `/data` volume NDJSON. Resilient roster (live Hyperdash → volume file →
  baked `roster_seed.json`). Runs in the cloud loop.
- **`forward_test.py`** — compute the BTC + `xyz:SP500` signal `s = Σ q·c·d / Σ q·c` from the
  Postgres snapshots, upsert to `signal_track`. Runs in the same cloud loop. `q` = placeholder
  copyScore until the vault-grade score exists.
- **`salvage_fills.py`** — one-shot, pulls whatever fill/funding/ledger history exists (thin).
- **`fetch_prices.py`** — BTC + `xyz:SP500` candles + funding → `data/prices/`.
- **`reconstruct.py`** — NDJSON → Parquet + data audit (local ad-hoc).

## Monitor / run locally

```bash
railway logs -s vault-snapshots                 # cloud loop logs (build+runtime)
# local run against the cloud DB:
export PGURL="$(railway variables -s Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)"
.venv/bin/python forward_test.py                # recompute/catch-up the signal
```

## Next (per master plan) — the MVP path

1. **Let it accrue** — the cloud loop builds `signal_track` for BTC/SP500 every 30 min (genuine
   out-of-sample paper track). Days → weeks of history.
2. **Vault-grade `q`** — replace the placeholder copyScore with the real score (flows-stripped
   TWR, risk-adjusted, PSR/DSR, leverage-neutral alpha), computed walk-forward from the accruing
   snapshots. **This is the gating build.**
3. **Validate** — once enough history: does `q×conviction` **beat the raw-notional baseline**
   out-of-sample (IC, deflated Sharpe)? Go/no-go for the quality thesis.
4. **Sim P&L** — join `signal_track` × price returns − funding − fees → a NAV track for the vault.
