# Takeoff from drawings

## What to ask Kamal for

- The drawing set as a PDF (full size if possible), plus the specifications or scope document.
- For each sheet you will mark up, the "Sheet image for estimator" from the app. It shows the sheet with a grid from 0 to 1 on every edge, so the coordinates you give land in the right place.
- The current estimate file ("Copy for estimator") so you use the same sheet names, conditions and assemblies.

## Order of work

1. **List the sheets** and what each one shows: floor plans, finish plans, reflected ceiling plans, door and finish schedules, details, electrical and mechanical.
2. **Read the scale** from each title block, then check it against one dimension string on that sheet. If they disagree, or the sheet says "not to scale", report it and do not set a scale.
3. **Read the schedules first.** Room finish schedule, door schedule, fixture and lighting schedules. These give counts and finishes without tracing anything.
4. **Rooms.** One room per space on the finish schedule, with length and width from the dimension strings (or the area if the drawing states it), ceiling height from the sections or the reflected ceiling plan, doors and windows from the plan, and the floor, wall, ceiling and base finishes mapped to Steadfast assemblies.
5. **Areas and lengths not covered by rooms.** Corridors, demolition areas, new partitions, bulkheads. Trace them as measurements with points on the grid, and put the quantity you worked out from the dimensions in `statedQty`.
6. **Counts.** Doors, plumbing fixtures, pot lights and electrical devices from schedules and symbols. Give the points where each one sits so Kamal can see them on the drawing.
7. **Scope that is not on the drawings** but will be needed (protection, bins, clean-up, permits) goes in as lines with a basis.
8. **RFIs** for anything unclear, each with the sheet and detail it refers to.

## Coordinates

- Points run from 0 to 1 across and down the sheet, from the top-left corner, as on the grid image.
- Give 3 decimal places. Follow walls and room edges, not text.
- Your traced geometry shows where things are. The quantity comes from `statedQty` with a `basis`. The app flags any item where your stated and traced quantities differ by more than 10%, so trace carefully enough that they agree.

## Matching Steadfast's names

- Use the exact condition and assembly names from the estimate file. If you need a new condition, give it a plain name ("Rubber base 4 inch, corridors") and the closest assembly.
- If no assembly fits, leave `assembly` empty and say what the condition needs.
- Put commercial work under CSI divisions: 02 demolition, 06 carpentry, 08 doors, 09 finishes, 12 cabinets and countertops, 22 plumbing, 23 HVAC, 26 electrical.

## Confidence

- `high`: from a stated dimension or schedule.
- `medium`: traced against a confirmed scale.
- `low`: estimated, unclear drawing, or a missing dimension. Every low item also gets an RFI or a note for Kamal.

## The summary for Kamal

Keep it short:

- What you measured and from which sheets.
- What you could not find.
- Low-confidence items.
- RFIs to send.
- Costs still missing from the price book.
