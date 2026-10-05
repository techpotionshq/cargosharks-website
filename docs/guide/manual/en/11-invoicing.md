---
title: Invoicing and receipts
routes: [/finance, /invoices, /invoices/[id], /payments]
messages: [nav.finance, invoiceDetail.languageChange.open]
---

# Invoicing and receipts

::: intro
Billing the customer and recording the money that comes in. This belongs to finance.
:::

## What it is for

[{app:nav.finance}]{.ui}, the first screen under Finance, shows what you are owed, what is overdue, what has come in, and receipts not yet matched. **Earned, not yet billed** lists shipments with sales that have never reached an invoice.

![**{app:nav.finance}.** Owed, overdue, received, unallocated, and the shipments earned but not yet billed.](shot:/finance)

## Step by step: an invoice

::: steps
1.  Under **Earned, not yet billed**, press [Draft invoice]{.ui} on the shipment. Its sales lines are copied onto a draft.
2.  Check the lines and the tax treatment. [{app:invoiceDetail.languageChange.open}]{.ui} switches the document between English and Arabic until the invoice is approved.
3.  Approve it, then **Issue**. Issuing gives the next number in the branch's series and cannot be undone.
4.  Open the PDF and send it. The customer also sees it in the portal.
:::

![**An invoice.** Total, received and still outstanding, with the lines and the money matched to it.](shot:/invoices/inv-4119)

## Step by step: a receipt

::: steps
1.  [Payments]{.ui}, [Record a receipt]{.ui}: date, customer, their reference, method and amount.
2.  Match it to one or more invoices. Part of a receipt may stay unallocated if the customer paid on account.
:::

## Good to know

| State | Means |
|---|---|
| Draft | Being built. No number. Can be changed. |
| Approved | Reviewed. Still no number. |
| Issued | Has its number. Cannot be edited; correct it with a credit note. |
| Part paid, Paid | Receipts matched against it. |
| Void | Cancelled. The number stays used, so the series has no gap. |

-   **Clear unallocated receipts daily.** Until a receipt is matched, the customer still looks as if they owe the money.
-   Kuwaiti dinar amounts keep three decimals. Each line keeps the exchange rate it used.
-   **Accounting exports** on {app:nav.finance} hand a period to your accounting package as a journal: preview it, then post the period.
