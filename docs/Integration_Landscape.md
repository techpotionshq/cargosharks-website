# Integration Landscape — What We Can Connect To, and On What Terms

**External-service research for the seven ports · v1.0 · Internal**

| | |
|---|---|
| **Prepared by** | techpotions |
| **Date** | 18 August 2026 |
| **Question asked** | For each external service the SRS defers to R2 — tracking, e-invoicing, customs, FX, accounting — what exists, what does it cost, what do the terms permit, and what can we verify today? |
| **Relationship to the code** | `apps/service/src/ports/index.ts` declares seven interfaces. This is the research behind the adapters in `apps/service/src/adapters/`. |
| **Status** | Tracking and FX verified against live APIs; carrier-direct built against the DCSA spec and awaiting a live carrier key. E-invoicing and customs are desk research; both are blocked on commercial decisions rather than engineering. |

> **The finding in one line:** ocean carriers now publish free, standardised tracking APIs that make an aggregator optional for most of what we need — but the two events that drive detention billing are exactly the two nobody publishes reliably, and e-invoicing is a contract we have not started.

---

## 1. How to read this

Every claim below is tagged with how it is known, because the difference has
already cost this project a day:

| Tag | Meaning |
|---|---|
| **Verified** | Run against the live service with a real credential. Reproducible. |
| **Documented** | Taken from the provider's own documentation. Not executed. |
| **Reported** | From secondary sources. Treat as a lead, not a fact. |

Two integrations were written against *documentation* and both were wrong in
ways that testing caught immediately — a Terminal49 endpoint that does not
exist, and a milestone vocabulary that exists nowhere in our own seed. The tag
is not bureaucracy; it is the difference between an integration and a guess
with a type signature.

---

## 2. Container tracking

### 2.1 What we actually need

Eight events, and only eight. Taken from `apps/service/src/adapters/carrier-events.ts`,
which maps onto the codes `db:seed` writes into `milestone_templates`:

| Our code | Meaning | Source |
|---|---|---|
| `empty_picked_up` | empty dispatched to shipper | terminal / depot |
| `gate_in` | full container into origin terminal | terminal |
| `loaded` | loaded on vessel | carrier |
| `vessel_departed` | departure from POL | carrier |
| `vessel_arrived` | arrival at POD | carrier |
| `discharged` | discharged at POD | carrier |
| `gate_out` | full container leaves destination terminal | terminal / carrier |
| `empty_returned` | empty returned to depot | **depot only** |

No rail, no intermodal. That is a premium tier at every provider and Gulf FCL
does not need it — worth saying out loud in any quote, because it should price
lower.

`IN-01` **The split matters more than the count.** Four of the eight come from
the carrier and are freely available; the last one comes from a depot and is
not reliably available from anybody.

### 2.2 Terminal49 — verified, and the wrong shape for us

**Verified** with a live free key on 18 August 2026.

The adapter was first written to `CarrierTracking.poll(reference)` and called
`/v2/containers/{ref}/transport_events`. **That endpoint does not exist.** It
was inferred from the shape of our own port. Terminal49 works the other way
round:

1. submit a bill of lading or booking number and a carrier SCAC
2. Terminal49 resolves it against the carrier asynchronously — `status:
   "pending"` at creation, minutes to hours to settle
3. it pushes container events by webhook from then on

**Verified behaviour:**

| Call | Result |
|---|---|
| `POST /v2/tracking_requests` with SCAC | `201`, JSON:API envelope, `status: "pending"` |
| Same, no SCAC (`auto_detect_vocc_scac`) | `201`, `pending` |
| Blank reference | `422`, "Request number can't be blank; too short (minimum is 6)" |
| Any read endpoint on a free key | `401` — *"You do not have permissions for using the API, except for creating tracking requests"* |

`IN-02` **A free Developer Key reportedly allows 10 active containers with
webhooks and read access** (**Reported**, from their pricing page). The key we
tested is not one — it permits only tracking-request creation. Getting a proper
Developer Key would close the last unverified part of the integration at zero
cost, and is the cheapest next action in this document.

