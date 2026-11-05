'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV = { APP_PASSCODE: 'p'.repeat(16), SESSION_SECRET: 's'.repeat(48), MONDAY_API_TOKEN: 'monday-token',
  QBO_CLIENT_ID: 'id', QBO_CLIENT_SECRET: 'secret', QBO_ENVIRONMENT: 'sandbox' };
const NOW = Date.parse('2026-11-09T14:00:00Z');
const load = () => Promise.all([import('../netlify/lib/session.mjs'), import('../netlify/lib/qbo.mjs'), import('../netlify/lib/qbodata.mjs'),
  import('../netlify/lib/pricecheck.mjs'), import('../netlify/lib/monday.mjs')]);

const BOOK = [
  { id: '1', name: 'Luxury vinyl plank', code: '09-LVP', unitCost: 3.4, status: 'ok', sourceDetail: '', division: '09' },
  { id: '2', name: 'Drywall 1/2"', code: '09-GYP', unitCost: 0.62, status: 'ok', sourceDetail: '', division: '09' },
  { id: '3', name: '2x4 stud', code: '06-STD', unitCost: 6.5, status: 'ok', sourceDetail: '', division: '06' },
  { id: '4', name: 'Pot light', code: '26-POT', unitCost: null, status: 'ok', sourceDetail: '', division: '26' }
];
const ITEMS = [
  { Id: '10', Name: 'LVP Coretec 7"', Sku: '09-LVP' },
  { Id: '11', Name: '[09-GYP] Drywall 1/2 in' },
  { Id: '12', Name: '2x4 stud' },
  { Id: '13', Name: 'Pot light 4 in' },
  { Id: '14', Name: 'Shop rags' }
];
const itemLine = (id, name, price, qty, customer) => ({ Amount: price * qty, DetailType: 'ItemBasedExpenseLineDetail',
  ItemBasedExpenseLineDetail: { ItemRef: { value: id, name }, UnitPrice: price, Qty: qty, CustomerRef: customer ? { value: customer } : undefined } });
const BILLS = [
  { Id: 'b1', DocNumber: '1042', TxnDate: '2026-11-03', VendorRef: { name: 'Home Depot' }, Line: [
    itemLine('10', 'LVP Coretec 7"', 3.62, 800, '77'),   // +6.5%, flagged
    itemLine('11', '[09-GYP] Drywall 1/2 in', 0.63, 1000, '77'), // +1.6%, steady
    itemLine('14', 'Shop rags', 12, 2, '77') ] },        // no code
  { Id: 'b2', DocNumber: '1050', TxnDate: '2026-11-06', VendorRef: { name: 'Taiga' }, Line: [
    itemLine('12', '2x4 stud', 5.9, 200, '88'),           // -9.2%, flagged
    itemLine('13', 'Pot light 4 in', 31, 10, '77'),       // no code match by name: not in the book by that name
    { Amount: 450, DetailType: 'AccountBasedExpenseLineDetail', Description: 'Disposal bin [01-BIN]', AccountBasedExpenseLineDetail: { AccountRef: { value: '5' }, CustomerRef: { value: '77' } } } ] }
];

test('matching: SKU, code in the name or description, then the price book name', async () => {
  const [, , D] = await load();
  const match = D.matcher(BOOK, ITEMS);
  const codes = BILLS.flatMap(b => D.costLines(b, match)).map(l => l.code);
  assert.deepEqual(codes, ['09-LVP', '09-GYP', null, '06-STD', null, null]);
  assert.equal(D.codeFromText('Disposal bin [01-BIN]', new Set(['01-BIN'])), '01-BIN');
  assert.equal(D.codeFromText('see 99-XXX', new Set(['01-BIN'])), null, 'only codes in the book count');
});

