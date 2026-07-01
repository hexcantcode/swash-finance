# Snapshotter runner for Railway — Mac-independent 24/7 forward-capture.
# Stdlib-only (collect_snapshots.py needs no deps), so a tiny slim image.
# Railway runs this on a cron schedule; the container starts, snapshots once, exits.
FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir pg8000
COPY collect_snapshots.py salvage_fills.py forward_test.py roster_seed.json ./

# Data lands here — mount a Railway volume at /data (survives redeploys) and set
# VAULT_DATA_ROOT=/data in the service env. NEVER the ephemeral container FS.
ENV VAULT_DATA_ROOT=/data

# Always-on loop: snapshot, then sleep VAULT_SNAPSHOT_INTERVAL (default 1800s = 30 min).
# A standard long-running service — no Railway cron config needed, no restart-loop risk.
ENV VAULT_SNAPSHOT_INTERVAL=1800
CMD ["sh", "-c", "while true; do python collect_snapshots.py || true; python forward_test.py || true; sleep ${VAULT_SNAPSHOT_INTERVAL:-1800}; done"]
