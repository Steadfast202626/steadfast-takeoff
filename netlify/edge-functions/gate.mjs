// Every page and file of the app needs a signed-in session first. See netlify/lib/gate.mjs.
// The open paths are written out here because Netlify reads this config without running the code;
// tests/gate.test.js checks they match OPEN_PATHS in lib/gate.mjs.
import { gate } from '../lib/gate.mjs';

export default async (request, context) => {
  const stop = await gate(request, Netlify.env.get('SESSION_SECRET') || '');
  if (stop) return stop;
  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'private, no-store'); // a signed-in page is never kept in a shared cache
  return out;
};

export const config = {
  path: '/*',
  excludedPath: ['/api/*', '/assets/*', '/css/plain.css', '/terms', '/terms.html', '/privacy', '/privacy.html']
};