test('price check: a bill price more than 5% from the book is flagged, with the bill named', async () => {
  const [, , D, P] = await load();
  const out = P.compare(BOOK, BILLS, D.matcher(BOOK, ITEMS));
  assert.deepEqual(out.flags.map(f => [f.code, f.bill]), [['09-LVP', 3.62], ['06-STD', 5.9]]);
  assert.deepEqual(out.steady.map(f => f.code), ['09-GYP']);
  const lvp = out.flags[0];
  assert.equal(P.detailText(lvp), 'Bill 1042, Home Depot, 2026-11-03: $3.62 against the book $3.40 (+6.5%)');
  assert.equal(P.detailText(out.flags[1]), 'Bill 1050, Taiga, 2026-11-06: $5.90 against the book $6.50 (-9.2%)');
  assert.equal(out.unmatchedCount, 2);
  // Exactly 5% is not more than 5%.
  const edge = P.compare([{ code: '09-LVP', name: 'x', id: '1', unitCost: 100 }], [{ TxnDate: '2026-11-01', Line: [itemLine('10', 'x', 105, 1)] }], D.matcher([{ code: '09-LVP', name: 'x' }], ITEMS));
  assert.equal(edge.flags.length, 0);
});

test('project costs: lines charged to the project, by division, with the rest listed apart', async () => {
  const [, , D, P] = await load();
  const txns = BILLS.map(txn => ({ txn, kind: 'Bill' }));
  const out = P.costsByDivision(BOOK, txns, '77', D.matcher(BOOK, ITEMS));
  assert.deepEqual(out.byDivision, { '09': 3.62 * 800 + 630 });
  assert.equal(out.lines, 5);
  assert.deepEqual(out.unmatched.map(u => u.amount), [24, 310, 450], 'rags, the pot lights and the bin (01-BIN is not in this book)');
  assert.equal(out.total, 3.62 * 800 + 630 + 24 + 310 + 450);
});

// A fake QuickBooks and Monday.com: records every call so the tests can see nothing is written to QuickBooks.
async function setup() {
  const [S, Q, D, P, M] = await load();
  const blobs = new Map();
  const store = { get: async (k, o) => { const v = blobs.get(k); return v === undefined ? null : o && o.type === 'json' ? JSON.parse(v) : v; },
    set: async (k, v) => { blobs.set(k, v); }, setJSON: async (k, v) => { blobs.set(k, JSON.stringify(v)); }, delete: async k => { blobs.delete(k); } };
  await Q.saveTokens(ENV, store, { realmId: '9130', accessToken: 'acc', refreshToken: 'ref', accessExpires: NOW + 3600000, refreshExpires: NOW + 86400000 });
  const calls = [];
  const writes = [];
  const book = BOOK.map(b => Object.assign({}, b));
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    if (String(url).includes('quickbooks.api.intuit.com')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('query'));
      const start = Number(q.match(/STARTPOSITION (\d+)/)[1]);
      let rows = [];
      if (/from Item/.test(q)) rows = ITEMS;
      else if (/from Bill/.test(q)) rows = BILLS;
      else if (/from Purchase/.test(q)) rows = [];
      else if (/from Customer/.test(q)) rows = [{ Id: '77', DisplayName: 'Smith basement', Job: true }, { Id: '5', DisplayName: 'Walk-in', Job: false }];
      const key = (q.match(/from (\w+)/) || [])[1];
      return new Response(JSON.stringify({ QueryResponse: start === 1 ? { [key]: rows } : {} }), { status: 200 });
    }
    if (String(url) === M.API_URL) {
      const { query, variables } = JSON.parse(opts.body);
      const ok = data => new Response(JSON.stringify({ data }));
      const C = M.BOARDS.priceBook.col;
      if (query.includes(`boards (ids: [${M.BOARDS.priceBook.id}])`)) {
        return ok({ boards: [{ items_page: { items: book.map(b => ({ id: b.id, name: b.name, column_values: [
          { id: C.code, text: b.code }, { id: C.unitCost, text: b.unitCost === null ? '' : String(b.unitCost) },
          { id: C.status, text: b.status }, { id: C.sourceDetail, text: b.sourceDetail }, { id: C.division, text: b.division }] })) } }] });
      }
      if (query.includes('change_multiple_column_values')) {
        const vals = JSON.parse(variables.vals);
        writes.push({ id: variables.id, vals });
        const b = book.find(x => x.id === variables.id);
        if (b) { b.status = vals[C.status].label; b.sourceDetail = vals[C.sourceDetail]; }
        return ok({ change_multiple_column_values: { id: variables.id } });
      }
      if (query.includes('create_item')) return ok({ create_item: { id: '1' } });
    }
    throw new Error('Unexpected call ' + url);
  };
  const env = Object.assign({}, ENV, { QBO_ENVIRONMENT: 'production' });
  const deps = { env, fetch: fetchFn, store: async () => store, now: () => NOW };
  const req = (url, { method = 'GET', body, signedIn = true } = {}) => new Request('https://x' + url, { method, body: body ? JSON.stringify(body) : undefined,
    headers: Object.assign({ 'content-type': 'application/json' }, signedIn ? { cookie: S.COOKIE + '=' + encodeURIComponent(S.sign(ENV, { exp: NOW + 60000 })) } : {}) });
  return { S, Q, D, P, M, deps, calls, writes, book, blobs, req };
}

