/*
 * Steadfast takeoff: all quantity and money maths.
 * Shared by the app (browser global SteadfastCalc) and the helper (Node require).
 * Rules: docs/estimate-file-format.md, section 2. Never compute a number anywhere else.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SteadfastCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAT_VERSION = 1;

  // ---------- Scales ----------

  // Preset scales assume the PDF is at full print size (1 PDF point = 1/72 inch).
  const SCALE_PRESETS = {
    architectural: [
      ['1/16" = 1\'-0"', 1 / 16], ['3/32" = 1\'-0"', 3 / 32], ['1/8" = 1\'-0"', 1 / 8],
      ['3/16" = 1\'-0"', 3 / 16], ['1/4" = 1\'-0"', 1 / 4], ['3/8" = 1\'-0"', 3 / 8],
      ['1/2" = 1\'-0"', 1 / 2], ['3/4" = 1\'-0"', 3 / 4], ['1" = 1\'-0"', 1],
      ['1-1/2" = 1\'-0"', 1.5], ['3" = 1\'-0"', 3]
    ],
    engineering: [
      ['1" = 10\'', 10], ['1" = 20\'', 20], ['1" = 30\'', 30], ['1" = 40\'', 40],
      ['1" = 50\'', 50], ['1" = 60\'', 60], ['1" = 100\'', 100]
    ],
    metric: [
      ['1:20', 20], ['1:25', 25], ['1:50', 50], ['1:75', 75], ['1:100', 100],
      ['1:200', 200], ['1:500', 500]
    ]
  };

  function presetFtPerUnit(kind, value) {
    if (kind === 'architectural') return 1 / (72 * value);
    if (kind === 'engineering') return value / 72;
    if (kind === 'metric') return value * 25.4 / 72 / 304.8;
    throw new Error('Unknown scale kind: ' + kind);
  }

  function presetList() {
    const out = [];
    for (const kind of Object.keys(SCALE_PRESETS)) {
      for (const [label, value] of SCALE_PRESETS[kind]) {
        out.push({ kind, label, value, ftPerUnit: presetFtPerUnit(kind, value) });
      }
    }
    return out;
  }

  // Scale from two points (0 to 1) and the real distance between them in feet.
  function calibrateFtPerUnit(p, q, sheet, knownFt) {
    const units = Math.hypot((q[0] - p[0]) * sheet.widthPt, (q[1] - p[1]) * sheet.heightPt);
    if (!(units > 0) || !(knownFt > 0)) return null;
    return knownFt / units;
  }

  // ---------- Geometry ----------

  function toFeet(pt, sheet) {
    return [pt[0] * sheet.widthPt * sheet.ftPerUnit, pt[1] * sheet.heightPt * sheet.ftPerUnit];
  }

  function hasScale(sheet) {
    return !!sheet && typeof sheet.ftPerUnit === 'number' && sheet.ftPerUnit > 0;
  }

  function pathLengthFt(points, sheet, closed) {
    if (!hasScale(sheet)) return null;
    const pts = points.map(p => toFeet(p, sheet));
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (closed && pts.length > 2) {
      const a = pts[pts.length - 1], b = pts[0];
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return total;
  }

  function polygonAreaSf(points, sheet) {
    if (!hasScale(sheet)) return null;
    if (points.length < 3) return 0;
    const pts = points.map(p => toFeet(p, sheet));
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(sum) / 2;
  }

  // ---------- Measurements ----------

  const MAIN_UNIT = { area: 'sf', length: 'lf', wall: 'lf', count: 'ea' };
  const STATED_FLAG_RATIO = 0.10;

  // Height used for square feet: the condition's height only. A wall with no height has no sf.
  function conditionHeight(condition) {
    const h = condition && condition.heightFt;
    return typeof h === 'number' && h > 0 ? h : null;
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /*
   * Quantities for one measurement: { lf, sf, ea, main, mainUnit, traced, stated, flagged }.
   * lf and sf are null when the sheet has no scale. statedQty replaces the main quantity;
   * for length and wall the stated lf also drives sf (sf = lf x height).
   */
  function measurementQty(m, sheet, condition) {
    const measure = condition ? condition.measure : 'length';
    const pts = m.points || [];
    const h = conditionHeight(condition);
    let lf = null, sf = null, ea = null;

    if (measure === 'area') {
      sf = polygonAreaSf(pts, sheet);
      lf = pathLengthFt(pts, sheet, true);
    } else if (measure === 'count') {
      ea = pts.length;
    } else {
      lf = pathLengthFt(pts, sheet, false);
      sf = lf !== null && h !== null ? lf * h : null;
    }

    const mainUnit = MAIN_UNIT[measure] || 'lf';
    const traced = mainUnit === 'sf' ? sf : mainUnit === 'lf' ? lf : ea;
    const stated = isNum(m.statedQty) ? m.statedQty : null;
    let flagged = false;

    if (stated !== null) {
      if (traced !== null) {
        flagged = traced === 0 ? stated !== 0 : Math.abs(stated - traced) / Math.abs(traced) > STATED_FLAG_RATIO;
      }
      if (mainUnit === 'sf') sf = stated;
      else if (mainUnit === 'ea') ea = stated;
      else {
        lf = stated;
        sf = h !== null ? stated * h : null;
      }
    }

    if (m.deduct) {
      if (lf !== null) lf = -lf;
      if (sf !== null) sf = -sf;
      if (ea !== null) ea = -ea;
    }

    const main = mainUnit === 'sf' ? sf : mainUnit === 'lf' ? lf : ea;
    return { measure, lf, sf, ea, main, mainUnit, traced, stated, flagged };
  }

  /*
   * Totals for a condition, across all sheets or one sheet.
   * Returns { lf, sf, ea, count, unscaled, flagged, check }. A quantity is null when nothing
   * contributes to it. unscaled counts measurements on sheets with no scale (left out of lf and sf).
   */
  function conditionTotals(est, conditionId, sheetId) {
    const condition = est.conditions.find(c => c.id === conditionId);
    const sheets = new Map(est.sheets.map(s => [s.id, s]));
    const out = { lf: null, sf: null, ea: null, count: 0, unscaled: 0, flagged: 0, check: 0 };
    const add = (k, v) => { if (v !== null) out[k] = (out[k] || 0) + v; };
    for (const m of est.measurements) {
      if (m.conditionId !== conditionId) continue;
      if (sheetId && m.sheetId !== sheetId) continue;
      const sheet = sheets.get(m.sheetId);
      const q = measurementQty(m, sheet, condition);
      out.count++;
      if (condition && condition.measure !== 'count' && !hasScale(sheet) && q.stated === null) out.unscaled++;
      if (q.flagged) out.flagged++;
      if (m.status === 'check') out.check++;
      add('lf', q.lf); add('sf', q.sf); add('ea', q.ea);
    }
    return out;
  }

  // Main quantity of a condition total, with its unit.
  function mainQty(condition, totals) {
    const unit = MAIN_UNIT[condition.measure] || 'lf';
    return { qty: totals[unit], unit };
  }

  // ---------- Lengths typed by people ----------

  /*
   * Parse a length into feet. Accepts 12'-6", 12' 6", 12'6, 12.5, 12.5', 150", 6 in, 4.2 m, 900 mm.
   * Returns null when it cannot read it.
   */
  function parseFeet(text) {
    if (text === null || text === undefined) return null;
    let s = String(text).trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”“]/g, '"').replace(/''/g, '"');
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*mm$/))) return +m[1] / 304.8;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*m$/))) return +m[1] / 0.3048;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/))) return +m[1] / 12;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)?$/))) return +m[1];
    // Feet and inches, with an optional fraction of an inch: 12'-6", 12' 6 1/2", 12'6
    m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*-?\s*(\d+(?:\.\d+)?)?(?:\s+(\d+)\/(\d+))?\s*(?:"|in)?$/);
    if (m) {
      let inches = m[2] ? +m[2] : 0;
      if (m[3] && m[4] && +m[4] > 0) inches += +m[3] / +m[4];
      return +m[1] + inches / 12;
    }
    return null;
  }

  // ---------- Display ----------

  function round(v, dp) {
    const f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }

  // Quantities: whole numbers above 100, one decimal below.
  function fmtQty(v, unit) {
    if (v === null || v === undefined) return '—';
    const dp = Math.abs(v) >= 100 ? 0 : 1;
    const n = round(v, dp).toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return unit ? n + ' ' + unit : n;
  }

  function fmtFeetInches(ft) {
    if (!isNum(ft)) return '—';
    const sign = ft < 0 ? '-' : '';
    let totalIn = Math.round(Math.abs(ft) * 12 * 4) / 4;
    let feet = Math.floor(totalIn / 12);
    let inches = totalIn - feet * 12;
    const whole = Math.floor(inches);
    const frac = inches - whole;
    const fracText = frac === 0.25 ? ' 1/4' : frac === 0.5 ? ' 1/2' : frac === 0.75 ? ' 3/4' : '';
    return sign + feet + "'-" + whole + fracText + '"';
  }

  function fmtMoney(v) {
    if (v === null || v === undefined) return '—';
    return v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
  }

  return {
    FORMAT_VERSION, SCALE_PRESETS, MAIN_UNIT, STATED_FLAG_RATIO,
    presetFtPerUnit, presetList, calibrateFtPerUnit, hasScale,
    pathLengthFt, polygonAreaSf, measurementQty, conditionTotals, mainQty, conditionHeight,
    parseFeet, fmtQty, fmtFeetInches, fmtMoney, round
  };
});
