/*
 * Steadfast takeoff: Monday.com is the database. Save and open jobs on the Estimates board through
 * the app's own /api addresses. No key ever reaches the browser; the server holds them.
 * The browser keeps a working copy for speed, and which Monday item this job belongs to.
 * When the page is opened without the server (from a file), all of this stays hidden.
 */
(function () {
  'use strict';

  const app = window.SteadfastApp;
  const calc = window.SteadfastCalc;
  const Storage = window.SteadfastStorage;
  const { el, ask, showDialog } = window.SteadfastUI;
  const $ = id => document.getElementById(id);

  const LINK_KEY = 'steadfast-takeoff.monday';
  const CHUNK = 4 * 1024 * 1024;
  const state = { available: false, signedIn: false, monday: false, busy: '' };

  // ---------- Which Monday item this job is ----------

  function readLink() {
    try { return JSON.parse(localStorage.getItem(LINK_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeLink(link) {
    try {
      if (link) localStorage.setItem(LINK_KEY, JSON.stringify(link));
      else localStorage.removeItem(LINK_KEY);
    } catch (e) { /* the link is also on Monday as the Takeoff ID */ }
  }

  // A short fingerprint of the job, to tell whether it changed since the last save to Monday.
  function fingerprint(est) {
    const text = JSON.stringify(est);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + text.length;
  }

  const isSample = () => window.SteadfastOutputs.isSample(app.est);
  const timeText = iso => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const dateText = iso => (iso ? String(iso).slice(0, 10) : '');

  function unsaved() {
    if (!state.signedIn || isSample()) return false;
    const link = readLink();
    if (!link) return app.hasWork();
    return link.saved !== fingerprint(app.est);
  }

  // ---------- Talking to /api ----------

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}));
    if (res.status === 401) {
      state.signedIn = false;
      render();
      throw new Error('Sign in again to use Monday.com.');
    }
    const data = res.headers.get('content-type') && res.headers.get('content-type').includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error((data && data.error) || 'The server said ' + res.status + '.');
    return data;
  }

  async function checkSession() {
    if (location.protocol === 'file:') return render();
    try {
      const res = await fetch('/api/session', { credentials: 'same-origin' });
      const data = res.ok && res.headers.get('content-type') && res.headers.get('content-type').includes('json') ? await res.json() : null;
      state.available = !!data;
      state.signedIn = !!(data && data.signedIn);
      state.monday = !!(data && data.monday);
    } catch (e) {
      state.available = false;
    }
    render();
  }

  // ---------- Top bar ----------

  function render() {
    const b = $('cloudState');
    if (!b) return;
    b.hidden = !state.available;
    document.body.classList.toggle('has-cloud', state.available);
    if (!state.available) return;
    let text, tip, warn = false;
    const link = readLink();
    if (!state.signedIn) { text = 'Sign in'; tip = 'Sign in with the team passcode to save to Monday.com'; }
    else if (!state.monday) { text = 'Monday.com not set up'; tip = 'The Monday.com key is not set on Netlify yet'; warn = true; }
    else if (state.busy) { text = state.busy; tip = 'Working with Monday.com'; }
    else if (isSample()) { text = 'Sample, not saved'; tip = 'The sample job is never saved to Monday.com'; }
    else if (!link && !app.hasWork()) { text = 'Not on Monday.com yet'; tip = 'Save once there is something to keep'; }
    else if (unsaved()) { text = 'Not saved to Monday.com'; tip = 'Click to save this job to the Estimates board'; warn = true; }
    else { text = 'Saved to Monday.com ' + (link && link.savedAt ? timeText(link.savedAt) : ''); tip = 'On the Estimates board' + (link && link.name ? ': ' + link.name : ''); }
    b.textContent = text.trim();
    b.title = tip;
    b.classList.toggle('warn', warn);
  }

  $('cloudState').addEventListener('click', () => {
    if (!state.signedIn) { location.href = '/api/login?next=' + encodeURIComponent('/'); return; }
    if (state.monday && !state.busy && unsaved()) save();
  });

  // ---------- Save ----------

  async function save() {
    if (!state.available) return app.saveEstimate();
    if (!state.signedIn) { location.href = '/api/login?next=' + encodeURIComponent('/'); return; }
    if (state.busy) return;
    if (isSample()) return app.setStatus('The sample job is never saved to Monday.com.', true, 6000);
    if (!app.est.job.name) {
      app.setStatus('Give the job a name first.', true, 6000);
      return app.openJobDialog();
    }
    const est = calc.clone(app.est);
    const print = fingerprint(app.est);
    const link = readLink();
    state.busy = 'Saving to Monday.com';
    render();
    try {
      const out = await api('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ estimate: est, takeoffId: link && link.takeoffId }) });
      writeLink({ takeoffId: out.takeoffId, itemId: out.itemId, name: out.job.name, saved: print, savedAt: new Date().toISOString() });
      app.setStatus((out.created ? 'Added to' : 'Saved to') + ' the Monday.com Estimates board', false, 5000);
      await sendDrawings(out.itemId, out.job.drawings || []);
    } catch (e) {
      app.setStatus('Not saved to Monday.com. ' + e.message, true, 10000);
    } finally {
      state.busy = '';
      render();
    }
  }

  // Drawings that Monday does not have yet go up in 4 MB parts.
  async function sendDrawings(itemId, onMonday) {
    const have = new Set(onMonday.map(d => d.name));
    const names = [...new Set(app.est.sheets.map(s => s.file))].filter(n => n && !have.has(n));
    let i = 0;
    for (const name of names) {
      i++;
      const rec = await Storage.getDrawing(name);
      if (!rec) continue;
      const bytes = new Uint8Array(rec.data);
      const parts = Math.max(1, Math.ceil(bytes.length / CHUNK));
      const id = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
      for (let n = 0; n < parts; n++) {
        state.busy = 'Sending drawing ' + i + ' of ' + names.length + (parts > 1 ? ', part ' + (n + 1) + ' of ' + parts : '');
        render();
        await api('/api/uploads/' + id + '/' + n, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes.subarray(n * CHUNK, (n + 1) * CHUNK) });
      }
      await api('/api/uploads/' + id + '/finish', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId, name, type: rec.type, parts }) });
      state.busy = 'Monday.com is filing ' + name;
      render();
      const done = await waitForUpload(id);
      if (done.state !== 'done') throw new Error(name + ' did not reach Monday.com. ' + (done.error || ''));
    }
    if (names.length) app.setStatus('Saved to Monday.com with ' + names.length + (names.length === 1 ? ' drawing' : ' drawings'), false, 6000);
  }

  async function waitForUpload(id) {
    for (let t = 0; t < 450; t++) {
      await new Promise(r => setTimeout(r, 2000));
      const s = await api('/api/uploads/' + id);
      if (s.state === 'done' || s.state === 'failed') return s;
    }
    return { state: 'failed', error: 'It took longer than 15 minutes.' };
  }

  // ---------- Open ----------

  async function openList() {
    if (!state.available) return app.setStatus('Monday.com works on the published app only.', true, 6000);
    if (!state.signedIn) { location.href = '/api/login?next=' + encodeURIComponent('/'); return; }
    let jobs;
    try {
      state.busy = 'Loading jobs';
      render();
      jobs = (await api('/api/jobs')).jobs;
    } catch (e) {
      return app.setStatus('Could not list jobs. ' + e.message, true, 8000);
    } finally {
      state.busy = '';
      render();
    }
    const current = readLink();
    const table = el('table', { className: 'grid compact job-list' },
      el('thead', {}, el('tr', {}, ['Job', 'Client', 'Status', 'Bid due', 'Saved', ''].map(h => el('th', { textContent: h })))));
    const tbody = el('tbody');
    for (const j of jobs) {
      const openBtn = el('button', { type: 'button', className: 'small' + (j.estimateFile ? ' primary' : ''), textContent: 'Open',
        disabled: !j.estimateFile, title: j.estimateFile ? 'Open ' + j.estimateFile.name : 'No estimate file on this item yet',
        onclick: () => { $('infoDialog').close(); openJob(j.itemId); } });
      tbody.append(el('tr', { className: current && current.itemId === j.itemId ? 'lowest-row' : '' },
        el('td', { textContent: j.name }), el('td', { textContent: j.client }), el('td', { textContent: j.status || j.group }),
        el('td', { textContent: j.bidDue }), el('td', { textContent: j.estimateFile ? dateText(j.estimateFile.savedAt) : '' }),
        el('td', { className: 'actions' }, openBtn)));
    }
    table.append(tbody);
    const body = jobs.length ? el('div', { className: 'table-wrap' }, table) : el('p', { className: 'note', textContent: 'No jobs on the Estimates board yet.' });
    showDialog('Jobs on Monday.com', body, [['Close', 'Close this list', null, false]], true);
  }

  async function openJob(itemId) {
    if (unsaved() && !await ask('Open this job? The job in this browser has changes not saved to Monday.com.', 'Open')) return;
    state.busy = 'Opening from Monday.com';
    render();
    try {
      const out = await api('/api/jobs/' + encodeURIComponent(itemId));
      if (!out.estimate) throw new Error(out.note || 'No estimate file on this item.');
      app.goto('takeoff');
      app.loadEstimate(out.estimate, 'monday');
      writeLink({ takeoffId: out.job.takeoffId || null, itemId: out.job.itemId, name: out.job.name, saved: fingerprint(app.est), savedAt: out.job.estimateFile.savedAt });
      app.setStatus('Opened ' + out.job.name + ' from Monday.com', false, 5000);
      await fetchDrawings(out.job);
    } catch (e) {
      app.setStatus('Could not open the job. ' + e.message, true, 10000);
    } finally {
      state.busy = '';
      render();
    }
  }

  // Bring down drawings this browser does not have, so the sheets show without re-attaching by hand.
  async function fetchDrawings(job) {
    const wanted = new Set(app.est.sheets.map(s => s.file));
    const missing = [];
    for (const d of job.drawings || []) if (wanted.has(d.name) && !await Storage.getDrawing(d.name)) missing.push(d);
    let i = 0;
    for (const d of missing) {
      i++;
      state.busy = 'Getting drawing ' + i + ' of ' + missing.length;
      render();
      const res = await fetch('/api/jobs/' + encodeURIComponent(job.itemId) + '/drawings/' + encodeURIComponent(d.assetId), { credentials: 'same-origin' });
      if (!res.ok) { app.setStatus(d.name + ' did not come down from Monday.com. Add it with Add drawings.', true, 10000); continue; }
      await Storage.putDrawing(d.name, res.headers.get('content-type') || 'application/pdf', await res.arrayBuffer());
    }
    if (missing.length) await app.attachStoredDrawings();
  }

  // ---------- Wiring ----------

  // A job loaded from a file, the sample or New job is not the Monday item any more.
  app.onLoad((est, source) => { if (source !== 'monday') writeLink(null); });
  app.onRender(render);

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    if (t.dataset.action === 'monday-save') save();
    else if (t.dataset.action === 'monday-open') openList();
  });

  window.addEventListener('beforeunload', e => {
    if (unsaved()) { e.preventDefault(); e.returnValue = ''; }
  });

  app.cloud = { ready: () => state.available && state.signedIn && state.monday, unsaved, save, openList, state };

  checkSession().then(() => {
    // Opening the app lists the jobs on Monday when there is nothing open yet.
    if (app.cloud.ready() && !app.hasWork() && $('welcome').hidden) openList();
  });
})();
