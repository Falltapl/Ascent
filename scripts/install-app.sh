#!/usr/bin/env bash
# Builds ~/Applications/Ascent.app — a launcher bundle that starts the local
# server on demand and opens the UI in its own window.
#
# Deliberately not Electron: the app is already a local web server, so wrapping
# a whole Chromium runtime would add ~150MB to ship a window that the browser
# already provides. This is a few KB and uses whatever browser is installed.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="$PWD"
APP="$HOME/Applications/Ascent.app"

command -v node >/dev/null || { echo "Node not found. Add ~/.local/node/bin to PATH."; exit 1; }

echo "→ generating icons"
node scripts/make-icons.mjs

echo "→ building icns"
ICONSET=$(mktemp -d)/Ascent.iconset
mkdir -p "$ICONSET"
while read -r size name; do
  sips -z "$size" "$size" public/icon-512.png --out "$ICONSET/$name.png" >/dev/null 2>&1
done <<SIZES
16 icon_16x16
32 icon_16x16@2x
32 icon_32x32
64 icon_32x32@2x
128 icon_128x128
256 icon_128x128@2x
256 icon_256x256
512 icon_256x256@2x
512 icon_512x512
1024 icon_512x512@2x
SIZES

echo "→ building the production bundle"
npm run build >/dev/null

echo "→ assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Ascent</string>
  <key>CFBundleDisplayName</key><string>Ascent</string>
  <key>CFBundleIdentifier</key><string>com.hunternguyen.ascent</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Ascent</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/Ascent" <<LAUNCHER
#!/bin/bash
PROJECT="$PROJECT"
LAUNCHER
cat >> "$APP/Contents/MacOS/Ascent" <<'LAUNCHER'
PORT=8787
URL="http://localhost:$PORT"
LOG="$HOME/Library/Logs/Ascent.log"
export PATH="$HOME/.local/node/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$(dirname "$LOG")"
note() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
fail() {
  note "ERROR: $1"
  osascript -e "display alert \"Ascent couldn't start\" message \"$1\" as critical" >/dev/null 2>&1
  exit 1
}

[ -d "$PROJECT" ] || fail "Project folder not found at $PROJECT"
command -v node >/dev/null || fail "Node not found in ~/.local/node/bin"

# Reuse a server that's already listening rather than starting a second one.
if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  note "starting server"
  [ -f "$PROJECT/dist/index.html" ] || (cd "$PROJECT" && npm run build >> "$LOG" 2>&1) || fail "Build failed"
  (cd "$PROJECT" && nohup npm start >> "$LOG" 2>&1 &)
  for i in $(seq 1 40); do
    nc -z 127.0.0.1 "$PORT" 2>/dev/null && break
    sleep 0.5
  done
  nc -z 127.0.0.1 "$PORT" 2>/dev/null || fail "Server did not start within 20 seconds"
  note "server up"
else
  note "server already running"
fi

# A Chrome --app window has no tabs or address bar, so it reads as an app.
CHROME="/Applications/Google Chrome.app"
if [ -d "$CHROME" ]; then
  open -na "$CHROME" --args --app="$URL" --user-data-dir="$HOME/Library/Application Support/Ascent/chrome"
else
  open "$URL"
fi
LAUNCHER

chmod +x "$APP/Contents/MacOS/Ascent"
touch "$APP"
echo
echo "Installed: $APP"
echo "Open it from Spotlight (Cmd+Space, \"Ascent\") or drag it to your Dock."
