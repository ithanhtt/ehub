#!/usr/bin/env bash
#
# First-time install of EHub on an Ubuntu server (22.04 or 24.04).
#
#   sudo bash install.sh --bundle adshub-0.1.0-….bundle --domain adshub.example.com --email you@example.com
#
# Sets up Node.js 22, PostgreSQL, PM2 and Nginx (with HTTPS from Let's Encrypt),
# then installs the bundle as the first release, in the layout the in-app
# updater works with:
#
#   /opt/adshub/releases/<id>/   one directory per release
#   /opt/adshub/current          → the live release
#   /opt/adshub/shared/          .env.local, .data, backups, ecosystem.config.cjs
#
# The bundle comes from `npm run release:bundle` on the development machine.
# Every later version goes through the app: Administrator → System update.
set -euo pipefail

BUNDLE=""
DOMAIN=""
EMAIL=""
HTTPS=1
PORT=3000
APP_USER="adshub"
HOME_DIR="/opt/adshub"

die() { echo "✗ $*" >&2; exit 1; }
step() { echo; echo "▸ $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --no-https) HTTPS=0; shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run it as root: sudo bash install.sh …"
[[ -f "$BUNDLE" ]] || die "--bundle: file not found. Make one with 'npm run release:bundle' on the development machine."
[[ -n "$DOMAIN" ]] || die "--domain is required: the address people will open, e.g. adshub.example.com"
[[ $HTTPS -eq 0 || -n "$EMAIL" ]] || die "--email is required for the HTTPS certificate (or pass --no-https)."
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be a number."
[[ -e "$HOME_DIR/current" ]] && die "EHub is already installed in $HOME_DIR. Update it from the app instead (System update), or see README → 'Cài lại từ đầu'."
BUNDLE="$(readlink -f "$BUNDLE")"
SCHEME=$([[ $HTTPS -eq 1 ]] && echo https || echo http)
CERT_FAILED=0

# Let's Encrypt only issues a certificate once the domain points at this server.
if [[ $HTTPS -eq 1 ]]; then
  RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 { print $1 }' || true)"
  echo "  $DOMAIN → ${RESOLVED:-(does not resolve)}; this server: $(hostname -I 2>/dev/null || true)"
  [[ -n "$RESOLVED" ]] || echo "  ! $DOMAIN has no DNS record yet: the HTTPS step will fail. Create an A record for it first."
fi

step "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg openssl nginx postgresql postgresql-client
if [[ $HTTPS -eq 1 ]]; then apt-get install -y certbot python3-certbot-nginx; fi

step "Memory"
# `next build` needs well over 1 GB; on a small VPS it is killed half-way without swap.
MEM_MB="$(awk '/^MemTotal/ { print int($2 / 1024) }' /proc/meminfo)"
if [[ $MEM_MB -lt 3000 ]] && [[ -z "$(swapon --show --noheadings)" ]]; then
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "  ${MEM_MB} MB RAM: added a 2 GB swap file"
else
  echo "  ${MEM_MB} MB RAM, swap already set up or not needed"
fi

step "Node.js 22 and PM2"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2
echo "  node $(node -v), pm2 $(pm2 -v)"

step "App user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
mkdir -p "$HOME_DIR/releases" "$HOME_DIR/shared/.data" "$HOME_DIR/shared/backups"

step "PostgreSQL database and settings"
ENV_FILE="$HOME_DIR/shared/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  DB_PASS="$(openssl rand -hex 24)"
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_USER'" | grep -q 1; then
    sudo -u postgres psql -qc "ALTER ROLE $APP_USER WITH LOGIN PASSWORD '$DB_PASS'"
  else
    sudo -u postgres psql -qc "CREATE ROLE $APP_USER WITH LOGIN PASSWORD '$DB_PASS'"
  fi
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$APP_USER'" | grep -q 1 \
    || sudo -u postgres createdb -O "$APP_USER" "$APP_USER"
  cat > "$ENV_FILE" <<EOF
# Written by deploy/install.sh. Shared by every release; keep it private.
DATABASE_URL=postgresql://$APP_USER:$DB_PASS@127.0.0.1:5432/$APP_USER
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=$SCHEME://$DOMAIN
TRUSTED_ORIGINS=$SCHEME://$DOMAIN
# AES-256-GCM key for stored connector credentials. Changing it makes every saved credential unreadable.
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
PORT=$PORT
# In-app updates: this server accepts them. The same key goes into the development machine's .env.local.
UPDATE_RECEIVER=1
UPDATE_SIGNING_KEY=$(openssl rand -base64 32)
EOF
  echo "  wrote $ENV_FILE"
else
  echo "  keeping the existing $ENV_FILE"
fi
chmod 600 "$ENV_FILE"

step "First release"
RELEASE_ID="$(date -u +%Y%m%d-%H%M%S)-initial"
RELEASE_DIR="$HOME_DIR/releases/$RELEASE_ID"
# The bundle carries its own reader: take that out first, then let it check and unpack the rest.
node --input-type=module -e '
import { gunzipSync } from "node:zlib"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
const [bundlePath, dir] = process.argv.slice(1)
const buffer = readFileSync(bundlePath)
const manifest = JSON.parse(gunzipSync(buffer).toString("utf8"))
const reader = manifest.files?.find((file) => file.path === "scripts/update-bundle.mjs")
if (!reader) throw new Error("not an EHub bundle")
const copy = path.join(mkdtempSync(path.join(os.tmpdir(), "adshub-")), "update-bundle.mjs")
writeFileSync(copy, Buffer.from(reader.data, "base64"))
const { readBundle, extractBundle } = await import("file://" + copy)
const bundle = readBundle(buffer)
extractBundle(bundle, dir)
console.log(`  ${bundle.files.length} files, version ${bundle.version}`)
' "$BUNDLE" "$RELEASE_DIR"
VERSION="$(node -p "require('$RELEASE_DIR/package.json').version")"
cat > "$RELEASE_DIR/.release.json" <<EOF
{ "id": "$RELEASE_ID", "version": "$VERSION", "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
EOF
ln -s "$HOME_DIR/shared/.env.local" "$RELEASE_DIR/.env.local"
ln -s "$HOME_DIR/shared/.data" "$RELEASE_DIR/.data"
chown -R "$APP_USER:$APP_USER" "$HOME_DIR"

step "Dependencies, database schema and build (a few minutes)"
as_app() { sudo -u "$APP_USER" -H bash -c "cd '$RELEASE_DIR' && $*"; }
as_app "npm ci --include=dev --no-audit --no-fund"
as_app "node scripts/migrate.mjs"
# On a small VPS Node caps its heap near half the RAM, and the build's type check needs more: let it use the swap.
as_app "NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2048 node node_modules/next/dist/bin/next build"
ln -sfn "$RELEASE_DIR" "$HOME_DIR/current"
chown -h "$APP_USER:$APP_USER" "$HOME_DIR/current"

step "Process manager"
# PM2 starts its daemon from the current directory, which must be one the app user may enter (not /root).
cd "$HOME_DIR"
cat > "$HOME_DIR/shared/ecosystem.config.cjs" <<EOF
// Written by deploy/install.sh. PM2 runs the live release from ./current; the
// in-app updater reloads it from this file after switching releases.
module.exports = {
  apps: [
    {
      name: 'adshub',
      cwd: '$HOME_DIR/current',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p $PORT -H 127.0.0.1',
      env: { NODE_ENV: 'production', PORT: '$PORT', NEXT_TELEMETRY_DISABLED: '1' },
      // The updater is started by the app and must outlive the app's restart.
      treekill: false,
      kill_timeout: 10000,
      max_memory_restart: '1500M',
    },
  ],
}
EOF
chown "$APP_USER:$APP_USER" "$HOME_DIR/shared/ecosystem.config.cjs"
sudo -u "$APP_USER" -H pm2 start "$HOME_DIR/shared/ecosystem.config.cjs"
# Rotate PM2's logs, or they grow for as long as the app runs: 10 MB a file, the last 7 kept, compressed.
if sudo -u "$APP_USER" -H pm2 install pm2-logrotate >/dev/null 2>&1; then
  sudo -u "$APP_USER" -H pm2 set pm2-logrotate:max_size 10M >/dev/null
  sudo -u "$APP_USER" -H pm2 set pm2-logrotate:retain 7 >/dev/null
  sudo -u "$APP_USER" -H pm2 set pm2-logrotate:compress true >/dev/null
  echo "  log rotation on (pm2-logrotate)"
else
  echo "  ! could not install pm2-logrotate; PM2 logs will not be rotated"
fi
sudo -u "$APP_USER" -H pm2 save
# Back up after a reboot, as the app user.
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

step "Nginx"
cat > /etc/nginx/sites-available/adshub <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Update bundles are uploaded here; they run to a few megabytes.
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/adshub /etc/nginx/sites-enabled/adshub
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
if [[ $HTTPS -eq 1 ]]; then
  step "HTTPS certificate"
  # Not fatal: the app is installed by now, and the certificate can be fetched again on its own.
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || CERT_FAILED=1
fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full' >/dev/null; fi

step "Waiting for the app"
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || die "The app did not start. See: sudo -u $APP_USER pm2 logs adshub"

KEY="$(grep '^UPDATE_SIGNING_KEY=' "$ENV_FILE" | cut -d= -f2-)"
if [[ $CERT_FAILED -eq 1 ]]; then
  cat <<EOF

! EHub is installed and running, but the HTTPS certificate was not issued.
  The app is set up for https://$DOMAIN, so sign-in will not work until it is.
  Check that $DOMAIN points at this server and that ports 80 and 443 are open, then run:

    sudo certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect

  and carry on with the steps below.
EOF
fi
cat <<EOF

✓ EHub is running at $SCHEME://$DOMAIN

Next:
  1. Open $SCHEME://$DOMAIN now and register. The first account becomes the Administrator.
  2. On the development machine, add these two lines to .env.local and restart npm run dev:

       UPDATE_SERVER_URL=https://$DOMAIN
       UPDATE_SIGNING_KEY=$KEY

  3. From then on: user menu → System update → "Pack & send" on the development
     machine, then type the code it shows on the server's System update page.

  Logs:     sudo -u $APP_USER pm2 logs adshub
  Backups:  $HOME_DIR/shared/backups (one before every update)
EOF
if [[ $HTTPS -eq 0 ]]; then
  cat <<EOF

! Installed without HTTPS. The development machine only sends updates over https://.
  When $DOMAIN has a DNS record pointing here, add a certificate:
    sudo certbot --nginx -d $DOMAIN -m <your-email> --agree-tos --redirect
  then set BETTER_AUTH_URL and TRUSTED_ORIGINS to https://$DOMAIN in $ENV_FILE and run:
    sudo -u $APP_USER pm2 restart adshub --update-env
EOF
fi
