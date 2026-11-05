# Steadfast takeoff and estimating

Takeoff and estimating app for Steadfast Constructions Ltd, plus the helper the Claude estimator uses on the same estimate files.

- What to build: `BUILD-BRIEF.md`
- Rules for Claude: `CLAUDE.md`
- File format: `docs/estimate-file-format.md`

## Try the app

Open `app/index.html` in Chrome (double-click it, or publish `app/` on Netlify). It needs an internet connection for the PDF reader and the font.

`tests/fixtures/test-plan.pdf` is a made-up two-sheet floor plan at 1/4" = 1'-0" for practice. Office 101 is 20 x 14 ft (280 sf, 68 lf), the south wall of the open office is 40 ft, and there are 7 doors.

## The estimator helper

```
node tools/estimate.js summary  <file> [--json]
node tools/estimate.js checks   <file>
node tools/estimate.js import   <file> <import.json>
node tools/estimate.js lines    <file> [--csv]
node tools/estimate.js sheets   <file>
node tools/estimate.js validate <file|import.json>
```

## After changing shared files

- `data/*.csv`: run `node tools/make-starter.js` (the app's fallback copy in `app/js/starter-library.js`).
- `tools/estimate.js`, `app/js/calc.js` or `docs/estimate-file-format.md`: run `node tools/build-skill.js` (the skill's `scripts/` and `dist/steadfast-estimating.zip`).
- `tools/make-sample.js`, `app/js/calc.js` or `data/*.csv`: run `node tools/make-sample.js` (the sample job in `app/js/sample-plan.js`).

The tests fail if any of these are out of date.

## Server functions

`netlify/functions` answer under `/api` on Netlify. The app and the helper need no packages; `npm install` is only for these functions.

- `/api/login`, `/api/logout`: the team passcode.
- `/api/session`: signed in or not.
- `/api/jobs`, `/api/jobs/:id`: list, open and save jobs on the Monday.com Estimates board. Price, margin and open checks are worked out with `app/js/calc.js`, the same as the app.
- `/api/jobs/:id/drawings/:asset`: brings a drawing down from Monday.com.
- `/api/uploads/...` and the `upload-finish-background` function: drawings go up in 4 MB parts and are joined on the server, because a Netlify Function takes about 6 MB per request.
- `/api/qbo/connect`, `/api/qbo/callback`, `/api/qbo/disconnect`, `/api/qbo/status`: QuickBooks Online sign-in. Read only.
- Pages `/terms` and `/privacy`.

Board and column ids are in `netlify/lib/monday.mjs` (Sandbox workspace for now). Going live means changing `BOARDS` there only.

Netlify environment variables: `APP_PASSCODE`, `SESSION_SECRET` (32 characters or more), `MONDAY_API_TOKEN`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` (`sandbox` or `production`).

## Tests

```
node --test
```
