#!/bin/bash
# Refresh Google Health token every 5 days to keep it alive
#
# Usage: ./refresh_token.sh [TOKEN_FILE] [ENV_FILE]
# Defaults: ./health_token.json and ./.env

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="${1:-$SCRIPT_DIR/health_token.json}"
ENV_FILE="${2:-$SCRIPT_DIR/.env}"
CLIENT_ID="YOUR_CLIENT_ID"
CLIENT_SECRET="YOUR_CLIENT_SECRET"

REFRESH_TOKEN=$(cat "$TOKEN_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['refresh_token'])")

RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "refresh_token=$REFRESH_TOKEN" \
  -d "grant_type=refresh_token")

if echo "$RESPONSE" | grep -q "access_token"; then
  python3 -c "
import json, sys
with open('$TOKEN_FILE') as f:
    data = json.load(f)
new = json.loads('''$RESPONSE''')
data['access_token'] = new['access_token']
data['expires_in'] = new['expires_in']
if 'refresh_token' in new:
    data['refresh_token'] = new['refresh_token']
with open('$TOKEN_FILE', 'w') as f:
    json.dump(data, f, indent=2)
print(data['refresh_token'])
" | while read NEW_RT; do
    sed -i "s|^GOOGLE_REFRESH_TOKEN=.*|GOOGLE_REFRESH_TOKEN=$NEW_RT|" "$ENV_FILE"
  done

  echo "$(date): Token refreshed"
else
  echo "$(date): ERROR - $RESPONSE"
fi
