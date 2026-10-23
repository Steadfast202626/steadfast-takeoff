'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const calc = require('../app/js/calc.js');
const plan = require('./fixtures/make-test-plan.js');
const { starterLibrary, planEstimate, fillCosts, assemblyId } = require('./fixtures/library.js');

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= (tol || 1e-9), `${msg || ''} expected ${expected}, got ${actual}`);
}

function costLine(est, cost) {
  est.lines.push({ id: 'l1', division: '01', description: 'Test cost', qty: 1, unit: 'lot', unitCost: cost, type: 'S',
    allowance: false, alternateId: null, source: 'owner', status: 'ok', basis: '' });
}

test('$10,000 of cost at a 35% target prices at $15,390: margin 35.0%, markup 53.9%', () => {
  const est = calc.newEstimate('2026-10-22');
  est.settings.contingencyPct = 0;
  costLine(est, 10000);
  const m = calc.money(est);
  assert.equal(m.base.cost, 10000);
  assert.equal(m.base.price, 15390);
  assert.equal(calc.fmtPct(m.base.margin), '35.0%');
  assert.equal(calc.fmtPct(m.base.markup), '53.9%');
});

test('travel and contingency follow the format order', () => {
  const est = calc.newEstimate('2026-10-22');
  est.settings.travelPct = 10;
  est.settings.contingencyPct = 5;
  costLine(est, 10000);
  const b = calc.money(est).base;
  assert.equal(b.direct, 10000);
  assert.equal(b.travel, 1000);
  close(b.contingency, 550);
  close(b.cost, 11550);
  assert.equal(b.price, calc.money(est).base.calculated);
  assert.equal(b.price % 10, 0);
});

test('a price override replaces the calculated price and margin follows it', () => {
  const est = calc.newEstimate('2026-10-22');
  costLine(est, 10000);
  est.settings.priceOverride = 14000;
  const b = calc.money(est).base;
  assert.equal(b.price, 14000);
  assert.equal(b.calculated, 15390);
  close(b.margin, 4000 / 14000);
});

test('GST is 5% and stage invoices total the price plus GST', () => {
  const est = calc.newEstimate('2026-10-22');
  costLine(est, 12345.67);
  const b = calc.money(est).base;
  assert.equal(b.gst, Math.round(b.price * 0.05 * 100) / 100);
  const stages = calc.stageInvoices(est, b.price, b.gst);
  assert.deepEqual(stages.map(s => s.pct), [25, 35, 30, 10]);
  close(stages.reduce((a, s) => a + s.amount, 0), b.price, 1e-6);
  close(stages.reduce((a, s) => a + s.gst, 0), b.gst, 1e-6);
  close(stages.reduce((a, s) => a + s.total, 0), b.price + b.gst, 1e-6);
  for (const s of stages) close(s.gst, Math.round(s.amount * 0.05 * 100) / 100, 0.011);
});

test('a missing cost is missing, never zero', () => {
  const est = calc.newEstimate('2026-10-22');
  costLine(est, null);
  const m = calc.money(est);
  assert.equal(m.lines[0].total, null);
  assert.equal(m.lines[0].missing, true);
  assert.equal(m.base.missing, 1);
  const check = calc.releaseChecks(est).find(c => c.n === 3);
  assert.equal(check.status, 'fail');
});

test('assembly lines: 280 sf of LVP with underlay', () => {
  const est = fillCosts(planEstimate());
  est.conditions.push({ id: 'c1', name: 'LVP, offices', measure: 'area', color: '#000', heightFt: null,
    assemblyId: assemblyId(est, 'LVP flooring with underlay'), unitCost: null, type: 'S', division: '09', location: 'Level 1', alternateId: null, hidden: false });
  est.measurements.push({ id: 'm1', conditionId: 'c1', sheetId: 's1', points: plan.roomPoints('Office 101'), deduct: false, statedQty: null, note: '', source: 'owner', status: 'ok' });
  const lines = calc.estimateLines(est);
  const by = code => lines.find(l => l.code === code);
  close(by('09-LVP').qty, 308);   // 10% waste
  close(by('09-UND').qty, 294);   // 5% waste
  close(by('09-FIL').qty, 280);
  assert.equal(by('09-LVP').division, '09');
  assert.equal(by('09-LVP').location, 'Level 1');
});

