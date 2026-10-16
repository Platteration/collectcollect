#!/usr/bin/env bash
# One-command install for CollectCollect, for one owner on one machine.
#
#   ./scripts/install.sh                  # the card app, reachable from this computer only
#   ./scripts/install.sh cards skins      # the apps you name
#   ./scripts/install.sh --all            # all six
#   ./scripts/install.sh --all --lan      # all six, and reachable from a phone on your Wi-Fi
#
# Apps: cards, skins, retro-games, comics, watches, whisky (ports 3000 to 3005).
#
# Linux, macOS, WSL and Git Bash. It checks Docker with Compose, creates .env
# with a generated password and a 64-hex secret for every app, builds and
# starts the apps you chose, and waits for each to answer its health route.
#
# Safe to re-run: an existing .env is never changed. It says which of the
# chosen apps have no password in it, and with --lan refuses to publish one.
#
# --lan writes compose.override.yaml, which publishes the chosen apps on every
# network interface of this computer instead of on localhost, and prints the
# addresses to open on the phone. It is plain http: see docs/SELF_HOSTING.md,
# "Phone access". A run without --lan removes a compose.override.yaml this
# script wrote, so the apps are back on localhost only.
set -euo pipefail

# Everything this script creates (.env above all) is for its owner alone, from
# the first byte written.
umask 077

cd "$(dirname "$0")/.."

ALL_APPS="cards skins retro-games comics watches whisky"
# How long to wait for the apps to answer, and between asks. The environment can
# shorten them (the tests do); nothing in a normal install needs to.
HEALTH_TIMEOUT="${INSTALL_HEALTH_TIMEOUT:-180}"
HEALTH_INTERVAL="${INSTALL_HEALTH_INTERVAL:-2}"
OVERRIDE_MARK="# Written by the CollectCollect installer (scripts/install.sh --lan or scripts/install.ps1 -Lan)"

fail() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./scripts/install.sh [--all] [--lan] [app ...]

  app     cards (the default), skins, retro-games, comics, watches, whisky
  --all   every app
  --lan   publish the chosen apps on your network (compose.override.yaml), for
          a phone on the same Wi-Fi; plain http, and only for apps with a password
  --help  this text
EOF
}

# --- Arguments -----------------------------------------------------------------
want_all=0
want_lan=0
named=""
for arg in "$@"; do
  case "$arg" in
    -h | --help)
      usage
      exit 0
      ;;
    --all) want_all=1 ;;
    --lan) want_lan=1 ;;
    -*) fail "unknown option '$arg'. $(usage | head -n 1)" ;;
    *)
      case " $ALL_APPS " in
        *" $arg "*) named="$named $arg" ;;
        *) fail "unknown app '$arg'. The apps are: $ALL_APPS." ;;
      esac
      ;;
  esac
done

# The chosen apps, once each, in the order above. Cards when nothing is named.
SELECTED=""
for app in $ALL_APPS; do
  if [ "$want_all" -eq 1 ]; then
    SELECTED="$SELECTED $app"
  else
    case " $named " in *" $app "*) SELECTED="$SELECTED $app" ;; esac
  fi
done
[ -n "$SELECTED" ] || SELECTED=" cards"
SELECTED="${SELECTED# }"

# --- What each app is ----------------------------------------------------------
app_port() {
  case "$1" in
    cards) echo 3000 ;;
    skins) echo 3001 ;;
    retro-games) echo 3002 ;;
    comics) echo 3003 ;;
    watches) echo 3004 ;;
    whisky) echo 3005 ;;
  esac
}

# The prefix of the app's variables: APP_PASSWORD for cards, SKINS_APP_PASSWORD for skins.
app_prefix() {
  case "$1" in
    cards) echo "" ;;
    skins) echo "SKINS_" ;;
    retro-games) echo "RETRO_GAMES_" ;;
    comics) echo "COMICS_" ;;
    watches) echo "WATCHES_" ;;
    whisky) echo "WHISKY_" ;;
  esac
}

password_var() { echo "$(app_prefix "$1")APP_PASSWORD"; }
secret_var() { echo "$(app_prefix "$1")APP_SECRET"; }

