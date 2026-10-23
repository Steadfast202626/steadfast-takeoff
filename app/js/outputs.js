/*
 * Steadfast takeoff: printed documents and exports.
 * quoteHtml: the customer quote. No costs, markup or margin anywhere in it.
 * internalHtml: the full estimate, owners only.
 * linesCsv: estimate lines for the Monday.com Estimates board.
 * Works in the browser (SteadfastOutputs) and in Node (require), so the tests can read the quote.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.SteadfastOutputs = factory(root.SteadfastCalc);
})(typeof self !== 'undefined' ? self : this, function (calc) {
  'use strict';

  const COMPANY = {
    name: 'Steadfast Constructions Ltd',
    address: ['10060 Jasper Avenue NW, Tower 1, Suite 2020', 'Edmonton, Alberta'],
    phone: '780-300-9990',
    email: 'team@steadfastconstructionsltd.com'
  };

  // The sample job is recognised by its drawing, so the band follows it into saved files and printouts.
  const SAMPLE_FILE = 'Steadfast sample plan.pdf';
  const SAMPLE_BAND = 'Sample job with made-up prices. Not for quoting.';

  function isSample(est) {
    return !!est && Array.isArray(est.sheets) && est.sheets.some(s => s.file === SAMPLE_FILE);
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const money = v => calc.fmtMoney(v);

  function addDays(date, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !(days >= 0)) return '';
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + Number(days));
    return d.toISOString().slice(0, 10);
  }

  function page(title, footer, body, est) {
    if (isSample(est)) body = '<div class="sample">' + SAMPLE_BAND + '</div>' + body;
    return '<!doctype html>\n<html lang="en-CA"><head><meta charset="utf-8"><title>' + esc(title) + '</title>\n<style>\n' +
      '@page { size: letter; margin: 18mm 16mm 20mm;\n' +
      '  @bottom-left { content: "Page " counter(page) " of " counter(pages); font: 9pt Arial, sans-serif; color: #555; }\n' +
      '  @bottom-right { content: "' + esc(footer) + '"; font: 9pt Arial, sans-serif; color: #555; } }\n' +
      'body { font: 10.5pt/1.4 Arial, sans-serif; color: #222; margin: 0; }\n' +
      '.sheet { max-width: 8in; margin: 0 auto; padding: 24px; }\n' +
      '@media print { .sheet { padding: 0; max-width: none; } .no-print { display: none; } }\n' +
      '.no-print { text-align: right; margin-bottom: 12px; }\n' +
      '.no-print button { font: 10pt Arial, sans-serif; padding: 6px 14px; border: 1px solid #53412c; background: #53412c; color: #fff; border-radius: 4px; cursor: pointer; }\n' +
      'header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #53412c; padding-bottom: 10px; margin-bottom: 14px; }\n' +
      'header img { height: 78px; }\n' +
      '.company { text-align: right; font-size: 9pt; line-height: 1.45; }\n' +
      '.company strong { font-size: 11pt; }\n' +
      'h1 { font-size: 18pt; margin: 0 0 10px; color: #53412c; }\n' +
      'h2 { font-size: 12pt; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }\n' +
      'h3 { font-size: 10.5pt; margin: 10px 0 4px; }\n' +
      'table { border-collapse: collapse; width: 100%; }\n' +
      'th, td { text-align: left; padding: 4px 6px; vertical-align: top; }\n' +
      'th { font-size: 9pt; color: #555; border-bottom: 1px solid #999; }\n' +
      'td { border-bottom: 1px solid #e3e3e3; }\n' +
      '.num { text-align: right; white-space: nowrap; }\n' +
      '.meta td { border: none; padding: 2px 8px 2px 0; }\n' +
      '.meta td:first-child { color: #555; width: 110px; }\n' +
      '.total td { font-weight: bold; border-top: 2px solid #333; }\n' +
      'ul, ol { margin: 2px 0 6px; padding-left: 20px; }\n' +
      'li { margin: 1px 0; }\n' +
      '.qty { color: #555; white-space: nowrap; }\n' +
      '.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 14px; page-break-inside: avoid; }\n' +
      '.sign p { margin: 20px 0 0; border-top: 1px solid #333; padding-top: 3px; font-size: 9pt; color: #555; }\n' +
      '.banner { background: #53412c; color: #fff; font-weight: bold; padding: 6px 10px; margin-bottom: 12px; }\n' +
      '.sample { background: #c92a2a; color: #fff; font-weight: bold; text-align: center; padding: 8px 10px; margin-bottom: 12px; }\n' +
      '.warn { color: #b00020; }\n' +
      '.muted { color: #666; }\n' +
      'section { page-break-inside: auto; }\n' +
      'h2, h3 { page-break-after: avoid; }\n' +
      '</style></head><body><div class="sheet">\n' +
      '<div class="no-print"><button type="button" onclick="window.print()" title="Print or save as PDF">Print</button></div>\n' +
      body + '\n</div></body></html>\n';
  }

  function headerBlock(est, logoUrl) {
    const s = est.settings;
    return '<header>' + (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="' + esc(COMPANY.name) + '">' : '<div></div>') +
      '<div class="company"><strong>' + esc(COMPANY.name) + '</strong><br>' + COMPANY.address.map(esc).join('<br>') +
      '<br>' + esc(COMPANY.phone) + '<br>' + esc(COMPANY.email) + (s.gstNumber ? '<br>GST ' + esc(s.gstNumber) : '') + '</div></header>';
  }

  function metaTable(rows) {
    return '<table class="meta">' + rows.filter(r => r[1]).map(r => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>';
  }

  function listSection(title, items) {
    const list = (items || []).filter(x => String(x).trim());
    if (!list.length) return '';
    return '<section><h2>' + esc(title) + '</h2><ul>' + list.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></section>';
  }

  // ---------- Scope for the customer ----------

  function qtyText(qty, unit) {
    if (qty === null || qty === undefined) return '';
    return unit === 'ea' ? Math.round(qty) + ' ea' : calc.fmtQty(qty, unit);
  }

  /*
   * What the customer reads: conditions, room finishes, lines and chosen trades, grouped by CSI division
   * (commercial) or by room (residential). Assembly components are not listed. No money.
   */
  function scopeItems(est) {
    const commercial = est.job.type === 'commercial';
    const assemblies = new Map(est.assemblies.map(a => [a.id, a]));
    const items = [];
    const divGroup = d => (d ? d + ' ' + calc.divisionName(d) : 'General');

    for (const c of est.conditions) {
      const t = calc.conditionTotals(est, c.id);
      if (!t.count) continue;
      const a = c.assemblyId && assemblies.get(c.assemblyId);
      const div = c.division || (a ? a.division : '');
      let qty, unit;
      if (c.measure === 'wall' && t.sf !== null) { qty = t.sf; unit = 'sf'; } else ({ qty, unit } = calc.mainQty(c, t));
      items.push({ group: commercial ? divGroup(div) : c.location || 'General', text: c.name, qty, unit, alternateId: c.alternateId || null });
    }
    for (const r of est.rooms) {
      const q = calc.roomQty(est, r);
      for (const [finish, field, label] of calc.ROOM_FINISHES) {
        const a = r[field] && assemblies.get(r[field]);
        if (!a) continue;
        const basis = calc.roomBasis(q, finish);
        const unit = finish === 'base' ? 'lf' : 'sf';
        items.push({
          group: commercial ? divGroup(a.division) : r.name,
          text: commercial ? r.name + ', ' + label.toLowerCase() + ': ' + a.name : label + ': ' + a.name,
          qty: basis[unit], unit, alternateId: r.alternateId || null
        });
      }
    }
    for (const l of est.lines) {
      if (l.allowance) continue;
      items.push({ group: commercial ? divGroup(l.division) : l.location || 'General', text: l.description, qty: l.qty, unit: l.unit, alternateId: l.alternateId || null });
    }
    for (const b of est.bids) {
      if (!b.selectedBidderId) continue;
      items.push({ group: commercial ? divGroup(b.division) : 'General', text: b.trade, qty: null, unit: '', alternateId: b.alternateId || null });
    }
    return items;
  }

  function scopeHtml(items, showQty) {
    const groups = new Map();
    for (const it of items) {
      if (!groups.has(it.group)) groups.set(it.group, []);
      groups.get(it.group).push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === 'General') - (b === 'General') || a.localeCompare(b));
    return keys.map(k => '<h3>' + esc(k) + '</h3><ul>' + groups.get(k).map(it =>
      '<li>' + esc(it.text) + (showQty && it.qty !== null && it.qty !== undefined && it.unit ? ' <span class="qty">(' + esc(qtyText(it.qty, it.unit)) + ')</span>' : '') + '</li>').join('') + '</ul>').join('');
  }

  // ---------- Customer quote ----------

  function quoteHtml(est, opts) {
    opts = opts || {};
    const m = calc.money(est);
    const b = m.base;
    const j = est.job;
    const scope = scopeItems(est);
    const validUntil = addDays(j.date, j.validDays);
    let html = headerBlock(est, opts.logoUrl);
    html += '<h1>Quote' + (j.quoteNo ? ' ' + esc(j.quoteNo) : '') + '</h1>';
    html += metaTable([
      ['Date', j.date], ['Valid until', validUntil], ['Prepared by', j.preparedBy],
      ['Customer', j.client], ['Contact', j.contact], ['Project', j.name], ['Address', j.address]
    ]);

    html += '<section><h2>Scope of work</h2>' + (scopeHtml(scope.filter(i => !i.alternateId), opts.showQty) || '<p class="muted">Scope to be confirmed.</p>') + '</section>';

    html += '<section><h2>Price</h2><table>' +
      '<tr><td>Price, before GST</td><td class="num">' + money(b.price) + '</td></tr>' +
      '<tr><td>GST ' + esc(est.settings.gstPct) + '%</td><td class="num">' + money(b.gst) + '</td></tr>' +
      '<tr class="total"><td>Total</td><td class="num">' + money(b.total) + '</td></tr></table></section>';

    const alternates = m.alternates.filter(p => p.lines > 0);
    if (alternates.length) {
      html += '<section><h2>Alternates</h2><p class="muted">Priced separately. Not included in the price above unless accepted in writing.</p>';
      for (const p of alternates) {
        const a = p.alternate;
        html += '<h3>' + esc(a.name) + (a.description ? ': ' + esc(a.description) : '') + '</h3>';
        const items = scope.filter(i => i.alternateId === a.id);
        if (items.length) html += '<ul>' + items.map(it => '<li>' + esc(it.text) + (opts.showQty && it.qty !== null && it.qty !== undefined && it.unit ? ' <span class="qty">(' + esc(qtyText(it.qty, it.unit)) + ')</span>' : '') + '</li>').join('') + '</ul>';
        html += '<table><tr><td>' + (a.sign === 'deduct' ? 'Deduct from the price' : 'Add to the price') + ', before GST</td><td class="num">' + money(p.price) + '</td></tr>' +
          '<tr><td>GST</td><td class="num">' + money(p.gst) + '</td></tr><tr class="total"><td>Total</td><td class="num">' + money(p.total) + '</td></tr></table>';
      }
      html += '</section>';
    }

    // Allowance amounts are shown at the amount entered on the line (Kamal's decision, 2026-10-23).
    const allowances = est.lines.filter(l => l.allowance && !l.alternateId);
    if (allowances.length) {
      html += '<section><h2>Allowances</h2><p class="muted">Included in the price for items not yet selected, before GST. ' +
        'If the final selection comes in over or under the allowance, the difference is a change order.</p><table>' +
        allowances.map(l => {
          const amount = typeof l.qty === 'number' && typeof l.unitCost === 'number' ? l.qty * l.unitCost : null;
          return '<tr><td>' + esc(l.description) + (opts.showQty && l.qty !== null && l.unit && l.unit !== 'lot' ? ' <span class="qty">(' + esc(qtyText(l.qty, l.unit)) + ')</span>' : '') +
            '</td><td class="num">' + (amount === null ? 'To be set' : money(amount)) + '</td></tr>';
        }).join('') + '</table></section>';
    }

    html += listSection('Exclusions', est.exclusions);
    html += listSection('Assumptions', est.assumptions);
    html += listSection('Clarifications', est.clarifications);

    html += '<section><h2>Payment schedule</h2>';
    if (j.type === 'residential') {
      const stages = calc.stageInvoices(est, b.price || 0, b.gst || 0);
      html += '<table><tr><th>Stage</th><th class="num">%</th><th class="num">Amount</th><th class="num">GST</th><th class="num">Total</th></tr>' +
        stages.map(s => '<tr><td>' + esc(s.label) + '</td><td class="num">' + esc(s.pct) + '%</td><td class="num">' + money(s.amount) +
          '</td><td class="num">' + money(s.gst) + '</td><td class="num">' + money(s.total) + '</td></tr>').join('') + '</table>';
    } else {
      html += '<p>Progress invoices monthly for work completed, less holdback as set out in the contract. GST is added to each invoice.</p>';
    }
    html += '</section>';

    html += '<section><h2>Acceptance</h2><p>This quote is valid for ' + esc(j.validDays) + ' days' + (validUntil ? ', until ' + esc(validUntil) : '') +
      '. Signing below accepts the scope, price and payment schedule above. Any change to the work is priced and approved in writing before it starts.</p>' +
      '<div class="sign"><div><strong>Customer</strong><p>Name</p><p>Signature</p><p>Date</p></div>' +
      '<div><strong>' + esc(COMPANY.name) + '</strong><p>Name</p><p>Signature</p><p>Date</p></div></div></section>';

    return page('Quote, ' + (j.name || ''), 'Customer quote', html, est);
  }

  // ---------- Internal estimate ----------

  function internalHtml(est, opts) {
    opts = opts || {};
    const m = calc.money(est);
    const b = m.base;
    const j = est.job;
    const s = est.settings;
    const checks = calc.releaseChecks(est, m);
    const altName = id => (est.alternates.find(a => a.id === id) || {}).name || '';
    let html = '<div class="banner">Internal. Owners only.</div>' + headerBlock(est, opts.logoUrl);
    html += '<h1>Internal estimate</h1>';
    html += metaTable([
      ['Project', j.name], ['Customer', j.client], ['Address', j.address], ['Type', j.type === 'commercial' ? 'Commercial' : 'Residential'],
      ['Class', j.class || 'Not set'], ['Date', j.date], ['Bid due', j.bidDue], ['Prepared by', j.preparedBy], ['Quote number', j.quoteNo]
    ]);

    const row = (label, value, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + esc(label) + '</td><td class="num">' + esc(value) + '</td></tr>';
    html += '<section><h2>Summary</h2><table>';
    for (const t of ['M', 'L', 'S', 'E']) if (b.byType[t]) html += row(calc.TYPE_NAMES[t], money(b.byType[t]));
    if (b.byType.other) html += row('No type', money(b.byType.other));
    html += row('Direct cost', money(b.direct)) + row('Travel ' + (s.travelPct || 0) + '%', money(b.travel)) +
      row('Contingency ' + (typeof s.contingencyPct === 'number' ? s.contingencyPct + '%' : 'not set'), money(b.contingency)) +
      row('Cost', money(b.cost), 'total') + row('Price at ' + s.marginTarget + '% target', money(b.calculated)) +
      (b.overridden ? row('Price override', money(b.price)) : '') + row('Price', money(b.price), 'total') +
      row('Margin', calc.fmtPct(b.margin)) + row('Markup', calc.fmtPct(b.markup)) +
      row('Floor', m.floor === null ? 'Not set' : m.floor + '%') +
      row('GST ' + s.gstPct + '%', money(b.gst)) + row('Total with GST', money(b.total), 'total') + '</table>';
    if (b.missing) html += '<p class="warn">' + b.missing + ' lines have no cost and are not counted.</p>';
    html += '</section>';

    const linesTable = lines => {
      const groups = new Map();
      for (const l of lines) {
        const k = l.division || '';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(l);
      }
      let t = '<table><tr><th>Item</th><th>From</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit cost</th><th>Type</th><th class="num">Total</th></tr>';
      for (const k of [...groups.keys()].sort((a, b2) => (a || 'zz').localeCompare(b2 || 'zz'))) {
        const rows = groups.get(k);
        t += '<tr><td colspan="6"><strong>' + esc(k ? k + ' ' + calc.divisionName(k) : 'No division') + '</strong></td><td class="num"><strong>' +
          money(rows.reduce((a, l) => a + (l.total || 0), 0)) + '</strong></td></tr>';
        for (const l of rows) {
          t += '<tr><td>' + esc(l.description) + (l.status === 'check' ? ' <span class="warn">(check)</span>' : '') + (l.allowance ? ' (allowance)' : '') + '</td>' +
            '<td class="muted">' + esc(l.scope || l.room || l.location) + '</td><td class="num">' + esc(calc.fmtQty(l.qty)) + '</td><td>' + esc(l.unit) +
            '</td><td class="num">' + (l.unitCost === null ? '<span class="warn">No cost</span>' : money(l.unitCost)) + '</td><td>' + esc(l.type || '') +
            '</td><td class="num">' + (l.total === null ? '—' : money(l.total)) + '</td></tr>';
        }
      }
      return t + '</table>';
    };
    html += '<section><h2>Base bid lines</h2>' + linesTable(m.lines.filter(l => !l.alternateId)) + '</section>';
    for (const p of m.alternates) {
      html += '<section><h2>' + esc(altName(p.alternate.id)) + (p.alternate.description ? ': ' + esc(p.alternate.description) : '') +
        ' (' + (p.sign < 0 ? 'deduct' : 'add') + ')</h2>' + linesTable(m.lines.filter(l => l.alternateId === p.alternate.id)) +
        '<p>Cost ' + money(p.cost) + ' · Price ' + money(p.price) + ' · Margin ' + calc.fmtPct(p.margin) + ' · Markup ' + calc.fmtPct(p.markup) +
        ' · GST ' + money(p.gst) + ' · Total ' + money(p.total) + '</p></section>';
    }

    if (j.type === 'residential') {
      const stages = calc.stageInvoices(est, b.price || 0, b.gst || 0);
      html += '<section><h2>Payment stages</h2><table><tr><th>Stage</th><th class="num">%</th><th class="num">Amount</th><th class="num">GST</th><th class="num">Total</th></tr>' +
        stages.map(st => '<tr><td>' + esc(st.label) + '</td><td class="num">' + esc(st.pct) + '%</td><td class="num">' + money(st.amount) + '</td><td class="num">' +
          money(st.gst) + '</td><td class="num">' + money(st.total) + '</td></tr>').join('') + '</table></section>';
    }
    html += listSection('Exclusions', est.exclusions) + listSection('Assumptions', est.assumptions) + listSection('Clarifications', est.clarifications);
    if (est.risks.length) {
      html += '<section><h2>Risks</h2><table><tr><th>Risk</th><th class="num">Likely cost</th><th class="num">In the price</th></tr>' +
        est.risks.map(r => '<tr><td>' + esc(r.risk) + '</td><td class="num">' + money(r.likelyCost) + '</td><td class="num">' + money(r.inPrice) + '</td></tr>').join('') + '</table></section>';
    }
    if (est.rfis.length) {
      html += '<section><h2>Questions (RFIs)</h2><table><tr><th>Question</th><th>Reference</th><th>Status</th><th>Answer</th></tr>' +
        est.rfis.map(q => '<tr><td>' + esc(q.question) + '</td><td>' + esc(q.reference) + '</td><td>' + esc(q.status) + '</td><td>' + esc(q.answer) + '</td></tr>').join('') + '</table></section>';
    }
    html += '<section><h2>Release checklist</h2><table>' + checks.map(c => '<tr><td>' + c.n + '. ' + esc(c.label) +
      (c.detail ? ' <span class="muted">' + esc(c.detail) + '</span>' : '') + '</td><td class="' + (c.status === 'fail' ? 'warn' : '') + '">' +
      { pass: 'Done', fail: 'Open', warn: 'Check', na: 'n/a' }[c.status] + '</td></tr>').join('') + '</table></section>';

    return page('Internal estimate, ' + (j.name || ''), 'Internal estimate. Owners only.', html, est);
  }

  // ---------- Scope letter for a trade ----------

  // What the trade's quote must include. Trade-facing: no plugs, costs or other bidders.
  function scopeLetterHtml(est, bidId, opts) {
    opts = opts || {};
    const b = est.bids.find(x => x.id === bidId);
    if (!b) return page('Scope letter', 'Scope letter', '<p>Bid not found.</p>');
    const j = est.job;
    const alt = b.alternateId && est.alternates.find(a => a.id === b.alternateId);
    let html = headerBlock(est, opts.logoUrl);
    html += '<h1>Request for quote: ' + esc(b.trade) + '</h1>';
    html += metaTable([
      ['Date', calc.today()], ['Project', j.name], ['Address', j.address],
      ['Division', b.division ? b.division + ' ' + calc.divisionName(b.division) : ''],
      ['Part of', alt ? alt.name + (alt.description ? ': ' + alt.description : '') : 'Base bid'],
      ['Quote due', j.bidDue]
    ]);
    html += '<p>Please quote the scope below. Price each item, or say clearly that it is excluded. Quantities are from our takeoff and are for guidance; check them against the drawings.</p>';
    const items = (b.scopeItems || []).filter(s => String(s.text || '').trim());
    html += '<section><h2>Scope to include</h2>' + (items.length ? '<ol>' + items.map(s => '<li>' + esc(s.text) + '</li>').join('') + '</ol>' : '<p class="muted">To follow.</p>') + '</section>';
    if (est.sheets.length) {
      html += '<section><h2>Drawings</h2><ul>' + est.sheets.map(s => '<li>' + esc(s.name) + (s.scaleLabel ? ' (' + esc(s.scaleLabel) + ')' : '') + '</li>').join('') + '</ul></section>';
    }
    html += '<section><h2>With your quote, please send</h2><ul>' +
      '<li>Your price before GST, with GST shown separately.</li>' +
      '<li>What is included and excluded, item by item against the list above.</li>' +
      '<li>A current WCB Alberta clearance letter.</li>' +
      '<li>A certificate of commercial general liability insurance.</li>' +
      '<li>How long your price is valid and your earliest start.</li></ul>' +
      '<p>No work is scheduled until a subcontract agreement is signed and your WCB clearance is current.</p></section>';
    html += '<section><h2>Questions and quotes</h2><p>Send to ' + esc(COMPANY.email) + ' or call ' + esc(COMPANY.phone) +
      '. Please put "' + esc(j.name) + ', ' + esc(b.trade) + '" in the subject line.</p></section>';
    return page('Request for quote, ' + b.trade, 'Scope letter, ' + b.trade, html, est);
  }

  // ---------- CSV for the Monday.com Estimates board ----------

  function linesCsv(est, includeCosts) {
    const m = calc.money(est);
    const altName = id => (est.alternates.find(a => a.id === id) || {}).name || 'Base bid';
    const head = ['Item', 'Division', 'Location', 'Quantity', 'Unit', 'Type', 'Bid', 'Allowance', 'Status', 'Code'];
    if (includeCosts) head.push('Unit cost', 'Total');
    const rows = [head];
    for (const l of m.lines) {
      const r = [l.description, l.division ? l.division + ' ' + calc.divisionName(l.division) : '', l.room || l.location,
        l.qty === null ? '' : calc.round(l.qty, 2), l.unit, calc.TYPE_NAMES[l.type] || '', altName(l.alternateId),
        l.allowance ? 'Yes' : 'No', l.status === 'check' ? 'Check' : 'OK', l.code || ''];
      if (includeCosts) r.push(l.unitCost === null ? '' : calc.round(l.unitCost, 2), l.total === null ? '' : calc.round(l.total, 2));
      rows.push(r);
    }
    return calc.toCsv(rows);
  }

  return { quoteHtml, internalHtml, scopeLetterHtml, linesCsv, scopeItems, isSample, COMPANY, SAMPLE_FILE, SAMPLE_BAND };
});
