#!/usr/bin/env node
/*
 * Steadfast estimator helper. The Claude estimator uses it on the same estimate files the app opens.
 * Node 20 or later, no packages. All maths comes from calc.js, shared with the app.
 *
 *   node tools/estimate.js summary  <file> [--json]         totals, margin, checklist status
 *   node tools/estimate.js checks   <file>                  release checklist, one line per check
 *   node tools/estimate.js import   <file> <import.json>    apply an estimator import file (same rules as the app)
 *   node tools/estimate.js lines    <file> [--csv]          estimate lines
 *   node tools/estimate.js sheets   <file>                  sheets, scales, markup counts
 *   node tools/estimate.js validate <file|import.json>      check a file against the format
 *
 * Commands that change the file write a backup first (<file>.bak). The helper never marks anything "ok".
 */
'use strict';

const fs = require('fs');
const path = require('path');

function loadCalc() {
  for (const p of ['./calc.js', '../app/js/calc.js']) {
    const full = path.join(__dirname, p);
    if (fs.existsSync(full)) return require(full);
  }
  throw new Error('calc.js not found next to the helper or in app/js/.');
}

const calc = loadCalc();

const ME = 'node ' + (path.relative(process.cwd(), __filename) || 'estimate.js');
const USAGE = `Steadfast estimator helper

  ${ME} summary  <file> [--json]       totals, margin, checklist status
  ${ME} checks   <file>                release checklist, one line per check
  ${ME} import   <file> <import.json>  apply an estimator import file
  ${ME} lines    <file> [--csv]        estimate lines
  ${ME} sheets   <file>                sheets, scales, markup counts
  ${ME} validate <file|import.json>    check a file against the format`;

class UsageError extends Error {}

function readJson(file) {
  if (!file) throw new UsageError('Give the file path.');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error('Cannot read ' + file + ': ' + e.message);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(file + ' is not readable JSON: ' + e.message);
  }
}

function readEstimate(file) {
  const obj = readJson(file);
  const problems = calc.openProblems(obj);
  if (problems.length) throw new Error(problems[0]);
  return calc.normalize(obj);
}

