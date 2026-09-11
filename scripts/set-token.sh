#!/usr/bin/env bash
# Prompt for a secret and write it into .env without it appearing on screen,
# in shell history, or in any process list. Usage: npm run token [KEY]
set -euo pipefail
cd "$(dirname "$0")/.."
KEY="${1:-CANVAS_TOKEN}"
[ -f .env ] || cp .env.example .env

printf 'Paste value for %s (input hidden), then press Return:\n> ' "$KEY"
IFS= read -rs VALUE
echo

if [ -z "$VALUE" ]; then echo "Nothing entered — .env unchanged."; exit 1; fi

VALUE="$VALUE" KEY="$KEY" python3 - <<'PY'
import os, re
key, val = os.environ['KEY'], os.environ['VALUE']
s = open('.env').read()
line = f'{key}={val}'
s, n = re.subn(rf'^{re.escape(key)}=.*$', lambda _: line, s, flags=re.M)
if not n:
    s = s.rstrip('\n') + '\n' + line + '\n'
open('.env', 'w').write(s)
print(f'{key} set ({len(val)} chars, ending …{val[-4:]}).')
PY

chmod 600 .env
echo "Restart the dev server to pick it up:  npm run dev"
