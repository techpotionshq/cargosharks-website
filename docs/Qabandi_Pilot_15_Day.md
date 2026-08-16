# Qabandi Digital Freight Platform — The 15-Day Pilot

**Scope for a working proof of value · v1.0 · Internal**

| | |
|---|---|
| **Client** | AL-QABANDI & PARTNERS Co. (Shipping & Forwarding), Kuwait |
| **Prepared by** | techpotions |
| **Date** | August 2026 |
| **Duration** | 15 working days (3 calendar weeks) |
| **Relationship to the SRS** | A deliberate slice of `Qabandi_Release_One_SRS.md`. Same system, ~15% of the scope. |

> **The pitch in one line:** in three weeks we put Al-Qabandi's own lanes, own rate card and own job history into a working platform, and let them watch a shipment track itself.

---

## 1. Why a pilot rather than a proposal

Al-Qabandi said the whole operation is manual. That is not a scepticism problem — it is an imagination problem. Nobody who has run freight out of five mailboxes for thirty-four years can picture what "the customer just looks it up" feels like until they see it happening to **their own shipment reference**.

So we do not present slides. We hand them a URL, they type a job number they recognise, and the thing answers.

Three properties make this work commercially:

1. **It is their data, not a demo dataset.** Generic sample data reads as a product tour. Their own Shuwaikh–Jebel Ali lane, their own customer names, their own rate card reads as *their business, already running*.
2. **It is the real system, narrowed.** We are not building a throwaway prototype. Everything in the pilot is Release One code with the scope dialled down — so nothing is rebuilt afterwards, and the pilot becomes the foundation.
3. **It de-risks the decision for them.** A 15-day commitment is a decision a Kuwaiti family business can make in one meeting. A 16-week one is not.

---

## 2. The three moments

Everything in this scope exists to make three moments land in a twenty-minute meeting. If a feature does not serve one of these, it is out.

### Moment 1 — "Your customer stops calling you"

> Open `track.qabandi.com` on a phone. Type a real Qabandi job reference. A live shipment appears: milestones with dates, current ETA, route, containers, released documents. Switch to Arabic. Hand the phone to the person across the table.

**What it kills:** `PP-02`. No tracking exists on qabandi.com today. Every status update is a call answered by a person who first has to go and find out.

**Why it lands first:** it is the only moment that requires zero explanation. There is nothing to understand. A container is somewhere, and now everyone can see where.

### Moment 2 — "Twenty-four hours becomes twenty seconds"

> Take a real enquiry Al-Qabandi answered last month — we will have asked for it in advance and know how long it actually took. Enter it. The system prices it instantly off Al-Qabandi's own imported rate card and produces a branded PDF quotation on Al-Qabandi letterhead. Then say out loud how long the real one took.

**What it kills:** `PP-01`. The website promises an estimate within 24 hours, assembled by a person, because the rates live in spreadsheets.

**The version for the owner, not the ops manager:** on the internal comparison view the same enquiry shows **buy price, sell price and margin** side by side. Margin known at the moment of quoting, not reconstructed at month-end. For whoever signs the cheque, this is usually the moment.

### Moment 3 — "Five mailboxes become one board"

> Show the enquiry queue: every enquiry across Kuwait and Dubai, each with an owner and a clock counting. Then the operations board: live jobs, a container sitting on a customs hold, and a demurrage counter ticking that has already written its own charge line.

**What it kills:** `PP-03`, `PP-06`, `PP-07`. Their own company profile publishes five separate operational mailboxes. Nothing today gives an enquiry an owner, a clock, or a trace if it is never answered.

---

## 3. Scope

### 3.1 In — the pilot build

| # | Capability | Why it is in | SRS reference |
|---|---|---|---|
| 1 | **Qabandi branding end to end** — logo, colours, domain, letterhead on every screen and document. | Nothing reads as our product. This is non-negotiable for the illusion to hold. | `FR-CP-01` `NFR-16` |
| 2 | **Two entities: Kuwait and Dubai.** Users, roles, per-branch scoping. | Two is enough to prove multi-branch. Five is data-entry theatre. | `FR-ID-01…04` |
| 3 | **Real master data** — 20–30 real customers, ~10 real agents, real ports and airports. | Recognition is the whole trick. | `FR-MD-01` `FR-MD-04` `FR-MD-08` `FR-MD-11` |
| 4 | **One real rate card imported** — sea FCL on their busiest lane, plus air on one corridor. | Powers Moment 2. One card is enough; the engine does not care how many. | `FR-RT-01…04` `FR-RT-09` `FR-RT-10` |
| 5 | **Enquiry intake and queue** — manual entry plus a web form, with owner, status and SLA clock. | Moment 3. | `FR-EQ-01` `FR-EQ-03` `FR-EQ-04` |
| 6 | **Instant quote → branded PDF**, with buy / sell / margin on the internal view. | Moment 2, both halves. | `FR-EQ-05` `FR-EQ-07` `FR-EQ-08` |
| 7 | **Job file with milestones** — sea export, sea import, air export. Planned vs actual dates, ETA. | Makes tracking real rather than a mock-up. | `FR-JB-01…05` |
| 8 | **Document vault** — typed, attached to the job, with the customer-visible flag working. | Released documents on the tracking page are what make it feel like a system of record. | `FR-DC-01` `FR-DC-03` |
| 9 | **Public tracking page, no login** — reference plus second identifier, EN and AR. | Moment 1. | `FR-CP-05` |
| 10 | **Customer portal login** — one seeded customer: shipment list, detail, documents. | Shows the difference between the public view and the account view. | `FR-CP-03` `FR-CP-04` `FR-CP-08` |
| 11 | **Operations board** — live jobs, filters, exceptions oldest-first. | Moment 3. | `FR-JB-14` `FR-JB-09` |
| 12 | **One customs hold and one demurrage clock**, seeded and live, writing a charge line. | The single most persuasive detail in the whole demo. Costs almost nothing to include. | `FR-JB-06` `FR-JB-08` `FR-FN-03` |
| 13 | **Arabic on the customer-facing surface** — tracking page and quotation PDF, native RTL. | Cheap where it matters most, and no Gulf forwarder demo survives without it. | `NFR-01` `FR-CP-02` |
| 14 | **~20 seeded historical jobs** from their real job files, at varied stages. | An empty system demos nothing. A populated one looks alive. | — |

