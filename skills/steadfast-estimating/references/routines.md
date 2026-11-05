# Routines

Paste-ready prompts for scheduled tasks in Steadfast's Claude. Each runs on its own with the Monday.com, QuickBooks Online, Gmail and Google Drive connectors. Each one only reports and drafts: nothing is sent, changed in QuickBooks or marked "ok" without an owner.

## Weekly price book review (Monday 8:00 am)

The takeoff app runs the QuickBooks price check itself (Price book screen, "Check now"). It never changes a cost: it marks items "check" with the bill as the reason, and Kamal approves. This routine only reports. It never changes a cost and never runs a second price check.

```
Use the steadfast-estimating skill. On the Monday.com Price book board, list the items marked check, the items with no cost, and the items whose date is more than 90 days old. Post one short summary for Kamal and Tej on the board: what's waiting for approval, what's missing, what's stale. Do not change any cost or status, and do not write to QuickBooks.
```

## Estimates follow-up (Monday and Thursday 8:30 am)

```
Use the steadfast-estimating skill. On the Monday.com Estimates board, list every estimate that was sent more than 5 days ago with no reply from the client in Gmail, and every bid due in the next 7 days. For each, draft a short follow-up email from Kamal in Gmail (do not send). Post one update on the board for Kamal: what's due, what needs a follow-up, and links to the drafts.
```

## Post-mortem reminder (Friday 9:00 am)

The post-mortem itself is done in the takeoff app (Post-mortems), which saves it to the Post-mortems board and sends any price book changes to Kamal marked "check". This routine only reminds.

```
Use the steadfast-estimating skill. Find jobs marked Complete on Monday.com in the last two weeks that have no item on the Post-mortems board. Post one update for Kamal and Tej listing them, with a link to open each in the takeoff app. Do not create post-mortems, change costs or write to QuickBooks.
```

## Note for setting these up

- If QuickBooks bills aren't assigned to a project (Projects in QBO), the post-mortem can't find the job's costs. Tej needs to assign every bill to its project when entering it.
- Each scheduled task needs the connectors switched on for that task.
