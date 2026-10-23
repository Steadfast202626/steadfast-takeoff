/*
 * Test helpers: the starter library, and an estimate on the test plan with made-up costs.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const calc = require('../../app/js/calc.js');
const plan = require('./make-test-plan.js');

const root = path.join(__dirname, '..', '..');

function starterLibrary() {
  const pb = calc.priceBookFromRows(calc.parseCsv(fs.readFileSync(path.join(root, 'data', 'price-book-starter.csv'), 'utf8')));
  const assemblies = calc.assembliesFromRows(calc.parseCsv(fs.readFileSync(path.join(root, 'data', 'assemblies-starter.csv'), 'utf8')));
  return { priceBook: pb.items, assemblies };
}

const assemblyId = (est, name) => est.assemblies.find(a => a.name === name).id;

// The test plan with a scale, two sheets, and nothing measured yet.
function planEstimate(type) {
  const est = calc.newEstimate('2026-10-22', starterLibrary());
  est.job.name = 'Test plan';
  est.job.type = type || 'commercial';
  for (const [i, name] of ['A-101', 'A-102'].entries()) {
    est.sheets.push({
      id: 's' + (i + 1), name, file: 'test-plan.pdf', page: i + 1, kind: 'pdf', widthPt: plan.PAGE_W, heightPt: plan.PAGE_H,
      ftPerUnit: calc.presetFtPerUnit('architectural', 0.25), scaleLabel: '1/4" = 1\'-0"', scaleSource: 'preset'
    });
  }
  return est;
}

// Give every price book item a made-up cost so totals can be checked.
function fillCosts(est, cost) {
  for (const p of est.priceBook) p.unitCost = cost === undefined ? 1 : cost;
  return est;
}

module.exports = { starterLibrary, planEstimate, fillCosts, assemblyId };
