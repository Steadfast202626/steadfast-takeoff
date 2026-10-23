'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const calc = require('../app/js/calc.js');
const outputs = require('../app/js/outputs.js');
const sample = require('../tools/make-sample.js');

test('the app copy of the sample job is up to date', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'sample-plan.js'), 'utf8');
  assert.equal(file, sample.build(), 'run: node tools/make-sample.js');
});

test('the sample job is a valid estimate with every line priced', () => {
  const est = sample.buildEstimate();
  assert.deepEqual(calc.validate(est).errors, []);
  const m = calc.money(est);
  assert.equal(m.base.missing, 0);
  assert.ok(m.base.price > 0);
  assert.ok(m.base.margin * 100 >= m.floor);
  assert.ok(outputs.isSample(est));
  assert.ok(!outputs.isSample(calc.newEstimate('2026-10-23')));
});

test('printouts of the sample carry the red band', () => {
  const est = sample.buildEstimate();
  for (const html of [outputs.quoteHtml(est, {}), outputs.internalHtml(est, {}), outputs.scopeLetterHtml(est, 'b1', {})]) {
    assert.match(html, /<div class="sample">Sample job with made-up prices\. Not for quoting\.<\/div>/);
  }
  assert.doesNotMatch(outputs.quoteHtml(calc.newEstimate('2026-10-23'), {}), /class="sample"/);
});
