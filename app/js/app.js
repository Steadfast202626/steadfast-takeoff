/*
 * Steadfast takeoff: the app. Holds the current estimate, undo, saving, the takeoff panels and the
 * screen tabs. The other screens live in screen-*.js and the estimator exchange in exchange.js.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const Model = window.SteadfastCalc;
  const Storage = window.SteadfastStorage;
  const Drawings = window.SteadfastDrawings;
  const Library = window.SteadfastLibrary;
  const Screens = window.SteadfastScreens;

  const $ = id => document.getElementById(id);
  const MEASURE_NAMES = { area: 'Area', length: 'Length', wall: 'Wall', count: 'Count' };
  const UI_KEY = 'steadfast-takeoff.view';
  const UNDO_LIMIT = 100;

  // ---------- State ----------

  const app = {
    est: Model.normalize(Storage.loadJob() || Model.newEstimate(undefined, Library.get())),
    screen: 'takeoff',
    sheetId: null,
    conditionId: null,
    selectedId: null,
    deduct: false,
    showLabels: true,
    undo: [],
    redo: [],

    activeCondition() {
      return app.est.conditions.find(c => c.id === app.conditionId) || null;
    },

    // Every change to the estimate goes through here, so it can be undone and saved.
    change(fn, opts) {
      pushUndo();
      fn(app.est);
      changed(opts);
    },

    // Point dragging: snapshot once at the start, redraw while moving, save at the end.
    beginEdit() { pushUndo(); },
    liveEdit() { renderConditions(); renderSelection(); },
    endEdit() { changed(); },

    select(id) {
      app.selectedId = id;
      const m = app.est.measurements.find(x => x.id === id);
      if (m && m.conditionId !== app.conditionId) app.conditionId = m.conditionId;
      renderConditions();
      renderEditor();
      renderSelection();
      viewer.draw();
    },

    needScale(sheet) {
      setStatus('Set the scale for ' + sheet.name + ' first', true);
      openScaleDialog();
    },

    needCondition() {
      setStatus('Pick what you\'re measuring first', true);
    },

    onToolChange(tool) {
      document.querySelectorAll('[data-tool]').forEach(b => {
        if (b.tagName === 'BUTTON') b.classList.toggle('active', b.dataset.tool === tool);
      });
      if (tool === 'calibrate') setStatus('Click both ends of a known dimension');
      else if (tool === 'measure') measureStatus();
      else setStatus('');
    },

    onCalibrated(sheet, p, q) {
      openCalibrateDialog(sheet, p, q);
    }
  };

  function pushUndo() {
    app.undo.push(JSON.stringify(app.est));
    if (app.undo.length > UNDO_LIMIT) app.undo.shift();
    app.redo = [];
  }

  function restore(text) {
    app.est = JSON.parse(text);
    if (!app.est.measurements.some(m => m.id === app.selectedId)) app.selectedId = null;
    if (!app.est.sheets.some(s => s.id === app.sheetId)) app.sheetId = app.est.sheets[0] ? app.est.sheets[0].id : null;
    if (!app.est.conditions.some(c => c.id === app.conditionId)) app.conditionId = null;
    viewer.setSheet(app.sheetId);
    changed();
  }

  function undo() {
    if (viewer.drafting()) return viewer.removeLast();
    if (!app.undo.length) return;
    app.redo.push(JSON.stringify(app.est));
    restore(app.undo.pop());
  }

  function redo() {
    if (!app.redo.length) return;
    app.undo.push(JSON.stringify(app.est));
    restore(app.redo.pop());
  }

  let saveTimer = 0;
  function changed(opts) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 250);
    renderAll(opts);
  }

  function autosave() {
    const ok = Storage.saveJob(app.est);
    const el = $('saveState');
    el.textContent = ok ? 'Saved in browser ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : 'Browser storage full. Save the estimate file.';
    el.classList.toggle('warn', !ok);
    try { localStorage.setItem(UI_KEY, JSON.stringify({ sheetId: app.sheetId, conditionId: app.conditionId })); } catch (e) { /* view only */ }
  }

  // ---------- Status line ----------

  let statusTimer = 0;
  function setStatus(text, warn, ms) {
    const el = $('status');
    el.textContent = text || '';
    el.classList.toggle('warn', !!warn);
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => setStatus(''), ms);
  }

  function measureStatus() {
    const s = currentSheet();
    const c = app.activeCondition();
    if (!s) return setStatus('');
    if (!calc.hasScale(s)) return setStatus('Set the scale first', true);
    if (!c) return setStatus('Pick what you\'re measuring', true);
    const tips = {
      area: 'Click the corners. Click the first point to close.',
      length: 'Click along the line. Double-click to finish.',
      wall: 'Click along the wall. Double-click to finish.',
      count: 'Click each item. Enter to finish.'
    };
    setStatus((app.deduct ? 'Cut out: ' : '') + c.name + '. ' + tips[c.measure]);
  }

  // ---------- Dialog helpers ----------

  const ask = window.SteadfastUI.ask;

  // ---------- Sheets ----------

  function currentSheet() {
    return app.est.sheets.find(s => s.id === app.sheetId) || null;
  }

  function showSheet(id) {
    app.sheetId = id;
    app.selectedId = null;
    viewer.setSheet(id);
    renderAll();
    autosave();
  }

  function uniqueSheetName(base) {
    const names = new Set(app.est.sheets.map(s => s.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!names.has((base + ' (' + i + ')').toLowerCase())) return base + ' (' + i + ')';
  }

  async function addDrawingFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    let firstNew = null, reattached = 0, added = 0;
    for (const file of files) {
      setStatus('Opening ' + file.name + '…');
      try {
        const data = await file.arrayBuffer();
        const type = file.type || (Drawings.isPdf(file.name) ? 'application/pdf' : '');
        await Drawings.open(file.name, type, data);
        await Storage.putDrawing(file.name, type, data).catch(() => setStatus('Could not keep ' + file.name + ' in this browser', true));
        if (app.est.sheets.some(s => s.file === file.name)) { reattached++; continue; }
        const pages = await Drawings.pages(file.name);
        app.change(est => {
          for (const p of pages) {
            const base = p.suggestedName || file.name.replace(/\.[^.]+$/, '') + (pages.length > 1 ? ' p' + p.page : '');
            const id = Model.nextId(est.sheets, 's');
            est.sheets.push({
              id, name: uniqueSheetName(base), file: file.name, page: p.page, kind: p.kind,
              widthPt: calc.round(p.widthPt, 3), heightPt: calc.round(p.heightPt, 3),
              ftPerUnit: null, scaleLabel: '', scaleSource: ''
            });
            if (!firstNew) firstNew = id;
            added++;
          }
        });
      } catch (e) {
        setStatus('Could not open ' + file.name + ': ' + e.message, true);
        return;
      }
    }
    if (firstNew) showSheet(firstNew);
    else { renderAll(); viewer.draw(); }
    const parts = [];
    if (added) parts.push(added + (added === 1 ? ' sheet added' : ' sheets added'));
    if (reattached) parts.push(reattached + (reattached === 1 ? ' drawing re-attached' : ' drawings re-attached'));
    setStatus(parts.join(', '), false, 5000);
  }

  async function attachStoredDrawings() {
    const names = [...new Set(app.est.sheets.map(s => s.file))];
    for (const name of names) {
      if (Drawings.isAttached(name)) continue;
      const rec = await Storage.getDrawing(name);
      if (!rec) continue;
      try { await Drawings.open(rec.name, rec.type, rec.data); } catch (e) { /* listed as missing */ }
    }
    renderSheets();
    viewer.draw();
  }

  async function removeSheet(sheet) {
    const n = app.est.measurements.filter(m => m.sheetId === sheet.id).length;
    const ok = await ask('Remove sheet ' + sheet.name + (n ? ' and its ' + n + (n === 1 ? ' markup' : ' markups') : '') + '?', 'Remove');
    if (!ok) return;
    app.change(est => {
      est.sheets = est.sheets.filter(s => s.id !== sheet.id);
      est.measurements = est.measurements.filter(m => m.sheetId !== sheet.id);
    });
    if (app.sheetId === sheet.id) showSheet(app.est.sheets[0] ? app.est.sheets[0].id : null);
  }

  function renderSheets() {
    const list = $('sheetList');
    list.innerHTML = '';
    for (const s of app.est.sheets) {
      const li = document.createElement('li');
      li.classList.toggle('current', s.id === app.sheetId);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.name;
      name.title = 'Double-click to rename';
      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.type = 'button';
      remove.title = 'Remove sheet';
      remove.textContent = '×';
      const sub = document.createElement('span');
      const marks = app.est.measurements.filter(m => m.sheetId === s.id).length;
      const attached = Drawings.isAttached(s.file);
      sub.className = 'sub' + (!calc.hasScale(s) || !attached ? ' warn' : '');
      sub.textContent = [calc.hasScale(s) ? s.scaleLabel || 'Scaled' : 'No scale', marks ? marks + ' marks' : '', attached ? '' : 'not attached']
        .filter(Boolean).join(' · ');
      sub.title = s.file + (s.kind === 'pdf' ? ', page ' + s.page : '');
      li.append(name, remove, sub);
      li.addEventListener('click', e => { if (e.target !== remove && s.id !== app.sheetId) showSheet(s.id); });
      remove.addEventListener('click', () => removeSheet(s));
      name.addEventListener('dblclick', () => renameSheet(s, name));
      list.appendChild(li);
    }

    const missing = [...new Set(app.est.sheets.map(s => s.file))].filter(f => !Drawings.isAttached(f));
    const box = $('missingFiles');
    box.hidden = !missing.length;
    box.innerHTML = '';
    if (missing.length) {
      const p = document.createElement('div');
      p.textContent = 'Re-attach drawings:';
      const ul = document.createElement('ul');
      for (const f of missing) {
        const li = document.createElement('li');
        li.textContent = f;
        ul.appendChild(li);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'small';
      b.title = 'Open the same files again to re-attach them';
      b.dataset.action = 'drawings';
      b.textContent = 'Add drawings';
      box.append(p, ul, b);
    }
    $('emptyState').hidden = app.est.sheets.length > 0;
  }

  function renameSheet(s, el) {
    const input = document.createElement('input');
    input.value = s.name;
    el.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== s.name) app.change(() => { s.name = v; });
      else renderSheets();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  function renderSheetTitle() {
    const s = currentSheet();
    const el = $('sheetTitle');
    el.innerHTML = '';
    if (!s) return;
    el.textContent = s.name;
    const sc = document.createElement('span');
    sc.className = 'scale' + (calc.hasScale(s) ? '' : ' warn');
    sc.textContent = calc.hasScale(s) ? s.scaleLabel : 'No scale';
    el.appendChild(sc);
  }

  // ---------- Scale ----------

  function sameSize(a, b) {
    return a.kind === b.kind && Math.abs(a.widthPt - b.widthPt) < 1 && Math.abs(a.heightPt - b.heightPt) < 1;
  }

  function applyScale(sheet, ftPerUnit, label, source, all) {
    app.change(est => {
      for (const s of est.sheets) {
        if (s.id === sheet.id || (all && sameSize(s, sheet))) {
          s.ftPerUnit = ftPerUnit;
          s.scaleLabel = label;
          s.scaleSource = source;
        }
      }
    });
    const n = all ? app.est.sheets.filter(s => sameSize(s, sheet)).length : 1;
    setStatus('Scale set' + (n > 1 ? ' on ' + n + ' sheets' : '') + ': ' + label, false, 5000);
  }

  function openScaleDialog() {
    const s = currentSheet();
    if (!s) return;
    const d = $('scaleDialog');
    $('scaleTitle').textContent = 'Scale for ' + s.name;
    $('scaleCurrent').textContent = calc.hasScale(s) ? 'Now: ' + s.scaleLabel : 'No scale yet';
    const isPdf = s.kind === 'pdf';
    $('presetField').hidden = !isPdf;
    $('scaleUsePreset').hidden = !isPdf;
    const sel = $('scalePreset');
    if (!sel.options.length) {
      const groups = { architectural: 'Architectural', engineering: 'Engineering', metric: 'Metric' };
      for (const kind of Object.keys(groups)) {
        const g = document.createElement('optgroup');
        g.label = groups[kind];
        calc.presetList().filter(p => p.kind === kind).forEach(p => {
          const o = document.createElement('option');
          o.value = kind + '|' + p.value;
          o.textContent = p.label;
          g.appendChild(o);
        });
        sel.appendChild(g);
      }
      sel.value = 'architectural|0.25';
    }
    const others = app.est.sheets.filter(x => x.id !== s.id && sameSize(x, s)).length;
    $('scaleAllField').hidden = !others;
    $('scaleAll').checked = others > 0;
    d.returnValue = '';
    d.showModal();
  }

  $('scaleDialog').addEventListener('close', () => {
    const d = $('scaleDialog');
    const s = currentSheet();
    if (d.returnValue !== 'preset' || !s) return;
    const [kind, value] = $('scalePreset').value.split('|');
    const preset = calc.presetList().find(p => p.kind === kind && String(p.value) === value);
    applyScale(s, preset.ftPerUnit, preset.label, 'preset', $('scaleAll').checked);
  });

  $('scaleFromDim').addEventListener('click', () => {
    $('scaleDialog').close('dimension');
    viewer.setTool('calibrate');
  });

  let calibPending = null;
  function openCalibrateDialog(sheet, p, q) {
    calibPending = { sheet, p, q };
    const others = app.est.sheets.filter(x => x.id !== sheet.id && sameSize(x, sheet)).length;
    $('calibAll').parentElement.hidden = !others;
    $('calibAll').checked = others > 0;
    $('calibLength').value = '';
    $('calibNote').textContent = 'Feet and inches, like 20\'-6", or metres, like 6.25 m';
    const d = $('calibrateDialog');
    d.returnValue = '';
    d.showModal();
  }

  $('calibrateDialog').addEventListener('close', () => {
    const d = $('calibrateDialog');
    const pending = calibPending;
    calibPending = null;
    viewer.setTool('select');
    if (d.returnValue !== 'ok' || !pending) return;
    const ft = calc.parseFeet($('calibLength').value);
    if (!ft) return setStatus('Could not read that length', true, 5000);
    const fpu = calc.calibrateFtPerUnit(pending.p, pending.q, pending.sheet, ft);
    if (!fpu) return setStatus('The two points are the same', true, 5000);
    // Name the matching preset if the calibration lands within 1% of one
    let label = 'From ' + calc.fmtFeetInches(ft) + ' dimension';
    if (pending.sheet.kind === 'pdf') {
      const near = calc.presetList().find(x => Math.abs(x.ftPerUnit - fpu) / x.ftPerUnit < 0.01);
      if (near) label += ' (' + near.label + ')';
    }
    applyScale(pending.sheet, fpu, label, 'calibrated', $('calibAll').checked);
  });

  $('calibLength').addEventListener('input', () => {
    const ft = calc.parseFeet($('calibLength').value);
    $('calibNote').textContent = ft ? '= ' + calc.fmtFeetInches(ft) : 'Feet and inches, like 20\'-6", or metres, like 6.25 m';
  });

  // ---------- Conditions ----------

  function measureUnit(c) {
    return calc.MAIN_UNIT[c.measure];
  }

  function qtyText(c, totals) {
    if (c.measure === 'wall' && totals.sf !== null) return calc.fmtQty(totals.sf, 'sf');
    const { qty, unit } = calc.mainQty(c, totals);
    if (qty === null) return '—';
    return c.measure === 'count' ? Math.round(qty) + ' ea' : calc.fmtQty(qty, unit);
  }

  function renderConditions() {
    const list = $('condList');
    list.innerHTML = '';
    $('condHead').hidden = !app.est.conditions.length;
    if (!app.est.conditions.length) {
      const li = document.createElement('li');
      li.className = 'cond-empty';
      li.style.display = 'block';
      li.textContent = 'Nothing yet. Click New.';
      list.appendChild(li);
      return;
    }
    for (const c of app.est.conditions) {
      const job = calc.conditionTotals(app.est, c.id);
      const here = app.sheetId ? calc.conditionTotals(app.est, c.id, app.sheetId) : { lf: null, sf: null, ea: null };
      const li = document.createElement('li');
      li.classList.toggle('active', c.id === app.conditionId);
      li.classList.toggle('hidden-cond', !!c.hidden);
      const name = document.createElement('span');
      name.className = 'cname';
      name.innerHTML = '<span class="swatch"></span><span class="t"></span><span class="kind"></span>';
      name.querySelector('.swatch').style.background = c.color;
      name.querySelector('.t').textContent = c.name;
      name.querySelector('.kind').textContent = MEASURE_NAMES[c.measure];
      name.title = c.name;
      const qs = document.createElement('span');
      qs.className = 'qty';
      qs.textContent = here.count ? qtyText(c, here) : '';
      const qj = document.createElement('span');
      qj.className = 'qty' + (job.unscaled || job.flagged ? ' warn' : '');
      qj.textContent = job.count ? qtyText(c, job) : '';
      if (job.unscaled) qj.title = job.unscaled + ' on sheets with no scale';
      else if (job.flagged) qj.title = job.flagged + ' stated quantities differ from the tracing by more than 10%';
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'eye';
      eye.textContent = c.hidden ? 'Show' : 'Hide';
      eye.title = c.hidden ? 'Show on drawings' : 'Hide on drawings';
      eye.style.fontSize = '11px';
      li.append(name, qs, qj, eye);
      li.addEventListener('click', e => {
        if (e.target === eye) return;
        app.conditionId = c.id;
        app.selectedId = null;
        if (currentSheet()) viewer.setTool('measure');
        renderAll();
      });
      eye.addEventListener('click', () => app.change(() => { c.hidden = !c.hidden; }));
      list.appendChild(li);
    }
  }

  function nextColour() {
    const used = new Set(app.est.conditions.map(c => c.color));
    return Model.COLOURS.find(c => !used.has(c)) || Model.COLOURS[app.est.conditions.length % Model.COLOURS.length];
  }

  function newCondition() {
    const last = app.activeCondition();
    app.change(est => {
      const id = Model.nextId(est.conditions, 'c');
      const measure = last ? last.measure : 'area';
      est.conditions.push({
        id, name: 'Item ' + id.slice(1), measure, color: nextColour(),
        heightFt: measure === 'wall' ? est.settings.defaultHeightFt : null,
        assemblyId: null, unitCost: null, type: 'S',
        division: last ? last.division : '', location: last ? last.location : '',
        alternateId: null, hidden: false
      });
      app.conditionId = id;
      app.selectedId = null;
    });
    const nameInput = $('condEditor').querySelector('[name="name"]');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
  }

  function option(value, text, selected) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    if (selected) o.selected = true;
    return o;
  }

  function field(label, input, wide) {
    const l = document.createElement('label');
    l.className = 'field' + (wide ? ' wide' : '');
    l.append(label, input);
    return l;
  }

  function el(tag, attrs) {
    const e = document.createElement(tag);
    Object.assign(e, attrs || {});
    return e;
  }

  // Edits from the form do not re-render the form, so focus stays where it is.
  function editCondition(c, fn) {
    app.change(() => fn(c), { keepEditor: true });
  }

  function numOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function renderEditor() {
    const form = $('condEditor');
    const c = app.activeCondition();
    form.hidden = !c;
    form.innerHTML = '';
    if (!c) return;
    const hasMarks = app.est.measurements.some(m => m.conditionId === c.id);

    form.appendChild(el('h2', { textContent: 'Details', title: 'The chosen condition' }));

    const name = el('input', { name: 'name', value: c.name, required: true });
    name.addEventListener('change', () => { if (name.value.trim()) editCondition(c, x => { x.name = name.value.trim(); }); });
    form.appendChild(field('Name', name, true));

    const measure = el('select', { name: 'measure', disabled: hasMarks, title: hasMarks ? 'Has markups' : '' });
    Model.MEASURES.forEach(m => measure.appendChild(option(m, MEASURE_NAMES[m], m === c.measure)));
    measure.addEventListener('change', () => app.change(est => {
      c.measure = measure.value;
      if (c.measure === 'wall' && c.heightFt === null) c.heightFt = est.settings.defaultHeightFt;
    }));
    form.appendChild(field('Measure', measure));

    const color = el('input', { type: 'color', name: 'color', value: c.color });
    color.addEventListener('input', () => { c.color = color.value; viewer.draw(); });
    color.addEventListener('change', () => {
      const v = color.value;
      app.change(() => { c.color = v; }, { keepEditor: true });
    });
    form.appendChild(field('Colour', color));

    if (c.measure === 'wall' || c.measure === 'length') {
      const h = el('input', { type: 'number', name: 'heightFt', min: 0, step: 'any', value: c.heightFt ?? '', required: c.measure === 'wall' });
      h.addEventListener('change', () => editCondition(c, x => { x.heightFt = numOrNull(h.value); }));
      form.appendChild(field(c.measure === 'wall' ? 'Wall height (ft)' : 'Height (ft)', h));
      if (c.measure === 'wall' && !calc.conditionHeight(c)) {
        form.appendChild(el('p', { className: 'note warn', textContent: 'No height, so no wall area' }));
      }
    }

    const pricing = el('select', { name: 'assemblyId' });
    pricing.appendChild(option('', 'Unit price', !c.assemblyId));
    app.est.assemblies.forEach(a => pricing.appendChild(option(a.id, a.name, a.id === c.assemblyId)));
    pricing.addEventListener('change', () => app.change(() => { c.assemblyId = pricing.value || null; }));
    form.appendChild(field('Priced by', pricing, true));

    if (!c.assemblyId) {
      const cost = el('input', { type: 'number', name: 'unitCost', min: 0, step: 'any', value: c.unitCost ?? '', placeholder: 'No cost yet' });
      cost.addEventListener('change', () => editCondition(c, x => { x.unitCost = numOrNull(cost.value); }));
      form.appendChild(field('Cost per ' + measureUnit(c), cost));
      const type = el('select', { name: 'type' });
      [['M', 'Material'], ['L', 'Labour'], ['S', 'Subcontract'], ['E', 'Equipment']]
        .forEach(([v, t]) => type.appendChild(option(v, t, v === c.type)));
      type.addEventListener('change', () => editCondition(c, x => { x.type = type.value; }));
      form.appendChild(field('Cost type', type));
    }

    const div = el('select', { name: 'division' });
    div.appendChild(option('', 'Not set', !c.division));
    Model.DIVISIONS.forEach(([code, n]) => div.appendChild(option(code, code + ' ' + n, code === c.division)));
    div.addEventListener('change', () => editCondition(c, x => { x.division = div.value; }));
    form.appendChild(field('CSI division', div, true));

    const loc = el('input', { name: 'location', value: c.location || '' });
    loc.setAttribute('list', 'locationList');
    const dl = el('datalist', { id: 'locationList' });
    [...new Set(app.est.conditions.map(x => x.location).filter(Boolean))].forEach(l => dl.appendChild(option(l, l)));
    loc.addEventListener('change', () => editCondition(c, x => { x.location = loc.value.trim(); }));
    form.append(field('Location', loc), dl);

    const bid = el('select', { name: 'alternateId' });
    bid.appendChild(option('', 'Base bid', !c.alternateId));
    app.est.alternates.forEach(a => bid.appendChild(option(a.id, a.name, a.id === c.alternateId)));
    bid.appendChild(option('__new', 'New alternate…'));
    bid.addEventListener('change', async () => {
      if (bid.value !== '__new') return app.change(() => { c.alternateId = bid.value || null; });
      const n = await ask('Name for the new alternate', 'Add', true, 'Alternate ' + (app.est.alternates.length + 1));
      if (!n) return renderEditor();
      app.change(est => {
        const id = Model.nextId(est.alternates, 'alt');
        est.alternates.push({ id, name: n, description: '', sign: 'add' });
        c.alternateId = id;
      });
    });
    form.appendChild(field('Bid', bid));

    const job = calc.conditionTotals(app.est, c.id);
    const parts = [];
    if (job.lf !== null) parts.push(calc.fmtQty(job.lf, 'lf'));
    if (job.sf !== null) parts.push(calc.fmtQty(job.sf, 'sf'));
    if (job.ea !== null) parts.push(Math.round(job.ea) + ' ea');
    form.appendChild(el('p', { className: 'note', textContent: 'Job: ' + (parts.join(' · ') || 'nothing measured') + (job.count ? ' (' + job.count + (job.count === 1 ? ' markup)' : ' markups)') : '') }));
    if (job.unscaled) form.appendChild(el('p', { className: 'note warn', textContent: job.unscaled + ' on sheets with no scale, not counted' }));
    if (job.flagged) form.appendChild(el('p', { className: 'note warn', textContent: job.flagged + ' stated differs from traced by over 10%' }));

    const row = el('div', { className: 'row-buttons' });
    const del = el('button', { type: 'button', className: 'danger small', textContent: 'Delete', title: 'Delete this condition and its markups' });
    del.addEventListener('click', async () => {
      const n = app.est.measurements.filter(m => m.conditionId === c.id).length;
      const ok = await ask('Delete ' + c.name + (n ? ' and its ' + n + (n === 1 ? ' markup' : ' markups') : '') + '?', 'Delete');
      if (!ok) return;
      app.change(est => {
        est.conditions = est.conditions.filter(x => x.id !== c.id);
        est.measurements = est.measurements.filter(m => m.conditionId !== c.id);
        app.conditionId = null;
        app.selectedId = null;
      });
      viewer.setTool('select');
    });
    row.appendChild(del);
    form.appendChild(row);
  }

  $('condEditor').addEventListener('submit', e => e.preventDefault());

  // ---------- Selected markup ----------

  function renderSelection() {
    const box = $('selection');
    const m = app.est.measurements.find(x => x.id === app.selectedId);
    box.hidden = !m;
    box.innerHTML = '';
    if (!m) return;
    const c = app.est.conditions.find(x => x.id === m.conditionId);
    const s = app.est.sheets.find(x => x.id === m.sheetId);
    const q = calc.measurementQty(m, s, c);
    box.appendChild(el('h2', { textContent: 'Markup' }));

    const parts = [];
    if (c.measure === 'count') parts.push(Math.round(q.ea) + ' ea');
    else {
      if (q.lf !== null) parts.push(calc.fmtQty(q.lf, 'lf'));
      if (q.sf !== null) parts.push(calc.fmtQty(q.sf, 'sf'));
    }
    box.appendChild(el('div', { className: 'qty-big', textContent: parts.join(' · ') || '—' }));
    if (q.stated !== null) {
      box.appendChild(el('p', { className: 'note' + (q.flagged ? ' warn' : ''), textContent: 'Traced ' + calc.fmtQty(q.traced, q.mainUnit) + (q.flagged ? '. Differs by more than 10%.' : '') }));
    }
    if (m.status === 'check') {
      box.appendChild(el('p', { className: 'note warn', textContent: 'Estimator item, waiting for check' + (m.basis ? '. ' + m.basis : '') +
        (m.confidence ? ' (' + m.confidence + ' confidence)' : '') }));
      const onSheet = app.est.measurements.filter(x => x.sheetId === m.sheetId && x.status === 'check').length;
      const acc = el('div', { className: 'row-buttons' });
      const one = el('button', { type: 'button', className: 'primary small', textContent: 'Accept', title: 'Accept this estimator markup' });
      one.addEventListener('click', () => {
        app.change(() => { m.status = 'ok'; });
        setStatus('Accepted', false, 3000);
      });
      const all = el('button', { type: 'button', className: 'small', textContent: 'Accept all on sheet (' + onSheet + ')', title: 'Accept every estimator markup on this sheet' });
      all.addEventListener('click', async () => {
        if (!await ask('Accept all ' + onSheet + ' estimator markups on ' + (s ? s.name : 'this sheet') + '? Check them on the drawing first.', 'Accept all')) return;
        app.change(est => calc.acceptItems(est, (kind, item) => kind === 'measurements' && item.sheetId === m.sheetId));
        setStatus(onSheet + ' markups accepted', false, 4000);
      });
      acc.append(one, all);
      box.appendChild(acc);
    }

    const note = el('input', { value: m.note || '', placeholder: 'Room or detail' });
    note.addEventListener('change', () => app.change(() => { m.note = note.value.trim(); }, { keepSelection: true }));
    box.appendChild(field('Note', note, true));

    const stated = el('input', { type: 'number', step: 'any', value: m.statedQty ?? '', placeholder: 'From drawing' });
    stated.addEventListener('change', () => app.change(() => { m.statedQty = numOrNull(stated.value); }));
    box.appendChild(field('Stated ' + q.mainUnit, stated));

    const ded = el('label', { className: 'check' });
    const cb = el('input', { type: 'checkbox', checked: !!m.deduct });
    cb.addEventListener('change', () => app.change(() => { m.deduct = cb.checked; }));
    ded.title = 'Deduct: this markup subtracts';
    ded.append(cb, 'Cut out');
    box.appendChild(ded);

    const row = el('div', { className: 'row-buttons' });
    row.appendChild(el('span', { className: 'muted', textContent: s ? s.name : '' }));
    if (c.measure === 'area') {
      const linked = app.est.rooms.find(r => r.measurementId === m.id);
      const mk = el('button', { type: 'button', className: 'small', textContent: linked ? 'Room: ' + linked.name : 'Make room',
        title: linked ? 'Open the Rooms screen' : 'Make a room from this area' });
      mk.addEventListener('click', () => {
        if (linked) return app.goto('rooms');
        app.change(est => {
          est.rooms.push(window.SteadfastRooms.newRoom(est, {
            name: m.note || 'Room ' + (est.rooms.length + 1), location: c.location || '', measurementId: m.id,
            heightFt: null, alternateId: c.alternateId || null
          }));
        });
        setStatus('Room added. Set its finishes on the Rooms screen.', false, 5000);
      });
      row.appendChild(mk);
    }
    const del = el('button', { type: 'button', className: 'danger small', textContent: 'Delete markup', title: 'Delete this markup (Undo brings it back)' });
    del.addEventListener('click', deleteSelected);
    row.appendChild(del);
    box.appendChild(row);
  }

  function deleteSelected() {
    const id = app.selectedId;
    if (!id) return;
    app.change(est => { est.measurements = est.measurements.filter(m => m.id !== id); });
    app.selectedId = null;
    renderAll();
    setStatus('Markup deleted. Undo brings it back.', false, 4000);
  }

  // ---------- Job ----------

  function renderTop() {
    $('jobName').textContent = app.est.job.name || 'New job';
    document.title = (app.est.job.name ? app.est.job.name + ' · ' : '') + 'Steadfast takeoff';
    $('undoBtn').disabled = !app.undo.length;
    $('redoBtn').disabled = !app.redo.length;
    $('deductBtn').setAttribute('aria-pressed', String(app.deduct));
    $('labelsBtn').setAttribute('aria-pressed', String(app.showLabels));
    const hasSheet = !!currentSheet();
    ['scaleBtn', 'zoomIn', 'zoomOut', 'zoomFit'].forEach(id => { $(id).disabled = !hasSheet; });
    document.querySelectorAll('button[data-tool]').forEach(b => { b.disabled = !hasSheet; });
  }

  function openJobDialog() {
    const f = $('jobForm');
    for (const k of Object.keys(app.est.job)) if (f.elements[k]) f.elements[k].value = app.est.job[k] ?? '';
    $('jobDialog').returnValue = '';
    $('jobDialog').showModal();
  }

  $('jobDialog').addEventListener('close', () => {
    if ($('jobDialog').returnValue !== 'ok') return;
    const f = $('jobForm');
    app.change(est => {
      for (const k of Object.keys(est.job)) {
        if (!f.elements[k]) continue;
        est.job[k] = k === 'validDays' ? (numOrNull(f.elements[k].value) ?? 0) : f.elements[k].value.trim();
      }
    });
  });

  function hasWork() {
    const e = app.est;
    return e.sheets.length || e.conditions.length || e.measurements.length || e.lines.length || e.rooms.length;
  }

  async function newJob() {
    if (hasWork()) {
      const ok = await ask('Start a new job? The current job is only kept in this browser. Save the estimate file first if you need it.', 'Start new job');
      if (!ok) return;
    }
    loadEstimate(Model.newEstimate(undefined, Library.get()));
    openJobDialog();
  }

  function loadEstimate(est) {
    app.est = Model.normalize(est);
    app.undo = [];
    app.redo = [];
    app.selectedId = null;
    app.conditionId = null;
    app.sheetId = app.est.sheets[0] ? app.est.sheets[0].id : null;
    viewer.setTool('select');
    viewer.state.sheetId = null;
    viewer.setSheet(app.sheetId);
    changed();
    attachStoredDrawings();
  }

  async function openEstimateFile(file) {
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch (e) {
      return setStatus('That file is not readable JSON', true, 6000);
    }
    const problems = Model.openProblems(obj);
    if (problems.length) return setStatus(problems[0], true, 8000);
    if (hasWork()) {
      const ok = await ask('Open ' + file.name + '? It replaces the job in this browser. Save the current estimate first if you need it.', 'Open');
      if (!ok) return;
    }
    loadEstimate(obj);
    setStatus('Opened ' + file.name, false, 5000);
  }

  async function saveEstimate() {
    const name = Model.estimateFileName(app.est);
    const saved = await Storage.saveTextFile(name, JSON.stringify(app.est, null, 2));
    if (saved) setStatus('Saved ' + saved, false, 6000);
  }

  // ---------- Rendering ----------

  // ---------- Screens ----------

  function renderTabs() {
    document.querySelectorAll('#tabs [data-screen]').forEach(b => {
      b.classList.toggle('active', b.dataset.screen === app.screen);
      b.setAttribute('aria-selected', String(b.dataset.screen === app.screen));
    });
    $('takeoffView').hidden = app.screen !== 'takeoff';
    $('screenView').hidden = app.screen === 'takeoff';
    const checks = calc.releaseChecks(app.est);
    const open = calc.openCheckCount(checks);
    const badge = $('checksBadge');
    badge.textContent = open ? open + ' to fix' : 'Ready to send';
    badge.classList.toggle('warn', !!open);
    badge.title = open ? 'Checks: ' + checks.filter(c => c.status === 'fail').map(c => c.label).join('; ') : 'Every release check passes';
    const tab = document.querySelector('#tabs [data-screen="checks"]');
    tab.textContent = open ? 'Before you send (' + open + ')' : 'Before you send';
    tab.classList.toggle('has-open', !!open);
    document.querySelector('#tabs [data-screen="cash"]').hidden = app.est.job.type !== 'commercial' && app.screen !== 'cash';
    $('sampleBand').hidden = !window.SteadfastOutputs.isSample(app.est);
  }

  let screenFrame = 0;
  // Screens redraw on the next frame and keep the focused field, so Tab moves on as expected.
  function renderScreen() {
    if (app.screen === 'takeoff' || screenFrame) return;
    screenFrame = requestAnimationFrame(() => {
      screenFrame = 0;
      const root = $('screenView');
      const active = document.activeElement;
      const key = active && active.dataset ? active.dataset.key : null;
      const sel = key && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
      const scroll = root.scrollTop;
      root.innerHTML = '';
      const screen = Screens[app.screen];
      if (screen) screen.render(root, app);
      root.scrollTop = scroll;
      afterRender();
      if (key) {
        const again = root.querySelector('[data-key="' + CSS.escape(key) + '"]');
        if (again) {
          again.focus();
          if (sel && typeof again.setSelectionRange === 'function') try { again.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ }
        }
      }
    });
  }

  function goto(screen) {
    if (screen !== 'takeoff' && viewer.drafting()) viewer.cancel();
    app.screen = screen;
    $('screenView').scrollTop = 0;
    renderAll();
    if (screen === 'takeoff') viewer.fit();
  }

  function showCondition(conditionId) {
    app.conditionId = conditionId;
    const m = app.est.measurements.find(x => x.conditionId === conditionId && x.status === 'check') ||
      app.est.measurements.find(x => x.conditionId === conditionId);
    if (m && m.sheetId !== app.sheetId) { app.sheetId = m.sheetId; viewer.setSheet(m.sheetId); }
    app.selectedId = m ? m.id : null;
    viewer.setTool('select');
    goto('takeoff');
  }

  function logoUrl() {
    const img = document.querySelector('.topbar .logo');
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    } catch (e) {
      return new URL('assets/steadfast-logo-dark-on-light.png', location.href).href;
    }
  }

  const outputHooks = [];
  function openOutput(kind, id) {
    const Outputs = window.SteadfastOutputs;
    const opts = { logoUrl: logoUrl(), showQty: !!app.showQuoteQty };
    const html = kind === 'quote' ? Outputs.quoteHtml(app.est, opts)
      : kind === 'scope' ? Outputs.scopeLetterHtml(app.est, id, opts)
        : Outputs.internalHtml(app.est, opts);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    for (const fn of outputHooks) fn(kind);
    const w = window.open(url, '_blank');
    if (!w) setStatus('The browser blocked the new tab. Allow pop-ups for this site.', true, 8000);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const renderHooks = [];
  function afterRender() { for (const fn of renderHooks) fn(app); }

  // Show a field on the current screen once it has drawn: scroll to it, focus it and flash it.
  function focusKey(selector) {
    let tries = 0;
    const find = () => {
      const target = typeof selector === 'function' ? selector() : document.querySelector(selector);
      if (!target) { if (++tries < 20) requestAnimationFrame(find); return; }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (typeof target.focus === 'function') target.focus({ preventScroll: true });
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
    };
    requestAnimationFrame(find);
  }

  function renderAll(opts) {
    opts = opts || {};
    renderTop();
    renderTabs();
    if (app.screen !== 'takeoff') { renderScreen(); return; }
    renderSheets();
    renderSheetTitle();
    renderConditions();
    if (!opts.keepEditor) renderEditor();
    if (!opts.keepSelection) renderSelection();
    if (viewer.state.tool === 'measure') measureStatus();
    viewer.draw();
    afterRender();
  }

  // ---------- Wiring ----------

  const viewer = window.createViewer($('canvas'), $('readout'), app);

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    const ownButton = e.target.closest('.menu-button');
    closeMenu(ownButton ? ownButton.parentElement : null);
    if (!t) return;
    const action = t.dataset.action;
    if (action === 'drawings') $('drawingInput').click();
    else if (action === 'open') $('estimateInput').click();
    else if (action === 'save') saveEstimate();
    else if (action === 'new') newJob();
    else if (action === 'job') openJobDialog();
    else if (action === 'quote') openOutput('quote');
    else if (action === 'internal') openOutput('internal');
    else if (window.SteadfastExchange && window.SteadfastExchange.actions[action]) window.SteadfastExchange.actions[action](app);
  });

  document.querySelectorAll('#tabs [data-screen]').forEach(b => b.addEventListener('click', () => goto(b.dataset.screen)));
  $('checksBadge').addEventListener('click', () => goto('checks'));

  // Close every menu except the one given.
  function closeMenu(keep) {
    document.querySelectorAll('.menu').forEach(m => {
      if (m === keep) return;
      m.querySelector('.menu-list').hidden = true;
      m.querySelector('.menu-button').setAttribute('aria-expanded', 'false');
    });
  }

  document.querySelectorAll('.menu .menu-button').forEach(btn => btn.addEventListener('click', e => {
    const list = btn.parentElement.querySelector('.menu-list');
    list.hidden = !list.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!list.hidden));
  }));

  $('drawingInput').addEventListener('change', e => {
    addDrawingFiles(e.target.files);
    e.target.value = '';
  });
  $('estimateInput').addEventListener('change', e => {
    if (e.target.files[0]) openEstimateFile(e.target.files[0]);
    e.target.value = '';
  });

  // Drop drawings or an estimate file anywhere
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const files = [...(e.dataTransfer.files || [])];
    const est = files.find(f => /\.json$/i.test(f.name));
    if (est) return openEstimateFile(est);
    addDrawingFiles(files.filter(f => Drawings.isPdf(f.name, f.type) || /^image\//.test(f.type)));
  });

  $('jobName').addEventListener('click', openJobDialog);
  $('newCondition').addEventListener('click', newCondition);
  $('scaleBtn').addEventListener('click', openScaleDialog);
  $('zoomIn').addEventListener('click', () => viewer.zoomAt(1.25));
  $('zoomOut').addEventListener('click', () => viewer.zoomAt(0.8));
  $('zoomFit').addEventListener('click', () => viewer.fit());
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('deductBtn').addEventListener('click', () => {
    app.deduct = !app.deduct;
    if (viewer.state.draft) viewer.state.draft.deduct = app.deduct;
    renderTop();
    if (viewer.state.tool === 'measure') measureStatus();
  });
  $('labelsBtn').addEventListener('click', () => {
    app.showLabels = !app.showLabels;
    renderTop();
    viewer.draw();
  });
  document.querySelectorAll('button[data-tool]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tool === 'measure' && !app.activeCondition()) {
      if (!app.est.conditions.length) newCondition();
      else app.needCondition();
    }
    viewer.setTool(b.dataset.tool);
  }));

  function typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Shift') viewer.setShift(true);
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveEstimate(); return; }
    if (typing(e)) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') closeMenu();
    if (app.screen !== 'takeoff') return;
    if (e.key === 'Enter') { viewer.finish(); return; }
    if (e.key === 'Escape') {
      closeMenu();
      if (viewer.drafting()) viewer.cancel();
      else { viewer.setTool('select'); app.select(null); }
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (!viewer.removeLast()) deleteSelected();
      return;
    }
    if (e.key === 'Delete') deleteSelected();
  });
  document.addEventListener('keyup', e => { if (e.key === 'Shift') viewer.setShift(false); });
  window.addEventListener('blur', () => viewer.setShift(false));

  // ---------- Start ----------

  try {
    const view = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
    if (view && app.est.sheets.some(s => s.id === view.sheetId)) app.sheetId = view.sheetId;
    if (view && app.est.conditions.some(c => c.id === view.conditionId)) app.conditionId = view.conditionId;
  } catch (e) { /* view only */ }
  if (!app.sheetId && app.est.sheets[0]) app.sheetId = app.est.sheets[0].id;
  viewer.setSheet(app.sheetId);
  viewer.setTool('select');
  renderAll();
  attachStoredDrawings();
  if (!window.pdfjsLib) setStatus('The PDF reader did not load. Photos still work.', true);

  Object.assign(app, {
    setStatus, renderAll, renderScreen, goto, showCondition, openOutput, openJobDialog, autosave, loadEstimate, currentSheet, hasWork,
    openScaleDialog, newCondition, showSheet, newJob, focusKey, closeMenu, showQuoteQty: true,
    onRender: fn => renderHooks.push(fn), onOutput: fn => outputHooks.push(fn)
  });
  app.viewer = viewer;
  window.SteadfastApp = app;   // for checking in the browser console
})();
