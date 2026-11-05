/*
 * Steadfast takeoff: Monday.com is the database. Every call to Monday goes through here, on the server,
 * with MONDAY_API_TOKEN. The browser never sees the token.
 *
 * Board and column ids are for the Sandbox workspace. To go live, change BOARDS only.
 */
export const API_URL = 'https://api.monday.com/v2';
export const FILE_URL = 'https://api.monday.com/v2/file';
const API_VERSION = '2025-04';

export const BOARDS = {
  estimates: {
    id: 18432911963,
    newGroup: 'topics',               // In progress
    col: {
      status: 'status',
      jobType: 'color_mm8d7b44',
      client: 'text_mm8dyt1',
      address: 'text_mm8djxtn',
      bidDue: 'date_mm8dw8y8',
      estimateClass: 'color_mm8d4yvz',
      price: 'numeric_mm8df0bt',
      margin: 'numeric_mm8d9n2h',
      openChecks: 'numeric_mm8dtztw',
      estimateFile: 'file_mm8dqywh',
      drawings: 'file_mm8dkree',
      takeoffId: 'text_mm8dmvbs'
    }
  },
  activity: {
    id: 18436810491,
    col: { when: 'date_mm8d3e55', action: 'color_mm8dwfz4', job: 'board_relation_mm8d2whs', detail: 'long_text_mm8d7p4x' }
  },
  priceBook: {
    id: 18432911958,
    col: { code: 'text_mm8c4hxt', unitCost: 'unit_cost', source: 'cost_source', sourceDetail: 'text_mm8dqkm9', updated: 'last_updated', status: 'color_mm8d6j5d', division: 'text_mm8cs438', type: 'color_mm8cwr50', unit: 'unit' }
  },
  postMortems: {
    id: 18432914685,
    col: { job: 'job', estHours: 'numeric_mm8dgzfy', actHours: 'numeric_mm8dwgnq', changeOrders: 'numeric_mm8d7pv7', qboProject: 'text_mm8d3x2x' }
  }
};

export class MondayError extends Error {}

function token(env) {
  if (!env.MONDAY_API_TOKEN) throw new MondayError('MONDAY_API_TOKEN is not set on Netlify.');
  return env.MONDAY_API_TOKEN;
}

