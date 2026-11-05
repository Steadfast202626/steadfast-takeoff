/*
 * Steadfast takeoff: the Rooms screen, a finish schedule.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const { el, button, select, numInput, textInput, ask, field, showDialog } = window.SteadfastUI;
  const Templates = window.SteadfastTemplates;
  const screens = window.SteadfastScreens = window.SteadfastScreens || {};

  // Which assemblies make sense for each finish.
  const FINISH_MEASURES = { floor: ['area'], walls: ['wall', 'area'], ceiling: ['area'], base: ['length'] };

  function newRoom(est, extra) {
    return Object.assign({
      id: calc.nextId(est.rooms, 'r'), name: 'Room ' + (est.rooms.length + 1), location: '',
      lengthFt: null, widthFt: null, heightFt: null, areaSf: null, perimeterLf: null,
      doors: 0, windows: 0,
      floorAssemblyId: null, wallAssemblyId: null, ceilingAssemblyId: null, baseAssemblyId: null,
      alternateId: null, measurementId: null, source: 'owner', status: 'ok', basis: ''
    }, extra || {});
  }

  // Add a room from a template: its finishes, plus lines for what goes in it. Kamal confirms the counts.
  async function addFromTemplate(app) {
    const est = app.est;
    const list = Templates.TEMPLATES.slice().sort((a, b) => (a.type === est.job.type ? 0 : 1) - (b.type === est.job.type ? 0 : 1));
    const v = { template: list[0].id, name: '', location: '', lengthFt: null, widthFt: null, heightFt: null, doors: null, windows: null, quantities: {} };
    const box = el('div', { className: 'template-form' });
    const draw = () => {
      const t = Templates.TEMPLATES.find(x => x.id === v.template);
      box.innerHTML = '';
      const typeName = x => x.name + (x.type === 'commercial' ? ' (commercial)' : '');
      box.append(el('div', { className: 'grid2' },
        field('Template', select(list.map(x => [x.id, typeName(x)]), v.template, val => { v.template = val; v.quantities = {}; v.heightFt = v.doors = v.windows = null; draw(); }, { dataset: { key: 'tpl-template' } }), true),
        field('Room name', textInput(v.name, val => { v.name = val; }, { placeholder: t.name, dataset: { key: 'tpl-name' } })),
        field('Location', textInput(v.location, val => { v.location = val; }, { placeholder: 'Level 1' })),
        field('Length ft', numInput(v.lengthFt, val => { v.lengthFt = val; }, { min: 0, placeholder: 'Measure later' })),
        field('Width ft', numInput(v.widthFt, val => { v.widthFt = val; }, { min: 0, placeholder: 'Measure later' })),
        field('Height ft', numInput(v.heightFt ?? t.heightFt, val => { v.heightFt = val; }, { min: 0 })),
        field('Doors', numInput(v.doors ?? t.doors, val => { v.doors = val; }, { min: 0, step: 1 })),
        field('Windows', numInput(v.windows ?? t.windows, val => { v.windows = val; }, { min: 0, step: 1 }))));
      const fin = t.finishes;
      box.append(el('p', { className: 'note', textContent: ['Floor: ' + (fin.floor || 'none'), 'walls: ' + (fin.walls || 'none'),
        'ceiling: ' + (fin.ceiling || 'none'), 'base: ' + (fin.base || 'none')].join('; ') + '.' }));
      const items = el('table', { className: 'grid compact' }, el('thead', {}, el('tr', {}, ['Also adds', 'Qty', ''].map(h => el('th', { textContent: h })))));
      const tb = el('tbody');
      t.items.forEach((it, i) => {
        const a = Templates.findAssembly(est, it.assembly);
        const unit = a ? ({ count: 'ea', length: 'lf', area: 'sf', wall: 'lf' }[a.measure] || 'ea') : '';
        tb.append(el('tr', {}, el('td', { textContent: it.label, title: it.assembly + (a ? '' : ': not in this job') }),
          el('td', { className: 'cell-input' }, numInput(v.quantities[i] ?? it.qty, val => { v.quantities[i] = val === null ? 0 : val; }, { className: 'num', min: 0 })),
          el('td', { textContent: a ? unit : 'Not in this job', className: a ? 'muted' : 'warn-text' })));
      });
      items.append(tb);
      box.append(items);
    };
    draw();
    const ok = await showDialog('Add a room from a template', box, [['Cancel', 'Close without adding', null], ['Add room', 'Add the room and its items', true, true]], true);
    if (!ok) return null;
    const t = Templates.TEMPLATES.find(x => x.id === v.template);
    let out = null;
    app.change(e => {
      out = Templates.addRoom(e, t, { name: v.name || t.name, location: v.location, lengthFt: v.lengthFt, widthFt: v.widthFt,
        heightFt: v.heightFt ?? t.heightFt, doors: v.doors ?? t.doors, windows: v.windows ?? t.windows, quantities: v.quantities });
    });
    app.setStatus('Added ' + (v.name || t.name) + ' with ' + out.lines.length + (out.lines.length === 1 ? ' item' : ' items') +
      (out.skipped.length ? '. ' + out.skipped[0] : ''), !!out.skipped.length, 8000);
    return out;
  }

  function renderRooms(root, app) {
    const est = app.est;
    root.append(el('div', { className: 'screen-head' },
      el('h1', { textContent: 'Rooms' }),
      el('div', { className: 'spacer' }),
      button('Add from template', 'Washroom, staff kitchen, basement, bathroom or kitchen, with its finishes and items', () => addFromTemplate(app), 'primary'),
      button('Add room', 'Add an empty room to the finish schedule', () => app.change(e => { e.rooms.push(newRoom(e)); }))));
    root.append(el('p', { className: 'note', textContent: 'Floors, walls, ceilings and base by room.',
      title: 'Doors take ' + est.settings.doorAreaSf + ' sf off walls and ' + est.settings.doorWidthFt + ' ft off base; windows take ' +
        est.settings.windowAreaSf + ' sf off walls. Blank height uses ' + est.settings.defaultHeightFt +
        ' ft. To take a room from the drawing, select a traced area and use "Make room".' }));

    if (!est.rooms.length) {
      root.append(el('p', { className: 'note', textContent: 'No rooms yet.' }));
      return;
    }

    const asmOptions = finish => [['', 'None']].concat(est.assemblies
      .filter(a => FINISH_MEASURES[finish].includes(a.measure)).map(a => [a.id, a.name]));
    const bidOptions = [['', 'Base bid']].concat(est.alternates.map(a => [a.id, a.name]));

    const head = ['Room', 'Location', 'Length', 'Width', 'Height', 'Doors', 'Windows', 'Floor', 'Walls', 'Ceiling', 'Base', 'Bid',
      'Area sf', 'Perim. lf', 'Wall sf', 'Base lf', ''];
    const table = el('table', { className: 'grid rooms' }, el('thead', {}, el('tr', {}, head.map(h => el('th', { textContent: h })))));
    const tbody = el('tbody');
    for (const r of est.rooms) {
      const k = 'room-' + r.id + '-';
      const q = calc.roomQty(est, r);
      const edit = fn => app.change(() => fn(r));
      const traced = !!r.measurementId;
      const num = (field, attrs) => numInput(r[field], v => edit(x => { x[field] = v; }),
        Object.assign({ className: 'num', min: 0, dataset: { key: k + field } }, attrs || {}));
      const asm = (finish, field) => {
        const opts = asmOptions(finish);
        if (r[field] && !opts.some(o => o[0] === r[field])) {
          const a = est.assemblies.find(x => x.id === r[field]);
          opts.push([r[field], a ? a.name : 'Missing build-up']);
        }
        return select(opts, r[field] || '', v => edit(x => { x[field] = v || null; }), { dataset: { key: k + field } });
      };
      const tracedTip = { disabled: traced, title: traced ? 'Area and perimeter come from the traced area' : '' };
      const tr = el('tr', { className: r.status === 'check' ? 'check-row' : '' },
        el('td', { className: 'cell-input' }, textInput(r.name, v => v && edit(x => { x.name = v; }), { dataset: { key: k + 'name' } })),
        el('td', { className: 'cell-input' }, textInput(r.location, v => edit(x => { x.location = v; }), { dataset: { key: k + 'loc' } })),
        el('td', { className: 'cell-input' }, num('lengthFt', tracedTip)),
        el('td', { className: 'cell-input' }, num('widthFt', tracedTip)),
        el('td', { className: 'cell-input' }, num('heightFt', { placeholder: String(est.settings.defaultHeightFt) })),
        el('td', { className: 'cell-input' }, num('doors', { step: 1 })),
        el('td', { className: 'cell-input' }, num('windows', { step: 1 })),
        el('td', { className: 'cell-input' }, asm('floor', 'floorAssemblyId')),
        el('td', { className: 'cell-input' }, asm('walls', 'wallAssemblyId')),
        el('td', { className: 'cell-input' }, asm('ceiling', 'ceilingAssemblyId')),
        el('td', { className: 'cell-input' }, asm('base', 'baseAssemblyId')),
        el('td', { className: 'cell-input' }, select(bidOptions, r.alternateId || '', v => edit(x => { x.alternateId = v || null; }), { dataset: { key: k + 'bid' } })),
        el('td', { className: 'num', textContent: calc.fmtQty(q.area) }),
        el('td', { className: 'num', textContent: calc.fmtQty(q.perimeter) }),
        el('td', { className: 'num', textContent: calc.fmtQty(q.wallSf) }),
        el('td', { className: 'num', textContent: calc.fmtQty(q.baseLf) }),
        el('td', { className: 'actions' },
          r.status === 'check' ? button('Accept', 'Accept the estimator\'s room' + (r.basis ? ': ' + r.basis : ''), () => edit(x => { x.status = 'ok'; }), 'small primary') : null,
          traced ? button('Unlink', 'Stop taking area and perimeter from the drawing', () => edit(x => { x.measurementId = null; }), 'small') : null,
          button('Delete', 'Delete this room', async () => {
            if (!await ask('Delete the room "' + r.name + '"?', 'Delete')) return;
            app.change(e => { e.rooms = e.rooms.filter(x => x.id !== r.id); });
          }, 'small danger')));
      if (r.status === 'check' && r.basis) tr.title = 'Estimator: ' + r.basis;
      tbody.append(tr);
    }
    table.append(tbody);
    root.append(el('div', { className: 'table-wrap' }, table));
  }

  screens.rooms = { label: 'Rooms', title: 'Finish schedule: floors, walls, ceilings and base by room', render: renderRooms };
  window.SteadfastRooms = { newRoom, addFromTemplate };
})();
