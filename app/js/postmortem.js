/*
 * Steadfast takeoff: post-mortem maths. Estimate against actual by section (CSI division), profit
 * achieved against the target, change orders and hours, and the price book items to look at when a
 * section is off by more than 10%. Estimated numbers come from calc.js, so they match the estimate.
 * Actual costs are typed in for now; QuickBooks will fill record.qbo later, by the same divisions.
 * Works in the browser (SteadfastPostmortem) and in Node (require), so the tests can use it.
 *
 * record: { actuals: { [division]: number }, qbo: { [division]: number } | null,
 *           changeOrders: [{ description, price, cost }], actualHours, status,
 *           wentWell, toChange, overWhy, qboProject }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.SteadfastPostmortem = factory(root.SteadfastCalc);
})(typeof self !== 'undefined' ? self : this, function (calc) {
  'use strict';

  const OFF_LIMIT = 0.10; // a section more than 10% off offers a price book update
  const isNum = v => typeof v === 'number' && isFinite(v);
  const sum = (list, f) => list.reduce((a, x) => a + (isNum(f(x)) ? f(x) : 0), 0);

  function emptyRecord() {
    return { actuals: {}, qbo: null, qboUnmatched: 0, changeOrders: [], actualHours: null, status: 'In progress', wentWell: '', toChange: '', overWhy: '', qboProject: '' };
  }

  // The actual for a section: what was typed, else what QuickBooks gave, else nothing yet.
  function actualFor(record, division) {
    if (isNum(record.actuals && record.actuals[division])) return { value: record.actuals[division], from: 'typed' };
    if (record.qbo && isNum(record.qbo[division])) return { value: record.qbo[division], from: 'QuickBooks' };
    return { value: null, from: '' };
  }

  function compute(est, record) {
    record = Object.assign(emptyRecord(), record || {});
    const m = calc.money(est);
    const base = m.lines.filter(l => !l.alternateId);
    const divisions = [...new Set(base.map(l => l.division || '00'))].sort();

    const sections = divisions.map(d => {
      const lines = base.filter(l => (l.division || '00') === d);
      const estimated = calc.round2(sum(lines, l => l.total));
      const a = actualFor(record, d);
      const variance = a.value === null ? null : calc.round2(a.value - estimated);
      const pct = a.value === null || !estimated ? null : (a.value - estimated) / estimated;
      return {
        division: d, label: d + ' ' + calc.divisionName(d), estimated, actual: a.value, actualFrom: a.from, variance, pct,
        off: pct !== null && Math.abs(pct) > OFF_LIMIT, hours: sum(lines.filter(l => l.unit === 'hr'), l => l.qty)
      };
    });

    const extras = calc.round2((m.base.travel || 0) + (m.base.contingency || 0));
    const cos = (record.changeOrders || []).filter(c => c && (isNum(c.price) || isNum(c.cost) || c.description));
    const coPrice = calc.round2(sum(cos, c => c.price));
    const coCost = calc.round2(sum(cos, c => c.cost));
    const contract = isNum(m.base.price) ? calc.round2(m.base.price + coPrice) : null;
    // QuickBooks costs on the project that land in no estimate section are still real costs.
    const known = new Set(divisions);
    const qboOther = record.qbo ? calc.round2(sum(Object.keys(record.qbo).filter(d => !known.has(d)), d => record.qbo[d]) + (isNum(record.qboUnmatched) ? record.qboUnmatched : 0)) : 0;
    const entered = sections.filter(s => s.actual !== null);
    const actualCost = entered.length ? calc.round2(sum(entered, s => s.actual) + coCost + qboOther) : null;
    const plannedCost = isNum(m.base.cost) ? calc.round2(m.base.cost + coCost) : null;
    const profit = contract !== null && actualCost !== null ? calc.round2(contract - actualCost) : null;
    const margin = profit !== null && contract ? profit / contract : null;
    const plannedMargin = contract && plannedCost !== null ? (contract - plannedCost) / contract : null;
    const estimatedHours = calc.round2(sum(sections, s => s.hours));

    return {
      sections, extras, changeOrders: cos, coPrice, coCost, qboOther,
      contract, plannedCost, actualCost, profit, margin, plannedMargin,
      target: est.settings.marginTarget, floor: calc.marginFloor(est),
      estimatedHours, actualHours: isNum(record.actualHours) ? record.actualHours : null,
      complete: entered.length === sections.length && sections.length > 0,
      missing: sections.filter(s => s.actual === null).map(s => s.label)
    };
  }

  // Price book items used in a section that is more than 10% off, with a cost moved by the same share.
  // These are suggestions for Kamal to approve on the Monday.com Price book board; nothing changes here.
  function priceBookOffers(est, result) {
    const m = calc.money(est);
    const out = [];
    for (const s of result.sections.filter(x => x.off)) {
      const ratio = s.actual / s.estimated;
      const codes = new Set(m.lines.filter(l => !l.alternateId && (l.division || '00') === s.division && l.code).map(l => l.code));
      for (const code of codes) {
        const pb = est.priceBook.find(p => p.code === code);
        if (!pb || !isNum(pb.unitCost)) continue;
        out.push({ code, item: pb.item, unit: pb.unit, division: s.division, current: pb.unitCost,
          proposed: calc.round2(pb.unitCost * ratio), pct: s.pct });
      }
    }
    return out;
  }

  // Change orders as plain lines for the Monday.com "Change order list" column, and back.
  function changeOrdersToText(list) {
    return (list || []).map(c => [c.description || '', isNum(c.price) ? c.price : '', isNum(c.cost) ? c.cost : ''].join(' | ')).join('\n');
  }

  function changeOrdersFromText(text) {
    return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [d, p, c] = l.split('|').map(x => x.trim());
      const n = x => (x === '' || x === undefined || !isFinite(Number(x)) ? null : Number(x));
      return { description: d || '', price: n(p), cost: n(c) };
    });
  }

  return { compute, priceBookOffers, emptyRecord, actualFor, changeOrdersToText, changeOrdersFromText, OFF_LIMIT };
});
