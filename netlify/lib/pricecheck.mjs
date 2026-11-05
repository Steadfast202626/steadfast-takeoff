/*
 * Steadfast takeoff: the weekly price check and project costs, from QuickBooks to Monday.com.
 *
 * Price check: bill lines from the last week are matched to price book codes. When a bill's unit price
 * is more than 5% away from the cost on the Monday.com Price book board, the item is marked Price
 * status "check", Cost source "QuickBooks bill", with the bill and both prices in Source detail.
 * The unit cost itself is never changed: Kamal approves it on Monday.com.
 *
 * Project costs: every bill and expense line charged to a QuickBooks project, by CSI division,
 * for the post-mortem's QuickBooks column. Lines that match no price book code are listed apart.
 */
import * as M from './monday.mjs';
import * as D from './qbodata.mjs';
import * as S from './session.mjs';
import { json } from './jobs.mjs';

export const MOVE_LIMIT = 0.05;
const LAST_KEY = 'pricecheck-last';
const B = M.BOARDS.priceBook, C = B.col;
const now = deps => (deps.now ? deps.now() : Date.now());
const round2 = v => Math.round(v * 100) / 100;

// The Monday.com price book: { id, name, code, unitCost, status, sourceDetail, division }.
export async function readPriceBook(env, fetchFn) {
  const ids = [C.code, C.unitCost, C.status, C.sourceDetail, C.division];
  const d = await M.gql(env, `query { boards (ids: [${B.id}]) { items_page (limit: 500) { items { id name column_values (ids: ${JSON.stringify(ids)}) { id text } } } } }`, {}, fetchFn);
  return d.boards[0].items_page.items.map(it => {
    const v = {};
    for (const cv of it.column_values) v[cv.id] = cv.text || '';
    const cost = v[C.unitCost] === '' ? null : Number(v[C.unitCost]);
    return { id: String(it.id), name: it.name, code: v[C.code].trim().toUpperCase(), unitCost: isFinite(cost) ? cost : null,
      status: v[C.status], sourceDetail: v[C.sourceDetail], division: (v[C.division] || v[C.code].slice(0, 2)).trim() };
  }).filter(b => b.code);
}

// Pure: compare matched bill lines to the book. Returns what to flag and what was seen.
export function compare(book, bills, match) {
  const byCode = new Map(book.map(b => [b.code, b]));
  const latest = new Map(); // code -> newest bill line with a unit price
  let lines = 0, matched = 0;
  const unmatched = [];
  for (const bill of bills) {
    for (const l of D.costLines(bill, match)) {
      lines++;
      if (!l.code) { if (l.unitPrice !== null) unmatched.push({ description: l.description, source: D.txnLabel(bill, 'Bill') }); continue; }
      matched++;
      if (l.unitPrice === null) continue;
      const prev = latest.get(l.code);
      if (!prev || String(bill.TxnDate) >= String(prev.date)) latest.set(l.code, { price: l.unitPrice, date: bill.TxnDate, source: D.txnLabel(bill, 'Bill') });
    }
  }
  const flags = [], noCost = [], steady = [];
  for (const [code, seen] of latest) {
    const b = byCode.get(code);
    if (!b) continue;
    if (b.unitCost === null || b.unitCost === 0) { noCost.push({ code, name: b.name, bill: seen.price, source: seen.source }); continue; }
    const move = (seen.price - b.unitCost) / b.unitCost;
    const entry = { code, name: b.name, itemId: b.id, book: b.unitCost, bill: round2(seen.price), pct: move, source: seen.source };
    if (Math.abs(move) > MOVE_LIMIT) flags.push(entry); else steady.push(entry);
  }
  return { lines, matched, unmatched: unmatched.slice(0, 50), unmatchedCount: unmatched.length, flags, noCost, steady };
}

export function detailText(f) {
  const pct = (f.pct > 0 ? '+' : '') + (f.pct * 100).toFixed(1) + '%';
  return f.source + ': $' + f.bill.toFixed(2) + ' against the book $' + f.book.toFixed(2) + ' (' + pct + ')';
}

