'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../app/js/calc.js');
const guide = require('../app/js/guide.js');
const plan = require('./fixtures/make-test-plan.js');
const { planEstimate, fillCosts, assemblyId } = require('./fixtures/library.js');
const sample = require('../tools/make-sample.js');

test('next step walks a new job from drawings to the quote', () => {
  const est = calc.newEstimate('2026-10-23', require('./fixtures/library.js').starterLibrary());
  assert.deepEqual(guide.nextStep(est), { key: 'drawings', text: 'Add your drawings' });

  const p = planEstimate('residential');
  for (const s of p.sheets) { s.ftPerUnit = null; s.scaleLabel = ''; }
  est.sheets = p.sheets;
  assert.equal(guide.nextStep(est).text, 'Set the scale on sheet A-101');
  assert.equal(guide.nextStep(est, { sheetId: 's2' }).text, 'Set the scale on sheet A-102');
  for (const s of est.sheets) s.ftPerUnit = 1 / 18;

  assert.equal(guide.nextStep(est).text, 'Add what you\'re measuring');
  est.conditions.push({ id: 'c1', name: 'LVP', measure: 'area', color: '#000', assemblyId: assemblyId(est, 'LVP flooring with underlay'), division: '09' });
  assert.equal(guide.nextStep(est).text, 'Measure on sheet A-101');
  est.measurements.push({ id: 'm1', conditionId: 'c1', sheetId: 's1', points: plan.roomPoints('Office 101'), deduct: false, status: 'ok' });

  assert.equal(guide.nextStep(est).text, '3 items have no cost');
  fillCosts(est, 2);
  assert.equal(guide.nextStep(est).text, 'Set the contingency');
  est.settings.contingencyPct = 5;
  assert.equal(guide.nextStep(est).text, 'Set the estimate class');
  est.job.class = 'B';
  assert.equal(guide.nextStep(est).text, 'Write what\'s not included');
  est.exclusions.push('Permits');
  assert.equal(guide.nextStep(est).text, 'List at least one risk');
  est.risks.push({ id: 'k1', risk: 'Hidden damage', likelyCost: 1000, inPrice: 0 });
  assert.deepEqual(guide.nextStep(est), { key: 'quote', text: 'Ready. Print the customer quote' });
});

test('next step: one item, estimator items, an unscaled sheet with markups first', () => {
  const est = fillCosts(planEstimate('residential'), 2);
  est.lines.push({ id: 'l1', description: 'Bin', qty: 1, unit: 'ea', unitCost: null, type: 'E' });
  assert.equal(guide.nextStep(est).text, '1 item has no cost');
  est.lines[0].status = 'check';
  est.lines.push({ id: 'l2', description: 'Clean', qty: 1, unit: 'ea', unitCost: 5, type: 'S', status: 'check' });
  assert.equal(guide.nextStep(est).text, '2 estimator items to check');
  est.conditions.push({ id: 'c1', name: 'Doors', measure: 'count', color: '#000' });
  est.measurements.push({ id: 'm1', conditionId: 'c1', sheetId: 's2', points: [[0.1, 0.1]], deduct: false });
  est.sheets[1].ftPerUnit = null;
  assert.equal(guide.nextStep(est, { sheetId: 's1' }).text, 'Set the scale on sheet A-102');
});

test('next step on the sample job: review the cash flow, then a trade without insurance', () => {
  const est = sample.buildEstimate();
  assert.equal(guide.nextStep(est).text, 'Review the cash flow');
  est.settings.cash.reviewed = true;
  assert.equal(guide.nextStep(est).key, 'quote');
  est.bids[0].selectedBidderId = 'bd2';
  assert.deepEqual(guide.nextStep(est), { key: 'wcb', bidId: 'b1', text: 'Tick WCB and insurance for Electrical' });
  est.job.type = 'commercial';
  est.settings.commercialFloor = null;
  est.bids[0].selectedBidderId = 'bd1';
  assert.equal(guide.nextStep(est).text, 'Set the commercial margin floor');
});

test('every release check has a plain name', () => {
  for (const c of calc.releaseChecks(calc.newEstimate('2026-10-23'))) assert.ok(guide.PLAIN_CHECKS[c.n], 'check ' + c.n);
});
