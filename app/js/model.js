/*
 * Steadfast takeoff: the estimate file shape (docs/estimate-file-format.md, section 1).
 * Shared by the app (browser global SteadfastModel) and the helper (Node require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SteadfastModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAT = 'steadfast-estimate';
  const VERSION = 1;

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

  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function newEstimate(date) {
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
      priceBook: [],
      assemblies: [],
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
    if (obj.format === 'steadfast-estimator-import') return ['This is an estimator import file, not an estimate file.'];
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

  // YYYY-MM-DD — Estimate — Job name.json
  function estimateFileName(est, date) {
    const name = safeName(est.job.name) || 'Job';
    return (date || today()) + ' — Estimate — ' + name + '.json';
  }

  function divisionName(code) {
    const d = DIVISIONS.find(x => x[0] === code);
    return d ? d[1] : '';
  }

  return {
    FORMAT, VERSION, DIVISIONS, COLOURS, MEASURES, TYPES,
    today, newEstimate, normalize, openProblems, nextId, estimateFileName, divisionName, safeName
  };
});
