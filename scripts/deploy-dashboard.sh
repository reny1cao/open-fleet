#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "[deploy] Pulling latest develop..."
git pull origin develop

echo "[deploy] Building dashboard..."
cd src/dashboard
npm run build
cd "$REPO_DIR"

echo "[deploy] Rebuilding fleet binary..."
bun build src/index.ts --compile --outfile ~/.fleet/fleet-next

echo "[deploy] Restarting fleet server..."
FLEET_PID=$(ss -tlnp 2>/dev/null | grep ':4680' | grep -oP 'pid=\K[0-9]+' || true)
if [ -n "$FLEET_PID" ]; then
    kill "$FLEET_PID" 2>/dev/null || true
    sleep 2
fi
nohup bun run "$REPO_DIR/src/server/index.ts" > /tmp/fleet-server.log 2>&1 & disown

echo "[deploy] Waiting for server..."
for i in $(seq 1 15); do
    if ss -tlnp 2>/dev/null | grep -q ':4680'; then
        NEW_PID=$(ss -tlnp 2>/dev/null | grep ':4680' | grep -oP 'pid=\K[0-9]+')
        echo "[deploy] ✓ Fleet server running (PID $NEW_PID)"
        curl -s -o /dev/null -w "[deploy] ✓ Dashboard: HTTP %{http_code}\n" http://localhost:4680/dashboard
        exit 0
    fi
    sleep 1
done
echo "[deploy] ✗ Server failed to start — check /tmp/fleet-server.log"
exit 1
