/*
 * Steadfast takeoff: QuickBooks Online sign-in (OAuth 2.0) and the token store.
 * Tokens live on the server only, in Netlify Blobs, encrypted with a key made from SESSION_SECRET.
 * This app only reads from QuickBooks. It never writes.
 */
import crypto from 'node:crypto';

export const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
export const SCOPE = 'com.intuit.quickbooks.accounting';
export const REDIRECT_URI = 'https://steadfast-takeoff.netlify.app/api/qbo/callback';
const TOKEN_KEY = 'tokens';

export function config(env) {
  const missing = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_ENVIRONMENT'].filter(k => !env[k]);
  if (missing.length) throw new Error('Missing Netlify environment variables: ' + missing.join(', ') + '.');
  const environment = String(env.QBO_ENVIRONMENT).toLowerCase();
  if (environment !== 'sandbox' && environment !== 'production') throw new Error('QBO_ENVIRONMENT must be sandbox or production.');
  return {
    clientId: env.QBO_CLIENT_ID,
    clientSecret: env.QBO_CLIENT_SECRET,
    environment,
    apiBase: environment === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com',
    redirectUri: env.QBO_REDIRECT_URI || REDIRECT_URI
  };
}

export function authorizeUrl(cfg, state) {
  const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', scope: SCOPE, redirect_uri: cfg.redirectUri, state });
  return AUTHORIZE_URL + '?' + q.toString();
}

const basic = cfg => 'Basic ' + Buffer.from(cfg.clientId + ':' + cfg.clientSecret).toString('base64');

async function tokenRequest(cfg, form, fetchFn) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: basic(cfg), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('QuickBooks refused the request: ' + (data.error || res.status) + '.');
    err.code = data.error || 'http_' + res.status;
    throw err;
  }
  return data;
}

// Intuit's answer, turned into what we keep. Times are absolute so a later call knows when to refresh.
export function tokenRecord(data, realmId, now = Date.now()) {
  return {
    realmId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpires: now + (Number(data.expires_in) || 3600) * 1000,
    refreshExpires: now + (Number(data.x_refresh_token_expires_in) || 8726400) * 1000,
    connectedAt: new Date(now).toISOString()
  };
}

export async function exchangeCode(cfg, code, realmId, fetchFn = fetch, now = Date.now()) {
  const data = await tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }, fetchFn);
  return tokenRecord(data, realmId, now);
}

export async function refresh(cfg, record, fetchFn = fetch, now = Date.now()) {
  const data = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: record.refreshToken }, fetchFn);
  return Object.assign(tokenRecord(data, record.realmId, now), { connectedAt: record.connectedAt });
}

export async function revoke(cfg, record, fetchFn = fetch) {
  const res = await fetchFn(REVOKE_URL, {
    method: 'POST',
    headers: { authorization: basic(cfg), accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ token: record.refreshToken })
  });
  return res.ok;
}

// ---------- Encrypted token store ----------

function key(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters.');
  return crypto.createHash('sha256').update('steadfast-qbo-tokens:' + env.SESSION_SECRET).digest();
}

export function encrypt(env, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(env), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
}

export function decrypt(env, text) {
  const [iv, tag, data] = String(text).split('.').map(s => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(env), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

// store is anything with get(key), set(key, value) and delete(key): Netlify Blobs in production, a Map in tests.
export async function loadTokens(env, store) {
  const text = await store.get(TOKEN_KEY);
  if (!text) return null;
  try { return decrypt(env, text); } catch (e) { return null; }
}

export async function saveTokens(env, store, record) {
  await store.set(TOKEN_KEY, encrypt(env, record));
}

export async function clearTokens(store) {
  await store.delete(TOKEN_KEY);
}

// A current access token, refreshed and saved when it is within five minutes of running out.
export async function accessToken(env, store, fetchFn = fetch, now = Date.now()) {
  const cfg = config(env);
  let record = await loadTokens(env, store);
  if (!record) return null;
  if (record.accessExpires - now < 5 * 60000) {
    if (record.refreshExpires <= now) { await clearTokens(store); return null; }
    try {
      record = await refresh(cfg, record, fetchFn, now);
    } catch (e) {
      if (e.code === 'invalid_grant') { await clearTokens(store); return null; }
      throw e;
    }
    await saveTokens(env, store, record);
  }
  return record;
}

export async function tokenStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'qbo', consistency: 'strong' });
}