### 2.3 Terminal49's commercial model is the real problem

From their reply, 18 August 2026:

> *"We generally don't sublicense our product, but we do partner with companies
> by establishing direct relationships with the end customer. In this model,
> you would integrate with our APIs and layer your value on top, while we
> maintain the customer relationship."*

`IN-03` **That is incompatible with how the platform is sold.** `FR-CP-01` and
`NFR-16` require the operator's branding everywhere a customer or partner can
see and **no supplier branding anywhere**. A customer signing a direct contract
with a named US vendor is the opposite. Concretely it costs:

- **"One platform, one bill" breaks.** Every sale gains a second procurement
  conversation before tracking works.
- **They hold the relationship and see the customer list.** Nothing stops them
  pricing to our customer directly at renewal.
- **The cost cannot be absorbed into our pricing**, so tracking cannot be the
  thing that makes our package obviously better value.

It is not all downside — no per-container float and no margin exposure — but
for a product positioned on *independence and data ownership* (`MK-02`),
inserting a vendor between us and the customer is the same structural weakness
we identified in DP World.

### 2.4 Carrier-direct via DCSA — the alternative that changes the maths

**Documented**, and strong.

DCSA (Digital Container Shipping Association) standardises the Track & Trace
data model. Founding members — MSC, Maersk, CMA CGM, Hapag-Lloyd, ONE,
Evergreen, Yang Ming, HMM, ZIM, plus PIL — are approximately **75% of global
container trade**.

| Carrier | DCSA version | Access | Notes |
|---|---|---|---|
| Maersk | v2.2 | Self-serve, 5-step registration, sandbox | Webhooks and bulk lookup |
| Hapag-Lloyd | v2.2.4 (spec 2.3.1 published) | Self-serve, sandbox, no sales rep | **BETA** — they advise trusting the website over the API |
| CMA CGM | v2.2.0 | Self-serve portal | |
| MSC, ONE | in progress | Registration and approval, 1–2 weeks | |
| Evergreen, HMM, Yang Ming, ZIM | inconsistent | Mostly EDI, some API pilots | |

**All free.** The cost is engineering time, not licence fees.

`IN-04` **DCSA removes the reason aggregators existed.** The historical
argument for paying one was that every carrier spelled "discharged"
differently. One DCSA adapter now covers several carriers, with per-carrier
auth as the only difference.

`IN-05` **The port's original shape was right; Terminal49 was the outlier.**
Carrier APIs are poll, which is exactly `CarrierTracking.poll`.

#### Built — `adapters/dcsa-tracking.ts`, `workers/carrier-poll.ts`

The adapter covers Maersk, Hapag-Lloyd and CMA CGM behind one profile table;
per-carrier auth is the only difference between them, as predicted. What the
build changed against this section:

- **The port takes a query, not a string.** DCSA has three parameters —
  `carrierBookingReference`, `transportDocumentReference`, `equipmentReference`
  — so `poll(reference: string)` could not say which kind of reference it held.
  `TrackingQuery` carries the type and the SCAC.
- **The SCAC is reference data.** `partners.scac` (0019), edited by an
  administrator on the carrier's partner record. Without it the poll has no way
  to know which carrier answers for a shipment; with an aggregator you pay for
  that resolution.
- **`eventClassifierCode` is the field that matters most.** `EST`/`PLN` are
  estimates and must never reach `job_milestones.actual_at`; they land on
  `jobs.eta`/`etd` instead, which turns out to deliver the *other* thing
  operations refreshes a carrier website for.
- **Transhipment needed a rule.** A box through Jebel Ali is discharged twice.
  First-for-origin, last-for-destination, decided on timestamps rather than on
  `transportCallSequenceNumber` — which is one of the fields the three
  implementations populate differently.

`pnpm --filter @qabandi/service verify:tracking <SCAC> <reference>` asks a live
carrier and prints what came back — the check to run when a key is first
issued, and the one that distinguishes a wrong key from a wrong reference.

