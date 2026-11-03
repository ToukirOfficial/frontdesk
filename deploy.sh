#!/usr/bin/env bash
# Deploys Frontdesk to your own server over SSH, without Docker. The release is built ON the server from a clean
# clone of the GitHub repo, so native packages (argon2, sharp, onnxruntime, Prisma engines) match the server's CPU
# (e.g. ARM). It then backs up and migrates the database, switches, restarts PM2, and rolls back if the health
# check fails. Works from macOS and Linux/WSL: locally it only needs git and ssh.
#
#   ./deploy.sh          deploy the pushed HEAD
#   ./deploy.sh --seed   also (re)load the demo clinic after switching (only when DEMO_MODE=true on the server;
#                        the worker also seeds it on start)
#
# Server details are never stored in the repository: put them in ./deploy.env (gitignored, see deploy.env.example).
# The server needs: git, Node.js 24, pnpm and PM2 for the app user, PostgreSQL with pgvector, Redis, a reverse proxy
# sending /api (with WebSocket upgrades) to the API and everything else to the web app, and $APP_DIR/shared/.env
# containing the production settings plus WEB_PORT and API_URL (read by ecosystem.config.cjs).
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck disable=SC1091
[ -f deploy.env ] && . ./deploy.env

: "${REMOTE:?Set REMOTE in deploy.env (see deploy.env.example)}"
: "${APP_DIR:?Set APP_DIR in deploy.env}"
: "${DOMAIN:?Set DOMAIN in deploy.env}"
: "${API_URL:?Set API_URL in deploy.env (the API address on the server)}"
BRANCH="${BRANCH:-main}"
KEEP_RELEASES=3
KEEP_DUMPS=5
# Public clone URL of this repo (the server needs no GitHub key).
REPO_URL="${REPO_URL:-$(git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#')}"

SEED=0
for a in "$@"; do
  case "$a" in
    --seed) SEED=1 ;;
    *) echo "Unknown option: $a" >&2; exit 1 ;;
  esac
done

# Node: nvm first, Homebrew only as a fallback (only git and ssh are used locally).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 24 >/dev/null 2>&1 || true
elif [ -x /opt/homebrew/bin/node ]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi

[ -z "$(git status --porcelain)" ] || { echo "✗ Commit or stash your changes first: deploys are built from HEAD"; exit 1; }
git fetch -q origin "$BRANCH"
SHA="$(git rev-parse HEAD)"
[ "$SHA" = "$(git rev-parse "origin/$BRANCH")" ] || { echo "✗ HEAD is not origin/$BRANCH: push first (the server clones from GitHub)"; exit 1; }
RELEASE="$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}"

# Runs a script from stdin on the server (as DEPLOY_AS when set), passing the remaining arguments to it.
remote() {
  local cmd
  cmd="bash -s -- $(printf '%q ' "$@")"
  [ -n "${DEPLOY_AS:-}" ] && cmd="su - $DEPLOY_AS -c $(printf '%q' "$cmd")"
  ssh "$REMOTE" "$cmd"
}

echo "▸ Building ${SHA:0:7} on the server, migrating and switching"
remote "$APP_DIR" "$RELEASE" "$KEEP_RELEASES" "$KEEP_DUMPS" "$REPO_URL" "$BRANCH" "$SHA" "$API_URL" "$SEED" <<'REMOTE_SCRIPT'
set -euo pipefail
APP_DIR="$1"; RELEASE="$2"; KEEP_RELEASES="$3"; KEEP_DUMPS="$4"; REPO_URL="$5"; BRANCH="$6"; SHA="$7"; API_URL="$8"; SEED="$9"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null
test -f "$APP_DIR/shared/.env" || { echo "✗ Missing $APP_DIR/shared/.env on the server" >&2; exit 1; }
mkdir -p "$APP_DIR/releases" "$APP_DIR/backups"
SRC="$APP_DIR/build-src"
OUT="$APP_DIR/releases/$RELEASE"
trap 'rm -rf "$SRC"' EXIT
rm -rf "$SRC"
git clone -q --branch "$BRANCH" "$REPO_URL" "$SRC"
git -C "$SRC" checkout -q "$SHA"
cd "$SRC"
export CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
pnpm install --frozen-lockfile >/dev/null
# prisma generate reads DATABASE_URL from its config but never connects: a placeholder is enough to build.
API_URL="$API_URL" DATABASE_URL="postgresql://build:build@localhost:5432/build" TURBO_FORCE=true pnpm build >/dev/null
# Next.js bakes the /api rewrite into the build: refuse to ship one that points anywhere else.
grep -q "$API_URL" apps/web/.next/routes-manifest.json || { echo "✗ The web build doesn't proxy /api to API_URL"; exit 1; }

