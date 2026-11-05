'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../app/js/calc.js');
const PM = require('../app/js/postmortem.js');
const { fakeMonday, withBoards } = require('./fixtures/fake-monday.js');
const { planEstimate, fillCosts, assemblyId } = require('./fixtures/library.js');

function finishedJob() {
  const est = fillCosts(planEstimate('residential'), 2);
  est.job.name = 'Smith basement suite';
  est.settings.contingencyPct = 5;
  est.lines.push({ id: 'l1', division: '01', description: 'Site supervision', scope: '', location: '', qty: 20, unit: 'hr', unitCost: 68, type: 'L', allowance: false, alternateId: null, source: 'owner', status: 'ok', basis: '' });
  est.lines.push({ id: 'l2', division: '09', description: 'Paint', scope: '', location: '', qty: 1000, unit: 'sf', unitCost: 1.5, type: 'S', allowance: false, alternateId: null, source: 'owner', status: 'ok', basis: '' });
  return est;
}

test('post-mortem: sections match the estimate, and profit is worked out from the actuals', () => {
  const est = finishedJob();
  const m = calc.money(est);
  const r = PM.compute(est, { actuals: { '01': 1500, '09': 1800 }, changeOrders: [{ description: 'Extra outlet', price: 400, cost: 250 }], actualHours: 26 });
  const s01 = r.sections.find(s => s.division === '01');
  assert.equal(s01.estimated, 1360);
  assert.equal(s01.hours, 20);
  assert.ok(Math.abs(s01.pct - (1500 - 1360) / 1360) < 1e-12);
  assert.equal(s01.off, true, '10.3% over is more than 10%');
  const s09 = r.sections.find(s => s.division === '09');
  assert.equal(s09.estimated, 1500);
  assert.equal(s09.off, true, '20% over');
  // Estimated sections plus travel and contingency make the estimate's cost.
  assert.ok(Math.abs(r.sections.reduce((a, s) => a + s.estimated, 0) + r.extras - m.base.cost) < 0.01);
  assert.equal(r.contract, calc.round2(m.base.price + 400));
  assert.equal(r.actualCost, 1500 + 1800 + 250);
  assert.equal(r.profit, calc.round2(r.contract - r.actualCost));
  assert.ok(Math.abs(r.margin - r.profit / r.contract) < 1e-12);
  assert.equal(r.target, 35);
  assert.equal(r.estimatedHours, 20);
  assert.equal(r.actualHours, 26);
  assert.equal(r.complete, true);
});

test('post-mortem: a typed actual wins over QuickBooks, and QuickBooks fills what is not typed', () => {
  const est = finishedJob();
  const r = PM.compute(est, { actuals: { '01': 1400 }, qbo: { '01': 9999, '09': 1450 } });
  assert.equal(r.sections.find(s => s.division === '01').actual, 1400);
  assert.equal(r.sections.find(s => s.division === '01').actualFrom, 'typed');
  assert.equal(r.sections.find(s => s.division === '09').actual, 1450);
  assert.equal(r.sections.find(s => s.division === '09').actualFrom, 'QuickBooks');
  const none = PM.compute(est, {});
  assert.equal(none.actualCost, null);
  assert.equal(none.profit, null);
  assert.deepEqual(none.missing, none.sections.map(s => s.label));
});

test('post-mortem: price book offers move the costs used in a section by the same share', () => {
  const est = finishedJob();
  est.rooms.push({ id: 'r1', name: 'Rec room', location: '', lengthFt: 20, widthFt: 14, heightFt: 8, doors: 1, windows: 0,
    floorAssemblyId: assemblyId(est, 'LVP flooring with underlay'), wallAssemblyId: null, ceilingAssemblyId: null, baseAssemblyId: null, status: 'ok' });
  const used = calc.money(est).lines.filter(l => l.code && l.division === '09');
  assert.ok(used.length, 'the test plan prices division 09 from the price book');
  const r = PM.compute(est, { actuals: Object.fromEntries(calc.money(est).lines.map(l => [l.division, null])) });
  r.sections.forEach(s => { s.actual = calc.round2(s.estimated * 1.25); s.pct = 0.25; s.off = true; });
  const offers = PM.priceBookOffers(est, r);
  assert.ok(offers.length);
  for (const o of offers) {
    assert.equal(o.current, 2);
    assert.equal(o.proposed, 2.5);
  }
  assert.equal(est.priceBook.find(p => p.code === offers[0].code).unitCost, 2, 'nothing in the price book changes');
});

test('post-mortem: change orders go to Monday.com as plain lines and come back the same', () => {
  const list = [{ description: 'Extra outlet', price: 400, cost: 250 }, { description: 'Move door', price: null, cost: 120 }];
  const text = PM.changeOrdersToText(list);
  assert.equal(text, 'Extra outlet | 400 | 250\nMove door |  | 120');
  assert.deepEqual(PM.changeOrdersFromText(text), list);
});

// ---------- Server ----------

