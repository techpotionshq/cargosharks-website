# Pricing and packaging

> **Every number on this page is a placeholder.** They are written as
> `[KWD ####]` so that nothing accidentally ships as a quote. The *structure*
> is the recommendation; the figures need a costing exercise and one commercial
> decision per line. §6 lists what has to be decided and by whom.

---

## 1. The shape, and why it is this shape

The product is sold **one deployment per customer** — the customer's own
database, their own instance, in the region they choose. That is a
data-sovereignty answer as much as an architecture, and in this market it is the
strongest thing we sell. It also moves a real, recurring cost onto whoever
operates it, and that cost is linear in customers.

So the pricing has to do three things at once:

1. **Recover implementation properly.** Data migration is where these projects
   die, and an implementation fee that undercharges guarantees a rushed one.
2. **Recover per-deployment operating cost in the recurring line**, because it
   does not amortise across customers the way multi-tenant hosting does.
3. **Stay decidable in one meeting** for a family business. A structure needing
   a spreadsheet to understand does not get signed in the Gulf mid-market.

Hence: a small fixed pilot, a fixed implementation, and an annual subscription
banded by branches and named users — not by shipment volume.

**Not priced per shipment, deliberately.** Volume pricing punishes the customer
for growing, invites gaming, and turns every renewal into an argument about
counting. It also makes the bill unforecastable, which is exactly what a
forwarder with thin margins will not accept.

---

## 2. The pilot

| | |
|---|---|
| **Fee** | `[KWD ####]` fixed |
| **Duration** | 15 working days from the day their data lands — not from signature |
| **Credited** | In full against the implementation fee if they proceed within `[90]` days |
| **Includes** | Their branding, two branches, one rate card, ~20 seeded job files, tracking page, portal, quotation, ops board, hosting for the pilot period |
| **Excludes** | Invoicing, agent portal, notifications, production use, real money, real load |

**Set the fee at the level a managing director signs without convening anyone.**
Its job is to convert a decision into an experiment, not to be profitable. If
the number needs a board, it is wrong.

**Say the credit term out loud in the room.** It removes the wasted-money
objection entirely and makes proceeding the path of least resistance.

**The pilot environment stays live** for `[60]` days after the demo, because the
real selling happens afterwards, internally, when the operations manager shows
the owner.

---

## 3. Implementation

Fixed fee, banded by what actually drives the work — which is data, not users.

| Band | Shape | Fee |
|---|---|---|
| **Single branch** | One entity, one currency, up to `[300]` customers, up to `[2]` rate cards migrated | `[KWD ####]` |
| **Multi-branch** | Up to `[5]` entities, multi-currency, up to `[1,500]` customers, up to `[10]` rate cards | `[KWD ####]` |
| **Group** | More than `[5]` entities, or migration of open jobs and open receivables from an existing system | `[quoted]` |

**What the fee covers:** provisioning and hosting setup, branding applied end to
end, branch and user configuration, master-data migration (customers, contacts,
agents and hauliers, ports and places), rate-card import, milestone templates
matched to their vocabulary, document types, working calendars, role and
permission configuration, two training sessions per role, and go-live support.

**What it does not cover, and why it is separate:**

| Excluded | Why | Rate |
|---|---|---|
| Cleaning an unusable rate card | It is *their* data quality, and the effort is unbounded until seen | `[KWD ###]`/day |
| Migrating open jobs and open receivables mid-year | A cutover, not an installation — see below | `[quoted]` |
| Custom document templates beyond the standard set | Design work | `[KWD ###]` each |
| Integration with an accounting package | Per package, and unbounded across packages | `[quoted]` |
| On-site presence outside `[Kuwait]` | Travel | at cost |

**The cutover surcharge is not a way to charge more.** Going live at a
period end with a clean master-data load is a different project from going live
mid-year carrying open jobs, part-paid invoices and containers already accruing
free time. The product supports the second — bulk import handles open jobs and
open receivables — but it takes a reconciliation pass that the first does not.
Price it separately or absorb it silently forever.

---

## 4. Subscription

Annual, paid annually in advance. Banded by branches and named users.

| Edition | Branches | Named users | Includes | Annual |
|---|---|---|---|---|
| **Single** | 1 | up to `[10]` | Everything below, one entity | `[KWD ####]` |
| **Network** | up to `[5]` | up to `[40]` | Multi-entity, multi-currency, consolidated views | `[KWD ####]` |
| **Group** | unlimited | `[quoted]` | Above, plus read API and outbound webhooks | `[quoted]` |

**Every edition includes the whole product.** There is no feature ladder, no
"upgrade to unlock the audit log," and no per-module pricing. Three reasons: the
capabilities that would be natural upsells — audit, RLS, bilingual, whitelabel —
are structural and cannot be switched off without weakening the product; a
feature ladder invites a renewal negotiation every year; and a mid-market
forwarder reads a matrix of crossed boxes as a warning.

**Included in every edition:**

