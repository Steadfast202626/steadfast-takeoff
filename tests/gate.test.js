'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENV = { APP_PASSCODE: 'p'.repeat(16), SESSION_SECRET: 's'.repeat(48) };
const NOW = Date.parse('2026-11-07T12:00:00Z');
const load = () => Promise.all([import('../netlify/lib/gate.mjs'), import('../netlify/lib/session.mjs'), import('../netlify/lib/handlers.mjs')]);
const get = (url, cookie, method = 'GET') => new Request('https://steadfast-takeoff.netlify.app' + url, { method, headers: cookie ? { cookie } : {} });

test('gate: no screen without signing in, the practice job included', async () => {
  const [G] = await load();
  for (const url of ['/', '/index.html', '/js/sample.js', '/js/sample-plan.js', '/css/app.css', '/?job=1']) {
    const res = await G.gate(get(url), ENV.SESSION_SECRET, NOW);
    assert.ok(res, url + ' must not be served');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/api\/login/);
  }
  assert.equal((await G.gate(get('/js/app.js'), ENV.SESSION_SECRET, NOW)).headers.get('location'), '/api/login?next=%2Fjs%2Fapp.js');
  assert.equal((await G.gate(get('/', null, 'POST'), ENV.SESSION_SECRET, NOW)).status, 401);
});

test('gate: the cookie the sign-in gives opens the app, and a forged, expired or unsigned one does not', async () => {
  const [G, S] = await load();
  const good = S.COOKIE + '=' + encodeURIComponent(S.sign(ENV, { exp: NOW + 60000 }));
  assert.equal(await G.gate(get('/', good), ENV.SESSION_SECRET, NOW), null);
  assert.equal(G.COOKIE, S.COOKIE);
  const old = S.COOKIE + '=' + encodeURIComponent(S.sign(ENV, { exp: NOW - 1 }));
  assert.ok(await G.gate(get('/', old), ENV.SESSION_SECRET, NOW), 'expired');
  const other = S.COOKIE + '=' + encodeURIComponent(S.sign({ SESSION_SECRET: 'x'.repeat(48) }, { exp: NOW + 60000 }));
  assert.ok(await G.gate(get('/', other), ENV.SESSION_SECRET, NOW), 'signed with another secret');
  const body = Buffer.from(JSON.stringify({ exp: NOW + 60000 })).toString('base64url');
  assert.ok(await G.gate(get('/', S.COOKIE + '=' + body + '.abc'), ENV.SESSION_SECRET, NOW), 'made up');
  assert.ok(await G.gate(get('/', good), '', NOW), 'no SESSION_SECRET: fails closed');
  assert.ok(await G.gate(get('/', good), 'short', NOW), 'short SESSION_SECRET: fails closed');
});

test('gate: what stays open is only the sign-in page, its logo and style, the API and the terms', async () => {
  const [G] = await load();
  const edge = fs.readFileSync(path.join(__dirname, '../netlify/edge-functions/gate.mjs'), 'utf8');
  const listed = JSON.parse(edge.match(/excludedPath: (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(listed, G.OPEN_PATHS, 'the edge function config matches lib/gate.mjs');
  assert.match(edge, /path: '\/\*'/);
  for (const p of G.OPEN_PATHS) assert.ok(!/^\/(js|index)|^\/$/.test(p), p + ' must not open the app');
  assert.ok(fs.existsSync(path.join(__dirname, '../app/assets/steadfast-logo-dark-on-light.png')));
  const toml = fs.readFileSync(path.join(__dirname, '../netlify.toml'), 'utf8');
  assert.match(toml, /publish = "app"/);
});

test('sign-in page shows the Steadfast logo, and signing out goes back to it', async () => {
  const [, , H] = await load();
  const page = await (await H.login(get('/api/login'), { env: ENV })).text();
  assert.match(page, /<img class="plain-logo" src="\/assets\/steadfast-logo-dark-on-light.png" alt="Steadfast Constructions Ltd">/);
  assert.match(page, /name="passcode"/);
  const out = await H.logout();
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('location'), '/api/login');
  assert.match(out.headers.get('set-cookie'), /sf_session=; .*Max-Age=0/);
});
