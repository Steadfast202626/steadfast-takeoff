/*
 * Steadfast takeoff: jobs on Monday.com. List, open and save estimates, and move drawings.
 * Every address needs the team sign-in. Numbers written to Monday come from app/js/calc.js,
 * the same module the app and the helper use, so all three agree.
 *
 * deps: { env, fetch, now, uploads (async () => blob store), origin }
 */
import calc from '../../app/js/calc.js';
import * as S from './session.mjs';
import * as M from './monday.mjs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const now = deps => (deps.now ? deps.now() : Date.now());
const CHUNK_MAX = 4.5 * 1024 * 1024;
const MAX_PARTS = 120; // about 540 MB, past Monday's 500 MB file limit
const ID_RE = /^\d{1,20}$/;
const UPLOAD_RE = /^[a-f0-9]{16,64}$/;
const TAKEOFF_RE = /^[a-z0-9-]{8,64}$/;

function guard(req, deps) {
  if (!S.signedIn(deps.env, req, now(deps))) return json({ error: 'Sign in first.' }, 401);
  if (!deps.env.MONDAY_API_TOKEN) return json({ error: 'MONDAY_API_TOKEN is not set on Netlify.' }, 500);
  return null;
}

function failed(e) {
  return json({ error: e instanceof M.MondayError ? e.message : 'Something went wrong talking to Monday.com.' }, 502);
}

export function safeFileName(name) {
  const n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return n || 'drawing';
}

export function newTakeoffId() {
  return 'tk-' + crypto.randomUUID();
}

// ---------- Session ----------

export async function session(req, deps) {
  const signedIn = S.signedIn(deps.env, req, now(deps));
  return json({ signedIn, monday: !!deps.env.MONDAY_API_TOKEN });
}

// ---------- Jobs ----------

export async function jobs(req, deps, params = {}) {
  const stop = guard(req, deps);
  if (stop) return stop;
  const { env } = deps;
  try {
    if (req.method === 'GET' && !params.id) return json({ jobs: await M.listJobs(env, deps.fetch) });
    if (req.method === 'GET') return await openJob(env, params.id, deps);
    if (req.method === 'POST' && !params.id) return await saveJob(req, deps);
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    return failed(e);
  }
}

async function openJob(env, itemId, deps) {
  if (!ID_RE.test(itemId)) return json({ error: 'Not found.' }, 404);
  const job = await M.getJobItem(env, itemId, deps.fetch);
  if (!job) return json({ error: 'That job is not on the Estimates board.' }, 404);
  if (!job.estimateFile) return json({ job, estimate: null, note: 'No estimate file on this item yet.' });
  const asset = await M.assetUrl(env, job.estimateFile.assetId, deps.fetch);
  const res = await deps.fetch(asset.public_url);
  if (!res.ok) return json({ error: 'Monday.com did not send the estimate file.' }, 502);
  let estimate;
  try { estimate = JSON.parse(await res.text()); } catch (e) { return json({ error: 'The estimate file on Monday.com is not readable.' }, 422); }
  const problems = calc.openProblems(estimate);
  if (problems.length) return json({ error: problems[0] }, 422);
  await M.logActivity(env, 'Opened', 'Opened ' + job.name, job.itemId, job.estimateFile.name, deps.fetch, new Date(now(deps)));
  return json({ job, estimate });
}

async function saveJob(req, deps) {
  const { env } = deps;
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'That was not an estimate.' }, 400); }
  const est = body && body.estimate;
  const problems = est ? calc.openProblems(est) : ['That was not an estimate.'];
  if (problems.length) return json({ error: problems[0] }, 400);
  const normalized = calc.normalize(calc.clone(est));
  let takeoffId = TAKEOFF_RE.test(body.takeoffId || '') ? body.takeoffId : null;

  // The Takeoff ID ties the browser's job to one Monday item, so a second save never makes a second item.
  let itemId = takeoffId ? await M.findByTakeoffId(env, takeoffId, deps.fetch) : null;
  if (!takeoffId) takeoffId = newTakeoffId();
  const m = calc.money(normalized);
  const open = calc.openCheckCount(calc.releaseChecks(normalized, m));
  const values = M.jobColumnValues(normalized, m, open, takeoffId);
  const name = (normalized.job.name || 'Untitled job').slice(0, 250);
  const created = !itemId;
  if (created) itemId = await M.createJobItem(env, name, values, deps.fetch);
  else await M.updateJobItem(env, itemId, name, values, deps.fetch);

  const fileName = calc.estimateFileName(normalized);
  await M.addFile(env, itemId, M.BOARDS.estimates.col.estimateFile, fileName, 'application/json', JSON.stringify(est, null, 2), deps.fetch);
  const job = await M.getJobItem(env, itemId, deps.fetch);
  await M.logActivity(env, 'Saved', (created ? 'New job ' : 'Saved ') + name, itemId,
    fileName + '\nPrice ' + (values[M.BOARDS.estimates.col.price] || 'not set') + ', open checks ' + open, deps.fetch, new Date(now(deps)));
  return json({ itemId, takeoffId, created, job });
}

