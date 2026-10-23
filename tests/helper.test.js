'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const calc = require('../app/js/calc.js');
const plan = require('./fixtures/make-test-plan.js');
const { planEstimate, fillCosts, assemblyId } = require('./fixtures/library.js');

const HELPER = path.join(__dirname, '..', 'tools', 'estimate.js');

function run(...args) {
  const r = spawnSync(process.execPath, [HELPER, ...args], { encoding: 'utf8' });
  return { out: r.stdout, err: r.stderr, code: r.status };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'steadfast-'));
}

function write(dir, name, obj) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return f;
}

function pricedEstimate() {
  const est = fillCosts(planEstimate('commercial'), 2.35);
  est.settings.contingencyPct = 6;
  est.settings.travelPct = 2;
  est.settings.commercialFloor = 22;
  est.conditions.push({ id: 'c1', name: 'LVP', measure: 'area', color: '#000', assemblyId: assemblyId(est, 'LVP flooring with underlay'), division: '09', location: 'Level 1' });
  est.measurements.push({ id: 'm1', conditionId: 'c1', sheetId: 's1', points: plan.roomPoints('Open office 106'), deduct: false, status: 'ok' });
  est.alternates.push({ id: 'alt1', name: 'Carpet credit', description: '', sign: 'deduct' });
  est.lines.push({ id: 'l1', description: 'Credit', qty: 1, unit: 'lot', unitCost: 777, type: 'S', alternateId: 'alt1', status: 'ok' });
  return est;
}

test('the helper and the app give identical totals for the same file', () => {
  const dir = tempDir();
  const est = pricedEstimate();
  const file = write(dir, 'est.json', est);
  const r = run('summary', file, '--json');
  assert.equal(r.code, 0, r.err);
  const helper = JSON.parse(r.out);
  const app = calc.money(calc.normalize(JSON.parse(fs.readFileSync(file, 'utf8'))));
  for (const k of ['direct', 'travel', 'contingency', 'cost', 'calculated', 'price', 'margin', 'markup', 'gst', 'total', 'missing']) {
    assert.equal(helper.base[k], app.base[k], k);
    assert.equal(helper.alternates[0][k], app.alternates[0][k], 'alternate ' + k);
  }
  const text = run('summary', file).out;
  assert.ok(text.includes(calc.fmtMoney(app.base.price)));
  assert.ok(text.includes(calc.fmtPct(app.base.margin)));
  assert.ok(text.includes(calc.fmtPct(app.base.markup)));
});

test('helper: sheets, lines and validate', () => {
  const dir = tempDir();
  const file = write(dir, 'est.json', pricedEstimate());
  const sheets = run('sheets', file);
  assert.match(sheets.out, /A-101\s+1\/4" = 1'-0"\s+1 markup/);
  const lines = run('lines', file);
  assert.match(lines.out, /Luxury vinyl plank/);
  const csv = calc.parseCsv(run('lines', file, '--csv').out);
  assert.equal(csv[0][0], 'Bid');
  assert.equal(csv.length - 1, calc.estimateLines(pricedEstimate()).length);
  const v = run('validate', file);
  assert.equal(v.code, 0, v.out);
  const bad = write(dir, 'bad.json', Object.assign(pricedEstimate(), { measurements: [{ id: 'm1', conditionId: 'zz', sheetId: 's1', points: [[0, 0]] }] }));
  assert.equal(run('validate', bad).code, 1);
  assert.equal(run('nope').code, 2);
  assert.equal(run('summary', path.join(dir, 'missing.json')).code, 1);
});

