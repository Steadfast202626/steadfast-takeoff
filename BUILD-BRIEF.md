# Build brief: Steadfast takeoff and estimating tool

Read `CLAUDE.md` and `docs/estimate-file-format.md` before writing any code. The file format is the contract. Build to it exactly.

## Goal

A browser app that Kamal and Tej use for takeoffs and estimates, and a command-line helper that the Claude estimator uses on the same estimate files. Kamal and the estimator work on one estimate, and nothing the estimator adds counts until Kamal accepts it.

The first real use is a large commercial bid: several kitchens, two bathrooms, hallways and office flooring. The client wants necessary work separated from cosmetic work, so base bid and alternates matter from day one.

## How it is built

- A plain static web app in `app/` (HTML, CSS and JavaScript, no framework, no build step, no server). It opens in Chrome on a desktop and works on a tablet for viewing.
- PDF drawings use pdf.js 3.11.174 from cdnjs.
- Netlify publishes `app/` only (set `publish = "app"` in `netlify.toml`). Nothing in `jobs/`, `data/` or `docs/` is ever published.
- The helper is `tools/estimate.js` (Node 20, no dependencies beyond what Node ships with). It shares one calculation module with the app (`app/js/calc.js`, written so both the browser and Node can load it). The app and the helper must never compute a number differently.
- The app saves the current job in the browser automatically and saves the estimate file on demand: `YYYY-MM-DD — Estimate — Job name.json`. Drawings are re-attached by file name and kept in the browser's IndexedDB between sessions.
- Branding: logo files in `assets/`, charcoal ink, walnut brown accent `#53412c`, plain neutral greys. Screen font Barlow with Arial fallback. Printed documents in Arial.
- Screen text: labels of two to four words, no instructions the screen already makes obvious, Canadian spelling.

## Version 1 features

1. **Drawings.** Open PDF sets (each page becomes a sheet) and photos of plans. Name each sheet from the sheet number in the title block (for example A-101), editable. Scale per sheet: architectural, engineering and metric presets, plus "set from a known dimension" with an option to apply it to every sheet of the same size. Measuring is blocked until a sheet has a scale.
2. **Measuring.** Length, area (with perimeter), wall (length × height) and count. Deduct. Shift keeps lines straight. Clicking the first point closes an area. Double-click or Enter finishes. Backspace removes the last point. Drag points to edit a markup. Undo. Zoom with the wheel, pan by dragging. Quantity labels on the drawing. Live length or area while drawing.
3. **Conditions.** Name, colour, measure type, wall height, an assembly or a unit price, CSI division, location, base bid or alternate. Live totals per sheet and for the job. Hide and show.
4. **Price book.** Load `data/price-book-starter.csv` as the starting company library. Costs start blank. CSV import and export (columns as in the starter file; `type` accepts M, L, S, E or the full word). The company library is kept separately from each job, and a new job copies it.
5. **Assemblies.** Load `data/assemblies-starter.csv`. Each assembly lists price book items with a quantity per lf, sf or each and a waste %. Show cost per unit. A "confirmed by Kamal" tick. The starter factors are starting points only.
6. **Rooms.** A finish schedule: length, width and height, or taken from a traced area ("Make a room from this area"). Doors and windows reduce wall area. Floor, wall, ceiling and base assemblies per room.
7. **Estimate.** Lines come from conditions, rooms, manual lines, allowances and chosen bids. Group by CSI division or by location. Combine identical items. Unit costs are editable inline and write back to the price book. Summary: direct cost by type, travel, contingency, cost, target margin, price, override, margin and markup side by side, GST, total. Alternates priced on their own. Payment stages for residential.
8. **Bid levelling.** For each trade, a grid of scope items against bidders: included, excluded or not stated. Plug values fill the gaps. Levelled totals and ranking. WCB clearance and insurance ticks. Choosing a bidder creates the subcontract line. "Fill scope from takeoff" adds the trade's conditions with quantities. A printable scope letter for each trade.
9. **Cash flow** for commercial jobs, per the format file: monthly progress billing, owner pays in 28 days, subcontractors paid within 7 days of Steadfast being paid, 10% holdback at each tier, holdback released after the 60-day lien period plus admin time. Starting bank balance, lowest balance and the month it happens, a simple chart. Every default labelled "check the contract".
10. **Release checklist** exactly as in the format file, with a count on the tab and in the top bar.
11. **Outputs.**
    - Customer quote: logo, job, scope by division (commercial) or by room (residential), quantities optional, price, GST, total, alternates, allowances, exclusions, assumptions and clarifications, payment schedule, validity, and acceptance lines for both parties. No costs, markup or margin anywhere.
    - Internal estimate: everything, marked "Internal. Owners only."
    - Both open as print pages: Arial, page number bottom left, document title bottom right.
    - CSV of estimate lines for the Monday.com Estimates board.
