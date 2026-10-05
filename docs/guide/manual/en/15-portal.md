---
title: The customer portal
routes: [/portal, /portal/quotes, /portal/quotes/[id], /portal/invoices, /track]
---

# The customer portal

::: intro
What your customers see when they sign in: their shipments, quotations and invoices, and nothing else.
:::

## What it is for

Each customer contact with a portal login sees only their own company's records. Three tabs: **My shipments**, **Quotations** and **Invoices**. The public tracking page works without any login.

![**My shipments.** Active shipments, arrivals this week and released documents.](shot:/portal?who=customer)

## Step by step: giving a customer access

::: steps
1.  Open the customer's page and press [Give portal access]{.ui} under *Portal logins*.
2.  Enter the person's name in English and Arabic, their email and language. They receive an email with a link to set their password.
:::

## What the customer does

-   **Quotations:** open an offer, download the PDF in English or Arabic, and press [Accept]{.ui} or [Decline]{.ui}. A decline can carry a reason. Expired offers can no longer be accepted.
-   **Invoices:** see each invoice, what has been paid and what is outstanding, and download the PDF.
-   **Shipments:** follow each shipment's progress, next step and estimated arrival. When customs is holding a shipment or a vessel is late, the page explains it in plain words and says whether the customer needs to do anything.

![**A quotation in the portal**, with Accept and Decline.](shot:/portal/quotes/{first:/portal/quotes}?who=customer)

![**Invoices in the portal.**](shot:/portal/invoices?who=customer)

## The public tracking page

Anyone with a shipment reference and one more identifier (a container, booking or bill of lading number) can see the route, each step, notices and released documents. Two identifiers are required so a guessed reference shows nothing. On a phone, the header carries labelled buttons for tracking and signing out.

![**Customer tracking.** No account needed.](shot:/track?who=none&fill=input[name=reference]=>KWI-2026-01041&fill=input[name=verifier]=>CMAU0385171&click=form button[type=submit] >> nth=-1)
