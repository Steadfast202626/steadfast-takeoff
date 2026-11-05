/*
 * Steadfast takeoff: the start page, shown on every visit. Continue a job, start one, practice,
 * post-mortems and the price book, with the open checks and stale prices at a glance.
 * The buttons for a new job and practice are wired in tour.js; this file fills in the rest.
 */
(function () {
  'use strict';

  const app = window.SteadfastApp;
  const calc = window.SteadfastCalc;
  const Library = window.SteadfastLibrary;
  const Outputs = window.SteadfastOutputs;
  const { el } = window.SteadfastUI;
  const $ = id => document.getElementById(id);

  const visible = () => !$('welcome').hidden;

  function hide() {
    $('welcome').hidden = true;
    app.renderAll();
  }

  function item(text, kind, onClick, title) {
    const li = el('li', { className: kind || '' });
    if (onClick) li.append(el('button', { type: 'button', className: 'link', textContent: text, title: title || '', onclick: onClick }));
    else li.append(el('span', { textContent: text, title: title || '' }));
    return li;
  }

  // ---------- At a glance ----------

  function renderChecks(jobs) {
    const ul = $('startChecks');
    ul.innerHTML = '';
    const sample = Outputs.isSample(app.est);
    if (app.hasWork() && !sample) {
      const checks = calc.releaseChecks(app.est);
      const open = checks.filter(c => c.status === 'fail' || c.status === 'warn');
      const name = app.est.job.name || 'This job';
      if (!open.length) ul.append(item(name + ': ready to send', 'ok'));
      for (const c of open.slice(0, 4)) {
        ul.append(item(name + ': ' + (window.SteadfastGuide.PLAIN_CHECKS[c.n] || c.label), c.status === 'fail' ? 'fail' : 'warn',
          () => { hide(); app.goto('checks'); }, c.detail || c.label));
      }
      if (open.length > 4) ul.append(item((open.length - 4) + ' more on ' + name, 'warn', () => { hide(); app.goto('checks'); }));
    }
    const link = app.cloud && app.cloud.link();
    for (const j of (jobs || []).filter(j => j.openChecks > 0 && (!link || link.itemId !== j.itemId)).slice(0, 5)) {
      ul.append(item(j.name + ': ' + j.openChecks + (j.openChecks === 1 ? ' check open' : ' checks open'), 'warn',
        j.estimateFile ? () => openFromMonday(j) : null, 'On the Monday.com Estimates board'));
    }
    if (!ul.children.length) ul.append(item('Nothing open', 'ok'));
  }

  function renderPrices() {
    const ul = $('startPrices');
    ul.innerHTML = '';
    const lib = Library.get();
    const toBook = () => { hide(); app.goto('pricebook'); };
    if (lib.fromStarter) ul.append(item('Price book not imported from Monday.com yet', 'fail', toBook));
    else {
      const days = Library.daysSince(lib.importedAt);
      if (days !== null && days > Library.STALE_DAYS) ul.append(item('Last import ' + days + ' days ago', 'warn', toBook, 'Import the Monday.com Price book board again'));
      else ul.append(item('Imported ' + (days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago'), 'ok'));
    }
    const qbo = window.SteadfastQuickBooks && window.SteadfastQuickBooks.state.last;
    if (qbo && qbo.flags.length) {
      ul.append(item(qbo.flags.length + (qbo.flags.length === 1 ? ' price' : ' prices') + ' moved on QuickBooks bills, checked ' + qbo.ranAt.slice(0, 10), 'warn', toBook,
        'Marked "check" on the Monday.com Price book board for Kamal'));
    }
    const noCost = lib.priceBook.filter(p => p.unitCost === null || p.unitCost === undefined).length;
    if (noCost) ul.append(item(noCost + (noCost === 1 ? ' item has no cost' : ' items have no cost'), 'warn', toBook));
    if (app.hasWork() && !Outputs.isSample(app.est)) {
      const PB = window.SteadfastPriceBook;
      const changed = PB ? app.est.priceBook.filter(PB.needsMondayUpdate).length : 0;
      if (changed) ul.append(item(changed + (changed === 1 ? ' cost' : ' costs') + ' changed in this job, update Monday.com', 'warn', toBook));
      const missing = calc.money(app.est).base.missing;
      if (missing) ul.append(item(missing + (missing === 1 ? ' line' : ' lines') + ' in this job with no cost', 'warn', () => { hide(); app.goto('estimate'); }));
    }
    $('startPricebookSub').textContent = lib.fromStarter ? 'Not imported yet' : (lib.priceBook.length + ' items');
  }

  // ---------- Jobs ----------

  function renderJobs(jobs) {
    const box = $('startJobs');
    $('startJobsSection').hidden = !jobs;
    box.innerHTML = '';
    if (!jobs) return;
    if (!jobs.length) { box.append(el('p', { className: 'muted', textContent: 'No jobs on the Estimates board yet.' })); return; }
    const link = app.cloud.link();
    const table = el('table', { className: 'grid compact job-list' },
      el('thead', {}, el('tr', {}, ['Job', 'Client', 'Status', 'Bid due', 'Checks', ''].map(h => el('th', { textContent: h })))));
    const tbody = el('tbody');
    for (const j of jobs.slice(0, 12)) {
      const here = link && link.itemId === j.itemId;
      tbody.append(el('tr', { className: here ? 'lowest-row' : '' },
        el('td', { textContent: j.name }), el('td', { textContent: j.client }), el('td', { textContent: j.status || j.group }),
        el('td', { textContent: j.bidDue }),
        el('td', { className: 'num' + (j.openChecks ? ' warn-text' : ''), textContent: j.openChecks === null ? '' : String(j.openChecks) }),
        el('td', { className: 'actions' }, el('button', { type: 'button', className: 'small' + (here ? '' : ' primary'),
          textContent: here ? 'Continue' : 'Open', disabled: !j.estimateFile && !here,
          title: j.estimateFile ? 'Open ' + j.estimateFile.name : 'No estimate file on this item yet',
          onclick: () => (here ? hide() : openFromMonday(j)) }))));
    }
    table.append(tbody);
    box.append(el('div', { className: 'table-wrap' }, table));
  }

  function openFromMonday(job) {
    hide();
    app.cloud.openJob(job.itemId);
  }

  // ---------- Tiles ----------

  function renderTiles() {
    const work = app.hasWork() && !Outputs.isSample(app.est);
    $('startContinue').disabled = !work;
    $('startContinueSub').textContent = work ? (app.est.job.name || 'Job in this browser') : 'Nothing open in this browser';
    $('startPostmortems').hidden = !(window.SteadfastScreens && window.SteadfastScreens.postmortems);
    const signIn = app.cloud && app.cloud.state.available && !app.cloud.state.signedIn;
    $('startSignIn').hidden = !signIn;
    $('startDate').textContent = Outputs.longDate(calc.today());
  }

  async function refresh() {
    if (!visible()) return;
    renderTiles();
    renderPrices();
    renderChecks(null);
    renderJobs(null);
    const jobs = app.cloud ? await app.cloud.listJobs() : null;
    if (!visible()) return;
    renderChecks(jobs);
    renderJobs(jobs);
  }

  $('startContinue').addEventListener('click', hide);
  $('startPricebook').addEventListener('click', () => { hide(); app.goto('pricebook'); });
  $('startPostmortems').addEventListener('click', () => { hide(); app.goto('postmortems'); });

  window.SteadfastStart = { refresh, hide };
})();