export async function gql(env, query, variables = {}, fetchFn = fetch) {
  const res = await fetchFn(API_URL, {
    method: 'POST',
    headers: { authorization: token(env), 'content-type': 'application/json', 'API-Version': API_VERSION },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors || data.error_message) {
    const msg = (data.errors && data.errors[0] && data.errors[0].message) || data.error_message || ('HTTP ' + res.status);
    throw new MondayError('Monday.com said: ' + msg);
  }
  return data.data;
}

// Attach a file to a file column. Monday takes the whole file in one request.
export async function addFile(env, itemId, columnId, fileName, type, bytes, fetchFn = fetch) {
  const form = new FormData();
  form.append('query', 'mutation ($file: File!) { add_file_to_column (item_id: ' + Number(itemId) + ', column_id: "' + columnId + '", file: $file) { id } }');
  form.append('variables[file]', new Blob([bytes], { type: type || 'application/octet-stream' }), fileName);
  const res = await fetchFn(FILE_URL, { method: 'POST', headers: { authorization: token(env), 'API-Version': API_VERSION }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors || data.error_message) {
    const msg = (data.errors && data.errors[0] && data.errors[0].message) || data.error_message || ('HTTP ' + res.status);
    throw new MondayError('Monday.com did not take the file: ' + msg);
  }
  return data.data.add_file_to_column.id;
}

// ---------- Jobs on the Estimates board ----------

const B = BOARDS.estimates, C = B.col;
const JOB_COLUMNS = [C.status, C.jobType, C.client, C.address, C.bidDue, C.estimateClass, C.price, C.margin, C.openChecks, C.estimateFile, C.drawings, C.takeoffId];

const FILES_FRAGMENT = '... on FileValue { files { ... on FileAssetValue { asset_id name created_at } } }';

function files(cv) {
  return ((cv && cv.files) || []).filter(f => f && f.asset_id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export function jobFromItem(item) {
  const v = {};
  for (const cv of item.column_values || []) v[cv.id] = cv;
  const text = id => (v[id] && v[id].text) || '';
  const num = id => (text(id) === '' ? null : Number(text(id)));
  const estimateFiles = files(v[C.estimateFile]);
  const latest = estimateFiles[estimateFiles.length - 1] || null;
  return {
    itemId: String(item.id),
    name: item.name,
    group: item.group ? item.group.title : '',
    updatedAt: item.updated_at,
    status: text(C.status),
    type: text(C.jobType),
    client: text(C.client),
    address: text(C.address),
    bidDue: text(C.bidDue),
    estimateClass: text(C.estimateClass),
    price: num(C.price),
    margin: num(C.margin),
    openChecks: num(C.openChecks),
    takeoffId: text(C.takeoffId),
    estimateFile: latest ? { assetId: String(latest.asset_id), name: latest.name, savedAt: latest.created_at } : null,
    drawings: files(v[C.drawings]).map(f => ({ assetId: String(f.asset_id), name: f.name, addedAt: f.created_at }))
  };
}

export async function listJobs(env, fetchFn = fetch) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const q = cursor
      ? `query ($c: String!) { next_items_page (limit: 200, cursor: $c) { cursor items { id name updated_at group { title } column_values (ids: ${JSON.stringify(JOB_COLUMNS)}) { id text ${FILES_FRAGMENT} } } } }`
      : `query { boards (ids: [${B.id}]) { items_page (limit: 200) { cursor items { id name updated_at group { title } column_values (ids: ${JSON.stringify(JOB_COLUMNS)}) { id text ${FILES_FRAGMENT} } } } } }`;
    const d = await gql(env, q, cursor ? { c: cursor } : {}, fetchFn);
    const p = cursor ? d.next_items_page : d.boards[0].items_page;
    out.push(...p.items.map(jobFromItem));
    cursor = p.cursor;
    if (!cursor) break;
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getJobItem(env, itemId, fetchFn = fetch) {
  const d = await gql(env, `query ($id: [ID!]) { items (ids: $id) { id name updated_at board { id } group { title } column_values (ids: ${JSON.stringify(JOB_COLUMNS)}) { id text ${FILES_FRAGMENT} } } }`, { id: [String(itemId)] }, fetchFn);
  const item = d.items && d.items[0];
  if (!item || String(item.board.id) !== String(B.id)) return null;
  return jobFromItem(item);
}

export async function findByTakeoffId(env, takeoffId, fetchFn = fetch) {
  const d = await gql(env, `query ($v: [String]!) { items_page_by_column_values (board_id: ${B.id}, limit: 5, columns: [{ column_id: "${C.takeoffId}", column_values: $v }]) { items { id } } }`, { v: [takeoffId] }, fetchFn);
  const items = d.items_page_by_column_values.items;
  return items.length ? String(items[0].id) : null;
}

export async function assetUrl(env, assetId, fetchFn = fetch) {
  const d = await gql(env, 'query ($id: [ID!]!) { assets (ids: $id) { id name file_size public_url } }', { id: [String(assetId)] }, fetchFn);
  return d.assets && d.assets[0];
}

// What the app writes on every save. Price and margin come from calc.js, the same maths as the app.
export function jobColumnValues(est, m, openChecks, takeoffId) {
  const j = est.job;
  const vals = {
    [C.client]: j.client || '',
    [C.address]: j.address || '',
    [C.jobType]: { label: j.type === 'commercial' ? 'Commercial' : 'Residential' },
    [C.openChecks]: String(openChecks),
    [C.takeoffId]: takeoffId
  };
  vals[C.bidDue] = /^\d{4}-\d{2}-\d{2}$/.test(j.bidDue || '') ? { date: j.bidDue } : null;
  vals[C.estimateClass] = ['A', 'B', 'C', 'D'].includes(j.class) ? { label: j.class } : null;
  vals[C.price] = typeof m.base.price === 'number' ? String(Math.round(m.base.price * 100) / 100) : '';
  vals[C.margin] = typeof m.base.margin === 'number' ? String(Math.round(m.base.margin * 1000) / 10) : '';
  return vals;
}

export async function createJobItem(env, name, values, fetchFn = fetch) {
  const vals = Object.assign({ [C.status]: { label: 'Drafting' } }, values);
  const d = await gql(env, `mutation ($name: String!, $vals: JSON!) { create_item (board_id: ${B.id}, group_id: "${B.newGroup}", item_name: $name, column_values: $vals) { id } }`,
    { name, vals: JSON.stringify(vals) }, fetchFn);
  return String(d.create_item.id);
}

export async function updateJobItem(env, itemId, name, values, fetchFn = fetch) {
  await gql(env, `mutation ($id: ID!, $vals: JSON!) { change_multiple_column_values (board_id: ${B.id}, item_id: $id, column_values: $vals) { id } }`,
    { id: String(itemId), vals: JSON.stringify(Object.assign({ name }, values)) }, fetchFn);
}

// ---------- Activity log ----------

export async function logActivity(env, action, name, itemId, detail, fetchFn = fetch, now = new Date()) {
  const A = BOARDS.activity, K = A.col;
  const iso = now.toISOString();
  const vals = {
    [K.when]: { date: iso.slice(0, 10), time: iso.slice(11, 19) },
    [K.action]: { label: action },
    [K.detail]: { text: detail || '' }
  };
  if (itemId) vals[K.job] = { item_ids: [Number(itemId)] };
  try {
    await gql(env, `mutation ($name: String!, $vals: JSON!) { create_item (board_id: ${A.id}, item_name: $name, column_values: $vals) { id } }`,
      { name: String(name).slice(0, 250), vals: JSON.stringify(vals) }, fetchFn);
    return true;
  } catch (e) {
    return false; // the log never stops the real work
  }
}
