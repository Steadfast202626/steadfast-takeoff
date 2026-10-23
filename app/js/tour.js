/*
 * Steadfast takeoff: help for someone new. The welcome screen, the guided tour on the sample job,
 * the "Next step" bar, and the Help menu actions. Changes no number and nothing in the file format.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const Guide = window.SteadfastGuide;
  const Outputs = window.SteadfastOutputs;
  const app = window.SteadfastApp;
  const $ = id => document.getElementById(id);

  const WELCOMED_KEY = 'steadfast-takeoff.welcomed';
  const TOUR_KEY = 'steadfast-takeoff.tour';

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* the tour still runs; it just won't survive a reload */ }
  }

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  // ---------- Next step bar ----------

  const query = sel => () => document.querySelector(sel);
  const byText = (sel, text) => () => [...document.querySelectorAll(sel)].find(b => b.textContent.trim() === text);

  function onScreen(screen, selector) {
    app.goto(screen);
    if (selector) app.focusKey(selector);
  }

  const NEXT_ACTIONS = {
    drawings: () => $('drawingInput').click(),
    scale: step => {
      if (app.screen !== 'takeoff') app.goto('takeoff');
      if (step.sheetId !== app.sheetId) app.showSheet(step.sheetId);
      app.openScaleDialog();
    },
    condition: () => { if (app.screen !== 'takeoff') app.goto('takeoff'); app.newCondition(); },
    measure: step => {
      if (app.screen !== 'takeoff') app.goto('takeoff');
      if (step.sheetId && step.sheetId !== app.sheetId) app.showSheet(step.sheetId);
      if (!app.activeCondition() && app.est.conditions[0]) app.conditionId = app.est.conditions[0].id;
      app.viewer.setTool('measure');
      app.renderAll();
    },
    review: () => window.SteadfastChecks.review(app),
    costs: () => onScreen('estimate', query('#screenView input.missing')),
    contingency: () => onScreen('estimate', '[data-key="set-contingencyPct"]'),
    class: () => { app.openJobDialog(); app.focusKey('#jobForm select[name="class"]'); },
    floor: () => onScreen('estimate', '[data-key="set-commercialFloor"]'),
    margin: () => onScreen('estimate', '.sum-pair'),
    exclusions: () => onScreen('estimate', '[data-key="list-exclusions"]'),
    risks: () => onScreen('estimate', byText('#screenView button', 'Add risk')),
    wcb: step => {
      if (step.bidId) window.SteadfastBids.show(step.bidId);
      onScreen('bids', step.bidId ? '[data-key^="bid-' + step.bidId + '-wcb"]' : null);
    },
    stages: () => onScreen('estimate', '[data-key="stage-0"]'),
    cash: () => onScreen('cash', '[data-key="cash-reviewed"]'),
    checks: () => app.goto('checks'),
    quote: () => app.openOutput('quote')
  };

  let current = null;
  function renderNextBar() {
    const bar = $('nextBar');
    current = Guide.nextStep(app.est, { sheetId: app.sheetId });
    $('nextText').textContent = current.text;
    bar.classList.toggle('done', current.key === 'quote');
    bar.hidden = !$('welcome').hidden;
  }

  $('nextBar').addEventListener('click', () => {
    if (!current) return;
    const go = NEXT_ACTIONS[current.key];
    if (go) go(current);
  });

  // ---------- Welcome ----------

  function showWelcome() {
    tour.stop();
    $('welcome').hidden = false;
    $('nextBar').hidden = true;
    $('welcomePractice').focus();
  }

  function hideWelcome() {
    $('welcome').hidden = true;
    store(WELCOMED_KEY, true);
    renderNextBar();
  }

  $('welcomePractice').addEventListener('click', () => { hideWelcome(); startTour(); });
  $('welcomeReal').addEventListener('click', () => {
    hideWelcome();
    if (Outputs.isSample(app.est) || app.hasWork()) app.newJob();
    else app.openJobDialog();
  });
  $('welcomeSample').addEventListener('click', hideWelcome);

  // ---------- Tour ----------

  /*
   * Each step points at the real control and waits until the person has done it.
   * target(): the element to ring. done(start): true once the step is finished. start holds the
   * counts taken when the step began.
   */
  const STEPS = [
    {
      text: 'Set the scale.',
      hint: () => document.querySelector('#scaleDialog[open]') ? 'Pick 1/4" = 1\'-0", then Use preset.' : 'The title block says 1/4" = 1\'-0".',
      target: () => document.querySelector('#scaleDialog[open]') ? $('scaleUsePreset') : $('scaleBtn'),
      done: () => app.est.sheets.length && calc.hasScale(app.est.sheets.find(s => s.id === app.sheetId) || app.est.sheets[0])
    },
    {
      text: 'Pick what you\'re measuring.',
      hint: () => 'Click a line in the list.',
      target: () => app.screen === 'takeoff' ? $('condList') : $('tabs').querySelector('[data-screen="takeoff"]'),
      done: () => !!app.activeCondition()
    },
    {
      text: 'Measure a room or wall.',
      hint: () => {
        const c = app.activeCondition();
        const m = c ? c.measure : 'area';
        if (m === 'area') return 'Click each corner, then the first point again.';
        if (m === 'count') return 'Click each one, then press Enter.';
        return 'Click along it, then double-click.';
      },
      target: () => app.screen === 'takeoff' ? document.querySelector('.canvas-wrap') : $('tabs').querySelector('[data-screen="takeoff"]'),
      done: start => app.est.measurements.length > start.measurements
    },
    {
      text: 'Open the Estimate tab and see the price.',
      hint: () => '',
      target: () => $('tabs').querySelector('[data-screen="estimate"]'),
      done: () => app.screen === 'estimate'
    },
    {
      text: 'Open Before you send and fix one item.',
      hint: () => app.screen === 'checks' ? 'Click the Fix button.' : app.screen === 'cash' ? 'Tick the box at the bottom.' : '',
      target: () => {
        if (app.screen === 'checks') return document.querySelector('#screenView li.fail .fix');
        if (app.screen === 'cash') {
          const box = document.querySelector('[data-key="cash-reviewed"]');
          return box ? box.closest('label') : null;
        }
        return $('tabs').querySelector('[data-screen="checks"]');
      },
      done: start => openChecks() < start.open
    },
    {
      text: 'Print the customer quote.',
      hint: () => app.screen === 'estimate' ? '' : 'It\'s on the Estimate tab.',
      target: () => app.screen === 'estimate'
        ? [...document.querySelectorAll('#screenView .screen-head button')].find(b => b.textContent === 'Customer quote')
        : $('tabs').querySelector('[data-screen="estimate"]'),
      done: start => quotes > start.quotes
    }
  ];

  let quotes = 0;
  app.onOutput(kind => { if (kind === 'quote') quotes++; });

  function openChecks() {
    return calc.openCheckCount(calc.releaseChecks(app.est));
  }

  const tour = {
    step: -1,
    start: null,
    timer: 0,
    frame: 0,

    begin(step) {
      this.step = step;
      this.start = { measurements: app.est.measurements.length, open: openChecks(), quotes };
      store(TOUR_KEY, { step });
      $('tourCard').hidden = false;
      $('tourDone').hidden = true;
      $('tourSkip').hidden = false;
      this.show();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.check(), 250);
      if (!this.frame) this.place();
    },

    check() {
      if (this.step < 0) return;
      if (!Outputs.isSample(app.est)) return this.stop();
      const s = STEPS[this.step];
      if (s.done(this.start)) {
        if (this.step + 1 < STEPS.length) this.begin(this.step + 1);
        else this.finish();
      } else {
        this.show();
      }
    },

    show() {
      const s = STEPS[this.step];
      $('tourCount').textContent = 'Step ' + (this.step + 1) + ' of ' + STEPS.length;
      $('tourText').textContent = s.text;
      const hint = s.hint();
      $('tourHint').textContent = hint;
      $('tourHint').hidden = !hint;
    },

    finish() {
      clearInterval(this.timer);
      this.step = -1;
      store(TOUR_KEY, null);
      $('tourRing').hidden = true;
      $('tourCount').textContent = 'Done';
      $('tourText').textContent = 'You measured, priced, checked and printed.';
      $('tourHint').textContent = 'Start a real job from File, New job.';
      $('tourHint').hidden = false;
      $('tourSkip').hidden = true;
      $('tourDone').hidden = false;
      this.placeCard(null);
    },

    stop() {
      clearInterval(this.timer);
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.step = -1;
      store(TOUR_KEY, null);
      $('tourCard').hidden = true;
      $('tourRing').hidden = true;
    },

    // Keep the ring on the target and the card beside it, every frame while the tour runs.
    place() {
      this.frame = requestAnimationFrame(() => this.place());
      if (this.step < 0) return;
      const target = STEPS[this.step].target();
      const ring = $('tourRing');
      const visible = target && target.getClientRects().length && !document.querySelector('dialog[open]');
      if (!visible) { ring.hidden = true; this.placeCard(null); return; }
      const r = target.getBoundingClientRect();
      ring.hidden = false;
      Object.assign(ring.style, { left: (r.left - 5) + 'px', top: (r.top - 5) + 'px', width: (r.width + 10) + 'px', height: (r.height + 10) + 'px' });
      this.placeCard(r);
    },

    placeCard(r) {
      const card = $('tourCard');
      const w = card.offsetWidth, h = card.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left, top;
      if (!r || r.width > vw * 0.5 || r.height > vh * 0.5) {
        // Big targets such as the drawing: keep the card in the lower left corner of the screen
        left = 24; top = vh - h - 24;
      } else {
        left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), vw - w - 12);
        top = r.bottom + 14 + h < vh ? r.bottom + 14 : Math.max(12, r.top - h - 14);
      }
      card.style.left = left + 'px';
      card.style.top = top + 'px';
    }
  };

  async function startTour() {
    tour.stop();
    const opened = await window.SteadfastSampleJob.open(app, { forTour: true });
    if (opened) tour.begin(0);
  }

  $('tourSkip').addEventListener('click', () => {
    tour.stop();
    app.setStatus('Tour skipped. Replay it from Help.', false, 5000);
  });
  $('tourDone').addEventListener('click', () => tour.stop());

  // ---------- Help menu and start ----------

  const actions = window.SteadfastExchange.actions;
  actions.tour = () => { $('welcome').hidden = true; startTour(); };
  actions.welcome = showWelcome;

  app.onRender(renderNextBar);
  renderNextBar();

  const saved = read(TOUR_KEY);
  if (!read(WELCOMED_KEY)) showWelcome();
  else if (saved && Outputs.isSample(app.est) && STEPS[saved.step]) tour.begin(saved.step);

  window.SteadfastTour = { start: startTour, stop: () => tour.stop(), showWelcome, state: () => ({ step: tour.step }) };
})();
