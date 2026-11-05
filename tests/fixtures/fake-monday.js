'use strict';
// A small in-memory Monday.com for the tests and the local preview: one Estimates board,
// files kept as text, and the Activity log. Pass the board config from netlify/lib/monday.mjs.
const NOW = Date.parse('2026-10-23T12:00:00Z');

function fakeMonday(M) {
  const items = new Map();
  const assets = new Map();
  const activity = [];
  const calls = [];
  let nextId = 5000, nextAsset = 9000;
  const col = M.BOARDS.estimates.col;
  const itemOut = it => ({
    id: it.id, name: it.name, updated_at: it.updated, board: { id: String(M.BOARDS.estimates.id) }, group: { title: 'In progress' },
    column_values: Object.values(col).map(c => ({ id: c, text: typeof it.vals[c] === 'object' && it.vals[c] ? (it.vals[c].label || it.vals[c].date || '') : (it.vals[c] || ''),
      files: (it.files[c] || []).map(a => ({ asset_id: a, name: assets.get(a).name, created_at: assets.get(a).created })) }))
  });
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === M.FILE_URL) {
      const q = opts.body.get('query');
      const itemId = q.match(/item_id: (\d+)/)[1];
      const column = q.match(/column_id: "([^"]+)"/)[1];
      const file = opts.body.get('variables[file]');
      const id = String(nextAsset++);
      const bytes = new Uint8Array(await file.arrayBuffer());
      assets.set(id, { name: file.name, type: file.type, bytes, text: new TextDecoder().decode(bytes), created: new Date(NOW + Number(id)).toISOString() });
      const it = items.get(itemId);
      (it.files[column] = it.files[column] || []).push(id);
      return new Response(JSON.stringify({ data: { add_file_to_column: { id } } }));
    }
    if (url.startsWith('https://files.example/')) {
      const a = assets.get(url.split('/').pop());
      return new Response(a.bytes, { headers: { 'content-type': a.type || 'application/octet-stream' } });
    }
    const { query, variables } = JSON.parse(opts.body);
    const ok = data => new Response(JSON.stringify({ data }));
    if (query.includes('items_page_by_column_values')) {
      const found = [...items.values()].filter(it => it.vals[col.takeoffId] === variables.v[0]).map(it => ({ id: it.id }));
      return ok({ items_page_by_column_values: { items: found } });
    }
    if (query.includes('create_item') && query.includes(String(M.BOARDS.activity.id))) {
      activity.push({ name: variables.name, vals: JSON.parse(variables.vals) });
      return ok({ create_item: { id: '1' } });
    }
    if (query.includes('create_item')) {
      const id = String(nextId++);
      items.set(id, { id, name: variables.name, vals: JSON.parse(variables.vals), files: {}, updated: new Date(NOW).toISOString() });
      return ok({ create_item: { id } });
    }
    if (query.includes('change_multiple_column_values')) {
      const it = items.get(variables.id);
      const vals = JSON.parse(variables.vals);
      it.name = vals.name;
      delete vals.name;
      Object.assign(it.vals, vals);
      return ok({ change_multiple_column_values: { id: it.id } });
    }
    if (query.includes('assets')) {
      return ok({ assets: variables.id.map(id => ({ id, name: assets.get(id).name, file_size: 1, public_url: 'https://files.example/' + id })) });
    }
    if (query.includes('items (ids')) {
      return ok({ items: variables.id.filter(id => items.has(id)).map(id => itemOut(items.get(id))) });
    }
    if (query.includes('items_page')) {
      return ok({ boards: [{ items_page: { cursor: null, items: [...items.values()].map(itemOut) } }] });
    }
    throw new Error('Unexpected query: ' + query.slice(0, 80));
  };
  return { items, assets, activity, calls, fetch: fetchFn };
}


// The fake Monday.com from the job tests, plus the Post-mortems, Jobs and Price book boards.
function withBoards(M, fake) {
  const pms = [];
  const flags = [];
  let nextId = 7000;
  const P = M.BOARDS.postMortems;
  const ok = data => new Response(JSON.stringify({ data }));
  const fetchFn = async (url, opts = {}) => {
    if (url !== M.API_URL) return fake.fetch(url, opts);
    const { query, variables } = JSON.parse(opts.body);
    if (query.includes(`boards (ids: [${P.id}])`)) {
      return ok({ boards: [{ items_page: { items: pms.map(p => ({ id: p.id, name: p.name,
        column_values: Object.entries(p.vals).map(([id, v]) => ({ id, text: typeof v === 'object' && v ? (v.text ?? v.label ?? v.date ?? '') : String(v), linked_item_ids: v && v.item_ids ? v.item_ids.map(String) : undefined })),
        subitems: p.subs.map(s => ({ id: s.id, name: s.name, board: { id: '999' }, column_values: Object.entries(s.vals).map(([id, v]) => ({ id, text: String(v) })) })) })) } }] });
    }
    if (query.includes(`boards (ids: [${M.BOARDS.jobs.id}])`)) return ok({ boards: [{ items_page: { items: [] } }] });
    if (query.includes(`create_item (board_id: ${P.id}`)) {
      const p = { id: String(nextId++), name: variables.name, vals: JSON.parse(variables.vals), subs: [] };
      pms.push(p);
      return ok({ create_item: { id: p.id } });
    }
    if (query.includes(`change_multiple_column_values (board_id: ${P.id}`)) {
      const p = pms.find(x => x.id === variables.id);
      const vals = JSON.parse(variables.vals);
      p.name = vals.name; delete vals.name;
      Object.assign(p.vals, vals);
      return ok({ change_multiple_column_values: { id: p.id } });
    }
    if (query.includes('change_multiple_column_values (board_id: $board')) {
      for (const p of pms) for (const s of p.subs) if (s.id === variables.id) Object.assign(s.vals, JSON.parse(variables.vals));
      return ok({ change_multiple_column_values: { id: variables.id } });
    }
    if (query.includes('create_subitem')) {
      const p = pms.find(x => x.id === variables.parent);
      const s = { id: String(nextId++), name: variables.name, vals: JSON.parse(variables.vals) };
      p.subs.push(s);
      return ok({ create_subitem: { id: s.id } });
    }
    if (query.includes(`items_page_by_column_values (board_id: ${M.BOARDS.priceBook.id}`)) {
      return ok({ items_page_by_column_values: { items: variables.v[0] === '09-PNT' ? [{ id: '555', name: 'Paint walls' }] : [] } });
    }
    if (query.includes(`change_multiple_column_values (board_id: ${M.BOARDS.priceBook.id}`)) {
      flags.push({ id: variables.id, vals: JSON.parse(variables.vals) });
      return ok({ change_multiple_column_values: { id: variables.id } });
    }
    return fake.fetch(url, opts);
  };
  return { pms, flags, fetch: fetchFn, activity: fake.activity };
}

module.exports = { fakeMonday, withBoards };