# --- Helpers ---------------------------------------------------------------------
# Temporary files holding secrets, removed however the script ends: a finished
# write, an error, Ctrl-C, a closed terminal.
TEMP_FILES=""
cleanup() {
  local file
  for file in $TEMP_FILES; do rm -f "$file"; done
  return 0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# Makes a private temporary file beside the real one and names it in MADE, not
# on stdout: a command substitution would forget it in the subshell.
MADE=""
make_temp() {
  MADE="$(mktemp "./.$1.tmp.XXXXXX")"
  TEMP_FILES="$TEMP_FILES $MADE"
}

forget_temp() {
  local file kept=""
  for file in $TEMP_FILES; do [ "$file" = "$1" ] || kept="$kept $file"; done
  TEMP_FILES="$kept"
}

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

# Succeed when the URL answers with a 2xx. Both tools are held to a few
# seconds, so one connection that hangs cannot stretch the wait below.
answers() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --connect-timeout 2 --max-time 5 -o /dev/null "$1" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    # GNU wget tries twenty times by default; BusyBox's has no such option.
    if wget --help 2>&1 | grep -q -- '--tries'; then
      wget -q -T 5 --tries=1 -O /dev/null "$1" >/dev/null 2>&1
    else
      wget -q -T 5 -O /dev/null "$1" >/dev/null 2>&1
    fi
  else
    fail "curl or wget is required to check $1. Install curl and re-run, or check the URL in your browser."
  fi
}

# The value of the last uncommented NAME=value line of a file (default .env),
# without quotes or a trailing comment; empty when there is none. The file is
# read, never sourced: it is text the owner edited.
env_value() {
  local file="${2:-.env}"
  [ -f "$file" ] || return 0
  awk -v name="$1" -v sq="'" '
    { sub(/\r$/, "") }
    $0 ~ ("^[ \t]*(export[ \t]+)?" name "[ \t]*=") {
      v = $0
      sub(/^[^=]*=/, "", v)
      t = v
      sub(/^[ \t]+/, "", t)
      if (t ~ /^".*"[ \t]*$/ || t ~ ("^" sq ".*" sq "[ \t]*$")) {
        sub(/[ \t]+$/, "", t)
        v = substr(t, 2, length(t) - 2)
      } else {
        # A comment starts at a blank followed by #, as Compose reads it.
        sub(/[ \t]+#.*$/, "", v)
        sub(/^[ \t]+/, "", v)
        sub(/[ \t]+$/, "", v)
      }
      found = v
    }
    END { print found }
  ' "$file"
}

# Whether the app asks for a login: a password, or any of its Google sign-in
# variables, which turn the gate on by themselves (README, "Sign in with Google").
app_is_gated() {
  local prefix var
  [ -n "$(env_value "$(password_var "$1")")" ] && return 0
  case "$1" in
    cards | skins)
      prefix="$(app_prefix "$1")"
      for var in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_ALLOWED_SUBS GOOGLE_ALLOWED_EMAILS; do
        [ -n "$(env_value "${prefix}${var}")" ] && return 0
      done
      ;;
  esac
  return 1
}

# --- 1. Docker with Compose must be available ------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker was not found on PATH. Install Docker (with Compose) from https://docs.docker.com/get-docker/ and re-run this script."
fi
if ! docker compose version >/dev/null 2>&1; then
  fail "'docker compose' is not available. Install a current Docker with the Compose plugin (or update Docker Desktop / docker-compose-plugin) and re-run this script."
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but the daemon is not reachable. Start Docker Desktop (or the docker service) and re-run this script."
fi

echo "Installing: $SELECTED"

# --- 2. Create .env if needed -------------------------------------------------------
GENERATED=""
generated_value() {
  local pair
  for pair in $GENERATED; do
    case "$pair" in "$1="*)
      printf '%s' "${pair#*=}"
      return 0
      ;;
    esac
  done
}

