'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const load = () => Promise.all([
  import('../netlify/lib/session.mjs'),
  import('../netlify/lib/qbo.mjs'),
  import('../netlify/lib/handlers.mjs')
]);

const ENV = {
  APP_PASSCODE: 'correct horse battery staple',
  SESSION_SECRET: 'x'.repeat(48),
  QBO_CLIENT_ID: 'client-id',
  QBO_CLIENT_SECRET: 'client-secret',
  QBO_ENVIRONMENT: 'sandbox'
};
const NOW = Date.parse('2026-10-23T12:00:00Z');

function memoryStore() {
  const m = new Map();
  return { m, get: async k => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
}

function request(url, { method = 'GET', cookies = {}, body } = {}) {
  const cookie = Object.entries(cookies).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('; ');
  return new Request('https://steadfast-takeoff.netlify.app' + url, { method, body, headers: cookie ? { cookie } : {} });
}

const cookieValue = (res, name) => {
  const c = res.headers.get('set-cookie') || '';
  const m = c.match(new RegExp(name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
};

function fakeIntuit(calls) {
  return async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/tokens/bearer')) {
      const form = new URLSearchParams(opts.body);
      if (form.get('refresh_token') === 'dead') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'acc-' + calls.length, refresh_token: 'ref-' + calls.length, expires_in: 3600, x_refresh_token_expires_in: 8726400 }), { status: 200 });
    }
    if (url.includes('/revoke')) return new Response('', { status: 200 });
    return new Response('', { status: 404 });
  };
}

test('session: signed values round-trip, and tampering or expiry fails', async () => {
  const [S] = await load();
  const t = S.sign(ENV, { exp: NOW + 1000, a: 1 });
  assert.equal(S.unsign(ENV, t, NOW).a, 1);
  assert.equal(S.unsign(ENV, t, NOW + 2000), null, 'expired');
  assert.equal(S.unsign(ENV, t.slice(0, -2) + 'xx', NOW), null, 'tampered');
  assert.equal(S.unsign({ SESSION_SECRET: 'y'.repeat(48) }, t, NOW), null, 'other secret');
  assert.throws(() => S.sign({ SESSION_SECRET: 'short' }, { exp: 1 }), /SESSION_SECRET/);
});

test('session: next links stay on this site', async () => {
  const [S] = await load();
  assert.equal(S.safeNext('/api/qbo/connect'), '/api/qbo/connect');
  assert.equal(S.safeNext('//evil.example'), '/');
  assert.equal(S.safeNext('https://evil.example'), '/');
  assert.equal(S.safeNext(null), '/');
});

test('sign in: right passcode sets the cookie, wrong one does not', async () => {
  const [S, , H] = await load();
  const deps = { env: ENV, now: () => NOW };
  const good = await H.login(request('/api/login', { method: 'POST', body: 'passcode=' + encodeURIComponent(ENV.APP_PASSCODE) + '&next=%2Fapi%2Fqbo%2Fconnect' }), deps);
  assert.equal(good.status, 302);
  assert.equal(good.headers.get('location'), '/api/qbo/connect');
  assert.ok(S.unsign(ENV, cookieValue(good, S.COOKIE), NOW));
  assert.match(good.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const bad = await H.login(request('/api/login', { method: 'POST', body: 'passcode=nope' }), deps);
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);
  const unset = await H.login(request('/api/login'), { env: {}, now: () => NOW });
  assert.equal(unset.status, 500, 'fails closed without APP_PASSCODE');
});

test('QuickBooks connect: needs sign-in, then sends you to Intuit with a signed state', async () => {
  const [S, Q, H] = await load();
  const deps = { env: ENV, now: () => NOW };
  const out = await H.qboConnect(request('/api/qbo/connect'), deps);
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('location'), '/api/login?next=%2Fapi%2Fqbo%2Fconnect');

  const session = S.sign(ENV, { exp: NOW + 60000 });
  const res = await H.qboConnect(request('/api/qbo/connect', { cookies: { [S.COOKIE]: session } }), deps);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, Q.AUTHORIZE_URL);
  assert.equal(loc.searchParams.get('client_id'), 'client-id');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://steadfast-takeoff.netlify.app/api/qbo/callback');
  assert.equal(loc.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
  assert.equal(loc.searchParams.get('state'), cookieValue(res, 'sf_qbo_state'));
  assert.ok(S.unsign(ENV, loc.searchParams.get('state'), NOW));
});

test('QuickBooks callback: checks the state, saves encrypted tokens, never in plain text', async () => {
  const [S, Q, H] = await load();
  const store = memoryStore();
  const calls = [];
  const deps = { env: ENV, now: () => NOW, store: async () => store, fetch: fakeIntuit(calls) };
  const session = S.sign(ENV, { exp: NOW + 60000 });
  const state = S.sign(ENV, { exp: NOW + 60000, n: 'abc' });

  const forged = await H.qboCallback(request('/api/qbo/callback?code=c&realmId=123&state=' + encodeURIComponent(state),
    { cookies: { [S.COOKIE]: session, sf_qbo_state: 'other' } }), deps);
  assert.equal(forged.status, 400);
  assert.equal(store.m.size, 0, 'nothing saved on a bad state');

  const noSession = await H.qboCallback(request('/api/qbo/callback?code=c&realmId=123&state=' + encodeURIComponent(state),
    { cookies: { sf_qbo_state: state } }), deps);
  assert.equal(noSession.status, 401);

  const ok = await H.qboCallback(request('/api/qbo/callback?code=c&realmId=123&state=' + encodeURIComponent(state),
    { cookies: { [S.COOKIE]: session, sf_qbo_state: state } }), deps);
  assert.equal(ok.status, 200);
  assert.match(calls[0].opts.headers.authorization, /^Basic /);
  const saved = store.m.get('tokens');
  assert.ok(saved && !saved.includes('acc-1') && !saved.includes('ref-1'), 'tokens are encrypted at rest');
  const record = await Q.loadTokens(ENV, store);
  assert.equal(record.realmId, '123');
  assert.equal(record.refreshToken, 'ref-1');
});