// ---------- Drawings ----------

export async function drawing(req, deps, params = {}) {
  const stop = guard(req, deps);
  if (stop) return stop;
  const { env } = deps;
  if (!ID_RE.test(params.id || '') || !ID_RE.test(params.asset || '')) return json({ error: 'Not found.' }, 404);
  try {
    const job = await M.getJobItem(env, params.id, deps.fetch);
    const file = job && job.drawings.find(d => d.assetId === params.asset);
    if (!file) return json({ error: 'That drawing is not on this job.' }, 404);
    const asset = await M.assetUrl(env, file.assetId, deps.fetch);
    const res = await deps.fetch(asset.public_url);
    if (!res.ok) return json({ error: 'Monday.com did not send the drawing.' }, 502);
    return new Response(res.body, { status: 200, headers: {
      'content-type': res.headers.get('content-type') || 'application/octet-stream',
      'content-disposition': 'attachment; filename="' + encodeURIComponent(file.name) + '"',
      'cache-control': 'no-store'
    } });
  } catch (e) {
    return failed(e);
  }
}

// Drawing sets can be larger than one request allows, so the app sends them in parts of 4 MB.
// The parts wait in Netlify Blobs; a background function joins them and attaches the file to the job.
export async function upload(req, deps, params = {}) {
  const stop = guard(req, deps);
  if (stop) return stop;
  const { env } = deps;
  const id = params.upload || '';
  if (!UPLOAD_RE.test(id)) return json({ error: 'Not found.' }, 404);
  const store = await deps.uploads();

  if (req.method === 'GET') {
    const status = await store.get(id + '/status', { type: 'json' });
    return json(status || { state: 'waiting' });
  }
  if (req.method !== 'POST') return json({ error: 'Not found.' }, 404);

  if (params.part !== undefined && params.part !== 'finish') {
    const n = Number(params.part);
    if (!Number.isInteger(n) || n < 0 || n >= MAX_PARTS) return json({ error: 'Bad part number.' }, 400);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length || bytes.length > CHUNK_MAX) return json({ error: 'Each part must be 4.5 MB or less.' }, 413);
    await store.set(id + '/part/' + n, bytes);
    return json({ ok: true, part: n, bytes: bytes.length });
  }

  // finish
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const parts = Number(body.parts);
  if (!ID_RE.test(String(body.itemId || '')) || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) return json({ error: 'Bad request.' }, 400);
  try {
    const job = await M.getJobItem(env, body.itemId, deps.fetch);
    if (!job) return json({ error: 'That job is not on the Estimates board.' }, 404);
  } catch (e) {
    return failed(e);
  }
  const task = { exp: now(deps) + 30 * 60000, upload: id, itemId: String(body.itemId), name: safeFileName(body.name), type: String(body.type || 'application/octet-stream').slice(0, 100), parts };
  await store.setJSON(id + '/status', { state: 'joining', name: task.name });
  const res = await deps.fetch(new URL('/.netlify/functions/upload-finish-background', deps.origin || req.url), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: S.sign(env, task) })
  });
  if (!res.ok && res.status !== 202) return json({ error: 'Could not start the upload.' }, 502);
  return json({ state: 'joining' }, 202);
}

// Runs in the background function. Only a task signed by upload() above is accepted.
export async function finishUpload(req, deps) {
  const { env } = deps;
  let body;
  try { body = await req.json(); } catch (e) { return new Response('', { status: 400 }); }
  const task = S.unsign(env, body && body.token, now(deps));
  if (!task || !UPLOAD_RE.test(task.upload)) return new Response('', { status: 403 });
  const store = await deps.uploads();
  const key = task.upload;
  try {
    const chunks = [];
    for (let n = 0; n < task.parts; n++) {
      const part = await store.get(key + '/part/' + n, { type: 'arrayBuffer' });
      if (!part) throw new Error('Part ' + (n + 1) + ' of ' + task.parts + ' is missing. Upload the drawing again.');
      chunks.push(new Uint8Array(part));
    }
    const bytes = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    await M.addFile(env, task.itemId, M.BOARDS.estimates.col.drawings, task.name, task.type, bytes, deps.fetch);
    await store.setJSON(key + '/status', { state: 'done', name: task.name, bytes: bytes.length });
    await M.logActivity(env, 'Saved', 'Drawing added: ' + task.name, task.itemId, (bytes.length / 1048576).toFixed(1) + ' MB', deps.fetch, new Date(now(deps)));
  } catch (e) {
    await store.setJSON(key + '/status', { state: 'failed', name: task.name, error: e.message });
  }
  for (let n = 0; n < task.parts; n++) await store.delete(key + '/part/' + n);
  return new Response('', { status: 200 });
}
