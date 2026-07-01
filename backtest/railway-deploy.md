# Deploying the snapshotter to Railway (Mac-independent 24/7 capture)

The forward-capture snapshotter must run in the cloud, not on a laptop — a gap in the
data is lost forever. This deploys it as a **Railway cron service** writing to a
**persistent volume** (Railway's container FS is ephemeral and would wipe the data on
every redeploy).

## What runs
- **`collect_snapshots.py`** — one snapshot of the roster's positions + equity per run.
- Railway **cron** invokes it every 30 min; the container starts, snapshots, exits.
- Data → a **volume** mounted at `/data` (`VAULT_DATA_ROOT=/data`), so it persists.

## One-time setup (Railway dashboard or CLI)

CLI (`npm i -g @railway/cli`, then `railway login`):

```bash
cd backtest
railway init                       # or: railway link  (to an existing project)
railway up                         # builds the Dockerfile, deploys the service
```

Then, in the service **Settings**:
1. **Volume** — add a volume, mount path **`/data`** (this is the durable store).
2. **Variables** — set `VAULT_DATA_ROOT=/data`.
3. **Cron Schedule** — `*/30 * * * *` (every 30 min). Railway runs the container on
   that schedule and it exits between runs (no idle compute cost).
4. **Restart policy** — leave default; cron drives execution.

## After it's live
- Verify a run: **Deployments → Logs** shows `snapshot ts=… roster=80 … wrote N positions`.
- **Then stop the local pm2 snapshotter** so we don't double-capture:
  `npx pm2 delete vault-snapshots` (keep it running until Railway is confirmed — no gaps).
- Pull data down for analysis, or run `reconstruct.py` against the volume.

## Storage note (volume now, R2/S3 later)
A Railway volume is the fastest path to Mac-independence and keeps the file-based flow.
For higher durability / decoupling, upgrade to **Cloudflare R2 / S3**: have the
snapshotter write objects there (add `boto3` + a tiny `put_object` on each file), and
DuckDB reads Parquet directly from R2/S3 for backtesting. The code already routes all
paths through `VAULT_DATA_ROOT`, so this is an additive change, not a rewrite.

## The vault keeper (future, real money) is a separate decision
The KMS-signing execution keeper likely belongs on **AWS** (native IAM→KMS, no
long-lived AWS keys in Railway env), not here. This deploy is for the research/data
runners only.
