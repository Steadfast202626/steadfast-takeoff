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

## Tests

```
node --test
```
