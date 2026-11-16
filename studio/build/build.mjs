// Builds Statement Studio V8.13 from the untouched V8.12 file.
//   node build/build.mjs <Studio_V8_12.html> <out.html>
// Every patch must match its anchor exactly once, or the build stops.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node build.mjs <in.html> <out.html>'); process.exit(1); }

let html = readFileSync(src, 'utf8');

function patch(name, find, replace) {
  const count = html.split(find).length - 1;
  if (count !== 1) throw new Error(`patch "${name}": anchor found ${count} times (need exactly 1)`);
  html = html.replace(find, () => replace);
  console.log(`  ok  ${name}`);
}

// 1. PDF transactions remember where on the page they came from.
patch('txn source position',
  `      signSource: section.signSource,
      checkNumber: checkNumber || undefined,
    });`,
  `      signSource: section.signSource,
      checkNumber: checkNumber || undefined,
      src: window.SSX && window.SSX.srcBox ? window.SSX.srcBox(acc.rows) : undefined,
    });`);

patch('txn source position kept through date normalisation',
  `        checkNumber: tx.checkNumber,
      };
    });

    // "Total of N Checks Presented" aggregates -> the N itemized checks.`,
  `        checkNumber: tx.checkNumber,
        src: tx.src,
      };
    });

    // "Total of N Checks Presented" aggregates -> the N itemized checks.`);

// 2. Keep the source file and run the extension hook after each parse.
patch('after-parse hook',
  `        r.metadata = deriveQboMetadata(r.summary, r.transactions);
        r.error = null;
        state.files.push(r);`,
  `        r.metadata = deriveQboMetadata(r.summary, r.transactions);
        r.error = null;
        r._srcFile = file;
        r._kind = kind;
        try { if (window.SSX) window.SSX.afterParse(r); } catch (e) { console.error(e); }
        state.files.push(r);`);

// 3. Bank ID (Intuit FID) carried through metadata sanitising...
patch('sanitize bank id',
  `      ending_balance: Number(md.ending_balance) || 0,
    };
  }`,
  `      ending_balance: Number(md.ending_balance) || 0,
      fid: /^\\d{1,7}$/.test(String(md.fid == null ? '' : md.fid).trim()) ? String(parseInt(md.fid, 10)) : '3000',
    };
  }`);

// 4. ...and written into the .qbo instead of the fixed 3000.
patch('qbo bank id',
  `'<FID>3000', '</FI>',
      '<INTU.BID>3000',`,
  `\`<FID>\${md.fid}\`, '</FI>',
      \`<INTU.BID>\${md.fid}\`,`);

// 5. Bank ID field in the metadata form.
patch('bank id field',
  `          <div class="field"><label>Routing number</label><input id="m-routing" value="\${esc(md.routing_number)}"></div>`,
  `          <div class="field"><label>Routing number</label><input id="m-routing" value="\${esc(md.routing_number)}"></div>
          <div class="field"><label>Bank ID (Intuit)</label><input id="m-fid" value="\${esc(md.fid || '')}" placeholder="3000" inputmode="numeric"></div>`);

patch('bank id binding',
  `const metaMap = { 'm-bank': 'bank_name',`,
  `const metaMap = { 'm-fid': 'fid', 'm-bank': 'bank_name',`);

// 6. Payee column + "show on PDF" button in the transaction table.
patch('table header',
  `          <th>Description</th>
          <th style="width:140px;text-align:right">Amount</th>
          <th style="width:40px"></th>`,
  `          <th>Description</th>
          <th style="width:190px">Payee (QBO name)</th>
          <th style="width:140px;text-align:right">Amount</th>
          <th style="width:70px"></th>`);

patch('table row payee',
  `        <td><input value="\${esc(t.description)}" data-i="\${i}" data-k="description"></td>`,
  `        <td><input value="\${esc(t.description)}" data-i="\${i}" data-k="description"></td>
        <td><input value="\${esc(t.payee || '')}" data-i="\${i}" data-k="payee" maxlength="32" placeholder="(uses description)" title="Name sent to QuickBooks — edit to remember it"></td>`);

