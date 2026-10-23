'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../app/js/calc.js');
const model = calc;
const plan = require('./fixtures/make-test-plan.js');

const QUARTER_INCH = calc.presetFtPerUnit('architectural', 1 / 4);

function sheet(ftPerUnit) {
  return { id: 's1', name: 'A-101', widthPt: plan.PAGE_W, heightPt: plan.PAGE_H, ftPerUnit };
}

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected}, got ${actual}`);
}

test('test plan is a 24 x 18 inch PDF with two sheets', () => {
  const pdf = plan.makeTestPlan().toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.equal((pdf.match(/\/Type \/Page /g) || []).length, 2);
  assert.ok(pdf.includes('/MediaBox [0 0 1728 1296]'));
  assert.ok(pdf.includes('(A-101)') && pdf.includes('(A-102)'));
  // xref offsets point at their objects
  const xref = pdf.slice(pdf.lastIndexOf('xref'));
  const offsets = xref.split('\n').slice(3).filter(l => / n $/.test(l)).map(l => parseInt(l, 10));
  offsets.forEach((o, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj`, o), `object ${i + 1}`));
});

test('1/4" preset is 1 ft per 18 pt', () => {
  close(QUARTER_INCH, 1 / 18, 1e-12);
  close(calc.presetFtPerUnit('engineering', 20), 20 / 72, 1e-12);
  close(calc.presetFtPerUnit('metric', 100), 100 * 25.4 / 72 / 304.8, 1e-12);
});

test('preset scale and a scale set from a dimension agree within 1%', () => {
  const s = sheet(null);
  const p = plan.norm(...plan.DIMENSION.from), q = plan.norm(...plan.DIMENSION.to);
  // Clicks a little off the tick marks, as a person would make them
  const off = 1.5 / plan.PAGE_W;
  const calibrated = calc.calibrateFtPerUnit([p[0] + off, p[1]], [q[0] - off, q[1] + off], s, calc.parseFeet(plan.DIMENSION.text));
  assert.ok(Math.abs(calibrated - QUARTER_INCH) / QUARTER_INCH < 0.01, `calibrated ${calibrated}`);
});

test('20 x 14 ft room traced as an area is 280 sf and 68 lf of perimeter', () => {
  const s = sheet(QUARTER_INCH);
  const q = calc.measurementQty({ points: plan.roomPoints('Office 101') }, s, { measure: 'area' });
  close(q.sf, 280, 1e-9, 'area');
  close(q.lf, 68, 1e-9, 'perimeter');
  assert.equal(q.main, q.sf);
  assert.equal(q.mainUnit, 'sf');
});

test('40 ft wall at 9 ft is 360 sf', () => {
  const s = sheet(QUARTER_INCH);
  const pts = plan.WALL_40.map(p => plan.norm(...p));
  const q = calc.measurementQty({ points: pts }, s, { measure: 'wall', heightFt: 9 });
  close(q.lf, 40, 1e-9);
  close(q.sf, 360, 1e-9);
});

test('a wall with no height has no square feet, never zero', () => {
  const q = calc.measurementQty({ points: plan.WALL_40.map(p => plan.norm(...p)) }, sheet(QUARTER_INCH), { measure: 'wall', heightFt: null });
  close(q.lf, 40, 1e-9);
  assert.equal(q.sf, null);
});

test('length with a height also gets square feet', () => {
  const pts = plan.WALL_40.map(p => plan.norm(...p));
  assert.equal(calc.measurementQty({ points: pts }, sheet(QUARTER_INCH), { measure: 'length' }).sf, null);
  close(calc.measurementQty({ points: pts }, sheet(QUARTER_INCH), { measure: 'length', heightFt: 4 }).sf, 160, 1e-9);
});

test('counts are the number of points, and need no scale', () => {
  const pts = plan.DOORS.map(p => plan.norm(...p));
  const q = calc.measurementQty({ points: pts }, sheet(null), { measure: 'count' });
  assert.equal(q.ea, 7);
});

test('deducts subtract from condition totals', () => {
  const est = model.newEstimate('2026-10-22');
  est.sheets.push(sheet(QUARTER_INCH));
  est.conditions.push({ id: 'c1', measure: 'area', name: 'Flooring' }, { id: 'c2', measure: 'count', name: 'Doors' });
  est.measurements.push(
    { id: 'm1', conditionId: 'c1', sheetId: 's1', points: plan.roomPoints('Open office 106'), deduct: false },
    { id: 'm2', conditionId: 'c1', sheetId: 's1', points: plan.roomPoints('Washroom 104'), deduct: true },
    { id: 'm3', conditionId: 'c2', sheetId: 's1', points: plan.DOORS.map(p => plan.norm(...p)), deduct: false },
    { id: 'm4', conditionId: 'c2', sheetId: 's1', points: [plan.norm(1, 1)], deduct: true }
  );
  const t = calc.conditionTotals(est, 'c1');
  close(t.sf, 800 - 100, 1e-9);
  close(t.lf, 120 - 40, 1e-9);
  assert.equal(t.count, 2);
  assert.equal(calc.conditionTotals(est, 'c2').ea, 6);
  assert.equal(calc.conditionTotals(est, 'c2', 'other-sheet').ea, null);
});