test('a condition with no assembly is its main quantity times its unit cost', () => {
  const est = planEstimate();
  est.conditions.push({ id: 'c1', name: 'Doors', measure: 'count', color: '#000', assemblyId: null, unitCost: 450, type: 'S', division: '08', location: '', alternateId: null });
  est.measurements.push({ id: 'm1', conditionId: 'c1', sheetId: 's1', points: plan.DOORS.map(p => plan.norm(...p)), deduct: false, statedQty: null, source: 'owner', status: 'ok' });
  const [l] = calc.estimateLines(est);
  assert.equal(l.qty, 7);
  assert.equal(l.unit, 'ea');
  assert.equal(l.total, 3150);
});

test('room quantities follow the format', () => {
  const est = calc.newEstimate('2026-10-22');
  const q = calc.roomQty(est, { lengthFt: 14, widthFt: 17.5, heightFt: 9, doors: 1, windows: 1 });
  assert.equal(q.area, 245);
  assert.equal(q.perimeter, 63);
  assert.equal(q.wallSf, 63 * 9 - 21 - 12);
  assert.equal(q.ceilingSf, 245);
  assert.equal(q.baseLf, 60);
  const d = calc.roomQty(est, { lengthFt: 10, widthFt: 10, heightFt: null });
  assert.equal(d.height, 8);
  assert.equal(calc.roomQty(est, { areaSf: 100, perimeterLf: 30, lengthFt: 1, widthFt: 1 }).area, 100);
});

test('a room from a traced area takes its area and perimeter', () => {
  const est = planEstimate();
  est.conditions.push({ id: 'c1', name: 'Rooms', measure: 'area', color: '#000' });
  est.measurements.push({ id: 'm1', conditionId: 'c1', sheetId: 's1', points: plan.roomPoints('Office 101'), deduct: false });
  const q = calc.roomQty(est, { measurementId: 'm1', lengthFt: 1, widthFt: 1, heightFt: 9, doors: 1, windows: 0 });
  close(q.area, 280);
  close(q.perimeter, 68);
  close(q.wallSf, 68 * 9 - 21);
});

test('room finishes become lines', () => {
  const est = fillCosts(planEstimate('residential'));
  est.rooms.push({ id: 'r1', name: 'Office 104', location: 'Level 1', lengthFt: 14, widthFt: 17.5, heightFt: 9, doors: 1, windows: 1,
    floorAssemblyId: assemblyId(est, 'LVP flooring with underlay'), wallAssemblyId: assemblyId(est, 'Paint walls, 2 coats'),
    ceilingAssemblyId: null, baseAssemblyId: assemblyId(est, 'Rubber base 4"'), alternateId: null, source: 'owner', status: 'ok' });
  const lines = calc.estimateLines(est);
  close(lines.find(l => l.code === '09-LVP').qty, 245 * 1.1);
  close(lines.find(l => l.code === '09-PNT').qty, 534);
  close(lines.find(l => l.code === '09-RBB').qty, 60 * 1.05);
  assert.equal(lines.find(l => l.code === '09-PNT').room, 'Office 104');
});

test('combine identical items adds quantities', () => {
  const est = fillCosts(planEstimate());
  const lvp = assemblyId(est, 'LVP flooring with underlay');
  for (const [id, room] of [['c1', 'Office 101'], ['c2', 'Office 102']]) {
    est.conditions.push({ id, name: room, measure: 'area', color: '#000', assemblyId: lvp, division: '09', location: room });
    est.measurements.push({ id: 'm' + id, conditionId: id, sheetId: 's1', points: plan.roomPoints(room), deduct: false });
  }
  const combined = calc.combineLines(calc.estimateLines(est));
  const lvpLine = combined.find(l => l.code === '09-LVP');
  close(lvpLine.qty, (280 + 224) * 1.1);
  assert.equal(lvpLine.location, '');
  assert.equal(combined.length, 3);
});

