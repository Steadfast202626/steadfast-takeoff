# Steadfast estimate file format, version 1

This is the contract between the takeoff app, the estimator helper and the `steadfast-estimating` skill. All three must read and write exactly this. If anything here changes, raise the version number and update the app, the helper, this file and the copy in `skills/steadfast-estimating/references/` in the same change.

There are two file types:

1. **Estimate file** (`"format": "steadfast-estimate"`). The full estimate. The app opens and saves it. The estimator reads it and edits it through the helper.
2. **Estimator import file** (`"format": "steadfast-estimator-import"`). What the estimator produces in a Claude chat. Kamal opens it with "Import from estimator" in the app. It refers to things by name, not by id.

Units are feet, square feet and each. Money is Canadian dollars before GST. Dates are `YYYY-MM-DD`.

## 1. Estimate file

```json
{
  "format": "steadfast-estimate",
  "version": 1,
  "job": {
    "name": "Unit 200 office refresh",
    "client": "", "contact": "", "address": "",
    "type": "residential | commercial",
    "class": "A | B | C | D",
    "bidDue": "2026-11-06", "date": "2026-10-22",
    "preparedBy": "Kamal", "quoteNo": "", "validDays": 30, "notes": ""
  },
  "settings": {
    "marginFloor": 30, "marginTarget": 35, "commercialFloor": null,
    "contingencyPct": null, "travelPct": 0, "gstPct": 5, "gstNumber": "",
    "roundTo": 10, "priceOverride": null,
    "defaultHeightFt": 8, "doorWidthFt": 3, "doorAreaSf": 21, "windowAreaSf": 12,
    "stages": [
      { "label": "Signed contract", "pct": 25 },
      { "label": "Materials ordered and confirmed by supplier", "pct": 35 },
      { "label": "Installation starts on site", "pct": 30 },
      { "label": "Completion and signed deficiency list", "pct": 10 }
    ],
    "cash": {
      "startBalance": 0, "months": 3, "startDate": "", "curve": "even | s-curve",
      "ownerPayDays": 28, "subPayDays": 7, "holdbackPct": 10,
      "lienDays": 60, "releaseDays": 10, "reviewed": false
    }
  },
  "priceBook": [
    { "code": "09-LVP", "item": "Luxury vinyl plank", "unit": "sf", "type": "M | L | S | E",
      "unitCost": null, "division": "09", "source": "", "updated": "" }
  ],
  "assemblies": [
    { "id": "a1", "name": "LVP flooring with underlay", "measure": "area | length | wall | count",
      "division": "09", "confirmed": false,
      "items": [ { "code": "09-LVP", "per": "sf | lf | ea", "qtyPerUnit": 1, "wastePct": 10 } ] }
  ],
  "sheets": [
    { "id": "s1", "name": "A-101", "file": "Bid set.pdf", "page": 1, "kind": "pdf | image",
      "widthPt": 2592, "heightPt": 1728, "ftPerUnit": null, "scaleLabel": "", "scaleSource": "preset | calibrated | estimator" }
  ],
  "conditions": [
    { "id": "c1", "name": "LVP flooring, offices", "measure": "area", "color": "#1971c2",
      "heightFt": null, "assemblyId": "a1", "unitCost": null, "type": "S",
      "division": "09", "location": "Level 1", "alternateId": null, "hidden": false }
  ],
  "measurements": [
    { "id": "m1", "conditionId": "c1", "sheetId": "s1",
      "points": [[0.21, 0.33], [0.42, 0.33], [0.42, 0.51], [0.21, 0.51]],
      "deduct": false, "statedQty": null, "note": "Office 104",
      "source": "owner | estimator", "status": "ok | check", "basis": "", "confidence": "high | medium | low" }
  ],
  "rooms": [
    { "id": "r1", "name": "Office 104", "location": "Level 1",
      "lengthFt": 14, "widthFt": 17.5, "heightFt": 9, "areaSf": null, "perimeterLf": null,
      "doors": 1, "windows": 1,
      "floorAssemblyId": "a1", "wallAssemblyId": null, "ceilingAssemblyId": null, "baseAssemblyId": null,
      "alternateId": null, "measurementId": null, "source": "owner", "status": "ok", "basis": "" }
  ],
  "lines": [
    { "id": "l1", "division": "01", "description": "Disposal bin (20 yd)", "scope": "", "location": "",
      "qty": 3, "unit": "ea", "unitCost": null, "type": "E", "allowance": false,
      "alternateId": null, "source": "owner", "status": "ok", "basis": "" }
  ],
  "alternates": [ { "id": "alt1", "name": "Alternate 1", "description": "", "sign": "add | deduct" } ],
  "bids": [
    { "id": "b1", "trade": "Electrical", "division": "26", "alternateId": null,
      "scopeItems": [ { "text": "Pot lights per E-101", "plug": 0 } ],
      "bidders": [ { "id": "bd1", "name": "", "amount": 0, "includes": ["y"],
                     "wcbClearance": false, "insurance": false, "notes": "" } ],
      "selectedBidderId": null, "source": "owner", "status": "ok" }
  ],
  "risks": [ { "id": "k1", "risk": "", "likelyCost": 0, "inPrice": 0 } ],
  "rfis": [ { "id": "q1", "question": "", "reference": "", "status": "open | answered", "answer": "" } ],
  "exclusions": [], "assumptions": [], "clarifications": [],
  "manualChecks": { "cashReviewed": false }
}
```

