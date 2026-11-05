/*
 * Steadfast takeoff: post-mortems on the Monday.com Post-mortems board, and price book flags for Kamal.
 * One post-mortem item per estimate, linked to it (and to the job on the Jobs board when there is one).
 * Every number written is worked out here from the estimate file on Monday with app/js/postmortem.js,
 * the same maths the app shows. Actual costs are typed for now; QuickBooks fills them later.
 * The price book is never repriced from here: a flag sets Price status to "check" for Kamal.
 */
import calc from '../../app/js/calc.js';
import PM from '../../app/js/postmortem.js';
import * as M from './monday.mjs';
import { json, guard, failed } from './jobs.mjs';

const ID_RE = /^\d{1,20}$/;
const P = M.BOARDS.postMortems, C = P.col, SUB = P.sub;
const isNum = v => typeof v === 'number' && isFinite(v);

async function loadEstimate(env, itemId, fetchFn) {
  const job = await M.getJobItem(env, itemId, fetchFn);
  if (!job) return { error: json({ error: 'That job is not on the Estimates board.' }, 404) };
  if (!job.estimateFile) return { error: json({ error: 'No estimate file on that job yet.' }, 404) };
  const asset = await M.assetUrl(env, job.estimateFile.assetId, fetchFn);
  const res = await fetchFn(asset.public_url);
  let est;
  try { est = JSON.parse(await res.text()); } catch (e) { return { error: json({ error: 'The estimate file on Monday.com is not readable.' }, 422) }; }
  if (calc.openProblems(est).length) return { error: json({ error: calc.openProblems(est)[0] }, 422) };
  return { job, est: calc.normalize(est) };
}

const ITEM_FIELDS = `id name column_values { id text value ... on BoardRelationValue { linked_item_ids } }
  subitems { id name board { id } column_values { id text } }`;

// The post-mortem item for an estimate, found by its Estimate link. The board is small, so read it whole.
async function findItem(env, estimateId, fetchFn) {
  const d = await M.gql(env, `query { boards (ids: [${P.id}]) { items_page (limit: 500) { items { ${ITEM_FIELDS} } } } }`, {}, fetchFn);
  return d.boards[0].items_page.items.find(it => it.column_values.some(cv => cv.id === C.estimate && (cv.linked_item_ids || []).map(String).includes(String(estimateId)))) || null;
}

// The job on the Jobs board that was won from this estimate, if one exists.
async function findJob(env, estimateId, fetchFn) {
  const J = M.BOARDS.jobs;
  const d = await M.gql(env, `query { boards (ids: [${J.id}]) { items_page (limit: 500) { items { id column_values (ids: ["${J.col.estimate}"]) { ... on BoardRelationValue { linked_item_ids } } } } } }`, {}, fetchFn);
  const it = d.boards[0].items_page.items.find(x => x.column_values.some(cv => (cv.linked_item_ids || []).map(String).includes(String(estimateId))));
  return it ? String(it.id) : null;
}

export function recordFromItem(item) {
  const v = {};
  for (const cv of item.column_values || []) v[cv.id] = cv.text || '';
  const num = t => (t === '' || t === undefined || !isFinite(Number(t)) ? null : Number(t));
  const record = PM.emptyRecord();
  for (const s of item.subitems || []) {
    const sv = {};
    for (const cv of s.column_values || []) sv[cv.id] = cv.text || '';
    const division = String(s.name).split(' ')[0];
    if (num(sv[SUB.act]) !== null) record.actuals[division] = num(sv[SUB.act]);
  }
  record.changeOrders = PM.changeOrdersFromText(v[C.coList]);
  record.actualHours = num(v[C.actHours]);
  record.status = v[C.status] || 'In progress';
  record.wentWell = v[C.wentWell] || '';
  record.toChange = v[C.toChange] || '';
  record.overWhy = v[C.overWhy] || '';
  record.qboProject = v[C.qboProject] || '';
  return record;
}