test('running the price check marks moved prices "check" on Monday.com and never writes to QuickBooks', async () => {
  const t = await setup();
  assert.equal((await t.P.pricecheck(t.req('/api/pricecheck', { method: 'POST', signedIn: false }), t.deps)).status, 401);
  const res = await t.P.pricecheck(t.req('/api/pricecheck', { method: 'POST', body: { days: 7 } }), t.deps);
  const out = (await res.json()).last;
  assert.equal(res.status, 200, JSON.stringify(out));
  assert.equal(out.written, 2);
  const C = t.M.BOARDS.priceBook.col;
  assert.deepEqual(t.writes.map(w => w.id), ['1', '3']);
  for (const w of t.writes) {
    assert.deepEqual(w.vals[C.status], { label: 'check' });
    assert.deepEqual(w.vals[C.source], { label: 'QuickBooks bill' });
    assert.ok(!(C.unitCost in w.vals), 'the unit cost is never changed');
  }
  assert.equal(t.book[0].unitCost, 3.4);
  const qbo = t.calls.filter(c => c.url.includes('intuit.com'));
  assert.ok(qbo.length >= 2);
  assert.ok(qbo.every(c => c.method === 'GET'), 'QuickBooks is only read');
  assert.ok(qbo.some(c => decodeURIComponent(c.url).includes("TxnDate >= '2026-11-02'")), 'the last 7 days of bills');

  // A second run finds the same bills and leaves the items alone: they are already marked.
  const again = (await (await t.P.pricecheck(t.req('/api/pricecheck', { method: 'POST' }), t.deps)).json()).last;
  assert.equal(again.written, 0);
  assert.ok(again.flags.every(f => f.already));
  const last = (await (await t.P.pricecheck(t.req('/api/pricecheck'), t.deps)).json()).last;
  assert.equal(last.ranAt, new Date(NOW).toISOString());
});

test('projects and project costs need sign-in and read QuickBooks only', async () => {
  const t = await setup();
  assert.equal((await t.P.qboProjects(t.req('/api/qbo/projects', { signedIn: false }), t.deps)).status, 401);
  const list = await (await t.P.qboProjects(t.req('/api/qbo/projects'), t.deps)).json();
  assert.deepEqual(list.projects, [{ id: '77', name: 'Smith basement', fullName: 'Smith basement' }]);
  const costs = await (await t.P.qboProjects(t.req('/api/qbo/projects/77/costs'), t.deps, { id: '77' })).json();
  assert.equal(costs.byDivision['09'], 3.62 * 800 + 630);
  assert.ok(t.calls.filter(c => c.url.includes('intuit.com')).every(c => c.method === 'GET'));
});

test('not connected: the price check says so instead of failing quietly', async () => {
  const t = await setup();
  t.blobs.delete('tokens');
  const res = await t.P.pricecheck(t.req('/api/pricecheck', { method: 'POST' }), t.deps);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /not connected/);
});
