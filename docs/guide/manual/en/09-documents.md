---
title: Documents
routes: [/jobs/[id], /documents, /api/jobs/[id]/documents/[kind]]
messages: [documentActions.issueIn]
---

# Documents

::: intro
Every shipping document is built from the shipment's parties and cargo lines, in English or Arabic.
:::

## What it is for

The **Issue and preview** panel on the shipment produces four documents: the **house bill of lading** (or house air waybill for air), the **delivery order**, the **packing list** and the **customs declaration pack**. The Documents screen lists every file across your shipments, newest first.

![**Issue and preview.** EN and AR previews, and two ways to issue each document.](shot:/jobs/job-1041?scroll=text=Issue and preview&crop=section:has-text("Issue and preview") >> nth=-1)

## Step by step

::: steps
1.  Make sure the shipper, consignee and cargo lines are filled in.
2.  Press [EN]{.ui} or [AR]{.ui} to preview. A preview stores nothing.
3.  Press [Issue]{.ui} to keep the copy that is handed over, in the language you are working in, or [{app:documentActions.issueIn,language=ar}]{.ui} for the other language. It appears under *Shipment files*.
4.  Press [Release]{.ui} when the customer should see it. Released documents appear on the tracking page and in the portal.
:::

![**A house bill of lading**, produced from the shipment's data.](shot:/api/jobs/job-1041/documents/house_bill?pdf=1)

![**Documents.** Every issued file, every version, newest first.](shot:/documents)

## Good to know

-   **Issuing and releasing are separate.** Issuing says "this is the document". Releasing says "the customer has it now".
-   **A new version supersedes the old one;** both stay visible. Never issue a correction as a different document.
-   **Surrender bill** records a telex release on a numbered sea house bill. It cannot be undone, and the released bill reaches the customer's portal at the same moment.
-   **A failed download** shows an error page in both languages with a button to try again, rather than an empty file.
-   A delivery order expires seven days after issue.