### Field rules

- `points` run from 0 to 1, measured from the top-left corner of the sheet as displayed. Multiply x by `widthPt` and y by `heightPt` to get drawing units, then by `ftPerUnit` to get feet. For PDFs the drawing unit is the PDF point (1/72 inch) at scale 1. For images it is the pixel.
- Preset scales assume the PDF is at full print size: architectural `a" = 1'-0"` gives `ftPerUnit = 1 / (72 × a)`. Engineering `1" = N'` gives `N / 72`. Metric `1:R` gives `R × 25.4 / 72 / 304.8`.
- `unitCost: null` means no cost yet. It is never treated as zero.
- `status: "check"` marks anything the estimator added. Only Kamal or Tej changes it to `"ok"`. The estimator never does.
- Drawings are never stored in this file. The app re-attaches them by `file` name.

## 2. Calculation rules

The app and the helper must give identical numbers.

**Measurements**

- Length and wall: sum of segment lengths in feet. Wall square feet = length × `heightFt` of the condition. A length condition with a height also gets square feet.
- Area: polygon area (shoelace) in square feet. Perimeter is the closed outline.
- Count: number of points.
- `statedQty`, when set, replaces the main quantity (sf for area, lf for length and wall, ea for count). The traced value is kept for comparison. Flag the item when stated and traced differ by more than 10%.
- `deduct: true` makes every quantity negative.

**Rooms**

- Area = linked measurement area, else `areaSf`, else length × width.
- Perimeter = linked measurement perimeter, else `perimeterLf`, else 2 × (length + width).
- Height = `heightFt`, else `defaultHeightFt`.
- Wall sf = max(0, perimeter × height − doors × `doorAreaSf` − windows × `windowAreaSf`).
- Ceiling sf = area. Base lf = max(0, perimeter − doors × `doorWidthFt`).

**Assemblies to lines**

- Line quantity = basis[`per`] × `qtyPerUnit` × (1 + `wastePct` / 100).
- Basis for a condition = its totals across all sheets: `lf`, `sf`, `ea`.
- Basis for room finishes: floor `{sf: area, lf: perimeter}`, walls `{sf: wall sf, lf: perimeter}`, ceiling `{sf: ceiling, lf: perimeter}`, base `{lf: base}`. `ea` is 1 for each finish.
- A condition with no assembly makes one line: main quantity × the condition's `unitCost`.
- Line division = price book item division, else the condition or assembly division.
- Line total = qty × unitCost. A line with no cost is "missing" and blocks release.

**Bids**

- Levelled price = bidder amount + the `plug` of every scope item that bidder did not mark `"y"`.
- The selected bidder becomes one subcontract line: qty 1, unit "lot", cost = levelled price.

**Money**

1. Direct = base bid lines (no `alternateId`).
2. Travel = direct × `travelPct`.
3. Contingency = (direct + travel) × `contingencyPct`.
4. Cost = direct + travel + contingency.
5. Price = cost ÷ (1 − `marginTarget`), rounded up to `roundTo`, unless `priceOverride` is set.
6. Margin = (price − cost) ÷ price. Markup = (price − cost) ÷ cost. Always show both.
7. GST = price × `gstPct`, shown separately.
8. Each alternate is priced the same way on its own lines. A deduct alternate shows as negative.
9. Floor = `marginFloor` for residential, `commercialFloor` for commercial. A commercial job with no `commercialFloor` cannot be released.

Check figure: cost $10,000 at a 35% target prices at $15,390 (15,384.62 rounded up to $10). Margin 35.0%, markup 53.9%.

**Payment stages (residential)**

Stage amount = price × pct, plus GST on that amount. Stages must total 100%.

**Cash flow (commercial)**

