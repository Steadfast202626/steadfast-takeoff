/*
 * Steadfast takeoff: the Rooms screen, a finish schedule.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const { el, button, select, numInput, textInput, ask } = window.SteadfastUI;
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

  function renderRooms(root, app) {
    const est = app.est;
    root.append(el('div', { className: 'screen-head' },
      el('h1', { textContent: 'Rooms' }),
      el('div', { className: 'spacer' }),
      button('Add room', 'Add a room to the finish schedule', () => app.change(e => { e.rooms.push(newRoom(e)); }))));
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
  window.SteadfastRooms = { newRoom };
})();
