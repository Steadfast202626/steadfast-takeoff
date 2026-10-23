/*
 * Builds the steadfast-estimating skill: copies the helper, calc.js and the file format into the skill,
 * then zips it to dist/steadfast-estimating.zip with steadfast-estimating/ at the root.
 * Run after changing the helper, calc.js or the format: node tools/build-skill.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeZip } = require('./zip.js');

const root = path.join(__dirname, '..');
const skill = path.join(root, 'skills', 'steadfast-estimating');

// Files copied into the skill, as [source, destination inside the skill].
const COPIES = [
  ['tools/estimate.js', 'scripts/estimate.js'],
  ['app/js/calc.js', 'scripts/calc.js'],
  ['docs/estimate-file-format.md', 'references/estimate-file-format.md']
];

function listFiles(dir, base) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

function build() {
  for (const [from, to] of COPIES) {
    const dest = path.join(skill, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, from), dest);
  }
  const files = listFiles(skill).map(rel => ({ name: 'steadfast-estimating/' + rel, data: fs.readFileSync(path.join(skill, rel)) }));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const zipPath = path.join(root, 'dist', 'steadfast-estimating.zip');
  fs.writeFileSync(zipPath, makeZip(files));
  return { zipPath, files: files.map(f => f.name) };
}

module.exports = { build, COPIES, skill, root };

if (require.main === module) {
  const { zipPath, files } = build();
  console.log('Wrote ' + path.relative(root, zipPath) + ' with ' + files.length + ' files:\n  ' + files.join('\n  '));
}