export async function runPriceCheck(env, deps, days = 7) {
  const store = await deps.store();
  const t = now(deps);
  const [book, qboItems, billList] = await Promise.all([
    readPriceBook(env, deps.fetch),
    D.items(env, store, deps.fetch, t),
    D.bills(env, store, days, deps.fetch, t)
  ]);
  const result = compare(book, billList, D.matcher(book, qboItems));
  let written = 0;
  for (const f of result.flags) {
    const detail = detailText(f);
    const b = book.find(x => x.code === f.code);
    if (b.status === 'check' && b.sourceDetail === detail) { f.already = true; continue; } // flagged by an earlier run
    await M.gql(env, `mutation ($id: ID!, $vals: JSON!) { change_multiple_column_values (board_id: ${B.id}, item_id: $id, column_values: $vals) { id } }`,
      { id: f.itemId, vals: JSON.stringify({ [C.status]: { label: 'check' }, [C.source]: { label: 'QuickBooks bill' }, [C.sourceDetail]: detail.slice(0, 250) }) }, deps.fetch);
    written++;
  }
  const summary = Object.assign({ ranAt: new Date(t).toISOString(), days, bills: billList.length, written, bookItems: book.length }, result);
  await store.setJSON(LAST_KEY, summary);
  await M.logActivity(env, 'Price check', 'Price check: ' + result.flags.length + (result.flags.length === 1 ? ' price moved' : ' prices moved'), null,
    billList.length + ' bills from the last ' + days + ' days, ' + result.matched + ' of ' + result.lines + ' lines matched to the price book.\n' +
    result.flags.map(detailText).map((x, i) => result.flags[i].code + ' ' + x).join('\n'), deps.fetch, new Date(t));
  return summary;
}

// GET: the last run. POST { days }: run now. Both need the team sign-in.
export async function pricecheck(req, deps) {
  const { env } = deps;
  if (!S.signedIn(env, req, now(deps))) return json({ error: 'Sign in first.' }, 401);
  const store = await deps.store();
  if (req.method === 'GET') return json({ last: (await store.get(LAST_KEY, { type: 'json' })) || null });
  if (req.method !== 'POST') return json({ error: 'Not found.' }, 404);
  let body = {};
  try { body = await req.json(); } catch (e) { /* run with the default */ }
  const days = Math.min(90, Math.max(1, Math.round(Number(body.days) || 7)));
  try {
    return json({ last: await runPriceCheck(env, deps, days) });
  } catch (e) {
    return json({ error: e instanceof D.QboError || e instanceof M.MondayError ? e.message : 'The price check did not finish.' }, 502);
  }
}

// ---------- Project costs ----------

export function costsByDivision(book, txns, projectId, match) {
  const div = new Map(book.map(b => [b.code, b.division || b.code.slice(0, 2)]));
  const byDivision = {};
  const unmatched = [];
  let lines = 0, total = 0;
  for (const { txn, kind } of txns) {
    for (const l of D.costLines(txn, match)) {
      if (l.customerId !== String(projectId)) continue;
      lines++;
      total += l.amount;
      const d = l.code ? div.get(l.code) || l.code.slice(0, 2) : null;
      if (d) byDivision[d] = round2((byDivision[d] || 0) + l.amount);
      else unmatched.push({ description: l.description, amount: round2(l.amount), source: D.txnLabel(txn, kind) });
    }
  }
  return { byDivision, unmatched, unmatchedTotal: round2(unmatched.reduce((a, u) => a + u.amount, 0)), lines, total: round2(total) };
}

export async function qboProjects(req, deps, params = {}) {
  const { env } = deps;
  if (!S.signedIn(env, req, now(deps))) return json({ error: 'Sign in first.' }, 401);
  if (req.method !== 'GET') return json({ error: 'Not found.' }, 404);
  const store = await deps.store();
  const t = now(deps);
  try {
    if (!params.id) return json({ projects: await D.projects(env, store, deps.fetch, t) });
    if (!/^\d{1,20}$/.test(params.id)) return json({ error: 'Not found.' }, 404);
    const days = 730; // two years of bills and expenses covers any job Steadfast runs
    const [book, qboItems, billList, purchaseList] = await Promise.all([
      readPriceBook(env, deps.fetch), D.items(env, store, deps.fetch, t),
      D.bills(env, store, days, deps.fetch, t), D.purchases(env, store, days, deps.fetch, t)
    ]);
    const txns = billList.map(txn => ({ txn, kind: 'Bill' })).concat(purchaseList.map(txn => ({ txn, kind: 'Purchase' })));
    return json(Object.assign({ projectId: params.id }, costsByDivision(book, txns, params.id, D.matcher(book, qboItems))));
  } catch (e) {
    return json({ error: e instanceof D.QboError || e instanceof M.MondayError ? e.message : 'Could not read QuickBooks.' }, 502);
  }
}