patch('table row locate',
  `        <td><button class="del-x" data-del="\${i}" title="Delete">&times;</button></td>`,
  `        <td style="white-space:nowrap">\${f._kind === 'pdf' && f._srcFile ? \`<button class="ssx-loc" data-ssx-loc="\${i}" title="Show on PDF">&#8982;</button>\` : ''}<button class="del-x" data-del="\${i}" title="Delete">&times;</button></td>`);

// 7. Hand the extension what it needs from inside the app.
patch('host bridge',
  `  function recalcStats(f) {`,
  `  window.SSXHost = {
    state, renderRows, renderFileView, renderTabs, normalizeVendorName,
    async reparse(idx) {
      const f = state.files[idx];
      if (!f || !f._srcFile) return;
      const r = await parseSpreadsheet(f._srcFile, log);
      r.metadata = deriveQboMetadata(r.summary, r.transactions);
      r.error = null;
      r._srcFile = f._srcFile;
      r._kind = f._kind;
      if (window.SSX) window.SSX.afterParse(r);
      state.files[idx] = r;
      renderTabs();
      renderFileView();
    },
  };

  function recalcStats(f) {`);

// 8. Saved CSV / Excel column layouts.
patch('csv layout override',
  `      else if (col.holder === undefined && matchesKey(h, XL_HOLDER_KEYS)) col.holder = idx;
    });`,
  `      else if (col.holder === undefined && matchesKey(h, XL_HOLDER_KEYS)) col.holder = idx;
    });
    const ssxLayout = window.SSX && window.SSX.csvLayoutFor ? window.SSX.csvLayoutFor(header) : null;
    if (ssxLayout) {
      for (const k of ['date', 'desc', 'amount', 'debit', 'credit', 'check', 'type', 'balance']) delete col[k];
      Object.assign(col, ssxLayout.col);
      log(\`  ↳ Using saved column layout "\${ssxLayout.name}"\`);
    }`);

patch('csv layout bank',
  `      bank: sheetBank || detectBankFromFileName(file.name),`,
  `      bank: sheetBank || (ssxLayout && ssxLayout.bank) || detectBankFromFileName(file.name),`);

patch('csv layout summary',
  `      sourceFormat: 'spreadsheet',
      sourceSheet: best.sheetName,`,
  `      sourceFormat: 'spreadsheet',
      sourceSheet: best.sheetName,
      csvHeader: header.slice(),
      csvCol: Object.assign({}, col),
      csvLayout: ssxLayout ? ssxLayout.name : null,`);

// 9. Extension UI after each statement view renders.
patch('file view hook',
  `    renderRows(f);
  }

  function renderPivotView(f, groupBy) {`,
  `    renderRows(f);
    try { if (window.SSX) window.SSX.afterFileView(f); } catch (e) { console.error(e); }
  }

  function renderPivotView(f, groupBy) {`);

// 10. Version label.
patch('title', `<title>Statement Studio · Offline</title>`, `<title>Statement Studio · Offline · V8.13</title>`);

// Inject styles, the bank list and the extension script before </body>.
const css = readFileSync(join(here, 'theme-pro.css'), 'utf8') + '\n' + readFileSync(join(here, 'ssx.css'), 'utf8');
const js = readFileSync(join(here, 'ssx.js'), 'utf8');
const banks = readFileSync(join(here, '..', 'data', 'banks.json'), 'utf8');
const lastBody = html.lastIndexOf('</body>');
if (lastBody < 0) throw new Error('no </body>');
const inject = `<style id="ssx-style">\n${css}\n</style>
<script id="ssx-banks">/* Financial institutions from Intuit's public directory (fidir.txt). [id, name, flags] */
window.SSX_BANKS=${banks};</script>
<script id="ssx-main">\n${js}\n</script>\n`;
html = html.slice(0, lastBody) + inject + html.slice(lastBody);

writeFileSync(out, html, 'utf8');
console.log(`wrote ${out} (${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB)`);
