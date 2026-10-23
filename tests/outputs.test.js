'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../app/js/calc.js');
const outputs = require('../app/js/outputs.js');
const plan = require('./fixtures/make-test-plan.js');
const { planEstimate, fillCosts, assemblyId } = require('./fixtures/library.js');

// A priced estimate on the test plan, with odd costs so they are easy to find in the HTML.
function pricedEstimate(type) {
  const est = fillCosts(planEstimate(type), 3.17);
  est.job.class = 'B';
  est.job.client = 'Test Client';
  est.settings.contingencyPct = 7;
  est.settings.travelPct = 3;
  est.conditions.push({ id: 'c1', name: 'LVP flooring, offices', measure: 'area', color: '#000', assemblyId: assemblyId(est, 'LVP flooring with underlay'), division: '09', location: 'Level 1' });
  est.conditions.push({ id: 'c2', name: 'Doors', measure: 'count', color: '#000', assemblyId: null, unitCost: 487.13, type: 'S', division: '08', location: 'Level 1' });
  est.measurements.push({ id: 'm1', conditionId: 'c1', sheetId: 's1', points: plan.roomPoints('Office 101'), deduct: false, status: 'ok' });
  est.measurements.push({ id: 'm2', conditionId: 'c2', sheetId: 's1', points: plan.DOORS.map(p => plan.norm(...p)), deduct: false, status: 'ok' });
  est.rooms.push({ id: 'r1', name: 'Kitchen 103', location: 'Level 1', lengthFt: 24, widthFt: 14, heightFt: 9, doors: 1, windows: 0,
    floorAssemblyId: assemblyId(est, 'Floor tile'), wallAssemblyId: assemblyId(est, 'Paint walls, 2 coats'), status: 'ok' });
  est.lines.push({ id: 'l1', division: '01', description: 'Disposal bin (20 yd)', qty: 3, unit: 'ea', unitCost: 612.41, type: 'E', allowance: false, alternateId: null, status: 'ok' });
  est.lines.push({ id: 'l2', division: '22', description: 'Plumbing fixtures allowance', qty: 1, unit: 'lot', unitCost: 2750.33, type: 'M', allowance: true, alternateId: null, status: 'ok' });
  est.alternates.push({ id: 'alt1', name: 'Alternate 1', description: 'New kitchen cabinets', sign: 'add' });
  est.lines.push({ id: 'l3', division: '12', description: 'Kitchen cabinets', qty: 24, unit: 'lf', unitCost: 391.77, type: 'S', alternateId: 'alt1', status: 'ok' });
  est.exclusions.push('Asbestos testing and abatement');
  est.assumptions.push('Work during normal business hours');
  est.risks.push({ id: 'k1', risk: 'Subfloor repairs', likelyCost: 4321, inPrice: 1234 });
  return est;
}

