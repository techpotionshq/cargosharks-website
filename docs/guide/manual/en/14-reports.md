---
title: Reports
routes: [/reports, /dashboard]
messages: [reports.title, reports.exportCsv]
---

# Reports

::: intro
How much each shipment, customer, lane and salesperson earned.
:::

## What it is for

[{app:nav.finance}]{.ui} sits beside [Reports]{.ui} under Finance. Reports is the margin report: shipments by the date they sailed, with revenue, cost, gross profit and margin, cut by branch, customer, trade lane, mode or salesperson. Credit notes are netted in, so a refunded shipment shows what it really earned. The dashboard adds win rate, average margin and median response time.

![**The margin report**, grouped by trade lane.](shot:/reports?dimension=lane)

## Step by step

::: steps
1.  Choose the grouping (branch, customer, trade lane, mode or salesperson) and the date range, then [Apply]{.ui}.
2.  [{app:reports.exportCsv}]{.ui} takes the whole report out for a spreadsheet.
:::

## Good to know

-   Read win rate and average margin together. A rising win rate with a falling margin means the team is buying work.
-   Reports need the `report.read` permission. Scheduled email reports are not in this release; every screen exports today.
