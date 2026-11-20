// Builds Statement Studio V8.16 from V8.15: adds the file compressor to "Edit PDFs".
//   node studio/build/add-compressor.mjs <V8.15 index.html> <out.html>
// The "Edit PDFs" tool (PdfCraft) is stored base64-encoded inside the page; this
// script decodes it, applies exact-text patches (each anchor must match once),
// injects build/compress/*, and encodes it back.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node add-compressor.mjs <in.html> <out.html>'); process.exit(1); }
const read = (f) => readFileSync(join(here, 'compress', f), 'utf8');

function patcher(label) {
  return function patch(text, name, find, replace) {
    const count = text.split(find).length - 1;
    if (count !== 1) throw new Error(`${label} patch "${name}": anchor found ${count} times (need exactly 1)`);
    console.log(`  ok  ${label}: ${name}`);
    return text.replace(find, () => replace);
  };
}

let html = readFileSync(src, 'utf8');
const P = patcher('page');

// ---- the embedded PdfCraft document ----
const OPEN = '<script type="text/plain" id="pdfcraftSrc">';
const a = html.indexOf(OPEN);
if (a < 0 || html.indexOf(OPEN, a + 1) >= 0) throw new Error('pdfcraftSrc block not found exactly once');
const b = html.indexOf('</script>', a);
const b64 = html.slice(a + OPEN.length, b).trim();
let pc = Buffer.from(b64, 'base64').toString('utf8');
if (pc.includes('id="ss-compress"')) throw new Error('compressor is already in this file');
const Q = patcher('editor');

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/></svg>';

pc = Q(pc, 'styles', '</head>', `<style id="ss-compress-css">\n${read('compress.css')}</style>\n</head>`);

pc = Q(pc, 'landing entry',
  '<div class="ss-note">Everything happens on this computer — nothing is uploaded.</div>',
  `<div class="ss-note">Everything happens on this computer — nothing is uploaded.</div>
    <button class="cz-entry" type="button" data-cz-open><span class="cz-ei" aria-hidden="true">${ICON}</span><span><b>Compress files</b><small>Shrink PDFs, photos, Word, Excel, PowerPoint and other files</small></span><span class="cz-go">Open</span></button>`);

pc = Q(pc, 'landing list', '</ul></div>\n    <div class="ss-block"><div class="ss-label">Then</div>',
  `  <li><span class="i" aria-hidden="true">${ICON}</span><span><b>Compress</b>PDFs, photos and Office files, much smaller</span></li>
    </ul></div>
    <div class="ss-block"><div class="ss-label">Then</div>`);

pc = Q(pc, 'top bar button', '<button class="btn" data-pick>Add files</button>',
  '<button class="btn" data-pick>Add files</button>\n      <button class="btn" type="button" data-cz-open title="Shrink PDFs, photos and other files">Compress files</button>');

pc = Q(pc, 'dock tool', '<details class="tool" id="d-img" name="tools">',
  `<details class="tool" id="d-comp" name="tools">
      <summary><span class="ic" style="background:#E0F7FA;color:#00838F">${ICON}</span><span>Make PDF smaller<small>Compressed when you download</small></span><em class="on-tag" id="comptag" hidden>On</em></summary>
      <div class="tbody">
        <label class="check"><input type="checkbox" id="con">Make my PDF smaller</label>
        <div class="seg" role="radiogroup" aria-label="Compression strength">
          <label><input type="radio" name="clevel" value="light">Light</label>
          <label><input type="radio" name="clevel" value="balanced" checked>Balanced</label>
          <label><input type="radio" name="clevel" value="strong">Strong</label>
        </div>
        <p class="hint" id="clvlhint"></p>
        <button class="btn" type="button" data-cz-open>Compress other files…</button>
      </div>
    </details>

    <details class="tool" id="d-img" name="tools">`);

pc = Q(pc, 'compressor view', '<input type="file" id="picker" multiple hidden accept=".pdf,image/*">',
  `${read('compress.html')}<input type="file" id="picker" multiple hidden accept=".pdf,image/*">`);

pc = Q(pc, 'script', '<script id="ss-bridge">',
  `<script id="ss-compress">\n${read('compress.js')}</script>\n<script id="ss-bridge">`);

// the hand-off to Convert keeps full quality (better for reading text)
pc = Q(pc, 'convert keeps quality',
  '{ progress: busy.step, title: baseName(name) });\n    parent.postMessage({ type: "ss-convert"',
  '{ progress: busy.step, title: baseName(name), compress: false });\n    parent.postMessage({ type: "ss-convert"');

pc = Q(pc, 'brand', 'const BRAND = "PdfCraft V1.2";', 'const BRAND = "PdfCraft V1.3";');
pc = Q(pc, 'footer version', 'Author “PdfCraft V1.1”', 'Author “PdfCraft V1.3”');
pc = Q(pc, 'logo version', '<span class="ver">v1.1</span>', '<span class="ver">v1.3</span>');

const enc = Buffer.from(pc, 'utf8').toString('base64');
html = html.slice(0, a + OPEN.length) + '\n' + enc + '\n' + html.slice(b);

// ---- Statement Studio version ----
html = P(html, 'title', '<title>Statement Studio · Offline · V8.15</title>', '<title>Statement Studio · Offline · V8.16</title>');
html = P(html, 'SSX version', "version: '8.15',", "version: '8.16',");

writeFileSync(out, html, 'utf8');
console.log(`wrote ${out} (${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB)`);