**Verification status:** the event model and the translation are tested
(`dcsa-events.test.ts`, 13 assertions) and the request construction is tested
against a stubbed transport (`dcsa-tracking.test.ts`, 12). The **hosts and
paths are Documented, not Verified** — no live carrier key has been run from
this repository. Each carrier's base URL is therefore overridable by
environment, so a sandbox host or a moved path is configuration rather than a
release.

### 2.5 The licence question — answered, and it fits our model

This is the clause that decides whether carrier-direct is available to us at
all. From Maersk's API terms:

> The Registered User is granted a limited, non-exclusive, revocable and
> non-transferable/non-sublicensable right to access and use services —
> **including to authorise Individual User(s) to do the same on its behalf and
> for the sole benefit of the Registered User.**

and *Tracked Data* is defined as concerning shipments *"related to Registered
User's and/or its Affiliates'"*.

`IN-06` **The permitted model is: the customer registers, our software uses
their credentials for their own cargo.**

| Model | Permitted |
|---|---|
| techpotions registers once and serves every customer | **No** — benefit of another person; effectively sublicensing |
| Each operator registers; our software acts on their behalf | **Yes** — literally what the clause describes |

This maps exactly onto deployment-per-customer, where
`DCSA_MAERSK_CONSUMER_KEY` and its siblings are per-deployment configuration
and this repository holds none of them. It also
inverts the Terminal49 objection: with carrier-direct the customer already has
the carrier relationship commercially, so nobody new is inserted.

**Open:** whether a forwarder acting as agent on cargo booked by someone else
is within "Registered User's shipments". As the party on the bill of lading,
almost certainly; worth a lawyer's five minutes before scale.

### 2.6 What carrier-direct cannot give us

**Documented**, and this is the boundary.

| Carrier | Reports | Does not report |
|---|---|---|
| Maersk | Gate In, Loaded, Departure, Arrival, Discharged, **Gate Out**, Delivered | **Empty return** — tracking ends at gate-out |
| Hapag-Lloyd | Empty Released, Gate In, Loaded, Departure, transshipment detail, Arrival, Discharged, Available for Pick-up, **Gate Out**, Delivered | **Empty return** — *"depends on the haulage type and terminal"* |

Hapag-Lloyd names the authoritative record explicitly: the **Equipment
Interchange Receipt (EIR) from the depot**.

`IN-07` **Demurrage is computable from carrier data; detention is not.**

- **Demurrage** = discharge → gate-out. Both reported reliably. **Free.**
- **Detention** = gate-out → empty return. The second event is not published.

That is an unfortunate overlap: the events hardest to obtain are the ones with
money attached. And **buying does not necessarily solve it** — if the depot
does not publish, no aggregator has it either. Gulf depot coverage is the
specific thing to interrogate before paying anyone.

`IN-08` **Merchant haulage blinds the carrier entirely.** Maersk loses
visibility once a third-party trucker collects — common for a Kuwaiti forwarder
using its own hauliers.

`IN-09` **The detention answer may be a document, not an API.** The EIR is
authoritative and arrives as paper or PDF. We already have a documents module
with release states. Capturing empty-return from an uploaded EIR is likely a
better answer than any feed, and nobody else is selling it.

### 2.7 Alternatives to Terminal49

| Provider | Shape | Fit |
|---|---|---|
| **Vizion** | Developer-first API, same terminal events, **lower per-container cost** (**Reported**). Positions explicitly for *"logistics technology companies… build their own visibility products"* | **The strongest alternative** — that positioning is the embed model Terminal49 declined |
| **Portcast** | Volume-tier pricing, mid-market, ETA-prediction flavoured | Reasonable |
| **SeaVantage, GoComet** | Platform, not pure API | We already have the platform |
| **project44, FourKites** | Enterprise, six-figure annual | Wrong league |

`IN-10` **Switching is one file.** The event map already accepts both
Terminal49's namespaced `container.transport.vessel_departed` and the bare
`vessel_departed` that polling providers send. That was deliberate.

