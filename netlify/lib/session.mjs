/*
 * Steadfast takeoff: the team sign-in. One passcode (APP_PASSCODE) gives a signed cookie.
 * Every /api function that reads or changes company data checks it. Nothing works if the
 * passcode or SESSION_SECRET is missing: it fails closed.
 */
import crypto from 'node:crypto';

export const COOKIE = 'sf_session';
const DAYS = 14;

function secret(env) {
  const s = env.SESSION_SECRET || '';
  if (s.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters.');
  return s;
}

const b64 = buf => Buffer.from(buf).toString('base64url');
const hmac = (env, text) => b64(crypto.createHmac('sha256', secret(env)).update(text).digest());

function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// A signed value: base64url(JSON) + "." + HMAC. Used for the session and the OAuth state.
export function sign(env, payload) {
  const body = b64(JSON.stringify(payload));
  return body + '.' + hmac(env, body);
}

export function unsign(env, token, now = Date.now()) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!sameText(mac, hmac(env, body))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

export function checkPasscode(env, given) {
  const want = env.APP_PASSCODE || '';
  if (!want) throw new Error('APP_PASSCODE is not set.');
  return sameText(given || '', want);
}

export function readCookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function sessionCookie(env, now = Date.now()) {
  return cookie(COOKIE, sign(env, { exp: now + DAYS * 86400000 }), DAYS * 86400);
}

export function clearCookie(name) {
  return cookie(name, '', 0);
}

export function signedIn(env, req, now = Date.now()) {
  try { return !!unsign(env, readCookies(req)[COOKIE], now); } catch (e) { return false; }
}

// Only same-site paths, so a sign-in link can't send someone to another website.
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : '/';
}