test('helper import refuses a bad import file and changes nothing', () => {
  const dir = tempDir();
  const file = write(dir, 'est.json', pricedEstimate());
  const before = fs.readFileSync(file, 'utf8');
  const imp = write(dir, 'imp.json', { format: 'steadfast-estimator-import', version: 1, lines: [{ description: 'x', qty: 1, status: 'ok' }] });
  const r = run('import', file, imp);
  assert.equal(r.code, 1);
  assert.match(r.err, /cannot mark anything "ok"/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(!fs.existsSync(file + '.bak'));
});

test('end to end: the helper imports rooms, counts and flooring; accepting them and filling the gaps passes the checklist', () => {
  const dir = tempDir();
  const est = planEstimate('residential');
  est.job.class = 'B';
  const file = write(dir, '2026-10-22 — Estimate — Test plan.json', est);
  const imp = write(dir, 'import-2026-10-22-0900.json', {
    format: 'steadfast-estimator-import', version: 1, job: 'Test plan', preparedBy: 'Claude estimator', date: '2026-10-22',
    summary: 'Flooring, rooms and doors from A-101.',
    sheets: [{ sheet: 'A-101', scaleLabel: '1/4" = 1\'-0"', basis: 'Title block, checked against the 20\'-0" dimension' }],
    conditions: [
      { name: 'LVP flooring, open office', measure: 'area', assembly: 'LVP flooring with underlay', division: '09', location: 'Level 1' },
      { name: 'Interior doors', measure: 'count', assembly: 'Interior door, prehung, cased both sides', division: '08', location: 'Level 1' }
    ],
    measurements: [
      { condition: 'LVP flooring, open office', sheet: 'A-101', points: plan.roomPoints('Open office 106'), statedQty: 800, note: 'Open office 106', basis: '40\'-0" x 20\'-0" on A-101', confidence: 'high' },
      { condition: 'Interior doors', sheet: 'A-101', points: plan.DOORS.map(p => plan.norm(...p)), statedQty: 7, note: 'Doors', basis: 'Door swings on A-101', confidence: 'medium' }
    ],
    rooms: [
      { name: 'Office 101', location: 'Level 1', lengthFt: 20, widthFt: 14, heightFt: 9, doors: 1, windows: 1, floor: 'Carpet', walls: 'Paint walls, 2 coats', base: 'Rubber base 4"', basis: '20\'-0" x 14\'-0" on A-101' },
      { name: 'Office 102', location: 'Level 1', lengthFt: 16, widthFt: 14, heightFt: 9, doors: 1, windows: 1, floor: 'Carpet', walls: 'Paint walls, 2 coats', base: 'Rubber base 4"', basis: '16\'-0" x 14\'-0" on A-101' }
    ],
    rfis: [{ question: 'Ceiling height in the open office?', reference: 'A-101' }],
    priceChanges: [{ code: '09-CPT', unitCost: 4.85, source: 'Flooring supplier quote, 2026-10-20' }]
  });

  const r = run('import', file, imp);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Added/);
  assert.match(r.out, /4 items wait for Kamal's check/);
  assert.match(r.out, /09-CPT/);
  assert.ok(fs.existsSync(file + '.bak'));
  let out = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(out.measurements.length, 2);
  assert.ok(out.measurements.every(m => m.source === 'estimator' && m.status === 'check'));
  assert.ok(out.rooms.every(m => m.status === 'check'));
  assert.equal(out.priceBook.find(p => p.code === '09-CPT').unitCost, null);
  const lvp = calc.conditionTotals(out, out.conditions[0].id);
  assert.equal(lvp.sf, 800);
  assert.equal(lvp.flagged, 0, 'traced and stated agree within 10%');
  assert.equal(calc.conditionTotals(out, out.conditions[1].id).ea, 7);

  // Importing the same file again adds nothing and leaves the file alone
  const again = run('import', file, imp);
  assert.match(again.out, /Nothing new to add/);

  let c = run('checks', file);
  assert.equal(c.code, 1);
  assert.match(c.out, /OPEN\s+2\. No items marked "check" are left \(4 waiting for Kamal\)/);

  // In the app Kamal accepts the items (same rule as the app's Accept buttons)
  calc.acceptItems(out);
  fs.writeFileSync(file, JSON.stringify(out));
  c = run('checks', file);
  assert.doesNotMatch(c.out, /OPEN\s+2\./);
  assert.match(c.out, /OPEN\s+3\. Every line has a cost/);

  // Costs, contingency, exclusions and a risk fill the rest
  fillCosts(out, 3);
  out.settings.contingencyPct = 5;
  out.exclusions.push('Asbestos testing and abatement');
  out.risks.push({ id: 'k1', risk: 'Subfloor repairs under carpet', likelyCost: 1500, inPrice: 0 });
  fs.writeFileSync(file, JSON.stringify(out));
  c = run('checks', file);
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /All required checks pass/);
});
