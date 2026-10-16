#!/usr/bin/env bash
# One-command first install for CollectCollect (cards app).
#
#   ./scripts/install.sh          # Linux / macOS / WSL / Git Bash
#
# Checks Docker with Compose, creates .env with generated secrets if needed,
# builds and starts the cards service, and waits for its health endpoint.
# Safe to re-run: an existing .env is never overwritten.
set -euo pipefail

cd "$(dirname "$0")/.."

HEALTH_URL="http://127.0.0.1:3000/api/health"
APP_URL="http://localhost:3000"
HEALTH_ATTEMPTS=60
HEALTH_INTERVAL=2

fail() {
  echo "error: $*" >&2
  exit 1
}

# --- 1. Docker with Compose must be available -------------------------------
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker was not found on PATH. Install Docker (with Compose) from https://docs.docker.com/get-docker/ and re-run this script."
fi
if ! docker compose version >/dev/null 2>&1; then
  fail "'docker compose' is not available. Install a current Docker with the Compose plugin (or update Docker Desktop / docker-compose-plugin) and re-run this script."
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but the daemon is not reachable. Start Docker Desktop (or the docker service) and re-run this script."
fi

# --- Helpers -----------------------------------------------------------------
# Print 64 lowercase hex characters (32 bytes) from a CSPRNG.
gen_hex_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    echo
  else
    fail "no secure random source found (need openssl or /dev/urandom) to generate secrets."
  fi
}

# Print a generated login password (24 hex characters from a CSPRNG).
gen_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 12
  elif [ -r /dev/urandom ]; then
    head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n'
    echo
  else
    fail "no secure random source found (need openssl or /dev/urandom) to generate a password."
  fi
}

health_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$HEALTH_URL" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null "$HEALTH_URL" >/dev/null 2>&1
  else
    fail "curl or wget is required to check $HEALTH_URL. Install curl and re-run, or check the URL in your browser."
  fi
}

# --- 2. Create .env if needed ------------------------------------------------
GENERATED_PASSWORD=""

if [ -f .env ]; then
  echo ".env already exists - leaving it untouched and continuing."
else
  [ -f .env.example ] || fail ".env.example not found. Run this script from a complete checkout of the repository."
  echo "Creating .env from .env.example with generated secrets..."
  APP_SECRET="$(gen_hex_32)"
  SKINS_APP_SECRET="$(gen_hex_32)"
  GENERATED_PASSWORD="$(gen_password)"

  case "$APP_SECRET" in *[!0-9a-f]* | "") fail "failed to generate APP_SECRET." ;; esac
  [ "${#APP_SECRET}" -eq 64 ] || fail "failed to generate APP_SECRET (expected 64 hex characters)."
  case "$SKINS_APP_SECRET" in *[!0-9a-f]* | "") fail "failed to generate SKINS_APP_SECRET." ;; esac
  [ "${#SKINS_APP_SECRET}" -eq 64 ] || fail "failed to generate SKINS_APP_SECRET (expected 64 hex characters)."
  [ -n "$GENERATED_PASSWORD" ] || fail "failed to generate APP_PASSWORD."

  cp .env.example .env

  tmp_env="$(mktemp ./.env.tmp.XXXXXX)"
  trap 'rm -f "$tmp_env"' EXIT
  awk \
    -v app_secret="$APP_SECRET" \
    -v skins_secret="$SKINS_APP_SECRET" \
    -v app_password="$GENERATED_PASSWORD" '
    /^#?[[:space:]]*APP_PASSWORD=/     { print "APP_PASSWORD=" app_password; next }
    /^#?[[:space:]]*APP_SECRET=/       { print "APP_SECRET=" app_secret; next }
    /^#?[[:space:]]*SKINS_APP_SECRET=/ { print "SKINS_APP_SECRET=" skins_secret; next }
    { print }
  ' .env >"$tmp_env"
  cat "$tmp_env" >.env
  rm -f "$tmp_env"
  trap - EXIT

  chmod 600 .env 2>/dev/null || true
  echo "Created .env (API-key lines left blank - add them later if you want those features)."
fi

# --- 3. Build and start ------------------------------------------------------
echo "Building and starting the cards app (docker compose up -d --build cards)..."
docker compose up -d --build cards

# --- 4. Wait for health ------------------------------------------------------
echo "Waiting for $HEALTH_URL ..."
healthy=0
attempt=1
while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
  if health_ok; then
    healthy=1
    break
  fi
  sleep "$HEALTH_INTERVAL"
  attempt=$((attempt + 1))
done

if [ "$healthy" -ne 1 ]; then
  echo "error: the app did not become healthy within $((HEALTH_ATTEMPTS * HEALTH_INTERVAL)) seconds." >&2
  echo "Check the logs with:  docker compose logs -f cards" >&2
  echo "Then try again, or see docs/SELF_HOSTING.md for help." >&2
  exit 1
fi

# --- Next steps ---------------------------------------------------------------
echo
echo "CollectCollect is running."
echo "  Open: $APP_URL"
if [ -n "$GENERATED_PASSWORD" ]; then
  echo "  Generated login password (shown once - it is stored as APP_PASSWORD in .env): $GENERATED_PASSWORD"
  echo "  Warning: keep .env private and back it up somewhere safe; anyone with that password can sign in."
  echo "  You can change APP_PASSWORD in .env later, then run: docker compose up -d --force-recreate cards"
else
  echo "  Sign in with the APP_PASSWORD already in your existing .env (it was not changed)."
fi
echo
echo "Next steps:"
echo "  1. Open $APP_URL and sign in."
echo "  2. In the app, open Settings and run the provider connection tests (guided checks)"
echo "     to verify any API keys or providers you add to .env."
echo "  3. Add optional keys to .env (for example ANTHROPIC_API_KEY for photo identification),"
echo "     then apply them with: docker compose up -d --force-recreate cards"
echo "  4. See docs/SELF_HOSTING.md for remote access, backup, and running the skins app."