### 2.8 Recommendation

1. **Get Al-Qabandi's carrier split.** If 80% of volume is on four lines,
   carrier-direct covers 80% for free. One email, and it decides everything.
2. **Build the DCSA adapter**, starting with Maersk — self-serve, conformant,
   best documented, and verifiable against a sandbox.
3. **Buy terminal data only, if at all** — a much smaller purchase and a far
   better negotiating position than buying everything.
4. **Quote Vizion in parallel** with wholesale/embedded licensing named
   explicitly.

---

## 3. E-invoicing

**Documented.** Nothing here has been executed, because all of it waits on a
contract.

### 3.1 The dates

| Milestone | Date | Status |
|---|---|---|
| UAE ASP appointment due | ~30 October 2026 | **~10 weeks from writing** |
| UAE PINT AE go-live | 1 January 2027 | ~19 weeks |
| Saudi ZATCA Phase 2 | already live and enforced | |
| Kuwait | no mandate | |

### 3.2 We cannot be the access point

`IN-11` Peppol accreditation requires active certification **and a solution
that has been in operation for a minimum of two years**. That is not something
to plan around; it is something to accept. `MK-04` already said this and it
holds.

The division that follows is the reason the port was worth declaring a year
early: **the document is the hard part and it is ours; the transmission is a
POST and it is theirs.**

### 3.3 What is built and what is not

| Piece | State |
|---|---|
| `EInvoiceTransmit` port | Declared since R1 |
| ASP hand-off adapter | **Built** — `apps/service/src/adapters/einvoice.ts`. Generic, because the document is a Peppol standard and only the envelope differs. Invoice id travels as an idempotency key: a retry after a timeout would otherwise file the same invoice twice with a tax authority |
| Rejection handling | **Built** — reported, not thrown. A rejection is information about the document; throwing would retry something that will be rejected identically forever |
| **PINT AE / UBL document generation** | **Not built.** Substantial, pure, fully testable offline, no credentials needed |
| ASP appointed | **No.** Longest lead time in this document |

### 3.4 Recommendation

`IN-12` **Start the ASP conversation now; it is a contract with lead time and
no engineering blocks it.** Then build document generation, which is the half
we own.

**Answer first:** which phase does Al-Qabandi's UAE entity fall into? Phase 1
is large taxpayers. If their DXB entity is in a later wave the urgency is real
but the date moves, and that changes how hard to push.

---

## 4. Customs filing — do not build

**Documented**, and the conclusion is negative.

`SRS §11` defers this as needing *"technical access and credentials from the
General Administration of Customs"*, which reads like a procurement task.

`IN-13` **It is not procurement; it is a concession.** In 2005 KGAC awarded a
twenty-five-year Build-Operate-Transfer concession to Global Clearinghouse
Systems — a joint venture in which **Agility is the majority shareholder** — to
run Kuwait customs on the MicroClear platform. That concession runs to 2030.

Access is therefore gated by a concessionaire majority-owned by one of the
largest logistics groups in the region, who has no commercial reason to enable
a competitor's software vendor. The honest estimate is not "months"; it is
**"unknown, possibly never"**.

Dubai and Oman customs *are* connectable and Logistaas already are — but both
are relationship-gated, and neither is worth starting before a UAE customer
asks.

**What R1 does is enough:** the broker files, the declaration number, date and
duty come back onto `customs_stages`, and the SLA clock and exception board
read them. `PP-06` is answered without pretending we are in the filing path.

`IN-14` The adapter **refuses** rather than returning an empty declaration. The
other manual adapters answer "nothing to add", which is true of a rate feed;
this one would be answering "I filed your declaration".

---

## 5. FX rates — done

**Verified** against the live feed, 18 August 2026.

`IN-15` **Free feeds cover KWD.** `open.er-api.com` needs no key and returns
Gulf currencies. ECB-backed feeds such as Frankfurter do **not** carry AED or
KWD, so the obvious European default is the wrong one here.