12. **Estimator exchange in the app.** "Import from estimator" (paste or open a file, show a preview, then import with a summary). "Copy for estimator" (the full estimate file without drawings, to the clipboard with a fallback text box). "Sheet image for estimator": the sheet as a PNG with a 0 to 1 grid on all four edges and the existing markups, about 2,400 px on the long side. Estimator items show dashed with a "?" label until accepted. Accept one at a time or all on a sheet after a confirmation.
13. **Sample job** with a generated floor plan and made-up prices, under a red band reading "Sample job with made-up prices. Not for quoting." Opened from the File menu only.

## The estimator helper (`tools/estimate.js`)

The Claude estimator runs this in Claude Code. Every command takes the estimate file path first and prints a short plain-language result. Commands that change the file write a backup first (`.bak`).

```
node tools/estimate.js summary  <file>                 totals, margin, checklist status
node tools/estimate.js checks   <file>                 release checklist, one line per check
node tools/estimate.js import   <file> <import.json>   apply an estimator import file (same rules as the app)
node tools/estimate.js lines    <file> [--csv]         estimate lines
node tools/estimate.js sheets   <file>                 sheets, scales, markup counts
node tools/estimate.js validate <file|import.json>     check a file against the format
```

The estimator works by writing an import file and running `import`. It never edits the estimate file by hand and never changes `status` to `"ok"`.

Also maintain `skills/steadfast-estimating/`: when the helper is finished, copy `tools/estimate.js` and `app/js/calc.js` into `skills/steadfast-estimating/scripts/`, add the commands to the skill's SKILL.md, and build `dist/steadfast-estimating.zip` with the folder `steadfast-estimating/` at the root of the zip.

## Testing

Write the tests in `tests/` and run them with `node --test`.

- Generate a test PDF floor plan at 1/4" = 1'-0" (24 × 18 inch page) with known rooms.
- The preset scale and a scale set from a dimension agree within 1%.
- A 20 × 14 ft room traced as an area measures 280 sf and 68 lf of perimeter.
- A 40 ft wall at 9 ft measures 360 sf.
- Counts are correct. Deducts subtract.
- A stated quantity overrides the traced one, and a difference over 10% is flagged.
- $10,000 of cost at a 35% target prices at $15,390. Margin 35.0%, markup 53.9%.
- GST is 5% and stage invoices total the price plus GST.
- Holdback timing matches the format file.
- The customer quote contains no cost, markup or margin figures (search the generated HTML).
- The helper and the app give identical totals for the same file.
- End to end: the helper imports rooms, counts and a flooring area from an import file for the test plan; the app shows them dashed; accepting them clears the check; the checklist passes once costs, contingency and exclusions are filled.

## Build order

Stop after steps 1 and 3 so Bruce can review the branch before you go on.

1. Drawings, scale, measuring, conditions, saving and opening.
2. Price book, assemblies, rooms and estimate.
3. The calculation module shared with the helper, the helper, the import and export, and the skill files.
4. Bid levelling, cash flow, release checklist, outputs and sample job.

## Done when

Kamal can open the commercial bid drawings, set the scale, measure flooring, walls, base and doors, see priced totals by division and print a customer quote. The estimator can do the same takeoff through the helper, and Kamal can check and accept it in the app.
