---
title: The journey of one shipment
routes: [/enquiries/[id], /quotes/[id], /jobs/[id], /portal/quotes/[id], /finance]
---

# The journey of one shipment

::: intro
Fintas Steel Industries in Kuwait has two 40 foot high cube containers of steel coils to bring from Ningbo, a port in China, to its yard near Shuwaikh port. Here is what happens, step by step. The pictures in this guide come from the same example.
:::

### 1. The customer sends a WhatsApp message

"We have 2 × 40'HC of steel coils to move ex Ningbo, cargo ready at the mill." The message reaches the office's WhatsApp number and becomes a new **enquiry** within seconds, already linked to the company because the phone number is on file.

### 2. The assistant collects the details

The intake assistant waits until the customer stops typing, reads every message at once, and sees what is still missing. It asks once, in the customer's language, and fills in suggestions for a person to accept.

![**The enquiry.** The assistant's turns at the top, the full WhatsApp conversation below.](shot:/enquiries/enq-318)

### 3. The team asks partners for prices

The operations manager presses [{app:rateRequests.request}]{.ui}. The partners who cover this route each receive one email. Their replies come back to the enquiry and are read into charge lines.

### 4. They compare the replies

The replies are shown side by side, converted into dinars, with the cheapest marked. The cheapest becomes a **rate card**, a buying price on file, and sales press [{app:quote.priceIt}]{.ui}. The system adds the customer's agreed margin and shows buy, sell and margin together.

![**Rates from agents.** The replies, totals in two currencies, the cheapest marked.](shot:/enquiries/enq-318?scroll=text=Rates from agents&focus=text=Cheapest)

### 5. A quotation goes out

Pricing creates a draft quotation. Sales add a short covering note, check the PDF, and press [{app:quoteDetail.moveOpen.sent}]{.ui}. The margin is frozen at that moment.

### 6. The customer accepts in the portal

The customer signs in to the portal, opens the quotation and presses [Accept]{.ui}. The office sees it straight away.

![**The customer portal.** What the customer sees: the charges, the note, and Accept or Decline.](shot:/portal/quotes/{first:/portal/quotes}?who=customer)

### 7. The shipment is booked and tracked

A coordinator opens the shipment from the accepted quotation with [{app:jobForm.open}]{.ui}, so the agreed prices come with it, adds the vessel, the containers, the shipper and consignee, and records each milestone as it happens. The customer can follow it on the tracking page with the reference and a container number.

### 8. Documents are issued

The house bill of lading, the delivery order, the packing list and the customs pack are produced from the same data, in English or Arabic, and released to the customer when final.

### 9. The invoice goes out

Finance sees the shipment under **{app:nav.finance}**, among the shipments earned but not yet billed, drafts the invoice in one click, checks it and issues it. Issuing gives it the next number in the branch's series and cannot be undone.

### 10. Payment comes in

When the bank transfer arrives, finance records the receipt and matches it to the invoice. The invoice shows as paid, and the customer sees the same in the portal. On the other side, the agent's bill is captured, matched to the cost on the shipment, approved and paid.

::: tip
**Every step was a person's decision**

The assistant asked the customer for details and read the partners' replies. People accepted the details, chose the rate, sent the quotation, booked the shipment, issued the invoice and recorded the money.
:::
