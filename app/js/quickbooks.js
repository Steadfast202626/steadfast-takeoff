/*
 * Steadfast takeoff: QuickBooks Online in the app. Read only: the connection status, the weekly price
 * check (run it now, see the last result) and a project's costs for the post-mortem.
 * Everything goes through the app's /api addresses; no QuickBooks key reaches the browser.
 */
(function () {
  'use strict';

  const app = window.SteadfastApp;
  const { el, button, select, showDialog } = window.SteadfastUI;
  const money = v => window.SteadfastCalc.fmtMoney(v);

  const state = { status: null, last: null, loaded: false, running: false };
  const ready = () => !!(app.cloud && app.cloud.state.available && app.cloud.state.signedIn);

  async function refresh() {
    if (!ready()) return;
    try {
      const [status, last] = await Promise.all([app.cloud.api('/api/qbo/status'), app.cloud.api('/api/pricecheck')]);
      state.status = status;
      state.last = last.last;
    } catch (e) {
      state.status = { connected: false, problem: e.message };
    }
    state.loaded = true;
    app.renderScreen();
    if (window.SteadfastStart) window.SteadfastStart.refresh();
  }

  async function runCheck(days) {
    if (state.running) return;
    state.running = true;
    app.renderScreen();
    app.setStatus('Checking QuickBooks bills against the price book');
    try {
      state.last = (await app.cloud.api('/api/pricecheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days }) })).last;
      const n = state.last.flags.length;
      app.setStatus(n ? n + (n === 1 ? ' price moved' : ' prices moved') + ' more than 5%. Marked "check" on Monday.com for Kamal.' : 'No price moved more than 5%.', !!n, 10000);
    } catch (e) {
      app.setStatus('Price check did not run. ' + e.message, true, 10000);
    } finally {
      state.running = false;
      app.renderScreen();
    }
  }

  const pct = p => (p > 0 ? '+' : '') + (p * 100).toFixed(1) + '%';

  // The QuickBooks card on the Price book screen.
  function card() {
    if (!(app.cloud && app.cloud.state.available)) return null;
    const box = el('section', { className: 'card qbo-card' }, el('h2', { textContent: 'QuickBooks price check' }));
    if (!app.cloud.state.signedIn) {
      box.append(el('p', { className: 'note' }, 'Sign in to see the weekly price check. ', el('a', { href: '/api/login?next=%2F', textContent: 'Sign in' })));
      return box;
    }
    if (!state.loaded) { refresh(); box.append(el('p', { className: 'note muted', textContent: 'Reading QuickBooks…' })); return box; }
    const s = state.status || {};
    if (!s.connected) {
      box.append(el('p', { className: 'note', textContent: s.problem || 'QuickBooks is not connected.' }),
        el('a', { className: 'button-link', href: '/api/qbo/connect', textContent: 'Connect QuickBooks', title: 'Sign in to QuickBooks. The app only reads bills, vendors, items and project costs.' }));
      return box;
    }
    box.append(el('p', { className: 'note', textContent: 'Connected to company ' + s.realmId + ' (' + s.environment + '). Read only. Every Monday the last week\'s bills are checked; a price more than 5% from the book is marked "check" on the Monday.com Price book board for Kamal. Costs are never changed here.' }));
    const last = state.last;
    if (last) {
      box.append(el('p', { className: 'note' + (last.flags.length ? ' warn' : ''), textContent: 'Last check ' + last.ranAt.slice(0, 10) + ': ' + last.bills + ' bills, ' +
        last.matched + ' of ' + last.lines + ' lines matched. ' + (last.flags.length ? last.flags.length + ' moved more than 5%.' : 'Nothing moved more than 5%.') }));
      if (last.flags.length) {
        const t = el('table', { className: 'grid compact' }, el('thead', {}, el('tr', {}, ['Code', 'Item', 'Book', 'Bill', 'Change', 'Bill from'].map(h => el('th', { textContent: h })))));
        const tb = el('tbody');
        for (const f of last.flags) {
          tb.append(el('tr', {}, el('td', { className: 'mono', textContent: f.code }), el('td', { textContent: f.name }),
            el('td', { className: 'num', textContent: money(f.book) }), el('td', { className: 'num', textContent: money(f.bill) }),
            el('td', { className: 'num warn-text', textContent: pct(f.pct) }), el('td', { textContent: f.source })));
        }
        t.append(tb);
        box.append(el('div', { className: 'table-wrap' }, t));
      }
      if (last.noCost && last.noCost.length) box.append(el('p', { className: 'note', textContent: 'Billed but no cost on Monday.com: ' + last.noCost.map(x => x.code).join(', ') + '.' }));
      if (last.unmatchedCount) box.append(el('p', { className: 'note muted', textContent: last.unmatchedCount + ' bill lines matched no price book code. Put the code in the QuickBooks item\'s SKU, like 09-LVP, to include them.' }));
    }
    box.append(el('div', { className: 'row-actions' },
      button(state.running ? 'Checking…' : 'Check now', 'Check the last 7 days of bills now', () => runCheck(7), 'primary'),
      button('Check 30 days', 'Check the last 30 days of bills', () => runCheck(30)),
      el('a', { href: '/api/qbo/disconnect', textContent: 'Disconnect', title: 'Remove the app\'s access to QuickBooks' })));
    return box;
  }

  // Post-mortem: pick the QuickBooks project and read its costs by division.
  async function fillProject(app, record, onDone) {
    let projects;
    try {
      projects = (await app.cloud.api('/api/qbo/projects')).projects;
    } catch (e) {
      return app.setStatus('Could not read QuickBooks projects. ' + e.message, true, 10000);
    }
    if (!projects.length) return app.setStatus('No projects in QuickBooks yet.', true, 8000);
    const guess = projects.find(p => record.qboProject && p.fullName.toLowerCase().includes(String(record.qboProject).toLowerCase())) || projects[0];
    let chosen = guess.id;
    const body = el('div', {}, el('p', { textContent: 'Every bill and expense charged to this project goes into the QuickBooks column, by section. Typed actuals stay as typed.' }),
      el('label', { className: 'field' }, 'QuickBooks project', select(projects.map(p => [p.id, p.fullName]), chosen, v => { chosen = v; })));
    if (!await showDialog('Fill from QuickBooks', body, [['Cancel', 'Close', null], ['Fill', 'Read this project\'s costs', true, true]])) return;
    app.setStatus('Reading the project\'s costs from QuickBooks');
    try {
      const costs = await app.cloud.api('/api/qbo/projects/' + encodeURIComponent(chosen) + '/costs');
      onDone({ project: projects.find(p => p.id === chosen).fullName, costs });
      app.setStatus('QuickBooks: ' + costs.lines + ' lines, ' + money(costs.total) + (costs.unmatchedTotal ? ', ' + money(costs.unmatchedTotal) + ' not matched to a section' : ''), false, 10000);
    } catch (e) {
      app.setStatus('Could not read the project\'s costs. ' + e.message, true, 10000);
    }
  }

  window.SteadfastQuickBooks = { card, refresh, runCheck, fillProject, state, connected: () => !!(state.status && state.status.connected) };
})();
