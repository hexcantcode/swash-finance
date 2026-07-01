#!/usr/bin/env python3
"""
Price + funding history for the 2-asset historical test: BTC and xyz:SP500.

candleSnapshot caps at ~5000 candles/request, so we page backward by time to pull
as deep as HL retains. Funding history likewise. NDJSON out → data/prices/.
Stdlib only.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import datetime

HL_INFO = "https://api.hyperliquid.xyz/info"
ASSETS = ["BTC", "xyz:SP500"]
INTERVAL = "1h"
MAX_PAGES = 40
OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "prices")


def _post(payload, retries=6):
    body = json.dumps(payload).encode()
    for attempt in range(retries):
        req = urllib.request.Request(HL_INFO, data=body, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(min(2 ** attempt, 20))
                continue
            raise


def fetch_candles(coin):
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    end = now
    seen = {}  # t -> candle (dedupe across pages)
    for _ in range(MAX_PAGES):
        start = end - 5000 * 3600 * 1000  # 5000 hours back
        batch = _post({"type": "candleSnapshot", "req": {"coin": coin, "interval": INTERVAL,
                                                         "startTime": start, "endTime": end}})
        if not batch:
            break
        for c in batch:
            seen[c["t"]] = c
        oldest = min(c["t"] for c in batch)
        if oldest >= end - 3600 * 1000:  # no progress
            break
        end = oldest - 1
        time.sleep(0.2)
    return [seen[t] for t in sorted(seen)]


def fetch_funding(coin):
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    end = now
    seen = {}
    for _ in range(MAX_PAGES):
        start = end - 5000 * 3600 * 1000
        try:
            batch = _post({"type": "fundingHistory", "coin": coin, "startTime": start, "endTime": end})
        except Exception as e:  # noqa: BLE001
            print(f"  ! funding {coin}: {e}", file=sys.stderr)
            break
        if not batch:
            break
        for f in batch:
            seen[f["time"]] = f
        oldest = min(f["time"] for f in batch)
        if oldest >= end - 3600 * 1000:
            break
        end = oldest - 1
        time.sleep(0.2)
    return [seen[t] for t in sorted(seen)]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for coin in ASSETS:
        slug = coin.replace(":", "_")
        candles = fetch_candles(coin)
        funding = fetch_funding(coin)
        with open(os.path.join(OUT_DIR, f"{slug}.candles.ndjson"), "w") as f:
            for c in candles:
                f.write(json.dumps(c) + "\n")
        with open(os.path.join(OUT_DIR, f"{slug}.funding.ndjson"), "w") as f:
            for x in funding:
                f.write(json.dumps(x) + "\n")
        if candles:
            t0 = datetime.datetime.fromtimestamp(candles[0]["t"] / 1000, datetime.timezone.utc).date()
            t1 = datetime.datetime.fromtimestamp(candles[-1]["t"] / 1000, datetime.timezone.utc).date()
            print(f"{coin}: {len(candles)} candles {t0}→{t1} ({round((candles[-1]['t']-candles[0]['t'])/86400000)}d) · {len(funding)} funding pts")


if __name__ == "__main__":
    main()
