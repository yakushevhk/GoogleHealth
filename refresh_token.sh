#!/bin/bash
# Refresh Google Health token every 5 days to keep it alive
#
# Usage: ./refresh_token.sh [TOKEN_FILE] [ENV_FILE]
# Defaults: ./health_token.json and ./.env
#
# Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .env (see .env.example).
# Updates the token file in place and rewrites GOOGLE_REFRESH_TOKEN in .env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="${1:-$SCRIPT_DIR/health_token.json}"
ENV_FILE="${2:-$SCRIPT_DIR/.env}"

CLIENT_ID="$(grep -E '^GOOGLE_CLIENT_ID=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
CLIENT_SECRET="$(grep -E '^GOOGLE_CLIENT_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
CLIENT_ID="${CLIENT_ID:-YOUR_CLIENT_ID}"
CLIENT_SECRET="${CLIENT_SECRET:-YOUR_CLIENT_SECRET}"

REFRESH_TOKEN=$(cat "$TOKEN_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['refresh_token'])")

RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "refresh_token=$REFRESH_TOKEN" \
  -d "grant_type=refresh_token")

if echo "$RESPONSE" | grep -q "access_token"; then
  NEW_RT="$(TOKEN_FILE="$TOKEN_FILE" RESPONSE="$RESPONSE" python3 <<'PY'
import json, os
with open(os.environ['TOKEN_FILE']) as f:
    data = json.load(f)
new = json.loads(os.environ['RESPONSE'])
data['access_token'] = new['access_token']
data['expires_in'] = new['expires_in']
if 'refresh_token' in new:
    data['refresh_token'] = new['refresh_token']
with open(os.environ['TOKEN_FILE'], 'w') as f:
    json.dump(data, f, indent=2)
print(data['refresh_token'])
PY
)"
  # Portable sed: write to temp then mv (works on both GNU and BSD sed)
  sed "s|^GOOGLE_REFRESH_TOKEN=.*|GOOGLE_REFRESH_TOKEN=$NEW_RT|" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo "$(date): Token refreshed"
else
  echo "$(date): ERROR - $RESPONSE"
  exit 1
fi