write_new_env() {
  local app tmp password secret
  [ -f .env.example ] || fail ".env.example not found. Run this script from a complete checkout of the repository."

  # A password and a secret for every app, whichever are started now, so that
  # starting another later never finds it open.
  for app in $ALL_APPS; do
    password="$(gen_password)"
    secret="$(gen_hex_32)"
    [[ "$password" =~ ^[0-9a-f]{24}$ ]] || fail "failed to generate $(password_var "$app")."
    [[ "$secret" =~ ^[0-9a-f]{64}$ ]] || fail "failed to generate $(secret_var "$app") (expected 64 hex characters)."
    GENERATED="$GENERATED $(password_var "$app")=$password $(secret_var "$app")=$secret"
  done

  # What an interrupted earlier run left behind: temporary copies, never a .env.
  rm -f ./.env.tmp.*

  # Written beside .env and moved onto it only when complete: .env is never
  # there half made, with or without a password in it.
  make_temp env
  tmp="$MADE"
  if ! CC_GENERATED="$GENERATED" awk '
    BEGIN {
      n = split(ENVIRON["CC_GENERATED"], pair, " ")
      for (i = 1; i <= n; i++) {
        eq = index(pair[i], "=")
        want[substr(pair[i], 1, eq - 1)] = substr(pair[i], eq + 1)
      }
    }
    {
      sub(/\r$/, "")
      if (match($0, /^#?[ \t]*[A-Z][A-Z0-9_]*=/)) {
        key = $0
        sub(/^#?[ \t]*/, "", key)
        sub(/=.*$/, "", key)
        if ((key in want) && !(key in done)) {
          print key "=" want[key]
          done[key] = 1
          next
        }
      }
      print
    }
    END { for (key in want) if (!(key in done)) print key "=" want[key] }
  ' .env.example >"$tmp"; then
    fail "could not prepare .env from .env.example. No .env was written; run this script again."
  fi

  # Read back what was written before it becomes .env.
  for app in $ALL_APPS; do
    [ "$(env_value "$(password_var "$app")" "$tmp")" = "$(generated_value "$(password_var "$app")")" ] || fail "could not write $(password_var "$app") to .env; nothing was changed."
    [ "$(env_value "$(secret_var "$app")" "$tmp")" = "$(generated_value "$(secret_var "$app")")" ] || fail "could not write $(secret_var "$app") to .env; nothing was changed."
  done

  [ ! -e .env ] || fail ".env appeared while this script was running; it was not changed."
  mv "$tmp" .env
  forget_temp "$tmp"
  chmod 600 .env 2>/dev/null || true
}

missing=""
if [ -f .env ]; then
  echo ".env already exists - not changed. Checking the chosen apps for a password:"
  for app in $SELECTED; do
    if app_is_gated "$app"; then
      echo "  $app: asks for a login ($(password_var "$app") in .env)."
    else
      echo "  $app: NO PASSWORD - $(password_var "$app") is empty or missing in .env."
      missing="$missing $app"
    fi
  done
  if [ -n "$missing" ]; then
    echo "  Without one, anyone who can reach the app can read and change the collection."
    echo "  To add one, put a line like this in .env (a value of your own does as well), then run this script again:"
    for app in $missing; do echo "    $(password_var "$app")=$(gen_password)"; done
  fi
else
  echo "Creating .env from .env.example with a generated password and secret for every app..."
  write_new_env
  echo "Created .env (readable by you only), at $(pwd)/.env. Your passwords:"
  for app in $SELECTED; do
    echo "  $app: $(generated_value "$(password_var "$app")")   ($(password_var "$app") in .env)"
  done
  echo "  The other apps have passwords in .env too. API-key lines are left blank; add them later if you want those features."
fi

# --- 3. Publish on the network, only when asked and only with a password ------------
OVERRIDE=compose.override.yaml
override_is_ours() {
  [ -f "$OVERRIDE" ] && [ "$(head -n 1 "$OVERRIDE")" = "$OVERRIDE_MARK" ]
}

# Compose reading compose.yaml, .env and the override as they are now; its own
# message when it cannot.
compose_reads() {
  local out
  if out="$(docker compose config -q 2>&1)"; then return 0; fi
  echo "$out" >&2
  return 1
}

LAN_ON=0
if [ "$want_lan" -eq 1 ]; then
  if [ -n "$missing" ]; then
    {
      echo "error: not publishing on your network: no password for${missing}."
      echo "Add one for each to .env (above) and run this script again. Nothing was started."
    } >&2
    exit 1
  fi
  if [ -e "$OVERRIDE" ] && ! override_is_ours; then
    fail "$OVERRIDE exists and was not written by this script, so it was left alone. Move it away, or add the ports of the chosen apps to it yourself (docs/SELF_HOSTING.md, \"Phone access\")."
  fi
  compose_reads || fail "docker compose cannot read compose.yaml and .env as they are. Nothing was started."
  make_temp compose-override
  tmp="$MADE"
  {
    echo "$OVERRIDE_MARK"
    echo "# Publishes these apps on every network interface of this computer, not only on"
    echo "# localhost, so a phone on the same Wi-Fi can reach them over plain http."
    echo "# Delete this file, then run: docker compose up -d   to put them back on localhost."
    echo "# '!override' needs Docker Compose 2.24 or newer."
    echo "services:"
    for app in $SELECTED; do
      echo "  $app:"
      echo "    ports: !override"
      echo "      - \"$(app_port "$app"):3000\""
    done
  } >"$tmp"
  mv "$tmp" "$OVERRIDE"
  forget_temp "$tmp"
  LAN_ON=1
  if ! compose_reads; then
    rm -f "$OVERRIDE"
    fail "docker compose could not read the network settings this script wrote (it needs Docker Compose 2.24 or newer for '!override'). compose.override.yaml was removed and nothing was started."
  fi
else
  if override_is_ours; then
    rm -f "$OVERRIDE"
    echo "Removed compose.override.yaml, which an earlier run with --lan wrote: the apps started now are on this computer only. Add --lan to publish them on your network."
    echo "An app that is already running keeps the ports it was started with until it is started again."
  elif [ -e "$OVERRIDE" ]; then
    echo "Note: $OVERRIDE is in effect and was not written by this script; whatever ports it publishes stay published."
  fi
  compose_reads || fail "docker compose cannot read compose.yaml, .env and $OVERRIDE as they are. Nothing was started."
fi

# --- 4. Build and start ----------------------------------------------------------
echo "Building and starting: $SELECTED (docker compose up -d --build) ..."
# shellcheck disable=SC2086  # SELECTED is a list of service names
if ! docker compose up -d --build $SELECTED; then
  {
    echo
    echo "error: docker compose could not build or start: $SELECTED."
    echo "The output above says why."
    echo "Nothing is lost: .env was written and is kept at $(pwd)/.env, with the password for each app"
    for app in $SELECTED; do echo "  $(password_var "$app")   ($app)"; done
    echo "Fix the problem and run this script again; it does not change .env. docs/SELF_HOSTING.md has more."
  } >&2
  exit 1
fi

# --- 5. Wait for health ----------------------------------------------------------
pending="$SELECTED"
echo "Waiting for the apps to answer (up to ${HEALTH_TIMEOUT}s) ..."
started=$SECONDS
while [ -n "$pending" ]; do
  still=""
  for app in $pending; do
    answers "http://127.0.0.1:$(app_port "$app")/api/health" || still="$still $app"
  done
  pending="${still# }"
  [ -n "$pending" ] || break
  if [ $((SECONDS - started)) -ge "$HEALTH_TIMEOUT" ]; then
    {
      echo "error: not healthy within ${HEALTH_TIMEOUT} seconds: $pending."
      for app in $pending; do echo "Check the logs with:  docker compose logs -f $app"; done
      echo "The passwords are in $(pwd)/.env. Then try again, or see docs/SELF_HOSTING.md for help."
    } >&2
    exit 1
  fi
  sleep "$HEALTH_INTERVAL"
done

# --- The addresses to open -------------------------------------------------------
# Private IPv4 addresses of this computer, the one a phone would use first.
is_private() {
  local second
  case "$1" in
    10.* | 192.168.*) return 0 ;;
    172.*)
      second="${1#172.}"
      second="${second%%.*}"
      [[ "$second" =~ ^[0-9]+$ ]] && [ "$second" -ge 16 ] && [ "$second" -le 31 ]
      return
      ;;
  esac
  return 1
}