test('alternates are priced on their own, and a deduct alternate is negative', () => {
  const est = calc.newEstimate('2026-10-22');
  est.settings.contingencyPct = 0;
  costLine(est, 10000);
  est.alternates.push({ id: 'alt1', name: 'New cabinets', sign: 'add' }, { id: 'alt2', name: 'Keep carpet', sign: 'deduct' });
  est.lines.push({ id: 'l2', description: 'Cabinets', qty: 1, unit: 'lot', unitCost: 6500, type: 'S', alternateId: 'alt1' });
  est.lines.push({ id: 'l3', description: 'Carpet credit', qty: 1, unit: 'lot', unitCost: 1000, type: 'S', alternateId: 'alt2' });
  const m = calc.money(est);
  assert.equal(m.base.price, 15390);
  assert.equal(m.alternates[0].price, 10000);   // 6500 / 0.65
  assert.equal(m.alternates[1].price, -1540);   // 1538.46 rounded up, then negative
  assert.equal(m.alternates[1].gst, -77);
});

test('bid levelling: plugs fill the gaps and the chosen bidder becomes a line', () => {
  const bid = { id: 'b1', trade: 'Electrical', division: '26', alternateId: null,
    scopeItems: [{ text: 'Pot lights', plug: 0 }, { text: 'Permit', plug: 400 }, { text: 'Panel', plug: 2500 }],
    bidders: [{ id: 'bd1', name: 'A', amount: 10000, includes: ['y', 'n', 'y'], wcbClearance: true, insurance: true },
      { id: 'bd2', name: 'B', amount: 9000, includes: ['y', 'y', ''], wcbClearance: false, insurance: true }],
    selectedBidderId: 'bd2', source: 'owner', status: 'ok' };
  assert.equal(calc.levelledPrice(bid, bid.bidders[0]), 10400);
  assert.equal(calc.levelledPrice(bid, bid.bidders[1]), 11500);
  const est = calc.newEstimate('2026-10-22');
  est.bids.push(bid);
  const [l] = calc.estimateLines(est);
  assert.equal(l.unit, 'lot');
  assert.equal(l.total, 11500);
  assert.equal(calc.releaseChecks(est).find(c => c.n === 10).status, 'fail');
});

test('assembly cost per unit', () => {
  const est = fillCosts(planEstimate(), 2);
  const a = est.assemblies.find(x => x.name === 'LVP flooring with underlay');
  const u = calc.assemblyUnitCost(est, a);
  close(u.sf, 2 * 1.1 + 2 * 1.05 + 2);
  assert.equal(u.missing, 0);
});

test('the release checklist passes once everything is filled', () => {
  const est = fillCosts(planEstimate('residential'), 5);
  est.job.class = 'B';
  est.conditions.push({ id: 'c1', name: 'LVP', measure: 'area', color: '#000', assemblyId: assemblyId(est, 'LVP flooring with underlay'), division: '09' });
  est.measurements.push({ id: 'm1', conditionId: 'c1', sheetId: 's1', points: plan.roomPoints('Office 101'), deduct: false, status: 'ok' });
  let fails = calc.releaseChecks(est).filter(c => c.status === 'fail').map(c => c.n);
  assert.deepEqual(fails, [4, 7, 8]);
  est.settings.contingencyPct = 5;
  est.exclusions.push('Asbestos testing and abatement');
  est.risks.push({ id: 'k1', risk: 'Hidden water damage', likelyCost: 2000, inPrice: 0 });
  fails = calc.releaseChecks(est).filter(c => c.status === 'fail');
  assert.deepEqual(fails, []);
  const warn = calc.releaseChecks(est).find(c => c.n === 9);
  assert.equal(warn.status, 'warn');   // starter assemblies are not confirmed
  est.settings.stages[3].pct = 15;
  assert.equal(calc.releaseChecks(est).find(c => c.n === 12).status, 'fail');
});

