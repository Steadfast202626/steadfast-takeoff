/*
 * Steadfast takeoff: the Cash flow screen (commercial). Monthly progress billing, holdback and the
 * bank balance, from calc.cashFlow. Every default is labelled "check the contract".
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const { el, select, checkbox, numInput } = window.SteadfastUI;
  const screens = window.SteadfastScreens = window.SteadfastScreens || {};
  const SVG = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs, text) {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // A rounded end on the data side of a bar, square on the baseline.
  function barPath(x, w, y0, y1) {
    const r = Math.min(4, w / 2, Math.abs(y1 - y0));
    if (y1 < y0) return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
    return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
  }

  // Bank balance at each month end: one series, bars from a zero baseline, the lowest month labelled.
  function balanceChart(cf) {
    const W = 760, H = 240, L = 72, R = 12, T = 22, B = 30;
    const vals = cf.months.map(m => m.balance);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    if (hi === lo) hi = lo + 1;
    // Round the axis to a tidy step (1, 2, 2.5 or 5 times a power of ten)
    const rough = (hi - lo) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const tick = [1, 2, 2.5, 5, 10].map(f => f * mag).find(x => x >= rough);
    lo = Math.floor(lo / tick) * tick;
    hi = Math.ceil(hi / tick) * tick;
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const step = (W - L - R) / cf.months.length;
    const bw = Math.max(6, Math.min(56, step * 0.6));
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Bank balance at each month end' });

    // Recessive grid with four ticks
    for (let v = lo; v <= hi + tick / 2; v += tick) {
      root.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid-line' }));
      root.append(svg('text', { x: L - 8, y: y(v) + 4, class: 'axis-label', 'text-anchor': 'end' }, calc.fmtMoney(v, 0)));
    }
    root.append(svg('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'zero-line' }));

    cf.months.forEach((m, i) => {
      const x = L + step * i + (step - bw) / 2;
      const g = svg('g', { class: 'bar' + (m.balance < 0 ? ' below' : '') + (m.month === cf.lowestMonth ? ' lowest' : '') });
      // A wider invisible target makes the hover easy
      g.append(svg('rect', { x: L + step * i, y: T, width: step, height: H - T - B, class: 'hit' }));
      g.append(svg('path', { d: barPath(x, bw, y(0), y(m.balance)) }));
      g.append(svg('title', {}, m.label + ': balance ' + calc.fmtMoney(m.balance, 0) + ', in ' + calc.fmtMoney(m.moneyIn, 0) + ', out ' + calc.fmtMoney(m.moneyOut, 0)));
      root.append(g);
      root.append(svg('text', { x: L + step * i + step / 2, y: H - 10, class: 'axis-label', 'text-anchor': 'middle' }, m.label.replace(/^Month /, 'M')));
      if (m.month === cf.lowestMonth) {
        const ly = m.balance < 0 ? y(m.balance) + 16 : y(m.balance) - 6;
        root.append(svg('text', { x: x + bw / 2, y: ly, class: 'value-label', 'text-anchor': 'middle' }, 'Lowest ' + calc.fmtMoney(m.balance, 0)));
      }
    });
    return root;
  }

  function renderCash(root, app) {
    const est = app.est;
    const c = est.settings.cash;
    const m = calc.money(est);
    const cf = calc.cashFlow(est, m);
    const set = (k, v) => app.change(e => { e.settings.cash[k] = v; });

    root.append(el('div', { className: 'screen-head' }, el('h1', { textContent: 'Cash flow' }),
      el('span', { className: 'muted', textContent: 'Base bid, before GST' })));
    if (est.job.type !== 'commercial') root.append(el('p', { className: 'note warn', textContent: 'Cash flow is for commercial jobs. This job is set to residential in Job details.' }));
    root.append(el('p', { className: 'note', textContent: 'The defaults follow Alberta\'s prompt payment rules as Steadfast reads them. Every one of them: check the contract.' }));

    const f = (label, key, attrs, tip) => el('label', { className: 'field', title: tip || '' }, label,
      numInput(c[key], v => set(key, v), Object.assign({ dataset: { key: 'cash-' + key } }, attrs || {})),
      el('span', { className: 'hint', textContent: 'Check the contract' }));
    const month = el('input', { type: 'month', value: (c.startDate || '').slice(0, 7), dataset: { key: 'cash-start' } });
    month.addEventListener('change', () => set('startDate', month.value ? month.value + '-01' : ''));

    root.append(el('section', { className: 'card' }, el('h2', { textContent: 'Terms' }),
      el('div', { className: 'form-grid four' },
        el('label', { className: 'field', title: 'Money in the bank before the job starts' }, 'Starting balance $',
          numInput(c.startBalance, v => set('startBalance', v || 0), { dataset: { key: 'cash-startBalance' } }), el('span', { className: 'hint', textContent: 'From Tej' })),
        f('Months of work', 'months', { min: 1, step: 1 }, 'How long the work takes'),
        el('label', { className: 'field' }, 'Start month', month, el('span', { className: 'hint', textContent: 'Check the schedule' })),
        el('label', { className: 'field', title: 'How the work spreads over the months' }, 'Spread',
          select([['even', 'Even'], ['s-curve', 'S-curve']], c.curve, v => set('curve', v), { dataset: { key: 'cash-curve' } }), el('span', { className: 'hint', textContent: 'Check the schedule' })),
        f('Owner pays in (days)', 'ownerPayDays', { min: 0 }, 'Days from a proper invoice to payment'),
        f('Trades paid within (days)', 'subPayDays', { min: 0 }, 'Days after Steadfast is paid'),
        f('Holdback %', 'holdbackPct', { min: 0, max: 100 }, 'Kept back at each tier'),
        f('Lien period (days)', 'lienDays', { min: 0 }, 'Before holdback is released'),
        f('Release admin (days)', 'releaseDays', { min: 0 }, 'Paperwork time after the lien period'))));

    const low = cf.lowest;
    root.append(el('div', { className: 'stat-row' },
      el('div', { className: 'stat' + (low < 0 ? ' warn' : '') }, el('span', { textContent: 'Lowest balance' }), el('strong', { textContent: calc.fmtMoney(low, 0) }), el('span', { textContent: cf.lowestLabel })),
      el('div', { className: 'stat' }, el('span', { textContent: 'First payment' }), el('strong', { textContent: cf.months[cf.payLag] ? cf.months[cf.payLag].label : '—' }), el('span', { textContent: 'for month 1 work' })),
      el('div', { className: 'stat' }, el('span', { textContent: 'Holdback back' }), el('strong', { textContent: calc.fmtMoney(cf.holdbackIn, 0) }), el('span', { textContent: cf.months[cf.releaseMonth - 1].label })),
      el('div', { className: 'stat' }, el('span', { textContent: 'Trades\' share of cost' }), el('strong', { textContent: calc.fmtPct(cf.subShare, 0) }), el('span', { textContent: 'paid when Steadfast is paid' }))));
    if (low < 0) root.append(el('p', { className: 'note warn', textContent: 'The bank balance goes below zero in ' + cf.lowestLabel + '. Tej to plan the money before the bid goes in.' }));
    if (m.base.missing) root.append(el('p', { className: 'note warn', textContent: m.base.missing + ' lines with no cost are left out of these figures.' }));

    root.append(el('section', { className: 'card' }, el('h2', { textContent: 'Bank balance at month end' }), balanceChart(cf)));

    const table = el('table', { className: 'grid' }, el('thead', {}, el('tr', {},
      ['Month', 'Work done (cost)', 'Invoiced', 'Money in', 'Paid to trades', 'Other costs', 'Balance'].map((h, i) => el('th', { textContent: h, className: i ? 'num' : '' })))));
    const tbody = el('tbody');
    tbody.append(el('tr', {}, el('td', { textContent: 'Start' }), el('td'), el('td'), el('td'), el('td'), el('td'),
      el('td', { className: 'num', textContent: calc.fmtMoney(cf.startBalance, 0) })));
    for (const mo of cf.months) {
      tbody.append(el('tr', { className: mo.month === cf.lowestMonth ? 'lowest-row' : '' },
        el('td', { textContent: mo.label + (mo.month === cf.releaseMonth ? ' (holdback released)' : '') }),
        el('td', { className: 'num', textContent: mo.work ? calc.fmtMoney(mo.work, 0) : '' }),
        el('td', { className: 'num', textContent: mo.invoiced ? calc.fmtMoney(mo.invoiced, 0) : '' }),
        el('td', { className: 'num', textContent: calc.fmtMoney(mo.moneyIn, 0) }),
        el('td', { className: 'num', textContent: calc.fmtMoney(mo.subsOut, 0) }),
        el('td', { className: 'num', textContent: calc.fmtMoney(mo.otherOut, 0) }),
        el('td', { className: 'num' + (mo.balance < 0 ? ' warn-text' : ''), textContent: calc.fmtMoney(mo.balance, 0) })));
    }
    table.append(tbody);
    root.append(el('div', { className: 'table-wrap' }, table));

    const reviewed = !!(c.reviewed || est.manualChecks.cashReviewed);
    root.append(el('label', { className: 'check big', title: 'Release check 13 for commercial jobs' },
      checkbox(reviewed, v => app.change(e => { e.settings.cash.reviewed = v; e.manualChecks.cashReviewed = v; }), { dataset: { key: 'cash-reviewed' } }),
      'Cash flow reviewed against the contract'));
  }

  screens.cash = { label: 'Cash flow', title: 'Monthly billing, holdback and the bank balance for commercial jobs', render: renderCash };
})();