Verified: real KWD rates at `numeric(19,8)` precision as strings, an unknown
currency dropped rather than failing the batch, and the effective date taken
from the feed rather than the clock — `fx_rates_unique` includes
`effective_on`, so a clock-derived date writes a second row for the same day
instead of being idempotent.

`FX_API_URL` is a URL template, so a commercial feed later is configuration
rather than code.

`JOBS.fxIngest` had been scheduled `0 5 * * *` since Release One **with no
handler**, so the job was enqueued daily and discarded. It now runs.

---

## 6. Accounting — blocked on one answer

`SRS §12` asks *"which accounting package, and who administers it?"* and it is
still unanswered. It determines whether `FR-FN-12` is a file or an integration.

`IN-16` **Pick exactly one package and ship a real connector; keep the file
export for everyone else.** "We export a file" loses to "we integrate" in a
demo, but building for every package loses to building for one.

---

## 7. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| I1 | Al-Qabandi's carrier split by volume | account | Whether carrier-direct covers enough to matter |
| I2 | Do Kuwaiti depots (Shuwaikh, Shuaiba) publish empty-return events to anyone? | commercial | Whether detention is computable at all, by us or a vendor |
| I3 | Per-container price from Vizion and Terminal49 at our volume | commercial | Feature or cost centre |
| I4 | Which UAE e-invoicing phase covers Al-Qabandi's DXB entity? | tax adviser | Urgency of §3 |
| I5 | Which ASP will we appoint? | commercial | Everything in §3, ~10 week lead |
| I6 | Which accounting package does Al-Qabandi run? | account | §6 |
| I7 | Is a forwarder-as-agent within "Registered User's shipments" under carrier terms? | legal | Scale of §2.5 |

---

## 8. Sources

Accessed 18 August 2026.

**Container tracking**
- [Terminal49 API pricing](https://terminal49.com/api-pricing)
- [Terminal49 API docs — pricing](https://terminal49.com/docs/api-docs/useful-info/pricing)
- [Vizion](https://www.vizionapi.com/) · [Vizion pricing](https://www.vizionapi.com/container-tracking/pricing)
- [Best container tracking software 2026 — SeaVantage](https://www.seavantage.com/blog/best-container-tracking-software-in-2026-8-platforms-compared)
- [Terminal49 alternatives](https://traqocontainer.com/compare/terminal49-alternatives)

**Carrier APIs and DCSA**
- [Ocean carrier track-and-trace APIs: who has them, how to connect — Shipmnts](https://blog.shipmnts.com/ocean-carrier-track-and-trace-apis-integration-guide)
- [DCSA members](https://dcsa.org/about-us/members) · [DCSA conformance](https://dcsa.org/standard-conformance)
- [DCSA Track & Trace standards adopted by most member carriers](https://dcsa.org/resource/dcsa-track-trace-standards-adopted-member-carriers/)
- [Hapag-Lloyd DCSA T&T v2.3.1 portal](https://api-portal.hlag.com/products/portfolio/events-tracing-for-web-api-product-d73213?version=2)
- [CMA CGM DCSA T&T v2.2.0](https://api-portal.cma-cgm.com/products/api/operation.trackandtrace.v1)
- [How Maersk container tracking actually works — Tradlinx](https://blogs.tradlinx.com/how-maersk-container-tracking-actually-works-what-the-portal-shows-what-it-doesnt-and-what-the-events-mean/)
- [How Hapag-Lloyd container tracking actually works — Tradlinx](https://blogs.tradlinx.com/how-hapag-lloyd-container-tracking-actually-works-what-the-portal-shows-what-it-doesnt-and-what-the-events-mean/)

**Carrier terms**
- [Maersk — API Services user terms](https://terms.maersk.com/API-Services)
- [Maersk — Integration Services user terms](https://terms.maersk.com/Integration-Services)
- [Maersk — API licence terms](https://terms.maersk.com/api-license-terms)

**FX**
- `open.er-api.com` — exercised directly, no key required
