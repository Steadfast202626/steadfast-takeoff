/*
 * Steadfast takeoff: what each /api address does. The files in netlify/functions only wire these up,
 * so the tests can run them with a fake store and a fake QuickBooks.
 *
 * deps: { env, store (async () => token store), fetch, now (() => ms), delay (ms => Promise) }
 */
import crypto from 'node:crypto';
import * as S from './session.mjs';
import * as Q from './qbo.mjs';
import { page, redirect, esc } from './page.mjs';

const STATE_COOKIE = 'sf_qbo_state';
const now = deps => (deps.now ? deps.now() : Date.now());

function setupProblem(e) {
  return page('Setup needed', `<p>${esc(e.message)}</p><p>Add it under Site configuration, Environment variables on Netlify, then deploy again.</p>`, 500);
}

function signInRedirect(next) {
  return redirect('/api/login?next=' + encodeURIComponent(next));
}

const backLink = '<p><a class="button" href="/">Back to the app</a></p>';

// ---------- Sign in ----------

function loginForm(next, message) {
  return `${message ? `<p class="warn">${esc(message)}</p>` : ''}
<form method="post" action="/api/login">
  <input type="hidden" name="next" value="${esc(next)}">
  <label>Team passcode <input type="password" name="passcode" autocomplete="current-password" required autofocus></label>
  <button type="submit" class="primary">Sign in</button>
</form>`;
}

export async function login(req, deps) {
  const { env } = deps;
  if (!env.APP_PASSCODE) return setupProblem(new Error('APP_PASSCODE is not set.'));
  if (req.method === 'GET') {
    const next = S.safeNext(new URL(req.url).searchParams.get('next'));
    return page('Sign in', loginForm(next));
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const form = new URLSearchParams(await req.text());
  const next = S.safeNext(form.get('next'));
  let ok;
  try {
    ok = S.checkPasscode(env, form.get('passcode'));
    if (ok) return redirect(next, { 'set-cookie': S.sessionCookie(env, now(deps)) });
  } catch (e) {
    return setupProblem(e);
  }
  if (deps.delay) await deps.delay(1000); // slows down guessing
  return page('Sign in', loginForm(next, 'That passcode is not right.'), 401);
}

export async function logout() {
  return redirect('/', { 'set-cookie': S.clearCookie(S.COOKIE) });
}

// ---------- QuickBooks ----------

export async function qboConnect(req, deps) {
  const { env } = deps;
  if (!S.signedIn(env, req, now(deps))) return signInRedirect('/api/qbo/connect');
  let cfg;
  try { cfg = Q.config(env); } catch (e) { return setupProblem(e); }
  const state = S.sign(env, { exp: now(deps) + 10 * 60000, n: crypto.randomBytes(16).toString('hex') });
  return redirect(Q.authorizeUrl(cfg, state), { 'set-cookie': S.cookie(STATE_COOKIE, state, 600) });
}

export async function qboCallback(req, deps) {
  const { env } = deps;
  const url = new URL(req.url);
  const p = url.searchParams;
  const clear = { 'set-cookie': S.clearCookie(STATE_COOKIE) };
  if (!S.signedIn(env, req, now(deps))) {
    return page('Sign in first', '<p>Sign in, then connect QuickBooks again.</p><p><a class="button" href="/api/login?next=%2Fapi%2Fqbo%2Fconnect">Sign in</a></p>', 401, clear);
  }
  if (p.get('error')) {
    return page('Not connected', `<p>QuickBooks said: ${esc(p.get('error'))}. Nothing was saved.</p>${backLink}`, 400, clear);
  }
  const state = p.get('state');
  const cookieState = S.readCookies(req)[STATE_COOKIE];
  if (!state || state !== cookieState || !S.unsign(env, state, now(deps))) {
    return page('Not connected', `<p>The sign-in link was old or did not come from this app. Nothing was saved. Connect again.</p>${backLink}`, 400, clear);
  }
  const code = p.get('code'), realmId = p.get('realmId');
  if (!code || !realmId) return page('Not connected', `<p>QuickBooks did not send a company. Nothing was saved.</p>${backLink}`, 400, clear);
  let cfg;
  try { cfg = Q.config(env); } catch (e) { return setupProblem(e); }
  try {
    const record = await Q.exchangeCode(cfg, code, realmId, deps.fetch, now(deps));
    await Q.saveTokens(env, await deps.store(), record);
  } catch (e) {
    return page('Not connected', `<p>${esc(e.message)} Nothing was saved.</p>${backLink}`, 502, clear);
  }
  return page('QuickBooks connected', `<p>Connected to company ${esc(realmId)} (${esc(cfg.environment)}). The app can now read bills, vendors, items and project costs. It never changes anything in QuickBooks.</p>${backLink}`, 200, clear);
}

export async function qboDisconnect(req, deps) {
  const { env } = deps;
  const signedIn = S.signedIn(env, req, now(deps));
  if (req.method === 'POST') {
    if (!signedIn) return signInRedirect('/api/qbo/disconnect');
    const store = await deps.store();
    const record = await Q.loadTokens(env, store);
    if (record) {
      try { await Q.revoke(Q.config(env), record, deps.fetch); } catch (e) { /* removed here either way */ }
      await Q.clearTokens(store);
    }
    return page('QuickBooks disconnected', `<p>The app no longer has access to QuickBooks. Connect again any time.</p>${backLink}`);
  }
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  // Intuit sends people here after they disconnect the app inside QuickBooks.
  if (!signedIn) {
    return page('QuickBooks disconnected', '<p>If you disconnected the app in QuickBooks, it no longer has access. Sign in to the app to connect again.</p><p><a class="button" href="/api/login?next=%2F">Sign in</a></p>');
  }
  const record = await Q.loadTokens(env, await deps.store());
  return page('Disconnect QuickBooks', record
    ? `<p>The app is connected to company ${esc(record.realmId)}. Disconnecting removes its access.</p>
<form method="post" action="/api/qbo/disconnect"><button type="submit" class="primary">Disconnect</button> <a href="/">Cancel</a></form>`
    : `<p>The app is not connected to QuickBooks.</p><p><a class="button" href="/api/qbo/connect">Connect QuickBooks</a></p>`);
}

export async function qboStatus(req, deps) {
  const { env } = deps;
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (!S.signedIn(env, req, now(deps))) return json({ signedIn: false }, 401);
  let cfg;
  try { cfg = Q.config(env); } catch (e) { return json({ signedIn: true, connected: false, problem: e.message }); }
  const record = await Q.loadTokens(env, await deps.store());
  if (!record) return json({ signedIn: true, connected: false, environment: cfg.environment });
  return json({ signedIn: true, connected: true, environment: cfg.environment, realmId: record.realmId,
    connectedAt: record.connectedAt, reconnectBy: new Date(record.refreshExpires).toISOString().slice(0, 10) });
}
