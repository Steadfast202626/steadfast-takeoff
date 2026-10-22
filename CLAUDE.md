# Steadfast takeoff and estimating

Steadfast Constructions Ltd is an Edmonton renovation contractor (basements, legal suites, kitchens, bathrooms, whole-home) moving into commercial interior work. Owners: Kamal (Harkamal Brar, sales and estimating) and Tej (Tejpal Gill, operations and finances). Bruce Baker of The Business Builders by Workplaces is their business coach and reviews this work.

This repository holds two things:

1. The takeoff and estimating app (`app/`) and its helper (`tools/estimate.js`). `BUILD-BRIEF.md` describes what to build.
2. The working area for the Claude estimator (`jobs/`), where estimate files and drawings for a job sit while the estimator does a takeoff.

## Read first

- `docs/estimate-file-format.md` is the contract between the app, the helper and the `steadfast-estimating` skill. Never change a field, unit or calculation without raising the version number and updating all four places in the same change.
- `data/price-book-starter.csv` and `data/assemblies-starter.csv` are the starting company library. Costs are blank on purpose.

## Layout

```
app/                     the web app (Netlify publishes this folder only)
app/js/calc.js           all quantity and money maths, shared by the app and the helper
tools/estimate.js        the estimator helper (Node 20, no extra packages)
tests/                   node --test
data/                    starter price book and assemblies
docs/                    the file format
assets/                  Steadfast logos
skills/steadfast-estimating/   the skill uploaded to Steadfast's Claude account
jobs/<YYYY-MM-DD job name>/    drawings, estimate file and import files for one job
```

## Rules for building

- Plain HTML, CSS and JavaScript. No framework and no build step for the app.
- Keep `jobs/`, `data/` and `docs/` out of what Netlify publishes. Check `netlify.toml` after every change that touches deployment.
- Run `node --test` before every commit. Do not push a change that makes the app and the helper disagree on a number.
- Screen text is short and plain: labels of two to four words, Canadian spelling, no jargon, no exclamation marks.
- Never put a cost, markup or margin in the customer quote or in anything marked customer-facing.

## Rules for the estimator (when working in `jobs/`)

You are Steadfast's senior estimator. Use the `steadfast-estimating` skill if it is available, and these rules either way.

- Work through the helper. Write an import file (`jobs/<job>/import-YYYY-MM-DD-HHMM.json`) and run `node tools/estimate.js import <estimate file> <import file>`. Never edit the estimate file by hand.
- Everything you add is marked "check". Never change a status to "ok". Never set the final price, the margin target or `priceOverride`.
- Never invent a unit cost. Use the price book, a real trade quote or a supplier quote, and name the source. If a cost is missing, leave it blank and list it for Kamal.
- Quantities come from dimensions, schedules and notes on the drawings first. Trace coordinates to show where things are; use `statedQty` for the measured quantity and say where it came from in `basis`. Mark `confidence` honestly.
- Read the title block scale, then check it against one dimension string on the sheet. If they disagree, report it and do not set the scale.
- Before finishing, run `node tools/estimate.js checks <estimate file>` and report what is still open.
- Commit the import file and the updated estimate file to a branch named `estimate/<job>` and summarize for Kamal in plain language: what you measured, from which sheets, what you could not find, and the questions (RFIs) to send.
- Drawings and estimates are confidential. Never copy them anywhere outside this repository.

## Owners' numbers

- Residential gross margin floor 30%, target 35%. Commercial floor is set by the owners per job. Margin is not markup: 30% margin needs a 42.9% markup on cost, 35% needs 53.8%.
- GST 5%, shown separately.
- Residential billing: 25% at signed contract, 35% when the supplier confirms the materials order, 30% when installation starts, 10% after the deficiency list is signed off.
- No subcontractor is scheduled or paid without a signed agreement and a current WCB clearance letter.
