---
title: Rates and rate requests
routes: [/rates, /enquiries/[id]]
messages: [rates.importCards, rateRequests.request, rateRequests.accept, rateRequests.supersede]
---

# Rates and rate requests

::: intro
A rate is a price for moving goods on a route. Buying rates are what partners charge you; selling rates are what you charge customers.
:::

## What it is for

**Rate cards** hold your buying and selling prices by lane (a route between two places) and mode, each with a validity period. When a rate card covers an enquiry, [{app:quote.priceIt}]{.ui} prices it in seconds. When none does, you ask partners with a **rate request**.

![**Rate cards.** Live cards, lanes priced blind, and cards about to expire. {app:rates.importCards} sits in the page header.](shot:/rates?focus=role=link[name="{app:rates.importCards}"])

## Step by step: loading rate cards

::: steps
1.  On [Rate cards]{.ui}, press [{app:rates.importCards}]{.ui} at the top of the page.
2.  Choose the spreadsheet of cards (one row per lane, mode and charge). The import checks every row before anything is saved and lists the rows it cannot take, with the reason.
3.  Fix those rows and import again. Rows that overlap a live card on the same lane and dates are refused rather than guessed at.
:::

## Step by step: asking partners for prices

::: steps
1.  On the enquiry, press [{app:rateRequests.request}]{.ui}. The list shows the partners whose coverage includes this lane, with their transit time.
2.  Tick the partners to ask and press [Send requests]{.ui}. Each gets one email.
3.  When they reply by email, the reply is read into charge lines and shown under **Rates from agents**, with the total in their currency and in yours, and the cheapest marked.
4.  Press [{app:rateRequests.accept}]{.ui} on the reply you choose. It becomes a buying rate card for the lane. If a card for the same lane is already live, the reply offers [{app:rateRequests.supersede}]{.ui} instead, which closes the old card on the day the new one starts.
5.  Press [{app:quote.priceIt}]{.ui}. The system adds the customer's house margin and shows the result. If a newer reply arrived after the rate you priced from, the pricing says so, so you can check before sending.
:::

![**Request rates.** The partners who cover the lane.](shot:/enquiries/enq-318?click=role=button[name="{app:rateRequests.request}"]&crop=role=dialog)

![**Rates from agents.** Each reply, its total in two currencies, and the cheapest marked.](shot:/enquiries/enq-318?scroll=text=Rates from agents)

## Good to know

-   **House margin.** If only a buying rate covers the lane, the system needs the customer's house margin (a percentage over cost, a fixed amount, or a fixed selling price). It is set per branch on the customer's page under [{app:customers.termsBranch}]{.ui}.
-   **No two cards may overlap** on the same lane and dates. A refused import row is that protection working.
-   **A partner with no coverage is never asked.** Add their lanes on the partner's page under *Where they go*.
-   **Fix the rate card, not the quotation.** A wrong price on a card will be wrong on every future quote until the card is fixed.
-   **A reply line the reader could not classify** is still counted in the total and flagged, so the comparison never looks cheaper than the partner's real price.
-   **Lanes priced blind** on the rate cards screen counts the routes you ship with no buying rate on file. Start contract talks there.
