/*
 * Steadfast takeoff: the Checks screen. The release checklist from the format file, each with a way to fix it.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const { el, button } = window.SteadfastUI;
  const screens = window.SteadfastScreens = window.SteadfastScreens || {};

  const STATUS_TEXT = { pass: 'Done', fail: 'Open', warn: 'Check', na: 'n/a' };

  // Where each check is fixed: [button label, hover help, screen or action]
  const FIX = {
    1: ['Takeoff', 'Set the scale on each sheet with markups', 'takeoff'],
    2: ['Review items', 'Accept or change the estimator\'s items', 'review'],
    3: ['Estimate', 'Fill in the missing unit costs', 'estimate'],
    4: ['Estimate', 'Set contingency in Settings', 'estimate'],
    5: ['Estimate', 'Look at the price and the margin floor', 'estimate'],
    6: ['Job details', 'Set the estimate class', 'job'],
    7: ['Estimate', 'Write the exclusions under Quote wording', 'estimate'],
    8: ['Estimate', 'List the risks', 'estimate'],
    9: ['Assemblies', 'Check the factors and tick "Confirmed by Kamal"', 'assemblies'],
    10: ['Bids', 'Tick WCB clearance and insurance for the chosen bidders', 'bids'],
    11: ['Estimate', 'Send or answer the open questions', 'estimate'],
    12: ['Estimate', 'Make the payment stages total 100%', 'estimate'],
    13: ['Cash flow', 'Set the commercial floor and review the cash flow', 'cash']
  };

  // Where estimator items wait: the first one decides where "Review items" goes.
  function review(app) {
    const first = calc.checkItems(app.est)[0];
    if (!first) return app.goto('estimate');
    if (first.kind === 'measurements') return app.showCondition(first.item.conditionId);
    app.goto({ rooms: 'rooms', lines: 'estimate', bids: 'bids' }[first.kind]);
  }

  function renderChecks(root, app) {
    const checks = calc.releaseChecks(app.est);
    const open = calc.openCheckCount(checks);
    root.append(el('div', { className: 'screen-head' }, el('h1', { textContent: 'Release checklist' })));
    root.append(el('p', { className: 'note' + (open ? ' warn' : ''), textContent: open
      ? open + ' open. The quote is not ready to release.'
      : 'Every required check passes. The quote still goes out only after an owner approves the price.' }));
    const ul = el('ul', { className: 'checklist big' });
    for (const c of checks) {
      const [label, tip, target] = FIX[c.n];
      ul.append(el('li', { className: c.status },
        el('span', { className: 'badge', textContent: STATUS_TEXT[c.status] }),
        el('span', { className: 'label', textContent: c.n + '. ' + c.label }),
        c.detail ? el('span', { className: 'muted', textContent: c.detail }) : null,
        c.status === 'fail' || c.status === 'warn'
          ? button(label, tip, () => (target === 'review' ? review(app) : target === 'job' ? app.openJobDialog() : app.goto(target)), 'small')
          : null));
    }
    root.append(ul);
  }

  screens.checks = { label: 'Checks', title: 'Release checklist', render: renderChecks };
})();