test('commercial jobs need a floor and a reviewed cash flow', () => {
  const est = calc.newEstimate('2026-10-22');
  est.job.type = 'commercial';
  costLine(est, 1000);
  const c = calc.releaseChecks(est);
  assert.equal(c.find(x => x.n === 5).status, 'fail');
  assert.equal(c.find(x => x.n === 13).status, 'fail');
  assert.equal(c.find(x => x.n === 12).status, 'na');
  est.settings.commercialFloor = 20;
  est.settings.cash.reviewed = true;
  const d = calc.releaseChecks(est);
  assert.equal(d.find(x => x.n === 5).status, 'pass');
  assert.equal(d.find(x => x.n === 13).status, 'pass');
});

test('Monday.com export rows map to the price book by column name', () => {
  const rows = [
    ['Price book'],
    ['Finishes'],
    ['Name', 'Code', 'Unit', 'Type', 'Unit cost', 'Division', 'Source', 'Date updated'],
    ['Luxury vinyl plank', '09-LVP', 'sf', 'Material', '$3.40', '09 Finishes', 'Supplier quote', 46315],
    ['Rubber base 4"', '09-RBB', 'lf', 'M', '', '9', '', ''],
    ['Labour'],
    ['Name', 'Code', 'Unit', 'Type', 'Unit cost', 'Division', 'Source', 'Date updated'],
    ['Framing labour', '06-FRL', 'hr', 'Labor', '1,250.5', '06', '', '2026-10-01'],
    ['Odd', '99-ODD', 'ea', 'Widget', 'abc', '', '', '']
  ];
  const r = calc.priceBookFromRows(rows);
  assert.equal(r.items.length, 4);
  const lvp = r.items.find(i => i.code === '09-LVP');
  assert.deepEqual(lvp, { code: '09-LVP', item: 'Luxury vinyl plank', unit: 'sf', type: 'M', unitCost: 3.4, division: '09', source: 'Supplier quote', updated: '2026-10-20' });
  assert.equal(r.items.find(i => i.code === '09-RBB').unitCost, null);
  assert.equal(r.items.find(i => i.code === '09-RBB').division, '09');
  assert.equal(r.items.find(i => i.code === '06-FRL').type, 'L');
  assert.equal(r.items.find(i => i.code === '06-FRL').unitCost, 1250.5);
  assert.equal(r.problems.length, 2);
  assert.equal(calc.priceBookFromRows([['a', 'b']]).items.length, 0);
});

test('an Excel export reads the same as the CSV', async () => {
  const { makeZip } = require('../tools/zip.js');
  const xlsx = require('../app/js/xlsx.js');
  const strings = ['Price book', 'Name', 'Code', 'Unit', 'Type', 'Unit cost', 'Luxury vinyl plank', '09-LVP', 'sf', 'Material & more'];
  const s = i => `<c t="s"><v>${i}</v></c>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="2">${s(1)}${s(2)}${s(3)}${s(4)}${s(5)}</row>
    <row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3" t="s"><v>8</v></c><c r="D3" t="inlineStr"><is><t>M</t></is></c><c r="E3"><v>3.4</v></c></row>
  </sheetData></worksheet>`;
  const sst = '<sst>' + strings.map(x => '<si><t>' + x.replace('&', '&amp;') + '</t></si>').join('') + '</sst>';
  const zip = makeZip([
    { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="Price book" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: sst },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ]);
  const rows = await xlsx.readXlsx(zip);
  assert.deepEqual(rows[2], ['Luxury vinyl plank', '09-LVP', 'sf', 'M', 3.4]);
  const r = calc.priceBookFromRows(rows);
  assert.equal(r.items[0].unitCost, 3.4);
  assert.equal(r.items[0].type, 'M');
});

