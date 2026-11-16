# Statement Studio · macOS Application

**Statement Studio** has been packaged into a native macOS desktop application (`Statement Studio.app`) for Apple Silicon / Intel MacBooks.

---

## 🚀 How to Run the App

You can launch the app directly:
```bash
open "/Users/dixit/.gemini/antigravity/scratch/statement-studio/Statement Studio.app"
```

### Install to Applications (Recommended)
To make it appear in Launchpad, Spotlight, and your Applications folder, copy it:
```bash
cp -R "/Users/dixit/.gemini/antigravity/scratch/statement-studio/Statement Studio.app" /Applications/
```

Or open the folder in Finder and drag `Statement Studio.app` into `/Applications`:
```bash
open "/Users/dixit/.gemini/antigravity/scratch/statement-studio"
```

---

## 🌟 Key Features of the Native App

1. **Native Performance & Lightweight Footprint**:
   - Built with native Swift and WebKit (`WKWebView`).
   - Uses zero bulky dependencies (no heavy Electron runtime). Instant launch times and low memory footprint.
2. **100% Offline & Private**:
   - The entire 42MB engine (PDF processing, OCR, SheetJS, ONNX runtime) runs strictly locally inside the app bundle with offline file permissions.
3. **Seamless File Uploads & Drag-and-Drop**:
   - Native macOS open panels for selecting statement files.
   - Direct Finder drag-and-drop onto the drop zone.
4. **Native Export / Download Handling**:
   - Exporting statements, Excel spreadsheets, or CSV files triggers native macOS Save sheets (`NSSavePanel`) so you can choose where to save files.
5. **Modern Mac Glass Window & Menu Bar**:
   - Dark titlebar matching the app's dark glass theme.
   - Standard macOS keyboard shortcuts: `Cmd+Q` (Quit), `Cmd+W` (Close), `Cmd+R` (Reload), `Cmd+0/+/-` (Zoom), `Cmd+A/C/V/Z` (Edit).
6. **Retina App Icon**:
   - Custom 1024×1024 Retina squircle application icon bundled into `AppIcon.icns`.

---

## 🛠️ Rebuilding / Updating in the Future

If you ever update the HTML tool with a newer version (e.g., `Studio_V8_13.html`), simply replace `index.html` in this directory and run:
```bash
cd /Users/dixit/.gemini/antigravity/scratch/statement-studio
./build.sh
```
