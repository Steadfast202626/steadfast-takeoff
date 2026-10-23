/*
 * Steadfast takeoff: the Bids screen. Bid levelling per trade: scope items against bidders,
 * plugs for the gaps, levelled totals and ranking, WCB and insurance, the chosen bidder, scope letters.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const PB = window.SteadfastPriceBook;
  const { el, button, select, checkbox, numInput, textInput, ask } = window.SteadfastUI;
  const screens = window.SteadfastScreens = window.SteadfastScreens || {};

  const view = { id: null };
  const INCLUDE_OPTIONS = [['y', 'Included'], ['n', 'Excluded'], ['', 'Not stated']];

  function newBid(est) {
    return {
      id: calc.nextId(est.bids, 'b'), trade: 'New trade', division: '', alternateId: null,
      scopeItems: [], bidders: [], selectedBidderId: null, source: 'owner', status: 'ok'
    };
  }

  function nextBidderId(bid) {
    let n = 0;
    for (const b of bid.bidders) { const m = /^bd(\d+)$/.exec(b.id); if (m) n = Math.max(n, +m[1]); }
    return 'bd' + (n + 1);
  }

  // Scope items from the takeoff for this trade's division, with quantities. Adds only what is not there.
  function scopeFromTakeoff(est, bid) {
    const items = [];
    for (const c of est.conditions) {
      const a = c.assemblyId && est.assemblies.find(x => x.id === c.assemblyId);
      const div = c.division || (a ? a.division : '');
      if (div !== bid.division || (c.alternateId || null) !== (bid.alternateId || null)) continue;
      const t = calc.conditionTotals(est, c.id);
      if (!t.count) continue;
      let qty, unit;
      if (c.measure === 'wall' && t.sf !== null) { qty = t.sf; unit = 'sf'; } else ({ qty, unit } = calc.mainQty(c, t));
      items.push(c.name + (qty !== null ? ': ' + (unit === 'ea' ? Math.round(qty) + ' ea' : calc.fmtQty(qty, unit)) : '') + (c.location ? ' (' + c.location + ')' : ''));
    }
    for (const r of est.rooms) {
      if ((r.alternateId || null) !== (bid.alternateId || null)) continue;
      const q = calc.roomQty(est, r);
      for (const [finish, field, label] of calc.ROOM_FINISHES) {
        const a = r[field] && est.assemblies.find(x => x.id === r[field]);
        if (!a || a.division !== bid.division) continue;
        const unit = finish === 'base' ? 'lf' : 'sf';
        const qty = calc.roomBasis(q, finish)[unit];
        items.push(r.name + ', ' + label.toLowerCase() + ': ' + a.name + (qty !== null ? ', ' + calc.fmtQty(qty, unit) : ''));
      }
    }
    for (const l of est.lines) {
      if (l.division !== bid.division || (l.alternateId || null) !== (bid.alternateId || null)) continue;
      items.push(l.description + (typeof l.qty === 'number' && l.unit ? ': ' + calc.fmtQty(l.qty, l.unit) : ''));
    }
    const have = new Set(bid.scopeItems.map(s => s.text.split(':')[0].trim().toLowerCase()));
    return items.filter(t => !have.has(t.split(':')[0].trim().toLowerCase()));
  }

  function renderBids(root, app) {
    const est = app.est;
    if (!est.bids.some(b => b.id === view.id)) view.id = est.bids[0] ? est.bids[0].id : null;

    root.append(el('div', { className: 'screen-head' },
      el('h1', { textContent: 'Bids' }),
      el('div', { className: 'spacer' }),
      button('Add trade', 'Start levelling quotes for a trade', () => app.change(e => { const b = newBid(e); e.bids.push(b); view.id = b.id; }))));
    root.append(el('p', { className: 'note', textContent: 'Plugs price what a bidder left out. The chosen bidder becomes one subcontract line at the levelled price. No trade gets a date without a signed agreement and a current WCB clearance letter.' }));

    const layout = el('div', { className: 'split' });
    const list = el('ul', { className: 'pick-list' });
    for (const b of est.bids) {
      const chosen = b.selectedBidderId && b.bidders.find(x => x.id === b.selectedBidderId);
      list.append(el('li', { className: (b.id === view.id ? 'current' : ''), onclick: () => { view.id = b.id; app.renderScreen(); } },
        el('span', { className: 'name', textContent: b.trade + (b.status === 'check' ? ' ?' : '') }),
        el('span', { className: 'sub' + (chosen ? '' : ' warn'), textContent: b.bidders.length + ' bidders · ' + (chosen ? (chosen.name || 'Unnamed') + ', ' + calc.fmtMoney(calc.levelledPrice(b, chosen)) : 'none chosen') })));
    }
    layout.append(el('div', { className: 'pick-col' }, est.bids.length ? list : el('p', { className: 'note', style: 'padding: 10px', textContent: 'No trades yet.' })));

    const b = est.bids.find(x => x.id === view.id);
    const detail = el('div', { className: 'detail' });
    if (b) detail.append(...bidDetail(app, b));
    layout.append(detail);
    root.append(layout);
  }

  function bidDetail(app, b) {
    const est = app.est;
    const k = 'bid-' + b.id + '-';
    const edit = fn => app.change(e => fn(e.bids.find(x => x.id === b.id)));
    const out = [];

    if (b.status === 'check') {
      out.push(el('p', { className: 'note warn' }, 'Added by the estimator. ',
        button('Accept', 'Accept the estimator\'s bid sheet', () => edit(x => { x.status = 'ok'; }), 'small primary')));
    }
    out.push(el('div', { className: 'form-grid three' },
      el('label', { className: 'field' }, 'Trade', textInput(b.trade, v => v && edit(x => { x.trade = v; }), { dataset: { key: k + 'trade' } })),
      el('label', { className: 'field' }, 'CSI division', select(PB.divisionOptions(), b.division, v => edit(x => { x.division = v; }), { dataset: { key: k + 'div' } })),
      el('label', { className: 'field' }, 'Bid', select([['', 'Base bid']].concat(est.alternates.map(a => [a.id, a.name])), b.alternateId || '', v => edit(x => { x.alternateId = v || null; }), { dataset: { key: k + 'alt' } }))));

    // The levelling grid: scope items down, bidders across
    const ranked = b.bidders.map(bd => ({ bd, total: calc.levelledPrice(b, bd) })).filter(r => r.bd.amount > 0).sort((x, y) => x.total - y.total);
    const rank = new Map(ranked.map((r, i) => [r.bd.id, i + 1]));
    const table = el('table', { className: 'grid levelling' });
    const head = el('tr', {}, el('th', { textContent: 'Scope item' }), el('th', { textContent: 'Plug', title: 'Our price for this item when a bidder leaves it out' }));
    b.bidders.forEach((bd, j) => head.append(el('th', { className: 'bidder' },
      textInput(bd.name, v => edit(x => { x.bidders[j].name = v; }), { placeholder: 'Bidder ' + (j + 1), dataset: { key: k + 'bdname' + bd.id } }))));
    head.append(el('th'));
    table.append(el('thead', {}, head));
    const tbody = el('tbody');
    b.scopeItems.forEach((s, i) => {
      const tr = el('tr', {},
        el('td', { className: 'cell-input' }, textInput(s.text, v => edit(x => { x.scopeItems[i].text = v; }), { className: 'desc', dataset: { key: k + 'scope' + i } })),
        el('td', { className: 'cell-input' }, numInput(s.plug, v => edit(x => { x.scopeItems[i].plug = v || 0; }), { className: 'num', min: 0, dataset: { key: k + 'plug' + i } })));
      b.bidders.forEach((bd, j) => {
        const val = (bd.includes || [])[i] || '';
        tr.append(el('td', { className: 'cell-input inc-' + (val || 'blank') },
          select(INCLUDE_OPTIONS, val, v => edit(x => {
            const inc = x.bidders[j].includes = x.bidders[j].includes || [];
            while (inc.length <= i) inc.push('');
            inc[i] = v;
          }), { dataset: { key: k + 'inc' + bd.id + '-' + i } })));
      });
      tr.append(el('td', {}, button('Remove', 'Remove this scope item', () => edit(x => {
        x.scopeItems.splice(i, 1);
        for (const bd of x.bidders) if (bd.includes) bd.includes.splice(i, 1);
      }), 'small danger')));
      tbody.append(tr);
    });

    const footRow = (label, cells, cls) => {
      const tr = el('tr', { className: cls || '' }, el('td', { textContent: label }), el('td'));
      for (const c of cells) tr.append(c);
      tr.append(el('td'));
      return tr;
    };
    tbody.append(footRow('Quoted amount', b.bidders.map((bd, j) => el('td', { className: 'cell-input' },
      numInput(bd.amount, v => edit(x => { x.bidders[j].amount = v || 0; }), { className: 'num', min: 0, dataset: { key: k + 'amt' + bd.id } }))), 'foot'));
    tbody.append(footRow('Plugs added', b.bidders.map(bd => el('td', { className: 'num', textContent: calc.fmtMoney(calc.levelledPrice(b, bd) - (bd.amount || 0)) })), 'foot'));
    tbody.append(footRow('Levelled total', b.bidders.map(bd => el('td', { className: 'num strong', textContent: bd.amount > 0 ? calc.fmtMoney(calc.levelledPrice(b, bd)) : '—' })), 'foot'));
    tbody.append(footRow('Rank', b.bidders.map(bd => el('td', { className: 'num', textContent: rank.has(bd.id) ? String(rank.get(bd.id)) : '—' })), 'foot'));
    tbody.append(footRow('WCB clearance letter', b.bidders.map((bd, j) => el('td', { className: 'center' },
      checkbox(bd.wcbClearance, v => edit(x => { x.bidders[j].wcbClearance = v; }), { title: 'Current WCB Alberta clearance letter on file', dataset: { key: k + 'wcb' + bd.id } }))), 'foot'));
    tbody.append(footRow('Liability insurance', b.bidders.map((bd, j) => el('td', { className: 'center' },
      checkbox(bd.insurance, v => edit(x => { x.bidders[j].insurance = v; }), { title: 'Liability insurance certificate on file', dataset: { key: k + 'ins' + bd.id } }))), 'foot'));
    tbody.append(footRow('Notes', b.bidders.map((bd, j) => el('td', { className: 'cell-input' },
      textInput(bd.notes, v => edit(x => { x.bidders[j].notes = v; }), { dataset: { key: k + 'notes' + bd.id } }))), 'foot'));
    tbody.append(footRow('', b.bidders.map(bd => {
      const chosen = b.selectedBidderId === bd.id;
      return el('td', { className: 'center' },
        chosen ? button('Chosen', 'This bidder is the subcontract line. Click to clear.', () => edit(x => { x.selectedBidderId = null; }), 'small primary')
          : button('Choose', 'Use this bidder for the subcontract line', () => edit(x => { x.selectedBidderId = bd.id; }), 'small'),
        ' ',
        button('Remove', 'Remove this bidder', async () => {
          if (!await ask('Remove bidder ' + (bd.name || '') + '?', 'Remove')) return;
          edit(x => {
            x.bidders = x.bidders.filter(y => y.id !== bd.id);
            if (x.selectedBidderId === bd.id) x.selectedBidderId = null;
          });
        }, 'small danger'));
    }), 'foot'));
    table.append(tbody);
    out.push(el('div', { className: 'table-wrap' }, table));

    const chosen = b.selectedBidderId && b.bidders.find(x => x.id === b.selectedBidderId);
    if (chosen && !(chosen.wcbClearance && chosen.insurance)) {
      out.push(el('p', { className: 'note warn', textContent: 'The chosen bidder needs a WCB clearance letter and an insurance certificate before release.' }));
    }
    if (ranked.length && chosen && rank.get(chosen.id) !== 1) {
      out.push(el('p', { className: 'note', textContent: 'The chosen bidder is not the lowest levelled price. Tej chooses; note why.' }));
    }

    out.push(el('div', { className: 'row-buttons' },
      button('Add scope item', 'Add a line every bidder should price', () => edit(x => { x.scopeItems.push({ text: '', plug: 0 }); })),
      button('Fill scope from takeoff', 'Add this trade\'s conditions, rooms and lines with quantities', () => {
        const items = scopeFromTakeoff(est, b);
        if (!items.length) return app.setStatus(b.division ? 'Nothing new in division ' + b.division + ' for this bid' : 'Set the CSI division first', true, 5000);
        edit(x => { for (const t of items) x.scopeItems.push({ text: t, plug: 0 }); });
        app.setStatus(items.length + ' scope items added from the takeoff', false, 4000);
      }),
      button('Add bidder', 'Add a column for another quote', () => edit(x => {
        x.bidders.push({ id: nextBidderId(x), name: '', amount: 0, includes: x.scopeItems.map(() => ''), wcbClearance: false, insurance: false, notes: '' });
      })),
      el('span', { className: 'spacer' }),
      button('Scope letter', 'Open a letter for this trade listing what the quote must include, ready to print', () => app.openOutput('scope', b.id)),
      button('Delete trade', 'Delete this bid sheet', async () => {
        if (!await ask('Delete the bid sheet for ' + b.trade + '?', 'Delete')) return;
        app.change(e => { e.bids = e.bids.filter(x => x.id !== b.id); });
      }, 'danger')));
    return out;
  }

  screens.bids = { label: 'Bids', title: 'Level trade quotes and choose a bidder', render: renderBids };
  window.SteadfastBids = { scopeFromTakeoff };
})();
