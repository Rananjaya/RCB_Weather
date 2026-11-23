#!/bin/sh
# Send a test alert to subscribed devices (uses your Cloudflare login: npx wrangler login).
#   ./send-test.sh            test alert to every device
#   ./send-test.sh --list     list devices only
#   ./send-test.sh firefox    only Firefox devices   (also: chrome, safari, edge)
cd "$(dirname "$0")"
API=https://rcb-weather-alerts.rananjayabandara.workers.dev
FILTER=$1
KEYS=$(npx -y wrangler@4 kv key list --binding SUBS --remote 2>/dev/null | grep -o 'sub:[0-9a-f]*')
[ -z "$KEYS" ] && { echo "No devices have alerts on."; exit 0; }
for K in $KEYS; do
  npx -y wrangler@4 kv key get --binding SUBS --remote "$K" 2>/dev/null | FILTER="$FILTER" API="$API" python3 -c '
import json, os, sys, urllib.request, datetime
d = json.load(sys.stdin); ep = d["sub"]["endpoint"]; host = ep.split("/")[2]
kind = {"fcm.googleapis.com": "Chrome/Android", "updates.push.services.mozilla.com": "Firefox",
        "web.push.apple.com": "Safari/iPhone"}.get(host, "Edge/Windows" if "windows" in host else host)
since = datetime.datetime.fromtimestamp(d.get("since", 0) / 1000).strftime("%d %b %H:%M")
name, lat, lon, prov = d["name"], d["lat"], d["lon"], d.get("provider", "openmeteo")
line = f"{sys.argv[1][4:12]}  {kind:15} {name} ({lat}, {lon})  provider: {prov}  since {since}"
f = os.environ["FILTER"].lower()
if f == "--list": print(line); sys.exit()
if f and f not in kind.lower(): sys.exit()
req = urllib.request.Request(os.environ["API"] + "/test", data=json.dumps({"endpoint": ep}).encode(), headers={"content-type": "application/json", "User-Agent": "RCBWeather-send-test/1.0"})
try: r = urllib.request.urlopen(req); print(line, "→ test sent")
except Exception as e: print(line, "→", getattr(e, "read", lambda: str(e).encode())().decode())
' "$K"
done
[ "$FILTER" = "--list" ] || echo "Done. The test shows on each device within a few seconds. Expired devices (410) are removed automatically."