export async function postmortems(req, deps, params = {}) {
  const stop = guard(req, deps);
  if (stop) return stop;
  const { env } = deps;
  const estimateId = params.id || '';
  if (!ID_RE.test(estimateId)) return json({ error: 'Not found.' }, 404);
  try {
    if (req.method === 'GET') {
      const item = await findItem(env, estimateId, deps.fetch);
      return json({ itemId: item ? String(item.id) : null, record: item ? recordFromItem(item) : null });
    }
    if (req.method !== 'POST') return json({ error: 'Not found.' }, 404);
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
    const record = Object.assign(PM.emptyRecord(), body && body.record);
    const loaded = await loadEstimate(env, estimateId, deps.fetch);
    if (loaded.error) return loaded.error;
    const r = PM.compute(loaded.est, record);
    const num = v => (isNum(v) ? String(calc.round2(v)) : '');
    const vals = {
      [C.estimate]: { item_ids: [Number(estimateId)] },
      [C.status]: { label: record.status === 'Done' ? 'Done' : 'In progress' },
      [C.reviewDate]: { date: new Date(deps.now ? deps.now() : Date.now()).toISOString().slice(0, 10) },
      [C.contract]: num(r.contract), [C.estCost]: num(r.plannedCost), [C.actualCost]: num(r.actualCost),
      [C.estHours]: num(r.estimatedHours), [C.actHours]: num(r.actualHours), [C.changeOrders]: num(r.coPrice),
      [C.coList]: { text: PM.changeOrdersToText(r.changeOrders) },
      [C.qboProject]: String(record.qboProject || '').slice(0, 200),
      [C.wentWell]: { text: String(record.wentWell || '') }, [C.toChange]: { text: String(record.toChange || '') },
      [C.overWhy]: { text: String(record.overWhy || '') }
    };
    const jobId = await findJob(env, estimateId, deps.fetch);
    if (jobId) vals[C.job] = { item_ids: [Number(jobId)] };

    let item = await findItem(env, estimateId, deps.fetch);
    const name = 'Post-mortem: ' + (loaded.job.name || 'job');
    let itemId;
    if (item) {
      itemId = String(item.id);
      await M.gql(env, `mutation ($id: ID!, $vals: JSON!) { change_multiple_column_values (board_id: ${P.id}, item_id: $id, column_values: $vals) { id } }`,
        { id: itemId, vals: JSON.stringify(Object.assign({ name }, vals)) }, deps.fetch);
    } else {
      const d = await M.gql(env, `mutation ($name: String!, $vals: JSON!) { create_item (board_id: ${P.id}, item_name: $name, column_values: $vals) { id } }`,
        { name, vals: JSON.stringify(vals) }, deps.fetch);
      itemId = String(d.create_item.id);
      item = { subitems: [] };
    }

    // One subitem per section: estimated, actual and the variance note.
    for (const s of r.sections) {
      const sv = { [SUB.est]: num(s.estimated), [SUB.act]: num(s.actual),
        [SUB.note]: s.off ? 'Off by ' + Math.round(s.pct * 100) + '%' : '' };
      const existing = (item.subitems || []).find(x => String(x.name).split(' ')[0] === s.division);
      if (existing) {
        await M.gql(env, `mutation ($id: ID!, $board: ID!, $vals: JSON!) { change_multiple_column_values (board_id: $board, item_id: $id, column_values: $vals) { id } }`,
          { id: String(existing.id), board: String(existing.board.id), vals: JSON.stringify(sv) }, deps.fetch);
      } else {
        await M.gql(env, `mutation ($parent: ID!, $name: String!, $vals: JSON!) { create_subitem (parent_item_id: $parent, item_name: $name, column_values: $vals) { id } }`,
          { parent: itemId, name: s.label, vals: JSON.stringify(sv) }, deps.fetch);
      }
    }
    await M.logActivity(env, 'Post-mortem', name, estimateId,
      'Profit ' + (r.profit === null ? 'not known yet' : r.profit.toFixed(2)) + (r.margin === null ? '' : ', margin ' + (r.margin * 100).toFixed(1) + '%') +
      ' against a ' + r.target + '% target', deps.fetch, new Date(deps.now ? deps.now() : Date.now()));
    return json({ itemId, result: r });
  } catch (e) {
    return failed(e);
  }
}

// Ask Kamal to look at a price book item: Price status "check", with the reason in Source detail.
// The unit cost on Monday.com is not changed.
export async function flagPrice(req, deps) {
  const stop = guard(req, deps);
  if (stop) return stop;
  const { env } = deps;
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const code = String((body && body.code) || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,30}$/.test(code)) return json({ error: 'Bad price book code.' }, 400);
  const note = String(body.note || '').slice(0, 240);
  const B = M.BOARDS.priceBook;
  try {
    const d = await M.gql(env, `query ($v: [String]!) { items_page_by_column_values (board_id: ${B.id}, limit: 5, columns: [{ column_id: "${B.col.code}", column_values: $v }]) { items { id name } } }`, { v: [code] }, deps.fetch);
    const items = d.items_page_by_column_values.items;
    if (!items.length) return json({ found: false, code });
    await M.gql(env, `mutation ($id: ID!, $vals: JSON!) { change_multiple_column_values (board_id: ${B.id}, item_id: $id, column_values: $vals) { id } }`,
      { id: String(items[0].id), vals: JSON.stringify({ [B.col.status]: { label: 'check' }, [B.col.sourceDetail]: note }) }, deps.fetch);
    await M.logActivity(env, 'Price check', 'Price to check: ' + code, null, note, deps.fetch, new Date(deps.now ? deps.now() : Date.now()));
    return json({ found: true, code, itemId: String(items[0].id) });
  } catch (e) {
    return failed(e);
  }
}
