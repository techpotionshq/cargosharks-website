---
title: Exchange rates
routes: [/settings/integrations, /reference, /enquiries/[id], /portal/quotes/[id]]
messages: [integrations.keys.fx, integrations.acknowledge.fx.resilient.title, fxFeed.attribution, fxFeed.convertedAt]
components: [apps/web/src/features/admin/ui/fx-feed-notice.tsx]
---

# Exchange rates

::: intro
Where the rates come from that turn a partner's dollars into dinars, and how the system says so.
:::

## What it is for

Partners quote in their own currency, and you sell in dinars. Every conversion uses the rate for that day, and every charge keeps the rate it was converted at. The rates can be typed by hand, read daily from a feed you name, or fetched daily from two public providers that are checked against each other and against the Gulf currency pegs.

![**Settings, Integrations, {app:integrations.keys.fx}.** How the daily rates arrive, and where they come from.](shot:/settings/integrations?scroll=section.rounded-card:has(h2:text-is("{app:integrations.keys.fx}"))&crop=section.rounded-card:has(h2:text-is("{app:integrations.keys.fx}")))

## Switching on public rates

::: steps
1.  Go to [Settings]{.ui}, [Integrations]{.ui}, [{app:integrations.keys.fx}]{.ui}, and choose *{app:integrations.drivers.fx.resilient}*.
2.  The system asks first: *{app:integrations.acknowledge.fx.resilient.title}*. Read the notice. These are indicative rates from third parties, not a bank or central bank rate.
3.  Tick the acknowledgement and save. From the next morning a rate arrives for each tracked currency.
:::

![**Configuring the feed.** Typed by hand, a feed you name, or two public providers checked against each other.](shot:/settings/integrations?click=section.rounded-card:has(h2:text-is("{app:integrations.keys.fx}")) >> role=button[name="Configure"]&crop=role=dialog)

## Where the source shows

-   **On reference data**, beside each rate: the provider it came from, when it was fetched, or the name of the person who typed it.
-   **On an enquiry's rate replies**, the converted total says which rate it used, so a comparison between a dollar reply and a dinar reply is never a mystery.
-   **On quotations and invoices the customer sees**, a short footnote says that amounts in other currencies were converted at the rate on a given date, and that an invoice may be converted at the rate on its own date.
-   **When the feed is late**, the screens that use rates say how old the newest automatic rate is, so you can enter today's rate by hand rather than quote on an old one.

![**Reference data.** Each rate with its source and when it arrived.](shot:/reference?scroll=section.rounded-card:has(h2:text-is("Exchange rates"))&crop=section.rounded-card:has(h2:text-is("Exchange rates")))

::: warn
**Check before quoting**

Public rates are indicative. For a large or unusual quotation, check the rate against your bank before you send it.
:::
