/*
 * Steadfast takeoff: drawing files (PDF sets and photos of plans).
 * Files are attached by name. Each PDF page or photo is one sheet.
 */
(function () {
  'use strict';

  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const MAX_SIDE = 8192;          // largest page bitmap, in pixels
  const MAX_PIXELS = 36e6;

  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

  const files = new Map();        // file name -> { kind: 'pdf', doc } | { kind: 'image', img }
  const bitmaps = new Map();      // sheet id -> { scale, canvas }
  const pending = new Map();      // sheet id -> { scale, task }

  function isPdf(name, type) {
    return type === 'application/pdf' || /\.pdf$/i.test(name);
  }

  async function open(name, type, data) {
    if (isPdf(name, type)) {
      if (!window.pdfjsLib) throw new Error('The PDF reader did not load. Check the internet connection.');
      // pdf.js takes ownership of the buffer it is given, so hand it a copy
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
      files.set(name, { kind: 'pdf', doc });
    } else {
      const url = URL.createObjectURL(new Blob([data], { type: type || 'image/png' }));
      const img = new Image();
      img.src = url;
      await img.decode();
      files.set(name, { kind: 'image', img });
    }
    for (const id of [...bitmaps.keys()]) if (id.startsWith(name + '\u0000')) bitmaps.delete(id);
    return files.get(name);
  }

  // Sheet number from the title block: the largest sheet-number-like text, favouring the bottom right.
  async function guessSheetName(page, viewport) {
    try {
      const content = await page.getTextContent();
      let best = null;
      for (const item of content.items) {
        if (!item.str) continue;
        const [a, b, , , e, f] = item.transform;
        const size = Math.hypot(a, b);
        const [x, y] = viewport.convertToViewportPoint(e, f);
        for (const token of item.str.trim().split(/\s+/)) {
          if (!/^[A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,2})?[A-Z]?$/.test(token)) continue;
          const inTitleBlock = x > viewport.width * 0.6 && y > viewport.height * 0.6;
          const score = size * (inTitleBlock ? 3 : 1);
          if (!best || score > best.score) best = { token, score };
        }
      }
      return best ? best.token : null;
    } catch (e) {
      return null;
    }
  }

  // Pages of an opened file: [{ page, kind, widthPt, heightPt, suggestedName }]
  async function pages(name) {
    const f = files.get(name);
    if (!f) return [];
    if (f.kind === 'image') {
      return [{ page: 1, kind: 'image', widthPt: f.img.naturalWidth, heightPt: f.img.naturalHeight, suggestedName: null }];
    }
    const out = [];
    for (let i = 1; i <= f.doc.numPages; i++) {
      const page = await f.doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      out.push({ page: i, kind: 'pdf', widthPt: vp.width, heightPt: vp.height, suggestedName: await guessSheetName(page, vp) });
    }
    return out;
  }

  function isAttached(name) {
    return files.has(name);
  }

  function key(sheet) {
    return sheet.file + '\u0000' + sheet.page;
  }

  // The best bitmap we have for a sheet now (may be lower resolution than wanted), or null.
  function bitmap(sheet) {
    const f = files.get(sheet.file);
    if (!f) return null;
    if (f.kind === 'image') return { source: f.img, scale: 1 };
    const b = bitmaps.get(key(sheet));
    return b ? { source: b.canvas, scale: b.scale } : null;
  }

  // Ask for a bitmap at a scale (pixels per point). Calls done() when a better one is ready.
  function request(sheet, wantScale, done) {
    const f = files.get(sheet.file);
    if (!f || f.kind !== 'pdf') return;
    const k = key(sheet);
    const capped = Math.min(wantScale, MAX_SIDE / Math.max(sheet.widthPt, sheet.heightPt),
      Math.sqrt(MAX_PIXELS / (sheet.widthPt * sheet.heightPt)));
    const have = bitmaps.get(k);
    if (have && have.scale >= capped * 0.75 && have.scale <= capped * 2.5) return;
    const p = pending.get(k);
    if (p && Math.abs(p.scale - capped) / capped < 0.2) return;
    if (p) p.task.cancel();

    f.doc.getPage(sheet.page).then(page => {
      const vp = page.getViewport({ scale: capped });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const task = page.render({ canvasContext: ctx, viewport: vp });
      pending.set(k, { scale: capped, task });
      task.promise.then(() => {
        pending.delete(k);
        bitmaps.set(k, { scale: capped, canvas });
        done();
      }, () => {
        if (pending.get(k) && pending.get(k).task === task) pending.delete(k);
      });
    });
  }

  // Render a sheet at a scale (pixels per point) into a new canvas, for the sheet image.
  async function renderAt(sheet, scale) {
    const f = files.get(sheet.file);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sheet.widthPt * scale);
    canvas.height = Math.round(sheet.heightPt * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!f) return canvas;
    if (f.kind === 'image') {
      ctx.drawImage(f.img, 0, 0, canvas.width, canvas.height);
      return canvas;
    }
    const page = await f.doc.getPage(sheet.page);
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;
    return canvas;
  }

  window.SteadfastDrawings = { open, pages, isAttached, bitmap, request, isPdf, renderAt };
})();
