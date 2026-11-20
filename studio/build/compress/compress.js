/* V8.16 · File compressor for the "Edit PDFs" tool.
   - "Compress files" view: PDFs, photos, Office files and anything else.
   - "Make my PDF smaller" option in the editor: applied when you download.
   Runs entirely in this page (pdf-lib, PDF.js, JSZip, canvas). Nothing is uploaded. */
(function () {
  "use strict";
  const { PDFDocument, PDFName, PDFNumber, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, PDFBool, decodePDFRawStream } = PDFLib;

  // Strength presets. px/q: pictures inside PDFs and Office files. imgPx/imgQ: photo files.
  const LEVELS = {
    light:    { px: 2600, q: 0.82, imgPx: 4000, imgQ: 0.86,
                hint: "Barely visible change. Good for files you will print." },
    balanced: { px: 1800, q: 0.70, imgPx: 2560, imgQ: 0.76,
                hint: "Recommended. Much smaller files that still look sharp on screen." },
    strong:   { px: 1250, q: 0.56, imgPx: 1920, imgQ: 0.64,
                hint: "Smallest while PDF text stays selectable. Photos and scans get softer." },
    max:      { px: 1000, q: 0.50, imgPx: 1280, imgQ: 0.52, raster: true, dpi: 110,
                hint: "Smallest of all. PDF pages become pictures, so text can’t be selected or searched (Convert will read them with OCR)." },
  };

  const N = (k) => PDFName.of(k);
  const sleep0 = () => new Promise((r) => setTimeout(r, 0));
  const extOf = (n) => { const m = /\.([a-z0-9]+)$/i.exec(n || ""); return m ? m[1].toLowerCase() : ""; };
  const stem = (n) => (n || "file").replace(/\.[^.]+$/, "");
  const pct = (a, b) => (a > 0 ? Math.round((1 - b / a) * 100) : 0);

  /* ================= PDF ================= */
  function canvasToBlob(c, type, q) { return new Promise((res) => c.toBlob(res, type, q)); }
  async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }

  function channelsOf(ctx, cs) {
    if (!cs) return 0;
    if (cs === N("DeviceRGB") || cs === N("CalRGB")) return 3;
    if (cs === N("DeviceGray") || cs === N("CalGray")) return 1;
    if (cs instanceof PDFArray && cs.size() >= 2 && cs.lookup(0) === N("ICCBased")) {
      const icc = cs.lookup(1);
      const n = icc && icc.dict && icc.dict.lookup(N("N"));
      const v = n instanceof PDFNumber ? n.asNumber() : 0;
      return v === 1 || v === 3 ? v : 0;
    }
    return 0; // CMYK, Indexed, Lab, Separation…: left as they are
  }

  // undo PNG predictors (DecodeParms /Predictor 10–15)
  function unpredict(data, cols, colors, bpc) {
    const bpp = Math.max(1, (colors * bpc) >> 3), rowLen = Math.ceil((cols * colors * bpc) / 8);
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen), p = 0;
    for (let r = 0; r < rows; r++) {
      const type = data[p++], cur = out.subarray(r * rowLen, (r + 1) * rowLen);
      for (let i = 0; i < rowLen; i++) {
        const raw = data[p + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v;
        switch (type) {
          case 1: v = raw + a; break;
          case 2: v = raw + b; break;
          case 3: v = raw + ((a + b) >> 1); break;
          case 4: { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: v = raw;
        }
        cur[i] = v & 255;
      }
      p += rowLen; prev = cur;
    }
    return out;
  }

  async function inflate(u8) {
    const ds = new DecompressionStream("deflate");
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
  }

  // Returns an ImageBitmap/canvas for a PDF image stream we know how to read, else null.
  async function readPdfImage(ctx, s) {
    const d = s.dict, get = (k) => d.lookup(N(k));
    const im = get("ImageMask");
    if (im instanceof PDFBool && im.asBoolean()) return null;
    if (get("Decode")) return null;
    const fv = get("Filter"), pv = get("DecodeParms");
    const filters = fv instanceof PDFArray ? fv.asArray().map((x) => ctx.lookup(x)) : fv ? [fv] : [];
    const parmsList = pv instanceof PDFArray ? pv.asArray().map((x) => ctx.lookup(x)) : [pv];
    if (!filters.length) return null;
    const last = filters[filters.length - 1], parms = parmsList[filters.length - 1] || (filters.length === 1 ? pv : null);
    const plain = [N("ASCII85Decode"), N("ASCIIHexDecode"), N("A85"), N("AHx")];
    if (!filters.slice(0, -1).every((f) => plain.includes(f))) return null; // only text wrappers before the real filter
    const W = get("Width") && get("Width").asNumber(), H = get("Height") && get("Height").asNumber();
    if (!W || !H) return null;
    const n = channelsOf(ctx, get("ColorSpace"));
    if (!n) return null;

    if (last === N("DCTDecode")) {
      let jpg = s.contents;
      if (filters.length > 1) { // unwrap ASCII85/Hex, keep the JPEG
        const d2 = d.clone(ctx);
        d2.set(N("Filter"), ctx.obj(filters.slice(0, -1))); d2.delete(N("DecodeParms"));
        jpg = decodePDFRawStream(PDFRawStream.of(d2, s.contents)).decode();
      }
      return { src: await createImageBitmap(new Blob([jpg], { type: "image/jpeg" })), W, H };
    }
    if (last !== N("FlateDecode")) return null;
    const bpc = get("BitsPerComponent") && get("BitsPerComponent").asNumber();
    if (bpc !== 8) return null;
    let raw;
    try { raw = decodePDFRawStream(s).decode(); } catch (e) { if (filters.length > 1) return null; raw = await inflate(s.contents); }
    const pred = parms instanceof PDFDict && parms.lookup(N("Predictor")) ? parms.lookup(N("Predictor")).asNumber() : 1;
    if (pred >= 10) {
      const colsN = parms.lookup(N("Columns")), colN = parms.lookup(N("Colors"));
      raw = unpredict(raw, colsN ? colsN.asNumber() : W, colN ? colN.asNumber() : n, 8);
    } else if (pred !== 1) return null;
    if (raw.length < W * H * n) return null;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), id = g.createImageData(W, H), px = id.data;
    for (let i = 0, j = 0, k = W * H; i < k; i++, j += n) {
      const o = i * 4;
      if (n === 3) { px[o] = raw[j]; px[o + 1] = raw[j + 1]; px[o + 2] = raw[j + 2]; }
      else { px[o] = px[o + 1] = px[o + 2] = raw[j]; }
      px[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return { src: c, W, H };
  }

  async function recodePdfImage(ctx, ref, s, L) {
    if (s.contents.length < 12000) return 0; // tiny pictures: not worth it
    const img = await readPdfImage(ctx, s);
    if (!img) return 0;
    const k = Math.min(1, L.px / Math.max(img.W, img.H));
    const w = Math.max(1, Math.round(img.W * k)), h = Math.max(1, Math.round(img.H * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = "high"; g.drawImage(img.src, 0, 0, w, h);
    if (img.src.close) img.src.close(); else { img.src.width = img.src.height = 0; }
    const blob = await canvasToBlob(c, "image/jpeg", L.q);
    c.width = c.height = 0;
    if (!blob) return 0;
    const bytes = await blobBytes(blob);
    if (bytes.length >= s.contents.length * 0.92) return 0; // keep the original unless it really helps
    const nd = ctx.obj({});
    const skip = new Set(["Filter", "DecodeParms", "Length", "ColorSpace", "BitsPerComponent", "Width", "Height"].map(N));
    for (const [key, val] of s.dict.entries()) if (!skip.has(key)) nd.set(key, val);
    nd.set(N("Type"), N("XObject")); nd.set(N("Subtype"), N("Image"));
    nd.set(N("Width"), PDFNumber.of(w)); nd.set(N("Height"), PDFNumber.of(h));
    nd.set(N("ColorSpace"), N("DeviceRGB")); nd.set(N("BitsPerComponent"), PDFNumber.of(8));
    nd.set(N("Filter"), N("DCTDecode")); nd.set(N("Length"), PDFNumber.of(bytes.length));
    ctx.assign(ref, PDFRawStream.of(nd, bytes));
    return s.contents.length - bytes.length;
  }

  // drop objects nothing points to (old edits, orphaned pictures and fonts)
  function dropUnused(ctx) {
    const keep = new Set(), todo = [];
    const t = ctx.trailerInfo || {};
    for (const k of ["Root", "Info", "Encrypt"]) if (t[k]) todo.push(t[k]);
    while (todo.length) {
      const o = todo.pop();
      if (!o) continue;
      if (o instanceof PDFRef) { const key = o.toString(); if (keep.has(key)) continue; keep.add(key); todo.push(ctx.lookup(o)); }
      else if (o instanceof PDFDict) { for (const [, v] of o.entries()) todo.push(v); }
      else if (o instanceof PDFArray) { for (const v of o.asArray()) todo.push(v); }
      else if (o instanceof PDFStream) { todo.push(o.dict); }
    }
    if (!keep.size) return;
    for (const [ref] of ctx.enumerateIndirectObjects()) if (!keep.has(ref.toString())) ctx.delete(ref);
  }

  async function rasterPdf(bytes, L, step, name) {
    const task = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
    task.onPassword = (update, reason) => {
      const p = prompt(reason === 2 ? `Wrong password for ${name}. Try again:` : `${name} has a password. Type it to open:`);
      if (p === null) task.destroy(); else update(p);
    };
    const pdf = await task.promise;
    const out = await PDFDocument.create();
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        step && step(`Page ${i} of ${pdf.numPages}`);
        const page = await pdf.getPage(i), v1 = page.getViewport({ scale: 1 });
        const scale = Math.min(L.dpi / 72, 2200 / Math.max(v1.width, v1.height));
        const vp = page.getViewport({ scale });
        const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;
        const img = await out.embedJpg(await blobBytes(await canvasToBlob(c, "image/jpeg", L.q + 0.1)));
        out.addPage([v1.width, v1.height]).drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
        c.width = c.height = 0; page.cleanup();
      }
    } finally { pdf.destroy(); }
    return out;
  }

  // Shrink PDF bytes. Returns { bytes, note }.
  async function compressPdf(bytes, level, step, name = "This PDF") {
    const L = LEVELS[level] || LEVELS.balanced;
    let doc, note = "";
    if (L.raster) {
      doc = await rasterPdf(bytes, L, step, name);
      note = "Pages saved as pictures";
    } else {
      try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); }
      catch (e) {
        if (/encrypt/i.test(String(e && e.message))) throw new Error("This PDF is locked against changes. Pick Max to rebuild it as pictures.");
        throw new Error("This file couldn’t be read as a PDF.");
      }
      const ctx = doc.context, masks = new Set();
      const objs = ctx.enumerateIndirectObjects();
      for (const [, o] of objs) if (o instanceof PDFStream) for (const k of ["SMask", "Mask"]) { const v = o.dict.get(N(k)); if (v instanceof PDFRef) masks.add(v.toString()); }
      const imgs = objs.filter(([ref, o]) => o instanceof PDFRawStream && o.dict.lookup(N("Subtype")) === N("Image") && !masks.has(ref.toString()));
      let done = 0, smaller = 0;
      for (const [ref, s] of imgs) {
        done++; if (step && (done % 3 === 1 || done === imgs.length)) { step(`Picture ${done} of ${imgs.length}`); await sleep0(); }
        try { if (await recodePdfImage(ctx, ref, s, L)) smaller++; } catch (e) { console.warn("compress: picture kept as is", e); }
      }
      try { dropUnused(ctx); } catch (e) { console.warn("compress: cleanup skipped", e); }
      note = smaller ? `${smaller} picture${smaller === 1 ? "" : "s"} shrunk, text kept` : "Text and layout kept";
    }
    step && step("Saving…");
    const out = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    return { bytes: out, note };
  }

  /* ================= photos ================= */
  const IMG_EXT = /^(jpe?g|jfif|png|gif|webp|bmp|avif|heic|heif|tiff?|ico)$/;
  const isImage = (f) => /^image\//.test(f.type) || IMG_EXT.test(extOf(f.name));
  const MIME_EXT = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

  async function decodeAny(blob, name) {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch (e) {}
    const url = URL.createObjectURL(blob);
    try { const im = new Image(); im.src = url; await im.decode(); return await createImageBitmap(im); }
    catch (e) {
      const heic = /^(heic|heif)$/.test(extOf(name));
      throw new Error(heic ? "This browser can’t open HEIC photos. Open Statement Studio on a Mac (Safari) or export the photo as JPG first." : "This picture couldn’t be opened.");
    } finally { URL.revokeObjectURL(url); }
  }
  function hasAlpha(canvas) {
    const s = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(canvas.width * s)); c.height = Math.max(1, Math.round(canvas.height * s));
    const g = c.getContext("2d"); g.drawImage(canvas, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }
  let webpOk = null;
  async function canWebp() {
    if (webpOk !== null) return webpOk;
    const c = document.createElement("canvas"); c.width = c.height = 2;
    const b = await canvasToBlob(c, "image/webp", 0.8); webpOk = !!b && b.type === "image/webp"; return webpOk;
  }

  async function compressPhoto(file, level, fmt, maxPx) {
    const L = LEVELS[level] || LEVELS.balanced;
    const bmp = await decodeAny(file, file.name);
    const limit = maxPx || L.imgPx;
    const k = Math.min(1, limit / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const ext = extOf(file.name), srcMime = file.type || (ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext ? "image/" + ext : "");
    const alpha = !/jpe?g|jfif/.test(ext) && !/jpeg/.test(srcMime) && hasAlpha(c);
    let type = fmt;
    if (fmt === "auto") type = alpha ? "image/webp" : /webp/.test(srcMime) ? "image/webp" : "image/jpeg";
    if (type === "image/webp" && !(await canWebp())) type = alpha ? "image/png" : "image/jpeg";
    if (type === "image/jpeg") { // JPG has no transparency: put it on white
      const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
      const g2 = c2.getContext("2d"); g2.fillStyle = "#fff"; g2.fillRect(0, 0, w, h); g2.drawImage(c, 0, 0);
      c.width = c.height = 0; return finishPhoto(file, c2, type, L, k, fmt);
    }
    return finishPhoto(file, c, type, L, k, fmt);
  }
  async function finishPhoto(file, c, type, L, k, fmt) {
    const blob = await canvasToBlob(c, type, L.imgQ);
    const w = c.width, h = c.height; c.width = c.height = 0;
    if (!blob) throw new Error("This picture couldn’t be saved.");
    const sameType = (file.type || "").replace("jpg", "jpeg") === blob.type;
    const bits = [`${w}×${h}`];
    if (k < 1) bits.push("resized");
    if (!sameType) bits.push(`saved as ${MIME_EXT[blob.type].toUpperCase()}`);
    if (blob.size >= file.size && (sameType || fmt === "auto")) {
      return { blob: file, name: file.name, note: "Already as small as it gets", kept: true };
    }
    const ext = MIME_EXT[blob.type] || "jpg";
    return { blob, name: `${stem(file.name)} (compressed).${ext}`, note: bits.join(" · ") };
  }

  /* ================= Office files & everything else ================= */
  const OFFICE = /^(docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm|pptx|pptm|potx|ppsx|odt|ods|odp|odg|epub|vsdx|xps|oxps)$/;
  const PACKED = /^(zip|7z|rar|gz|tgz|bz2|xz|zst|mp4|m4v|mov|mkv|webm|avi|wmv|mp3|m4a|aac|ogg|oga|opus|flac|wma|jar|apk|ipa|dmg|pkg|msi)$/;

  async function shrinkZipPictures(zip, L, step) {
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && /\.(jpe?g|png)$/i.test(n));
    let smaller = 0, i = 0;
    for (const n of names) {
      i++; step && step(`Picture ${i} of ${names.length}`);
      try {
        const data = await zip.file(n).async("uint8array");
        if (data.length < 30000) continue;
        const png = /\.png$/i.test(n);
        const bmp = await createImageBitmap(new Blob([data], { type: png ? "image/png" : "image/jpeg" }));
        const k = Math.min(1, L.px / Math.max(bmp.width, bmp.height));
        if (png && k >= 1) { bmp.close(); continue; } // re-saving a PNG at the same size rarely helps
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d");
        if (!png) { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); }
        g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, w, h); bmp.close();
        const b = await canvasToBlob(c, png ? "image/png" : "image/jpeg", L.q + 0.06);
        c.width = c.height = 0;
        if (b && b.size < data.length * 0.92) { zip.file(n, await blobBytes(b)); smaller++; }
      } catch (e) { console.warn("compress: kept", n, e); }
    }
    return smaller;
  }

  async function compressOffice(file, level, step) {
    const L = LEVELS[level] || LEVELS.balanced;
    let zip;
    try { zip = await JSZip.loadAsync(file); } catch (e) { throw new Error("This file is damaged or protected with a password."); }
    const smaller = await shrinkZipPictures(zip, L, step);
    if (zip.file("mimetype")) zip.file("mimetype", await zip.file("mimetype").async("uint8array"), { compression: "STORE" }); // ODF/EPUB rule
    step && step("Packing…");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 }, mimeType: file.type || "application/octet-stream" });
    return { blob, name: `${stem(file.name)} (compressed).${extOf(file.name)}`, note: smaller ? `${smaller} picture${smaller === 1 ? "" : "s"} shrunk, format kept` : "Format kept" };
  }

  async function compressOther(file, step) {
    const ext = extOf(file.name);
    if (ext === "zip") {
      let zip; try { zip = await JSZip.loadAsync(file); } catch (e) { throw new Error("This .zip is damaged or uses encryption."); }
      step && step("Re-packing…");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } });
      return { blob, name: `${stem(file.name)} (compressed).zip`, note: "Re-packed at the highest setting" };
    }
    step && step("Packing into .zip…");
    const zip = new JSZip();
    zip.file(file.name, file, { date: file.lastModified ? new Date(file.lastModified) : new Date() });
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const why = PACKED.test(ext) ? "Video, music and archive files are already compressed" : "";
    return { blob, name: `${file.name}.zip`, note: why || "Packed into a .zip (unzip to use it)" };
  }

  /* ================= one file → result ================= */
  function kindOf(f) {
    const e = extOf(f.name);
    if (/pdf/i.test(f.type) || e === "pdf") return "pdf";
    if (isImage(f)) return "img";
    if (OFFICE.test(e)) return "office";
    return "other";
  }
  async function compressFile(f, opt, step) {
    const kind = kindOf(f);
    let r;
    if (kind === "pdf") {
      const { bytes, note } = await compressPdf(new Uint8Array(await f.arrayBuffer()), opt.level, step, f.name);
      r = { blob: new Blob([bytes], { type: "application/pdf" }), name: `${stem(f.name)} (compressed).pdf`, note };
    } else if (kind === "img") r = await compressPhoto(f, opt.level, opt.fmt, opt.px);
    else if (kind === "office") r = await compressOffice(f, opt.level, step);
    else r = await compressOther(f, step);
    if (!r.kept && r.blob.size >= f.size && kind !== "img") {
      const why = kind === "other" && PACKED.test(extOf(f.name)) ? "Already compressed: nothing to save" : "Already as small as it gets";
      r = { blob: f, name: f.name, note: why, kept: true };
    }
    return r;
  }

  /* ================= the "Compress files" view ================= */
  const $c = (s) => document.querySelector(s);
  const view = $c("#cz"), list = $c("#cz-list"), drop = $c("#cz-drop"), pick = $c("#cz-picker");
  if (!view) return;
  const rows = []; // { file, el, state, res }
  let queue = Promise.resolve(), gen = 0;

  const level = () => (document.querySelector('input[name="czlevel"]:checked') || {}).value || "balanced";
  const opts = () => ({ level: level(), fmt: $c("#cz-fmt").value, px: +$c("#cz-px").value || 0 });
  const TYPE = (f) => { const e = extOf(f.name), k = kindOf(f); return { label: (e || "file").slice(0, 4).toUpperCase(), cls: k === "pdf" ? "pdf" : k === "img" ? "img" : /^(doc|odt|rtf)/.test(e) ? "doc" : /^(xls|ods|csv)/.test(e) ? "xls" : /^(ppt|pps|pot|odp)/.test(e) ? "ppt" : e === "zip" ? "zip" : "" }; };

  function paintRow(r) {
    const t = TYPE(r.file);
    r.el.innerHTML = `<div class="cz-type ${t.cls}"></div><div class="cz-info"><div class="cz-name"></div><div class="cz-meta"></div><div class="cz-note"></div><div class="cz-bar2"><i></i></div></div><div class="cz-act"></div>`;
    r.el.querySelector(".cz-type").textContent = t.label;
    r.el.querySelector(".cz-name").textContent = r.file.name; r.el.querySelector(".cz-name").title = r.file.name;
    const meta = r.el.querySelector(".cz-meta"), note = r.el.querySelector(".cz-note"), bar = r.el.querySelector(".cz-bar2"), act = r.el.querySelector(".cz-act");
    const orig = document.createElement("span"); orig.textContent = fmtSize(r.file.size); meta.append(orig);
    if (r.state === "done") {
      const nw = r.res.blob.size, p = r.res.kept ? 0 : pct(r.file.size, nw);
      meta.insertAdjacentHTML("beforeend", `<span class="arrow">→</span><span class="new"></span><span class="cz-pct${p > 0 ? "" : " zero"}"></span>`);
      meta.querySelector(".new").textContent = fmtSize(nw);
      meta.querySelector(".cz-pct").textContent = p > 0 ? `−${p}%` : "0%";
      note.textContent = r.res.note || ""; bar.hidden = true;
      const save = document.createElement("button"); save.className = "btn"; save.type = "button"; save.textContent = "Save";
      save.title = r.res.name; save.onclick = () => download(r.res.blob, r.res.name, r.res.blob.type);
      act.append(save);
    } else if (r.state === "error") {
      note.textContent = r.err; note.classList.add("err"); bar.hidden = true;
    } else {
      note.textContent = r.step || (r.state === "wait" ? "Waiting…" : "Working…");
      bar.classList.add("work");
    }
    const x = document.createElement("button"); x.className = "x"; x.type = "button"; x.textContent = "✕"; x.setAttribute("aria-label", `Remove ${r.file.name}`);
    x.onclick = () => { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); r.dead = true; r.el.remove(); totals(); };
    act.append(x);
  }
  function totals() {
    const done = rows.filter((r) => r.state === "done");
    const busyN = rows.filter((r) => r.state === "wait" || r.state === "work").length;
    const before = done.reduce((s, r) => s + r.file.size, 0), after = done.reduce((s, r) => s + r.res.blob.size, 0);
    const el = $c("#cz-total");
    if (!rows.length) el.textContent = "";
    else if (busyN) el.textContent = `Working on ${busyN} of ${rows.length}…`;
    else if (done.length) { el.innerHTML = `${fmtSize(before)} → ${fmtSize(after)} · saved <b></b>`; el.querySelector("b").textContent = `${fmtSize(Math.max(0, before - after))} (${Math.max(0, pct(before, after))}%)`; }
    else el.textContent = "";
    $c("#cz-all").disabled = !done.length || !!busyN;
    $c("#cz-all").textContent = done.length > 1 ? `Download all (${done.length}) as .zip` : "Download";
    $c("#cz-redo").disabled = !rows.length || !!busyN;
    $c("#cz-clear").disabled = !rows.length || !!busyN;
  }
  function enqueue(r) {
    const my = gen;
    r.state = "wait"; paintRow(r); totals();
    queue = queue.then(async () => {
      if (r.dead || my !== gen) return;
      r.state = "work"; r.step = ""; paintRow(r); totals();
      const noteEl = () => r.el.querySelector(".cz-note");
      try {
        r.res = await compressFile(r.file, opts(), (s) => { r.step = s; const n = noteEl(); if (n) n.textContent = s; });
        r.state = "done";
      } catch (e) { console.error(e); r.state = "error"; r.err = (e && e.message) || String(e); }
      if (!r.dead) paintRow(r);
      totals();
      await sleep0();
    });
  }
  function addFiles(files) {
    for (const file of files) {
      const r = { file, el: document.createElement("div"), state: "wait" };
      r.el.className = "cz-row"; rows.push(r); list.append(r.el); enqueue(r);
    }
  }

  function openView() {
    view.hidden = false; document.body.classList.add("cz-on");
    paintHint(); $c("#cz-back").focus();
  }
  function closeView() { view.hidden = true; document.body.classList.remove("cz-on"); drop.classList.remove("hot"); }
  function paintHint() { $c("#cz-lvlhint").textContent = (LEVELS[level()] || LEVELS.balanced).hint; }

  $c("#cz-back").onclick = closeView;
  document.querySelectorAll("[data-cz-open]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openView(); }));
  drop.addEventListener("click", () => { pick.value = ""; pick.click(); });
  pick.addEventListener("change", () => { if (pick.files.length) addFiles([...pick.files]); });
  document.querySelectorAll('input[name="czlevel"]').forEach((i) => i.addEventListener("change", paintHint));
  $c("#cz-redo").onclick = () => { gen++; queue = Promise.resolve(); for (const r of rows) enqueue(r); };
  $c("#cz-clear").onclick = () => { gen++; rows.splice(0).forEach((r) => { r.dead = true; r.el.remove(); }); totals(); };
  $c("#cz-all").onclick = async () => {
    const done = rows.filter((r) => r.state === "done");
    if (done.length === 1) return download(done[0].res.blob, done[0].res.name, done[0].res.blob.type);
    const zip = new JSZip(), used = new Set();
    for (const r of done) {
      let n = r.res.name, i = 2;
      while (used.has(n.toLowerCase())) n = `${stem(r.res.name)} ${i++}${r.res.name.slice(stem(r.res.name).length)}`;
      used.add(n.toLowerCase()); zip.file(n, r.res.blob, { compression: "STORE" });
    }
    download(await zip.generateAsync({ type: "blob" }), "Compressed files.zip", "application/zip");
    toast(`Downloaded Compressed files.zip with ${plural(done.length, "file")}`, "ok");
  };

  // while the view is open it owns drag-and-drop and the keyboard
  const open = () => !view.hidden;
  let depth = 0;
  const own = (e) => { if (!open()) return false; e.stopImmediatePropagation(); return true; };
  window.addEventListener("dragenter", (e) => { if (!own(e)) return; e.preventDefault(); if (e.dataTransfer && e.dataTransfer.types.includes("Files")) { depth++; drop.classList.add("hot"); } }, true);
  window.addEventListener("dragleave", (e) => { if (!own(e)) return; depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove("hot"); }, true);
  window.addEventListener("dragover", (e) => { if (!own(e)) return; e.preventDefault(); }, true);
  window.addEventListener("drop", (e) => { if (!own(e)) return; e.preventDefault(); depth = 0; drop.classList.remove("hot"); if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); }, true);
  window.addEventListener("keydown", (e) => {
    if (!open()) return;
    e.stopImmediatePropagation();
    const typing = e.target.matches && e.target.matches("input,select,textarea");
    if (e.key === "Escape") { e.preventDefault(); closeView(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !typing) e.preventDefault();
    else if ((e.key === "Enter" || e.key === " ") && e.target === drop) { e.preventDefault(); drop.click(); }
  }, true);

  /* ================= "Make my PDF smaller" in the editor ================= */
  const on = $c("#con"), tag = $c("#comptag");
  const editorLevel = () => (document.querySelector('input[name="clevel"]:checked') || {}).value || "balanced";
  if (on && typeof makeFile === "function") {
    const inner = makeFile;
    // only real downloads are compressed: not the stamp preview or the hand-off to Convert
    makeFile = async function (items, globalIdx, total, opt = {}) {
      const bytes = await inner(items, globalIdx, total, opt);
      if (!on.checked || !opt.title || opt.compress === false || opt.noMarks) return bytes;
      try {
        const r = await compressPdf(bytes, editorLevel(), opt.progress, opt.title);
        return r.bytes.length < bytes.length ? r.bytes : bytes;
      } catch (e) { console.warn("compress on download skipped", e); return bytes; }
    };
    const sync = () => {
      if (tag) tag.hidden = !on.checked;
      const box = $c("#stamptags");
      if (box && on.checked && !box.querySelector(".cz-stamp")) {
        const s = document.createElement("span"); s.className = "cz-stamp"; s.textContent = "+ smaller file"; box.append(s);
      } else if (box && !on.checked) box.querySelectorAll(".cz-stamp").forEach((s) => s.remove());
      const h = $c("#clvlhint"); if (h) h.textContent = (LEVELS[editorLevel()] || LEVELS.balanced).hint;
    };
    if (typeof changed === "function") { const inner2 = changed; changed = function (label) { inner2(label); sync(); }; }
    on.addEventListener("change", sync);
    document.querySelectorAll('input[name="clevel"]').forEach((i) => i.addEventListener("change", () => { if (!on.checked) on.checked = true; sync(); }));
    sync();
  }

  window.SSCompress = { compressPdf, compressFile, LEVELS };
})();
