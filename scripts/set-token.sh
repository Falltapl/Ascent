#!/usr/bin/env bash
# Prompt for a secret and write it into .env without it appearing on screen,
# in shell history, or in any process list. Usage: npm run token [KEY]
#
# Known keys get a shape check before saving and, where the provider offers a
# free read-only call, a live check after. Without this, a slip at the hidden
# prompt (typing "return", pasting half a key) saves silently and only shows up
# later as a vague "key rejected" inside the app.
#
# No heredocs inside $(...): macOS ships bash 3.2, which mis-parses them when
# the body contains an apostrophe. The Python lives in keycheck.py instead.
set -uo pipefail
cd "$(dirname "$0")/.."
KEY="${1:-CANVAS_TOKEN}"
export ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || { [ -f .env.example ] && cp .env.example "$ENV_FILE"; } || touch "$ENV_FILE"

printf 'Paste value for %s (input hidden), then press Return:\n> ' "$KEY"
IFS= read -rs VALUE || true
echo
export KEY VALUE

SHAPE="$(python3 scripts/keycheck.py shape)"
if [ "$SHAPE" = "EMPTY" ]; then
  echo "Nothing entered. $ENV_FILE unchanged."
  exit 1
fi
if [ -n "$SHAPE" ]; then
  echo "Warning: $SHAPE"
  printf 'Save it anyway? [y/N] '
  IFS= read -r CONFIRM || CONFIRM=""
  case "$CONFIRM" in
    y|Y|yes|YES) ;;
    *) echo "Not saved. $ENV_FILE unchanged."; exit 1 ;;
  esac
fi

python3 scripts/keycheck.py save || exit 1
python3 scripts/keycheck.py verify
echo "Restart the server to pick it up:  npm run dev"