lan_addresses() {
  local candidates="" address iface
  if command -v powershell.exe >/dev/null 2>&1; then
    # Git Bash, or WSL beside Docker Desktop: the Windows computer's own address.
    # shellcheck disable=SC2016  # PowerShell's own $_, not ours
    candidates="$(powershell.exe -NoProfile -NonInteractive -Command 'Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address.IPAddress }' 2>/dev/null | tr -d '\r' || true)"
  fi
  if [ -z "$candidates" ] && command -v ip >/dev/null 2>&1; then
    candidates="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1) }' || true)"
  fi
  if [ -z "$candidates" ] && command -v route >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
    iface="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }' || true)"
    [ -z "$iface" ] || candidates="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  fi
  if [ -z "$candidates" ] && command -v hostname >/dev/null 2>&1; then
    candidates="$(hostname -I 2>/dev/null | tr ' ' '\n' || true)"
  fi
  for address in $candidates; do
    # The default bridge Docker makes is not on the Wi-Fi.
    case "$address" in 172.17.0.1) continue ;; esac
    if is_private "$address"; then echo "$address"; fi
  done
}

echo
echo "CollectCollect is running."
for app in $SELECTED; do
  echo "  $app: http://localhost:$(app_port "$app")"
done
if [ -n "$GENERATED" ]; then
  echo "Passwords (also in .env, readable by you only; keep it private and back it up):"
  for app in $SELECTED; do
    echo "  $app: $(generated_value "$(password_var "$app")")"
  done
