# Steadfast takeoff and estimating

Takeoff and estimating app for Steadfast Constructions Ltd, plus the helper the Claude estimator uses on the same estimate files.

- What to build: `BUILD-BRIEF.md`
- Rules for Claude: `CLAUDE.md`
- File format: `docs/estimate-file-format.md`

## Try the app

Open `app/index.html` in Chrome (double-click it, or publish `app/` on Netlify). It needs an internet connection for the PDF reader and the font.

`tests/fixtures/test-plan.pdf` is a made-up two-sheet floor plan at 1/4" = 1'-0" for practice. Office 101 is 20 x 14 ft (280 sf, 68 lf), the south wall of the open office is 40 ft, and there are 7 doors.

## Tests

```
node --test
```
