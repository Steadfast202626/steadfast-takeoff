/*
 * Steadfast takeoff: the Price book and Assemblies screens.
 */
(function () {
  'use strict';

  const calc = window.SteadfastCalc;
  const Library = window.SteadfastLibrary;
  const { el, button, select, field, numInput, textInput, checkbox, ask, showDialog, pickFile } = window.SteadfastUI;
  const screens = window.SteadfastScreens = window.SteadfastScreens || {};

  const MONDAY_FLAG = /update in monday\.com/i;
  const PER_OPTIONS = [['sf', 'per sf'], ['lf', 'per lf'], ['ea', 'each']];
  const MEASURE_OPTIONS = [['area', 'Area'], ['length', 'Length'], ['wall', 'Wall'], ['count', 'Count']];

  function needsMondayUpdate(item) {
    return MONDAY_FLAG.test(item.source || '');
  }

  // A cost changed in the app is for this job only; the master stays on Monday.com.
  function setPriceBookCost(app, code, value) {
    app.change(est => {
      const item = est.priceBook.find(p => p.code === code);
      if (!item || item.unitCost === value) return;
      item.unitCost = value;
      item.source = 'Changed in estimate. Update in Monday.com.';
      item.updated = calc.today();
    });
  }

  function divisionOptions(blank) {
    return [['', blank || 'Not set']].concat(calc.DIVISIONS.map(([c, n]) => [c, c + ' ' + n]));
  }

  // ---------- Price book ----------

  async function importMonday(app) {
    const file = await pickFile('.xlsx,.csv,text/csv');
    if (!file) return;
    let result;
    try {
      result = await Library.readExport(file);
    } catch (e) {
      return app.setStatus('Could not read ' + file.name + ': ' + e.message, true, 8000);
    }
    if (!result.items.length) {
      return showDialog('Price book import', el('p', { textContent: result.problems.join(' ') || 'No items found.' }), [['Close', 'Close this message', null, true]]);
    }
    const withCost = result.items.filter(i => typeof i.unitCost === 'number').length;
    const codes = new Set(result.items.map(i => i.code));
    const usedMissing = [...new Set(app.est.assemblies.flatMap(a => a.items.map(i => i.code)))].filter(c => !codes.has(c));
    const body = el('div', {},
      el('p', { textContent: result.items.length + ' items read from ' + file.name + ', ' + withCost + ' with a cost.' }),
      usedMissing.length ? el('p', { className: 'warn-text', textContent: 'Assemblies use codes that are not in this export: ' + usedMissing.join(', ') }) : null,
      result.problems.length ? el('details', {}, el('summary', { textContent: result.problems.length + ' rows to look at' }),
        el('ul', {}, result.problems.map(p => el('li', { textContent: p })))) : null);
    const choice = await showDialog('Price book import', body, [
      ['Cancel', 'Do not import', null],
      ['Save as company price book', 'Keep this as the price book for new jobs', 'save', true]
    ]);
    if (choice !== 'save') return;
    if (!Library.setPriceBook(result.items, file.name)) return app.setStatus('Browser storage is full. The import was not kept.', true, 8000);
    app.setStatus('Price book imported: ' + result.items.length + ' items', false, 6000);
    await useLatestImport(app, true);
    app.renderAll();
  }

  async function useLatestImport(app, justImported) {
    const lib = Library.get();
    const edited = app.est.priceBook.filter(needsMondayUpdate).length;
    const question = (justImported ? 'Use the new import in this job too? ' : 'Replace this job\'s price book with the latest import? ') +
      (edited ? edited + ' costs changed in this job will be replaced.' : '');
    if (!await ask(question, 'Use it in this job')) return;
    app.change(est => { est.priceBook = calc.clone(lib.priceBook); });
    app.setStatus('This job now uses the latest price book', false, 5000);
  }

  function importInfo() {
    const lib = Library.get();
    if (lib.fromStarter) {
      return el('p', { className: 'note warn' }, 'Starter list with blank costs. Import the Monday.com Price book board to get costs.');
    }
    const days = Library.daysSince(lib.importedAt);
    const old = days !== null && days > Library.STALE_DAYS;
    return el('p', { className: 'note' + (old ? ' warn' : '') },
      'Last Monday.com import ' + lib.importedAt + (lib.importFile ? ' from ' + lib.importFile : '') +
      (days !== null ? ' (' + (days === 0 ? 'today' : days + (days === 1 ? ' day ago' : ' days ago')) + ')' : '') +
      (old ? '. More than ' + Library.STALE_DAYS + ' days old. Export the board again.' : '.'));
  }

  const pbView = { search: '', filter: 'all' };

  function renderPriceBook(root, app) {
    const est = app.est;
    const missing = est.priceBook.filter(p => p.unitCost === null || p.unitCost === undefined).length;
    const flagged = est.priceBook.filter(needsMondayUpdate).length;

    root.append(el('div', { className: 'screen-head' },
      el('h1', { textContent: 'Price book' }),
      el('div', { className: 'spacer' }),
      button('Import Monday.com export', 'Load the Price book board export from Monday.com (Excel or CSV)', () => importMonday(app)),
      button('Use latest import', 'Replace this job\'s price book with the latest import', () => useLatestImport(app))
    ));
    root.append(importInfo());
    root.append(el('p', { className: 'note' },
      est.priceBook.length + ' items in this job. ' + (missing ? missing + ' with no cost. ' : '') +
      (flagged ? flagged + ' changed here: update them in Monday.com.' : '')));

    const search = el('input', { type: 'search', placeholder: 'Find code or item', value: pbView.search, dataset: { key: 'pb-search' } });
    search.addEventListener('input', () => { pbView.search = search.value; app.renderScreen(); });
    root.append(el('div', { className: 'filters' }, search,
      select([['all', 'All items'], ['missing', 'No cost'], ['flagged', 'Update in Monday.com']], pbView.filter,
        v => { pbView.filter = v; app.renderScreen(); }, { title: 'Show only some items', dataset: { key: 'pb-filter' } })));

    const q = pbView.search.trim().toLowerCase();
    const rows = est.priceBook.filter(p => {
      if (q && !(p.code + ' ' + p.item).toLowerCase().includes(q)) return false;
      if (pbView.filter === 'missing') return p.unitCost === null || p.unitCost === undefined;
      if (pbView.filter === 'flagged') return needsMondayUpdate(p);
      return true;
    });
    const table = el('table', { className: 'grid' },
      el('thead', {}, el('tr', {}, ['Code', 'Item', 'Unit', 'Type', 'Unit cost', 'Division', 'Source', 'Updated'].map(h => el('th', { textContent: h })))));
    const tbody = el('tbody');
    for (const p of rows) {
      const cost = numInput(p.unitCost, v => setPriceBookCost(app, p.code, v),
        { min: 0, placeholder: 'No cost', className: 'num' + (p.unitCost === null || p.unitCost === undefined ? ' missing' : ''), dataset: { key: 'pb-cost-' + p.code }, title: 'Cost for this job only' });
      tbody.append(el('tr', {},
        el('td', { className: 'mono', textContent: p.code }),
        el('td', { textContent: p.item }),
        el('td', { textContent: p.unit }),
        el('td', { textContent: calc.TYPE_NAMES[p.type] || '—' }),
        el('td', { className: 'cell-input' }, cost),
        el('td', { textContent: p.division }),
        el('td', { className: needsMondayUpdate(p) ? 'warn-text' : '', textContent: p.source || '' }),
        el('td', { textContent: p.updated || '' })));
    }
    table.append(tbody);
    root.append(el('div', { className: 'table-wrap' }, table));
    if (!rows.length) root.append(el('p', { className: 'note', textContent: 'Nothing matches.' }));
  }

  screens.pricebook = { label: 'Price book', title: 'Costs from the Monday.com Price book board', render: renderPriceBook };

  // ---------- Assemblies ----------

  const asmView = { id: null };

  function costText(u) {
    const parts = [];
    for (const k of ['sf', 'lf', 'ea']) if (u.used[k]) parts.push(calc.fmtMoney(u[k]) + (k === 'ea' ? ' each' : '/' + k));
    return parts.join(' + ') + (u.missing ? ' (' + u.missing + ' with no cost)' : '');
  }

  function assemblyUse(est, id) {
    const conds = est.conditions.filter(c => c.assemblyId === id).length;
    const rooms = est.rooms.filter(r => calc.ROOM_FINISHES.some(([, f]) => r[f] === id)).length;
    return { conds, rooms, any: conds + rooms > 0 };
  }

  function newAssembly(app) {
    app.change(est => {
      const id = calc.nextId(est.assemblies, 'a');
      est.assemblies.push({ id, name: 'New assembly', measure: 'area', division: '', confirmed: false, items: [] });
      asmView.id = id;
    });
  }

  function renderAssemblies(root, app) {
    const est = app.est;
    if (!est.assemblies.some(a => a.id === asmView.id)) asmView.id = est.assemblies[0] ? est.assemblies[0].id : null;

    root.append(el('div', { className: 'screen-head' },
      el('h1', { textContent: 'Assemblies' }),
      el('div', { className: 'spacer' }),
      button('New assembly', 'Add an assembly to this job', () => newAssembly(app)),
      button('Save for new jobs', 'Keep these assemblies as the starting list for new jobs', async () => {
        if (!await ask('Use this job\'s ' + est.assemblies.length + ' assemblies as the starting list for new jobs?', 'Save for new jobs')) return;
        Library.setAssemblies(calc.clone(est.assemblies));
        app.setStatus('Assemblies saved for new jobs', false, 5000);
      })));
    root.append(el('p', { className: 'note', textContent: 'Starter factors are starting points only. Tick "Confirmed by Kamal" once checked.' }));

    const layout = el('div', { className: 'split' });
    const list = el('ul', { className: 'pick-list' });
    for (const a of est.assemblies) {
      const u = calc.assemblyUnitCost(est, a);
      list.append(el('li', {
        className: a.id === asmView.id ? 'current' : '', title: a.name,
        onclick: () => { asmView.id = a.id; app.renderScreen(); }
      },
      el('span', { className: 'name', textContent: a.name }),
      el('span', { className: 'sub' + (a.confirmed ? '' : ' warn'), textContent: (a.confirmed ? 'Confirmed' : 'Not confirmed') + ' · ' + costText(u) })));
    }
    layout.append(el('div', { className: 'pick-col' }, list));

    const a = est.assemblies.find(x => x.id === asmView.id);
    const editor = el('div', { className: 'detail' });
    if (a) {
      const k = 'asm-' + a.id + '-';
      const edit = fn => app.change(() => fn(a));
      editor.append(el('div', { className: 'form-grid' },
        field('Name', textInput(a.name, v => v && edit(x => { x.name = v; }), { dataset: { key: k + 'name' } }), true),
        field('Measure', select(MEASURE_OPTIONS, a.measure, v => edit(x => { x.measure = v; }), { dataset: { key: k + 'measure' } })),
        field('CSI division', select(divisionOptions(), a.division, v => edit(x => { x.division = v; }), { dataset: { key: k + 'div' } })),
        el('label', { className: 'check', title: 'Kamal has checked the factors' },
          checkbox(a.confirmed, v => edit(x => { x.confirmed = v; }), { dataset: { key: k + 'ok' } }), 'Confirmed by Kamal')));

      const codeOptions = est.priceBook.map(p => [p.code, p.code + ' ' + p.item]);
      const table = el('table', { className: 'grid' },
        el('thead', {}, el('tr', {}, ['Item', 'Per', 'Qty per unit', 'Waste %', 'Unit cost', 'Cost per unit', ''].map(h => el('th', { textContent: h })))));
      const tbody = el('tbody');
      a.items.forEach((it, i) => {
        const pb = est.priceBook.find(p => p.code === it.code);
        const opts = pb ? codeOptions : [[it.code, it.code + ' (not in price book)']].concat(codeOptions);
        const each = pb && typeof pb.unitCost === 'number' ? pb.unitCost * it.qtyPerUnit * (1 + (it.wastePct || 0) / 100) : null;
        tbody.append(el('tr', {},
          el('td', { className: 'cell-input' }, select(opts, it.code, v => edit(x => { x.items[i].code = v; }), { dataset: { key: k + i + 'code' } })),
          el('td', { className: 'cell-input' }, select(PER_OPTIONS, it.per, v => edit(x => { x.items[i].per = v; }), { dataset: { key: k + i + 'per' } })),
          el('td', { className: 'cell-input' }, numInput(it.qtyPerUnit, v => edit(x => { x.items[i].qtyPerUnit = v === null ? 0 : v; }), { className: 'num', dataset: { key: k + i + 'qty' } })),
          el('td', { className: 'cell-input' }, numInput(it.wastePct, v => edit(x => { x.items[i].wastePct = v === null ? 0 : v; }), { className: 'num', dataset: { key: k + i + 'waste' } })),
          el('td', { className: 'num', textContent: pb && typeof pb.unitCost === 'number' ? calc.fmtMoney(pb.unitCost) + '/' + pb.unit : 'No cost' }),
          el('td', { className: 'num', textContent: each === null ? '—' : calc.fmtMoney(each) + '/' + (it.per === 'ea' ? 'each' : it.per) }),
          el('td', {}, button('Remove', 'Remove this item from the assembly', () => edit(x => { x.items.splice(i, 1); }), 'small danger'))));
      });
      table.append(tbody);
      editor.append(el('div', { className: 'table-wrap' }, table));
      editor.append(el('p', { className: 'note' }, 'Cost per unit: ' + (costText(calc.assemblyUnitCost(est, a)) || 'no items')));

      const use = assemblyUse(est, a.id);
      editor.append(el('div', { className: 'row-buttons' },
        button('Add item', 'Add a price book item to this assembly', () => edit(x => {
          x.items.push({ code: est.priceBook[0] ? est.priceBook[0].code : '', per: a.measure === 'count' ? 'ea' : a.measure === 'length' ? 'lf' : 'sf', qtyPerUnit: 1, wastePct: 0 });
        })),
        el('span', { className: 'spacer' }),
        button('Duplicate', 'Make a copy of this assembly', () => app.change(est2 => {
          const id = calc.nextId(est2.assemblies, 'a');
          est2.assemblies.push(Object.assign(calc.clone(a), { id, name: a.name + ' (copy)', confirmed: false }));
          asmView.id = id;
        })),
        button('Delete', use.any ? 'In use, so it cannot be deleted' : 'Delete this assembly', async () => {
          if (use.any) return app.setStatus('Used by ' + use.conds + ' conditions and ' + use.rooms + ' rooms. Change those first.', true, 6000);
          if (!await ask('Delete the assembly "' + a.name + '"?', 'Delete')) return;
          app.change(est2 => { est2.assemblies = est2.assemblies.filter(x => x.id !== a.id); });
        }, 'danger')));
      if (use.any) editor.append(el('p', { className: 'note', textContent: 'Used by ' + use.conds + ' conditions and ' + use.rooms + ' rooms.' }));
    } else {
      editor.append(el('p', { className: 'note', textContent: 'No assemblies yet.' }));
    }
    layout.append(editor);
    root.append(layout);
  }

  screens.assemblies = { label: 'Assemblies', title: 'Price book items per lf, sf or each, with waste', render: renderAssemblies };

  window.SteadfastPriceBook = { needsMondayUpdate, setPriceBookCost, divisionOptions, importMonday };
})();
