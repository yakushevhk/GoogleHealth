# Deploying the dashboard to your-domain.com

Server: nginx + Rust MCP server (:3000, `/mcp`, `/health`).
The dashboard sits alongside: Astro SSR on :4321, nginx proxies the domain root
to it under **Basic Auth**; `/mcp` and `/health` remain with the MCP server.

## Prerequisites on the server

- **Node.js 18+** (in aaPanel: App Store -> PM2 Manager installs Node)
- `htpasswd` (installed automatically: apache2-utils / httpd-tools)

## Automatic (2 commands)

Locally, from `GoogleHealth/astrojs/`:

```bash
./deploy/push.sh root@<server-ip>          # build + upload dist/ and .env
scp -r deploy/ root@<server-ip>:/tmp/gh-deploy/
ssh root@<server-ip> 'bash /tmp/gh-deploy/server-setup.sh'
```

`server-setup.sh` will ask for a login and password for Basic Auth, create
the systemd unit `googlehealth-dashboard`, replace the domain nginx config
(saves the old one as `.bak.*`) and reload nginx.

## Manual

1. Locally: `npm run build`, then copy `dist/` and `.env` to `/opt/googlehealth-dashboard/`.
2. On the server:
   ```bash
   htpasswd -c /etc/nginx/htpasswd-health <login>
   cp deploy/googlehealth-dashboard.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now googlehealth-dashboard
   # replace your domain's nginx config with deploy/nginx-health.conf
   nginx -t && systemctl reload nginx
   ```

## Refreshing the token (once every ~7 days while the app is in Testing)

```bash
python3 oauth_health.py          # locally: new health_token.json
./deploy/push.sh root@<ip>       # .env will be regenerated and uploaded
ssh root@<ip> 'systemctl restart googlehealth-dashboard'
```

After moving the OAuth app to Production (Google Cloud Console ->
OAuth consent screen -> Publish App) the token becomes permanent — this step
will no longer be needed.

## Rollback

```bash
systemctl disable --now googlehealth-dashboard
# restore nginx config from .bak.* and systemctl reload nginx
```

## Verification

- `curl -u <login>:<password> https://your-domain.com/` -> dashboard HTML
- `curl https://your-domain.com/health` -> `{"server":"rust-mcp-sdk",...}` (MCP is alive)
- Without login the root returns `401 Unauthorized`.
