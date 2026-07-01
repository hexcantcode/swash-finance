#!/usr/bin/env python3
"""
Paper NAV per vault — the asset-vs-vault comparison (design Section 4).

No candles needed: each snapshot's positions already encode the asset mark price
(position_value / |szi|), so we get the price at every snapshot moment for free.
The paper vault steps by signal × asset_return; the benchmark is buy-and-hold.
Both indexed to 100 at inception → two comparable lines.

Writes vault_nav(coin, ts, vault_nav, asset_nav). Funding/fees omitted for now
(small over the short horizon; the chart is gated + labeled "observed paper").

Env: PGURL / DATABASE_URL. Runs in the cloud loop after forward_test.
"""

import os
import sys
import urllib.parse
import statistics
from collections import defaultdict
import pg8000.dbapi

PGURL = os.environ.get("PGURL") or os.environ.get("DATABASE_URL")
if not PGURL:
    sys.exit("Set PGURL / DATABASE_URL.")


def connect():
    u = urllib.parse.urlparse(PGURL)
    return pg8000.dbapi.connect(user=u.username, password=u.password, host=u.hostname,
                                port=u.port or 5432, database=u.path.lstrip("/"))


def main():
    conn = connect()
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS vault_nav (
        coin TEXT, ts BIGINT, vault_nav DOUBLE PRECISION, asset_nav DOUBLE PRECISION,
        PRIMARY KEY (coin, ts))""")

    cur.execute("SELECT DISTINCT coin FROM signal_track")
    coins = [r[0] for r in cur.fetchall()]

    # Asset price at each (coin, ts) = median(position_value / |szi|) over holders.
    cur.execute("SELECT coin, ts, position_value, abs(szi) FROM positions WHERE szi <> 0 AND position_value > 0")
    px = defaultdict(list)
    for coin, ts, pv, a in cur.fetchall():
        if a and float(a) > 0:
            px[(coin, ts)].append(float(pv) / float(a))
    price = {k: statistics.median(v) for k, v in px.items()}

    cur.execute("SELECT coin, ts, s FROM signal_track")
    sig = {(c, t): (float(s) if s is not None else 0.0) for c, t, s in cur.fetchall()}

    total = 0
    for coin in coins:
        tss = sorted({t for (c, t) in price if c == coin})
        if len(tss) < 2:
            continue
        vnav = anav = 100.0
        rows = [(coin, tss[0], 100.0, 100.0)]
        for i in range(1, len(tss)):
            p0, p1 = price.get((coin, tss[i - 1])), price.get((coin, tss[i]))
            if not p0 or not p1:
                rows.append((coin, tss[i], round(vnav, 4), round(anav, 4)))
                continue
            ar = p1 / p0 - 1.0
            s0 = sig.get((coin, tss[i - 1]), 0.0)
            vnav *= (1 + s0 * ar)
            anav *= (1 + ar)
            rows.append((coin, tss[i], round(vnav, 4), round(anav, 4)))
        cur.executemany("""INSERT INTO vault_nav VALUES (%s,%s,%s,%s)
                           ON CONFLICT (coin, ts) DO UPDATE SET
                             vault_nav = EXCLUDED.vault_nav, asset_nav = EXCLUDED.asset_nav""", rows)
        total += len(rows)
    conn.commit()
    print(f"vault_nav: {total} points across {len(coins)} vaults")

    cur.execute("""SELECT coin, round(vault_nav::numeric,1), round(asset_nav::numeric,1)
                   FROM vault_nav v WHERE ts = (SELECT max(ts) FROM vault_nav w WHERE w.coin=v.coin)
                   ORDER BY vault_nav DESC LIMIT 8""")
    print("latest paper NAV (vault vs asset, base 100):")
    for coin, vn, an in cur.fetchall():
        print(f"  {coin:>12}  vault {vn}  asset {an}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
