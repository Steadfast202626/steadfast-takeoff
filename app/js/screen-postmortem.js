/*
 * Steadfast takeoff: the Post-mortem screen. For a finished job: estimate against actual by section,
 * profit achieved against the target, change orders, hours and lessons learned. Owners only.
 * Actual costs are typed in for now. The QuickBooks column is where the project's actual costs will
 * fill in once QuickBooks is connected; a typed number always wins over QuickBooks.
 * A section off by more than 10% offers a price book update, sent to Kamal as a "check" on Monday.com.
 * The record is saved on the Monday.com Post-mortems board when signed in, and kept in this browser.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const PM = window.SteadfastPostmortem;
  const { el, button, select, numInput, textInput, ask, showDialog } = window.SteadfastUI;
  const screens = window.SteadfastScreens = window.SteadfastScreens || {};
  const money = v => (v === null || v === undefined ? '—' : calc.fmtMoney(v));
  const pct = v => (v === null || v === undefined ? '—' : calc.fmtPct(v));

  const STORE_KEY = 'steadfast-takeoff.postmortems';
  const view = { key: null, record: null, loading: false, saved: '', mondayItem: null };

  function readAll() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function keep(key, record) {
    const all = readAll();
    all[key] = record;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch (e) { /* Monday.com holds it when signed in */ }
  }

  // Which job this is: the Monday.com item when there is one, else the job's name and date.
  function jobKey(app) {
    const link = app.cloud && app.cloud.link();
    return link && link.itemId ? 'monday:' + link.itemId : 'job:' + (app.est.job.name || '') + ':' + (app.est.job.date || '');
  }

  function current(app) {
    const key = jobKey(app);
    if (view.key !== key) {
      view.key = key;
      view.record = Object.assign(PM.emptyRecord(), readAll()[key] || {});
      view.saved = '';
      view.mondayItem = null;
      const link = app.cloud && app.cloud.link();
      if (link && link.itemId && app.cloud.ready()) loadFromMonday(app, key, link.itemId);
    }
    return view.record;
  }

  async function loadFromMonday(app, key, itemId) {
    view.loading = true;
    try {
      const out = await app.cloud.api('/api/postmortems/' + encodeURIComponent(itemId));
      if (view.key !== key) return;
      if (out.record) {
        // Monday.com is the record; keep anything typed here that Monday.com does not have yet.
        view.record = Object.assign(PM.emptyRecord(), view.record, out.record, { actuals: Object.assign({}, view.record.actuals, out.record.actuals) });
        keep(key, view.record);
      }
      view.mondayItem = out.itemId;
    } catch (e) {
      app.setStatus('Could not read the post-mortem from Monday.com. ' + e.message, true, 8000);
    } finally {
      view.loading = false;
      app.renderScreen();
    }
  }

  function edit(app, fn) {
    fn(view.record);
    view.saved = '';
    keep(view.key, view.record);
    app.renderScreen();
  }

  async function save(app) {
    const link = app.cloud && app.cloud.link();
    if (!(link && link.itemId && app.cloud.ready())) {
      app.setStatus('Kept in this browser. Save the job to Monday.com first to put the post-mortem there.', false, 8000);
      return;
    }
    try {
      app.setStatus('Saving the post-mortem to Monday.com');
      const out = await app.cloud.api('/api/postmortems/' + encodeURIComponent(link.itemId), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ record: view.record })
      });
      view.mondayItem = out.itemId;
      view.saved = new Date().toISOString();
      app.setStatus('Post-mortem saved on the Monday.com Post-mortems board', false, 6000);
      app.renderScreen();
    } catch (e) {
      app.setStatus('Post-mortem not saved to Monday.com. ' + e.message, true, 10000);
    }
  }

  // ---------- Price book offers ----------

  async function offerUpdate(app, section) {
    const r = PM.compute(app.est, view.record);
    const offers = PM.priceBookOffers(app.est, r).filter(o => o.division === section.division);
    const intro = el('p', { textContent: section.label + ' cost ' + money(section.actual) + ' against ' + money(section.estimated) +
      ' estimated, ' + (section.pct > 0 ? 'over' : 'under') + ' by ' + Math.round(Math.abs(section.pct) * 100) + '%. ' +
      (offers.length ? 'These price book costs moved by the same share. Kamal approves any change on the Monday.com Price book board.' : 'No priced price book items in this section to update.') });
    const box = el('div', {}, intro);
    if (offers.length) {
      const table = el('table', { className: 'grid compact' }, el('thead', {}, el('tr', {}, ['Code', 'Item', 'Now', 'Suggested', ''].map(h => el('th', { textContent: h })))));
      const tbody = el('tbody');
      offers.forEach(o => {
        o.send = true;
        tbody.append(el('tr', {},
          el('td', { className: 'mono', textContent: o.code }), el('td', { textContent: o.item }),
          el('td', { className: 'num', textContent: money(o.current) + '/' + o.unit }),
          el('td', { className: 'cell-input' }, numInput(o.proposed, v => { o.proposed = v; }, { className: 'num', min: 0 })),
          el('td', {}, el('input', { type: 'checkbox', checked: true, title: 'Send this one', onchange: e => { o.send = e.target.checked; } }))));
      });
      table.append(tbody);
      box.append(el('div', { className: 'table-wrap' }, table));
    }
    const ready = app.cloud && app.cloud.ready();
    if (offers.length && !ready) box.append(el('p', { className: 'note warn', textContent: 'Sign in to send these to Monday.com. Nothing is changed in the price book here.' }));
    const go = await showDialog('Update the price book?', box,
      offers.length && ready ? [['Not now', 'Close', null], ['Send to Kamal', 'Mark these "check" on the Monday.com Price book board with the reason', true, true]] : [['Close', 'Close', null]], true);
    if (!go) return;
    let sent = 0, missing = [];
    for (const o of offers.filter(x => x.send && typeof x.proposed === 'number')) {
      const note = 'Post-mortem ' + (app.est.job.name || '') + ': ' + section.label + ' ' + Math.round(section.pct * 100) + '% ' +
        (section.pct > 0 ? 'over' : 'under') + '. Suggested ' + money(o.proposed) + '/' + o.unit + ' (now ' + money(o.current) + ').';
      try {
        const out = await app.cloud.api('/api/pricebook/flag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: o.code, note }) });
        if (out.found) sent++; else missing.push(o.code);
      } catch (e) {
        return app.setStatus('Stopped sending. ' + e.message, true, 10000);
      }
    }
    app.setStatus(sent + (sent === 1 ? ' price' : ' prices') + ' marked "check" for Kamal on Monday.com' +
      (missing.length ? '. Not on the board: ' + missing.join(', ') : ''), !!missing.length, 10000);
  }

  // ---------- Screen ----------

  function stat(label, value, sub, warn) {
    return el('div', { className: 'stat' + (warn ? ' warn' : '') }, el('span', { textContent: label }), el('strong', { textContent: value }), sub ? el('span', { textContent: sub }) : null);
  }

  function render(root, app) {
    const est = app.est;
    root.append(el('div', { className: 'screen-head' },
      el('h1', { textContent: 'Post-mortem' }),
      el('span', { className: 'muted', textContent: (est.job.name || 'No job open') + '. Owners only.' })));
    if (!app.hasWork() || window.SteadfastOutputs.isSample(est)) {
      root.append(el('p', { className: 'note', textContent: 'Open the finished job first: Continue a job, or File, Open from Monday.com.' }));
      return;
    }
    const record = current(app);
    const r = PM.compute(est, record);
    const link = app.cloud && app.cloud.link();
    const onMonday = !!(link && link.itemId && app.cloud.ready());

    const head = root.querySelector('.screen-head');
    head.append(el('div', { className: 'spacer' }),
      el('label', { className: 'inline' }, 'Status ', select([['In progress', 'In progress'], ['Done', 'Done']], record.status, v => edit(app, x => { x.status = v; }), { dataset: { key: 'pm-status' } })),
      button(onMonday ? 'Save to Monday.com' : 'Kept in browser', onMonday ? 'Save on the Post-mortems board' : 'Save the job to Monday.com first', () => save(app), onMonday ? 'primary' : ''));
    if (view.loading) root.append(el('p', { className: 'note', textContent: 'Reading the post-mortem from Monday.com…' }));
    else if (onMonday) root.append(el('p', { className: 'note muted', textContent: view.saved ? 'Saved on Monday.com.' : (view.mondayItem ? 'On the Monday.com Post-mortems board. Save after changes.' : 'Not on Monday.com yet.') }));

    // Summary
    const below = r.margin !== null && r.floor !== null && r.margin * 100 < r.floor;
    root.append(el('div', { className: 'stat-row' },
      stat('Contract', money(r.contract), r.coPrice ? 'Includes ' + money(r.coPrice) + ' in change orders' : 'Price before GST'),
      stat('Actual cost', r.actualCost === null ? 'Not entered' : money(r.actualCost), r.complete ? 'All sections in' : r.missing.length + ' sections to enter'),
      stat('Profit achieved', money(r.profit), r.margin === null ? 'Target ' + r.target + '%' : 'Margin ' + pct(r.margin) + ' against ' + r.target + '% target', below),
      stat('Hours', (r.actualHours === null ? '—' : calc.fmtQty(r.actualHours)) + ' of ' + calc.fmtQty(r.estimatedHours), 'Actual of estimated')));

    // Sections
    root.append(el('h2', { className: 'section-title', textContent: 'Cost by section' }));
    const table = el('table', { className: 'grid pm-sections' }, el('thead', {}, el('tr', {},
      ['Section', 'Estimated', 'Actual', 'QuickBooks', 'Difference', '%', ''].map((h, i) => el('th', { textContent: h, className: i && i < 6 ? 'num' : '',
        title: h === 'QuickBooks' ? 'Fills in from the QuickBooks project once QuickBooks is connected. A typed actual wins.' : '' })))));
    const tbody = el('tbody');
    for (const s of r.sections) {
      const qbo = record.qbo && typeof record.qbo[s.division] === 'number' ? record.qbo[s.division] : null;
      tbody.append(el('tr', { className: s.off ? 'check-row' : '' },
        el('td', { textContent: s.label }),
        el('td', { className: 'num', textContent: money(s.estimated) }),
        el('td', { className: 'cell-input num' }, numInput(record.actuals[s.division] ?? null, v => edit(app, x => { if (v === null) delete x.actuals[s.division]; else x.actuals[s.division] = v; }),
          { className: 'num', min: 0, placeholder: qbo === null ? 'Type actual' : money(qbo), dataset: { key: 'pm-act-' + s.division } })),
        el('td', { className: 'num qbo-cell', textContent: qbo === null ? 'Not connected' : money(qbo) }),
        el('td', { className: 'num' + (s.variance > 0 ? ' warn-text' : ''), textContent: s.variance === null ? '' : (s.variance > 0 ? '+' : '') + money(s.variance) }),
        el('td', { className: 'num' + (s.off ? ' warn-text' : ''), textContent: s.pct === null ? '' : (s.pct > 0 ? '+' : '') + pct(s.pct) }),
        el('td', { className: 'actions' }, s.off ? button('Update price book', 'More than 10% off: suggest new costs to Kamal', () => offerUpdate(app, s), 'small primary') : null)));
    }
    tbody.append(el('tr', {}, el('td', { textContent: 'Travel and contingency', title: 'In the estimated cost; not a cost of its own' }),
      el('td', { className: 'num', textContent: money(r.extras) }), el('td', { className: 'muted', textContent: 'Not spent as such' }), el('td'), el('td'), el('td'), el('td')));
    tbody.append(el('tr', { className: 'foot' }, el('td', { textContent: 'Total, with change orders' }),
      el('td', { className: 'num strong', textContent: money(r.plannedCost) }), el('td', { className: 'num strong', textContent: money(r.actualCost) }),
      el('td'), el('td', { className: 'num', textContent: r.actualCost !== null && r.plannedCost !== null ? money(r.actualCost - r.plannedCost) : '' }), el('td'), el('td')));
    table.append(tbody);
    root.append(el('div', { className: 'table-wrap' }, table));

    // QuickBooks (filled in later)
    root.append(el('section', { className: 'card qbo-card' },
      el('h2', { textContent: 'QuickBooks actuals' }),
      el('p', { className: 'note', textContent: 'Not connected yet. Once QuickBooks is connected, the costs on this job\'s QuickBooks project fill the QuickBooks column by section. Typed actuals stay as typed.' }),
      el('div', { className: 'form-grid' },
        el('label', { className: 'field' }, 'QuickBooks project', textInput(record.qboProject, v => edit(app, x => { x.qboProject = v; }), { placeholder: 'Customer or project name in QuickBooks', dataset: { key: 'pm-qbo' } })),
        el('div', {}, el('button', { type: 'button', textContent: 'Fill from QuickBooks', title: 'Available once QuickBooks is connected', disabled: true })))));

    // Change orders
    root.append(el('div', { className: 'section-head' }, el('h2', { textContent: 'Change orders' }),
      button('Add change order', 'Approved in writing by the customer', () => edit(app, x => { x.changeOrders.push({ description: '', price: null, cost: null }); }))));
    if (record.changeOrders.length) {
      const co = el('table', { className: 'grid compact' }, el('thead', {}, el('tr', {}, ['Change order', 'Price', 'Cost', ''].map(h => el('th', { textContent: h })))));
      const cb = el('tbody');
      record.changeOrders.forEach((c, i) => cb.append(el('tr', {},
        el('td', { className: 'cell-input' }, textInput(c.description, v => edit(app, x => { x.changeOrders[i].description = v; }), { className: 'desc', dataset: { key: 'pm-co-d' + i } })),
        el('td', { className: 'cell-input' }, numInput(c.price, v => edit(app, x => { x.changeOrders[i].price = v; }), { className: 'num', dataset: { key: 'pm-co-p' + i } })),
        el('td', { className: 'cell-input' }, numInput(c.cost, v => edit(app, x => { x.changeOrders[i].cost = v; }), { className: 'num', dataset: { key: 'pm-co-c' + i } })),
        el('td', { className: 'actions' }, button('Delete', 'Delete this change order', async () => {
          if (await ask('Delete this change order?', 'Delete')) edit(app, x => { x.changeOrders.splice(i, 1); });
        }, 'small danger')))));
      co.append(cb);
      root.append(el('div', { className: 'table-wrap' }, co));
    } else root.append(el('p', { className: 'note', textContent: 'None.' }));

    // Hours and lessons
    root.append(el('section', { className: 'card' }, el('h2', { textContent: 'Hours and lessons' }),
      el('div', { className: 'form-grid' },
        el('label', { className: 'field' }, 'Estimated hours', el('input', { value: calc.fmtQty(r.estimatedHours), disabled: true, title: 'Lines priced by the hour' })),
        el('label', { className: 'field' }, 'Actual hours', numInput(record.actualHours, v => edit(app, x => { x.actualHours = v; }), { min: 0, dataset: { key: 'pm-hours' } }))),
      el('div', { className: 'form-grid three' },
        lesson(app, 'What went well', 'wentWell'),
        lesson(app, 'What to change next time', 'toChange'),
        lesson(app, 'Trades that went over, and why', 'overWhy'))));
  }

  function lesson(app, label, key) {
    const ta = el('textarea', { rows: 4, value: view.record[key] || '', dataset: { key: 'pm-' + key } });
    ta.addEventListener('change', () => edit(app, x => { x[key] = ta.value.trim(); }));
    return el('label', { className: 'field' }, label, ta);
  }

  screens.postmortems = { label: 'Post-mortem', title: 'Estimate against actual for a finished job', render };
})();
