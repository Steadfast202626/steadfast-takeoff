'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../app/js/calc.js');
const plan = require('./fixtures/make-test-plan.js');
const { planEstimate } = require('./fixtures/library.js');

function baseImport(extra) {
  return Object.assign({ format: 'steadfast-estimator-import', version: 1, job: 'Test plan', date: '2026-10-22' }, extra);
}

test('import adds items marked check, by name, and never changes the original', () => {
  const est = planEstimate();
  const before = JSON.stringify(est);
  const imp = baseImport({
    conditions: [{ name: 'LVP flooring, offices', measure: 'area', assembly: 'lvp flooring with underlay', division: '09', location: 'Level 1' }],
    measurements: [{ condition: 'LVP flooring, offices', sheet: 'a-101', points: plan.roomPoints('Office 101'), statedQty: 280, note: 'Office 101', basis: '20 x 14 on A-101', confidence: 'high' }],
    rooms: [{ name: 'Office 102', location: 'Level 1', lengthFt: 16, widthFt: 14, heightFt: 9, doors: 1, windows: 0, floor: 'Carpet', walls: 'Paint walls, 2 coats', basis: 'A-101' }],
    lines: [{ division: '01', description: 'Disposal bin (20 yd)', qty: 3, unit: 'ea', unitCost: null, type: 'E', basis: 'Two at demolition, one at finish' }],
    rfis: [{ question: 'Is the corridor VCT staying?', reference: 'A-101 note 4' }],
    risks: [{ risk: 'Asbestos in flooring adhesive', likelyCost: 4000, inPrice: 0 }],
    exclusions: ['Asbestos testing and abatement'],
    priceChanges: [{ code: '09-LVP', unitCost: 3.4, source: 'Supplier quote, 2026-10-20' }]
  });
  const { est: out, report } = calc.applyImport(est, imp);
  assert.equal(JSON.stringify(est), before);
  assert.equal(out.conditions.length, 1);
  assert.ok(out.conditions[0].assemblyId, 'assembly matched without regard to case');
  const m = out.measurements[0];
  assert.equal(m.sheetId, 's1');
  assert.equal(m.source, 'estimator');
  assert.equal(m.status, 'check');
  assert.equal(out.rooms[0].status, 'check');
  assert.equal(out.lines[0].status, 'check');
  assert.equal(out.rfis[0].status, 'open');
  assert.equal(report.waiting, 3);
  assert.equal(report.priceChanges.length, 1);
  assert.equal(out.priceBook.find(p => p.code === '09-LVP').unitCost, null, 'price changes are never applied');
  assert.ok(report.added.length >= 6);
});

test('import never overwrites: existing names are skipped and reported', () => {
  const est = planEstimate();
  est.conditions.push({ id: 'c1', name: 'Doors', measure: 'count', color: '#000', assemblyId: null, unitCost: 500, type: 'S', division: '08' });
  est.rooms.push({ id: 'r1', name: 'Office 102', lengthFt: 10, widthFt: 10, source: 'owner', status: 'ok' });
  est.exclusions.push('Permits');
  const imp = baseImport({
    conditions: [{ name: 'doors', measure: 'count', assembly: 'Commercial door, frame and hardware' }],
    rooms: [{ name: 'OFFICE 102', lengthFt: 16, widthFt: 14 }],
    measurements: [{ condition: 'Doors', sheet: 1, points: plan.DOORS.map(p => plan.norm(...p)), basis: 'Door schedule', confidence: 'high' }],
    exclusions: ['permits']
  });
  const { est: out, report } = calc.applyImport(est, imp);
  assert.equal(out.conditions[0].unitCost, 500);
  assert.equal(out.conditions[0].assemblyId, null);
  assert.equal(out.rooms[0].lengthFt, 10);
  assert.equal(out.exclusions.length, 1);
  assert.equal(out.measurements.length, 1, 'adds to the existing condition, sheet by page number');
  assert.equal(report.skipped.length, 3);
});

test('import: unknown assembly leaves no assembly and is reported; bad points are skipped', () => {
  const { est, report } = calc.applyImport(planEstimate(), baseImport({
    conditions: [{ name: 'Mystery floor', measure: 'area', assembly: 'Terrazzo' }],
    measurements: [
      { condition: 'Mystery floor', sheet: 'A-101', points: [[0.1, 0.1], [1.2, 0.1], [0.1, 0.4]] },
      { condition: 'Nope', sheet: 'A-101', points: [[0.1, 0.1]] },
      { condition: 'Mystery floor', sheet: 'Z-9', points: [[0.1, 0.1]] }
    ]
  }));
  assert.equal(est.conditions[0].assemblyId, null);
  assert.ok(report.notes.some(n => n.includes('Terrazzo')));
  assert.equal(est.measurements.length, 0);
  assert.equal(report.skipped.length, 3);
});

