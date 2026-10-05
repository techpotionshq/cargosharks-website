---
title: Supplier bills and payments
routes: [/payables, /payables/[id]]
messages: [payableForm.capture, payableForm.confirmTotal, payableForm.totalFromLinesWarning]
---

# Supplier bills and payments

::: intro
Payables: what partners bill you, checked against what each shipment expected to cost.
:::

## What it is for

The Payables screen lists supplier bills with four counters: needs review, awaiting approval, overdue and owed. Each bill line is matched to the cost on a shipment, and the difference is shown before anyone approves payment.

![**Payables.** Bills to review, to approve and to pay.](shot:/payables)

## Step by step

::: steps
1.  [{app:payableForm.capture}]{.ui}: the partner, their invoice number, date, currency and lines as printed. Or [Read a bill]{.ui} to upload a PDF or photo and have the lines read for you.
2.  **Check the total.** When a bill printed no total of its own, the system adds up the lines and says so: *{app:payableForm.totalFromLinesWarning,total=the sum}* Compare it with the PDF and tick *{app:payableForm.confirmTotal}*. The bill cannot be approved until someone has.
3.  [Match]{.ui} each line to the cost line on the shipment it settles. The verdict reads Agrees, Within tolerance, Billed over, Billed under or Not billed.
4.  Finance presses [Approve]{.ui}. If something is outside tolerance, tick *Approve anyway* and write why.
5.  [Record payment]{.ui} and allocate it to the bill.
:::

![**A supplier bill**, each line beside the shipment cost it was matched to.](shot:/payables/sup-8842)

## Good to know

-   Coordinators and operations managers capture and match. Only finance approves and pays. The person who entered a bill is not the person who clears it.
-   The same supplier invoice number cannot be captured twice.
-   A bill that was read from a file can be read again on request, if the first reading missed something.
-   [Dispute]{.ui} sends a bill back with what is wrong.
