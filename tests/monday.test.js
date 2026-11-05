'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../app/js/calc.js');
const { fakeMonday } = require('./fixtures/fake-monday.js');

const load = () => Promise.all([import('../netlify/lib/session.mjs'), import('../netlify/lib/monday.mjs'), import('../netlify/lib/jobs.mjs')]);

const ENV = { APP_PASSCODE: 'p'.repeat(16), SESSION_SECRET: 's'.repeat(48), MONDAY_API_TOKEN: 'monday-secret-token' };
const NOW = Date.parse('2026-10-23T12:00:00Z');

function estimateWithPrice() {
  const est = calc.newEstimate();
  est.job.name = 'Unit 200 office refresh';
  est.job.client = 'Sample Client Ltd';
  est.job.address = '123 Sample Street NW';
  est.job.type = 'commercial';
  est.job.class = 'B';
  est.job.bidDue = '2026-11-06';
  est.lines.push({ id: 'l1', division: '01', description: 'Test cost', scope: '', location: '', qty: 1, unit: 'lot', unitCost: 10000, type: 'S',
    allowance: false, alternateId: null, source: 'owner', status: 'ok', basis: '' });
  return est;
}

function req(S, url, { method = 'GET', body, signedIn = true } = {}) {
  const headers = {};
  if (signedIn) headers.cookie = S.COOKIE + '=' + encodeURIComponent(S.sign(ENV, { exp: NOW + 60000 }));
  if (body !== undefined && typeof body !== 'string' && !(body instanceof Uint8Array)) { body = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  return new Request('https://steadfast-takeoff.netlify.app' + url, { method, body, headers });
}

test('job addresses need sign-in and a Monday token', async () => {
  const [S, M, J] = await load();
  const fake = fakeMonday(M);
  const deps = { env: ENV, fetch: fake.fetch, now: () => NOW };
  assert.equal((await J.jobs(req(S, '/api/jobs', { signedIn: false }), deps)).status, 401);
  assert.equal((await J.jobs(req(S, '/api/jobs'), { env: Object.assign({}, ENV, { MONDAY_API_TOKEN: '' }), now: () => NOW })).status, 500);
  assert.equal(fake.calls.length, 0, 'nothing reached Monday');
});

test('saving writes one item with calc.js numbers, the estimate file and an activity entry', async () => {
  const [S, M, J] = await load();
  const fake = fakeMonday(M);
  const deps = { env: ENV, fetch: fake.fetch, now: () => NOW };
  const est = estimateWithPrice();
  const res = await J.jobs(req(S, '/api/jobs', { method: 'POST', body: { estimate: est } }), deps);
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  assert.equal(out.created, true);
  assert.match(out.takeoffId, /^tk-/);

  const item = fake.items.get(out.itemId);
  const c = M.BOARDS.estimates.col;
  const m = calc.money(calc.normalize(calc.clone(est)));
  assert.equal(item.name, 'Unit 200 office refresh');
  assert.equal(item.vals[c.client], 'Sample Client Ltd');
  assert.deepEqual(item.vals[c.jobType], { label: 'Commercial' });
  assert.deepEqual(item.vals[c.estimateClass], { label: 'B' });
  assert.deepEqual(item.vals[c.bidDue], { date: '2026-11-06' });
  assert.deepEqual(item.vals[c.status], { label: 'Drafting' });
  assert.equal(Number(item.vals[c.price]), Math.round(m.base.price * 100) / 100, 'price is the app price');
  assert.equal(Number(item.vals[c.margin]), Math.round(m.base.margin * 1000) / 10);
  assert.equal(item.vals[c.takeoffId], out.takeoffId);

  const fileId = item.files[c.estimateFile][0];
  assert.deepEqual(JSON.parse(fake.assets.get(fileId).text), est, 'the file on Monday is the estimate exactly');
  assert.equal(fake.assets.get(fileId).name, calc.estimateFileName(calc.normalize(calc.clone(est))));
  assert.equal(fake.activity.length, 1);
  assert.deepEqual(fake.activity[0].vals[M.BOARDS.activity.col.action], { label: 'Saved' });

  // The token goes to Monday only, in the authorization header.
  assert.ok(fake.calls.every(cl => !cl.opts || !cl.opts.headers || cl.opts.headers.authorization === undefined || cl.opts.headers.authorization === ENV.MONDAY_API_TOKEN));
  assert.ok(!JSON.stringify(out).includes(ENV.MONDAY_API_TOKEN));

  // Saving again with the same Takeoff ID updates the same item, never a second one.
  est.job.name = 'Unit 200 office refresh, rev 2';
  const again = await (await J.jobs(req(S, '/api/jobs', { method: 'POST', body: { estimate: est, takeoffId: out.takeoffId } }), deps)).json();
  assert.equal(again.itemId, out.itemId);
  assert.equal(again.created, false);
  assert.equal(fake.items.size, 1);
  assert.equal(item.name, 'Unit 200 office refresh, rev 2');
  assert.equal(item.files[c.estimateFile].length, 2, 'every save keeps a version');
  assert.equal(item.vals[c.status].label, 'Drafting', 'a later save does not change the status');
});

test('a file that is not an estimate is refused before anything is written', async () => {
  const [S, M, J] = await load();
  const fake = fakeMonday(M);
  const deps = { env: ENV, fetch: fake.fetch, now: () => NOW };
  const res = await J.jobs(req(S, '/api/jobs', { method: 'POST', body: { estimate: { format: 'steadfast-estimator-import', version: 1 } } }), deps);
  assert.equal(res.status, 400);
  assert.equal(fake.calls.length, 0);
});

test('listing and opening read the newest estimate file back', async () => {
  const [S, M, J] = await load();
  const fake = fakeMonday(M);
  const deps = { env: ENV, fetch: fake.fetch, now: () => NOW };
  const est = estimateWithPrice();
  const saved = await (await J.jobs(req(S, '/api/jobs', { method: 'POST', body: { estimate: est } }), deps)).json();
  est.job.notes = 'second version';
  await J.jobs(req(S, '/api/jobs', { method: 'POST', body: { estimate: est, takeoffId: saved.takeoffId } }), deps);

  const list = await (await J.jobs(req(S, '/api/jobs'), deps)).json();
  assert.equal(list.jobs.length, 1);
  assert.equal(list.jobs[0].client, 'Sample Client Ltd');
  assert.ok(list.jobs[0].estimateFile);

  const opened = await (await J.jobs(req(S, '/api/jobs/' + saved.itemId), deps, { id: saved.itemId })).json();
  assert.equal(opened.estimate.job.notes, 'second version');
  assert.equal(opened.job.takeoffId, saved.takeoffId);
  assert.equal((await J.jobs(req(S, '/api/jobs/abc'), deps, { id: 'abc' })).status, 404);
});

test('drawings: parts are checked, joined in order and attached; the task must be signed', async () => {
  const [S, M, J] = await load();
  const fake = fakeMonday(M);
  const blobs = new Map();
  const store = {
    get: async (k, o) => { const v = blobs.get(k); if (v === undefined) return null; return o && o.type === 'json' ? JSON.parse(v) : o && o.type === 'arrayBuffer' ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v; },
    set: async (k, v) => { blobs.set(k, v); },
    setJSON: async (k, v) => { blobs.set(k, JSON.stringify(v)); },
    delete: async k => { blobs.delete(k); }
  };
  let backgroundBody = null;
  const fetchFn = async (url, opts) => {
    if (String(url).includes('/.netlify/functions/upload-finish-background')) { backgroundBody = opts.body; return new Response('', { status: 202 }); }
    return fake.fetch(url, opts);
  };
  const deps = { env: ENV, fetch: fetchFn, now: () => NOW, uploads: async () => store, origin: 'https://steadfast-takeoff.netlify.app' };
  const saved = await (await J.jobs(req(S, '/api/jobs', { method: 'POST', body: { estimate: estimateWithPrice() } }), deps)).json();
  const id = 'a'.repeat(32);

  assert.equal((await J.upload(req(S, '/api/uploads/' + id + '/0', { method: 'POST', body: new Uint8Array([1]), signedIn: false }), deps, { upload: id, part: '0' })).status, 401);
  assert.equal((await J.upload(req(S, '/api/uploads/nope/0', { method: 'POST', body: new Uint8Array([1]) }), deps, { upload: 'nope', part: '0' })).status, 404);
  await J.upload(req(S, '/api/uploads/' + id + '/1', { method: 'POST', body: new Uint8Array([4, 5]) }), deps, { upload: id, part: '1' });
  await J.upload(req(S, '/api/uploads/' + id + '/0', { method: 'POST', body: new Uint8Array([1, 2, 3]) }), deps, { upload: id, part: '0' });
  const fin = await J.upload(req(S, '/api/uploads/' + id + '/finish', { method: 'POST', body: { itemId: saved.itemId, name: '../Bid set.pdf', type: 'application/pdf', parts: 2 } }), deps, { upload: id, part: 'finish' });
  assert.equal(fin.status, 202);

  const forged = await J.finishUpload(new Request('https://x/', { method: 'POST', body: JSON.stringify({ token: 'x.y' }) }), deps);
  assert.equal(forged.status, 403);

  await J.finishUpload(new Request('https://x/', { method: 'POST', body: backgroundBody }), deps);
  const status = await (await J.upload(req(S, '/api/uploads/' + id), deps, { upload: id })).json();
  assert.equal(status.state, 'done', JSON.stringify(status));
  const item = fake.items.get(saved.itemId);
  const asset = fake.assets.get(item.files[M.BOARDS.estimates.col.drawings][0]);
  assert.equal(asset.name, '.. Bid set.pdf', 'no path characters in the name');
  assert.deepEqual([...asset.bytes], [1, 2, 3, 4, 5], 'parts joined in order');
  assert.ok(![...blobs.keys()].some(k => k.includes('/part/')), 'parts are cleaned up');
});

test('session says whether you are signed in, and never sends a secret', async () => {
  const [S, , J] = await load();
  const out = await (await J.session(req(S, '/api/session'), { env: ENV, now: () => NOW })).text();
  assert.deepEqual(JSON.parse(out), { signedIn: true, monday: true });
  assert.ok(!out.includes(ENV.MONDAY_API_TOKEN));
});
