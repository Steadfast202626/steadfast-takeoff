/*
 * Steadfast takeoff: the Estimate screen. Lines, alternates, summary, payment stages, quote wording,
 * risks, RFIs and the release checklist. All numbers come from calc.js.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const PB = window.SteadfastPriceBook;
  const { el, button, select, checkbox, numInput, textInput, ask } = window.SteadfastUI;
  const screens = window.SteadfastScreens = window.SteadfastScreens || {};

  const view = { group: 'division', combine: false };
  const TYPE_OPTIONS = [['', '—'], ['M', 'Material'], ['L', 'Labour'], ['S', 'Subcontract'], ['E', 'Equipment']];
  const STATUS_TEXT = { pass: 'Done', fail: 'Open', warn: 'Check', na: 'n/a' };

  function money(v) { return calc.fmtMoney(v); }

  // Unit cost edits write back to where the cost lives.
  function setCost(app, line, value) {
    const e = line.editable;
    if (!e) return;
    if (e.kind === 'price') return PB.setPriceBookCost(app, e.code, value);
    app.change(est => {
      if (e.kind === 'condition') est.conditions.find(c => c.id === e.id).unitCost = value;
      if (e.kind === 'line') est.lines.find(l => l.id === e.id).unitCost = value;
    });
  }

  function addLine(app, allowance, alternateId) {
    app.change(est => {
      est.lines.push({
        id: calc.nextId(est.lines, 'l'), division: '', description: allowance ? 'Allowance' : 'New line', scope: '', location: '',
        qty: 1, unit: allowance ? 'lot' : 'ea', unitCost: null, type: allowance ? 'M' : 'S', allowance: !!allowance,
        alternateId: alternateId || null, source: 'owner', status: 'ok', basis: ''
      });
    });
  }

  function groupKey(line) {
    if (view.group === 'location') return line.room || line.location || 'No location';
    return line.division || '';
  }

  function groupLabel(key) {
    if (view.group === 'location') return key;
    return key ? key + ' ' + calc.divisionName(key) : 'No division';
  }

  function linesTable(app, lines) {
    const est = app.est;
    const shown = view.combine ? calc.combineLines(lines) : lines;
    const groups = new Map();
    for (const l of shown) {
      const k = groupKey(l);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }
    const keys = [...groups.keys()].sort((a, b) => (a || 'zz').localeCompare(b || 'zz'));
    const table = el('table', { className: 'grid lines' },
      el('thead', {}, el('tr', {}, ['Description', 'From', view.group === 'location' ? 'Division' : 'Location', 'Qty', 'Unit', 'Unit cost', 'Type', 'Total', ''].map(h => el('th', { textContent: h })))));
    const bidOptions = [['', 'Base bid']].concat(est.alternates.map(a => [a.id, a.name]));
    for (const k of keys) {
      const rows = groups.get(k);
      const subtotal = rows.reduce((a, l) => a + (l.total || 0), 0);
      const missing = rows.filter(l => l.missing).length;
      const tbody = el('tbody');
      tbody.append(el('tr', { className: 'group-row' },
        el('td', { colSpan: 7, textContent: groupLabel(k) + (missing ? '  (' + missing + ' with no cost)' : '') }),
        el('td', { className: 'num', textContent: money(subtotal) }), el('td')));
      for (const l of rows) tbody.append(lineRow(app, l, bidOptions));
      table.append(tbody);
    }
    return el('div', { className: 'table-wrap' }, table);
  }

  function lineRow(app, l, bidOptions) {
    const est = app.est;
    const keyBase = 'line-' + (l.keys ? l.keys.join('+') : l.key) + '-';
    const manual = l.source === 'line' && !l.keys;
    const src = manual ? est.lines.find(x => x.id === l.refId) : null;
    const editLine = fn => app.change(() => fn(src));

    let costCell;
    if (l.editable) {
      const pbItem = l.editable.kind === 'price' && est.priceBook.find(p => p.code === l.editable.code);
      costCell = el('td', { className: 'cell-input' },
        numInput(l.unitCost, v => setCost(app, l, v), {
          min: 0, placeholder: 'No cost', className: 'num' + (l.missing ? ' missing' : ''), dataset: { key: keyBase + 'cost' },
          title: l.editable.kind === 'price' ? 'Changes ' + l.code + ' for this job. Update Monday.com too.' : 'Unit cost'
        }),
        pbItem && PB.needsMondayUpdate(pbItem) ? el('span', { className: 'tag warn', textContent: 'Update in Monday.com', title: pbItem.source }) : null);
    } else {
      costCell = el('td', { className: 'num' + (l.missing ? ' warn-text' : ''), textContent: l.unitCost === null ? 'No cost' : money(l.unitCost) });
    }

    const fromText = { condition: 'Takeoff', room: 'Room', line: l.allowance ? 'Allowance' : 'Line', bid: 'Bid' }[l.source];
    const tr = el('tr', { className: l.status === 'check' ? 'check-row' : '' });
    if (manual) {
      tr.append(
        el('td', { className: 'cell-input' }, textInput(src.description, v => editLine(x => { x.description = v; }), { className: 'desc', dataset: { key: keyBase + 'desc' } })),
        el('td', {}, el('span', { className: 'tag' + (l.allowance ? ' allowance' : ''), textContent: fromText })),
        view.group === 'location'
          ? el('td', { className: 'cell-input' }, select(PB.divisionOptions(), src.division, v => editLine(x => { x.division = v; }), { dataset: { key: keyBase + 'div' } }))
          : el('td', { className: 'cell-input' }, textInput(src.location, v => editLine(x => { x.location = v; }), { dataset: { key: keyBase + 'loc' }, placeholder: 'Location' })),
        el('td', { className: 'cell-input' }, numInput(src.qty, v => editLine(x => { x.qty = v; }), { className: 'num', dataset: { key: keyBase + 'qty' } })),
        el('td', { className: 'cell-input' }, textInput(src.unit, v => editLine(x => { x.unit = v; }), { className: 'unit', dataset: { key: keyBase + 'unit' } })),
        costCell,
        el('td', { className: 'cell-input' }, select(TYPE_OPTIONS, src.type || '', v => editLine(x => { x.type = v || null; }), { dataset: { key: keyBase + 'type' } })),
        el('td', { className: 'num', textContent: l.total === null ? '—' : money(l.total) }),
        el('td', { className: 'actions' },
          view.group !== 'location' ? select(PB.divisionOptions('Division'), src.division, v => editLine(x => { x.division = v; }), { dataset: { key: keyBase + 'div2' }, title: 'CSI division' }) : null,
          select(bidOptions, src.alternateId || '', v => editLine(x => { x.alternateId = v || null; }), { dataset: { key: keyBase + 'bid' }, title: 'Base bid or alternate' }),
          src.status === 'check' ? button('Accept', 'Accept the estimator\'s line' + (src.basis ? ': ' + src.basis : ''), () => editLine(x => { x.status = 'ok'; }), 'small primary') : null,
          button('Delete', 'Delete this line', async () => {
            if (!await ask('Delete the line "' + src.description + '"?', 'Delete')) return;
            app.change(e => { e.lines = e.lines.filter(x => x.id !== src.id); });
          }, 'small danger')));
      if (src.basis) tr.title = (src.status === 'check' ? 'Estimator: ' : '') + src.basis;
    } else {
      tr.append(
        el('td', { textContent: l.description, title: l.code || '' }),
        el('td', { className: 'from', title: l.scope || '' }, el('span', { className: 'tag', textContent: fromText }), ' ', el('span', { className: 'muted', textContent: l.scope || '' })),
        el('td', { textContent: view.group === 'location' ? (l.division ? l.division + ' ' + calc.divisionName(l.division) : '') : (l.room || l.location) }),
        el('td', { className: 'num', textContent: calc.fmtQty(l.qty) }),
        el('td', { textContent: l.unit || '' }),
        costCell,
        el('td', { textContent: calc.TYPE_NAMES[l.type] || '—' }),
        el('td', { className: 'num', textContent: l.total === null ? '—' : money(l.total) }),
        el('td', { className: 'actions' },
          l.status === 'check' && l.source === 'condition' ? button('Check on drawing', 'Open the takeoff to accept the estimator\'s markups', () => app.showCondition(l.refId), 'small') : null,
          l.status === 'check' && l.source === 'room' ? button('Check room', 'Open the Rooms screen to accept it', () => app.goto('rooms'), 'small') : null));
    }
    return tr;
  }

  // ---------- Summary ----------

  function summaryCard(app, m) {
    const est = app.est;
    const s = est.settings;
    const b = m.base;
    const row = (label, value, cls, tip) => el('div', { className: 'sum-row ' + (cls || ''), title: tip || '' }, el('span', { textContent: label }), el('span', { textContent: value }));
    const card = el('section', { className: 'card' }, el('h2', { textContent: 'Base bid' }));
    for (const t of ['M', 'L', 'S', 'E']) if (b.byType[t]) card.append(row(calc.TYPE_NAMES[t], money(b.byType[t]), 'sub'));
    if (b.byType.other) card.append(row('No type', money(b.byType.other), 'sub'));
    card.append(row('Direct cost', money(b.direct)));
    card.append(row('Travel ' + (s.travelPct || 0) + '%', money(b.travel), 'sub'));
    card.append(row('Contingency ' + (typeof s.contingencyPct === 'number' ? s.contingencyPct + '%' : 'not set'), money(b.contingency), 'sub' + (typeof s.contingencyPct === 'number' ? '' : ' warn')));
    card.append(row('Cost', money(b.cost), 'strong'));
    card.append(row('Price at ' + s.marginTarget + '% target', money(b.calculated), b.overridden ? 'sub struck' : 'sub'));
    if (b.overridden) card.append(row('Price override', money(b.price), 'sub warn', 'Set by an owner'));
    card.append(row('Price', money(b.price), 'strong'));
    const floor = m.floor;
    const below = floor !== null && b.margin !== null && b.margin * 100 + 1e-9 < floor;
    card.append(el('div', { className: 'sum-pair' + (below ? ' warn' : '') },
      el('div', { title: 'Margin = (price - cost) / price' }, el('span', { textContent: 'Margin' }), el('strong', { textContent: calc.fmtPct(b.margin) })),
      el('div', { title: 'Markup = (price - cost) / cost' }, el('span', { textContent: 'Markup' }), el('strong', { textContent: calc.fmtPct(b.markup) }))));
    card.append(el('p', { className: 'note' + (below || floor === null ? ' warn' : '') },
      floor === null ? (est.job.type === 'commercial' ? 'Commercial floor not set. The owners set it per job.' : 'Margin floor not set.')
        : below ? 'Below the ' + floor + '% floor. Goes to the owners before it goes out.' : 'Floor ' + floor + '%.'));
    card.append(row('GST ' + s.gstPct + '%', money(b.gst), 'sub'));
    card.append(row('Total with GST', money(b.total), 'strong'));
    if (b.missing) card.append(el('p', { className: 'note warn', textContent: b.missing + ' lines with no cost are not counted.' }));
    return card;
  }

  function settingsCard(app) {
    const est = app.est;
    const s = est.settings;
    const set = (k, v) => app.change(e => { e.settings[k] = v; });
    const f = (label, k, attrs, tip) => el('label', { className: 'field', title: tip || '' }, label,
      numInput(s[k], v => set(k, v), Object.assign({ dataset: { key: 'set-' + k } }, attrs || {})));
    return el('section', { className: 'card' }, el('h2', { textContent: 'Settings' }),
      el('div', { className: 'form-grid' },
        f('Travel %', 'travelPct', { min: 0 }, 'Outside Edmonton and area'),
        f('Contingency %', 'contingencyPct', { min: 0, placeholder: 'Not set' }, 'Owners\' rate, raised for unknowns'),
        f('Target margin %', 'marginTarget', { min: 0, max: 99 }),
        est.job.type === 'commercial'
          ? f('Commercial floor %', 'commercialFloor', { min: 0, max: 99, placeholder: 'Not set' }, 'Set by the owners for this job')
          : f('Margin floor %', 'marginFloor', { min: 0, max: 99 }),
        f('Round price to $', 'roundTo', { min: 0 }),
        f('Price override $', 'priceOverride', { min: 0, placeholder: 'None' }, 'Owners only. Replaces the calculated price.'),
        f('GST %', 'gstPct', { min: 0 }),
        el('label', { className: 'field' }, 'GST number', textInput(s.gstNumber, v => set('gstNumber', v), { dataset: { key: 'set-gstno' } }))));
  }

  function stagesCard(app, m) {
    const est = app.est;
    const b = m.base;
    const stages = calc.stageInvoices(est, b.price || 0, b.gst || 0);
    const pct = calc.stagesTotalPct(est);
    const card = el('section', { className: 'card' }, el('h2', { textContent: 'Payment stages' }));
    const table = el('table', { className: 'grid compact stages' },
      el('thead', {}, el('tr', {}, ['Stage', '%', 'With GST'].map(h => el('th', { textContent: h })))));
    const tbody = el('tbody');
    stages.forEach((st, i) => tbody.append(el('tr', {},
      el('td', { textContent: st.label }),
      el('td', { className: 'cell-input' }, numInput(st.pct, v => app.change(e => { e.settings.stages[i].pct = v === null ? 0 : v; }), { className: 'num pct', dataset: { key: 'stage-' + i } })),
      el('td', { className: 'num', textContent: money(st.total), title: money(st.amount) + ' plus GST ' + money(st.gst) }))));
    table.append(tbody);
    card.append(table);
    card.append(el('p', { className: 'note' + (Math.abs(pct - 100) < 1e-9 ? '' : ' warn'), textContent: 'Stages total ' + pct + '%.' }));
    return card;
  }

  function checklistCard(app, checks) {
    const card = el('section', { className: 'card', id: 'checklist' }, el('h2', { textContent: 'Release checklist' }));
    const ul = el('ul', { className: 'checklist' });
    for (const c of checks) {
      ul.append(el('li', { className: c.status },
        el('span', { className: 'badge', textContent: STATUS_TEXT[c.status] }),
        el('span', { textContent: c.label }),
        c.detail ? el('span', { className: 'muted', textContent: ' ' + c.detail }) : null));
    }
    card.append(ul);
    const open = calc.openCheckCount(checks);
    card.append(el('p', { className: 'note' + (open ? ' warn' : ''), textContent: open ? open + ' open. The quote is not ready to release.' : 'Ready to release once an owner approves the price.' }));
    return card;
  }

  // ---------- Quote wording, risks, RFIs ----------

  function listEditor(app, key, label, tip) {
    const ta = el('textarea', { rows: 4, value: app.est[key].join('\n'), dataset: { key: 'list-' + key }, title: tip });
    ta.addEventListener('change', () => app.change(e => { e[key] = ta.value.split('\n').map(x => x.trim()).filter(Boolean); }));
    return el('label', { className: 'field' }, label + ' (one per line)', ta);
  }

  function risksCard(app) {
    const est = app.est;
    const table = el('table', { className: 'grid compact' },
      el('thead', {}, el('tr', {}, ['Risk', 'Likely cost', 'In the price', ''].map(h => el('th', { textContent: h })))));
    const tbody = el('tbody');
    est.risks.forEach((r, i) => tbody.append(el('tr', {},
      el('td', { className: 'cell-input' }, textInput(r.risk, v => app.change(e => { e.risks[i].risk = v; }), { dataset: { key: 'risk-' + r.id } })),
      el('td', { className: 'cell-input' }, numInput(r.likelyCost, v => app.change(e => { e.risks[i].likelyCost = v || 0; }), { className: 'num', dataset: { key: 'riskc-' + r.id } })),
      el('td', { className: 'cell-input' }, numInput(r.inPrice, v => app.change(e => { e.risks[i].inPrice = v || 0; }), { className: 'num', dataset: { key: 'riskp-' + r.id } })),
      el('td', {}, button('Delete', 'Delete this risk', () => app.change(e => { e.risks.splice(i, 1); }), 'small danger')))));
    table.append(tbody);
    return el('section', { className: 'card' }, el('h2', { textContent: 'Risks' }),
      el('p', { className: 'note', textContent: 'Top five risks to cost or schedule. Owners only.' }), table,
      button('Add risk', 'Add a risk with its likely cost', () => app.change(e => { e.risks.push({ id: calc.nextId(e.risks, 'k'), risk: '', likelyCost: 0, inPrice: 0 }); })));
  }

  function rfisCard(app) {
    const est = app.est;
    const table = el('table', { className: 'grid compact' },
      el('thead', {}, el('tr', {}, ['Question', 'Reference', 'Status', 'Answer', ''].map(h => el('th', { textContent: h })))));
    const tbody = el('tbody');
    est.rfis.forEach((q, i) => tbody.append(el('tr', {},
      el('td', { className: 'cell-input' }, textInput(q.question, v => app.change(e => { e.rfis[i].question = v; }), { dataset: { key: 'rfi-' + q.id } })),
      el('td', { className: 'cell-input' }, textInput(q.reference, v => app.change(e => { e.rfis[i].reference = v; }), { dataset: { key: 'rfir-' + q.id }, placeholder: 'Sheet or detail' })),
      el('td', { className: 'cell-input' }, select([['open', 'Open'], ['answered', 'Answered']], q.status, v => app.change(e => { e.rfis[i].status = v; }), { dataset: { key: 'rfis-' + q.id } })),
      el('td', { className: 'cell-input' }, textInput(q.answer, v => app.change(e => { e.rfis[i].answer = v; }), { dataset: { key: 'rfia-' + q.id } })),
      el('td', {}, button('Delete', 'Delete this question', () => app.change(e => { e.rfis.splice(i, 1); }), 'small danger')))));
    table.append(tbody);
    return el('section', { className: 'card' }, el('h2', { textContent: 'Questions (RFIs)' }), table,
      button('Add question', 'Add a question for the designer or client', () => app.change(e => { e.rfis.push({ id: calc.nextId(e.rfis, 'q'), question: '', reference: '', status: 'open', answer: '' }); })));
  }

  // ---------- Alternates ----------

  function alternatesSection(app, m) {
    const est = app.est;
    const wrap = el('section', { className: 'alternates' });
    wrap.append(el('div', { className: 'section-head' }, el('h2', { textContent: 'Alternates' }),
      button('Add alternate', 'Price some work separately from the base bid', () => app.change(e => {
        e.alternates.push({ id: calc.nextId(e.alternates, 'alt'), name: 'Alternate ' + (e.alternates.length + 1), description: '', sign: 'add' });
      }))));
    if (!est.alternates.length) wrap.append(el('p', { className: 'note', textContent: 'None. Use alternates to keep cosmetic work apart from necessary work.' }));
    for (const p of m.alternates) {
      const a = p.alternate;
      const lines = m.lines.filter(l => l.alternateId === a.id);
      const edit = fn => app.change(e => fn(e.alternates.find(x => x.id === a.id)));
      wrap.append(el('div', { className: 'alt-block' },
        el('div', { className: 'alt-head' },
          textInput(a.name, v => v && edit(x => { x.name = v; }), { className: 'alt-name', dataset: { key: 'alt-' + a.id + '-name' } }),
          textInput(a.description, v => edit(x => { x.description = v; }), { placeholder: 'What it covers', dataset: { key: 'alt-' + a.id + '-desc' } }),
          select([['add', 'Add'], ['deduct', 'Deduct']], a.sign, v => edit(x => { x.sign = v; }), { title: 'Adds to or comes off the base bid', dataset: { key: 'alt-' + a.id + '-sign' } }),
          button('Add line', 'Add a line to this alternate', () => addLine(app, false, a.id), 'small'),
          button('Delete', 'Delete this alternate', async () => {
            const used = est.conditions.filter(c => c.alternateId === a.id).length + est.rooms.filter(r => r.alternateId === a.id).length +
              est.lines.filter(l => l.alternateId === a.id).length + est.bids.filter(b => b.alternateId === a.id).length;
            if (!await ask('Delete "' + a.name + '"?' + (used ? ' Its ' + used + ' items move to the base bid.' : ''), 'Delete')) return;
            app.change(e => {
              for (const k of ['conditions', 'rooms', 'lines', 'bids']) for (const x of e[k]) if (x.alternateId === a.id) x.alternateId = null;
              e.alternates = e.alternates.filter(x => x.id !== a.id);
            });
          }, 'small danger')),
        lines.length ? linesTable(app, lines) : el('p', { className: 'note', textContent: 'No items yet. Set a condition, room or line to this alternate.' }),
        el('p', { className: 'alt-sum' },
          'Cost ' + money(p.cost) + ' · Price ' + money(p.price) + ' · Margin ' + calc.fmtPct(p.margin) + ' · Markup ' + calc.fmtPct(p.markup) +
          ' · GST ' + money(p.gst) + ' · Total ' + money(p.total) + (p.missing ? ' · ' + p.missing + ' with no cost' : ''))));
    }
    return wrap;
  }

  // ---------- Screen ----------

  function renderEstimate(root, app) {
    const est = app.est;
    const m = calc.money(est);
    const checks = calc.releaseChecks(est, m);
    const base = m.lines.filter(l => !l.alternateId);

    root.append(el('div', { className: 'screen-head' },
      el('h1', { textContent: 'Estimate' }),
      el('span', { className: 'muted', textContent: (est.job.type === 'commercial' ? 'Commercial' : 'Residential') + (est.job.class ? ', class ' + est.job.class : ', class not set') }),
      el('div', { className: 'spacer' }),
      button('Customer quote', 'Open the quote for the customer, ready to print. No costs or margin.', () => app.openOutput('quote')),
      button('Internal estimate', 'Open the full estimate for the owners, ready to print', () => app.openOutput('internal'))));

    const main = el('div', { className: 'est-main' });
    main.append(el('div', { className: 'filters' },
      el('label', { className: 'inline', title: 'How lines are grouped' }, 'Group by ',
        select([['division', 'CSI division'], ['location', 'Location or room']], view.group, v => { view.group = v; app.renderScreen(); }, { dataset: { key: 'est-group' } })),
      el('label', { className: 'check', title: 'Add up lines for the same item' }, checkbox(view.combine, v => { view.combine = v; app.renderScreen(); }, { dataset: { key: 'est-combine' } }), 'Combine identical items'),
      el('span', { className: 'spacer' }),
      button('Add line', 'Add a line that is not on the drawings', () => addLine(app, false)),
      button('Add allowance', 'Add an amount for something not yet selected', () => addLine(app, true))));

    main.append(el('h2', { className: 'section-title', textContent: 'Base bid' }));
    main.append(base.length ? linesTable(app, base) : el('p', { className: 'note', textContent: 'No lines yet. Measure on the drawings, add rooms, or add a line.' }));
    main.append(alternatesSection(app, m));

    main.append(el('section', { className: 'card' }, el('h2', { textContent: 'Quote wording' }),
      el('div', { className: 'form-grid three' },
        listEditor(app, 'exclusions', 'Exclusions', 'Work not in the price'),
        listEditor(app, 'assumptions', 'Assumptions', 'What the price assumes'),
        listEditor(app, 'clarifications', 'Clarifications', 'Notes that explain the scope'))));
    main.append(risksCard(app));
    main.append(rfisCard(app));

    const side = el('aside', { className: 'est-side' });
    side.append(summaryCard(app, m));
    side.append(settingsCard(app));
    if (est.job.type === 'residential') side.append(stagesCard(app, m));
    side.append(checklistCard(app, checks));

    root.append(el('div', { className: 'estimate' }, main, side));
  }

  screens.estimate = { label: 'Estimate', title: 'Lines, price, margin and the release checklist', render: renderEstimate };
})();