const ENV = { APP_PASSCODE: 'p'.repeat(16), SESSION_SECRET: 's'.repeat(48), MONDAY_API_TOKEN: 'monday-secret-token' };
const NOW = Date.parse('2026-11-05T12:00:00Z');
const load = () => Promise.all([import('../netlify/lib/session.mjs'), import('../netlify/lib/monday.mjs'), import('../netlify/lib/jobs.mjs'), import('../netlify/lib/postmortems.mjs')]);

function req(S, url, { method = 'GET', body, signedIn = true } = {}) {
  const headers = {};
  if (signedIn) headers.cookie = S.COOKIE + '=' + encodeURIComponent(S.sign(ENV, { exp: NOW + 60000 }));
  if (body !== undefined) { body = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  return new Request('https://steadfast-takeoff.netlify.app' + url, { method, body, headers });
}

test('saving a post-mortem works the numbers out on the server and links it to the estimate', async () => {
  const [S, M, J, P] = await load();
  const fake = fakeMonday(M);
  const mon = withBoards(M, fake);
  const deps = { env: ENV, fetch: mon.fetch, now: () => NOW };
  const est = finishedJob();
  const saved = await (await J.jobs(req(S, '/api/jobs', { method: 'POST', body: { estimate: est } }), deps)).json();

  assert.equal((await P.postmortems(req(S, '/api/postmortems/' + saved.itemId, { signedIn: false }), deps, { id: saved.itemId })).status, 401);
  const empty = await (await P.postmortems(req(S, '/api/postmortems/' + saved.itemId), deps, { id: saved.itemId })).json();
  assert.equal(empty.record, null);

  const record = { actuals: { '01': 1500, '09': 1800 }, changeOrders: [{ description: 'Extra outlet', price: 400, cost: 250 }], actualHours: 26,
    status: 'Done', wentWell: 'Clean handover', toChange: 'Order paint earlier', overWhy: 'Painter needed a second coat', qboProject: 'Smith' };
  // A number sent from the browser is ignored: the server works it out from the estimate on Monday.com.
  const res = await P.postmortems(req(S, '/api/postmortems/' + saved.itemId, { method: 'POST', body: { record, result: { profit: 1 } } }), deps, { id: saved.itemId });
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  const expect = PM.compute(calc.normalize(calc.clone(est)), record);
  assert.equal(out.result.profit, expect.profit);

  const pm = mon.pms[0];
  const C = M.BOARDS.postMortems.col;
  assert.equal(pm.name, 'Post-mortem: Smith basement suite');
  assert.deepEqual(pm.vals[C.estimate], { item_ids: [Number(saved.itemId)] });
  assert.equal(Number(pm.vals[C.actualCost]), expect.actualCost);
  assert.equal(Number(pm.vals[C.contract]), expect.contract);
  assert.deepEqual(pm.vals[C.status], { label: 'Done' });
  assert.equal(pm.vals[C.coList].text, 'Extra outlet | 400 | 250');
  assert.equal(pm.subs.length, expect.sections.length);
  assert.equal(pm.subs.find(s => s.name.startsWith('09')).vals.note, 'Off by 20%');

  // Reading it back gives the same record, and saving again updates the same item.
  const back = await (await P.postmortems(req(S, '/api/postmortems/' + saved.itemId), deps, { id: saved.itemId })).json();
  assert.deepEqual(back.record.actuals, { '01': 1500, '09': 1800 });
  assert.deepEqual(back.record.changeOrders, record.changeOrders);
  assert.equal(back.record.overWhy, 'Painter needed a second coat');
  await P.postmortems(req(S, '/api/postmortems/' + saved.itemId, { method: 'POST', body: { record: Object.assign({}, record, { actuals: { '01': 1600, '09': 1800 } }) } }), deps, { id: saved.itemId });
  assert.equal(mon.pms.length, 1);
  assert.equal(mon.pms[0].subs.length, expect.sections.length);
  assert.equal(mon.pms[0].subs.find(s => s.name.startsWith('01')).vals.act, '1600');
  assert.ok(mon.activity.some(a => a.vals[M.BOARDS.activity.col.action].label === 'Post-mortem'));
});

test('a price book flag marks the item "check" with the reason and never changes the cost', async () => {
  const [S, M, , P] = await load();
  const mon = withBoards(M, fakeMonday(M));
  const deps = { env: ENV, fetch: mon.fetch, now: () => NOW };
  const out = await (await P.flagPrice(req(S, '/api/pricebook/flag', { method: 'POST', body: { code: '09-PNT', note: 'Post-mortem Smith: 09 Finishes 20% over' } }), deps)).json();
  assert.equal(out.found, true);
  const B = M.BOARDS.priceBook.col;
  assert.deepEqual(mon.flags[0].vals, { [B.status]: { label: 'check' }, [B.sourceDetail]: 'Post-mortem Smith: 09 Finishes 20% over' });
  assert.ok(!(B.unitCost in mon.flags[0].vals), 'the unit cost is left alone');
  const missing = await (await P.flagPrice(req(S, '/api/pricebook/flag', { method: 'POST', body: { code: '99-XXX', note: '' } }), deps)).json();
  assert.equal(missing.found, false);
  assert.equal((await P.flagPrice(req(S, '/api/pricebook/flag', { method: 'POST', body: { code: 'bad code!' } }), deps)).status, 400);
});
