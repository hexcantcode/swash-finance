#!/usr/bin/env python3
"""
Fetch the top Hyperliquid copy-traders from Hyperdash's public GraphQL API.

Source: https://hyperdash.com/explore/copytraders
API:    POST https://api.hyperdash.com/graphql  (operation GetSystemGroupTraders)

The endpoint is public (no auth) but rejects non-browser User-Agents with
{"code":"BLOCKED_USER_AGENT"}, so we send a normal Chrome UA + the site Origin/Referer.

Usage:
    python3 fetch_top_traders.py                      # copy-enabled, JSON to stdout
    python3 fetch_top_traders.py --csv out.csv        # also write a CSV
    python3 fetch_top_traders.py --all                # don't filter to copy-enabled
    python3 fetch_top_traders.py --group copytraders  # which system list (default)
    python3 fetch_top_traders.py --sort pnl           # sort by pnl | copyScore (default)

"Copy-enabled" = copyScore > 0 AND perpsEquity > 0 (a wallet you can actually mirror).
"""
import argparse, csv, json, sys, urllib.request, urllib.error

API = "https://api.hyperdash.com/graphql"

# The exact query the site issues. groupId selects the system list; "copytraders"
# is the curated "Best Wallets to Copytrade" top-100 (all already high copy-score).
QUERY = """
query GetSystemGroupTraders($groupId: ID!) {
  getSystemGroupTraders(groupId: $groupId) {
    address label displayName verified twitter
    lastTradeAt lastFillAt
    pnl perpsEquity winrate
    pnlCohort sizeCohort
    totalTrades totalLongTrades totalShortTrades totalWinningTrades totalLosingTrades
    sharpe drawdown copyScore tag
    topAssets { coin volume pnl }
  }
}
""".strip()

# A browser UA is REQUIRED — the API blocks default urllib/curl user agents.
HEADERS = {
    "content-type": "application/json",
    "origin": "https://hyperdash.com",
    "referer": "https://hyperdash.com/",
    "user-agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
}


def fetch(group_id):
    payload = json.dumps({
        "operationName": "GetSystemGroupTraders",
        "variables": {"groupId": group_id},
        "query": QUERY,
    }).encode()
    req = urllib.request.Request(API, data=payload, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:300]}")
    if "errors" in body:
        sys.exit("GraphQL errors: " + json.dumps(body["errors"])[:300])
    rows = (body.get("data") or {}).get("getSystemGroupTraders")
    if rows is None:
        sys.exit("Unexpected response: " + json.dumps(body)[:300])
    return rows


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def normalize(t):
    return {
        "address": t["address"],
        "name": t.get("label") or t.get("displayName") or "",
        "verified": bool(t.get("verified")),
        "twitter": t.get("twitter") or "",
        "copyScore": round(num(t.get("copyScore")), 2),   # float 0-100 (UI rounds to int)
        "pnl": num(t.get("pnl")),                          # cohort cumulative PnL (USD)
        "equity": num(t.get("perpsEquity")),               # live perps equity (USD)
        "winrate": num(t.get("winrate")),                  # already 0-100
        "trades": t.get("totalTrades"),
        "sharpe": t.get("sharpe"),
        "drawdown": t.get("drawdown"),
        "sizeCohort": t.get("sizeCohort"),
        "pnlCohort": t.get("pnlCohort"),
        "topAssets": ",".join(a.get("coin", "") for a in (t.get("topAssets") or [])[:4]),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", default="copytraders")
    ap.add_argument("--all", action="store_true", help="skip copy-enabled filter")
    ap.add_argument("--sort", choices=["copyScore", "pnl"], default="copyScore")
    ap.add_argument("--csv", metavar="PATH", help="also write a CSV file")
    args = ap.parse_args()

    rows = [normalize(t) for t in fetch(args.group)]
    total = len(rows)
    if not args.all:
        rows = [r for r in rows if r["copyScore"] > 0 and r["equity"] > 0]
    rows.sort(key=lambda r: r[args.sort], reverse=True)

    print(json.dumps(rows, ensure_ascii=False, indent=1))
    sys.stderr.write(f"group={args.group}  total={total}  kept={len(rows)} "
                     f"({'all' if args.all else 'copy-enabled'})  sorted by {args.sort}\n")

    if args.csv:
        cols = ["address", "name", "verified", "copyScore", "pnl", "equity",
                "winrate", "trades", "sharpe", "drawdown", "sizeCohort",
                "pnlCohort", "topAssets", "twitter"]
        with open(args.csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        sys.stderr.write(f"wrote {args.csv}\n")


if __name__ == "__main__":
    main()