### 3.2 Out — and we say so plainly

Naming these in the room is a credibility move, not a weakness. It proves we know the difference between a pilot and a product.

| Excluded | Why it is not in a 15-day pilot |
|---|---|
| **Invoicing, credit notes, receivables** | The whole finance module. Needs three jurisdictions and their accounting package. Demoed as a roadmap slide, not as software. |
| **Agent portal, agent RFQ dispatch** | Requires real agents to log in and respond. Cannot be faked convincingly and is not needed for the three moments. |
| **Notifications and WhatsApp** | WhatsApp Business API provisioning and template approval alone take longer than this pilot. |
| **The other three offices** | Doha, Abu Dhabi and DWC. Two entities prove the model. |
| **Customs stage in full** | One seeded hold demonstrates the concept. The full declaration lifecycle is Release One. |
| **Accessorials engine, margin floors, versioning** | The rate engine runs, but on one card. Rate versioning and the full accessorial catalogue are Release One. |
| **Dashboards and reporting** | Numbers need volume to be interesting. Twenty jobs make a bad chart. |
| **Mobile POD, API, webhooks, audit UI, AI** | All Release One or later. |
| **Anything production** | No real customers, no real money, no real load. This is a copy of their data in a private environment. |

> **Script for the room:** "This is fifteen days. Invoicing, the agent network, WhatsApp and the other three branches are not in it — they are in the sixteen-week build. What you are looking at is the spine, running on your lanes."

---

## 4. The 15 days

Working days, assuming a Sunday–Thursday week.

| Days | Block | What gets done | Done means |
|---|---|---|---|
| **1–2** | **Data intake** | Receive and inspect their rate card, job files, customer and agent lists, brand assets. Map the rate card to the import template. Stand up the environment and subdomain. | We can read their rate card and know it will import. |
| **3–5** | **Foundation** | Kuwait and Dubai entities, users, roles. Import customers, agents, locations. Apply Qabandi branding across every screen and document template. | A Qabandi-branded system with their real customers in it. |
| **6–7** | **Pricing** | Import the rate card. Wire chargeable weight, coverage lookup, instant pricing. Branded quotation PDF on Kuwait letterhead. | A real lane prices in under ten seconds and produces a sendable PDF. |
| **8–9** | **Enquiry queue** | Intake form, manual entry, queue with owner, status and SLA clock. Internal comparison view with buy / sell / margin. | **Moment 2 and Moment 3a are demo-ready.** |
| **10–11** | **Jobs and documents** | Milestone templates for sea export, sea import, air export. Job file, document vault with release control. Seed ~20 historical jobs at varied stages. | A populated operations board. |
| **12** | **Tracking** | Public tracking page and customer portal shipment views. Released documents visible. | **Moment 1 is demo-ready.** |
| **13** | **The details that sell** | Seed the customs hold and the demurrage clock. Exceptions on the ops board. | **Moment 3b is demo-ready.** |
| **14** | **Arabic** | Tracking page and quotation PDF in Arabic, native RTL, reviewed by a native speaker. | Language switch works on the surfaces the customer sees. |
| **15** | **Rehearsal** | Full run-through against the demo script. Fix what breaks. Record a fallback screen capture in case the room has no internet. | Two people can each run the demo cold. |

**Buffer:** there is none. Fifteen days is fifteen days. If their data arrives late, the timeline moves day for day — see §5.

---

## 5. What we need from Al-Qabandi, and by when

This is the single largest risk in the pilot, so it goes in the meeting where they agree to it — not in an email afterwards.

