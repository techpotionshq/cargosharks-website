---
title: The intake assistant
routes: [/enquiries/[id], /settings/intake-agent]
---

# The intake assistant

::: intro
The assistant that answers the first minutes of a WhatsApp or email enquiry, so the details are complete before a person starts pricing.
:::

## What it does

-   Waits until the customer stops typing (a quiet window, two minutes on WhatsApp and one minute on email by default), then reads everything they wrote at once.
-   Compares what it knows with the details your branch requires for that kind of shipment. For a full container, that is the mode, origin, destination, goods, number of containers and container type.
-   If something is missing, it asks for it, in the customer's language. When everything is known, it confirms that a person will send the quotation.
-   Fills in suggestions on the enquiry for a person to accept.

![**The Intake agent panel.** Its state, every turn it took, and a Take over button.](shot:/enquiries/enq-318?scroll=text=Intake agent&crop=section:has-text("Intake agent") >> nth=0)

## When it stays quiet

-   When the message is an automatic reply, an out of office or a bounce.
-   When it has already asked as many times as allowed (two questions, six hours apart, by default).
-   When a colleague has written to the customer, for twelve hours by default, or when someone pressed [Take over]{.ui}.
-   When the enquiry has already been quoted or closed.
-   When the same person has already had several messages from it today, or replies faster than a person could read.
-   When no model is configured. It then decides on what is already known and says nothing rather than guess.

## How to switch it on for a branch

::: steps
1.  Go to [Settings]{.ui}, then [Intake agent]{.ui}.
2.  Press [Edit]{.ui} on the branch.
3.  Tick the switch to turn the agent on, adjust the quiet windows, the number of questions and the required details if you want, and press [Save]{.ui}.
:::

![**Settings, Intake agent.** One row per branch: on or off, quiet windows, questions, required details.](shot:/settings/intake-agent)

::: note
**What it needs first**

A WhatsApp number or a mailbox connected for the branch (see the settings chapter), and a model key under [Integrations]{.ui}, [Document extraction]{.ui}.
:::