test('the starter library loads, with costs blank', () => {
  const lib = starterLibrary();
  assert.equal(lib.priceBook.length, 48);
  assert.ok(lib.priceBook.every(p => p.unitCost === null && calc.TYPES.includes(p.type)));
  assert.equal(lib.assemblies.length, 23);
  const codes = new Set(lib.priceBook.map(p => p.code));
  for (const a of lib.assemblies) for (const i of a.items) assert.ok(codes.has(i.code), a.name + ' uses ' + i.code);
});

test('the app copy of the starter library matches data/', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'starter-library.js'), 'utf8');
  assert.equal(file, require('../tools/make-starter.js').build(), 'run: node tools/make-starter.js');
});

test('scale labels from the estimator', () => {
  close(calc.parseScaleLabel('1/4" = 1\'-0"').ftPerUnit, 1 / 18);
  close(calc.parseScaleLabel('1/4"=1\'').ftPerUnit, 1 / 18);
  close(calc.parseScaleLabel('SCALE: 1/8" = 1\'-0"').ftPerUnit, 1 / 9);
  close(calc.parseScaleLabel('1:100').ftPerUnit, calc.presetFtPerUnit('metric', 100));
  close(calc.parseScaleLabel('1" = 20\'').ftPerUnit, 20 / 72);
  assert.equal(calc.parseScaleLabel('not to scale'), null);
});

test('CSV round trip', () => {
  const rows = [['a', 'b, c', 'd "e"'], ['1', '', 'x\ny']];
  assert.deepEqual(calc.parseCsv(calc.toCsv(rows)), rows);
});

test('cash flow: holdback timing matches the format file', () => {
  const est = calc.newEstimate('2026-10-22');
  est.job.type = 'commercial';
  est.settings.contingencyPct = 0;
  est.lines.push({ id: 'l1', description: 'Trades', qty: 1, unit: 'lot', unitCost: 6000, type: 'S' });
  est.lines.push({ id: 'l2', description: 'Materials', qty: 1, unit: 'lot', unitCost: 4000, type: 'M' });
  Object.assign(est.settings.cash, { months: 3, ownerPayDays: 28, holdbackPct: 10, lienDays: 60, releaseDays: 10, startBalance: 5000, startDate: '2026-11-01' });
  const cf = calc.cashFlow(est);
  assert.equal(cf.payLag, 1);                      // paid in 28 days: the month after the invoice
  assert.equal(cf.releaseMonth, 6);                // 3 months + ceil(70 / 30)
  assert.equal(cf.months.length, 6);
  close(cf.subShare, 0.6);
  assert.equal(cf.months[0].moneyIn, 0);           // nothing comes in during month 1
  close(cf.months[1].moneyIn, 15390 / 3 * 0.9);
  close(cf.months[3].moneyIn, 15390 / 3 * 0.9);    // last invoice paid in month 4
  close(cf.months[0].otherOut, 4000 / 3);          // materials paid as they happen
  assert.equal(cf.months[0].subsOut, 0);           // trades paid when Steadfast is paid
  close(cf.months[1].subsOut, 2000 * 0.9);
  close(cf.months[5].moneyIn, 1539);               // Steadfast's holdback back in month 6
  close(cf.months[5].subsOut, 600);                // and the trades' holdback paid out
  close(cf.months.reduce((a, x) => a + x.moneyIn, 0), 15390);
  close(cf.months.reduce((a, x) => a + x.moneyOut, 0), 10000);
  close(cf.months[5].balance, 5000 + 5390);
  assert.equal(cf.lowestMonth, 1);
  close(cf.lowest, 5000 - 4000 / 3);
  assert.equal(cf.months[0].label, 'Nov 2026');
  assert.equal(cf.months[2].label, 'Jan 2027');
});

test('cash flow: an s-curve spreads the same total', () => {
  const w = calc.curveWeights(4, 's-curve');
  close(w.reduce((a, x) => a + x, 0), 1);
  assert.ok(w[1] > w[0] && w[2] > w[3]);
  assert.deepEqual(calc.curveWeights(2, 'even'), [0.5, 0.5]);
});