test('QuickBooks tokens refresh when nearly expired, and a dead refresh token clears them', async () => {
  const [, Q] = await load();
  const store = memoryStore();
  const calls = [];
  await Q.saveTokens(ENV, store, { realmId: '9', accessToken: 'old', refreshToken: 'r', accessExpires: NOW + 60000, refreshExpires: NOW + 86400000, connectedAt: 'x' });
  const fresh = await Q.accessToken(ENV, store, fakeIntuit(calls), NOW);
  assert.equal(fresh.accessToken, 'acc-1');
  assert.equal((await Q.loadTokens(ENV, store)).refreshToken, 'ref-1', 'new refresh token is kept');

  const still = await Q.accessToken(ENV, store, fakeIntuit(calls), NOW);
  assert.equal(still.accessToken, 'acc-1', 'no refresh while the token is good');
  assert.equal(calls.length, 1);

  await Q.saveTokens(ENV, store, { realmId: '9', accessToken: 'old', refreshToken: 'dead', accessExpires: NOW, refreshExpires: NOW + 86400000 });
  assert.equal(await Q.accessToken(ENV, store, fakeIntuit(calls), NOW), null);
  assert.equal(store.m.size, 0);
});

test('QuickBooks disconnect: Intuit landing page changes nothing; signed-in POST revokes and deletes', async () => {
  const [S, Q, H] = await load();
  const store = memoryStore();
  const calls = [];
  const deps = { env: ENV, now: () => NOW, store: async () => store, fetch: fakeIntuit(calls) };
  await Q.saveTokens(ENV, store, { realmId: '9', accessToken: 'a', refreshToken: 'r', accessExpires: NOW + 3600000, refreshExpires: NOW + 86400000 });
  const session = S.sign(ENV, { exp: NOW + 60000 });

  const landing = await H.qboDisconnect(request('/api/qbo/disconnect'), deps);
  assert.equal(landing.status, 200);
  const signedGet = await H.qboDisconnect(request('/api/qbo/disconnect', { cookies: { [S.COOKIE]: session } }), deps);
  assert.equal(signedGet.status, 200);
  assert.equal(store.m.size, 1, 'a GET never deletes');

  const anon = await H.qboDisconnect(request('/api/qbo/disconnect', { method: 'POST' }), deps);
  assert.equal(anon.status, 302);
  assert.equal(store.m.size, 1);

  const done = await H.qboDisconnect(request('/api/qbo/disconnect', { method: 'POST', cookies: { [S.COOKIE]: session } }), deps);
  assert.equal(done.status, 200);
  assert.equal(store.m.size, 0);
  assert.ok(calls.some(c => c.url === Q.REVOKE_URL));
});

test('QuickBooks status needs sign-in and never returns a token', async () => {
  const [S, Q, H] = await load();
  const store = memoryStore();
  const deps = { env: ENV, now: () => NOW, store: async () => store };
  assert.equal((await H.qboStatus(request('/api/qbo/status'), deps)).status, 401);
  await Q.saveTokens(ENV, store, { realmId: '9', accessToken: 'secret-a', refreshToken: 'secret-r', accessExpires: NOW, refreshExpires: NOW + 86400000 });
  const res = await H.qboStatus(request('/api/qbo/status', { cookies: { [S.COOKIE]: S.sign(ENV, { exp: NOW + 60000 }) } }), deps);
  const text = await res.text();
  assert.equal(JSON.parse(text).connected, true);
  assert.ok(!text.includes('secret'));
});

test('every function file has an /api path, and terms and privacy pages are published', () => {
  const dir = path.join(root, 'netlify/functions');
  const want = ['/api/login', '/api/logout', '/api/qbo/connect', '/api/qbo/callback', '/api/qbo/disconnect', '/api/qbo/status',
    '/api/session', '/api/jobs', '/api/jobs/:id', '/api/jobs/:id/drawings/:asset', '/api/uploads/:upload', '/api/uploads/:upload/:part'];
  const paths = [];
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f.endsWith('-background.mjs')) { assert.doesNotMatch(text, /path:/, f + ' is called by other functions only'); continue; }
    const m = text.match(/path: (\[[^\]]+\]|'[^']+')/);
    assert.ok(m, f + ' has an /api path');
    paths.push(...m[1].match(/'[^']+'/g).map(x => x.slice(1, -1)));
  }
  assert.deepEqual(paths.sort(), want.sort());
  assert.ok(paths.every(p => p.startsWith('/api/')));
  for (const f of ['terms.html', 'privacy.html']) assert.ok(fs.existsSync(path.join(root, 'app', f)), f);
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(toml, /publish = "app"/);
  assert.match(toml, /directory = "netlify\/functions"/);
  assert.match(toml, /from = "\/terms"/);
  assert.match(toml, /from = "\/privacy"/);
  // No QuickBooks or Monday secret names in anything the browser loads.
  for (const f of fs.readdirSync(path.join(root, 'app/js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'app/js', f), 'utf8'), /QBO_CLIENT_SECRET|MONDAY_API_TOKEN|SESSION_SECRET/, f);
  }
});
