# Statement Studio V8.13: handoff for building a Windows .exe

## What this is
Statement Studio is an offline, single-file web app: one HTML file (~43 MB) that converts bank
statements (PDF, scanned PDF, CSV/Excel, QBO/OFX) into QuickBooks `.qbo` and Excel. Everything
runs locally in the page: no server, no network calls. The goal is to wrap it as a Windows desktop
app (`.exe`) **without changing how it works**.

## Files
| Path | What it is |
|---|---|
| `Studio_V8_13.html` | **The finished app.** This is the file to package. |
| `Studio_V8_12_original.html` | Untouched previous version, the input to the build. |
| `build/build.mjs` | Builds V8.13 from V8.12: applies small exact-text patches (it stops if an anchor isn't found exactly once) and injects the files below. |
| `build/theme-pro.css` | Professional neutral theme (overrides the original styles). |
| `build/ssx.js`, `build/ssx.css` | V8.13 features: bank directory, payee cleanup, saved CSV layouts, "show on PDF". |
| `build/prep-banks.mjs` | Converts Intuit's institution list into `data/banks.json`. |
| `data/intuit_fidir_qm2400.txt` | Intuit's public institution list (source data). |
| `data/banks.json` | Compact bank list embedded into the app. |
| `test/make-test-files.mjs` | Makes a fake test PDF and CSV in `test/files/`. |
| `test/serve.mjs` | Tiny local static server for testing (`http://127.0.0.1:8137`). |

### Rebuilding the HTML (Node.js 22+)
```
node build/prep-banks.mjs data/intuit_fidir_qm2400.txt data/banks.json   # only if the bank list changes
node build/build.mjs Studio_V8_12_original.html Studio_V8_13.html
```
To change features or styling, edit the files in `build/` and rebuild. Don't hand-edit
`Studio_V8_13.html`: it's generated, and the build would overwrite the edits.

## Packaging as an .exe: requirements
1. **Load `Studio_V8_13.html` as-is** in a Chromium-based window. It uses WebAssembly
   (Tesseract, ONNX Runtime), Web Workers built from Blob URLs, `localStorage`, the View
   Transitions API, `DataTransfer` and file inputs. Electron, or Tauri on WebView2, both support these.
2. **Stay fully offline.** Don't add analytics, auto-update calls, CDN fonts or remote scripts. The
   app's promise is "nothing leaves this computer".
3. **Keep `localStorage` persistent** between launches. The app stores learned bank formats, payee
   rules, saved CSV layouts, bank picks and conversion history there. Use a fixed app identity
   (Electron: fixed `app.setName` / `userData` path; Tauri: fixed `identifier`) so the data isn't lost.
4. **Downloads must work.** The app saves `.qbo`, `.xlsx`, `.csv` and `.zip` files through
   `<a download>` with Blob URLs. In Electron, handle `will-download` (or let the default
   Save dialog appear). In Tauri, make sure WebView2 downloads are allowed.
5. **File open:** drag-and-drop and the file picker are already handled by the page.
6. **Allow `blob:` and `data:` URLs** in any Content-Security-Policy you add: the app creates
   workers and loads embedded models from them.
7. **Windows on ARM:** the developer's PC is ARM64. Ship an x64 build (it runs under emulation)
   or produce both x64 and arm64 builds.

### Suggested approach
- **Electron** (simplest, most predictable): `BrowserWindow` → `loadFile('Studio_V8_13.html')`,
  `contextIsolation: true`, `nodeIntegration: false`, no preload API needed. Package with
  electron-builder (NSIS installer or portable `.exe`). Expect ~150 MB installed.
- **Tauri 2** (smaller): put the HTML in the frontend dist folder, no Rust commands needed.
  Expect ~10 MB plus the 43 MB HTML; needs the WebView2 runtime (built into Windows 11).

Block navigation away from the app page (open external links in the default browser instead),
and disable devtools in release builds.

## How to check the .exe works
1. Run `node test/make-test-files.mjs`.
2. Launch the .exe and unlock it.
3. Drop in `test/files/test-chase-jan2026.pdf`. Expect 8 transactions, Bank name "Chase",
   Bank ID `10898`, payee names filled in, and totals validated.
4. Click ⌖ on a row. The statement page should open on the right with that line highlighted.
5. Rename a payee, e.g. "Amazon" to "Amazon.com". The other Amazon row should follow.
6. Download `.qbo`. It must contain `<INTU.BID>10898` and `<NAME>Amazon.com`.
7. Drop in `test/files/test-bank-export.csv`, open "Column layout", set Description to the
   "Description" column, then Save layout & re-read. Close and reopen the .exe, drop the CSV again,
   and the saved layout must apply automatically (this proves `localStorage` persists).
8. Try a scanned PDF with OCR on. It must work with the network disconnected.

## Notes and risks
- **The PINs are in the page's JavaScript.** Anyone can read them by opening the file. In an .exe
  the PIN lock deters casual users but is not real security. Don't rely on it to protect data.
- **Third-party components** (all embedded in the HTML): pdf.js (Apache-2.0),
  Tesseract.js (Apache-2.0), PaddleOCR models (Apache-2.0), ONNX Runtime Web (MIT),
  SheetJS (Apache-2.0), JSZip (MIT/GPLv3 dual), and PdfCraft (the embedded PDF editor; check its
  licence). Include their licence notices with the app.
- **Bank list:** `data/intuit_fidir_qm2400.txt` comes from Intuit's public server
  (`ofx-prod-filist.intuit.com`). It's fine for your own use. Check Intuit's terms before
  distributing the app to other people.
- **No code from other commercial converters is included.** The bank list comes from Intuit and
  all feature code was written new.
