#!/usr/bin/env bash
# Runs ON THE SERVER once: systemd + nginx + Basic Auth.
# Expects /opt/googlehealth-dashboard/dist and .env to already be uploaded (push.sh).
set -euo pipefail

APP_DIR=/opt/googlehealth-dashboard
DOMAIN=your-domain.com
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

[[ -f "$APP_DIR/dist/server/entry.mjs" ]] || {
  echo "ERROR: $APP_DIR/dist not found. Run deploy/push.sh locally first."; exit 1;
}

# ── 1. Node.js ──
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Install Node.js 18+ (in aaPanel: App Store → PM2 Manager)."
  exit 1
fi
echo "node: $(node -v)"

# ── 2. User and permissions ──
id www >/dev/null 2>&1 || useradd --system --no-create-home www
chown -R www:www "$APP_DIR"

# ── 3. systemd ──
cp "$SCRIPT_DIR/googlehealth-dashboard.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now googlehealth-dashboard
sleep 2
systemctl is-active --quiet googlehealth-dashboard \
  && echo "✓ service started" \
  || { echo "ERROR: service failed to start"; journalctl -u googlehealth-dashboard -n 20 --no-pager; exit 1; }
curl -sf -o /dev/null http://127.0.0.1:4321/ && echo "✓ :4321 responds"

# ── 4. Basic Auth ──
if [[ ! -f /etc/nginx/htpasswd-health ]]; then
  command -v htpasswd >/dev/null 2>&1 || {
    echo "→ installing apache2-utils for htpasswd..."
    (apt-get install -y apache2-utils >/dev/null 2>&1) || (yum install -y httpd-tools >/dev/null 2>&1)
  }
  read -rp "Dashboard login [admin]: " LOGIN
  LOGIN="${LOGIN:-admin}"
  htpasswd -c /etc/nginx/htpasswd-health "$LOGIN"
  echo "✓ /etc/nginx/htpasswd-health created"
fi

# ── 5. nginx ──
# aaPanel: /www/server/panel/vhost/nginx/<domain>.conf; otherwise /etc/nginx/conf.d/
if [[ -d /www/server/panel/vhost/nginx ]]; then
  NGINX_CONF="/www/server/panel/vhost/nginx/$DOMAIN.conf"
else
  NGINX_CONF="/etc/nginx/conf.d/$DOMAIN.conf"
fi
[[ -f "$NGINX_CONF" ]] && cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%s)" && echo "→ backup: $NGINX_CONF.bak.*"
cp "$SCRIPT_DIR/nginx-health.conf" "$NGINX_CONF"
nginx -t && (systemctl reload nginx || nginx -s reload) && echo "✓ nginx reloaded"

echo "
Done: https://$DOMAIN (login/password from step 4).
MCP server remains at https://$DOMAIN/mcp and /health."
