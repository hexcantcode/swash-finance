#!/usr/bin/env python3
"""
Task 0 auth probe (THROWAWAY discovery tool — not production code).

Answers the one question that decides the Lighter leaderboard data path:
  Can a Lighter auth token read an ARBITRARY account's trade/PnL history,
  or only its own account?  (And how far back does authed history go?)

Your private key never leaves your machine — this runs locally and only
sends the short-lived *auth token* to the public REST API.

SETUP (once):
  python3 -m venv .venv && source .venv/bin/activate
  pip install lighter-sdk requests        # or: pip install git+https://github.com/elliottech/lighter-python.git

RUN:
  export LIGHTER_API_KEY_PRIVATE=0x...     # the api-key private key (NOT your ETH key)
  export LIGHTER_ACCOUNT_INDEX=12345       # your account index
  export LIGHTER_API_KEY_INDEX=253         # the api key index you registered (often 253 for read-only)
  python3 auth-probe.py

Paste the whole output back into the chat.
"""
import os, sys, time, json
import requests

BASE = os.environ.get("LIGHTER_BASE", "https://mainnet.zklighter.elliot.ai")
PRIV = os.environ.get("LIGHTER_API_KEY_PRIVATE")
ACCT = os.environ.get("LIGHTER_ACCOUNT_INDEX")
KEYIDX = int(os.environ.get("LIGHTER_API_KEY_INDEX", "253"))
# A few accounts confirmed active on BTC during the 2026-06-24 spike — used as
# the "someone else's account" target for the arbitrary-read test.
OTHER_ACCOUNTS = [702384, 110172, 66984]

if not (PRIV and ACCT):
    sys.exit("Set LIGHTER_API_KEY_PRIVATE and LIGHTER_ACCOUNT_INDEX (see header).")
ACCT = int(ACCT)

import lighter  # noqa: E402

def mint_token() -> str:
    client = lighter.SignerClient(
        url=BASE, private_key=PRIV, account_index=ACCT, api_key_index=KEYIDX,
    )
    auth, err = client.create_auth_token_with_expiry(
        lighter.SignerClient.DEFAULT_10_MIN_AUTH_EXPIRY
    )
    if err is not None:
        sys.exit(f"token mint failed: {err}")
    return auth

def get(path: str, token: str, **params):
    params["auth"] = token
    r = requests.get(f"{BASE}{path}", params=params,
                     headers={"Authorization": token}, timeout=20)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {"raw": r.text[:200]}

def trade_span(body):
    tr = body.get("trades") or []
    if not tr:
        return f"code={body.get('code')} msg={body.get('message','')} n=0"
    ts = [int(t["timestamp"]) for t in tr if t.get("timestamp")]
    days = (time.time()*1000 - min(ts)) / 86400000 if ts else 0
    return f"n={len(tr)} oldest={time.strftime('%Y-%m-%d', time.gmtime(min(ts)/1000))} ({days:.1f}d back)"

def pnl_span(body):
    pts = body.get("pnl") or body.get("entries") or []
    return f"code={body.get('code')} msg={body.get('message','')} pts={len(pts) if isinstance(pts,list) else pts}"

def main():
    token = mint_token()
    print(f"[ok] minted auth token (account {ACCT}, key {KEYIDX}), len={len(token)}\n")
    now = int(time.time()*1000); s90 = now - 90*86400000

    print("=== 1) OWN account — does authed history work + how deep? ===")
    c, b = get("/api/v1/trades", token, account_index=ACCT, market_id=1, limit=100, sort_dir="asc")
    print(f"  trades(own,market1,asc) [{c}] {trade_span(b)}")
    c, b = get("/api/v1/pnl", token, by="index", value=ACCT, resolution="1d",
               start_timestamp=s90, end_timestamp=now, count_back=100)
    print(f"  pnl(own,90d)            [{c}] {pnl_span(b)}\n")

    print("=== 2) DECISIVE — can the token read OTHER accounts? ===")
    for o in OTHER_ACCOUNTS:
        c, b = get("/api/v1/trades", token, account_index=o, market_id=1, limit=100)
        print(f"  trades(other={o},market1) [{c}] {trade_span(b)}")
        c, b = get("/api/v1/pnl", token, by="index", value=o, resolution="1d",
                   start_timestamp=s90, end_timestamp=now, count_back=100)
        print(f"  pnl(other={o},90d)        [{c}] {pnl_span(b)}")

    print("\nVERDICT: if section 2 returns real trades/pnl for accounts you don't own,")
    print("         arbitrary reads work → reconstruct path is viable. If they 403/")
    print("         'account not found'/empty, auth is own-account-only → use Path 2.")

if __name__ == "__main__":
    main()
