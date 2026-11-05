'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../app/js/calc.js');
const T = require('../app/js/templates.js');
const W = require('../app/js/wizard-rules.js');
const plan = require('./fixtures/make-test-plan.js');
const { starterLibrary, planEstimate, fillCosts } = require('./fixtures/library.js');

const step = key => W.STEPS.find(s => s.key === key);

test('every room template matches build-ups in the starter library', () => {
  const est = calc.newEstimate(undefined, starterLibrary());
  assert.deepEqual(T.TEMPLATES.map(t => t.name), ['Commercial washroom', 'Staff kitchen', 'Basement', 'Bathroom', 'Kitchen']);
  for (const t of T.TEMPLATES) {
    for (const name of Object.values(t.finishes).filter(Boolean)) assert.ok(T.findAssembly(est, name), t.name + ': ' + name);
    for (const it of t.items) assert.ok(T.findAssembly(est, it.assembly), t.name + ': ' + it.assembly);
  }
});

test('a template adds the room with its finishes and the lines that go in it', () => {
  const est = fillCosts(calc.newEstimate(undefined, starterLibrary()), 2);
  const tpl = T.TEMPLATES.find(t => t.id === 'commercial-washroom');
  const out = T.addRoom(est, tpl, { name: 'Washroom 102', lengthFt: 10, widthFt: 8, quantities: { 0: 4 } });
  assert.deepEqual(out.skipped, []);
  const room = est.rooms.find(r => r.id === out.roomId);
  assert.equal(room.name, 'Washroom 102');
  assert.equal(room.heightFt, 9);
  assert.equal(est.assemblies.find(a => a.id === room.floorAssemblyId).name, 'Floor tile');
  assert.equal(est.assemblies.find(a => a.id === room.ceilingAssemblyId).name, 'T-bar ceiling 2x4');
  assert.equal(room.baseAssemblyId, null);
  const lines = est.lines.filter(l => out.lines.includes(l.id));
  assert.equal(lines.length, 3);
  const fixtures = lines.find(l => l.scope === 'Plumbing fixture');
  assert.equal(fixtures.qty, 4, 'the count typed in the dialog wins');
  assert.equal(fixtures.location, 'Washroom 102');
  // The cost comes from the build-up and the price book, the same as calc.js prices it.
  const a = T.findAssembly(est, 'Plumbing fixture');
  assert.equal(fixtures.unitCost, calc.round2(calc.assemblyUnitCost(est, a).ea));
  assert.ok(lines.every(l => l.status === 'ok' && /^Room template: Commercial washroom/.test(l.basis)));
  // The room prices through calc.js like any other room: floor area 80 sf of tile.
  assert.equal(calc.roomQty(est, room).area, 80);
  const v = calc.validate(est);
  assert.deepEqual(v.errors, [], 'still a valid estimate file');
});

test('template lines with no cost are priced once the price book has costs, and a typed cost is never replaced', () => {
  const est = calc.newEstimate(undefined, starterLibrary());
  const out = T.addRoom(est, T.TEMPLATES.find(t => t.id === 'kitchen'), { name: 'Kitchen' });
  const lines = () => est.lines.filter(l => out.lines.includes(l.id));
  assert.ok(lines().every(l => l.unitCost === null), 'starter costs are blank, so the lines wait for a cost');
  lines()[0].unitCost = 999;
  fillCosts(est, 3);
  const priced = T.refreshLines(est);
  assert.equal(priced, lines().length - 1);
  assert.equal(lines()[0].unitCost, 999);
  assert.ok(lines().slice(1).every(l => typeof l.unitCost === 'number'));
});

test('wizard: each step names what is missing, and is done when it is supplied', () => {
  const est = calc.newEstimate(undefined, starterLibrary());
  const state = { scaleChecks: {} };
  assert.deepEqual(step('details').missing(est, state), ['Job name', 'Client', 'Site address', 'Estimate class (A, B, C or D)', 'Bid due date']);
  Object.assign(est.job, { name: 'Unit 200', client: 'Northgate', address: '123 Street', class: 'B', bidDue: '2026-11-20' });
  assert.deepEqual(step('details').missing(est, state), []);

  assert.equal(step('drawings').missing(est, state).length, 1);
  assert.deepEqual(step('drawings').missing(est, { noDrawings: true }), []);
  assert.deepEqual(step('scale').missing(est, { noDrawings: true }), []);

  assert.equal(step('rooms').missing(est, state).length, 1);
  T.addRoom(est, T.TEMPLATES[0], { name: 'Washroom' });
  assert.deepEqual(step('rooms').missing(est, state), []);
  assert.deepEqual(step('measure').missing(est, state), ['Washroom: length and width, or trace it on the drawing']);
  est.rooms[0].lengthFt = 10; est.rooms[0].widthFt = 8;
  assert.deepEqual(step('measure').missing(est, state), []);

  assert.ok(step('prices').missing(est, state).some(t => /no cost/.test(t)));
  fillCosts(est, 2);
  T.refreshLines(est);
  assert.deepEqual(step('prices').missing(est, state), []);

  const profit = step('profit').missing(est, state);
  assert.ok(profit.includes('Contingency %, set for this job'), 'contingency has no company default, so it is asked for');
  assert.ok(profit.includes('Commercial margin floor %, set by the owners for this job') === false, 'residential job');
  est.job.type = 'commercial';
  assert.ok(step('profit').missing(est, state).includes('Commercial margin floor %, set by the owners for this job'));
});

test('wizard: the scale step needs a second dimension that agrees within 2%', () => {
  const est = planEstimate('commercial');
  const sheet = est.sheets[0];
  const state = { scaleChecks: {} };
  sheet.ftPerUnit = null;
  assert.deepEqual(step('scale').missing(est, state).filter(t => t.startsWith(sheet.name)), [sheet.name + ': set the scale']);
  sheet.ftPerUnit = calc.presetFtPerUnit('architectural', 0.25);
  assert.deepEqual(step('scale').missing(est, state).filter(t => t.startsWith(sheet.name)), [sheet.name + ': check the scale against a second dimension']);

  // The south wall of the open office is 40 ft on the test plan.
  const [p, q] = plan.WALL_40.map(pt => plan.norm(...pt));
  const good = W.scaleCheck(sheet, p, q, 40);
  assert.ok(good.ok, JSON.stringify(good));
  state.scaleChecks[sheet.id] = good;
  assert.deepEqual(step('scale').missing(est, state).filter(t => t.startsWith(sheet.name)), []);

  const bad = W.scaleCheck(sheet, p, q, 44);
  assert.equal(bad.ok, false);
  state.scaleChecks[sheet.id] = bad;
  assert.match(step('scale').missing(est, state).find(t => t.startsWith(sheet.name)), /off by 9%/);

  // Changing the scale after a check means checking again.
  state.scaleChecks[sheet.id] = good;
  sheet.ftPerUnit = calc.presetFtPerUnit('architectural', 0.125);
  assert.match(step('scale').missing(est, state).find(t => t.startsWith(sheet.name)), /second dimension/);
});

test('wizard rules change no number', () => {
  const est = fillCosts(planEstimate('residential'), 2);
  const before = JSON.stringify(calc.money(est).base);
  for (const s of W.STEPS) s.missing(est, { scaleChecks: {} });
  assert.equal(JSON.stringify(calc.money(est).base), before);
});