const money = v => calc.fmtMoney(v);
const STATUS = { pass: 'Done ', fail: 'OPEN ', warn: 'Check', na: 'n/a  ' };

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padLeft(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

// ---------- Commands ----------

function summary(file, flags) {
  const est = readEstimate(file);
  const m = calc.money(est);
  const checks = calc.releaseChecks(est, m);
  const b = m.base;
  if (flags.json) {
    const pick = p => ({ direct: p.direct, travel: p.travel, contingency: p.contingency, cost: p.cost, calculated: p.calculated,
      price: p.price, margin: p.margin, markup: p.markup, gst: p.gst, total: p.total, missing: p.missing, lines: p.lines });
    return JSON.stringify({
      job: est.job.name, base: pick(b), alternates: m.alternates.map(a => Object.assign({ name: a.alternate.name, sign: a.sign }, pick(a))),
      floor: m.floor, openChecks: calc.openCheckCount(checks), waiting: calc.checkItems(est).length
    }, null, 2);
  }
  const s = est.settings;
  const out = [];
  out.push(est.job.name + ' (' + est.job.type + ', class ' + (est.job.class || 'not set') + ')');
  out.push('');
  out.push('Base bid, ' + b.lines + ' lines' + (b.missing ? ', ' + b.missing + ' with no cost (not counted)' : ''));
  const row = (l, v) => out.push('  ' + pad(l, 30) + padLeft(v, 14));
  row('Direct cost', money(b.direct));
  row('Travel ' + (s.travelPct || 0) + '%', money(b.travel));
  row('Contingency ' + (typeof s.contingencyPct === 'number' ? s.contingencyPct + '%' : 'NOT SET'), money(b.contingency));
  row('Cost', money(b.cost));
  row('Price at ' + s.marginTarget + '% target', money(b.calculated));
  if (b.overridden) row('Price override', money(b.price));
  row('Price', money(b.price));
  row('Margin', calc.fmtPct(b.margin));
  row('Markup', calc.fmtPct(b.markup));
  row('Floor', m.floor === null ? 'NOT SET' : m.floor + '%');
  row('GST ' + s.gstPct + '%', money(b.gst));
  row('Total with GST', money(b.total));
  if (m.floor !== null && b.margin !== null && b.margin * 100 + 1e-9 < m.floor) out.push('  Below the floor. Goes to the owners.');
  for (const a of m.alternates) {
    out.push('');
    out.push(a.alternate.name + ' (' + (a.sign < 0 ? 'deduct' : 'add') + '), ' + a.lines + ' lines' + (a.missing ? ', ' + a.missing + ' with no cost' : ''));
    row('Cost', money(a.cost));
    row('Price', money(a.price));
    row('Margin / markup', calc.fmtPct(a.margin) + ' / ' + calc.fmtPct(a.markup));
    row('GST', money(a.gst));
  }
  const open = checks.filter(c => c.status === 'fail');
  const warns = checks.filter(c => c.status === 'warn');
  out.push('');
  out.push('Release checklist: ' + (open.length ? open.length + ' open' : 'all required checks pass') + (warns.length ? ', ' + warns.length + ' to look at' : ''));
  for (const c of open) out.push('  OPEN  ' + c.label + (c.detail ? ': ' + c.detail : ''));
  const waiting = calc.checkItems(est).length;
  if (waiting) out.push(waiting + ' estimator items wait for Kamal\'s check.');
  return out.join('\n');
}

function checks(file) {
  const est = readEstimate(file);
  const list = calc.releaseChecks(est);
  const lines = list.map(c => STATUS[c.status] + ' ' + padLeft(c.n, 2) + '. ' + c.label + (c.detail ? ' (' + c.detail + ')' : ''));
  const open = calc.openCheckCount(list);
  lines.push('');
  lines.push(open ? open + ' open. Not ready to release.' : 'All required checks pass. Release needs an owner\'s approval of the price.');
  return { text: lines.join('\n'), code: open ? 1 : 0 };
}

function doImport(file, importFile) {
  if (!importFile) throw new UsageError('Give the estimate file and the import file.');
  const est = readEstimate(file);
  const imp = readJson(importFile);
  const v = calc.validate(imp);
  if (v.kind !== 'import') throw new Error(calc.openImportProblems(imp)[0] || 'Not an estimator import file.');
  if (v.errors.length) throw new Error('The import file has problems. Nothing was changed.\n  ' + v.errors.join('\n  '));
  const { est: out, report } = calc.applyImport(est, imp);
  const lines = [];
  if (report.added.length) {
    fs.copyFileSync(file, file + '.bak');
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    lines.push('Imported into ' + path.basename(file) + ' (backup: ' + path.basename(file) + '.bak).');
  } else {
    lines.push('Nothing new to add. ' + path.basename(file) + ' was not changed.');
  }
  const list = (title, items) => { if (items.length) { lines.push(title + ' (' + items.length + '):'); for (const t of items) lines.push('  ' + t); } };
  list('Added', report.added);
  list('Skipped', report.skipped);
  list('Notes for Kamal', report.notes.concat(v.warnings));
  if (report.priceChanges.length) {
    lines.push('Price changes for Kamal to accept one by one in the app (' + report.priceChanges.length + '):');
    for (const p of report.priceChanges) lines.push('  ' + p.code + ' ' + p.item + ': ' + (p.from === null || p.from === undefined ? 'no cost' : money(p.from)) + ' to ' + money(p.to) + '/' + p.unit + (p.source ? ' (' + p.source + ')' : ''));
  }
  lines.push(report.waiting + ' items wait for Kamal\'s check.');
  return lines.join('\n');
}

function lines(file, flags) {
  const est = readEstimate(file);
  const m = calc.money(est);
  const altName = id => (est.alternates.find(a => a.id === id) || {}).name || 'Base bid';
  if (flags.csv) {
    const rows = [['Bid', 'Division', 'Item', 'Code', 'From', 'Location', 'Quantity', 'Unit', 'Unit cost', 'Total', 'Type', 'Allowance', 'Status']];
    for (const l of m.lines) {
      rows.push([altName(l.alternateId), l.division, l.description, l.code || '', l.scope, l.room || l.location,
        l.qty === null ? '' : calc.round(l.qty, 3), l.unit, l.unitCost === null ? '' : l.unitCost, l.total === null ? '' : calc.round(l.total, 2),
        l.type || '', l.allowance ? 'yes' : '', l.status]);
    }
    return calc.toCsv(rows).trimEnd();
  }
  if (!m.lines.length) return 'No lines yet.';
  const out = [];
  for (const bid of [null].concat(est.alternates.map(a => a.id))) {
    const ls = m.lines.filter(l => (l.alternateId || null) === bid);
    if (!ls.length) continue;
    out.push(altName(bid));
    for (const l of ls) {
      out.push('  ' + pad(l.division || '--', 3) + pad(l.description + (l.allowance ? ' (allowance)' : ''), 42) +
        padLeft(calc.fmtQty(l.qty), 10) + ' ' + pad(l.unit || '', 4) +
        padLeft(l.unitCost === null ? 'NO COST' : money(l.unitCost), 12) + padLeft(l.total === null ? '' : money(l.total), 14) +
        (l.status === 'check' ? '  check' : '') + (l.scope ? '  [' + l.scope + ']' : ''));
    }
  }
  return out.join('\n');
}

function sheets(file) {
  const est = readEstimate(file);
  if (!est.sheets.length) return 'No sheets.';
  return est.sheets.map((s, i) => {
    const marks = est.measurements.filter(m => m.sheetId === s.id);
    const waiting = marks.filter(m => m.status === 'check').length;
    return padLeft(i + 1, 2) + '. ' + pad(s.name, 12) + pad(calc.hasScale(s) ? s.scaleLabel || 'scaled' : 'NO SCALE', 34) +
      pad(marks.length + (marks.length === 1 ? ' markup' : ' markups') + (waiting ? ' (' + waiting + ' to check)' : ''), 26) +
      s.file + (s.kind === 'pdf' ? ' p' + s.page : '');
  }).join('\n');
}

function validateCmd(file) {
  const obj = readJson(file);
  const v = calc.validate(obj);
  const out = [];
  out.push(v.kind ? path.basename(file) + ': ' + (v.kind === 'import' ? 'estimator import file' : 'estimate file') : path.basename(file) + ': not a Steadfast file');
  for (const e of v.errors) out.push('  Error: ' + e);
  for (const w of v.warnings) out.push('  Warning: ' + w);
  out.push(v.errors.length ? v.errors.length + ' errors.' : 'No errors' + (v.warnings.length ? ', ' + v.warnings.length + ' warnings.' : '.'));
  return { text: out.join('\n'), code: v.errors.length ? 1 : 0 };
}

// ---------- Main ----------

function main(argv) {
  const args = argv.filter(a => !a.startsWith('--'));
  const flags = { csv: argv.includes('--csv'), json: argv.includes('--json') };
  const [cmd, a, b] = args;
  const result = (() => {
    switch (cmd) {
      case 'summary': return summary(a, flags);
      case 'checks': return checks(a);
      case 'import': return doImport(a, b);
      case 'lines': return lines(a, flags);
      case 'sheets': return sheets(a);
      case 'validate': return validateCmd(a);
      default: throw new UsageError(cmd ? 'Unknown command: ' + cmd : '');
    }
  })();
  return typeof result === 'string' ? { text: result, code: 0 } : result;
}

if (require.main === module) {
  try {
    const { text, code } = main(process.argv.slice(2));
    process.stdout.write(text + '\n');
    process.exitCode = code;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write((e.message ? e.message + '\n\n' : '') + USAGE + '\n');
      process.exitCode = 2;
    } else {
      process.stderr.write(e.message + '\n');
      process.exitCode = 1;
    }
  }
}

module.exports = { main };