test('the customer quote contains no cost, markup or margin figures', () => {
  for (const type of ['commercial', 'residential']) {
    const est = pricedEstimate(type);
    const m = calc.money(est);
    const html = outputs.quoteHtml(est, { showQty: true });
    const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /\bcost/i, type);
    assert.doesNotMatch(text, /\bmark-?up/i, type);
    assert.doesNotMatch(text, /\bmargin/i, type);
    assert.doesNotMatch(text, /contingency|travel|risk|subcontract|labour/i, type);
    const secret = [m.base.direct, m.base.cost, m.base.contingency, m.base.travel, m.base.calculated - m.base.cost,
      487.13, 612.41, 391.77, 3.17, 4321, 1234, m.alternates[0].cost];
    for (const v of secret) {
      for (const shown of [calc.fmtMoney(v), String(calc.round(v, 2))].concat(Math.abs(v) >= 1000 ? [calc.fmtMoney(v, 0)] : [])) {
        assert.ok(!text.includes(shown), type + ': quote shows ' + shown);
      }
    }
    assert.ok(text.includes(calc.fmtMoney(m.base.price)), 'price shown');
    assert.ok(text.includes(calc.fmtMoney(m.base.gst)), 'GST shown');
    assert.ok(text.includes(calc.fmtMoney(m.base.total)), 'total shown');
    assert.ok(text.includes(calc.fmtMoney(m.alternates[0].price)), 'alternate price shown');
    assert.ok(text.includes('Plumbing fixtures allowance'));
    assert.ok(text.includes('$2,750.33'), 'allowance amount shown');
    assert.ok(text.includes('Asbestos testing and abatement'));
    assert.match(text, /Customer[\s\S]*Signature[\s\S]*Steadfast Constructions Ltd[\s\S]*Signature/);
    assert.match(html, /@bottom-left \{ content: "Page " counter\(page\)/);
    assert.match(html, /@bottom-right \{ content: "Customer quote"/);
    assert.match(html, /font: 10\.5pt\/1\.4 Arial/);
  }
});

test('residential quote groups scope by room and shows the stage invoices', () => {
  const est = pricedEstimate('residential');
  const html = outputs.quoteHtml(est, {});
  assert.match(html, /<h3>Kitchen 103<\/h3>/);
  const m = calc.money(est);
  for (const s of calc.stageInvoices(est, m.base.price, m.base.gst)) assert.ok(html.includes(calc.fmtMoney(s.total)));
});

test('commercial quote groups scope by CSI division', () => {
  const html = outputs.quoteHtml(pricedEstimate('commercial'), {});
  assert.match(html, /<h3>09 Finishes<\/h3>/);
  assert.match(html, /<h3>08 Openings<\/h3>/);
  assert.match(html, /holdback/);
});

test('the internal estimate shows everything and is marked owners only', () => {
  const est = pricedEstimate('commercial');
  const m = calc.money(est);
  const html = outputs.internalHtml(est, {});
  assert.match(html, /Internal\. Owners only\./);
  assert.ok(html.includes(calc.fmtMoney(m.base.cost)));
  assert.ok(html.includes(calc.fmtPct(m.base.margin)));
  assert.ok(html.includes(calc.fmtPct(m.base.markup)));
  assert.match(html, /@bottom-right \{ content: "Internal estimate\. Owners only\."/);
});

test('lines CSV for Monday.com leaves costs out unless asked', () => {
  const est = pricedEstimate('commercial');
  const plain = calc.parseCsv(outputs.linesCsv(est, false));
  assert.deepEqual(plain[0], ['Item', 'Division', 'Location', 'Quantity', 'Unit', 'Type', 'Bid', 'Allowance', 'Status', 'Code']);
  assert.equal(plain.length - 1, calc.estimateLines(est).length);
  assert.ok(!outputs.linesCsv(est, false).includes('612.41'));
  const withCosts = calc.parseCsv(outputs.linesCsv(est, true));
  assert.deepEqual(withCosts[0].slice(-2), ['Unit cost', 'Total']);
  assert.ok(outputs.linesCsv(est, true).includes('612.41'));
});

test('the scope letter lists the scope and asks for WCB and insurance, with no plugs or other prices', () => {
  const est = pricedEstimate('commercial');
  est.bids.push({ id: 'b1', trade: 'Flooring', division: '09', alternateId: null,
    scopeItems: [{ text: 'LVP flooring, offices: 280 sf', plug: 1987.65 }, { text: 'Floor prep', plug: 543.21 }],
    bidders: [{ id: 'bd1', name: 'Acme Floors', amount: 11111.11, includes: ['y', 'n'], wcbClearance: true, insurance: true, notes: 'Secret note' },
      { id: 'bd2', name: 'Other Floors', amount: 9999.99, includes: ['y', 'y'], wcbClearance: false, insurance: false, notes: '' }],
    selectedBidderId: 'bd1', source: 'owner', status: 'ok' });
  const html = outputs.scopeLetterHtml(est, 'b1', {});
  const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
  assert.match(text, /LVP flooring, offices: 280 sf/);
  assert.match(text, /WCB Alberta clearance letter/);
  assert.match(text, /liability insurance/);
  for (const secret of ['1,987.65', '543.21', '11,111.11', '9,999.99', 'Acme', 'Other Floors', 'Secret note']) assert.ok(!text.includes(secret), secret);
  assert.doesNotMatch(text, /\$\d/);
  assert.match(html, /@bottom-right \{ content: "Scope letter, Flooring"/);
});
