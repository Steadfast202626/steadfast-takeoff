/*
 * Steadfast takeoff: the sign-in gate in front of every page. Nobody sees any screen, the practice
 * job included, until they have signed in. Runs as a Netlify edge function (edge-functions/gate.mjs)
 * and in the tests, so it uses Web Crypto only (no Node modules).
 *
 * It checks the same signed cookie the /api functions check (lib/session.mjs): base64url(JSON) "." HMAC-SHA256.
 * It fails closed: no SESSION_SECRET, a bad signature or an expired cookie all go to the sign-in page.
 */
export const COOKIE = 'sf_session';

// Open without signing in: the sign-in page itself and what it shows (logo, page style), the API
// (each /api function checks the cookie itself), and the terms and privacy pages Intuit links to.
export const OPEN_PATHS = ['/api/*', '/assets/*', '/css/plain.css', '/terms', '/terms.html', '/privacy', '/privacy.html'];

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(s, c => c.charCodeAt(0)));
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

// The session payload when the cookie is genuine and not expired, else null.
export async function verify(token, secret, now = Date.now()) {
  if (!secret || secret.length < 32 || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1 || token.indexOf('.', dot + 1) !== -1) return null;
  const body = token.slice(0, dot), mac = token.slice(dot + 1);
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  if (!sameText(mac, want)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(body)); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

// null: let the request through. A Response: send it instead.
export async function gate(request, secret, now = Date.now()) {
  const session = await verify(readCookie(request.headers.get('cookie'), COOKIE), secret, now);
  if (session) return null;
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Sign in first.', { status: 401 });
  const next = url.pathname + url.search;
  return new Response(null, { status: 302, headers: {
    location: '/api/login' + (next && next !== '/' ? '?next=' + encodeURIComponent(next) : ''),
    'cache-control': 'no-store'
  } });
}
