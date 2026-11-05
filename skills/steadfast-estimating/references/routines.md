# Routines

Paste-ready prompts for scheduled tasks in Steadfast's Claude. Each runs on its own with the Monday.com, QuickBooks Online, Gmail and Google Drive connectors. Each one only reports and drafts: nothing is sent, changed in QuickBooks or marked "ok" without an owner.

## Weekly price check (Monday 8:00 am)

```
Use the steadfast-estimating skill. Read last week's bills in QuickBooks Online. For each bill line that matches an item on the Monday.com Price book board, compare the unit cost. If it moved more than 5%, or the price book item has no cost, update the item's cost, source ("QBO bill: vendor, date") and date, and set Price status to check. Flag any item whose date is older than 90 days as stale. Then send Kamal and Tej one short summary on the Price book board: items updated, items to approve, stale items. Never write to QuickBooks.
```

## Estimates follow-up (Monday and Thursday 8:30 am)

```
Use the steadfast-estimating skill. On the Monday.com Estimates board, list every estimate that was sent more than 5 days ago with no reply from the client in Gmail, and every bid due in the next 7 days. For each, draft a short follow-up email from Kamal in Gmail (do not send). Post one update on the board for Kamal: what's due, what needs a follow-up, and links to the drafts.
```

## Post-mortem when a job closes (Friday 9:00 am)

```
Use the steadfast-estimating skill. Find jobs marked Complete on Monday.com this week that have no post-mortem yet. For each, pull the actual costs for that project from QuickBooks Online and compare them with the estimate, section by section. Create the item on the Post-mortems board: estimated and actual cost, margin achieved against target, change orders, hours, and the three biggest differences. For any line off by more than 10%, propose a price book change with status check. Post a short summary for Kamal and Tej. Never write to QuickBooks.
```

## Note for setting these up

- If QuickBooks bills aren't assigned to a project (Projects in QBO), the post-mortem can't find the job's costs. Tej needs to assign every bill to its project when entering it.
- Each scheduled task needs the connectors switched on for that task.
