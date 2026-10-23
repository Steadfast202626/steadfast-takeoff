/*
 * Steadfast takeoff: small branded pages the server functions show (sign in, QuickBooks results).
 */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function page(title, bodyHtml, status = 200, headers = {}) {
  const html = `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Steadfast takeoff</title>
<link rel="icon" type="image/png" href="/assets/steadfast-logo-dark-on-light.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/css/plain.css">
</head>
<body>
<main class="plain narrow">
<img class="plain-logo" src="/assets/steadfast-logo-dark-on-light.png" alt="Steadfast Constructions Ltd">
<h1>${esc(title)}</h1>
${bodyHtml}
</main>
</body>
</html>`;
  return new Response(html, { status, headers: Object.assign({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, headers) });
}

export function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: Object.assign({ location, 'cache-control': 'no-store' }, headers) });
}

export { esc };
