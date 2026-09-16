# Automations that make the forwarder's day shorter

The pilot showed what the client responded to: the parts of the day a person
spends *retyping* — an email into an enquiry, a broker's PDF into a rate card, a
supplier invoice into a payable. Every automation below removes one of those, and
each is costed honestly against **what the codebase already has**, because the
cheapest automation is the one whose hard half is already written and tested.

They are ordered by ratio of *operator time saved* to *engineering left to do*.

---

## 0. Rate procurement — **shipped**

**What it does.** For a lane with no rate on file, the coordinator picks the
agents who cover it and hits *Request rates*. The service emails each agent, an
LLM reads whatever comes back — a number in the body, a PDF tariff, a
spreadsheet — and the enquiry screen ranks the replies cheapest-first, converted
to dinar. One click turns the winning reply into a buy rate card, and the
pricing engine finds it the next time the enquiry is priced.

**The win.** The manual loop was: email five agents, wait, open five replies,
retype the cheapest into the rate-card importer. That becomes: pick five, wait,
click accept.

**What it reused.** The inbound-mail pipeline, the `invoice-extract` model
pattern, `groupRateCards` (the CSV importer's own folding), and the pricing
engine's existing "uncovered lane is an RFQ" hook. The database table
(`rate_requests`) had been waiting since the first migration.

> The rest of this document is the backlog. Each entry names the pieces already
> in the tree, so the estimate is a build, not a discovery.

---

## 1. Rate-card expiry → auto-refresh — **shipped**

**What it does.** A rate card expires on a date. The *Rates* screen already
computed "expiring within 30 days" and a nightly digest emailed staff about it.
This closes the loop: the same nightly job now opens a rate request to the
lapsing card's incumbent agent (sourced from the card, not an enquiry, via
`source_rate_card_id`), the minute sweep mails it, the model reads the reply, and
a *Renewals in flight* panel on the Rates screen puts an accepted quote one click
from a **successor** card that starts the day the old one ends — so the lane
never lapses and the no-overlap constraint is never fought.

**The win.** Lanes never silently fall out of cover. A coordinator stops pricing
"on the blind" (the product's own words for an uncovered lane) because the rates
refresh themselves.

**What it reuses.** All of §0, plus the `respond_by` column already added to
`rate_requests` for exactly this chasing, and the expiry horizon constant
(`RATE_CARD_EXPIRY_HORIZON_DAYS`) both the screen and the digest already share.

**Effort.** Small. A scheduled job that lists expiring buy cards and writes
`rate_requests` rows the send-sweep already drains. Days, not weeks.

---

## 2. Supplier-invoice variance → auto-flag  ·  *money left on the table*

**What it does.** An agent bills 460 for something quoted at 400. The engine that
catches this — `core/matching.ts`, comparing quoted vs accrued vs billed — is
**written and tested today**, and `invoice-extract` already reads supplier
invoices off inbound mail into `supplier_invoice_lines`. The missing piece is the
alert: when a read invoice exceeds the tolerance a partner or charge type already
carries (`variance_tolerance_*` columns exist on both), raise it to finance
instead of letting it flow into the job's P&L.

**The win.** Overbilling is caught at the door, not at month-end when the margin
is already booked. This is the automation that pays for the others.

**What it reuses.** `matching.ts`, `invoice-extract`, the `variance_tolerance`
columns (a strong signal this was the intended use), and the notification outbox
for the alert.

**Effort.** Medium. The comparison and the extraction exist; the work is the
tolerance check and the alert surface. A week or two.

---

## 3. Enquiry auto-acknowledge + one-click fill  ·  *first impression, every time*

**What it does.** An emailed enquiry already gets read: `enquiry-extract`
proposes the twelve cargo fields (mode, lane, weight, incoterm…) into a review
queue on the enquiry screen. Two additions make it feel instant to the customer:
an automatic *"received, your reference is KWI-ENQ-…"* reply the moment the mail
lands, and one button that accepts all high-confidence proposals at once.

**The win.** Every customer gets an acknowledgement within the minute, in their
language, with a reference to quote back. The coordinator confirms a filled-in
enquiry rather than typing an empty one.

**What it reuses.** `enquiry-extract` and its proposals panel (both live), the
notification templates, and the same **loop-breaker** the rate replies use — an
auto-acknowledgement is exactly the path that once turned one bounce into 195
enquiries (`Operations_Findings §11`), so it inherits that guard rather than
re-earning the scar.

**Effort.** Small–medium. The reply template + loop-breaker wiring, and a
bulk-accept action over proposals that already exist.

---

## 4. Carrier milestone tracking  ·  *biggest "wow", heaviest lift*

**What it does.** The `CarrierTracking` port is declared in the service and
**completely unused** — a shaped hole waiting for an implementation. Wiring it to
a liner/carrier feed would auto-advance a shipment's milestones (loaded, sailed,
arrived) and notify the customer, instead of an operator refreshing a carrier
website and updating the job by hand.

**The win.** The job status is true without anyone maintaining it, and the
customer hears "your container sailed" without asking. This is the demo that
makes a forwarder feel the platform is *watching the shipment for them*.

**The catch.** It needs a real carrier integration (or an aggregator), which is an
external dependency with its own onboarding — unlike everything above, the hard
half is *not* already in the tree. High value, but scope it as its own project.

**What it reuses.** The port abstraction, the milestone model, and the customer
notification path. Everything except the feed itself.

---

## 5. Free-time (demurrage / detention) alerts  ·  *avoids a specific, painful bill*

**What it does.** A container accrues demurrage after its free days run out. The
clock engine (`core/clocks.ts`) and the accrual jobs (`free-time-accrual`,
`free-time-warning`) already exist. Extend the warning from "staff digest" to a
countdown that flags a shipment *before* the charge starts, and names who to push
to move it.

**The win.** Demurrage is a charge a forwarder eats when it surprises them. A
three-day-out alert turns it into a phone call instead of an invoice.

**What it reuses.** The clock engine and both accrual jobs — this is a surfacing
change more than a new capability.

**Effort.** Small.

---

## 6. Quote follow-up  ·  *close the loop on sent quotes*

**What it does.** A quote goes out and nothing comes back. The quote-expiry
warning job already exists for the deadline; add a gentle chase to the customer a
few days before it lapses, and flag un-answered quotes to the owner.

**The win.** Fewer quotes die of silence. The forwarder's win-rate is partly just
following up, and following up is exactly what a person forgets when busy.

**What it reuses.** `quote-expiry` job, the notification path, the quote status
model.

**Effort.** Small.

---

## How to sequence this

1. ~~**§1 Rate-expiry refresh**~~ — **shipped.** Made §0 self-sustaining.
2. **§2 Invoice variance** — the one with money in it, and the next to build. Do
   it when there's a fortnight.
3. **§3 Enquiry auto-ack** — cheap, and it's the customer-facing polish that
   demos well.
4. **§5 / §6** — small surfacing wins to slot between the larger pieces.
5. **§4 Carrier tracking** — plan it separately; it's the only one whose hard
   half isn't already written.

Every item except §4 is a build against tested foundations. That is the whole
argument: the platform was designed so these were short.
