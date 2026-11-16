#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$DIR/Statement Studio.app"
MACOS_DIR="$APP_DIR/Contents/MacOS"
RES_DIR="$APP_DIR/Contents/Resources"

echo "Building Statement Studio.app..."

mkdir -p "$MACOS_DIR"
mkdir -p "$RES_DIR"

# Compile Swift wrapper
swiftc -O "$DIR/main.swift" -o "$MACOS_DIR/Statement Studio"

# Copy resources
cp "$DIR/index.html" "$RES_DIR/index.html"
cp "$DIR/AppIcon.icns" "$RES_DIR/AppIcon.icns"

# Copy Info.plist and PkgInfo
cat << 'EOF' > "$APP_DIR/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Statement Studio</string>
    <key>CFBundleDisplayName</key>
    <string>Statement Studio</string>
    <key>CFBundleIdentifier</key>
    <string>com.dixitprajapati.statementstudio</string>
    <key>CFBundleVersion</key>
    <string>8.13</string>
    <key>CFBundleShortVersionString</key>
    <string>8.13</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>CFBundleExecutable</key>
    <string>Statement Studio</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSRequiresAquaSystemAppearance</key>
    <false/>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2026 Dixit Prajapati. All rights reserved.</string>
</dict>
</plist>
EOF

echo "APPL????" > "$APP_DIR/Contents/PkgInfo"

# Codesign bundle
codesign --force --deep --sign - "$APP_DIR"

# Package zip
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$DIR/Statement-Studio-8.13.zip"

echo "Done! Application ready at: $APP_DIR"
