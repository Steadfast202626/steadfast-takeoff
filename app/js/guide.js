/*
 * Steadfast takeoff: plain-language guidance. What to do next on a job, and the plain names for the
 * release checks. Reads the estimate through calc.js; never changes a number or the file.
 * Works in the browser (SteadfastGuide) and in Node (require), so the tests can read it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.SteadfastGuide = factory(root.SteadfastCalc);
})(typeof self !== 'undefined' ? self : this, function (calc) {
  'use strict';

  // Release checks in plain words. The format file's wording stays in the hover help.
  const PLAIN_CHECKS = {
    1: 'Every sheet with markups has a scale',
    2: 'No estimator items left to check',
    3: 'Every line has a cost',
    4: 'Contingency is set',
    5: 'Margin is at or above the floor',
    6: 'Estimate class is A or B',
    7: 'What\'s not included is written',
    8: 'At least one risk is listed',
    9: 'Build-ups in use are confirmed by Kamal',
    10: 'Chosen trades have WCB clearance and insurance',
    11: 'Open questions are listed',
    12: 'Payment stages add to 100%',
    13: 'Commercial floor set and cash flow reviewed'
  };

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  /*
   * The one thing to do now on this job: { key, text, sheetId?, bidId? }.
   * view.sheetId is the sheet on screen, so an unscaled sheet being worked on comes first.
   */
  function nextStep(est, view) {
    view = view || {};
    if (!est.sheets.length) return { key: 'drawings', text: 'Add your drawings' };

    const marked = new Set(est.measurements.map(m => m.sheetId));
    const current = est.sheets.find(s => s.id === view.sheetId);
    const unscaled = est.sheets.find(s => marked.has(s.id) && !calc.hasScale(s)) ||
      (current && !calc.hasScale(current) ? current : null) ||
      (!est.measurements.length ? est.sheets.find(s => !calc.hasScale(s)) : null);
    if (unscaled) return { key: 'scale', sheetId: unscaled.id, text: 'Set the scale on sheet ' + unscaled.name };

    const nothingYet = !est.measurements.length && !est.rooms.length && !est.lines.length;
    if (nothingYet && !est.conditions.length) return { key: 'condition', text: 'Add what you\'re measuring' };
    if (nothingYet) return { key: 'measure', sheetId: (current || est.sheets[0]).id, text: 'Measure on sheet ' + (current || est.sheets[0]).name };

    const waiting = calc.checkItems(est).length;
    if (waiting) return { key: 'review', text: plural(waiting, 'estimator item', 'estimator items') + ' to check' };

    const m = calc.money(est);
    const missing = m.lines.filter(l => l.missing).length;
    if (missing) return { key: 'costs', text: plural(missing, 'item has', 'items have') + ' no cost' };

    const checks = calc.releaseChecks(est, m);
    const open = n => checks.find(c => c.n === n && c.status === 'fail');
    const s = est.settings;
    if (open(4)) return { key: 'contingency', text: 'Set the contingency' };
    if (open(6)) return { key: 'class', text: 'Set the estimate class' };
    if (open(5)) {
      if (est.job.type === 'commercial' && typeof s.commercialFloor !== 'number') return { key: 'floor', text: 'Set the commercial margin floor' };
      return { key: 'margin', text: 'Price is below the margin floor' };
    }
    if (open(7)) return { key: 'exclusions', text: 'Write what\'s not included' };
    if (open(8)) return { key: 'risks', text: 'List at least one risk' };
    if (open(10)) {
      const b = est.bids.find(x => {
        const bd = x.selectedBidderId && (x.bidders || []).find(y => y.id === x.selectedBidderId);
        return bd && !(bd.wcbClearance && bd.insurance);
      });
      return { key: 'wcb', bidId: b ? b.id : null, text: 'Tick WCB and insurance for ' + (b ? b.trade : 'the chosen trade') };
    }
    if (open(12)) return { key: 'stages', text: 'Make the payment stages add to 100%' };
    if (open(13)) return { key: 'cash', text: 'Review the cash flow' };
    if (open(1) || open(2) || open(3)) return { key: 'checks', text: 'Open Before you send' };
    return { key: 'quote', text: 'Ready. Print the customer quote' };
  }

  return { nextStep, PLAIN_CHECKS };
});
