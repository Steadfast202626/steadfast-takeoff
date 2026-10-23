/*
 * Steadfast takeoff: working with the Claude estimator, and exports.
 * Import from estimator (preview, then import with a summary), Copy for estimator, Sheet image for
 * estimator, and the lines CSV for the Monday.com Estimates board.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const Drawings = window.SteadfastDrawings;
  const { el, button, showDialog, download, pickFile, checkbox } = window.SteadfastUI;

  // ---------- Import from estimator ----------

  function reportList(title, items, cls) {
    if (!items.length) return null;
    return el('details', { open: items.length <= 12 }, el('summary', { className: cls || '', textContent: title + ' (' + items.length + ')' }),
      el('ul', {}, items.map(t => el('li', { textContent: t }))));
  }

  async function importFromEstimator(app) {
    const ta = el('textarea', { rows: 12, className: 'mono', placeholder: 'Paste the import file here, or open it' });
    const openBtn = button('Open file', 'Choose the estimator\'s .json import file', async () => {
      const f = await pickFile('.json,application/json');
      if (f) ta.value = await f.text();
    });
    const step1 = el('div', {}, el('p', { textContent: 'The import only adds. Everything it adds is marked for your check.' }), ta, el('div', { className: 'row-buttons' }, openBtn));
    const go = await showDialog('Import from estimator', step1, [
      ['Cancel', 'Close without importing', null],
      ['Preview', 'Show what the import would add, without changing anything', 'preview', true]
    ], true);
    if (go !== 'preview') return;

    let imp;
    try {
      imp = JSON.parse(ta.value);
    } catch (e) {
      return showDialog('Import from estimator', el('p', { className: 'warn-text', textContent: 'That is not readable JSON: ' + e.message }), [['Close', 'Close this message', null, true]]);
    }
    const v = calc.validate(imp);
    const problems = v.kind === 'import' ? v.errors : (calc.openImportProblems(imp).length ? calc.openImportProblems(imp) : v.errors);
    if (problems.length) {
      return showDialog('Import from estimator', el('div', {}, el('p', { textContent: 'The file cannot be imported:' }),
        el('ul', {}, problems.map(p => el('li', { className: 'warn-text', textContent: p })))), [['Close', 'Close this message', null, true]]);
    }

    const preview = calc.applyImport(app.est, imp);
    const r = preview.report;
    const body = el('div', {},
      imp.summary ? el('p', {}, el('strong', { textContent: 'Estimator: ' }), imp.summary) : null,
      el('p', { textContent: r.added.length + ' to add, ' + r.skipped.length + ' skipped. ' + r.waiting + ' items will wait for your check.' }),
      reportList('Will add', r.added),
      reportList('Skipped', r.skipped, 'warn-text'),
      reportList('Notes', r.notes.concat(v.warnings), 'warn-text'),
      r.priceChanges.length ? el('p', { textContent: r.priceChanges.length + ' price changes suggested. You accept them one by one after the import.' }) : null);
    const ok = await showDialog('Import preview', body, [
      ['Cancel', 'Close without importing', null],
      ['Import', 'Add these items to the estimate', 'import', true]
    ], true);
    if (ok !== 'import') return;

    app.change(() => { app.est = preview.est; });
    app.setStatus('Imported: ' + r.added.length + ' added, ' + r.waiting + ' waiting for your check', false, 8000);
    await importSummary(app, imp, r);
  }

  async function importSummary(app, imp, r) {
    const body = el('div', {},
      el('p', { textContent: r.added.length + ' added. ' + r.skipped.length + ' skipped. ' + r.waiting + ' items wait for your check: they show dashed with a "?" on the drawings.' }),
      reportList('Added', r.added),
      reportList('Skipped, and why', r.skipped, 'warn-text'),
      reportList('Notes', r.notes, 'warn-text'));
    if (r.priceChanges.length) {
      const table = el('table', { className: 'grid compact' }, el('thead', {}, el('tr', {},
        ['Code', 'Item', 'Now', 'Suggested', 'Source', ''].map(h => el('th', { textContent: h })))));
      const tbody = el('tbody');
      for (const p of r.priceChanges) {
        const cell = el('td');
        const accept = button('Accept', 'Use this cost in this job. Update Monday.com too.', () => {
          app.change(est => {
            const item = est.priceBook.find(x => x.code === p.code);
            if (!item) return;
            item.unitCost = p.to;
            item.source = (p.source ? p.source + '. ' : '') + 'Update in Monday.com.';
            item.updated = calc.today();
          });
          cell.textContent = 'Accepted';
        }, 'small primary');
        cell.append(accept);
        tbody.append(el('tr', {},
          el('td', { className: 'mono', textContent: p.code }), el('td', { textContent: p.item }),
          el('td', { className: 'num', textContent: p.from === null || p.from === undefined ? 'No cost' : calc.fmtMoney(p.from) }),
          el('td', { className: 'num', textContent: calc.fmtMoney(p.to) + '/' + p.unit }),
          el('td', { textContent: p.source }), cell));
      }
      table.append(tbody);
      body.append(el('h4', { textContent: 'Suggested price changes' }), el('p', { className: 'note', textContent: 'Accepted costs apply to this job only. The master price book is on Monday.com.' }), table);
    }
    await showDialog('Import summary', body, [['Close', 'Close the summary', null, true]], true);
  }

  // ---------- Copy for estimator ----------

  async function copyForEstimator(app) {
    const text = JSON.stringify(app.est, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      app.setStatus('Estimate copied. Paste it into the chat with the estimator.', false, 6000);
    } catch (e) {
      const ta = el('textarea', { rows: 14, className: 'mono', value: text, readOnly: true });
      const p = showDialog('Copy for estimator', el('div', {}, el('p', { textContent: 'Copy this text (Ctrl+A, then Ctrl+C) and paste it into the chat with the estimator.' }), ta),
        [['Close', 'Close this box', null, true]], true);
      setTimeout(() => { ta.focus(); ta.select(); }, 50);
      await p;
    }
  }

  // ---------- Sheet image for estimator ----------

  const LONG_SIDE = 2400;
  const MARGIN = 56;

  function drawMarkups(ctx, est, sheet, ox, oy, w, h) {
    const conds = new Map(est.conditions.map(c => [c.id, c]));
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const m of est.measurements) {
      if (m.sheetId !== sheet.id) continue;
      const c = conds.get(m.conditionId);
      if (!c) continue;
      const pts = m.points.map(p => [ox + p[0] * w, oy + p[1] * h]);
      ctx.strokeStyle = c.color;
      ctx.fillStyle = c.color;
      ctx.setLineDash(m.status === 'check' ? [12, 8] : []);
      if (c.measure === 'count') {
        for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.fill(); }
      } else {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        if (c.measure === 'area') {
          ctx.closePath();
          ctx.globalAlpha = 0.2;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = c.measure === 'wall' ? 7 : 4;
        ctx.stroke();
      }
      const at = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
      ctx.setLineDash([]);
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'center';
      const text = (m.status === 'check' ? '? ' : '') + c.name + (m.note ? ' · ' + m.note : '');
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(text, at[0], at[1]);
      ctx.fillStyle = '#222';
      ctx.fillText(text, at[0], at[1]);
    }
    ctx.restore();
  }

  function drawGrid(ctx, ox, oy, w, h) {
    ctx.save();
    ctx.font = '16px Arial';
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const major = i % 2 === 0;
      const x = ox + t * w, y = oy + t * h;
      // Faint lines across the sheet every 0.1
      if (major) {
        ctx.strokeStyle = 'rgba(83, 65, 44, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + w, y); ctx.stroke();
      }
      // Ticks on all four edges every 0.05, labels every 0.1
      ctx.strokeStyle = '#53412c';
      ctx.lineWidth = 2;
      const len = major ? 14 : 8;
      ctx.beginPath();
      ctx.moveTo(x, oy); ctx.lineTo(x, oy - len);
      ctx.moveTo(x, oy + h); ctx.lineTo(x, oy + h + len);
      ctx.moveTo(ox, y); ctx.lineTo(ox - len, y);
      ctx.moveTo(ox + w, y); ctx.lineTo(ox + w + len, y);
      ctx.stroke();
      if (major) {
        const label = t.toFixed(1);
        ctx.fillStyle = '#53412c';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x, oy - 16);
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, oy + h + 16);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.fillText(label, ox - 17, y);
        ctx.textAlign = 'left';
        ctx.fillText(label, ox + w + 17, y);
      }
    }
    ctx.strokeStyle = '#53412c';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, w, h);
    ctx.restore();
  }

  async function sheetImage(app) {
    const sheet = app.currentSheet();
    if (!sheet) return app.setStatus('Open a sheet first', true, 4000);
    if (!Drawings.isAttached(sheet.file)) return app.setStatus('Re-attach ' + sheet.file + ' first', true, 6000);
    app.setStatus('Making the sheet image…');
    const scale = LONG_SIDE / Math.max(sheet.widthPt, sheet.heightPt);
    const art = await Drawings.renderAt(sheet, scale);
    const out = document.createElement('canvas');
    out.width = art.width + MARGIN * 2;
    out.height = art.height + MARGIN * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(art, MARGIN, MARGIN);
    drawMarkups(ctx, app.est, sheet, MARGIN, MARGIN, art.width, art.height);
    drawGrid(ctx, MARGIN, MARGIN, art.width, art.height);
    ctx.font = '15px Arial';
    ctx.fillStyle = '#222';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(sheet.name + ' · ' + (sheet.scaleLabel || 'no scale') + ' · x across, y down, from the top-left corner', MARGIN, 6);
    out.toBlob(blob => {
      download(calc.documentName('Sheet image', sheet.name, 'png'), blob);
      app.setStatus('Sheet image saved. Give it to the estimator with the drawing.', false, 6000);
    }, 'image/png');
  }

  // ---------- Lines CSV for Monday.com ----------

  async function linesCsv(app) {
    let withCosts = false;
    const body = el('div', {},
      el('p', { textContent: 'One row per estimate line, for the Monday.com Estimates board.' }),
      el('label', { className: 'check', title: 'Unit costs and totals. Only for boards the owners alone can see.' },
        checkbox(false, v => { withCosts = v; }), 'Include costs (owners only)'));
    const ok = await showDialog('Lines for Monday.com', body, [
      ['Cancel', 'Close without saving', null],
      ['Save CSV', 'Save the lines as a CSV file', 'save', true]
    ]);
    if (ok !== 'save') return;
    const csv = window.SteadfastOutputs.linesCsv(app.est, withCosts);
    download(calc.documentName('Estimate lines', app.est.job.name, 'csv'), '﻿' + csv, 'text/csv');
  }

  window.SteadfastExchange = {
    actions: {
      'import-estimator': importFromEstimator,
      'copy-estimator': copyForEstimator,
      'sheet-image': sheetImage,
      'lines-csv': linesCsv,
      'pricebook-import': app => window.SteadfastPriceBook.importMonday(app)
    }
  };
})();