test('a stated quantity overrides the traced one, and over 10% is flagged', () => {
  const s = sheet(QUARTER_INCH);
  const pts = plan.roomPoints('Office 101');
  const within = calc.measurementQty({ points: pts, statedQty: 300 }, s, { measure: 'area' });
  assert.equal(within.sf, 300);
  close(within.traced, 280, 1e-9);
  assert.equal(within.flagged, false);
  const over = calc.measurementQty({ points: pts, statedQty: 320 }, s, { measure: 'area' });
  assert.equal(over.sf, 320);
  assert.equal(over.flagged, true);
  // For a wall the stated length drives the square feet
  const wall = calc.measurementQty({ points: plan.WALL_40.map(p => plan.norm(...p)), statedQty: 41 }, s, { measure: 'wall', heightFt: 9 });
  assert.equal(wall.lf, 41);
  assert.equal(wall.sf, 369);
  assert.equal(wall.flagged, false);
  // A stated quantity on a deduct is negative too
  assert.equal(calc.measurementQty({ points: pts, statedQty: 280, deduct: true }, s, { measure: 'area' }).sf, -280);
});

test('an unscaled sheet gives no lengths or areas, never zero', () => {
  const q = calc.measurementQty({ points: plan.roomPoints('Office 101') }, sheet(null), { measure: 'area' });
  assert.equal(q.sf, null);
  assert.equal(q.lf, null);
});

test('lengths typed by people', () => {
  assert.equal(calc.parseFeet('20\'-0"'), 20);
  assert.equal(calc.parseFeet('12\'-6"'), 12.5);
  assert.equal(calc.parseFeet('12\' 6"'), 12.5);
  assert.equal(calc.parseFeet('12\'6'), 12.5);
  assert.equal(calc.parseFeet('12.5'), 12.5);
  assert.equal(calc.parseFeet('14 ft'), 14);
  assert.equal(calc.parseFeet('18"'), 1.5);
  assert.equal(calc.parseFeet('3\'-4 1/2"'), 3 + 4.5 / 12);
  close(calc.parseFeet('3.048 m'), 10, 1e-9);
  close(calc.parseFeet('914.4 mm'), 3, 1e-9);
  assert.equal(calc.parseFeet('abc'), null);
  assert.equal(calc.parseFeet(''), null);
  assert.equal(calc.fmtFeetInches(12.5), '12\'-6"');
});

test('new estimate has every section of the format and opens', () => {
  const est = model.newEstimate('2026-10-22');
  assert.equal(est.format, 'steadfast-estimate');
  assert.equal(est.version, 1);
  for (const k of ['job', 'settings', 'priceBook', 'assemblies', 'sheets', 'conditions', 'measurements', 'rooms',
    'lines', 'alternates', 'bids', 'risks', 'rfis', 'exclusions', 'assumptions', 'clarifications', 'manualChecks']) {
    assert.ok(k in est, k);
  }
  assert.equal(est.settings.stages.reduce((a, s) => a + s.pct, 0), 100);
  assert.deepEqual(model.openProblems(est), []);
  assert.equal(model.openProblems({ format: 'steadfast-estimator-import', version: 1 }).length, 1);
  assert.equal(model.openProblems({ format: 'steadfast-estimate', version: 2 }).length, 1);
});

test('estimate file name', () => {
  const est = model.newEstimate('2026-10-22');
  est.job.name = 'Unit 200 office refresh';
  assert.equal(model.estimateFileName(est, '2026-10-22'), '2026-10-22 — Estimate — Unit 200 office refresh.json');
  est.job.name = 'A/B: test?';
  assert.equal(model.estimateFileName(est, '2026-10-22'), '2026-10-22 — Estimate — A B test.json');
});

test('ids continue from the highest one', () => {
  assert.equal(model.nextId([], 'c'), 'c1');
  assert.equal(model.nextId([{ id: 'c1' }, { id: 'c7' }, { id: 'x9' }], 'c'), 'c8');
});

test('normalize fills missing sections without changing what is there', () => {
  const est = model.normalize({ format: 'steadfast-estimate', version: 1, job: { name: 'X' }, sheets: [{ id: 's1' }] });
  assert.equal(est.job.name, 'X');
  assert.equal(est.sheets.length, 1);
  assert.deepEqual(est.conditions, []);
  assert.equal(est.settings.gstPct, 5);
});

test('the committed test plan matches its generator', () => {
  const file = require('path').join(__dirname, 'fixtures', 'test-plan.pdf');
  assert.ok(require('fs').readFileSync(file).equals(plan.makeTestPlan()), 'run: node tests/fixtures/make-test-plan.js');
});
