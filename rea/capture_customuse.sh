#!/usr/bin/env bash
# Passive REA capture of customuse.com: page structure, network endpoints, and
# JS bundle analysis (vendor fingerprints, API endpoint candidates).
#
# Run on a machine that can reach customuse.com. Log in inside the opened
# browser window first if you want to capture the editor/generation flow.
#   ./rea/capture_customuse.sh [url]
set -euo pipefail

URL="${1:-https://customuse.com/}"
PORT=9222
OUT="$(cd "$(dirname "$0")" && pwd)/captures"
PROFILE="$(mktemp -d)"
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
mkdir -p "$OUT"

"$CHROME" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" --password-store=basic "$URL" &
CHROME_PID=$!
trap 'kill $CHROME_PID 2>/dev/null; wait $CHROME_PID 2>/dev/null; rm -rf "$PROFILE"' EXIT
until curl -fs "http://127.0.0.1:$PORT/json/version" >/dev/null; do sleep 1; done
sleep 5

REA="npx -y rea-agents@latest"
# CDP page id of the customuse tab (the id REA's list-browser-targets also reports).
TARGET=$(curl -fs "http://127.0.0.1:$PORT/json/list" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).find(t=>t.type==="page"&&/customuse/.test(t.url));console.log(t?t.id:"")})')
[ -n "$TARGET" ] || { echo "no customuse.com tab found"; exit 1; }

$REA inspect-web-page "http://127.0.0.1:$PORT" "$TARGET" --observation-ms 5000 --json > "$OUT/page.json"
$REA analyze-web-bundle "http://127.0.0.1:$PORT" "$TARGET" --json > "$OUT/bundle.json"
echo "Now click Generate in the browser window; observing for 60s..."
$REA observe-web-session "http://127.0.0.1:$PORT" "$TARGET" --observation-ms 60000 --json > "$OUT/session.json"

# Quick look at which 3D providers the shipped JS references.
grep -o -i -E 'meshy|tripo|hunyuan|trellis|rodin|hyper3d|fal\.(ai|run)|replicate|flux|kling' \
  "$OUT/bundle.json" "$OUT/page.json" | sort | uniq -c | sort -rn || true
echo "Evidence written to $OUT"