test('import: a sheet scale is only applied when the sheet has none', () => {
  const est = planEstimate();
  est.sheets[1].ftPerUnit = null;
  est.sheets[1].scaleLabel = '';
  const { est: out, report } = calc.applyImport(est, baseImport({
    sheets: [{ sheet: 'A-101', scaleLabel: '1/8" = 1\'-0"' }, { sheet: 'A-102', scaleLabel: '1/4" = 1\'-0"', basis: 'Title block' }]
  }));
  assert.equal(out.sheets[0].ftPerUnit, 1 / 18, 'set sheet not changed');
  assert.ok(report.notes.some(n => n.includes('A-101')));
  assert.equal(out.sheets[1].ftPerUnit, 1 / 18);
  assert.equal(out.sheets[1].scaleSource, 'estimator');
});

test('import: alternates named by items are created', () => {
  const { est } = calc.applyImport(planEstimate(), baseImport({
    alternates: [{ name: 'Alternate 1', description: 'New cabinets', sign: 'add' }],
    lines: [{ description: 'Cabinets', qty: 1, unit: 'lot', alternate: 'alternate 1' }, { description: 'Carpet credit', qty: 1, unit: 'lot', alternate: 'Alternate 2' }]
  }));
  assert.equal(est.alternates.length, 2);
  assert.equal(est.lines[0].alternateId, est.alternates[0].id);
  assert.equal(est.lines[1].alternateId, est.alternates[1].id);
});

test('import: importing the same file twice adds nothing new the second time', () => {
  const imp = baseImport({ lines: [{ description: 'Final clean', qty: 1200, unit: 'sf', division: '01' }], rfis: [{ question: 'Hours?' }] });
  const once = calc.applyImport(planEstimate(), imp).est;
  const twice = calc.applyImport(once, imp);
  assert.equal(twice.est.lines.length, 1);
  assert.equal(twice.est.rfis.length, 1);
  assert.equal(twice.report.added.length, 0);
});

test('import refuses the wrong file type', () => {
  const { report } = calc.applyImport(planEstimate(), planEstimate());
  assert.ok(report.skipped[0].includes('estimate file'));
});

test('accepting estimator items clears the check', () => {
  const { est } = calc.applyImport(planEstimate(), baseImport({ lines: [{ description: 'Bin', qty: 1, unit: 'ea' }] }));
  assert.equal(calc.releaseChecks(est).find(c => c.n === 2).status, 'fail');
  assert.equal(calc.acceptItems(est), 1);
  assert.equal(calc.releaseChecks(est).find(c => c.n === 2).status, 'pass');
});

test('validate: a good estimate and a good import pass', () => {
  const est = planEstimate();
  assert.deepEqual(calc.validate(est).errors, []);
  assert.equal(calc.validate(est).kind, 'estimate');
  const imp = baseImport({ measurements: [{ condition: 'X', sheet: 'A-101', points: [[0.1, 0.2]], basis: 'b' }] });
  const v = calc.validate(imp);
  assert.equal(v.kind, 'import');
  assert.deepEqual(v.errors, []);
  assert.equal(v.warnings.length, 1);
});

test('validate: catches broken references and bad values', () => {
  const est = planEstimate();
  est.measurements.push({ id: 'm1', conditionId: 'c9', sheetId: 's1', points: [[2, 0]], status: 'maybe' });
  est.settings.contingencyPct = 'ten';
  const v = calc.validate(est);
  assert.ok(v.errors.some(e => e.includes('c9')));
  assert.ok(v.errors.some(e => e.includes('points')));
  assert.ok(v.errors.some(e => e.includes('status')));
  assert.ok(v.errors.some(e => e.includes('contingencyPct')));
});

test('validate: an import may not accept its own work or set the price', () => {
  const v = calc.validate(baseImport({ lines: [{ description: 'x', status: 'ok' }], priceOverride: 1 }));
  assert.equal(v.errors.length, 2);
  assert.equal(calc.validate({ format: 'other' }).kind, null);
});
