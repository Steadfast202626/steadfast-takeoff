/*
 * Steadfast takeoff: the steps of the new job wizard and what each one still needs.
 * missing(est, state) lists, in plain words, what stops Next. An empty list means the step is done.
 * state is the wizard's own record (kept in the browser): { noDrawings, noRooms, scaleChecks }.
 * Works in the browser (SteadfastWizardRules) and in Node (require), so the tests can use it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.SteadfastWizardRules = factory(root.SteadfastCalc);
})(typeof self !== 'undefined' ? self : this, function (calc) {
  'use strict';

  const SCALE_TOLERANCE = 0.02; // a second dimension within 2% of what the scale measures passes

  // ---------- Steadfast's rules (owners, 2026-11-05) ----------
  // Filled in by the wizard on every new job. Kamal can change any of them per job; a value he
  // changed is never filled in again.
  const RULES = {
    contingency: { residential: 10, commercial: 7.5, incompleteDrawings: 10 },
    margin: { residential: { target: 35, floor: 30 }, commercial: { target: 30, floor: 25 } },
    travelPct: 10,
    localArea: ['Edmonton', 'St. Albert', 'Sherwood Park', 'Spruce Grove', 'Leduc', 'Beaumont']
  };

  const plainPlace = t => String(t || '').toLowerCase().replace(/\bsaint\b/g, 'st').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

  // The town the address names from the local list, or null when it names none of them.
  // Only the town part counts: a street line with a number ("12 Leduc Ave") is skipped.
  function localTown(address) {
    const parts = String(address || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    const places = parts.filter((x, i) => i > 0 || parts.length === 1 && !/\d/.test(x) || i === 0 && !/\d/.test(x));
    for (const part of places) {
      const a = ' ' + plainPlace(part) + ' ';
      const town = RULES.localArea.find(t => a.includes(' ' + plainPlace(t) + ' '));
      if (town) return town;
    }
    return null;
  }

  // What the rules give for this job, with the reason for each, in plain words.
  // state.drawingsIncomplete or state.noDrawings: the drawings are incomplete.
  function steadfastRules(est, state) {
    state = state || {};
    const commercial = est.job.type === 'commercial';
    const incomplete = !!(state.drawingsIncomplete || state.noDrawings);
    const values = {}, reasons = {};
    values.contingencyPct = incomplete ? RULES.contingency.incompleteDrawings : commercial ? RULES.contingency.commercial : RULES.contingency.residential;
    reasons.contingencyPct = 'Contingency ' + values.contingencyPct + '%' + (incomplete ? ', drawings incomplete' : commercial ? ', commercial' : ', residential');
    const m = commercial ? RULES.margin.commercial : RULES.margin.residential;
    values.marginTarget = m.target;
    reasons.marginTarget = 'Target margin ' + m.target + '%';
    if (commercial) { values.commercialFloor = m.floor; reasons.commercialFloor = 'Commercial floor ' + m.floor + '%'; }
    else { values.marginFloor = m.floor; reasons.marginFloor = 'Floor ' + m.floor + '%'; }
    if (est.job.address) {
      const town = localTown(est.job.address);
      values.travelPct = town ? 0 : RULES.travelPct;
      reasons.travelPct = town ? 'No travel premium, ' + town : 'Travel ' + RULES.travelPct + '%, the address names no town in Edmonton and area';
    }
    return { values, reasons };
  }

  // The settings to change so the job follows the rules, leaving alone anything Kamal set himself.
  // auto: what the wizard filled in last time ({ key: value }). A setting still at that value, or at
  // the new-job default, or empty, is the wizard's to fill; anything else is Kamal's.
  function ruleChanges(est, state, auto) {
    auto = auto || {};
    const fresh = calc.newEstimate().settings;
    const { values } = steadfastRules(est, state);
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      const cur = est.settings[k];
      const ours = cur === null || cur === undefined || (k in auto ? cur === auto[k] : cur === fresh[k]);
      if (ours && cur !== v) out[k] = v;
    }
    return out;
  }

  const isNum = v => typeof v === 'number' && isFinite(v);

  function roomHasSize(est, r) {
    const q = calc.roomQty(est, r);
    return isNum(q.area) && q.area > 0;
  }

  const STEPS = [
    {
      key: 'details', title: 'Job details',
      missing(est) {
        const j = est.job, out = [];
        if (!j.name || j.name === 'New job') out.push('Job name');
        if (!j.client) out.push('Client');
        if (!j.address) out.push('Site address');
        if (!j.class) out.push('Estimate class (A, B, C or D)');
        if (!j.bidDue) out.push('Bid due date');
        return out;
      }
    },
    {
      key: 'drawings', title: 'Drawings',
      missing(est, state) {
        if (state.noDrawings) return [];
        return est.sheets.length ? [] : ['Add the drawings, or tick "No drawings for this job"'];
      }
    },
    {
      key: 'scale', title: 'Scale',
      missing(est, state) {
        if (state.noDrawings && !est.sheets.length) return [];
        const out = [];
        for (const s of est.sheets) {
          if (!calc.hasScale(s)) { out.push(s.name + ': set the scale'); continue; }
          const c = (state.scaleChecks || {})[s.id];
          if (!c || c.ftPerUnit !== s.ftPerUnit) out.push(s.name + ': check the scale against a second dimension');
          else if (!c.ok) out.push(s.name + ': the second dimension is off by ' + Math.round(Math.abs(c.off) * 100) + '%. Set the scale again');
        }
        return out;
      }
    },
    {
      key: 'rooms', title: 'Rooms',
      missing(est, state) {
        if (state.noRooms) return [];
        return est.rooms.length ? [] : ['Add a room from a template, or tick "No rooms on this job"'];
      }
    },
    {
      key: 'measure', title: 'Measure or import',
      missing(est) {
        const out = [];
        for (const r of est.rooms) if (!roomHasSize(est, r)) out.push(r.name + ': length and width, or trace it on the drawing');
        for (const c of est.conditions) {
          if (!est.measurements.some(m => m.conditionId === c.id)) out.push(c.name + ': nothing measured yet');
        }
        const waiting = calc.checkItems(est).length;
        if (waiting) out.push(waiting + (waiting === 1 ? ' estimator item' : ' estimator items') + ' to accept');
        if (!est.rooms.length && !est.conditions.length && !est.lines.length) out.push('Measure something, or import the estimator\'s file');
        return out;
      }
    },
    {
      key: 'prices', title: 'Prices',
      missing(est) {
        const m = calc.money(est);
        const missing = m.lines.filter(l => l.missing);
        const out = missing.slice(0, 6).map(l => l.description + (l.room || l.location ? ', ' + (l.room || l.location) : '') + ': no cost');
        if (missing.length > 6) out.push((missing.length - 6) + ' more lines with no cost');
        return out;
      }
    },
    {
      key: 'profit', title: 'Profit and extras',
      missing(est) {
        const s = est.settings, out = [];
        if (!isNum(s.contingencyPct)) out.push('Contingency %');
        if (est.job.type === 'commercial' && !isNum(s.commercialFloor)) out.push('Commercial margin floor %');
        if (!est.exclusions.length) out.push('Exclusions: what is not included');
        if (!est.risks.length) out.push('At least one risk');
        const m = calc.money(est);
        const floor = calc.marginFloor(est);
        if (isNum(m.base.margin) && isNum(floor) && m.base.margin * 100 < floor - 1e-9) {
          out.push('Margin ' + calc.fmtPct(m.base.margin) + ' is under the ' + floor + '% floor');
        }
        return out;
      }
    },
    {
      key: 'final', title: 'Final check',
      missing(est) {
        return calc.releaseChecks(est).filter(c => c.status === 'fail').map(c => c.label + (c.detail ? ': ' + c.detail : ''));
      }
    },
    { key: 'quote', title: 'Quote', missing: () => [] }
  ];

  // The first step that still needs something, or the last step.
  function firstOpen(est, state) {
    const i = STEPS.findIndex(s => s.missing(est, state).length);
    return i === -1 ? STEPS.length - 1 : i;
  }

  // What a scale check found: measuredFt from the drawing at the current scale against the typed length.
  function scaleCheck(sheet, p, q, typedFt) {
    const measuredFt = calc.pathLengthFt([p, q], sheet, false);
    if (!isNum(measuredFt) || !(typedFt > 0)) return null;
    const off = (measuredFt - typedFt) / typedFt;
    return { ok: Math.abs(off) <= SCALE_TOLERANCE, off, measuredFt, typedFt, ftPerUnit: sheet.ftPerUnit };
  }

  return { STEPS, firstOpen, scaleCheck, SCALE_TOLERANCE, RULES, localTown, steadfastRules, ruleChanges };
});
