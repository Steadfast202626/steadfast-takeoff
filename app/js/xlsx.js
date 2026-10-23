/*
 * Steadfast takeoff: reads the first sheet of an Excel (.xlsx) file into rows of cells.
 * Enough for a Monday.com board export. No packages: unzips with the browser's DecompressionStream.
 * Works in the browser (SteadfastXlsx) and in Node 20+ (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SteadfastXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // { name: Uint8Array } for every file in the zip.
  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('Not an Excel file.');
    const count = dv.getUint16(end + 10, true);
    let p = dv.getUint32(end + 16, true);
    const out = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged Excel file.');
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      out[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function decodeXml(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&');
  }

  function textOf(xml) {
    let t = '';
    const re = /<t[^>]*>([\s\S]*?)<\/t>|<t[^>]*\/>/g;
    let m;
    while ((m = re.exec(xml))) t += m[1] ? decodeXml(m[1]) : '';
    return t;
  }

  function colIndex(ref) {
    const letters = ref.replace(/\d+/g, '');
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // Rows of the first sheet: [[cell, ...], ...]. Cells are strings or numbers.
  async function readXlsx(buffer) {
    const files = await unzip(buffer);
    const dec = new TextDecoder();
    const read = name => (files[name] ? dec.decode(files[name]) : '');

    // Find the first sheet through the workbook and its relationships
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = read('xl/workbook.xml');
    const rels = read('xl/_rels/workbook.xml.rels');
    const first = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
    if (first && rels) {
      const rel = rels.match(new RegExp('<Relationship\\b[^>]*Id="' + first[1] + '"[^>]*>')) ;
      const target = rel && rel[0].match(/Target="([^"]+)"/);
      if (target) sheetPath = target[1].startsWith('/') ? target[1].slice(1) : 'xl/' + target[1].replace(/^\.\//, '');
    }
    const sheet = read(sheetPath);
    if (!sheet) throw new Error('No worksheet found in the Excel file.');

    const shared = [];
    const ss = read('xl/sharedStrings.xml');
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(ss))) shared.push(textOf(m[1]));

    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    while ((m = rowRe.exec(sheet))) {
      const row = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let c, auto = 0;
      while ((c = cellRe.exec(m[1]))) {
        const attrs = c[1];
        const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
        const idx = ref ? colIndex(ref) : auto;
        auto = idx + 1;
        const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
        const body = c[2] || '';
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = '';
        if (type === 's') value = v !== undefined ? shared[+v] || '' : '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'str' || type === 'e') value = v !== undefined ? decodeXml(v) : '';
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) value = isFinite(+v) ? +v : decodeXml(v);
        while (row.length < idx) row.push('');
        row[idx] = value;
      }
      rows.push(row);
    }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }

  return { readXlsx, unzip };
});