else
  echo "Sign in with the passwords in .env (grep _PASSWORD= .env); it was not changed."
  [ -z "$missing" ] || echo "No password is set for:${missing}; those apps let in anyone who can reach them."
fi
echo "To change a password later, edit .env, then run: docker compose up -d --force-recreate <app>"

if [ "$LAN_ON" -eq 1 ]; then
  addresses="$(lan_addresses)"
  first="$(printf '%s\n' "$addresses" | head -n 1)"
  echo
  echo "Open these on a phone on the same Wi-Fi:"
  for app in $SELECTED; do
    echo "  $app: http://${first:-<this-computer-ip>}:$(app_port "$app")"
  done
  if [ -z "$first" ]; then
    echo "  This computer's address on your Wi-Fi was not found; ip addr (Linux), ifconfig (macOS) or ipconfig (Windows) shows it."
  elif [ "$(printf '%s\n' "$addresses" | wc -l)" -gt 1 ]; then
    echo "  This computer has other addresses too ($(printf '%s\n' "$addresses" | awk 'NR > 1 { printf "%s%s", (NR > 2 ? ", " : ""), $0 }')); use the one on the phone's network."
  fi
  echo "These addresses are plain http, so on the phone Chrome will not install an app to the home screen,"
  echo "keep it working offline, or open the live camera in cards' Scan. Those need https, or the phone"
  echo "reaching this computer as localhost (docs/SELF_HOSTING.md, \"Phone access\")."
  echo "If the phone cannot connect, this computer's firewall may block ports 3000 to 3005, or the Wi-Fi may"
  echo "keep devices apart (guest networks often do)."
  hosts="$(env_value ALLOWED_HOSTS)"
  if [ -n "$hosts" ] && [ "$hosts" != "*" ] && [ -n "$first" ]; then
    case ",$hosts," in
      *",$first,"*) ;;
      *) echo "Warning: ALLOWED_HOSTS in .env is '$hosts', which does not list $first, so the apps will refuse the phone. Add it." ;;
    esac
  fi
  if [ "$(env_value COOKIE_SECURE)" = "1" ]; then
    echo "Warning: COOKIE_SECURE=1 in .env makes every address https, so saving anything from the phone's plain-http address is refused."
  fi
fi

echo
echo "Next steps:"
echo "  1. Open the address above and sign in."
echo "  2. In an app, open Settings and run the provider connection tests (guided checks)"
echo "     to verify any API keys or providers you add to .env."
echo "  3. Add optional keys to .env (for example ANTHROPIC_API_KEY for photo identification),"
echo "     then apply them with: docker compose up -d --force-recreate <app>"
echo "  4. See docs/SELF_HOSTING.md for phone access, remote access, backup and updates."
