/*
 * Steadfast takeoff: the new job wizard. A bar of nine steps above the screens. Each step takes you to
 * the screen where the work is done, says exactly what is still missing, and keeps Next locked until
 * the step is complete. Expert mode (for Bruce) opens every step.
 * What each step needs is in wizard-rules.js, so the tests can check it. Changes no number and nothing
 * in the file format: the wizard's own record (which step, scale checks) stays in this browser.
 */
(function () {
  'use strict';

  const app = window.SteadfastApp;
  const calc = window.SteadfastCalc;
  const Rules = window.SteadfastWizardRules;
  const Templates = window.SteadfastTemplates;
  const Outputs = window.SteadfastOutputs;
  const { el, ask } = window.SteadfastUI;
  const $ = id => document.getElementById(id);
  const STEPS = Rules.STEPS;

  const STATE_KEY = 'steadfast-takeoff.wizard';
  const EXPERT_KEY = 'steadfast-takeoff.expert';

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* the wizard still runs; it just won't survive a reload */ }
  }

  let state = load(STATE_KEY, { active: false });
  let expert = !!load(EXPERT_KEY, false);
  const save = () => store(STATE_KEY, state);
  const missingAt = i => STEPS[i].missing(app.est, state);
  const unlocked = i => expert || STEPS.slice(0, i).every((s, k) => !missingAt(k).length);

  // ---------- Start, move, leave ----------

  async function start() {
    if (app.hasWork() && !Outputs.isSample(app.est)) {
      const unsaved = app.cloud && app.cloud.unsaved();
      const ok = await ask(unsaved ? 'Start a new job? The current job has changes not saved to Monday.com.' : 'Start a new job? Save the current one first if you need it.', 'Start new job');
      if (!ok) return;
    }
    app.loadEstimate(calc.newEstimate(undefined, window.SteadfastLibrary.get()), 'wizard');
    state = { active: true, step: 0, noDrawings: false, drawingsIncomplete: false, noRooms: false, scaleChecks: {}, auto: {} };
    save();
    go(0);
  }

  function go(i) {
    if (i < 0 || i >= STEPS.length || !unlocked(i)) return;
    state.step = i;
    state.active = true;
    save();
    enter(STEPS[i].key);
    render();
  }

  function leave() {
    state.active = false;
    save();
    render();
    app.renderAll();
    app.setStatus('Steps hidden. Help, Resume steps brings them back.', false, 6000);
  }

  // What happens when a step opens: take the person to where the work is.
  function enter(key) {
    if (key === 'details') { app.goto('takeoff'); app.openJobDialog(); }
    else if (key === 'drawings' || key === 'scale') app.goto('takeoff');
    else if (key === 'rooms' || key === 'measure') app.goto(app.est.rooms.length || key === 'rooms' ? 'rooms' : 'takeoff');
    else if (key === 'prices') {
      let priced = 0;
      app.change(e => { priced = Templates.refreshLines(e); });
      if (priced) app.setStatus(priced + (priced === 1 ? ' template line priced' : ' template lines priced') + ' from the price book', false, 6000);
      app.goto('estimate');
    } else if (key === 'profit') { app.goto('estimate'); app.focusKey('[data-key="set-contingencyPct"]'); }
    else if (key === 'final') app.goto('checks');
    else if (key === 'quote') app.goto('estimate');
  }

  // ---------- Scale check against a second dimension ----------

  function checkScale(sheet) {
    app.goto('takeoff');
    if (app.sheetId !== sheet.id) app.showSheet(sheet.id);
    app.scaleCheckHandler = async (s, p, q) => {
      const text = await ask('How long is that dimension on the drawing? For example 12\'-6".', 'Check', true);
      if (!text) return;
      const ft = calc.parseFeet(text);
      const result = ft ? Rules.scaleCheck(s, p, q, ft) : null;
      if (!result) return app.setStatus('Could not read that length', true, 5000);
      state.scaleChecks = state.scaleChecks || {};
      state.scaleChecks[s.id] = result;
      save();
      const pct = Math.abs(result.off * 100).toFixed(1) + '%';
      app.setStatus(result.ok
        ? s.name + ': scale checked. The drawing measures ' + calc.fmtFeetInches(result.measuredFt) + ', within ' + pct + '.'
        : s.name + ': the drawing measures ' + calc.fmtFeetInches(result.measuredFt) + ', ' + pct + ' off. Set the scale again.', !result.ok, 10000);
      app.renderAll();
    };
    app.viewer.setTool('calibrate');
    app.setStatus('Click both ends of a second dimension on ' + sheet.name + ', not the one used for the scale');
  }

  // ---------- Actions for each step ----------

  const act = (text, title, fn, primary) => el('button', { type: 'button', className: 'small' + (primary ? ' primary' : ''), textContent: text, title, onclick: fn });
  const tick = (text, key) => el('label', { className: 'check' },
    el('input', { type: 'checkbox', checked: !!state[key], onchange: e => { state[key] = e.target.checked; save(); app.renderAll(); } }), text);

  function actions(key) {
    const est = app.est;
    const out = [];
    if (key === 'details') out.push(act('Job details', 'Name, client, address, class and bid due', () => app.openJobDialog(), true));
    if (key === 'drawings') {
      out.push(act('Add drawings', 'PDF sets or photos of plans', () => $('drawingInput').click(), true));
      if (!est.sheets.length) out.push(tick('No drawings for this job', 'noDrawings'));
      out.push(tick('Drawings are incomplete', 'drawingsIncomplete'));
    }
    if (key === 'scale') {
      const s = est.sheets.find(x => !calc.hasScale(x)) ||
        est.sheets.find(x => { const c = (state.scaleChecks || {})[x.id]; return !c || !c.ok || c.ftPerUnit !== x.ftPerUnit; });
      if (s) {
        if (!calc.hasScale(s) || ((state.scaleChecks || {})[s.id] && !(state.scaleChecks[s.id].ok))) {
          out.push(act('Set scale on ' + s.name, 'From the title block, then check it', () => { app.goto('takeoff'); if (app.sheetId !== s.id) app.showSheet(s.id); app.openScaleDialog(); }, true));
        }
        if (calc.hasScale(s)) out.push(act('Check a second dimension', 'Click both ends of another dimension on ' + s.name + ' and type its length', () => checkScale(s), true));
      }
    }
    if (key === 'rooms') {
      out.push(act('Add from template', 'Washroom, staff kitchen, basement, bathroom or kitchen', () => { app.goto('rooms'); window.SteadfastRooms.addFromTemplate(app); }, true));
      if (!est.rooms.length) out.push(tick('No rooms on this job', 'noRooms'));
    }
    if (key === 'measure') {
      if (est.rooms.length) out.push(act('Room sizes', 'Type length and width on the Rooms screen', () => app.goto('rooms')));
      if (est.sheets.length) out.push(act('Measure', 'Measure on the drawing', () => app.goto('takeoff')));
      out.push(act('Import from estimator', 'Bring in the Claude estimator\'s file', () => window.SteadfastExchange.actions['import-estimator'](app)));
    }
    if (key === 'prices') {
      out.push(act('Estimate', 'Type the missing costs on the lines', () => app.goto('estimate'), true));
      out.push(act('Price book', 'Import the Monday.com Price book board', () => app.goto('pricebook')));
    }
    if (key === 'profit') {
      out.push(act('Settings', 'Contingency and the commercial floor', () => { app.goto('estimate'); app.focusKey('[data-key="set-contingencyPct"]'); }, true));
      out.push(act('Exclusions', 'What is not included', () => { app.goto('estimate'); app.focusKey('[data-key="list-exclusions"]'); }));
      out.push(act('Risks', 'At least one, with its likely cost', () => app.goto('estimate')));
    }
    if (key === 'final') out.push(act('Before you send', 'Every release check', () => app.goto('checks'), true));
    if (key === 'quote') {
      out.push(act('Customer quote', 'Open the quote, ready to print', () => app.openOutput('quote'), true));
      if (app.cloud && app.cloud.ready()) out.push(act('Save to Monday.com', 'Save the job to the Estimates board', () => app.cloud.save()));
    }
    return out;
  }

  // Steadfast's rules, filled in on every new job and kept up to date as the job details change.
  // A setting Kamal changed himself is his: the rules never fill it again.
  let applying = false;
  function applyRules() {
    if (applying || !state.active) return;
    const changes = Rules.ruleChanges(app.est, state, state.auto);
    if (!Object.keys(changes).length) return;
    applying = true;
    setTimeout(() => {
      app.change(e => { Object.assign(e.settings, changes); });
      state.auto = Object.assign({}, state.auto, changes);
      save();
      applying = false;
    }, 0);
  }

  // What the rules filled in, and anything Kamal changed, shown at the profit step.
  function prefilledNote() {
    const s = app.est.settings;
    const { values, reasons } = Rules.steadfastRules(app.est, state);
    const parts = Object.keys(reasons).map(k => s[k] === values[k] ? reasons[k] : reasons[k].split(',')[0].replace(/[\d.]+%/, s[k] + '%') + ' (changed for this job)');
    if (app.est.job.type === 'residential') parts.push('stages ' + (s.stages || []).map(x => x.pct).join('/'));
    parts.push('GST ' + s.gstPct + '%');
    return 'Steadfast\'s rules: ' + parts.join('; ') + '. Change any of them under Settings on the Estimate screen.';
  }

  // ---------- Bar ----------

  function render() {
    const bar = $('wizard');
    const show = !!state.active && $('welcome').hidden;
    if (state.active) applyRules();
    bar.hidden = !show;
    document.body.classList.toggle('has-wizard', show);
    if (!show) return;
    const i = Math.min(state.step || 0, STEPS.length - 1);
    const step = STEPS[i];
    const missing = missingAt(i);

    const list = $('wizSteps');
    list.innerHTML = '';
    STEPS.forEach((s, k) => {
      const done = !missingAt(k).length;
      const open = unlocked(k);
      list.append(el('li', { className: [k === i ? 'current' : '', done ? 'done' : '', open ? '' : 'locked'].join(' ').trim() },
        el('button', { type: 'button', disabled: !open, textContent: (k + 1) + '. ' + s.title,
          title: open ? (done ? 'Done' : 'Still to do') : 'Finish the steps before this one', onclick: () => go(k) })));
    });

    $('wizTitle').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length + ': ' + step.title;
    const ul = $('wizMissing');
    ul.innerHTML = '';
    if (step.key === 'profit') ul.append(el('li', { className: 'note', textContent: prefilledNote() }));
    if (missing.length) {
      ul.append(el('li', { className: 'lead', textContent: 'Still needed:' }));
      for (const m of missing.slice(0, 6)) ul.append(el('li', { className: 'miss', textContent: m }));
      if (missing.length > 6) ul.append(el('li', { className: 'miss', textContent: (missing.length - 6) + ' more' }));
    } else {
      ul.append(el('li', { className: 'ok', textContent: step.key === 'quote' ? 'Ready. An owner approves the price before it goes out.' : 'Done. Go on to the next step.' }));
    }
    const box = $('wizActions');
    box.innerHTML = '';
    box.append(...actions(step.key));

    $('wizExpert').checked = expert;
    $('wizBack').disabled = i === 0;
    const last = i === STEPS.length - 1;
    const locked = missing.length && !expert;
    const next = $('wizNext');
    next.textContent = last ? 'Finish' : 'Next';
    next.disabled = !!locked;
    next.title = locked ? 'Still needed: ' + missing.join('; ') : last ? 'Close the steps' : 'Go to ' + STEPS[i + 1].title;
  }

  $('wizBack').addEventListener('click', () => go((state.step || 0) - 1));
  $('wizNext').addEventListener('click', () => {
    const i = state.step || 0;
    if (i === STEPS.length - 1) { state.active = false; save(); render(); app.renderAll(); app.setStatus('Job set up. The Next step bar takes it from here.', false, 6000); return; }
    go(i + 1);
  });
  $('wizLeave').addEventListener('click', leave);
  $('wizExpert').addEventListener('change', e => { expert = e.target.checked; store(EXPERT_KEY, expert); render(); });

  // A job from a file, Monday.com, the sample or File > New job ends the steps for the old job.
  app.onLoad((est, source) => { if (source !== 'wizard' && state.active) { state = { active: false }; save(); } });
  app.onRender(render);

  const actionsMenu = window.SteadfastExchange.actions;
  actionsMenu.new = start;
  actionsMenu['wizard-resume'] = () => { state.active = true; if (!STEPS[state.step]) state.step = Rules.firstOpen(app.est, state); save(); render(); app.renderAll(); };

  window.SteadfastWizard = { start, go, active: () => !!state.active && $('welcome').hidden, state: () => state, render };
})();
