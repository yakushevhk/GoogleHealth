#!/usr/bin/env bash
# Runs LOCALLY: builds the dashboard and uploads it to the server.
# Usage: ./deploy/push.sh root@<server-ip>
set -euo pipefail
cd "$(dirname "$0")/.."   # GoogleHealth/astrojs

SERVER="${1:?Usage: ./deploy/push.sh root@<server-ip>}"
APP_DIR=/opt/googlehealth-dashboard

echo "→ Building..."
npm run build

echo "→ Preparing .env..."
if [[ ! -f .env ]]; then
  python3 - <<'EOF'
import json, re
py = open('../oauth_health.py').read()
cid = re.search(r'CLIENT_ID = "(.+?)"', py).group(1)
csec = re.search(r'CLIENT_SECRET = "(.+?)"', py).group(1)
rt = json.load(open('../health_token.json'))['refresh_token']
open('.env', 'w').write(f"GOOGLE_CLIENT_ID={cid}\nGOOGLE_CLIENT_SECRET={csec}\nGOOGLE_REFRESH_TOKEN={rt}\n")
print("  .env created from oauth_health.py + health_token.json")
EOF
fi

echo "→ Uploading to $SERVER..."
ssh "$SERVER" "mkdir -p $APP_DIR"
rsync -az --delete dist/ "$SERVER:$APP_DIR/dist/"
rsync -az .env "$SERVER:$APP_DIR/.env"

echo "
Done. Now on the server:
  scp -r deploy/ $SERVER:/tmp/gh-deploy/ && ssh $SERVER 'bash /tmp/gh-deploy/server-setup.sh'
(or run the steps from deploy/README.md manually once)"