echo "▸ Bundling release $RELEASE"
mkdir -p "$OUT/web"
# Web: the standalone server plus its static files and public folder (incl. widget.js).
cp -a apps/web/.next/standalone/. "$OUT/web/"
cp -a apps/web/.next/static "$OUT/web/apps/web/.next/static"
cp -a apps/web/public "$OUT/web/apps/web/public"
# API + worker: production dependencies only, plus the compiled code, prompts, migrations and demo answers.
pnpm --filter @frontdesk/api deploy --prod --legacy "$OUT/api" >/dev/null
rm -rf "$OUT/api/src" "$OUT/api/test" "$OUT/api/tmp" "$OUT/api/storage"
cp ecosystem.config.cjs "$OUT/"

cd "$OUT"
ln -sfn "$APP_DIR/shared/.env" .env
set -a; . ./.env; set +a

# Dump the live database before any pending migration (keep the last few dumps).
cd api
if ! node_modules/.bin/prisma migrate status >/dev/null 2>&1; then
  pg_dump -Fc "$DATABASE_URL" > "$APP_DIR/backups/db-$RELEASE.dump"
  ls -1t "$APP_DIR/backups/"*.dump | tail -n +$((KEEP_DUMPS + 1)) | xargs -r rm --
fi
node_modules/.bin/prisma migrate deploy

PREVIOUS="$(readlink "$APP_DIR/current" || true)"
echo "$PREVIOUS" > "$APP_DIR/previous-release"
start() {
  ln -sfn "$1" "$APP_DIR/current.tmp" && mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
  # Delete + start (not reload): PM2 keeps the resolved release path, so a reload would run the old code.
  cd "$APP_DIR/current"
  pm2 delete ecosystem.config.cjs >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs >/dev/null
  pm2 save >/dev/null
}
start "$OUT"
if [ "$SEED" = 1 ]; then
  [ "${DEMO_MODE:-}" = true ] || { echo "✗ --seed is only allowed when DEMO_MODE=true" >&2; exit 1; }
  (cd "$APP_DIR/current/api" && node --env-file=../.env dist/demo/seed-cli.js)
fi

# The API needs a few seconds to boot. Wait up to 60 s, checking the server's own ports.
web=000; health=000
for _ in $(seq 1 30); do
  sleep 2
  web=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" || true)
  health=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/health" || true)
  [ "$web" = "200" ] && [ "$health" = "200" ] && break
done
if [ "$web" != "200" ] || [ "$health" != "200" ]; then
  echo "✗ Check failed (web $web, health $health)"
  if [ -n "$PREVIOUS" ]; then echo "  rolling back to $PREVIOUS"; start "$PREVIOUS"; fi
  exit 1
fi
echo "  server check: web $web, health $health"

# Old releases (never the current or previous one).
ls -1dt "$APP_DIR/releases/"*/ | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf --
REMOTE_SCRIPT

echo "▸ Checking https://$DOMAIN"
web=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "https://$DOMAIN/" || true)
health=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "https://$DOMAIN/api/health" || true)
if [ "$web" = "200" ] && [ "$health" = "200" ]; then
  echo "✓ Deployed $RELEASE: https://$DOMAIN is up (web $web, health $health)"
else
  echo "! Deployed $RELEASE and the server is healthy, but https://$DOMAIN answered web $web, health $health (DNS or TLS not pointing here yet?)"
fi
