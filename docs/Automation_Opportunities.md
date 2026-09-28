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

## 2. Supplier-invoice variance → auto-flag — **shipped**

**What it does.** When the AI reads a supplier invoice, the capturing transaction
compares each charge type's billed total against what the job accrued for that
partner, and raises an internal `supplier_invoice.variance_flagged` alert to the
branch's staff when a line is billed over the tolerance the partner or charge
type carries. Over-billing only — under-billing stays on the payables review
screen. The agent who billed 460 for a cost accrued at 400 is caught before
finance approves the bill, not at month-end when the margin is already booked.

**What it reused.** `core/matching.ts` (the accrued-vs-billed comparison, already
tested) behind a new pure `varianceAlert`, `invoice-extract`'s write path, the
`variance_tolerance_*` columns already on partners and charge types, and the
notification outbox. No schema change and no migration — the columns were waiting.

**One decision worth recording.** The comparison runs in the invoice's own
currency and skips an accrual booked in another currency, rather than converting
at extraction time: `matching.ts` warns that an ad-hoc rate turns a variance into
an FX movement in disguise, and the extraction path stamps no rate. A
cross-currency line still surfaces on the review screen once a person matches it.

---

## 3. Enquiry auto-acknowledge + one-click fill — **shipped**

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

**Shipped.** The acknowledgement reply and the loop-breaker, and the
`acceptAllProposals` one-click fill over the review queue. Auto-*accepting* those
proposals with no click at all — the same rule, gated by a confidence ceiling — is
the front of the end-to-end pipeline in §7.

---

## 4. Carrier milestone tracking — **built, switched off**

**What it does.** Auto-advances a sea shipment's milestones (loaded, sailed,
discharged) and revises its ETA by asking the carrier directly over DCSA, instead
of an operator refreshing a carrier website and typing the date onto the job.

**The win.** The job status is true without anyone maintaining it, and the
customer hears "your container sailed" without asking. This is the demo that
makes a forwarder feel the platform is *watching the shipment for them*.

**Status — the whole path is in the tree and tested.** `adapters/carrier-tracking.ts`
resolves the driver, `adapters/dcsa-tracking.ts` speaks DCSA to Maersk,
Hapag-Lloyd and CMA CGM, `workers/carrier-poll.ts` polls the fleet hourly, and
`workers/carrier-milestone.ts` writes each milestone under the one rule that
matters — a feed never overrules a hand-entered date. It ships **off**:
`carrierTracking` defaults to `manual`, and it lights up when an administrator
sets the driver to `dcsa` and pastes one carrier's key at Settings › Integrations.

**The catch, revised.** An earlier version of this note called the port
"completely unused" and the integration "the heaviest lift." Neither is true any
more — the code is done. What remains is not a build but a **credential**: the
client registering with a carrier (all three are self-serve and free). An
aggregator was built here first and removed — it priced per container and pushed
events by a webhook that could move a discharge date; carrier-direct DCSA is free
and answers on demand, which is why the only step left is a key.

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

## 7. End-to-end auto-pipeline — **shipped (off by default)**

§0 and §3 built the manual pieces — ask agents, read replies, accept, price. Four
gated workers now chain them so an enquiry runs to a **draft quotation** with no
clicks, stopping one step short of the customer:

- **Auto-accept extractions** (`enquiryAutoAccept`). Extraction applies a proposal
  in the same write it files it — but only into an empty column, above a confidence
  ceiling, and where the value resolves without ambiguity. The ambiguous port or
  commodity is left in the queue, exactly as the manual accept refuses it. This is
  §3's one-click fill with no click.
- **Auto-fanout RFQs** (`rateAutoFanout`). An enquiry that reaches a resolvable
  lane with no RFQ yet has one opened to every covering agent, feeding §0's
  send-sweep. The complete lane is the whole gate — because extraction writes
  proposals, not columns, a complete lane is a *confirmed* one.
- **Auto-award** (`rateAutoPromote`). Once replies are in, the cheapest — priced to
  the branch base currency — becomes a buy card, by a chosen strategy: `first` (the
  moment one comparable reply parses), `all` (once no agent is still outstanding),
  or `wait` (a set window from the first RFQ, so a silent agent cannot stall it).
- **Auto-draft** (`quoteAutoDraft`). A covered enquiry is priced against the
  customer's house margin and lands a **draft** quotation, covering note alongside.
  It never sends.

**The line.** A person is left only where one is owed — the ambiguous
port/commodity, and the send to the customer. Everything between runs on a minute
sweep, and an enquiry with an award, a quote, or an existing RFQ is each its own
loop-breaker.

**Off until switched on.** Each is an `integration_settings` driver defaulting to
its inert value — the carrier "ships dark" idiom of §4 — because they mail real
agents, write to enquiries unattended, and draft customer-facing quotes. An
administrator turns each on at Settings › Integrations. The prerequisites are
data, not code: an agent needs coverage rows and an email contact, and a customer
needs a house margin for auto-draft to price (otherwise the enquiry is left for a
person, not guessed at).

**What it reused.** All of §0 and §3. The money-critical halves moved into
`@qabandi/db` so a coordinator's click and the sweep write byte-for-byte the same
rows: `promoteRateReply` (the buy card), `priceEnquiryToQuote` (the quotation, and
the same house-margin engine "Price it" runs), and `resolveProposal` (the
ambiguity refusal, now shared rather than copied). Every worker is DB-tested and
carries an injectable gate so its on/off can be proved without the settings cache.

---

## How to sequence this

1. ~~**§1 Rate-expiry refresh**~~ — **shipped.** Made §0 self-sustaining.
2. ~~**§2 Invoice variance**~~ — **shipped.** The one with money in it; over-billing
   is caught at the door now, not at month-end.
3. ~~**§3 Enquiry auto-ack + one-click fill**~~ — **shipped.** The customer-facing
   polish, plus the review-queue fill.
4. ~~**§7 End-to-end auto-pipeline**~~ — **shipped, off by default.** Auto-accept,
   auto-fanout, auto-award and auto-draft chain §0 and §3 into a hands-off
   enquiry→draft-quote run. What is left here is not a build but an *enablement*:
   flip the four drivers on, give agents coverage/contacts and customers a house
   margin, and watch one live run through.
5. **§5 / §6** — small surfacing wins still open (free-time countdown, quote chase).
6. **§4 Carrier tracking** — **built, off.** No longer a build: register with one
   carrier and flip the driver to `dcsa`.

The remaining builds (§5, §6) are changes against tested foundations, §4 is not a
build at all, and §7 is a switch-on. That is the whole argument: the platform was
designed so these were short.