- Work and cost are spread over `months` (even, or an s-curve).
- Invoice at the end of each month. The owner pays in the month `ceil(ownerPayDays / 30)` later, less `holdbackPct`.
- Subcontract share of cost = subcontract lines ÷ direct. Subcontractors are paid when Steadfast is paid, less the same holdback. Other costs are paid in the month they happen.
- Holdback (Steadfast's and the subcontractors') is released in month `months + ceil((lienDays + releaseDays) / 30)`.
- Show money in, money out and bank balance by month, the lowest balance and its month. GST is left out. Label every default "check the contract".

## 3. Release checklist

A quote can be released when all of these pass. Show each with its status:

1. Every sheet with markups has a scale.
2. No items marked "check" are left.
3. Every line has a cost.
4. Contingency is set.
5. Margin is at or above the floor.
6. Estimate class is A or B (C and D are budget numbers, not quotes).
7. Exclusions are written.
8. At least one risk is listed.
9. Assemblies in use are confirmed by Kamal (warning only).
10. Every selected bidder has WCB clearance and insurance ticked.
11. Open RFIs are listed (warning only).
12. Residential stages total 100%.
13. Commercial: `commercialFloor` is set and the cash flow is marked reviewed.

## 4. Estimator import file

```json
{
  "format": "steadfast-estimator-import",
  "version": 1,
  "job": "Unit 200 office refresh",
  "preparedBy": "Claude estimator",
  "date": "2026-10-22",
  "summary": "Flooring, base and doors from A-101 and the finish schedule on A-601.",
  "sheets": [ { "sheet": "A-101", "scaleLabel": "1/4\" = 1'-0\"", "basis": "Title block scale note" } ],
  "conditions": [
    { "name": "LVP flooring, offices", "measure": "area", "assembly": "LVP flooring with underlay",
      "division": "09", "location": "Level 1", "heightFt": null, "alternate": null }
  ],
  "measurements": [
    { "condition": "LVP flooring, offices", "sheet": "A-101",
      "points": [[0.21, 0.33], [0.42, 0.33], [0.42, 0.51], [0.21, 0.51]],
      "statedQty": 245, "deduct": false, "note": "Office 104",
      "basis": "Dimensions 14'-0\" x 17'-6\" on A-101", "confidence": "high" }
  ],
  "rooms": [
    { "name": "Office 104", "location": "Level 1", "lengthFt": 14, "widthFt": 17.5, "heightFt": 9,
      "doors": 1, "windows": 1, "floor": "LVP flooring with underlay", "walls": "Paint walls, 2 coats",
      "ceiling": "T-bar ceiling 2x4", "base": "Rubber base 4\"", "alternate": null,
      "basis": "Room finish schedule A-601" }
  ],
  "lines": [
    { "division": "01", "description": "Disposal bin (20 yd)", "qty": 3, "unit": "ea", "unitCost": null,
      "type": "E", "allowance": false, "alternate": null, "basis": "Two bins demolition, one at finish" }
  ],
  "alternates": [ { "name": "Alternate 1", "description": "Replace kitchen cabinets", "sign": "add" } ],
  "bids": [
    { "trade": "Electrical", "division": "26",
      "scopeItems": [ { "text": "Pot lights per E-101", "plug": 0 } ],
      "bidders": [ { "name": "", "amount": 0, "includes": ["y"], "wcbClearance": false, "insurance": false, "notes": "" } ] }
  ],
  "rfis": [ { "question": "Is the existing VCT in corridors staying?", "reference": "A-101 note 4" } ],
  "risks": [ { "risk": "Asbestos in existing flooring adhesive (pre-1990 building)", "likelyCost": 4000, "inPrice": 0 } ],
  "exclusions": [ "Asbestos testing and abatement" ],
  "assumptions": [ "Work during normal business hours" ],
  "clarifications": [],
  "priceChanges": [ { "code": "09-LVP", "unitCost": 3.4, "source": "Supplier quote, 2026-10-20" } ]
}
```

### Import rules

- Every section is optional. Send only what changed.
- Names match existing items without regard to case. A condition, room or alternate that does not exist is created. An assembly name that does not exist leaves the condition with no assembly and flags it.
- `sheet` matches a sheet name, or a 1-based page number in the order the sheets appear.
- A sheet scale is only applied when that sheet has none. Otherwise the difference is reported to Kamal.
- `rooms[].floor/walls/ceiling/base` are assembly names.
- Everything imported gets `source: "estimator"` and `status: "check"`.
- `priceChanges` are never applied automatically. They are listed for Kamal to accept one by one.
- The import never deletes or overwrites anything that already exists. It only adds, and it reports anything it skipped.
- After an import, the app shows a summary: what was added, what was skipped and why, and how many items wait for Kamal's check.