| # | What | By | If it is late |
|---|---|---|---|
| 1 | **One real rate card** — the busiest sea lane, in whatever Excel form it lives in today. Not cleaned up. We want to see the mess. | Day 1 | Moment 2 has no engine behind it. Hard blocker. |
| 2 | **15–25 completed job files** — any format, including PDFs and email threads. | Day 2 | The system demos empty. Hard blocker. |
| 3 | **Customer and agent lists** — names and addresses, no financials needed. | Day 2 | We seed placeholder names and lose the recognition effect. |
| 4 | **Brand assets** — logo files, colours, and one existing quotation and invoice as a letterhead reference. | Day 2 | Branding looks approximate, which undermines the whole illusion. |
| 5 | **A subdomain** — e.g. `demo.qabandi.com`, plus DNS access. | Day 5 | We demo on our own domain, which weakens Moment 1 considerably. |
| 6 | **60–90 minutes with one operations person** — to walk one real job end to end and tell us what the milestones are actually called. | Day 3 | Milestone names will be wrong, and ops people notice immediately. |
| 7 | **One enquiry they answered recently**, with the honest turnaround time. | Day 8 | Moment 2 loses its punchline. |

> **The sentence to say out loud:** "We can be ready in fifteen working days from the day the rate card and the job files land. Not from signature — from the data."

---

## 6. The demo script

Twenty minutes. Ordered so that the least explainable thing happens first.

| Min | Beat | What we do | What we say |
|---|---|---|---|
| 0–2 | **Open cold** | Nothing on screen. Ask what happens today when a customer asks where their container is. Let them describe it. | "Walk me through it — who picks up the phone?" |
| 2–5 | **Moment 1** | Hand over a phone with `track.qabandi.com` open. They type a reference they recognise. Milestones, ETA, documents. Switch to Arabic. | "That is your job KWI-2026-0xxxx. Nobody was called." |
| 5–8 | **Portal view** | Log in as their seeded customer. Shipment list, detail, released documents, statement placeholder. | "Same data, more of it, because they have an account." |
| 8–13 | **Moment 2** | Enter their real enquiry. Instant price. Branded PDF. Then reveal how long the real one took. | "This is your rate card. Twenty seconds. The real one took a day and a half." |
| 13–16 | **Moment 2b — for the owner** | Switch to the internal comparison. Buy, sell, margin on every option. | "You knew your margin before you sent it, not at month-end." |
| 16–19 | **Moment 3** | Enquiry queue with clocks. Ops board. The customs hold. The demurrage counter and the charge line it wrote by itself. | "That charge line appeared on its own. Nobody had to remember." |
| 19–20 | **Close** | Name what is deliberately missing. Hand over the SRS. | "Invoicing, the agent network and WhatsApp are in the sixteen-week build. This was fifteen days on your own data." |

**Rules for the room:** one person drives, one person watches faces. Do not narrate features while they are reading a screen. When they interrupt with "can it do X" — if X is in the SRS, say which section and move on; if it is not, write it down.

---

## 7. Commercial structure

Recommended shape, to be confirmed before this goes out:

- **Fixed fee for the pilot**, small enough to be a single-meeting decision.
- **Credited in full against the Release One fee** if they proceed within an agreed window. This removes the "wasted money" objection entirely and makes proceeding the path of least resistance.
- **Hosting and third-party costs** for the pilot period are trivial and absorbed.
- **The pilot environment stays live** for an agreed period after the demo so they can show it internally — which is where the real selling happens, when the ops manager shows the owner.
- **The pilot is not throwaway.** Say this explicitly: everything built becomes Release One's foundation, so the fee buys progress rather than a demonstration.

---

## 8. Honest risks

| Risk | Likelihood | What we do about it |
|---|---|---|
| **The rate card is unusable** — inconsistent structure, merged cells, rates in people's heads rather than in the file. | High | Day 1–2 exists precisely to find this out. If it is bad, we hand-model one lane and demo that instead of importing. Moment 2 still works; we just do not claim the import is automatic. |
| **Their data arrives late.** | High | Day-for-day slip, agreed in the room up front. Do not absorb it silently. |
| **Milestone names are wrong**, and their ops people say so in the demo. | Medium | The 90-minute ops session on day 3 is the mitigation. Do not skip it to save time. |
| **Arabic is rushed** and a native speaker in the room spots it. | Medium | Restrict Arabic to the two surfaces we can review properly. Better two perfect screens than ten approximate ones. |
| **They ask for something out of scope mid-demo** and we improvise a yes. | Medium | Anything not in the SRS gets written down, not agreed. The SRS is the boundary. |
| **No internet in the meeting room.** | Low | Day 15 fallback recording. Always. |
| **They love it and want it in production next week.** | Low | Good problem. The answer is Release One §10 — and the pilot foundation means week one is already done. |

---

## 9. What success looks like

The pilot has worked if one of these happens in the meeting:

- They pick up the phone and type in a **second** reference we did not seed.
- The owner asks what the margin was on a job we did not prepare.
- They ask who else can see it — meaning they are already thinking about their customers.
- Somebody says a version of *"can we use this for the Ministry job"*.

It has not worked if the conversation stays on features and price. That means the three moments did not land, and the correct response is to stop selling and ask what they actually saw.

---

*Document ends. Pilot scope v1.0 · techpotions · August 2026 · Internal. Full specification: `Qabandi_Release_One_SRS.md`.*
