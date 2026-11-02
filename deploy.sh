#!/usr/bin/env bash
# Deploys Frontdesk to your own server over SSH, without Docker: builds locally from a clean copy of HEAD (never on
# the server), uploads a self-contained release, backs up and migrates the database, switches, restarts PM2, and
# rolls back if the health check fails. Works on macOS and Linux/WSL.
#
# Server details are never stored in the repository: put them in ./deploy.env (gitignored, see deploy.env.example).
# The server needs: Node.js 24 and PM2 for the app user, PostgreSQL with pgvector, Redis, a reverse proxy sending
# /api (with WebSocket upgrades) to the API and everything else to the web app, and $APP_DIR/shared/.env containing
# the production settings plus WEB_PORT and API_URL (read by ecosystem.config.cjs).
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck disable=SC1091
[ -f deploy.env ] && . ./deploy.env

: "${REMOTE:?Set REMOTE in deploy.env (see deploy.env.example)}"
: "${APP_DIR:?Set APP_DIR in deploy.env}"
: "${DOMAIN:?Set DOMAIN in deploy.env}"
: "${API_URL:?Set API_URL in deploy.env (the API address on the server)}"
export API_URL
KEEP_RELEASES=3
KEEP_DUMPS=5

# Node: nvm first, Homebrew only as a fallback.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 24 >/dev/null 2>&1 || true
elif [ -x /opt/homebrew/bin/node ]; then
  export PATH="/opt/homebrew/bin:$PATH"
elif [ -x /usr/local/bin/node ]; then
  export PATH="/usr/local/bin:$PATH"
fi
command -v pnpm >/dev/null || { echo "pnpm not found"; exit 1; }

[ -z "$(git status --porcelain)" ] || { echo "✗ Commit or stash your changes first: deploys are built from HEAD"; exit 1; }
SHA="$(git rev-parse --short HEAD)"
RELEASE="$(date -u +%Y%m%d%H%M%S)-$SHA"

# Runs a script from stdin on the server (as DEPLOY_AS when set), passing the remaining arguments to it.
remote() {
  local cmd
  cmd="bash -s -- $(printf '%q ' "$@")"
  [ -n "${DEPLOY_AS:-}" ] && cmd="su - $DEPLOY_AS -c $(printf '%q' "$cmd")"
  ssh "$REMOTE" "$cmd"
}
CHOWN=()
[ -n "${DEPLOY_AS:-}" ] && CHOWN=(--chown="$DEPLOY_AS:$DEPLOY_AS")

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "▸ Building $SHA locally from a clean copy (never on the server)"
git clone -q . "$WORK/src"
(
  cd "$WORK/src"
  pnpm install --frozen-lockfile >/dev/null
  # prisma generate reads DATABASE_URL from its config but never connects: a placeholder is enough to build.
  DATABASE_URL="postgresql://build:build@localhost:5432/build" TURBO_FORCE=true pnpm build >/dev/null
  # Next.js bakes the /api rewrite into the build: refuse to ship one that points anywhere else.
  grep -q "$API_URL" apps/web/.next/routes-manifest.json || { echo "✗ The web build doesn't proxy /api to API_URL"; exit 1; }

  OUT="$WORK/release"
  mkdir -p "$OUT/web"
  # Web: the standalone server plus its static files and public folder (incl. widget.js).
  cp -a apps/web/.next/standalone/. "$OUT/web/"
  cp -a apps/web/.next/static "$OUT/web/apps/web/.next/static"
  cp -a apps/web/public "$OUT/web/apps/web/public"
  # API + worker: production dependencies only, plus the compiled code, prompts, migrations and demo answers.
  pnpm --filter @frontdesk/api deploy --prod --legacy "$OUT/api" >/dev/null
  rm -rf "$OUT/api/src" "$OUT/api/test" "$OUT/api/tmp" "$OUT/api/storage"
  cp ecosystem.config.cjs "$OUT/"
)

echo "▸ Uploading release $RELEASE"
remote "$APP_DIR" "$RELEASE" <<'MKDIR'
set -euo pipefail
mkdir -p "$1/releases/$2" "$1/shared" "$1/backups"
MKDIR
# Unchanged files are hard-linked from the live release, so only what changed is sent.
rsync -az --delete "${CHOWN[@]}" --link-dest="$APP_DIR/current/" "$WORK/release/" "$REMOTE:$APP_DIR/releases/$RELEASE/"

echo "▸ Backing up, migrating and switching on the server"
remote "$APP_DIR" "$RELEASE" "$KEEP_RELEASES" "$KEEP_DUMPS" <<'REMOTE_SCRIPT'
set -euo pipefail
APP_DIR="$1"; RELEASE="$2"; KEEP_RELEASES="$3"; KEEP_DUMPS="$4"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
cd "$APP_DIR/releases/$RELEASE"
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
ln -sfn "$APP_DIR/releases/$RELEASE" "$APP_DIR/current.tmp" && mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
# Delete + start (not reload): PM2 keeps the resolved release path, so a reload would run the old code.
cd "$APP_DIR/current"
pm2 delete ecosystem.config.cjs >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs >/dev/null
pm2 save >/dev/null

# Old releases (never the current or previous one).
ls -1dt "$APP_DIR/releases/"*/ | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf --
REMOTE_SCRIPT

echo "▸ Checking https://$DOMAIN"
# The API needs a few seconds to boot. Wait up to 60 s.
for _ in $(seq 1 30); do
  sleep 2
  web=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/")
  health=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/health")
  [ "$web" = "200" ] && [ "$health" = "200" ] && break
done
if [ "$web" = "200" ] && [ "$health" = "200" ]; then
  echo "✓ Deployed $RELEASE: https://$DOMAIN is up (web $web, health $health)"
else
  echo "✗ Check failed (web $web, health $health): rolling back"
  remote "$APP_DIR" <<'ROLLBACK'
set -euo pipefail
APP_DIR="$1"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
PREVIOUS="$(cat "$APP_DIR/previous-release")"
[ -n "$PREVIOUS" ] || { echo "no previous release to roll back to"; exit 1; }
ln -sfn "$PREVIOUS" "$APP_DIR/current.tmp" && mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
cd "$APP_DIR/current" && { pm2 delete ecosystem.config.cjs >/dev/null 2>&1 || true; pm2 start ecosystem.config.cjs >/dev/null; pm2 save >/dev/null; }
ROLLBACK
  exit 1
fi
