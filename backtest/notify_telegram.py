#!/usr/bin/env python3
"""
Telegram signal notifier — broadcasts vault call changes to a channel/group.

Runs at the end of the vault-snapshots loop (after compute_nav.py). Diffs each
vault's latest actionable call in `signal_track` against the last NOTIFIED call
in `tg_notify_state` (same Postgres — survives redeploys) and sends one message
per transition: FLAT->LONG/SHORT, direction flip, LONG/SHORT->FLAT. First run
seeds state silently so launch doesn't blast the whole book.

Universe + tickers below are copied from cream `src/lib/smartmoney/coin.ts`
(LIGHTER_HL_COINS minus HIDDEN_SYMBOLS) — regenerate on asset-map changes:
  python3 - (see docs/plans/2026-07-17-telegram-signal-notifier-design.md)

Env: PGURL / DATABASE_URL   Postgres (as the other loop steps)
     TELEGRAM_BOT_TOKEN     from @BotFather; unset => step no-ops, exit 0
     TELEGRAM_CHAT_ID       group/channel id (-100...) or @handle
     TELEGRAM_DRY_RUN=1     print messages instead of sending
     TELEGRAM_ARCUS_ONLY=1  only push assets also tradeable on Arcus. The live
                            market list (GET api.arcus.xyz/v1/markets, public)
                            is fetched each run and ONLINE perps are matched to
                            our tickers directly or via ARCUS_ALIASES (SKHY +
                            the ETF proxies GLD/SLV/USO/SPY/QQQ). Fetch failure
                            falls back to ARCUS_FALLBACK (2026-07-18 snapshot).
                            State still updates for suppressed coins, so
                            toggling the switch never replays stale calls.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
import pg8000.dbapi

SITE = "https://www.cream.run"

# ── Arcus filter ────────────────────────────────────────────────────────────
# Arcus baseAsset → our Lighter ticker, where symbols differ. GLD/SLV/USO/
# SPY/QQQ are ETF proxies of underlyings we trade — directionally the same
# signal; delete a line here to stop treating one as a match.
ARCUS_ALIASES = {
    "SKHY": "SKHYNIXUSD",
    "GLD": "XAU",
    "SLV": "XAG",
    "USO": "WTI",
    "SPY": "US500",
    "QQQ": "US100",
}
# Matched tickers as of 2026-07-18 — used only if the live fetch fails.
ARCUS_FALLBACK = {
    "BTC", "ETH", "SOL", "HYPE", "DYDX", "ZEC", "LIT", "XRP",
    "AMD", "INTC", "GOOGL", "META", "MU", "BABA", "HOOD", "CRCL", "NVDA",
    "TSLA", "AAPL", "AMZN", "MSFT", "SNDK", "DRAM", "PLTR", "CRWV", "ORCL",
    "SPCX", "BE", "COIN", "SKHYNIXUSD",
    "XAU", "XAG", "WTI", "US500", "US100",
}


def fetch_arcus_tickers():
    """Our tickers with a live Arcus perp market; ARCUS_FALLBACK on failure."""
    ours = set(VAULT_TICKERS.values())
    try:
        req = urllib.request.Request("https://api.arcus.xyz/v1/markets",
                                     headers={"user-agent": "cream-signal-bot"})
        with urllib.request.urlopen(req, timeout=10) as r:
            markets = json.load(r)["markets"]
        out = set()
        for m in markets:
            if m.get("status") != "ONLINE" or m.get("type") != "PERPETUAL":
                continue
            t = ARCUS_ALIASES.get(m["baseAsset"], m["baseAsset"])
            if t in ours:
                out.add(t)
        if not out:
            raise ValueError("empty market list")
        return out
    except Exception as e:
        print(f"notify_telegram: arcus fetch failed ({e}) - using fallback set")
        return ARCUS_FALLBACK & ours

VAULT_TICKERS = {
    "0G": "0G",
    "kBONK": "1000BONK",
    "kFLOKI": "1000FLOKI",
    "kPEPE": "1000PEPE",
    "kSHIB": "1000SHIB",
    "2Z": "2Z",
    "AAVE": "AAVE",
    "ADA": "ADA",
    "AERO": "AERO",
    "APEX": "APEX",
    "APT": "APT",
    "ARB": "ARB",
    "ASTER": "ASTER",
    "AVAX": "AVAX",
    "AVNT": "AVNT",
    "AXS": "AXS",
    "AZTEC": "AZTEC",
    "BCH": "BCH",
    "BERA": "BERA",
    "BIO": "BIO",
    "BNB": "BNB",
    "BTC": "BTC",
    "CC": "CC",
    "CHIP": "CHIP",
    "CRV": "CRV",
    "DASH": "DASH",
    "DOGE": "DOGE",
    "DOT": "DOT",
    "DYDX": "DYDX",
    "EIGEN": "EIGEN",
    "ENA": "ENA",
    "ETH": "ETH",
    "ETHFI": "ETHFI",
    "FARTCOIN": "FARTCOIN",
    "FIL": "FIL",
    "FOGO": "FOGO",
    "GMX": "GMX",
    "GRAM": "GRAM",
    "GRASS": "GRASS",
    "HBAR": "HBAR",
    "HYPE": "HYPE",
    "ICP": "ICP",
    "JTO": "JTO",
    "JUP": "JUP",
    "KAITO": "KAITO",
    "LDO": "LDO",
    "LINEA": "LINEA",
    "LINK": "LINK",
    "LIT": "LIT",
    "LTC": "LTC",
    "MEGA": "MEGA",
    "MET": "MET",
    "MNT": "MNT",
    "MON": "MON",
    "MORPHO": "MORPHO",
    "NEAR": "NEAR",
    "ONDO": "ONDO",
    "OP": "OP",
    "PAXG": "PAXG",
    "PENDLE": "PENDLE",
    "PENGU": "PENGU",
    "POL": "POL",
    "POPCAT": "POPCAT",
    "PROVE": "PROVE",
    "PUMP": "PUMP",
    "PYTH": "PYTH",
    "RESOLV": "RESOLV",
    "S": "S",
    "SEI": "SEI",
    "SKR": "SKR",
    "SKY": "SKY",
    "SOL": "SOL",
    "SPX": "SPX",
    "STABLE": "STABLE",
    "STBL": "STBL",
    "STRK": "STRK",
    "SUI": "SUI",
    "SYRUP": "SYRUP",
    "TAO": "TAO",
    "TIA": "TIA",
    "TRUMP": "TRUMP",
    "TRX": "TRX",
    "UNI": "UNI",
    "VIRTUAL": "VIRTUAL",
    "VVV": "VVV",
    "WIF": "WIF",
    "WLD": "WLD",
    "WLFI": "WLFI",
    "XLM": "XLM",
    "XMR": "XMR",
    "XPL": "XPL",
    "XRP": "XRP",
    "ZEC": "ZEC",
    "ZK": "ZK",
    "ZORA": "ZORA",
    "ZRO": "ZRO",
    "xyz:AAPL": "AAPL",
    "xyz:AMD": "AMD",
    "xyz:AMZN": "AMZN",
    "xyz:ARM": "ARM",
    "xyz:ASML": "ASML",
    "xyz:AVGO": "AVGO",
    "xyz:BABA": "BABA",
    "xyz:BB": "BB",
    "xyz:BE": "BE",
    "xyz:BOT": "BOT",
    "xyz:BRENTOIL": "BRENTOIL",
    "xyz:CBRS": "CBRS",
    "xyz:COIN": "COIN",
    "xyz:CRCL": "CRCL",
    "xyz:CRWV": "CRWV",
    "xyz:DELL": "DELL",
    "xyz:DRAM": "DRAM",
    "xyz:EUR": "EURUSD",
    "xyz:EWY": "EWY",
    "xyz:GBP": "GBPUSD",
    "xyz:GME": "GME",
    "xyz:GOOGL": "GOOGL",
    "xyz:HOOD": "HOOD",
    "xyz:HYUNDAI": "HYUNDAIUSD",
    "xyz:IBM": "IBM",
    "xyz:INTC": "INTC",
    "xyz:LITE": "LITE",
    "xyz:META": "META",
    "xyz:MRVL": "MRVL",
    "xyz:MSFT": "MSFT",
    "xyz:MSTR": "MSTR",
    "xyz:MU": "MU",
    "xyz:NATGAS": "NATGAS",
    "xyz:NBIS": "NBIS",
    "xyz:NOK": "NOK",
    "xyz:NOW": "NOW",
    "xyz:NVDA": "NVDA",
    "xyz:ORCL": "ORCL",
    "xyz:PLTR": "PLTR",
    "xyz:QCOM": "QCOM",
    "xyz:QNT": "QNT",
    "xyz:RKLB": "RKLB",
    "xyz:SMSN": "SAMSUNGUSD",
    "xyz:SKHX": "SKHYNIXUSD",
    "xyz:SNDK": "SNDK",
    "xyz:SPCX": "SPCX",
    "xyz:STRC": "STRC",
    "xyz:TSLA": "TSLA",
    "xyz:TSM": "TSM",
    "xyz:XYZ100": "US100",
    "xyz:SP500": "US500",
    "xyz:JPY": "USDJPY",
    "xyz:CL": "WTI",
    "xyz:SILVER": "XAG",
    "xyz:GOLD": "XAU",
    "xyz:COPPER": "XCU",
    "xyz:PALLADIUM": "XPD",
    "xyz:PLATINUM": "XPT",
    "xyz:ZHIPU": "ZHIPU",
}


PGURL = os.environ.get("PGURL") or os.environ.get("DATABASE_URL")
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
CHAT = os.environ.get("TELEGRAM_CHAT_ID")
DRY = os.environ.get("TELEGRAM_DRY_RUN") == "1"

if not PGURL:
    sys.exit("Set PGURL / DATABASE_URL.")
if not DRY and (not TOKEN or not CHAT):
    print("notify_telegram: TELEGRAM_BOT_TOKEN/CHAT_ID not set - skipping.")
    sys.exit(0)


def connect():
    u = urllib.parse.urlparse(PGURL)
    return pg8000.dbapi.connect(user=u.username, password=u.password, host=u.hostname,
                                port=u.port or 5432, database=u.path.lstrip("/"))


def send(text):
    if DRY:
        print("--- DRY RUN message ---")
        print(text)
        return True
    data = json.dumps({"chat_id": int(CHAT) if CHAT.lstrip("-").isdigit() else CHAT,
                       "text": text, "parse_mode": "HTML",
                       "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{TOKEN}/sendMessage",
                                 data=data, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r).get("ok", False)
    except Exception as e:
        print(f"notify_telegram: send failed: {e}")
        return False


def pct(s):
    return round(abs(s) * 100)


def was_phrase(prev_act, prev_s):
    if prev_act in (None, "FLAT") or prev_s is None:
        return "was in cash"
    return f"was {pct(prev_s)}% {'long' if prev_s > 0 else 'short'}"


def build_message(coin, act, s, longs, shorts, prev_act, prev_s):
    ticker = VAULT_TICKERS[coin]
    url = f"{SITE}/vaults/{urllib.parse.quote(ticker)}"
    pros = longs + shorts
    if act == "FLAT":
        return (f"\u26aa <b>{ticker} vault \u2192 CASH</b>\n\n"
                f"{was_phrase(prev_act, prev_s).capitalize()} \u00b7 conviction fell below the acting threshold\n"
                f"Pros still positioned: {pros}\n\n"
                f'<a href="{url}">cream.run/vaults/{ticker}</a>')
    emoji = "\U0001f7e2" if act == "LONG" else "\U0001f534"
    flip = ""
    if prev_act in ("LONG", "SHORT") and prev_act != act:
        flip = f" \u26a1 <i>flipped from {prev_act}</i>"
    return (f"{emoji} <b>{ticker} vault \u2192 {act}</b>{flip}\n\n"
            f"Position: <b>{pct(s)}% of NAV {act.lower()}</b> \u00b7 {was_phrase(prev_act, prev_s)}\n"
            f"Pros behind it: {pros} ({longs} long / {shorts} short)\n\n"
            f'<a href="{url}">cream.run/vaults/{ticker}</a>')


def main():
    conn = connect()
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS tg_notify_state (
        coin TEXT PRIMARY KEY, actionable TEXT, s DOUBLE PRECISION, ts BIGINT)""")

    cur.execute("""SELECT DISTINCT ON (coin) coin, s, actionable, ts
                   FROM signal_track ORDER BY coin, ts DESC""")
    latest = {c: (float(s), a, int(t)) for c, s, a, t in cur.fetchall() if c in VAULT_TICKERS}

    cur.execute("SELECT coin, actionable, s FROM tg_notify_state")
    state = {c: (a, float(s) if s is not None else None) for c, a, s in cur.fetchall()}

    def upsert(coin, act, s, ts):
        cur.execute("""INSERT INTO tg_notify_state VALUES (%s,%s,%s,%s)
                       ON CONFLICT (coin) DO UPDATE SET actionable=EXCLUDED.actionable,
                         s=EXCLUDED.s, ts=EXCLUDED.ts""", (coin, act, s, ts))

    if not state:
        for coin, (s, act, ts) in latest.items():
            upsert(coin, act, s, ts)
        conn.commit()
        print(f"notify_telegram: seeded state for {len(latest)} vaults (no messages on first run).")
        conn.close()
        return

    # longs/shorts per coin at the latest position snapshot (for changed coins only)
    changed = [c for c, (s, act, ts) in latest.items() if state.get(c, (None, None))[0] != act]
    counts = {}
    if changed:
        cur.execute("""WITH latest_pos AS (SELECT max(ts) t FROM positions)
                       SELECT coin, count(*) FILTER (WHERE szi > 0), count(*) FILTER (WHERE szi < 0)
                       FROM positions, latest_pos
                       WHERE ts = latest_pos.t AND szi <> 0 GROUP BY coin""")
        counts = {c: (int(l), int(sh)) for c, l, sh in cur.fetchall()}

    # Arcus switch: transitions on non-matching assets update state silently.
    arcus_only = os.environ.get("TELEGRAM_ARCUS_ONLY") == "1"
    allowed = None
    if arcus_only:
        tickers = fetch_arcus_tickers()
        allowed = {hl for hl, t in VAULT_TICKERS.items() if t in tickers}
        print(f"notify_telegram: arcus filter on - {len(allowed)} of {len(VAULT_TICKERS)} vaults eligible")

    sent = suppressed = 0
    for coin in sorted(changed):
        s, act, ts = latest[coin]
        if allowed is not None and coin not in allowed:
            upsert(coin, act, s, ts)
            conn.commit()
            suppressed += 1
            continue
        prev_act, prev_s = state.get(coin, (None, None))
        longs, shorts = counts.get(coin, (0, 0))
        msg = build_message(coin, act, s, longs, shorts, prev_act, prev_s)
        if send(msg):
            upsert(coin, act, s, ts)
            conn.commit()
            sent += 1
            time.sleep(0.5)
    # coins new to the universe with no transition still need seeding
    for coin, (s, act, ts) in latest.items():
        if coin not in state and coin not in changed:
            upsert(coin, act, s, ts)
    conn.commit()
    print(f"notify_telegram: {len(changed)} transitions, {sent} sent, {suppressed} suppressed (arcus filter).")
    conn.close()


if __name__ == "__main__":
    main()
