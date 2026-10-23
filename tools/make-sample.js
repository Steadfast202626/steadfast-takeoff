/*
 * Builds the sample job: a generated floor plan (PDF) and an estimate with made-up prices, written into
 * app/js/sample-plan.js so the app can open it from the File menu with no server.
 * Run after changing the sample, calc.js or the starter data: node tools/make-sample.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const calc = require('../app/js/calc.js');
const outputs = require('../app/js/outputs.js');
const plan = require('../tests/fixtures/make-test-plan.js');

const root = path.join(__dirname, '..');
const DATE = '2026-10-23';

// Made-up costs. Not Steadfast's prices.
const MADE_UP = {
  '01-SUP': 68, '01-BIN': 650, '01-PRO': 0.45, '01-CLN': 0.35, '01-PMT': 1200,
  '02-DFL': 1.1, '02-DWL': 14, '02-DCB': 18, '02-DCL': 1.6,
  '06-STD': 6.5, '06-PLT': 1.1, '06-FRL': 62, '06-BLK': 1.4, '06-BSM': 2.2, '06-CAS': 1.9, '06-TRL': 62,
  '07-BAT': 0.95, '07-POL': 0.18, '07-SND': 1.15,
  '08-DPH': 380, '08-HDW': 95, '08-DIL': 62, '08-DCM': 1850,
  '09-GYP': 0.62, '09-GYX': 0.78, '09-GFM': 0.22, '09-GSB': 1.95, '09-LVP': 3.4, '09-UND': 0.55, '09-FIL': 1.6,
  '09-CPT': 4.6, '09-TIL': 4.9, '09-TSB': 7.5, '09-VCT': 4.2, '09-RBB': 1.35, '09-RBL': 1.25,
  '09-PNT': 1.15, '09-PNC': 1.05, '09-TBR': 5.8,
  '12-CBL': 310, '12-CBU': 240, '12-CTP': 95, '12-CIL': 45,
  '22-FIX': 1450, '23-RUN': 480, '26-DEV': 140, '26-POT': 165, '26-PNL': 2800
};

function starter() {
  return {
    priceBook: calc.priceBookFromRows(calc.parseCsv(fs.readFileSync(path.join(root, 'data', 'price-book-starter.csv'), 'utf8'))).items,
    assemblies: calc.assembliesFromRows(calc.parseCsv(fs.readFileSync(path.join(root, 'data', 'assemblies-starter.csv'), 'utf8')))
  };
}

function buildEstimate() {
  const est = calc.newEstimate(DATE, starter());
  const asm = name => {
    const a = est.assemblies.find(x => x.name === name);
    if (!a) throw new Error('No assembly ' + name);
    return a.id;
  };
  for (const p of est.priceBook) {
    p.unitCost = MADE_UP[p.code] === undefined ? null : MADE_UP[p.code];
    p.source = 'Made-up sample price';
    p.updated = DATE;
  }
  Object.assign(est.job, {
    name: 'Sample office refresh', client: 'Sample Client Ltd', contact: 'Pat Sample', address: '123 Sample Street NW, Edmonton',
    type: 'commercial', class: 'B', bidDue: '2026-11-06', preparedBy: 'Kamal', quoteNo: 'SAMPLE-1', validDays: 30,
    notes: 'Practice job. Made-up drawing and prices.'
  });
  Object.assign(est.settings, { contingencyPct: 5, commercialFloor: 20, gstNumber: '' });
  Object.assign(est.settings.cash, { startBalance: 25000, months: 3, startDate: '2027-01-01', curve: 's-curve' });

  ['A-101', 'A-102'].forEach((name, i) => est.sheets.push({
    id: 's' + (i + 1), name, file: outputs.SAMPLE_FILE, page: i + 1, kind: 'pdf', widthPt: plan.PAGE_W, heightPt: plan.PAGE_H,
    ftPerUnit: calc.presetFtPerUnit('architectural', 0.25), scaleLabel: '1/4" = 1\'-0"', scaleSource: 'preset'
  }));

  est.alternates.push({ id: 'alt1', name: 'Alternate 1', description: 'Kitchen refresh: new cabinets and countertop', sign: 'add' });

  const cond = (id, name, measure, extra) => est.conditions.push(Object.assign({
    id, name, measure, color: calc.COLOURS[est.conditions.length], heightFt: null, assemblyId: null, unitCost: null, type: 'S',
    division: '', location: 'Level 1', alternateId: null, hidden: false
  }, extra));
  cond('c1', 'LVP flooring, open office', 'area', { assemblyId: asm('LVP flooring with underlay'), division: '09' });
  cond('c2', 'Carpet, private offices', 'area', { assemblyId: asm('Carpet'), division: '09' });
  cond('c3', 'Floor tile, washrooms', 'area', { assemblyId: asm('Floor tile'), division: '09' });
  cond('c4', 'Rubber base, open office', 'length', { assemblyId: asm('Rubber base 4"'), division: '09' });
  cond('c5', 'Partition wall with sound batt', 'wall', { assemblyId: asm('Partition wall with sound batt'), division: '06', heightFt: 9 });
  cond('c6', 'Doors, frames and hardware', 'count', { assemblyId: asm('Commercial door, frame and hardware'), division: '08' });
  cond('c7', 'Kitchen cabinets and countertop', 'length', { assemblyId: asm('Kitchen cabinets, base and upper, with countertop'), division: '12', alternateId: 'alt1' });

  const meas = (conditionId, points, note) => est.measurements.push({
    id: calc.nextId(est.measurements, 'm'), conditionId, sheetId: 's1', points: points.map(p => [calc.round(p[0], 6), calc.round(p[1], 6)]),
    deduct: false, statedQty: null, note, source: 'owner', status: 'ok', basis: '', confidence: null
  });
  meas('c1', plan.roomPoints('Open office 106'), 'Open office 106');
  meas('c2', plan.roomPoints('Office 101'), 'Office 101');
  meas('c2', plan.roomPoints('Office 102'), 'Office 102');
  meas('c3', plan.roomPoints('Washroom 104'), 'Washroom 104');
  meas('c3', plan.roomPoints('Washroom 105'), 'Washroom 105');
  meas('c4', [[20, 20], [60, 20], [60, 40], [20, 40], [20, 20]].map(p => plan.norm(...p)), 'Open office 106');
  meas('c5', [[20, 0], [20, 14]].map(p => plan.norm(...p)), 'Between offices 101 and 102');
  meas('c6', plan.DOORS.map(p => plan.norm(...p)), 'All doors');
  meas('c7', [[38, 1], [58, 1]].map(p => plan.norm(...p)), 'Kitchen 103, north wall');

  const room = (id, name, extra) => est.rooms.push(Object.assign({
    id, name, location: 'Level 1', lengthFt: null, widthFt: null, heightFt: 9, areaSf: null, perimeterLf: null, doors: 1, windows: 0,
    floorAssemblyId: null, wallAssemblyId: null, ceilingAssemblyId: null, baseAssemblyId: null,
    alternateId: null, measurementId: null, source: 'owner', status: 'ok', basis: ''
  }, extra));
  room('r1', 'Kitchen 103', { lengthFt: 24, widthFt: 14, windows: 1, floorAssemblyId: asm('VCT or sheet vinyl'), wallAssemblyId: asm('Paint walls, 2 coats'), baseAssemblyId: asm('Rubber base 4"') });
  room('r2', 'Corridor', { lengthFt: 60, widthFt: 6, doors: 6, floorAssemblyId: asm('VCT or sheet vinyl'), wallAssemblyId: asm('Paint walls, 2 coats'), ceilingAssemblyId: asm('T-bar ceiling 2x4') });
  room('r3', 'Open office 106', { measurementId: 'm1', wallAssemblyId: asm('Paint walls, 2 coats'), ceilingAssemblyId: asm('T-bar ceiling 2x4') });

  const line = (description, division, qty, unit, unitCost, type, extra) => est.lines.push(Object.assign({
    id: calc.nextId(est.lines, 'l'), division, description, scope: '', location: '', qty, unit, unitCost, type,
    allowance: false, alternateId: null, source: 'owner', status: 'ok', basis: ''
  }, extra));
  line('Disposal bin (20 yd)', '01', 3, 'ea', 650, 'E', { basis: 'Two at demolition, one at finish' });
  line('Final clean', '01', 2400, 'sf', 0.35, 'S');
  line('Floor and site protection', '01', 1800, 'sf', 0.45, 'M');
  line('Site supervision', '01', 60, 'hr', 68, 'L');
  line('Building permit', '01', 1, 'lot', 1500, 'S', { allowance: true, description: 'Building permit allowance' });
  line('Appliances allowance', '11', 1, 'lot', 4500, 'M', { allowance: true, alternateId: 'alt1' });

  est.bids.push({
    id: 'b1', trade: 'Electrical', division: '26', alternateId: null,
    scopeItems: [
      { text: 'Pot lights, open office: 24 ea', plug: 0 }, { text: 'Receptacles and switches: 30 ea', plug: 0 },
      { text: 'Electrical permit and inspections', plug: 450 }, { text: 'Panel schedule update', plug: 600 }
    ],
    bidders: [
      { id: 'bd1', name: 'Sample Electric A', amount: 14200, includes: ['y', 'y', 'n', 'y'], wcbClearance: true, insurance: true, notes: 'Permit excluded' },
      { id: 'bd2', name: 'Sample Electric B', amount: 13650, includes: ['y', 'y', '', 'n'], wcbClearance: true, insurance: false, notes: 'Insurance certificate to follow' },
      { id: 'bd3', name: 'Sample Electric C', amount: 15400, includes: ['y', 'y', 'y', 'y'], wcbClearance: true, insurance: true, notes: '' }
    ],
    selectedBidderId: 'bd1', source: 'owner', status: 'ok'
  });

  est.exclusions.push('Asbestos testing and abatement', 'Furniture moving', 'Work outside normal business hours');
  est.assumptions.push('The space is vacant during the work', 'Existing ceiling grid stays in the corridor');
  est.clarifications.push('Alternates are priced separately and are not in the base price');
  est.risks.push(
    { id: 'k1', risk: 'Asbestos in old flooring adhesive (building before 1990)', likelyCost: 4000, inPrice: 0 },
    { id: 'k2', risk: 'Floor levelling under LVP', likelyCost: 2500, inPrice: 1000 }
  );
  est.rfis.push({ id: 'q1', question: 'Is the corridor VCT staying or being replaced?', reference: 'A-101', status: 'open', answer: '' });
  return est;
}

function build() {
  const pdf = plan.makeTestPlan({ lines: ['SAMPLE JOB. MADE-UP DRAWING.', 'NOT FOR QUOTING OR CONSTRUCTION'] });
  const data = { fileName: outputs.SAMPLE_FILE, pdfBase64: pdf.toString('base64'), estimate: buildEstimate() };
  return '/* Generated by tools/make-sample.js. Do not edit by hand. Made-up drawing and prices. */\n' +
    'window.SteadfastSample = ' + JSON.stringify(data) + ';\n';
}

module.exports = { build, buildEstimate };

if (require.main === module) {
  const out = path.join(root, 'app', 'js', 'sample-plan.js');
  fs.writeFileSync(out, build());
  console.log('Wrote ' + path.relative(root, out));
}
