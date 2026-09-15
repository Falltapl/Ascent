"""Helpers for scripts/set-token.sh. Values arrive via environment variables,
never argv, so a secret never appears in the process list.

  keycheck.py shape   -> prints a warning if VALUE doesn't look like KEY; silent if fine
  keycheck.py save    -> writes KEY=VALUE into ENV_FILE
  keycheck.py verify  -> read-only live check against the provider, where one exists
"""
import os, re, sys, urllib.request, urllib.error

key = os.environ["KEY"]
val = os.environ["VALUE"].strip().strip("\"'").strip()
env_file = os.environ.get("ENV_FILE", ".env")

RULES = {
    # Google moved AI Studio to "Auth keys" (AQ.) in 2026; legacy AIza keys are being
    # retired but still accepted here, since the live check reports the real verdict.
    "GEMINI_API_KEY":      (r"^(AQ\.[0-9A-Za-z_.-]{30,}|AIza[0-9A-Za-z_-]{35})$", 'Gemini keys start with "AQ." (older keys start with "AIza"). Get one at aistudio.google.com/apikey'),
    "ANTHROPIC_API_KEY":   (r"^sk-ant-[0-9A-Za-z_-]{20,}$", 'Anthropic keys start with "sk-ant-" (console.anthropic.com)'),
    "GMAIL_CLIENT_ID":     (r"^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$", 'Client IDs end in ".apps.googleusercontent.com"'),
    "GMAIL_CLIENT_SECRET": (r"^GOCSPX-[0-9A-Za-z_-]{20,}$", 'Client secrets start with "GOCSPX-"'),
    "CANVAS_TOKEN":        (r"^[0-9]+~[0-9A-Za-z]{40,}$", 'Canvas tokens look like a number, "~", then a long string'),
}

CHECKS = {
    "GEMINI_API_KEY":    ("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {"x-goog-api-key": val}),
    "ANTHROPIC_API_KEY": ("https://api.anthropic.com/v1/models?limit=1", {"x-api-key": val, "anthropic-version": "2023-06-01"}),
}

cmd = sys.argv[1] if len(sys.argv) > 1 else ""

if cmd == "shape":
    if not val:
        print("EMPTY")
    elif key in RULES and not re.match(RULES[key][0], val):
        print(f'That does not look like a {key}: got {len(val)} characters starting "{val[:4]}". {RULES[key][1]}.')

elif cmd == "save":
    text = open(env_file).read() if os.path.exists(env_file) else ""
    line = f"{key}={val}"
    text, n = re.subn(rf"^{re.escape(key)}=.*$", lambda _: line, text, flags=re.M)
    if not n:
        text = text.rstrip("\n") + ("\n" if text else "") + line + "\n"
    with open(env_file, "w") as f:
        f.write(text)
    os.chmod(env_file, 0o600)
    print(f"{key} set ({len(val)} chars, ending ...{val[-4:]}).")

elif cmd == "verify":
    if key not in CHECKS:
        sys.exit(0)
    url, headers = CHECKS[key]
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as r:
            print(f"OK: verified with the provider (HTTP {r.status}), the key works.")
    except urllib.error.HTTPError as e:
        print(f"REJECTED: the provider refused this key (HTTP {e.code}). Check you copied the whole key.")
        sys.exit(3)
    except Exception as e:
        print(f"UNVERIFIED: could not reach the provider ({e.__class__.__name__}); saved anyway.")

else:
    sys.exit(f"unknown command: {cmd!r}")
