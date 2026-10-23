'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { COPIES, skill, root } = require('../tools/build-skill.js');
const xlsx = require('../app/js/xlsx.js');

test('the skill carries the current helper, calc.js and file format', () => {
  for (const [from, to] of COPIES) {
    assert.ok(fs.readFileSync(path.join(root, from)).equals(fs.readFileSync(path.join(skill, to))), to + ' is out of date. Run: node tools/build-skill.js');
  }
});

test('the skill zip has steadfast-estimating/ at its root and matches the folder', async () => {
  const files = await xlsx.unzip(fs.readFileSync(path.join(root, 'dist', 'steadfast-estimating.zip')));
  const names = Object.keys(files);
  assert.ok(names.length >= 7);
  for (const n of names) {
    assert.ok(n.startsWith('steadfast-estimating/'), n);
    const onDisk = fs.readFileSync(path.join(skill, n.slice('steadfast-estimating/'.length)));
    assert.ok(Buffer.from(files[n]).equals(onDisk), n + ' in the zip is out of date. Run: node tools/build-skill.js');
  }
  assert.ok(names.includes('steadfast-estimating/SKILL.md'));
  assert.ok(names.includes('steadfast-estimating/scripts/estimate.js'));
});

test('SKILL.md lists every helper command', () => {
  const md = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
  for (const cmd of ['summary', 'checks', 'import', 'lines', 'sheets', 'validate']) assert.match(md, new RegExp('estimate\\.js ' + cmd + '\\b'));
});
