/*
 * Generates the test floor plan: a 24 x 18 inch PDF at 1/4" = 1'-0", two sheets (A-101, A-102),
 * with known rooms, a 40 ft wall and 7 doors. Run directly to write tests/fixtures/test-plan.pdf.
 */
'use strict';

const PAGE_W = 24 * 72;          // 1728 pt
const PAGE_H = 18 * 72;          // 1296 pt
const PT_PER_FT = 18;            // 1/4" = 1'-0" means 1 ft = 0.25 in = 18 pt
const ORIGIN = [144, 144];       // top-left of the plan, in points from the top-left of the page

// Rooms in feet from the plan origin: [name, x, y, width, height]
const ROOMS = [
  ['Office 101', 0, 0, 20, 14],
  ['Office 102', 20, 0, 16, 14],
  ['Kitchen 103', 36, 0, 24, 14],
  ['Corridor', 0, 14, 60, 6],
  ['Washroom 104', 0, 20, 10, 10],
  ['Washroom 105', 10, 20, 10, 10],
  ['Storage 107', 0, 30, 20, 10],
  ['Open office 106', 20, 20, 40, 20]
];

// The south wall of the open office: 40 ft long.
const WALL_40 = [[20, 40], [60, 40]];

// Door positions in feet (centre of the opening).
const DOORS = [[10, 14], [28, 14], [48, 14], [5, 20], [15, 20], [40, 20], [20, 35]];

// A dimension string over Office 101: 20'-0" from x = 0 to x = 20, 3 ft above the plan.
const DIMENSION = { from: [0, -3], to: [20, -3], text: '20\'-0"', ft: 20 };

// Feet on the plan to the 0 to 1 coordinates used in the estimate file.
function norm(ftX, ftY) {
  return [(ORIGIN[0] + ftX * PT_PER_FT) / PAGE_W, (ORIGIN[1] + ftY * PT_PER_FT) / PAGE_H];
}

function roomPoints(name) {
  const r = ROOMS.find(x => x[0] === name);
  const [, x, y, w, h] = r;
  return [norm(x, y), norm(x + w, y), norm(x + w, y + h), norm(x, y + h)];
}

function pdfText(s) {
  return '(' + String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
}

function pageContent(sheetNo, title, lines) {
  const ops = [];
  const X = ft => ORIGIN[0] + ft * PT_PER_FT;
  const Y = ft => PAGE_H - (ORIGIN[1] + ft * PT_PER_FT); // PDF y runs up from the bottom
  const text = (x, y, size, s) => ops.push(`BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfText(s)} Tj ET`);

  // Walls
  ops.push('0 G 2 w');
  for (const [, x, y, w, h] of ROOMS) ops.push(`${X(x)} ${Y(y + h)} ${w * PT_PER_FT} ${h * PT_PER_FT} re S`);
  ops.push('4 w', `${X(WALL_40[0][0])} ${Y(WALL_40[0][1])} m ${X(WALL_40[1][0])} ${Y(WALL_40[1][1])} l S`);

  // Doors: a 3 ft leaf and a quarter-circle swing
  ops.push('0.8 w');
  const k = 0.5523;
  for (const [dx, dy] of DOORS) {
    const r = 3 * PT_PER_FT;
    const x0 = X(dx - 1.5), y0 = Y(dy);
    ops.push(`${x0} ${y0} m ${x0} ${y0 - r} l S`);
    ops.push(`${x0 + r} ${y0} m ${x0 + r} ${y0 - r * k} ${x0 + r * k} ${y0 - r} ${x0} ${y0 - r} c S`);
  }

  // Dimension string
  const dy = Y(DIMENSION.from[1]);
  ops.push('0.6 w', `${X(DIMENSION.from[0])} ${dy} m ${X(DIMENSION.to[0])} ${dy} l S`);
  for (const ft of [DIMENSION.from[0], DIMENSION.to[0]]) ops.push(`${X(ft)} ${dy - 6} m ${X(ft)} ${dy + 6} l S`);
  text(X(9), dy + 4, 10, DIMENSION.text);

  // Room names and sizes
  for (const [name, x, y, w, h] of ROOMS) {
    text(X(x + w / 2) - 30, Y(y + h / 2) + 4, 9, name.toUpperCase());
    text(X(x + w / 2) - 22, Y(y + h / 2) - 8, 8, `${w}'-0" x ${h}'-0"`);
  }

  // Title block, bottom right
  ops.push('1.5 w', `1296 36 396 216 re S`, `1296 108 m 1692 108 l S`);
  text(1310, 222, 12, lines[0]);
  text(1310, 200, 10, lines[1]);
  text(1310, 170, 14, title);
  text(1310, 148, 10, 'SCALE: 1/4" = 1\'-0"');
  text(1310, 126, 9, 'NOT FOR CONSTRUCTION');
  text(1310, 80, 9, 'SHEET');
  text(1310, 50, 28, sheetNo);
  return ops.join('\n');
}

// opts.lines: the two lines at the top of the title block.
function makeTestPlan(opts) {
  const lines = (opts && opts.lines) || ['STEADFAST CONSTRUCTIONS LTD', 'TEST PLAN FOR THE TAKEOFF APP'];
  const pages = [['A-101', 'FLOOR PLAN'], ['A-102', 'FINISH PLAN']];
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const kids = [];
  pages.forEach(([no, title], i) => {
    const pageObj = 4 + i * 2, contentObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    const content = pageContent(no, title, lines);
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { PAGE_W, PAGE_H, PT_PER_FT, ORIGIN, ROOMS, WALL_40, DOORS, DIMENSION, norm, roomPoints, makeTestPlan };

if (require.main === module) {
  const path = require('path');
  const file = path.join(__dirname, 'test-plan.pdf');
  require('fs').writeFileSync(file, makeTestPlan());
  console.log('Wrote ' + file);
}
