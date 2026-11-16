/* ==========================================================================
   Statement Studio extensions (V8.13)
   1. Bank directory  — pick the bank from Intuit's public institution list so
                        the .qbo carries that bank's ID instead of a fixed 3000.
   2. Payee cleanup    — a clean payee name per transaction for the .qbo NAME
                        field; your corrections become rules for next time.
   3. CSV layouts      — fix how a spreadsheet's columns are read and save it
                        for every file with the same headers.
   4. Show on PDF      — open the statement page beside the table with the
                        transaction's line highlighted.
   Everything stays in this browser tab; rules live in localStorage.
   ========================================================================== */
(function () {
  'use strict';

  const host = () => window.SSXHost || null;
  const $id = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: rules last this session only */ }
    },
  };

  function toast(msg) {
    let el = $id('ssx-toast');
    if (!el) { el = document.createElement('div'); el.id = 'ssx-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ==========================================================================
  // 1. BANK DIRECTORY
  // ==========================================================================
  const F_BANK = 1, F_CREDIT = 2, F_WEBCONNECT = 4;
  const RAW = Array.isArray(window.SSX_BANKS) ? window.SSX_BANKS : [];
  const normName = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const BANKS = RAW.map((b) => ({ id: String(parseInt(b[0], 10)), name: b[1], flags: b[2], n: normName(b[1]) }));
  const PICKS_KEY = 'ssx.bankPicks';

  const NOISE = /\b(bank|the|of|na|n a|and|inc|co|corp|company|national|association|financial|group|fsb)\b/g;
  const core = (n) => n.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

  function bankById(id) {
    id = String(parseInt(id, 10));
    return BANKS.find((b) => b.id === id) || null;
  }

  // Best directory entry for a bank name the parser detected. Only confident
  // matches are returned: a wrong bank ID is worse than the generic 3000.
  function autoMatchBank(bankName, isCC) {
    const q = normName(bankName);
    if (!q || /unknown/.test(q)) return null;
    const picks = store.get(PICKS_KEY, {});
    if (picks[q]) return bankById(picks[q].id) || null;
    const qc = core(q);
    if (!qc) return null;
    const wanted = isCC ? F_CREDIT : F_BANK;
    const score = (b) => (b.flags & F_WEBCONNECT ? 4 : 0) + (b.flags & wanted ? 2 : 0) - b.name.length / 100;
    let hits = BANKS.filter((b) => b.n === q);
    if (!hits.length) hits = BANKS.filter((b) => core(b.n) === qc);
    // Intuit lists some banks' file-import entry as "<Bank> Web Connect".
    if (!hits.length) hits = BANKS.filter((b) => (b.flags & F_WEBCONNECT) && core(b.n.replace(/\bweb connect\b/, '')) === qc);
    if (!hits.length) return null;
    hits.sort((a, b) => score(b) - score(a));
    return hits[0];
  }

  function searchBanks(query, limit) {
    const q = normName(query);
    if (!q) return [];
    const words = q.split(' ');
    const out = [];
    for (const b of BANKS) {
      if (!words.every((w) => b.n.includes(w))) continue;
      let s = 0;
      if (b.n === q) s += 100;
      else if (b.n.startsWith(q)) s += 50;
      else if ((' ' + b.n).includes(' ' + words[0])) s += 20;
      if (b.flags & F_WEBCONNECT) s += 5;
      s -= b.name.length / 20;
      out.push({ b, s });
    }
    out.sort((a, z) => z.s - a.s);
    return out.slice(0, limit || 12).map((x) => x.b);
  }

  function rememberBankPick(detectedName, bank) {
    const q = normName(detectedName);
    if (!q || !bank) return;
    const picks = store.get(PICKS_KEY, {});
    picks[q] = { id: bank.id, name: bank.name };
    store.set(PICKS_KEY, picks);
  }

  function bankCaption(md) {
    const id = String(md.fid || '').trim();
    if (!id) return '<span class="ssx-cap warn">Not set — the .qbo will use the generic ID 3000</span>';
    const b = bankById(id);
    if (!b) return `<span class="ssx-cap warn">ID ${esc(id)} isn't in Intuit's list</span>`;
    return `<span class="ssx-cap">${esc(b.name)}${b.flags & F_WEBCONNECT ? ' · <b class="ok">Web Connect ✓</b>' : ' · <b class="warn">no Web Connect</b>'}</span>`;
  }

  function wireBankPicker(f) {
    const input = $id('m-bank');
    const fidInput = $id('m-fid');
    if (!input || !fidInput || !BANKS.length) return;
    const field = fidInput.closest('.field');
    let cap = $id('ssx-fid-cap');
    if (!cap && field) { cap = document.createElement('div'); cap.id = 'ssx-fid-cap'; field.appendChild(cap); }
    const refreshCap = () => { if (cap) cap.innerHTML = bankCaption(f.metadata); };
    refreshCap();
    fidInput.addEventListener('input', refreshCap);

    const wrap = input.closest('.field');
    if (wrap) wrap.classList.add('ssx-ac-wrap');
    const list = document.createElement('div');
    list.className = 'ssx-ac';
    list.setAttribute('role', 'listbox');
    (wrap || input.parentNode).appendChild(list);
    let items = [], active = -1;

    const close = () => { list.classList.remove('open'); active = -1; };
    const render = () => {
      items = searchBanks(input.value, 12);
      if (!items.length) { close(); return; }
      list.innerHTML = items.map((b, i) => `
        <div class="ssx-ac-item${i === active ? ' active' : ''}" data-i="${i}" role="option">
          <span class="ssx-ac-name">${esc(b.name)}</span>
          <span class="ssx-ac-meta">${b.flags & F_CREDIT && !(b.flags & F_BANK) ? 'card · ' : ''}ID ${esc(b.id)}${b.flags & F_WEBCONNECT ? '' : ' · no Web Connect'}</span>
        </div>`).join('') + '<div class="ssx-ac-foot">From Intuit’s institution list</div>';
      list.classList.add('open');
    };
    const choose = (b) => {
      const detected = f.summary.bank || f.metadata.bank_name;
      rememberBankPick(detected, b);
      if (input.value !== b.name) { rememberBankPick(input.value, b); }
      input.value = b.name.slice(0, 32);
      fidInput.value = b.id;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fidInput.dispatchEvent(new Event('input', { bubbles: true }));
      close();
      toast(`Bank set to ${b.name} (ID ${b.id}) — remembered for this bank`);
    };

    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', (e) => { if (e.isTrusted) render(); });
    input.addEventListener('focus', () => { if (input.value) render(); });
    input.addEventListener('keydown', (e) => {
      if (!list.classList.contains('open')) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { choose(items[active]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.ssx-ac-item');
      if (!it) return;
      e.preventDefault();
      choose(items[+it.dataset.i]);
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  // ==========================================================================
  // 2. PAYEE CLEANUP
  // ==========================================================================
  const RULES_KEY = 'ssx.payeeRules';

  function vendorKey(desc) {
    const h = host();
    const v = h && h.normalizeVendorName ? h.normalizeVendorName(desc) : String(desc || '');
    return normName(v);
  }

  function isCheckTxn(tx) {
    return String(tx.qboType || '').toUpperCase() === 'CHECK' || /^check/i.test(String(tx.section || '')) ||
      /^(?:[A-Za-z]+\s+){0,3}check\s*(?:#|no\.?|number)?\s*\d/i.test(String(tx.description || ''));
  }

  function autoPayee(tx, rules) {
    const desc = String(tx.description || '').trim();
    if (!desc || desc === '(no description)') return '';
    const key = vendorKey(desc);
    if (rules[key] && rules[key].to) return rules[key].to;
    if (isCheckTxn(tx)) return '';                       // keeps "Check 1234" as the name
    const h = host();
    const v = h && h.normalizeVendorName ? h.normalizeVendorName(desc) : desc;
    return v && v !== 'Unknown' ? v.slice(0, 32) : '';
  }

  function applyPayees(f, force) {
    if (!f || !f.transactions || (f.summary && f.summary.sourceFormat === 'qbo')) return 0;
    const rules = store.get(RULES_KEY, {});
    let n = 0;
    for (const tx of f.transactions) {
      const empty = !tx.payee || !String(tx.payee).trim();
      if (!empty && !tx._payeeAuto) continue;            // never overwrite your own edits
      const p = autoPayee(tx, rules);
      if (p !== (tx.payee || '')) { tx.payee = p; n++; }
      tx._payeeAuto = true;
    }
    return n;
  }

  function onPayeeEdited(f, i, value) {
    const tx = f.transactions[i];
    if (!tx) return;
    tx._payeeAuto = false;
    const key = vendorKey(tx.description);
    if (!key) return;
    const rules = store.get(RULES_KEY, {});
    const v = String(value || '').trim();
    if (v) rules[key] = { to: v.slice(0, 32), from: String(tx.description || '').slice(0, 60) };
    else delete rules[key];
    store.set(RULES_KEY, rules);
    let others = 0;
    f.transactions.forEach((t, j) => {
      if (j === i || !t._payeeAuto) return;
      if (vendorKey(t.description) !== key) return;
      t.payee = v.slice(0, 32);
      others++;
    });
    if (others) { const h = host(); if (h) h.renderRows(f); }
    renderRulesPanel(f);
    toast(v ? `Remembered payee "${v}"${others ? ` — ${others} more row${others > 1 ? 's' : ''} updated` : ''}` : 'Payee rule removed');
  }

  function renderRulesPanel(f) {
    const el = $id('ssx-rules');
    if (!el) return;
    const rules = store.get(RULES_KEY, {});
    const keys = Object.keys(rules).sort();
    el.querySelector('.ssx-count').textContent = keys.length;
    el.querySelector('.ssx-rules-body').innerHTML = keys.length
      ? `<table class="ssx-rt"><thead><tr><th>Looks like</th><th>Payee in QuickBooks</th><th></th></tr></thead><tbody>${
        keys.map((k) => `<tr><td title="${esc(rules[k].from || '')}">${esc(rules[k].from || k)}</td><td>${esc(rules[k].to)}</td>
          <td><button class="del-x" data-ssx-rule="${esc(k)}" title="Delete rule">&times;</button></td></tr>`).join('')
      }</tbody></table>`
      : '<div class="ssx-empty">No rules yet. Edit a name in the Payee column and it’s remembered for every statement.</div>';
  }

  function payeePanelHTML() {
    return `
      <details class="panel ssx-panel" id="ssx-rules">
        <summary class="panel-head">Payee names <span class="hint">the name QuickBooks shows · rules: <span class="ssx-count">0</span></span></summary>
        <div class="ssx-row">
          <button class="btn ghost small" id="ssx-reclean">Re-clean payees</button>
          <span class="ssx-note">Fills empty or automatic payee names. Names you typed yourself are never changed.</span>
        </div>
        <div class="ssx-rules-body"></div>
      </details>`;
  }

  // ==========================================================================
  // 3. CSV / EXCEL COLUMN LAYOUTS
  // ==========================================================================
  const LAYOUTS_KEY = 'ssx.csvLayouts';
  const ROLES = [
    ['date', 'Date'], ['desc', 'Description'], ['amount', 'Amount (signed)'], ['debit', 'Money out'],
    ['credit', 'Money in'], ['check', 'Check #'], ['type', 'Type'], ['balance', 'Balance'],
  ];
  const sigOf = (header) => header.map((h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');

  function csvLayoutFor(header) {
    if (!Array.isArray(header)) return null;
    const layouts = store.get(LAYOUTS_KEY, {});
    const l = layouts[sigOf(header)];
    if (!l || !l.col) return null;
    const col = {};
    for (const [k, v] of Object.entries(l.col)) if (Number.isInteger(v) && v >= 0 && v < header.length) col[k] = v;
    return { name: l.name || 'saved layout', bank: l.bank || '', fid: l.fid || '', col };
  }

  function layoutPanelHTML(f) {
    const s = f.summary;
    if (s.sourceFormat !== 'spreadsheet' || !Array.isArray(s.csvHeader)) return '';
    const hdr = s.csvHeader;
    const col = s.csvCol || {};
    const opts = (sel) => `<option value="">— none —</option>` + hdr.map((h, i) =>
      `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(String(h || `Column ${i + 1}`))}</option>`).join('');
    return `
      <details class="panel ssx-panel" id="ssx-layout" ${s.csvLayout ? '' : 'open'}>
        <summary class="panel-head">Column layout <span class="hint">${s.csvLayout ? `using saved layout “${esc(s.csvLayout)}”` : 'detected automatically — fix and save if anything is wrong'}</span></summary>
        <div class="ssx-grid">
          ${ROLES.map(([k, label]) => `<div class="field"><label>${label}</label><select data-ssx-role="${k}">${opts(col[k])}</select></div>`).join('')}
        </div>
        <div class="ssx-row">
          <div class="field" style="flex:0 1 260px"><label>Layout name</label><input id="ssx-layout-name" value="${esc(s.csvLayout || f.metadata.bank_name || s.bank || '')}"></div>
          <button class="btn small" id="ssx-layout-save">Save layout &amp; re-read</button>
          ${s.csvLayout ? '<button class="btn ghost small" id="ssx-layout-forget">Forget this layout</button>' : ''}
          <span class="ssx-note">Saved layouts apply automatically to any file with the same column headers. Use either Amount, or Money out + Money in.</span>
        </div>
      </details>`;
  }

  function wireLayoutPanel(f) {
    const panel = $id('ssx-layout');
    if (!panel) return;
    const save = $id('ssx-layout-save');
    if (save) save.onclick = async () => {
      const col = {};
      panel.querySelectorAll('select[data-ssx-role]').forEach((s) => { if (s.value !== '') col[s.dataset.ssxRole] = parseInt(s.value, 10); });
      if (col.date === undefined) { alert('Choose the Date column.'); return; }
      if (col.amount === undefined && col.debit === undefined && col.credit === undefined) { alert('Choose an Amount column, or Money out / Money in.'); return; }
      const name = ($id('ssx-layout-name').value || 'Layout').trim().slice(0, 60);
      const layouts = store.get(LAYOUTS_KEY, {});
      layouts[sigOf(f.summary.csvHeader)] = {
        name, col, bank: f.metadata.bank_name || '', fid: f.metadata.fid || '', saved: new Date().toISOString().slice(0, 10),
      };
      store.set(LAYOUTS_KEY, layouts);
      await reparseActive();
      toast(`Layout "${name}" saved`);
    };
    const forget = $id('ssx-layout-forget');
    if (forget) forget.onclick = async () => {
      const layouts = store.get(LAYOUTS_KEY, {});
      delete layouts[sigOf(f.summary.csvHeader)];
      store.set(LAYOUTS_KEY, layouts);
      await reparseActive();
      toast('Layout forgotten — back to automatic detection');
    };
  }

  async function reparseActive() {
    const h = host();
    if (!h || !h.reparse) return;
    try { await h.reparse(h.state.activeIdx); } catch (e) { alert('Could not re-read the file: ' + e.message); }
  }

  // ==========================================================================
  // 4. SHOW ON PDF
  // ==========================================================================
  // Bounding box (PDF user-space units) of the statement lines a transaction
  // was built from. Called by the parser as each transaction is finalized.
  function srcBox(rows) {
    try {
      const withPage = (rows || []).filter((r) => r && r.page != null);
      if (!withPage.length) return undefined;
      const page = withPage[0].page;
      const same = withPage.filter((r) => r.page === page && !r._rotated && isFinite(r.y));
      if (!same.length) return { page };
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const r of same) {
        y0 = Math.min(y0, r.y); y1 = Math.max(y1, r.y);
        for (const it of r.items || []) {
          if (!isFinite(it.x)) continue;
          x0 = Math.min(x0, it.x);
          x1 = Math.max(x1, it.x + (it.width || String(it.text || '').length * 4));
        }
      }
      return isFinite(x0) ? { page, x0, x1, y0, y1 } : { page };
    } catch (e) { return undefined; }
  }

  const fmtAmt = (a) => Math.abs(Number(a) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function getDoc(f) {
    if (!f._ssxDoc) {
      f._ssxDoc = f._srcFile.arrayBuffer().then((buf) => pdfjsLib.getDocument({ data: buf }).promise);
      f._ssxDoc.catch(() => { f._ssxDoc = null; });
    }
    return f._ssxDoc;
  }

  // When the parser couldn't record a position (e.g. split check lines), look
  // for the amount as printed.
  async function findByAmount(doc, tx) {
    const want = [fmtAmt(tx.amount), fmtAmt(tx.amount).replace(/,/g, '')];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        const s = String(it.str || '').replace(/[$\s()+-]/g, '');
        if (want.includes(s)) {
          const x = it.transform[4], y = it.transform[5];
          return { page: p, x0: x - 260, x1: x + (it.width || 40), y0: y, y1: y, approx: true };
        }
      }
    }
    return null;
  }

  const drawer = { f: null, i: -1, page: 1, box: null };

  function ensureDrawer() {
    let d = $id('ssx-drawer');
    if (d) return d;
    d = document.createElement('aside');
    d.id = 'ssx-drawer';
    d.setAttribute('aria-label', 'Statement page');
    d.innerHTML = `
      <div class="ssx-dh">
        <div class="ssx-dt"><b id="ssx-d-title">Statement</b><span id="ssx-d-sub"></span></div>
        <div class="ssx-dn">
          <button class="btn ghost small" id="ssx-d-prev" title="Previous page">&#8249;</button>
          <span id="ssx-d-page">1 / 1</span>
          <button class="btn ghost small" id="ssx-d-next" title="Next page">&#8250;</button>
          <button class="del-x" id="ssx-d-close" title="Close (Esc)">&times;</button>
        </div>
      </div>
      <div class="ssx-txn" id="ssx-d-txn"></div>
      <div class="ssx-db" id="ssx-d-body"><div class="ssx-pg" id="ssx-d-pg"><canvas id="ssx-d-canvas"></canvas><div class="ssx-hl" id="ssx-d-hl"></div></div></div>`;
    document.body.appendChild(d);
    $id('ssx-d-close').onclick = closeDrawer;
    $id('ssx-d-prev').onclick = () => { if (drawer.page > 1) { drawer.page--; drawPage(); } };
    $id('ssx-d-next').onclick = async () => { const doc = await getDoc(drawer.f); if (drawer.page < doc.numPages) { drawer.page++; drawPage(); } };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d.classList.contains('open')) closeDrawer(); });
    return d;
  }

  function closeDrawer() {
    const d = $id('ssx-drawer');
    if (d) d.classList.remove('open');
    document.body.classList.remove('ssx-drawer-open');
    document.querySelectorAll('#rows tr.ssx-on').forEach((tr) => tr.classList.remove('ssx-on'));
    drawer.f = null; drawer.i = -1;
  }

  async function openDrawer(f, i) {
    const tx = f.transactions[i];
    if (!tx || !f._srcFile) return;
    const d = ensureDrawer();
    drawer.f = f; drawer.i = i;
    d.classList.add('open');
    document.body.classList.add('ssx-drawer-open');
    document.querySelectorAll('#rows tr').forEach((tr, k) => tr.classList.toggle('ssx-on', k === i));
    $id('ssx-d-title').textContent = f.summary.fileName || 'Statement';
    $id('ssx-d-txn').innerHTML = `<span>${esc(tx.date || '')}</span><span class="ssx-td">${esc(tx.description || '')}</span><span class="${tx.amount < 0 ? 'debit' : 'credit'}">${tx.amount < 0 ? '-' : ''}$${fmtAmt(tx.amount)}</span>`;
    $id('ssx-d-sub').textContent = 'Finding the line…';
    let box = tx.src && tx.src.page ? tx.src : null;
    const ocr = !!(f.summary && f.summary.usedOcr);
    try {
      const doc = await getDoc(f);
      if (drawer.f !== f || drawer.i !== i) return;
      if (ocr && box) box = { page: box.page };           // OCR coordinates aren't PDF coordinates
      if (!box || box.x0 === undefined) {
        const found = ocr ? null : await findByAmount(doc, tx);
        if (found) box = found; else if (!box) box = { page: 1 };
      }
      drawer.box = box;
      drawer.page = Math.min(Math.max(1, box.page || 1), doc.numPages);
      $id('ssx-d-sub').textContent = box.x0 === undefined
        ? (ocr ? 'Read with OCR — exact line not marked' : 'Line not located — showing the page')
        : (box.approx ? 'Matched by amount' : '');
      await drawPage();
    } catch (e) {
      $id('ssx-d-sub').textContent = 'Could not open this PDF: ' + e.message;
    }
  }

  async function drawPage() {
    const f = drawer.f;
    if (!f) return;
    const doc = await getDoc(f);
    const page = await doc.getPage(drawer.page);
    const body = $id('ssx-d-body');
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(0.5, (body.clientWidth - 24) / base.width);
    const vp = page.getViewport({ scale });
    const canvas = $id('ssx-d-canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + 'px';
    canvas.style.height = vp.height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (drawPage._task) { try { drawPage._task.cancel(); } catch (e) { /* ignore */ } }
    drawPage._task = page.render({ canvasContext: ctx, viewport: vp });
    try { await drawPage._task.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return; throw e; }
    $id('ssx-d-page').textContent = `${drawer.page} / ${doc.numPages}`;
    const hl = $id('ssx-d-hl');
    const b = drawer.box;
    if (b && b.x0 !== undefined && b.page === drawer.page) {
      const r = vp.convertToViewportRectangle([b.x0 - 4, b.y0 - 4, b.x1 + 4, b.y1 + 11]);
      const left = Math.min(r[0], r[2]), top = Math.min(r[1], r[3]);
      Object.assign(hl.style, {
        display: 'block', left: Math.max(0, left) + 'px', top: top + 'px',
        width: Math.min(vp.width, Math.abs(r[2] - r[0])) + 'px', height: Math.abs(r[3] - r[1]) + 'px',
      });
      body.scrollTop = Math.max(0, top - body.clientHeight / 3);
    } else {
      hl.style.display = 'none';
      body.scrollTop = 0;
    }
  }

  // ==========================================================================
  // HOOKS called by the main app
  // ==========================================================================
  function afterParse(r) {
    if (!r || !r.metadata) return;
    const s = r.summary || {};
    // Bank ID: a saved CSV layout's bank first, then a confident name match.
    let fid = '';
    if (s.csvLayout && Array.isArray(s.csvHeader)) {
      const l = csvLayoutFor(s.csvHeader);
      if (l && l.fid) fid = l.fid;
    }
    if (!fid) {
      const b = autoMatchBank(r.metadata.bank_name || s.bank, r.metadata.account_type === 'CREDITCARD' || s.isCreditCard);
      if (b) fid = b.id;
    }
    r.metadata.fid = fid;
    applyPayees(r, false);
  }

  let lastFile = null;
  function afterFileView(f) {
    if (lastFile !== f) closeDrawer();
    lastFile = f;
    applyPayees(f, false);
    const h = host();
    if (h) h.renderRows(f);
    wireBankPicker(f);

    const toolbar = document.querySelector('#file-view .toolbar');
    if (toolbar && !$id('ssx-rules')) {
      toolbar.insertAdjacentHTML('beforebegin', layoutPanelHTML(f) + payeePanelHTML());
      wireLayoutPanel(f);
      renderRulesPanel(f);
      $id('ssx-reclean').onclick = () => {
        const n = applyPayees(f, true);
        if (h) h.renderRows(f);
        toast(n ? `${n} payee name${n > 1 ? 's' : ''} updated` : 'Payee names are already up to date');
      };
    }
  }

  // Payee edits and rule deletes (event delegation survives re-renders).
  document.addEventListener('change', (e) => {
    const el = e.target.closest && e.target.closest('input[data-k="payee"]');
    if (!el) return;
    const h = host();
    if (!h) return;
    onPayeeEdited(h.state.files[h.state.activeIdx], +el.dataset.i, el.value);
  });
  document.addEventListener('click', (e) => {
    const loc = e.target.closest && e.target.closest('[data-ssx-loc]');
    if (loc) {
      const h = host();
      if (h) openDrawer(h.state.files[h.state.activeIdx], +loc.dataset.ssxLoc);
      return;
    }
    const del = e.target.closest && e.target.closest('[data-ssx-rule]');
    if (del) {
      const rules = store.get(RULES_KEY, {});
      delete rules[del.dataset.ssxRule];
      store.set(RULES_KEY, rules);
      const h = host();
      if (h) renderRulesPanel(h.state.files[h.state.activeIdx]);
    }
  });
  window.addEventListener('resize', () => { if (drawer.f) drawPage(); });

  window.SSX = {
    version: '8.13',
    banks: BANKS.length,
    srcBox, afterParse, afterFileView, csvLayoutFor,
    _test: { autoMatchBank, searchBanks, autoPayee, vendorKey, sigOf },
  };
})();
