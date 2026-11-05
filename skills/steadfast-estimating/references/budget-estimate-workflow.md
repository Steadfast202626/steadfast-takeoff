# Budget estimate workflow

Use this when Kamal says something like "price this job", "here's the info from the site visit" or drops in drawings, photos, a video or a client email. You do the whole estimate. Kamal checks the numbers and sends it.

This is the routine that produced the Air Liquide budget in October 2026. Follow it in order.

## 1. Gather everything first

Look in this order, and list what you found before you start:

1. **The message itself** and anything attached: drawings (PDF), photos, videos, scope notes.
2. **Gmail** (connector): the client's emails on this job, the scope of work, bid due date, site rules, any trade or supplier quotes already received.
3. **Google Drive** (connector): the job folder, earlier versions, Kamal's measured sketches.
4. **Monday.com** (connector): the job's item on the Estimates board, the Price book board, past jobs of the same type on the Post-mortems board.
5. **QuickBooks Online** (connector): bills from the last 12 months for the trades and materials this job needs.

Videos: listen for scope Kamal speaks on site ("all the tile comes out", "partitions still to be decided"). Write down what he said and use it.

If the client has narrowed the scope (for example "only the kitchens and washrooms for now"), price only that scope and say so at the top.

## 2. Measure

- Follow `takeoff-from-drawings.md`. Kamal's own measured sketches count as drawings: read the dimension strings, check the scale against two of them, and trace.
- Photos fill gaps (fixture counts, existing finishes, ceiling type, cabinet runs). Say which photo a count came from.
- A phone photo of an old plan gives rough quantities only. Mark those `low` and say a site measure is needed.

## 3. Price every line, in this order

| Order | Source | How to mark it |
|---|---|---|
| 1 | Monday price book, status ok | "Price book" |
| 2 | A trade or supplier quote for this job (Gmail or Drive) | "Quote: [company], [date]" |
| 3 | QuickBooks bills from the last 12 months | "QBO bill: [vendor], [date]" |
| 4 | Market research: Edmonton or Alberta sources first, with a link | "Market: [source], [link]" and status check |

- Never make up a number. If none of the four gives a price, leave it blank and put it on Kamal's list.
- Market prices are fine for a **budget** estimate (Class C or D). They are never enough for a **fixed** price: before a fixed price goes out, every market-priced line over $1,000 needs a quote or Kamal's confirmed cost.
- Give low, likely and high for each market-priced line. The likely figure goes in the price.
- Convert US prices at the current Bank of Canada rate and say so.

## 4. Add Steadfast's rules

Read these from the Steadfast Estimating project instructions. As of October 2026:

- Contingency 10% residential, 7.5% commercial, 10% when drawings are incomplete.
- Travel or site premium 10% outside Edmonton, St. Albert, Sherwood Park, Spruce Grove, Leduc and Beaumont. Decline more than 60 km from Edmonton unless an owner approves. Industrial sites (gate time, orientation, escorts) also get the 10% site premium.
- Margin: residential floor 30%, target 35%. Commercial floor 25%, target 30%. Show cost, markup and margin side by side.
- GST 5%, always separate.
- Permits: look up the current fee schedule for the municipality and include it, with the link.

## 5. Build four things

All saved in the job's folder in Steadfast's Google Drive, named `[Client] - [Document] - YYYY-MM-DD`.

1. **Client budget estimate** (Google Doc). Cover page with the Steadfast logo; budget by room or area with a short description of the work; total, GST and total with GST; a budget range (minus 15% to plus 20% unless the job calls for something else); what's included; what's not; the questions needed for a fixed price; next step; a short "Working with Steadfast" closing; Kamal's signature. **No costs, markup or margin anywhere in it.**
2. **Internal cost breakdown** (Google Sheet). One row per line: room, item, quantity, unit, low, likely, high, source with link, a "Kamal confirmed cost" column, and cost used. Summary by room with contingency, premium, margin and markup. Mark it internal.
3. **Estimate file** for the takeoff app, through an import file and the helper, so the job lives in the app and on the Monday Estimates board.
4. **Email draft to the client** in Gmail, from Kamal, linking the budget. Kamal sends it himself.

## 6. Report to Kamal

Short and plain:

- The price, the range and the margin.
- The three lines that move the price most, and whether each is a quote, a QBO bill or a market price.
- Questions for the client.
- Costs he needs to confirm or quotes to get before a fixed price.
- Links to all four things.

Then add one line to the job's update on the Monday Estimates item.

## Before it goes to Kamal

- Read the client document as the client would. No cost, margin or internal note in it.
- Recalculate the totals from the sheet and check they match the document.
- Check every link opens.
- Say what you checked.