- All five modes: sea FCL, sea LCL, air, land, courier
- Enquiry queue with SLA clocks · quotation and award · buy/sell/margin
- Rate cards, buy and sell, with temporal validity and the accessorial catalogue
- Job file, milestones, containers, exceptions, tasks, operations board
- Free-time clocks — demurrage, detention, storage — writing their own charge lines
- Customs stage tracking with declaration references, duty and SLA
- Document vault with versioning and per-document release control
- Public tracking page and branded customer portal, both bilingual
- Job costing, invoicing, receipts, ageing, statements
- Immutable audit trail · configurable reference data · full data export
- Bulk import of customers, contacts, partners, locations, rate cards, open jobs, open receivables
- Whitelabel — logo, palette, typography, letterhead, domain
- Arabic and English throughout

**Not counted as a named user:** customer-portal logins and agent-portal logins.
Charging a forwarder for their own customers' access would defeat the feature
that makes their customers stop ringing them, which is the thing they are buying.

**Portal login limits:** none. The point is adoption.

**The agent portal is a scaffold in the current release**, not a shipped
capability — the route exists and is correctly scoped, but RFQ response,
rate-card upload and milestone posting by agents are in delivery. Do not list it
as included until it ships, and do not let it be discounted for. See
[`../manual/08-agent-portal.md`](../manual/08-agent-portal.md).

---

## 5. Hosting and support

### Hosting

| Option | What it means | Annual |
|---|---|---|
| **Operated by us** | We run the deployment — provisioning, backups, restore drills, monitoring, upgrades, patching | `[KWD ####]` |
| **Customer's own cloud** | Their account, their region; we deploy and operate under their subscription | `[KWD ####]` |
| **Customer-operated** | They run it; we supply migrations, releases and runbooks | `[KWD ####]` reduced |

Region choice is real, and it is worth saying so: **Kuwait, UAE, Saudi or EU.**
For a prospect who has been told their data will sit in an unnamed data centre,
this is a selling point rather than a line item.

Backups are nightly with `[30]`-day retention. **Restore drills are scheduled,
not optional** — `pnpm fleet:restore-drill` restores into a scratch database and
verifies the *content*, including that the security policies survived, because a
restore that silently drops them produces a database that looks perfect and
enforces nothing. Say this to any technical reviewer; it is the single most
credible operational claim we have.

### Support

| Tier | Response | Hours | Included with | Annual |
|---|---|---|---|---|
| **Standard** | `[1 business day]` | Sun–Thu, `[08:00–17:00 AST]` | every subscription | included |
| **Priority** | `[4 business hours]`, `[1 hour]` for a full outage | Sun–Thu extended | — | `[KWD ####]` |
| **Named engineer** | `[2 business hours]`, direct line | Sun–Thu extended, on-call for outages | — | `[KWD ####]` |

**Support is a named person, not a ticket queue.** This is a deliberate
counter-position to the incumbent complaint — *"if you call CargoWise, they tell
you to watch a video"* — and it prices accordingly. Do not undercut it into
being unprofitable, or it becomes a promise that quietly stops being kept.

**Vendor access is granted by the customer, not held by us.** Support cannot see
a customer's data by default. Access is granted from *Settings → Vendor access*,
scoped to named branches, read-only or read-write, expiring on its own, against
a ticket reference — and every session opened under it is recorded in a log
neither the customer nor we can edit afterwards. While a grant is live, a banner
sits at the top of every page.

**Lead with this in any security review.** No competitor on the battlecard can
say it, and it converts the standard "what can your staff see" question from a
liability into a demonstration.

---

## 6. What has to be decided before this page is quoted

| # | Decision | Owner | Blocks |
|---|---|---|---|
| 1 | Per-deployment hosting cost at rest — compute, storage, backups, monitoring, per region | technical | Every hosting figure, and the subscription floor |
| 2 | Implementation effort in days for each of the three bands, from the Al-Qabandi engagement's actual hours | delivery | Implementation fees |
| 3 | Currency of the price list — KWD, USD or AED — and whether it varies by market | commercial | The whole page |
| 4 | Support cost model: how many engineer-hours a deployment consumes per year in steady state | delivery | Support tiers |
| 5 | Discount authority: what a salesperson may give without asking | commercial | Every negotiation |
| 6 | Multi-year terms — is there a 2- or 3-year price, and what does it lock | commercial | Renewal risk |
| 7 | Whether resale is permitted at all under the Al-Qabandi engagement (`Q1`) | legal | **Everything** |

---

## 7. Discipline at the negotiating table

**Discount the term, not the price.** A first-year discount that resets is a
renewal argument scheduled twelve months out. A two-year commitment at a better
annual rate is worth more to both sides and does not teach the customer that the
list price is fiction.

**Never discount implementation.** It is the line where cutting price directly
cuts delivered quality, and a rushed migration produces an unhappy reference
customer — which in a market this small costs more than the deal was worth.

**Give scope, not money, when you must give something.** An extra branch, an
extra training session, a longer pilot window, an extra document template. Each
has a bounded cost and none of them repricies the contract.

**Do not sell a deployment to a customer who will not commit to a go-live date.**
An indefinitely postponed implementation consumes support and delivery attention
without ever producing a reference.
