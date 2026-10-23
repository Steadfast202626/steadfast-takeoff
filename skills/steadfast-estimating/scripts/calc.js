/*
 * Steadfast takeoff: all quantity and money maths.
 * Shared by the app (browser global SteadfastCalc) and the helper (Node require).
 * Also holds the estimate file shape, the release checklist and the estimator import rules,
 * so the app and the helper never differ. Rules: docs/estimate-file-format.md.
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

  function fmtMoney(v, dp) {
    if (v === null || v === undefined) return '—';
    if (dp === undefined) dp = 2;
    const n = Math.abs(v).toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (v < 0 ? '-$' : '$') + n;
  }

  function fmtPct(ratio, dp) {
    if (ratio === null || ratio === undefined) return '—';
    return (ratio * 100).toFixed(dp === undefined ? 1 : dp) + '%';
  }

  // ---------- The estimate file ----------

  const FORMAT = 'steadfast-estimate';
  const IMPORT_FORMAT = 'steadfast-estimator-import';
  const VERSION = FORMAT_VERSION;

  const DIVISIONS = [
    ['01', 'General requirements'], ['02', 'Existing conditions'], ['03', 'Concrete'],
    ['04', 'Masonry'], ['05', 'Metals'], ['06', 'Wood, plastics and composites'],
    ['07', 'Thermal and moisture protection'], ['08', 'Openings'], ['09', 'Finishes'],
    ['10', 'Specialties'], ['11', 'Equipment'], ['12', 'Furnishings'],
    ['13', 'Special construction'], ['14', 'Conveying equipment'], ['21', 'Fire suppression'],
    ['22', 'Plumbing'], ['23', 'Heating, ventilating and air conditioning'], ['26', 'Electrical'],
    ['27', 'Communications'], ['28', 'Electronic safety and security'], ['31', 'Earthwork'],
    ['32', 'Exterior improvements'], ['33', 'Utilities']
  ];

  const COLOURS = ['#1971c2', '#e8590c', '#2f9e44', '#c2255c', '#6741d9', '#0c8599',
    '#e67700', '#5c940d', '#a61e4d', '#364fc7', '#862e9c', '#d9480f'];

  const MEASURES = ['area', 'length', 'wall', 'count'];
  const TYPES = ['M', 'L', 'S', 'E'];
  const TYPE_NAMES = { M: 'Material', L: 'Labour', S: 'Subcontract', E: 'Equipment' };

  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // A new estimate. library = { priceBook, assemblies } copied into the job when given.
  function newEstimate(date, library) {
    return {
      format: FORMAT,
      version: VERSION,
      job: {
        name: 'New job', client: '', contact: '', address: '',
        type: 'residential', class: '',
        bidDue: '', date: date || today(),
        preparedBy: '', quoteNo: '', validDays: 30, notes: ''
      },
      settings: {
        marginFloor: 30, marginTarget: 35, commercialFloor: null,
        contingencyPct: null, travelPct: 0, gstPct: 5, gstNumber: '',
        roundTo: 10, priceOverride: null,
        defaultHeightFt: 8, doorWidthFt: 3, doorAreaSf: 21, windowAreaSf: 12,
        stages: [
          { label: 'Signed contract', pct: 25 },
          { label: 'Materials ordered and confirmed by supplier', pct: 35 },
          { label: 'Installation starts on site', pct: 30 },
          { label: 'Completion and signed deficiency list', pct: 10 }
        ],
        cash: {
          startBalance: 0, months: 3, startDate: '', curve: 'even',
          ownerPayDays: 28, subPayDays: 7, holdbackPct: 10,
          lienDays: 60, releaseDays: 10, reviewed: false
        }
      },
      priceBook: library && library.priceBook ? clone(library.priceBook) : [],
      assemblies: library && library.assemblies ? clone(library.assemblies) : [],
      sheets: [],
      conditions: [],
      measurements: [],
      rooms: [],
      lines: [],
      alternates: [],
      bids: [],
      risks: [],
      rfis: [],
      exclusions: [], assumptions: [], clarifications: [],
      manualChecks: { cashReviewed: false }
    };
  }

  // Fill in anything a file leaves out, without touching what it has.
  function normalize(est) {
    const base = newEstimate(est && est.job && est.job.date);
    const out = Object.assign({}, base, est);
    out.job = Object.assign({}, base.job, est.job);
    out.settings = Object.assign({}, base.settings, est.settings);
    out.settings.cash = Object.assign({}, base.settings.cash, est.settings && est.settings.cash);
    out.manualChecks = Object.assign({}, base.manualChecks, est.manualChecks);
    for (const k of ['priceBook', 'assemblies', 'sheets', 'conditions', 'measurements', 'rooms', 'lines',
      'alternates', 'bids', 'risks', 'rfis', 'exclusions', 'assumptions', 'clarifications']) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    return out;
  }

  // Problems that stop a file being opened as an estimate. Empty means it can be opened.
  function openProblems(obj) {
    if (!obj || typeof obj !== 'object') return ['Not an estimate file.'];
    if (obj.format === IMPORT_FORMAT) return ['This is an estimator import file, not an estimate file.'];
    if (obj.format !== FORMAT) return ['Not a Steadfast estimate file.'];
    if (obj.version !== VERSION) return ['Estimate file version ' + obj.version + '. This app reads version ' + VERSION + '.'];
    return [];
  }

  // Next free id with a prefix: s1, s2 ... across a list.
  function nextId(list, prefix) {
    let max = 0;
    const re = new RegExp('^' + prefix + '(\\d+)$');
    for (const item of list) {
      const m = re.exec(item.id || '');
      if (m) max = Math.max(max, +m[1]);
    }
    return prefix + (max + 1);
  }

  function safeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // YYYY-MM-DD — Document type — Detail.ext
  function documentName(type, detail, ext, date) {
    return (date || today()) + ' — ' + type + ' — ' + (safeName(detail) || 'Job') + '.' + ext;
  }

  function estimateFileName(est, date) {
    return documentName('Estimate', est.job.name, 'json', date);
  }

  function divisionName(code) {
    const d = DIVISIONS.find(x => x[0] === code);
    return d ? d[1] : '';
  }

  function sameText(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  // ---------- Rooms ----------

  /*
   * Room quantities: { area, perimeter, height, wallSf, ceilingSf, baseLf }.
   * Area and perimeter come from the linked measurement, else the stated figures, else length x width.
   */
  function roomQty(est, room) {
    const s = est.settings;
    let area = null, perimeter = null;
    if (room.measurementId) {
      const m = est.measurements.find(x => x.id === room.measurementId);
      const c = m && est.conditions.find(x => x.id === m.conditionId);
      if (m && c && c.measure === 'area') {
        const q = measurementQty(m, est.sheets.find(x => x.id === m.sheetId), c);
        area = q.sf;
        perimeter = q.lf;
      }
    }
    const L = room.lengthFt, W = room.widthFt;
    if (area === null) area = isNum(room.areaSf) ? room.areaSf : isNum(L) && isNum(W) ? L * W : null;
    if (perimeter === null) perimeter = isNum(room.perimeterLf) ? room.perimeterLf : isNum(L) && isNum(W) ? 2 * (L + W) : null;
    const height = isNum(room.heightFt) && room.heightFt > 0 ? room.heightFt : s.defaultHeightFt;
    const doors = isNum(room.doors) ? room.doors : 0;
    const windows = isNum(room.windows) ? room.windows : 0;
    const wallSf = perimeter === null ? null : Math.max(0, perimeter * height - doors * s.doorAreaSf - windows * s.windowAreaSf);
    const baseLf = perimeter === null ? null : Math.max(0, perimeter - doors * s.doorWidthFt);
    return { area, perimeter, height, wallSf, ceilingSf: area, baseLf };
  }

  const ROOM_FINISHES = [
    ['floor', 'floorAssemblyId', 'Floor'], ['walls', 'wallAssemblyId', 'Walls'],
    ['ceiling', 'ceilingAssemblyId', 'Ceiling'], ['base', 'baseAssemblyId', 'Base']
  ];

  function roomBasis(q, finish) {
    if (finish === 'floor') return { sf: q.area, lf: q.perimeter, ea: 1 };
    if (finish === 'walls') return { sf: q.wallSf, lf: q.perimeter, ea: 1 };
    if (finish === 'ceiling') return { sf: q.ceilingSf, lf: q.perimeter, ea: 1 };
    return { lf: q.baseLf, sf: null, ea: 1 };
  }

  // ---------- Bids ----------

  // Levelled price = amount + the plug of every scope item the bidder did not mark "y".
  function levelledPrice(bid, bidder) {
    let total = isNum(bidder.amount) ? bidder.amount : 0;
    (bid.scopeItems || []).forEach((s, i) => {
      if ((bidder.includes || [])[i] !== 'y' && isNum(s.plug)) total += s.plug;
    });
    return total;
  }

  // ---------- Estimate lines ----------

  function lineTotal(qty, unitCost) {
    return isNum(qty) && isNum(unitCost) ? qty * unitCost : null;
  }

  function makeLine(o) {
    const total = lineTotal(o.qty, o.unitCost);
    return Object.assign({
      code: null, room: '', location: '', scope: '', allowance: false, alternateId: null,
      status: 'ok', editable: null
    }, o, { total, missing: total === null });
  }

  // Lines for one assembly applied to a basis { sf, lf, ea }.
  function assemblyLines(est, assembly, basis, ctx) {
    const out = [];
    assembly.items.forEach((item, i) => {
      const pb = est.priceBook.find(p => p.code === item.code);
      const b = basis[item.per];
      const qty = isNum(b) && isNum(item.qtyPerUnit) ? b * item.qtyPerUnit * (1 + (isNum(item.wastePct) ? item.wastePct : 0) / 100) : null;
      out.push(makeLine(Object.assign({}, ctx, {
        key: ctx.key + ':' + i,
        code: item.code,
        description: pb ? pb.item : item.code + ' (not in price book)',
        unit: pb ? pb.unit : item.per,
        unitCost: pb && isNum(pb.unitCost) ? pb.unitCost : null,
        type: pb ? pb.type : null,
        division: (pb && pb.division) || ctx.division || assembly.division || '',
        qty,
        editable: pb ? { kind: 'price', code: item.code } : null
      })));
    });
    return out;
  }

  /*
   * Every estimate line: conditions, rooms, manual lines and allowances, and chosen bids.
   * Each line: { key, source, refId, code, description, scope, room, location, division, qty, unit,
   *   unitCost, type, allowance, alternateId, status, total, missing, editable }.
   */
  function estimateLines(est) {
    const out = [];
    const assemblies = new Map(est.assemblies.map(a => [a.id, a]));

    for (const c of est.conditions) {
      const t = conditionTotals(est, c.id);
      if (!t.count) continue;
      const ctx = {
        source: 'condition', refId: c.id, key: 'c:' + c.id, scope: c.name, location: c.location || '',
        alternateId: c.alternateId || null, division: c.division || '', status: t.check ? 'check' : 'ok'
      };
      const a = c.assemblyId && assemblies.get(c.assemblyId);
      if (a) {
        out.push(...assemblyLines(est, a, { sf: t.sf, lf: t.lf, ea: t.ea }, ctx));
      } else {
        const { qty, unit } = mainQty(c, t);
        out.push(makeLine(Object.assign({}, ctx, {
          description: c.name, qty, unit, unitCost: isNum(c.unitCost) ? c.unitCost : null,
          type: c.type || null, editable: { kind: 'condition', id: c.id }
        })));
      }
    }

    for (const r of est.rooms) {
      const q = roomQty(est, r);
      for (const [finish, field, label] of ROOM_FINISHES) {
        const a = r[field] && assemblies.get(r[field]);
        if (!a) continue;
        out.push(...assemblyLines(est, a, roomBasis(q, finish), {
          source: 'room', refId: r.id, key: 'r:' + r.id + ':' + finish, scope: r.name + ', ' + label.toLowerCase(),
          room: r.name, location: r.location || '', alternateId: r.alternateId || null,
          division: a.division || '', status: r.status === 'check' ? 'check' : 'ok'
        }));
      }
    }

    for (const l of est.lines) {
      out.push(makeLine({
        source: 'line', refId: l.id, key: 'l:' + l.id, description: l.description || '', scope: l.scope || '',
        location: l.location || '', division: l.division || '', qty: isNum(l.qty) ? l.qty : null, unit: l.unit || '',
        unitCost: isNum(l.unitCost) ? l.unitCost : null, type: l.type || null, allowance: !!l.allowance,
        alternateId: l.alternateId || null, status: l.status === 'check' ? 'check' : 'ok',
        editable: { kind: 'line', id: l.id }
      }));
    }

    for (const b of est.bids) {
      const bidder = b.selectedBidderId && (b.bidders || []).find(x => x.id === b.selectedBidderId);
      if (!bidder) continue;
      out.push(makeLine({
        source: 'bid', refId: b.id, key: 'b:' + b.id, description: b.trade + (bidder.name ? ', ' + bidder.name : ''),
        scope: b.trade, division: b.division || '', qty: 1, unit: 'lot', unitCost: levelledPrice(b, bidder),
        type: 'S', alternateId: b.alternateId || null, status: b.status === 'check' ? 'check' : 'ok'
      }));
    }
    return out;
  }

  // Combine identical items: same item, unit, unit cost, type, division, bid and allowance.
  function combineLines(lines) {
    const map = new Map();
    const out = [];
    for (const l of lines) {
      const k = [l.code || l.description.toLowerCase(), l.unit, l.unitCost, l.type, l.division, l.alternateId, l.allowance].join('\u0001');
      const have = map.get(k);
      if (!have) {
        const c = Object.assign({}, l, { keys: [l.key], scopes: l.scope ? [l.scope] : [] });
        map.set(k, c);
        out.push(c);
        continue;
      }
      have.keys.push(l.key);
      if (l.scope && !have.scopes.includes(l.scope)) have.scopes.push(l.scope);
      have.qty = isNum(have.qty) && isNum(l.qty) ? have.qty + l.qty : null;
      have.total = lineTotal(have.qty, have.unitCost);
      have.missing = have.total === null;
      if (have.location !== l.location) have.location = '';
      if (have.room !== l.room) have.room = '';
      if (l.status === 'check') have.status = 'check';
      if (have.editable && have.editable.kind !== 'price') have.editable = null;
    }
    for (const c of out) c.scope = c.scopes.join('; ');
    return out;
  }

  // ---------- Money ----------

  function round2(v) { return Math.round(v * 100) / 100; }

  function roundUp(v, to) {
    if (!(to > 0)) return v;
    return Math.ceil(v / to - 1e-9) * to;
  }

  function pctOf(v, pct) { return isNum(pct) ? v * pct / 100 : 0; }

  /*
   * Price a set of lines (format section 2, Money, steps 1 to 7).
   * override: true lets settings.priceOverride replace the calculated price (base bid only).
   */
  function priceLines(lines, settings, override) {
    const byType = { M: 0, L: 0, S: 0, E: 0, other: 0 };
    let direct = 0, missing = 0, subcontract = 0;
    for (const l of lines) {
      if (l.total === null) { missing++; continue; }
      direct += l.total;
      if (byType[l.type] !== undefined) byType[l.type] += l.total;
      else byType.other += l.total;
      if (l.type === 'S') subcontract += l.total;
    }
    const travel = pctOf(direct, settings.travelPct);
    const contingency = pctOf(direct + travel, settings.contingencyPct);
    const cost = direct + travel + contingency;
    const target = isNum(settings.marginTarget) ? settings.marginTarget / 100 : 0;
    const calculated = target < 1 ? roundUp(cost / (1 - target), settings.roundTo) : null;
    const overridden = override && isNum(settings.priceOverride);
    const price = overridden ? settings.priceOverride : calculated;
    const margin = isNum(price) && price !== 0 ? (price - cost) / price : null;
    const markup = isNum(price) && cost !== 0 ? (price - cost) / cost : null;
    const gst = isNum(price) ? round2(pctOf(price, settings.gstPct)) : null;
    return {
      lines: lines.length, missing, byType, direct, subcontract, travel, contingency, cost,
      calculated, overridden, price, margin, markup, gst, total: isNum(price) ? price + gst : null
    };
  }

  function marginFloor(est) {
    const s = est.settings;
    const f = est.job.type === 'commercial' ? s.commercialFloor : s.marginFloor;
    return isNum(f) ? f : null;
  }

  /*
   * The whole estimate in money: { lines, base, alternates: [{ alternate, sign, ...priced }], floor }.
   * A deduct alternate shows as negative.
   */
  function money(est) {
    const lines = estimateLines(est);
    const base = priceLines(lines.filter(l => !l.alternateId), est.settings, true);
    const alternates = est.alternates.map(a => {
      const p = priceLines(lines.filter(l => l.alternateId === a.id), est.settings, false);
      const sign = a.sign === 'deduct' ? -1 : 1;
      for (const k of ['direct', 'travel', 'contingency', 'cost', 'calculated', 'price', 'gst', 'total']) {
        if (isNum(p[k])) p[k] = p[k] * sign;
      }
      return Object.assign({ alternate: a, sign }, p);
    });
    return { lines, base, alternates, floor: marginFloor(est) };
  }

  // Residential stage invoices. Rounded to the cent, with the last stage taking the remainder.
  function stageInvoices(est, price, gst) {
    const stages = est.settings.stages || [];
    let amountLeft = price, gstLeft = gst;
    return stages.map((s, i) => {
      const last = i === stages.length - 1;
      const amount = last ? round2(amountLeft) : round2(pctOf(price, s.pct));
      const g = last ? round2(gstLeft) : round2(pctOf(gst, s.pct));
      amountLeft -= amount;
      gstLeft -= g;
      return { label: s.label, pct: s.pct, amount, gst: g, total: round2(amount + g) };
    });
  }

  function stagesTotalPct(est) {
    return (est.settings.stages || []).reduce((a, s) => a + (isNum(s.pct) ? s.pct : 0), 0);
  }

  // Cost of one unit of an assembly, by the unit each item is measured per: { sf, lf, ea, missing }.
  function assemblyUnitCost(est, assembly) {
    const out = { sf: 0, lf: 0, ea: 0, missing: 0, used: { sf: false, lf: false, ea: false } };
    for (const item of assembly.items) {
      const pb = est.priceBook.find(p => p.code === item.code);
      out.used[item.per] = true;
      if (!pb || !isNum(pb.unitCost) || !isNum(item.qtyPerUnit)) { out.missing++; continue; }
      out[item.per] += pb.unitCost * item.qtyPerUnit * (1 + (isNum(item.wastePct) ? item.wastePct : 0) / 100);
    }
    return out;
  }

  // ---------- Release checklist (format section 3) ----------

  function checkItems(est) {
    const items = [];
    for (const k of ['measurements', 'rooms', 'lines', 'bids']) {
      for (const x of est[k]) if (x.status === 'check') items.push({ kind: k, item: x });
    }
    return items;
  }

  /*
   * Each check: { n, label, status: 'pass' | 'fail' | 'warn' | 'na', detail }.
   * The quote can be released when nothing is 'fail'.
   */
  function releaseChecks(est, m) {
    m = m || money(est);
    const out = [];
    const add = (n, label, status, detail) => out.push({ n, label, status, detail: detail || '' });
    const s = est.settings;

    const unscaled = est.sheets.filter(sh => !hasScale(sh) && est.measurements.some(x => x.sheetId === sh.id));
    add(1, 'Every sheet with markups has a scale', unscaled.length ? 'fail' : 'pass',
      unscaled.length ? 'No scale: ' + unscaled.map(x => x.name).join(', ') : '');

    const checks = checkItems(est);
    add(2, 'No items marked "check" are left', checks.length ? 'fail' : 'pass',
      checks.length ? checks.length + ' waiting for Kamal' : '');

    const missing = m.lines.filter(l => l.missing).length;
    add(3, 'Every line has a cost', missing ? 'fail' : m.lines.length ? 'pass' : 'fail',
      missing ? missing + ' lines with no cost' : m.lines.length ? '' : 'No lines yet');

    add(4, 'Contingency is set', isNum(s.contingencyPct) ? 'pass' : 'fail', isNum(s.contingencyPct) ? s.contingencyPct + '%' : 'Not set');

    const floor = m.floor;
    const margin = m.base.margin;
    if (floor === null) add(5, 'Margin is at or above the floor', 'fail', est.job.type === 'commercial' ? 'Commercial floor not set' : 'Floor not set');
    else if (margin === null) add(5, 'Margin is at or above the floor', 'fail', 'No price yet');
    else add(5, 'Margin is at or above the floor', margin * 100 + 1e-9 >= floor ? 'pass' : 'fail',
      (margin * 100).toFixed(1) + '% against a ' + floor + '% floor');

    add(6, 'Estimate class is A or B', ['A', 'B'].includes(est.job.class) ? 'pass' : 'fail',
      est.job.class ? 'Class ' + est.job.class : 'Class not set');

    add(7, 'Exclusions are written', est.exclusions.some(x => String(x).trim()) ? 'pass' : 'fail');

    add(8, 'At least one risk is listed', est.risks.some(r => String(r.risk || '').trim()) ? 'pass' : 'fail');

    const usedIds = new Set();
    for (const c of est.conditions) if (c.assemblyId && est.measurements.some(x => x.conditionId === c.id)) usedIds.add(c.assemblyId);
    for (const r of est.rooms) for (const [, f] of ROOM_FINISHES) if (r[f]) usedIds.add(r[f]);
    const unconfirmed = est.assemblies.filter(a => usedIds.has(a.id) && !a.confirmed);
    add(9, 'Assemblies in use are confirmed by Kamal', unconfirmed.length ? 'warn' : 'pass',
      unconfirmed.length ? unconfirmed.length + ' not confirmed' : '');

    const badBidders = [];
    for (const b of est.bids) {
      const bd = b.selectedBidderId && (b.bidders || []).find(x => x.id === b.selectedBidderId);
      if (bd && !(bd.wcbClearance && bd.insurance)) badBidders.push(b.trade);
    }
    add(10, 'Selected bidders have WCB clearance and insurance', badBidders.length ? 'fail' : 'pass',
      badBidders.length ? 'Missing for ' + badBidders.join(', ') : '');

    const open = est.rfis.filter(r => r.status !== 'answered' && String(r.question || '').trim());
    add(11, 'Open RFIs are listed', open.length ? 'warn' : 'pass', open.length ? open.length + ' open' : '');

    if (est.job.type === 'residential') {
      const pct = stagesTotalPct(est);
      add(12, 'Residential stages total 100%', Math.abs(pct - 100) < 1e-9 ? 'pass' : 'fail', pct + '%');
    } else add(12, 'Residential stages total 100%', 'na', 'Not residential');

    if (est.job.type === 'commercial') {
      const reviewed = !!(s.cash && s.cash.reviewed) || !!(est.manualChecks && est.manualChecks.cashReviewed);
      const ok = isNum(s.commercialFloor) && reviewed;
      const why = [];
      if (!isNum(s.commercialFloor)) why.push('commercial floor not set');
      if (!reviewed) why.push('cash flow not reviewed');
      add(13, 'Commercial floor set and cash flow reviewed', ok ? 'pass' : 'fail', why.join(', '));
    } else add(13, 'Commercial floor set and cash flow reviewed', 'na', 'Not commercial');
    return out;
  }

  function openCheckCount(checks) {
    return checks.filter(c => c.status === 'fail').length;
  }

  // Kamal accepts estimator items: status "check" becomes "ok". filter(kind, item) picks which.
  function acceptItems(est, filter) {
    let n = 0;
    for (const { kind, item } of checkItems(est)) {
      if (!filter || filter(kind, item)) { item.status = 'ok'; n++; }
    }
    return n;
  }

  // ---------- CSV ----------

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- Price book from a Monday.com board export (rows of cells) ----------

  const PRICE_COLUMNS = {
    code: ['code', 'item code', 'price code', 'cost code'],
    item: ['item', 'item name', 'description', 'name'],
    unit: ['unit', 'units', 'uom', 'unit of measure'],
    type: ['type', 'cost type'],
    unitCost: ['unit cost', 'unit cost cad', 'cost', 'unit price'],
    division: ['division', 'csi division', 'div'],
    source: ['source', 'supplier'],
    updated: ['date updated', 'updated', 'last updated', 'date']
  };

  function headerKey(cell) {
    return String(cell === null || cell === undefined ? '' : cell).toLowerCase()
      .replace(/[_()$]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseType(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return null;
    if (/^m(aterials?)?$/.test(s)) return 'M';
    if (/^l(abou?r)?$/.test(s)) return 'L';
    if (/^s(ub|ubs|ubcontract|ubcontractor|ubtrade)?$/.test(s)) return 'S';
    if (/^e(quipment)?$/.test(s)) return 'E';
    return null;
  }

  function parseMoney(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).replace(/[$,\s]/g, '').replace(/CAD$/i, '');
    if (!s) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  function parseDivision(v) {
    const m = String(v === null || v === undefined ? '' : v).trim().match(/^(\d{1,2})\b/);
    return m ? m[1].padStart(2, '0') : '';
  }

  // Excel stores dates as days since 1899-12-30.
  function parseDate(v) {
    if (v === null || v === undefined || v === '') return '';
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const n = Number(s);
    if (isFinite(n) && n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const d = new Date(s);
    return isNaN(d) ? s : d.toISOString().slice(0, 10);
  }

  /*
   * Map rows (first sheet of a Monday.com export, or a CSV) to price book items by column name.
   * Monday exports put the board name and group names above and between the header rows; those
   * are skipped. Returns { items, problems, columns }.
   */
  function priceBookFromRows(rows) {
    const problems = [];
    let header = -1, cols = null;
    for (let i = 0; i < rows.length && header < 0; i++) {
      const keys = rows[i].map(headerKey);
      const found = {};
      for (const [field, names] of Object.entries(PRICE_COLUMNS)) {
        for (const n of names) {
          const at = keys.indexOf(n);
          if (at >= 0) { found[field] = at; break; }
        }
      }
      if (found.code !== undefined && found.item !== undefined) { header = i; cols = found; }
    }
    if (header < 0) return { items: [], problems: ['No header row with "code" and "item" columns.'], columns: null };
    for (const f of ['unit', 'type', 'unitCost', 'division']) {
      if (cols[f] === undefined) problems.push('No "' + PRICE_COLUMNS[f][0] + '" column.');
    }
    const headerText = rows[header].map(headerKey).join('|');
    const byCode = new Map();
    for (let i = header + 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.map(headerKey).join('|') === headerText) continue;
      const get = f => (cols[f] === undefined ? '' : r[cols[f]]);
      const code = String(get('code') || '').trim();
      if (!code) continue;
      const type = parseType(get('type'));
      if (get('type') && !type) problems.push(code + ': type "' + get('type') + '" not recognised.');
      const raw = get('unitCost');
      const unitCost = parseMoney(raw);
      if (raw !== '' && raw !== null && raw !== undefined && unitCost === null) problems.push(code + ': unit cost "' + raw + '" not a number.');
      if (byCode.has(code)) problems.push(code + ' appears more than once. The last row is used.');
      byCode.set(code, {
        code, item: String(get('item') || '').trim(), unit: String(get('unit') || '').trim(), type,
        unitCost, division: parseDivision(get('division')) || parseDivision(code),
        source: String(get('source') || '').trim(), updated: parseDate(get('updated'))
      });
    }
    return { items: [...byCode.values()], problems, columns: cols };
  }

  // Assemblies from rows of the assemblies CSV.
  function assembliesFromRows(rows) {
    const keys = rows[0].map(headerKey);
    const at = n => keys.indexOf(n);
    const out = [];
    const byName = new Map();
    for (const r of rows.slice(1)) {
      const name = String(r[at('assembly')] || '').trim();
      if (!name) continue;
      let a = byName.get(name);
      if (!a) {
        a = {
          id: 'a' + (out.length + 1), name, measure: String(r[at('measure')] || 'area').trim(),
          division: parseDivision(r[at('division')]), confirmed: /^(yes|y|true|1)$/i.test(String(r[at('confirmed')] || '').trim()),
          items: []
        };
        byName.set(name, a);
        out.push(a);
      }
      a.items.push({
        code: String(r[at('item code')] || '').trim(), per: String(r[at('per')] || 'sf').trim(),
        qtyPerUnit: Number(r[at('qty per unit')]) || 0, wastePct: Number(r[at('waste pct')]) || 0
      });
    }
    return out;
  }

  // ---------- Scale labels from the estimator ----------

  function scaleKey(label) {
    return String(label || '').toLowerCase().replace(/[″”“]/g, '"').replace(/[′’]/g, "'").replace(/''/g, '"')
      .replace(/\s+/g, '').replace(/-0"$/, '').replace(/^scale:?/, '');
  }

  // The scale a label names, as ftPerUnit for a PDF at full size, or null.
  function parseScaleLabel(label) {
    const k = scaleKey(label);
    if (!k) return null;
    const p = presetList().find(x => scaleKey(x.label) === k);
    if (p) return { ftPerUnit: p.ftPerUnit, label: p.label };
    let m = k.match(/^1:(\d+(?:\.\d+)?)$/);
    if (m) return { ftPerUnit: presetFtPerUnit('metric', +m[1]), label: '1:' + m[1] };
    m = k.match(/^1"=(\d+(?:\.\d+)?)'$/);
    if (m) return { ftPerUnit: presetFtPerUnit('engineering', +m[1]), label: '1" = ' + m[1] + "'" };
    m = k.match(/^(?:(\d+)-)?(\d+)\/(\d+)"=1'$/);
    if (m) {
      const a = (m[1] ? +m[1] : 0) + +m[2] / +m[3];
      return { ftPerUnit: presetFtPerUnit('architectural', a), label: String(label).trim() };
    }
    return null;
  }

  // ---------- Estimator import (format section 4) ----------

  function findSheet(est, ref) {
    if (ref === null || ref === undefined || ref === '') return null;
    const byName = est.sheets.find(s => sameText(s.name, ref));
    if (byName) return byName;
    const n = Number(ref);
    return Number.isInteger(n) && n >= 1 && n <= est.sheets.length ? est.sheets[n - 1] : null;
  }

  function findByName(list, name) {
    return name ? list.find(x => sameText(x.name, name)) || null : null;
  }

  function validPoints(points) {
    return Array.isArray(points) && points.every(p => Array.isArray(p) && p.length === 2 &&
      isNum(p[0]) && isNum(p[1]) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1);
  }

  /*
   * Apply an estimator import file to an estimate. Never changes the estimate passed in.
   * Returns { est, report: { added: [], skipped: [], notes: [], priceChanges: [], waiting } }.
   * Rules: only adds; never deletes or overwrites; everything added is source "estimator", status "check".
   */
  function applyImport(estIn, imp) {
    const est = normalize(clone(estIn));
    const report = { added: [], skipped: [], notes: [], priceChanges: [], waiting: 0 };
    const problems = openImportProblems(imp);
    if (problems.length) { report.skipped.push(...problems); report.waiting = checkItems(est).length; return { est, report }; }
    const add = t => report.added.push(t);
    const skip = t => report.skipped.push(t);
    const note = t => report.notes.push(t);

    if (imp.job && !sameText(imp.job, est.job.name)) note('The import names job "' + imp.job + '"; this estimate is "' + est.job.name + '".');

    const usedColours = () => new Set(est.conditions.map(c => c.color));
    const assemblyByName = n => findByName(est.assemblies, n);

    function alternateId(name, where) {
      if (!name) return null;
      let a = findByName(est.alternates, name);
      if (!a) {
        a = { id: nextId(est.alternates, 'alt'), name: String(name).trim(), description: '', sign: 'add' };
        est.alternates.push(a);
        add('Alternate "' + a.name + '" (for ' + where + ')');
      }
      return a.id;
    }

    for (const a of imp.alternates || []) {
      if (!a.name) { skip('An alternate with no name.'); continue; }
      if (findByName(est.alternates, a.name)) { skip('Alternate "' + a.name + '" already exists.'); continue; }
      est.alternates.push({ id: nextId(est.alternates, 'alt'), name: String(a.name).trim(), description: a.description || '', sign: a.sign === 'deduct' ? 'deduct' : 'add' });
      add('Alternate "' + a.name + '"');
    }

    for (const s of imp.sheets || []) {
      const sheet = findSheet(est, s.sheet);
      if (!sheet) { skip('Sheet "' + s.sheet + '" not found.'); continue; }
      if (!s.scaleLabel) continue;
      const parsed = parseScaleLabel(s.scaleLabel);
      if (hasScale(sheet)) {
        const same = parsed && Math.abs(parsed.ftPerUnit - sheet.ftPerUnit) / sheet.ftPerUnit < 0.01;
        if (!same) note('Sheet ' + sheet.name + ': the estimator reads ' + s.scaleLabel + ', the sheet is set to ' + (sheet.scaleLabel || 'a scale') + '. Not changed.');
        continue;
      }
      if (!parsed) { skip('Sheet ' + sheet.name + ': scale "' + s.scaleLabel + '" not understood.'); continue; }
      if (sheet.kind !== 'pdf') { skip('Sheet ' + sheet.name + ' is a photo; set its scale from a dimension.'); continue; }
      sheet.ftPerUnit = parsed.ftPerUnit;
      sheet.scaleLabel = parsed.label;
      sheet.scaleSource = 'estimator';
      add('Scale ' + parsed.label + ' on ' + sheet.name + (s.basis ? ' (' + s.basis + ')' : ''));
    }

    for (const c of imp.conditions || []) {
      if (!c.name) { skip('A condition with no name.'); continue; }
      if (findByName(est.conditions, c.name)) { skip('Condition "' + c.name + '" already exists.'); continue; }
      if (!MEASURES.includes(c.measure)) { skip('Condition "' + c.name + '": measure "' + c.measure + '" not known.'); continue; }
      const a = c.assembly ? assemblyByName(c.assembly) : null;
      if (c.assembly && !a) note('Condition "' + c.name + '": assembly "' + c.assembly + '" not found. Left with no assembly.');
      const used = usedColours();
      est.conditions.push({
        id: nextId(est.conditions, 'c'), name: String(c.name).trim(), measure: c.measure,
        color: COLOURS.find(x => !used.has(x)) || COLOURS[est.conditions.length % COLOURS.length],
        heightFt: isNum(c.heightFt) ? c.heightFt : c.measure === 'wall' ? est.settings.defaultHeightFt : null,
        assemblyId: a ? a.id : null, unitCost: null, type: 'S',
        division: c.division || (a ? a.division : ''), location: c.location || '',
        alternateId: alternateId(c.alternate, 'condition ' + c.name), hidden: false
      });
      add('Condition "' + c.name + '"');
    }

    let measured = 0;
    for (const m of imp.measurements || []) {
      const c = findByName(est.conditions, m.condition);
      const sheet = findSheet(est, m.sheet);
      const label = '"' + (m.note || m.condition) + '"';
      if (!c) { skip('Measurement ' + label + ': condition "' + m.condition + '" not found.'); continue; }
      if (!sheet) { skip('Measurement ' + label + ': sheet "' + m.sheet + '" not found.'); continue; }
      if (!validPoints(m.points) || !m.points.length) { skip('Measurement ' + label + ': points must run from 0 to 1.'); continue; }
      const points = m.points.map(p => [round(p[0], 6), round(p[1], 6)]);
      const same = JSON.stringify(points);
      if (est.measurements.some(x => x.conditionId === c.id && x.sheetId === sheet.id && JSON.stringify(x.points) === same)) {
        skip('Measurement ' + label + ' is already on ' + sheet.name + '.');
        continue;
      }
      est.measurements.push({
        id: nextId(est.measurements, 'm'), conditionId: c.id, sheetId: sheet.id,
        points,
        deduct: !!m.deduct, statedQty: isNum(m.statedQty) ? m.statedQty : null, note: m.note || '',
        source: 'estimator', status: 'check', basis: m.basis || '',
        confidence: ['high', 'medium', 'low'].includes(m.confidence) ? m.confidence : 'low'
      });
      measured++;
    }
    if (measured) add(measured + (measured === 1 ? ' measurement' : ' measurements'));

    for (const r of imp.rooms || []) {
      if (!r.name) { skip('A room with no name.'); continue; }
      if (findByName(est.rooms, r.name)) { skip('Room "' + r.name + '" already exists.'); continue; }
      const ids = {};
      for (const [k, field] of [['floor', 'floorAssemblyId'], ['walls', 'wallAssemblyId'], ['ceiling', 'ceilingAssemblyId'], ['base', 'baseAssemblyId']]) {
        const a = r[k] ? assemblyByName(r[k]) : null;
        if (r[k] && !a) note('Room "' + r.name + '": ' + k + ' assembly "' + r[k] + '" not found.');
        ids[field] = a ? a.id : null;
      }
      est.rooms.push(Object.assign({
        id: nextId(est.rooms, 'r'), name: String(r.name).trim(), location: r.location || '',
        lengthFt: isNum(r.lengthFt) ? r.lengthFt : null, widthFt: isNum(r.widthFt) ? r.widthFt : null,
        heightFt: isNum(r.heightFt) ? r.heightFt : null, areaSf: isNum(r.areaSf) ? r.areaSf : null,
        perimeterLf: isNum(r.perimeterLf) ? r.perimeterLf : null,
        doors: isNum(r.doors) ? r.doors : 0, windows: isNum(r.windows) ? r.windows : 0
      }, ids, {
        alternateId: alternateId(r.alternate, 'room ' + r.name), measurementId: null,
        source: 'estimator', status: 'check', basis: r.basis || ''
      }));
      add('Room "' + r.name + '"');
    }

    for (const l of imp.lines || []) {
      if (!l.description) { skip('A line with no description.'); continue; }
      const dup = est.lines.find(x => sameText(x.description, l.description) && x.qty === l.qty && x.unit === l.unit &&
        (x.division || '') === (l.division || '') && x.source === 'estimator');
      if (dup) { skip('Line "' + l.description + '" is already in the estimate.'); continue; }
      est.lines.push({
        id: nextId(est.lines, 'l'), division: l.division || '', description: String(l.description).trim(), scope: l.scope || '',
        location: l.location || '', qty: isNum(l.qty) ? l.qty : null, unit: l.unit || '',
        unitCost: isNum(l.unitCost) ? l.unitCost : null, type: TYPES.includes(l.type) ? l.type : null,
        allowance: !!l.allowance, alternateId: alternateId(l.alternate, 'line ' + l.description),
        source: 'estimator', status: 'check', basis: l.basis || ''
      });
      add('Line "' + l.description + '"');
    }

    for (const b of imp.bids || []) {
      if (!b.trade) { skip('A bid with no trade.'); continue; }
      const altId = alternateId(b.alternate, 'bid ' + b.trade);
      if (est.bids.find(x => sameText(x.trade, b.trade) && (x.alternateId || null) === altId)) { skip('Bid for ' + b.trade + ' already exists.'); continue; }
      const bidders = [];
      for (const bd of b.bidders || []) {
        bidders.push({
          id: 'bd' + (bidders.length + 1), name: bd.name || '', amount: isNum(bd.amount) ? bd.amount : 0,
          includes: Array.isArray(bd.includes) ? bd.includes.slice() : [], wcbClearance: !!bd.wcbClearance,
          insurance: !!bd.insurance, notes: bd.notes || ''
        });
      }
      est.bids.push({
        id: nextId(est.bids, 'b'), trade: String(b.trade).trim(), division: b.division || '', alternateId: altId,
        scopeItems: (b.scopeItems || []).map(s => ({ text: s.text || '', plug: isNum(s.plug) ? s.plug : 0 })),
        bidders, selectedBidderId: null, source: 'estimator', status: 'check'
      });
      add('Bid for ' + b.trade);
    }

    for (const q of imp.rfis || []) {
      if (!q.question) continue;
      if (est.rfis.find(x => sameText(x.question, q.question))) { skip('RFI already listed: ' + q.question); continue; }
      est.rfis.push({ id: nextId(est.rfis, 'q'), question: q.question, reference: q.reference || '', status: 'open', answer: '' });
      add('RFI: ' + q.question);
    }

    for (const k of imp.risks || []) {
      if (!k.risk) continue;
      if (est.risks.find(x => sameText(x.risk, k.risk))) { skip('Risk already listed: ' + k.risk); continue; }
      est.risks.push({ id: nextId(est.risks, 'k'), risk: k.risk, likelyCost: isNum(k.likelyCost) ? k.likelyCost : 0, inPrice: isNum(k.inPrice) ? k.inPrice : 0 });
      add('Risk: ' + k.risk);
    }

    for (const k of ['exclusions', 'assumptions', 'clarifications']) {
      for (const t of imp[k] || []) {
        if (!String(t).trim()) continue;
        if (est[k].some(x => sameText(x, t))) { skip('Already in ' + k + ': ' + t); continue; }
        est[k].push(String(t).trim());
        add(k[0].toUpperCase() + k.slice(1, -1) + ': ' + t);
      }
    }

    for (const p of imp.priceChanges || []) {
      const item = est.priceBook.find(x => x.code === p.code);
      if (!item) { skip('Price change for ' + p.code + ': not in the price book.'); continue; }
      if (!isNum(p.unitCost)) { skip('Price change for ' + p.code + ': no unit cost.'); continue; }
      report.priceChanges.push({ code: p.code, item: item.item, unit: item.unit, from: item.unitCost, to: p.unitCost, source: p.source || '' });
    }

    report.waiting = checkItems(est).length;
    return { est, report };
  }

  function openImportProblems(obj) {
    if (!obj || typeof obj !== 'object') return ['Not an import file.'];
    if (obj.format === FORMAT) return ['This is an estimate file, not an estimator import file.'];
    if (obj.format !== IMPORT_FORMAT) return ['Not a Steadfast estimator import file.'];
    if (obj.version !== VERSION) return ['Import file version ' + obj.version + '. This app reads version ' + VERSION + '.'];
    return [];
  }

  // ---------- Validation against the format ----------

  /*
   * Check a parsed file against the format. Returns { kind: 'estimate' | 'import' | null, errors, warnings }.
   */
  function validate(obj) {
    const errors = [], warnings = [];
    const err = t => errors.push(t), warn = t => warnings.push(t);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { kind: null, errors: ['Not a JSON object.'], warnings };
    const numOrNull = (v, where) => { if (v !== null && v !== undefined && !isNum(v)) err(where + ' must be a number or null.'); };

    if (obj.format === IMPORT_FORMAT) {
      if (obj.version !== VERSION) err('version must be ' + VERSION + '.');
      for (const k of ['sheets', 'conditions', 'measurements', 'rooms', 'lines', 'alternates', 'bids', 'rfis', 'risks',
        'exclusions', 'assumptions', 'clarifications', 'priceChanges']) {
        if (obj[k] !== undefined && !Array.isArray(obj[k])) err(k + ' must be a list.');
      }
      if (JSON.stringify(obj).includes('"status":"ok"')) err('An import cannot mark anything "ok". Only Kamal or Tej accepts items.');
      const names = new Set((obj.conditions || []).map(c => String(c.name || '').toLowerCase()));
      (obj.conditions || []).forEach((c, i) => {
        if (!c.name) err('conditions[' + i + '] has no name.');
        if (!MEASURES.includes(c.measure)) err('conditions[' + i + '] measure must be area, length, wall or count.');
      });
      (obj.measurements || []).forEach((m, i) => {
        const w = 'measurements[' + i + ']';
        if (!m.condition) err(w + ' has no condition.');
        else if (!names.has(String(m.condition).toLowerCase())) warn(w + ': condition "' + m.condition + '" is not in this file, so it must already be in the estimate.');
        if (m.sheet === undefined || m.sheet === null || m.sheet === '') err(w + ' has no sheet.');
        if (!validPoints(m.points) || !m.points.length) err(w + ' points must be [x, y] pairs from 0 to 1.');
        numOrNull(m.statedQty, w + ' statedQty');
        if (m.confidence && !['high', 'medium', 'low'].includes(m.confidence)) err(w + ' confidence must be high, medium or low.');
        if (!m.basis) warn(w + ' has no basis.');
      });
      (obj.rooms || []).forEach((r, i) => {
        if (!r.name) err('rooms[' + i + '] has no name.');
        for (const k of ['lengthFt', 'widthFt', 'heightFt', 'doors', 'windows']) numOrNull(r[k], 'rooms[' + i + '] ' + k);
      });
      (obj.lines || []).forEach((l, i) => {
        if (!l.description) err('lines[' + i + '] has no description.');
        numOrNull(l.qty, 'lines[' + i + '] qty');
        numOrNull(l.unitCost, 'lines[' + i + '] unitCost');
        if (l.type && !TYPES.includes(l.type)) err('lines[' + i + '] type must be M, L, S or E.');
        if (isNum(l.unitCost) && !l.basis) warn('lines[' + i + '] has a unit cost with no basis. Name the source.');
      });
      (obj.priceChanges || []).forEach((p, i) => {
        if (!p.code) err('priceChanges[' + i + '] has no code.');
        if (!isNum(p.unitCost)) err('priceChanges[' + i + '] unitCost must be a number.');
        if (!p.source) err('priceChanges[' + i + '] has no source.');
      });
      for (const k of ['priceOverride', 'marginTarget']) if (k in obj) err('An import cannot set ' + k + '.');
      return { kind: 'import', errors, warnings };
    }

    if (obj.format !== FORMAT) return { kind: null, errors: ['format must be "' + FORMAT + '" or "' + IMPORT_FORMAT + '".'], warnings };
    if (obj.version !== VERSION) err('version must be ' + VERSION + '.');
    if (!obj.job || typeof obj.job !== 'object') err('job is missing.');
    else {
      if (!obj.job.name) warn('job.name is empty.');
      if (obj.job.type && !['residential', 'commercial'].includes(obj.job.type)) err('job.type must be residential or commercial.');
      if (obj.job.class && !['A', 'B', 'C', 'D'].includes(obj.job.class)) err('job.class must be A, B, C or D.');
    }
    if (!obj.settings || typeof obj.settings !== 'object') err('settings is missing.');
    else {
      for (const k of ['marginFloor', 'marginTarget', 'gstPct', 'roundTo', 'defaultHeightFt', 'doorWidthFt', 'doorAreaSf', 'windowAreaSf', 'travelPct']) {
        if (!isNum(obj.settings[k])) err('settings.' + k + ' must be a number.');
      }
      for (const k of ['commercialFloor', 'contingencyPct', 'priceOverride']) numOrNull(obj.settings[k], 'settings.' + k);
      if (Array.isArray(obj.settings.stages)) {
        const pct = obj.settings.stages.reduce((a, s) => a + (isNum(s.pct) ? s.pct : 0), 0);
        if (Math.abs(pct - 100) > 1e-9) warn('Stages total ' + pct + '%, not 100%.');
      }
    }
    const lists = ['priceBook', 'assemblies', 'sheets', 'conditions', 'measurements', 'rooms', 'lines', 'alternates',
      'bids', 'risks', 'rfis', 'exclusions', 'assumptions', 'clarifications'];
    const missingLists = lists.filter(k => !Array.isArray(obj[k]));
    for (const k of missingLists) err(k + ' must be a list.');
    if (missingLists.length) return { kind: 'estimate', errors, warnings };

    for (const k of ['assemblies', 'sheets', 'conditions', 'measurements', 'rooms', 'lines', 'alternates', 'bids']) {
      const seen = new Set();
      for (const x of obj[k]) {
        if (!x.id) err(k + ': an item has no id.');
        else if (seen.has(x.id)) err(k + ': id ' + x.id + ' is used twice.');
        seen.add(x.id);
      }
    }
    const ids = k => new Set(obj[k].map(x => x.id));
    const sheetIds = ids('sheets'), condIds = ids('conditions'), asmIds = ids('assemblies'), altIds = ids('alternates');
    const codes = new Set(obj.priceBook.map(p => p.code));
    const status = (x, w) => { if (x.status !== undefined && !['ok', 'check'].includes(x.status)) err(w + ' status must be ok or check.'); };

    obj.priceBook.forEach(p => {
      if (!p.code) err('priceBook: an item has no code.');
      if (p.type && !TYPES.includes(p.type)) err('priceBook ' + p.code + ' type must be M, L, S or E.');
      numOrNull(p.unitCost, 'priceBook ' + p.code + ' unitCost');
    });
    obj.assemblies.forEach(a => {
      if (!MEASURES.includes(a.measure)) err('assembly ' + a.name + ' measure must be area, length, wall or count.');
      (a.items || []).forEach(it => {
        if (!codes.has(it.code)) warn('assembly ' + a.name + ' uses ' + it.code + ', which is not in the price book.');
        if (!['sf', 'lf', 'ea'].includes(it.per)) err('assembly ' + a.name + ' item ' + it.code + ' per must be sf, lf or ea.');
      });
    });
    obj.sheets.forEach(s => {
      if (!isNum(s.widthPt) || !isNum(s.heightPt)) err('sheet ' + s.name + ' needs widthPt and heightPt.');
      numOrNull(s.ftPerUnit, 'sheet ' + s.name + ' ftPerUnit');
    });
    obj.conditions.forEach(c => {
      if (!MEASURES.includes(c.measure)) err('condition ' + c.name + ' measure must be area, length, wall or count.');
      if (c.assemblyId && !asmIds.has(c.assemblyId)) err('condition ' + c.name + ' uses assembly ' + c.assemblyId + ', which does not exist.');
      if (c.alternateId && !altIds.has(c.alternateId)) err('condition ' + c.name + ' uses alternate ' + c.alternateId + ', which does not exist.');
      numOrNull(c.unitCost, 'condition ' + c.name + ' unitCost');
    });
    obj.measurements.forEach(m => {
      const w = 'measurement ' + m.id;
      if (!condIds.has(m.conditionId)) err(w + ' refers to condition ' + m.conditionId + ', which does not exist.');
      if (!sheetIds.has(m.sheetId)) err(w + ' refers to sheet ' + m.sheetId + ', which does not exist.');
      if (!validPoints(m.points)) err(w + ' points must be [x, y] pairs from 0 to 1.');
      numOrNull(m.statedQty, w + ' statedQty');
      status(m, w);
    });
    obj.rooms.forEach(r => {
      for (const [, f] of ROOM_FINISHES) if (r[f] && !asmIds.has(r[f])) err('room ' + r.name + ' ' + f + ' does not exist.');
      status(r, 'room ' + r.name);
    });
    obj.lines.forEach(l => {
      numOrNull(l.qty, 'line ' + l.id + ' qty');
      numOrNull(l.unitCost, 'line ' + l.id + ' unitCost');
      if (l.alternateId && !altIds.has(l.alternateId)) err('line ' + l.id + ' uses alternate ' + l.alternateId + ', which does not exist.');
      status(l, 'line ' + l.id);
    });
    obj.bids.forEach(b => status(b, 'bid ' + b.trade));
    return { kind: 'estimate', errors, warnings };
  }

  return {
    FORMAT_VERSION, FORMAT, IMPORT_FORMAT, VERSION, SCALE_PRESETS, MAIN_UNIT, STATED_FLAG_RATIO,
    DIVISIONS, COLOURS, MEASURES, TYPES, TYPE_NAMES, ROOM_FINISHES,
    presetFtPerUnit, presetList, calibrateFtPerUnit, hasScale, parseScaleLabel,
    pathLengthFt, polygonAreaSf, measurementQty, conditionTotals, mainQty, conditionHeight,
    today, clone, newEstimate, normalize, openProblems, openImportProblems, nextId, safeName,
    documentName, estimateFileName, divisionName, sameText,
    roomQty, roomBasis, levelledPrice, estimateLines, combineLines, priceLines, money, marginFloor,
    stageInvoices, stagesTotalPct, assemblyUnitCost, checkItems, releaseChecks, openCheckCount, acceptItems,
    parseCsv, toCsv, parseType, parseMoney, parseDate, priceBookFromRows, assembliesFromRows,
    applyImport, validate,
    parseFeet, fmtQty, fmtFeetInches, fmtMoney, fmtPct, round, round2
  };
});
