# Qabandi Digital Freight Platform — Release One

**Software Requirements Specification · v1.1 · Internal**

| | |
|---|---|
| **Client** | AL-QABANDI & PARTNERS Co. (Shipping & Forwarding), Kuwait |
| **Prepared by** | techpotions |
| **Date** | August 2026 |
| **Status** | Specification as proposed. Section 11 revised against the build on 23 August 2026. |
| **Revisions** | v1.1 (23 Aug 2026) leaves §2–§10 as written — the acceptance conditions are the ones agreed — and rewrites §11 against the code: which deferrals have since shipped (§11), what was built that this document never asked for (§11.1), and which of the 126 requirements are still open (§11.2). §8 carries the same status per interface. |
| **Scope** | 126 functional requirements · 18 non-functional · 12 modules · 16 weeks |

> **Release One in one line:** the smallest system that runs a job from enquiry to invoice without ever leaving it.

---

## Contents

1. [Reading this document](#1-reading-this-document)
2. [What we found](#2-what-we-found)
3. [Pain points](#3-pain-points)
4. [What Release One is](#4-what-release-one-is)
5. [Users and roles](#5-users-and-roles)
6. [Functional requirements](#6-functional-requirements)
7. [Data model](#7-data-model)
8. [External interfaces](#8-external-interfaces)
9. [Non-functional requirements](#9-non-functional-requirements)
10. [Delivery plan](#10-delivery-plan)
11. [Out of scope for Release One](#11-out-of-scope-for-release-one)
12. [Open questions for discovery](#12-open-questions-for-discovery)
13. [Traceability](#13-traceability)
14. [Acceptance and next steps](#14-acceptance-and-next-steps)

---

## 1. Reading this document

### 1.1 What Release One means here

Release One is not a trimmed-down version of everything in the proposal deck. It is a deliberately chosen spine: **one job record that carries an enquiry through quoting, award, execution, documents and invoicing**, with a customer portal on one side and an agent portal on the other. Everything that does not touch that spine is moved to a later release and listed openly in [Section 11](#11-out-of-scope-for-release-one), with the reason.

The test applied to every candidate feature: *if this is missing, does a job have to leave the system to get finished?* If yes, it is in Release One. If no, it waits.

> **Reading v1.1.** Sections 2–10 describe the system as it was specified before a line was written, and are left alone so that "done" stays measurable against what was agreed. Section 11 is the part that has been revised: the build moved faster than the deferral list, and several things this document put in Release Two turned out to be cheaper to build than to work around. Where the specification and the code disagree, the code is the record — and §11.2 says so, requirement by requirement.

### 1.2 Requirement numbering

| Prefix | Module | Prefix | Module |
|---|---|---|---|
| `FR-ID` | Identity, branches and access control | `FR-CP` | Customer portal and public tracking |
| `FR-MD` | Customers, agents and master data | `FR-AP` | Agent and partner portal |
| `FR-RT` | Rate cards and pricing engine | `FR-FN` | Job costing, invoicing and receivables |
| `FR-EQ` | Enquiry, quotation and award | `FR-NT` | Notifications and messaging |
| `FR-JB` | Job file and execution | `FR-RP` | Dashboards and reporting |
| `FR-DC` | Documents | `FR-AD` | Audit, administration and data |

Non-functional requirements use `NFR-nn`. Pain points use `PP-nn`.

Priority is **Must** — Release One does not ship without it — or **Should** — planned for Release One, first to move if discovery reveals a heavier requirement elsewhere. Nothing is marked lower; lower-priority ideas were cut rather than listed.

### 1.3 What we know and what we are guessing

We researched Al-Qabandi from the outside: the company profile, the website, the public record, and the regulatory environment. We have **not** seen the books, the shipment volumes, the rate files, or a day in the operations room.

Findings in [Section 3](#3-pain-points) are therefore labelled **Observed** where we can point at evidence, and **Inferred** where we are reasoning from how forwarding businesses of this shape normally work. Discovery exists to convert every inference into a fact — or delete it.

---

## 2. What we found

Al-Qabandi is a substantially larger and more complex operation than its digital surface suggests. That gap is the opportunity.

### 2.1 The business

| Dimension | What the record shows | Source |
|---|---|---|
| **Founded** | 1992, Kuwait City. Started as a customs broker and freight forwarder; now positioned as an end-to-end logistics solutions provider. | Company profile |
| **Footprint** | **Five offices across three countries** — Kuwait City (HQ, 1992), Dubai (1993), Doha (2009), Abu Dhabi (2010), Dubai World Central / Jebel Ali (2012). | Company profile |
| **People** | 100+ employees per the company profile; LinkedIn lists the 201–500 band. Actual headcount and split by function is a discovery question. | Profile · LinkedIn |
| **Model** | **Non-asset-based.** Capacity is bought from carriers, agents and hauliers on every job. The buy side is a network, not a fleet — which makes rate management the commercial core. | Company profile |
| **Facilities** | Two company-owned 3PL distribution centres (Kuwait and Dubai). Kuwait warehousing: 1,000 m² shaded plus 3,000 m² open, insured, 24-hour security and fire systems. | Company profile |
| **Service lines** | Sea (FCL, LCL, break bulk, RO-RO, out-of-gauge, reefer), air (express, direct, deferred, consolidated), land (LTL and FTL across the GCC and Levant, cross-border clearance), customs clearance under their own licence, warehousing and 3PL, supply-chain management, project cargo, hazardous goods, packing and crating, cargo insurance. | Profile · website |
| **Network** | Global agency network of forwarding partners; preferred ocean liner and airline programmes. | Company profile |
| **Track record** | End-to-end logistics solution delivered for the Kuwait Ministry of Defence; long-standing project-cargo capability. | Company profile |

> ⚠️ **Correction for the proposal deck:** the deck says "3 countries / 3 branches" and "3,000 m² warehousing". Their own profile says **five offices** and **1,000 m² shaded + 3,000 m² open**. Worth fixing before the next version goes out.

### 2.2 The digital surface today

| Capability | qabandi.com as it stands | State |
|---|---|---|
| **Quotation** | A "free estimate" request form. Published promise is a response **within 24 hours**, prepared by a person. | Manual |
| **Tracking** | Nothing. No tracking page, no reference lookup, no status of any kind. | Absent |
| **Customer login** | Nothing. No account, no portal, no authenticated area anywhere on the site. | Absent |
| **Booking** | Nothing. An accepted quote is re-keyed into whatever internal record exists. | Absent |
| **Self-service tools** | Currency converter, metric converter, Incoterms, airport codes, equipment specs, glossary. Reference content, not transactional. | Static |
| **Front door** | **Five separate branch mailboxes** published as the way in: `saleskwt@`, `opsqatar2@`, `csdxb@`, `csauh@`, `csjea@` — plus a general enquiries address and phone. | Observed |

> **The single most telling finding.** Al-Qabandi's own company profile lists **five different email addresses** as the operational front door — one per office. That is not a website problem. It means the inbox is the system of record, and there are five of them. A customer shipping Kuwait to Abu Dhabi is a conversation in two mailboxes, owned by two people, with no shared record between them.
>
> Everything else in this document follows from replacing those five mailboxes with one queue.

### 2.3 The operating environment

| Factor | Position as of August 2026 | Why it matters to this build |
|---|---|---|
| **Kuwait customs** | The General Administration of Customs has moved to a Single Window model requiring registered authorisation, and launched electronic pre-clearance for land shipments — declarations and documents submitted before cargo arrives. | Clearance is becoming a set of dated, referenced electronic states. A forwarder with their own licence needs those states inside the job record, not in a broker's head. |
| **Kuwait import documentation** | Commercial invoice (one original plus two copies), certificate of origin (one plus two), packing list stamped by exporter or forwarder, bill of lading in triplicate, chamber-of-commerce legalisation, import licences for a long list of goods. | A heavy, countable, rule-bound document set — exactly what a checklist-gated vault de-risks. |
| **UAE tax** | VAT at 5%. **Electronic invoicing mandatory for B2B and B2G from 1 July 2026.** | Their three UAE entities are inside a live mandate now. Invoices leaving Dubai, Abu Dhabi and DWC must carry a complete structured data set. A deadline, not a preference. |
| **Qatar tax** | No VAT law published. E-invoicing legislation approved May 2026; phased rollout expected from around 2027. | Build Doha's invoicing so the structured fields already exist when the mandate lands. |
| **Kuwait tax** | No VAT. Repeatedly deferred; no active legislative timeline. | Do not build Kuwaiti VAT machinery now — but do not build an invoice model that cannot accept it later. |
| **Channel behaviour** | In this market WhatsApp is a primary business channel, not a convenience. | WhatsApp is a first-class notification and intake channel in Release One, threaded to the job with the same audit trail as email. |
| **Language** | Arabic and English are both working languages; the current website is English-only. | Arabic with native right-to-left layout is in the MVP, not a later phase. |

---

## 3. Pain points

Thirteen findings. Manual forwarding does not fail loudly — it leaks.

| ID | Pain point | What it costs | Basis | Answered by |
|---|---|---|---|---|
| **PP-01** | **Every enquiry consumes a person.** Rates live in spreadsheets and in people's heads, so there is no way to price a lane without a human assembling it. Published promise is 24 hours. | Lost deals to forwarders answering in minutes; sales capacity capped by the number of people who can price. | Observed | `FR-RT` `FR-EQ` |
| **PP-02** | **Customers cannot see their own cargo.** No tracking of any kind. Every status update is a call, email or WhatsApp answered by a person who first has to go and find out. | Status chasing is typically the largest single consumer of operations time in a forwarding business — invisible work, billed to nobody. | Observed | `FR-JB` `FR-CP` |
| **PP-03** | **Five mailboxes, no queue.** Enquiries and instructions arrive at five branch addresses, a web form, a phone line and WhatsApp. Nothing gives them a single owner, a clock or a status. | Enquiries never answered leave no trace. Nobody can say how many arrived, how fast they were answered, or how many were won. | Observed | `FR-EQ` `FR-NT` |
| **PP-04** | **Agent rates are gathered by email.** Non-asset-based means the buy price is negotiated on most jobs. Sent by email, returned by email, compared by hand, then lost. | Slow response on uncovered lanes; no rate history to negotiate against; no record of which agent actually answers. | Inferred | `FR-AP` `FR-RT` |
| **PP-05** | **Documents live in mail threads.** Bills of lading, air waybills, certificates of origin, declarations, invoices and delivery notes are attachments in conversations, not records against a job. | Retrieval is archaeology. Claims and audits answered slowly or not at all. Kuwait's multi-original document rules make the exposure real. | Inferred | `FR-DC` |
| **PP-06** | **Clearance is invisible until it is a problem.** Customs is a core service line held under their own licence, but a held container is typically discovered rather than watched. | Days lost before anyone acts. Demurrage that starts before it is noticed. A customer who hears bad news late. | Observed | `FR-JB` |
| **PP-07** | **Free-time clocks are not counted.** Demurrage, detention and storage accrue per day against agreed free time. Without a counter they are remembered inconsistently and recovered partially. | Costs absorbed rather than recharged. This is money already earned and not collected. | Inferred | `FR-JB` `FR-FN` |
| **PP-08** | **Margin is reconstructed, not known.** Buy and sell come together at invoicing, weeks after the cargo moved. | Loss-making lanes run for months before anyone can see them. Pricing decisions made without knowing the last one's outcome. | Inferred | `FR-FN` `FR-RP` |
| **PP-09** | **Five entities, five invoicing worlds.** Kuwait, Qatar and the UAE each have their own currency, tax treatment, numbering and letterhead — and the UAE e-invoicing mandate is live from 1 July 2026. | Manual per-branch invoicing is slow and error-prone, and is now a compliance exposure in three of the five offices. | Observed | `FR-FN` |
| **PP-10** | **No single customer across the group.** The same customer shipping through Kuwait, Doha and Dubai is three relationships with three histories. | No group view of what a customer is worth. No shared terms, no shared credit position, no cross-sell. | Observed | `FR-MD` `FR-RP` |
| **PP-11** | **Reporting is an analyst, not a system.** The company profile offers "customized reporting" as a service — meaning somebody builds it each time it is asked for. | Management numbers arrive late and cost hours. Nobody can answer a question on the day it is asked. | Observed | `FR-RP` |
| **PP-12** | **Operating knowledge is undocumented.** Lane quirks, agent preferences, customer free-time agreements, routing habits and pricing judgement live with individual people. | A departure takes capability with it. Onboarding is slow. Service quality varies by who picks up the job. | Inferred | `FR-MD` `FR-RT` `FR-JB` |
| **PP-13** | **The digital surface is English-only** — in a market where Arabic is a working language for customers, ministries and drivers alike. | A narrower addressable customer base than the business actually serves, and documents remade by hand in Arabic. | Observed | `NFR` `FR-CP` |

> **What we are not claiming.** We have put no number on any of this. Quantifying the leak needs Al-Qabandi's shipment volumes, headcount by function, current win rate and margin — none of which we have. The business case in the proposal deck is modelled on industry-typical ratios and is labelled as such. In discovery we replace every input with real figures and re-run it. If the case does not hold on their numbers, it is better to know that before Release One than after it.

---

## 4. What Release One is

One record, six states, no exits. A job enters as an enquiry and leaves as a paid invoice without ever being re-keyed into something else.

### 4.1 The operating loop

| # | Stage | What happens |
|---|---|---|
| 01 | **Enquiry** | Arrives from portal, web form, email or a person. One queue, one owner, one clock. |
| 02 | **Quote** | Priced instantly where a card covers the lane; sent to agents where it does not. Both return to one comparison. |
| 03 | **Award** | Acceptance converts the quote to a job. Buy, sell and margin lock to the record. |
| 04 | **Execution** | Milestones, customs stage, containers, free-time clocks and exceptions — each with an owner and a date. |
| 05 | **Documents** | Every file typed, versioned and attached to the job. Released to the customer where permitted. |
| 06 | **Invoice** | Raised from the job's own cost ledger, in the right entity, currency and language. |

### 4.2 The four commitments Release One makes

1. **A covered lane is priced without a person.** Where a valid rate card exists, an enquiry produces a sendable quote in under ten seconds. Human judgement is spent only on lanes that need it.
2. **"Where is it" answers itself.** The customer reads the same milestones operations does, in their own language, with the documents Al-Qabandi chose to release. The call does not happen.
3. **Every cost-bearing event writes a line.** Demurrage, storage, detention, inspection, reattempt — the moment it is recorded as an event, it exists as a chargeable cost line. Nowhere to hide.
4. **Five offices, one record.** One customer, one agent network, one rate library, one set of numbers — scoped so each branch sees its own work and group management sees all of it.

### 4.3 Modules

| Prefix | Module | What it delivers | Reqs |
|---|---|---|---|
| `FR-ID` | **Identity & branches** | Five legal entities, users, roles, per-branch data scoping, invitations, audit hooks. | 10 |
| `FR-MD` | **Master data** | Customers, agents, hauliers, carriers, ports and airports, commodities, partner compliance register. | 11 |
| `FR-RT` | **Rate cards & pricing** | Buy and sell cards, per-mode rate bases, accessorial catalogue, margin rules, versioning by effective date. | 12 |
| `FR-EQ` | **Enquiry & quotation** | One queue across channels, instant and agent-sourced pricing in one comparison, branded quote PDF, award. | 15 |
| `FR-JB` | **Job file & execution** | Milestones by mode, customs stage, containers, free-time clocks, exceptions, tasks, ops board. | 17 |
| `FR-DC` | **Documents** | Typed, versioned vault per job with release control, mandatory-document gating, proof of delivery. | 10 |
| `FR-CP` | **Customer portal** | Branded bilingual portal plus no-login public tracking, quotes, documents, statements, messaging. | 13 |
| `FR-AP` | **Agent portal** | RFQ response, rate-card upload, awarded jobs, milestone and document posting, compliance self-service. | 9 |
| `FR-FN` | **Costing & invoicing** | Job cost ledger, live margin, per-entity invoicing in three jurisdictions, receivables, accounting export. | 14 |
| `FR-NT` | **Notifications** | Event-driven email, WhatsApp and in-app messaging with editable bilingual templates. | 7 |
| `FR-RP` | **Dashboards** | Operations, commercial and finance views per branch and consolidated, drillable and exportable. | 8 |
| `FR-AD` | **Audit & data** | Immutable audit trail, configurable reference data, full export, read API, outbound webhooks. | 7 |

---

## 5. Users and roles

Nine internal roles, two external. Every role is scoped to the branches it belongs to; nothing is visible by default.

| Role | What they do in the system | Scope |
|---|---|---|
| **Sales / Commercial** | Own enquiries, produce and send quotes, negotiate, record wins and losses, maintain customer relationships. | Own branch |
| **Operations** | Run the job: bookings, milestones, containers, exceptions, documents, customer updates. | Own branch |
| **Customs / Clearance** | Own the clearance stage: declaration references, duty assessment, inspection, release, and the documents each requires. | Own branch |
| **Pricing / Procurement** | Maintain buy and sell rate cards, approve agent-submitted cards, set margin floors, run the agent network. | Group |
| **Finance / Accounts** | Review job cost ledgers, raise invoices and credit notes, record payments, chase receivables, export to accounting. | Own branch + group read |
| **Branch Manager** | Everything in their branch, plus margin-floor approvals, compliance overrides and branch reporting. | Own branch |
| **Group Management** | Read across all five offices, consolidated reporting in a single reporting currency. | Group |
| **System Administrator** | Users, roles, reference data, notification templates, integrations, audit review. | Group |
| **Warehouse / Field** *(Should)* | Capture proof of delivery and cargo photos from a phone browser against an assigned job. | Assigned jobs |
| **Customer user** *(external)* | Request quotes, accept them, track shipments, download released documents, view invoices and statements, message operations. | Own company |
| **Agent / partner user** *(external)* | Answer RFQs, upload rate cards, view awarded jobs, post milestones and documents, maintain compliance papers. | Own organisation |

---

## 6. Functional requirements

126 requirements across 12 modules. Each carries the condition under which it is accepted — these become the written exit criteria at each phase gate.

### 6.1 `FR-ID` — Identity, branches and access control

Al-Qabandi is five legal entities in three jurisdictions. The system models that from day one rather than bolting multi-branch on later.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-ID-01 | The system models each office as a legal entity with its own registered name, address, tax registration, base currency, invoice numbering series and document letterhead. | Must | All five entities exist with distinct numbering and letterheads; an invoice from each renders correctly. |
| FR-ID-02 | A user belongs to one or more branches, with a role held per branch. | Must | A user with Kuwait Operations and Doha read-only sees exactly that, and nothing from Dubai. |
| FR-ID-03 | The role set in Section 5 is implemented as named roles with an editable permission matrix. | Must | An administrator can change a permission for a role without a code change, effective immediately. |
| FR-ID-04 | Data is scoped at the row level in the database, not only hidden in the interface. | Must | A direct API call for another branch's job by an unauthorised user returns not-found, not a filtered page. |
| FR-ID-05 | Email and password authentication with an enforced password policy, lockout after repeated failures, and self-service reset. | Must | Policy is enforced on set and change; reset email arrives and expires. |
| FR-ID-06 | Two-factor authentication available for internal users, mandatory for administrators and Finance. | Should | An administrator cannot complete sign-in without a second factor. |
| FR-ID-07 | Users are created by invitation; the invitee sets their own password. No shared credentials. | Must | Invitation link is single-use and time-limited. |
| FR-ID-08 | Sessions expire after a configurable idle period; an administrator can revoke a user's sessions immediately. | Must | Revocation invalidates the session on the next request. |
| FR-ID-09 | Users are deactivated, never deleted; their history and authorship remain intact and attributable. | Must | A deactivated user cannot sign in; their past actions still show their name in the audit trail. |
| FR-ID-10 | Interface language is a per-user preference (English or Arabic), independent of branch, switchable at any time. | Must | Switching language re-renders the full interface including layout direction, without losing the current page. |

### 6.2 `FR-MD` — Customers, agents and master data

The record that ends `PP-10` and `PP-12`: one customer across five offices, and the operating knowledge written down.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-MD-01 | A customer is one record shared by all branches, with trading terms, credit limit and pricing held per branch beneath it. | Must | The same customer appears once in search, with separate Kuwait and Dubai terms on the same record. |
| FR-MD-02 | Customer record captures legal and trade name in English and Arabic, commercial registration, tax registration, addresses, contacts with roles, default Incoterm, payment terms, credit limit, agreed free-time days and routing notes. | Must | Every listed field is present, and the Arabic name renders correctly in Arabic documents. |
| FR-MD-03 | Named customer contacts can be granted portal access individually, with per-contact permissions. | Must | Granting access sends an invitation; revoking it blocks sign-in at once. |
| FR-MD-04 | Agent and partner records capture country, lane and mode coverage, services offered, contacts, currency, payment terms, network memberships and notes. | Must | An agent's coverage is searchable and drives which agents an RFQ is offered to. |
| FR-MD-05 | Partner compliance register: trade licence, liability and goods-in-transit insurance, customs licence, dangerous-goods approvals — each with stored document, issue and expiry date, and warnings at 60, 30 and 7 days. | Must | An expiring document raises warnings on schedule to both Al-Qabandi and the partner. |
| FR-MD-06 | Haulier records with vehicle types, cross-border capability and permitted countries. | Must | A cross-border land job can only be allocated to a haulier permitted for that border. |
| FR-MD-07 | Carrier records for shipping lines and airlines, with the codes used on documents. | Must | Carrier appears on the job, quote and invoice consistently. |
| FR-MD-08 | Location master of ports, airports, inland depots and land borders using UN/LOCODE and IATA codes, with country and permitted modes. | Must | Origin and destination are chosen from the master, never free text, on every job. |
| FR-MD-09 | Commodity and HS-code master with a dangerous-goods flag carrying UN number, class and packing group. | Must | Selecting a DG commodity forces the DG fields to be completed. |
| FR-MD-10 | Duplicate detection on customer and agent creation, matching on name, registration number and email domain. | Should | Creating a near-duplicate warns and offers to open the existing record. |
| FR-MD-11 | Bulk import of customers, contacts, agents, hauliers and locations from Excel or CSV against a published template, with a validation report before commit. | Must | A file with errors imports nothing and returns a row-by-row report. |

### 6.3 `FR-RT` — Rate cards and the pricing engine

For a non-asset-based forwarder this is the commercial core. It is the difference between a 24-hour answer and a ten-second one.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-RT-01 | Buy rate cards per agent, carrier or haulier, per mode and lane, with effective-from and effective-to dates. | Must | Only cards valid on the enquiry's ready date are considered. |
| FR-RT-02 | Sell rate cards as a default published tariff plus per-customer contract cards that override it. | Must | A customer with a contract card is priced on it; everyone else on the default. |
| FR-RT-03 | Rate basis per mode: sea FCL per container type; sea LCL per weight-or-measure with a minimum; air per chargeable weight with standard break points and a minimum charge; land per truck type or per tonne; clearance per declaration and per line. | Must | Each basis produces a correct figure against a worked example supplied by Pricing in discovery. |
| FR-RT-04 | Chargeable weight calculated automatically from cargo dimensions, with the volumetric divisor configurable per card and per mode. | Must | Air, LCL and road divisors each produce the expected chargeable weight for a test consignment. |
| FR-RT-05 | Accessorial catalogue with calculation types — flat, per unit, per kilo, per container, per day, percentage. Ships with terminal handling, documentation, fuel and currency adjustment, security, clearance, delivery order, haulage, dangerous goods, out-of-gauge, reefer, inspection, legalisation, permit, insurance, demurrage, detention and storage. | Must | Every listed accessorial exists, calculates, and can be added to a card or directly to a job. |
| FR-RT-06 | Every rate line carries its own currency. A maintained exchange-rate table converts to job currency and branch base currency, and the rate used is stored on the record. | Must | A quote priced in USD and invoiced in KWD reconciles to the stored rate months later. |
| FR-RT-07 | Margin rules per lane, customer or service: percentage mark-up, fixed uplift, or minimum-margin floor. The system warns when quoted margin falls below the floor. | Must | Pricing below the floor is possible but always warns and always records who did it. |
| FR-RT-08 | Editing a card creates a new version with its own effective date. Existing quotes and jobs retain a snapshot of the version they were priced on. | Must | A rate change today does not alter a quote produced last month. |
| FR-RT-09 | Rate cards import from an agent's spreadsheet through a mapped template, with a validation report. | Must | A real agent tariff supplied in discovery imports without manual re-keying. |
| FR-RT-10 | Coverage lookup: given lane, mode, equipment and date, return every valid buy option ranked by landed cost with transit time. | Must | The lookup returns in under two seconds against the full rate library. |
| FR-RT-11 | Expiry dashboard listing cards lapsing within thirty days, by agent and by lane. | Must | Pricing can see, in one screen, which coverage is about to be lost. |
| FR-RT-12 | Every rate change is audited: who, when, previous value, new value. | Must | Rate history for any lane is retrievable for the past twelve months. |

### 6.4 `FR-EQ` — Enquiry, quotation and award

The module that replaces five mailboxes with one queue, and turns the accepted quote into a job without anyone typing it twice.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-EQ-01 | A single enquiry queue across every branch and channel, each enquiry carrying a branch, owner, status and SLA clock. | Must | No enquiry can exist without an owner; unassigned enquiries escalate after a configurable interval. |
| FR-EQ-02 | Intake channels: the public web form on qabandi.com, the customer portal, manual entry by sales, and a per-branch forwarding address that turns an inbound email into an enquiry with body and attachments preserved. | Must | An email to the Kuwait forwarding address appears in the queue within one minute with attachments intact. |
| FR-EQ-03 | Enquiry captures customer, contact, mode, service type, Incoterm, origin and destination, ready date, cargo lines with pieces, packaging, dimensions, gross weight and volume, commodity, DG detail, container type and count, special requirements, target rate and remarks. | Must | Every field is present and validated; mandatory fields differ correctly by mode. |
| FR-EQ-04 | Chargeable weight, total volume and total gross weight are calculated from the cargo lines automatically. | Must | Totals update live as lines are added or edited. |
| FR-EQ-05 | Where a valid sell card covers the lane, mode and date, the system produces a priced, sendable option with no human input. | Must | A covered enquiry produces a complete option in under ten seconds from submission. |
| FR-EQ-06 | Where no card covers it, the system raises an agent RFQ, dispatches it to agents matched on coverage through the portal and by email, sets a response deadline and sends automatic reminders. | Must | Agents receive the RFQ, the deadline is visible to both sides, and a reminder fires if unanswered. |
| FR-EQ-07 | Instant options and returned agent quotes appear in one comparison view showing buy, sell, margin, transit time, validity and remarks, with outstanding agents shown as pending. | Must | An enquiry with two instant and two agent options displays all four plus the outstanding ones on one screen. |
| FR-EQ-08 | Branded quotation PDF per branch entity, in English or Arabic, with charge breakdown, validity date, Incoterm, inclusions, exclusions and standard trading conditions. | Must | Kuwait and Dubai quotations render on their own letterheads; the Arabic version is laid out right-to-left, not mirrored. |
| FR-EQ-09 | Quotes are versioned. A revision creates a new version, retains the previous one, and the customer always sees the current one. | Must | Revision history is visible internally with who changed what. |
| FR-EQ-10 | Quotes are sent by email, by WhatsApp or both, with delivery status recorded against the enquiry. | Must | Send events and failures are visible on the enquiry timeline. |
| FR-EQ-11 | Customers accept a quote in the portal; alternatively operations records acceptance on the customer's behalf with written evidence attached. | Must | Portal acceptance records user, timestamp and address; manual acceptance requires an attachment. |
| FR-EQ-12 | Award converts the accepted quote into a job with no re-keying, locking buy price, sell price and margin to the job at the moment of award. | Must | Every field on the resulting job traces to the quote; locked margin does not move when rates later change. |
| FR-EQ-13 | Lost quotes are closed with a reason code — price, transit time, no capacity, no response, customer cancelled — and optionally the competing price. | Must | Loss reasons are reportable by lane, customer and month. |
| FR-EQ-14 | Response time is measured from enquiry received to first quote sent, reportable by branch, user, mode and customer. | Must | The measure appears on the commercial dashboard and drills to the individual enquiry. |
| FR-EQ-15 | Duplicate enquiry detection on the same customer, lane and ready date within a configurable window. | Should | A likely duplicate is flagged to the owner with a link to the original. |

### 6.5 `FR-JB` — Job file and execution

The job is the record everything else hangs from. This module also contains the two things that quietly cost the most money today: the customs stage and the free-time clocks.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-JB-01 | A job is the single record for one movement, carrying references, parties, route, cargo, charges, documents, milestones, messages and audit. | Must | Everything about a movement is reachable from one screen without leaving the system. |
| FR-JB-02 | Job references generated per branch and year, never reused. External references held alongside: customer PO, shipper reference, master and house bill of lading, master and house air waybill, booking number, container numbers, customs declaration number. | Must | Any of those references finds the job in a single search box. |
| FR-JB-03 | Milestone templates per movement type: sea export, sea import, air export, air import, land cross-border, clearance-only. Each milestone carries planned date, actual date, owner and customer-visible flag. | Must | Creating a job of each type produces the correct milestone set automatically. |
| FR-JB-04 | Milestones are updated by operations, by the agent through their portal, or by CSV upload. | Must | An agent-posted milestone appears to the customer with correct attribution. |
| FR-JB-05 | Estimated arrival held as planned, revised and actual, with a reason recorded on every change; the customer sees the current figure and the change history. | Must | A revised arrival triggers a customer notification carrying the reason. |
| FR-JB-06 | Customs clearance is a first-class stage with declaration type, declaration number, filing date, assessed duty and tax, inspection flag, release date, assigned officer and its own SLA clock. | Must | A held consignment is visible on the operations board on the day it is held, not when someone asks. |
| FR-JB-07 | Equipment register per job: container or unit number, type, seal number, gross and tare weight, gate-out and gate-in timestamps. | Must | Container numbers validate to the standard check-digit rule. |
| FR-JB-08 | Demurrage, detention and storage clocks per job, each with agreed free days from the customer or carrier record, a running day counter, and an automatic cost line the moment free time is exceeded. | Must | Exceeding free time writes a chargeable line without anyone remembering to. |
| FR-JB-09 | Exception register per job: reason code, severity, owner, opened and closed timestamps, SLA clock, narrative, cost impact, customer-visible flag. | Must | Exceptions are listed across all jobs, oldest first, on the operations board. |
| FR-JB-10 | Exception reason codes are configurable and ship with: customs hold, documents missing or incorrect, inspection, rollover, offload, port congestion, vessel or flight delay, permit pending, payment hold, damage, shortage, consignee unavailable, address error, DG non-compliance. | Must | An administrator can add a code without a developer. |
| FR-JB-11 | A job cannot be closed with an open exception or a missing mandatory document. | Must | The close action is blocked with a clear explanation of what is outstanding. |
| FR-JB-12 | A dangerous-goods job cannot progress past booking without class, UN number, packing group and the declaration attached. | Must | Progression is blocked until the paperwork the class requires is on file. |
| FR-JB-13 | Tasks per job with assignee and due date; overdue tasks surface on the operations board and the assignee's dashboard. | Must | An overdue task is visible without opening the job. |
| FR-JB-14 | Operations board listing all live jobs for the user's branches, filterable by mode, status, exception state and arrival window, with saved views per user. | Must | A user's saved view persists across sessions and devices. |
| FR-JB-15 | Consolidation: several house jobs grouped under one master for LCL and air consolidations, with charges apportioned to the houses. | Must | Master and house records reconcile; apportioned costs sum to the master cost. |
| FR-JB-16 | A job can be copied to create a repeat movement, carrying parties, route, cargo profile and charge structure. | Should | A repeat shipment is created in under a minute. |
| FR-JB-17 | Internal notes and customer-visible updates are separate and visually distinct; an internal note can never reach a customer. | Must | The customer portal renders only entries explicitly marked customer-visible. |

### 6.6 `FR-DC` — Documents

Kuwait's import documentation is countable and rule-bound. That makes it exactly the sort of thing a checklist should enforce rather than a person should remember.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-DC-01 | A document vault per job, every file assigned a type: bill of lading (master and house), air waybill (master and house), commercial invoice, packing list, certificate of origin, customs declaration, delivery order, DG declaration and safety data sheet, insurance certificate, arrival notice, booking confirmation, import licence or permit, legalisation certificate, proof of delivery, photographs, other. | Must | Every listed type exists and is selectable; untyped uploads are not permitted. |
| FR-DC-02 | Re-uploading a type creates a new version; earlier versions are retained and viewable with upload date and author. | Must | Version two of a bill of lading does not destroy version one. |
| FR-DC-03 | Release control: each document type has a default customer-visible setting, overridable per document and per customer. | Must | A document marked internal never appears in the customer portal under any route. |
| FR-DC-04 | Mandatory-document checklist per mode and trade direction, configured to Kuwait, Qatar and UAE requirements; job progress is gated on it. | Must | A Kuwait import job cannot reach clearance without invoice, packing list, certificate of origin and bill of lading on file. |
| FR-DC-05 | Upload from operations, the agent portal or the customer portal — drag and drop, multiple files, up to 25 MB each, common office and image formats plus PDF. | Must | A ten-file drop attaches all ten with correct types in one action. |
| FR-DC-06 | Search across document type, filename, job reference and the external references on the job. | Must | A bill of lading number finds its document in one search. |
| FR-DC-07 | Download a job pack: every released document for a job as a single archive, for claims and audits. | Must | The archive contains exactly the released set and nothing internal. |
| FR-DC-08 | Delivery orders and job cover sheets generated from job data as branded PDFs per entity. | Must | A generated delivery order carries the correct branch letterhead and job data with no manual typing. |
| FR-DC-09 | Proof of delivery captured from a phone browser: recipient name, signature, photograph and timestamp, bound to the job. | Must | A delivery captured on a phone appears on the job and in the customer portal within a minute. |
| FR-DC-10 | Documents retained for the agreed statutory period. Deletion requires an administrator right, a recorded reason, and is audited. | Must | No role below administrator can delete a document. |

### 6.7 `FR-CP` — Customer portal and public tracking

The most visible part of the build, and the one that removes the largest single load from operations. It carries Al-Qabandi's brand, not ours.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-CP-01 | The portal is served from an Al-Qabandi domain with Al-Qabandi's logo, colours and document headers. No supplier branding visible to customers anywhere. | Must | A customer sees nothing that identifies a third-party product. |
| FR-CP-02 | Full English and Arabic interface, Arabic laid out natively right-to-left — navigation, tables, forms, charts, date pickers — with numerals, currency and dates following local convention. | Must | Arabic is reviewed by a native speaker against a checklist and is not a mirrored English layout. |
| FR-CP-03 | Dashboard showing active shipments, arrivals this week, exceptions the customer may see, open quotes and outstanding invoices. | Must | Every tile links through to the underlying list. |
| FR-CP-04 | Shipment list and detail: milestones with dates, current arrival estimate, route, cargo, containers, released documents and visible exceptions. | Must | The customer sees the same milestone data operations sees, minus what is marked internal. |
| FR-CP-05 | Public tracking page: a shipment can be looked up without a login using its reference plus a second identifier, showing a restricted milestone view. | Must | A consignee with only the reference and container number sees status, and nothing commercial. |
| FR-CP-06 | Quote request from inside the portal, pre-filled with the customer's saved addresses, contacts, Incoterm and cargo profiles. | Must | A repeat enquiry takes under a minute to submit. |
| FR-CP-07 | Quote comparison and acceptance in the portal, with acceptance recorded against user, timestamp and address. | Must | Acceptance immediately creates the job and notifies the branch. |
| FR-CP-08 | Download of released documents, individually or as a job pack. | Must | Only released documents are reachable, verified by direct-link test. |
| FR-CP-09 | Invoices and a statement of account with ageing, downloadable as PDF. | Must | The statement reconciles to the finance module for the same period. |
| FR-CP-10 | A message thread per shipment, visible to operations in their own inbox, with attachments. | Must | A portal message appears in the operations inbox threaded to the job. |
| FR-CP-11 | Notification preferences per user: channel and which events. | Must | Opting out of milestone emails stops them without stopping invoice notices. |
| FR-CP-12 | A customer user belonging to several legal entities switches entity inside one login. | Should | Switching changes the visible data set without a re-login. |
| FR-CP-13 | Bulk booking by CSV upload against a published template, for customers who ship in volume. | Should | A validated file creates all jobs, or none, with a row-level report. |

### 6.8 `FR-AP` — Agent and partner portal

Al-Qabandi buys capacity on nearly every job. This module turns that buying from an email thread into a market.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-AP-01 | Agents sign in to see the RFQs addressed to them, with cargo detail, route, dates and a response deadline. | Must | An agent sees only RFQs sent to their organisation. |
| FR-AP-02 | Agents submit a quote with charge lines, currency, transit time, validity and remarks, and may revise it until the deadline. | Must | A submitted quote appears in Al-Qabandi's comparison view immediately. |
| FR-AP-03 | Agents upload and maintain their rate cards against the mapped template; cards enter the coverage lookup only after approval by Al-Qabandi Pricing. | Must | An unapproved card never prices a customer quote. |
| FR-AP-04 | Agents see the jobs awarded to them with the operational detail they need and nothing commercial beyond their own price. | Must | An agent cannot see the sell price or the customer's other quotes. |
| FR-AP-05 | Agents post milestone updates and upload documents against their awarded jobs. | Must | Agent-posted updates flow through to the customer portal with correct attribution. |
| FR-AP-06 | Agents maintain their own compliance documents; expiry warnings are sent to them and to Al-Qabandi. | Must | An agent can replace an expiring insurance certificate without emailing anyone. |
| FR-AP-07 | An agent with a lapsed mandatory document cannot be awarded new work. A Branch Manager may override, and the override is recorded with a reason. | Must | Award is blocked, the block is explained, and the override is auditable. |
| FR-AP-08 | A performance view showing quote response rate, average response time, on-time milestone rate and jobs awarded — visible to both sides. | Must | Figures match the underlying records for a chosen period. Weighted scoring is deferred to Release Two. |
| FR-AP-09 | Agent users are scoped to their own organisation's data at the database level. | Must | A direct request for another agent's RFQ returns not-found. |

### 6.9 `FR-FN` — Job costing, invoicing and receivables

Where the leak is closed and the UAE mandate is met. Margin is known at award, not at month-end.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-FN-01 | A charge ledger per job holding cost lines and revenue lines, each with charge type, counterparty, currency, exchange rate and status — estimated, confirmed or invoiced. | Must | Every figure on the job P&L traces to a ledger line. |
| FR-FN-02 | Estimated charges are written to the ledger at award from the accepted quote, then replaced by actuals as the job runs. | Must | Estimate and actual are both retained and comparable. |
| FR-FN-03 | Every cost-bearing event writes a cost line at the moment it is recorded — demurrage, detention, storage, inspection, reattempted delivery, DG handling, out-of-gauge handling. | Must | Recording the event is sufficient; no separate step is needed to make it chargeable. |
| FR-FN-04 | Live job profit and loss — revenue, cost, gross margin, margin percentage — visible on the job at all times, with estimate-to-actual variance. | Must | Margin is correct on the day of award and updates as actuals land. |
| FR-FN-05 | Jobs whose margin falls below the configured floor require Branch Manager approval before an invoice can be raised. | Must | The approval is recorded with approver, time and reason. |
| FR-FN-06 | Sales invoices generated per entity, using that entity's numbering series, letterhead, currency and jurisdiction's tax treatment, in English or Arabic. | Must | A Kuwait invoice and a Dubai invoice for the same customer are each correct for their jurisdiction. |
| FR-FN-07 | Invoices from the UAE entities carry the full field set required for VAT and are produced in a structured format aligned to the UAE electronic invoicing mandate effective 1 July 2026. Accredited transmission is Release Two; **data completeness is Release One.** | Must | A UAE invoice validates against the required field set, reviewed by Al-Qabandi's tax adviser at the phase gate. |
| FR-FN-08 | Credit notes with a reason code, linked to the original invoice and reflected in the receivables position. | Must | A credit note reduces the customer balance and appears on the statement. |
| FR-FN-09 | Agent and supplier cost invoices captured and matched against the job's cost lines, with variances flagged for review. | Must | An agent invoicing more than they quoted raises a variance before it is paid. |
| FR-FN-10 | Receivables ageing by customer, branch and currency, in 30, 60 and 90-day buckets. | Must | Ageing reconciles to the invoice ledger for any chosen date. |
| FR-FN-11 | Payments recorded and allocated against invoices, with the resulting balance shown in the customer portal. | Must | A part-payment allocates correctly and the portal balance matches. |
| FR-FN-12 | Accounting export of invoices, credit notes and payments in a format the existing accounting package accepts, with a date range and a re-export guard. | Must | A month's export imports into the accounting package without manual correction. Direct integration is Release Two. |
| FR-FN-13 | An invoice cannot be raised against a job with no recorded departure or delivery event, or with an open blocking exception. | Must | The action is blocked with a clear explanation. |
| FR-FN-14 | Job currency, invoice currency and branch base currency are all held, with the exchange rate used stored on the record and never recalculated retrospectively. | Must | An invoice raised today against a March job reconciles to March's stored rate. |

### 6.10 `FR-NT` — Notifications and messaging

WhatsApp is a primary channel in this market, so it is in the MVP — as an outbound channel and an inbound thread, with automatic drafting deferred.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-NT-01 | Notifications fire on: quote sent, quote expiring, job created, milestone reached, arrival estimate changed, exception opened, document released, invoice raised, invoice overdue. | Must | Each listed event produces a notification to the correct recipients. |
| FR-NT-02 | Channels: email, WhatsApp Business template messages, and in-app. | Must | A milestone notification is delivered on all three channels for a test recipient. |
| FR-NT-03 | Templates per event, per language and per branch, editable by an administrator without a developer. | Must | An administrator changes Arabic wording and the next notification uses it. |
| FR-NT-04 | Recipient rules by role and by customer preference; opt-outs honoured on every channel. | Must | An opted-out recipient receives nothing on that channel. |
| FR-NT-05 | Inbound WhatsApp and email replies thread onto the job and appear in the operations inbox. Automatic replies are not sent in Release One. | Must | A WhatsApp reply about a job appears against that job within a minute. |
| FR-NT-06 | Delivery status recorded per message — sent, delivered, read, failed — with retry on transient failure. | Must | A failed send is visible and retried, not silently lost. |
| FR-NT-07 | Quiet hours and rate limits per recipient, so a busy job does not flood a customer. | Should | Events during quiet hours are batched into one digest. |

### 6.11 `FR-RP` — Dashboards and reporting

The answer to "customized reporting" being a person. Every number has one agreed formula and drills to the jobs behind it.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-RP-01 | Operations dashboard per branch: enquiries by SLA state, jobs by status, exceptions by age, arrivals in the next seven days, documents outstanding. | Must | Every tile drills to its underlying list. |
| FR-RP-02 | Commercial dashboard: quotes sent, win rate, average response time, revenue and margin by month, lane, customer and mode. | Must | Figures reconcile to the enquiry and job records for the same period. |
| FR-RP-03 | Finance dashboard: invoiced value, completed jobs not yet invoiced, receivables ageing, margin by branch. | Must | Uninvoiced completed jobs are listed, not just counted. |
| FR-RP-04 | Group view consolidating all five offices, normalised to a single reporting currency at a stated rate. | Must | Group totals equal the sum of branches at the stated rate. |
| FR-RP-05 | Every figure on every dashboard is drillable to the job list behind it. | Must | No number on any dashboard is a dead end. |
| FR-RP-06 | Any list in the system exports to Excel or CSV with the filters applied. | Must | An exported file matches the on-screen list row for row. |
| FR-RP-07 | Scheduled reports by email: a daily operations summary and a weekly commercial summary, per branch. | Should | Reports arrive on schedule with correct branch scoping. |
| FR-RP-08 | A KPI dictionary agreed in discovery defines every metric's formula, and is published inside the product. | Must | Each dashboard metric links to its definition. |

### 6.12 `FR-AD` — Audit, administration and data

The requirements that make the platform Al-Qabandi's rather than ours.

| ID | Requirement | Pri | Accepted when |
|---|---|---|---|
| FR-AD-01 | An immutable audit log of every state change: who, what, when, from where, previous value and new value. | Must | No role, including administrator, can edit or delete an audit entry. |
| FR-AD-02 | Audit is searchable by job, user, entity and date range, and exportable. | Must | A disputed change is traced end to end in under a minute. |
| FR-AD-03 | Reference data — charge types, milestone templates, exception codes, document types, notification templates, mandatory-document rules — is configurable in the interface without a code change. | Must | Each listed set is editable by an administrator and takes effect immediately. |
| FR-AD-04 | A full export of Al-Qabandi's data in an open format, on demand. | Must | The export is complete, documented and re-importable. |
| FR-AD-05 | A documented read-only REST API for shipments, milestones and documents, with per-customer API keys, for customer ERP integration. Write access is Release Two. | Must | A customer developer integrates against the published documentation without our help. |
| FR-AD-06 | Outbound webhooks on milestone, exception and document-release events, with retry and a delivery log. | Should | A failing endpoint is retried and the failures are visible. |
| FR-AD-07 | Separate staging and production environments; production changes released from version control only. | Must | Every production release is traceable to a specific commit. |

---

## 7. Data model

| Entity | Holds | Key relationships |
|---|---|---|
| **Entity / branch** | The five legal companies, with tax registration, currency, numbering and letterhead. | Owns users, jobs, invoices |
| **User** | Internal, customer or agent person, with per-branch roles and language preference. | Belongs to entity or organisation |
| **Customer** | One group-level record with per-branch trading terms, credit and free-time agreements. | Has contacts, enquiries, jobs, invoices |
| **Partner** | Agents, hauliers and carriers, with coverage, contacts and compliance documents. | Has rate cards, RFQ responses, awarded jobs |
| **Rate card** | Buy or sell, per mode and lane, versioned by effective date, with charge lines and accessorials. | Belongs to partner or customer |
| **Enquiry** | The request: parties, route, cargo lines, dates, requirements, owner, SLA clock. | Produces quotes |
| **Quote** | A priced option, instant or agent-sourced, versioned, carrying a **snapshot of the rate card version used**. | Belongs to enquiry; becomes a job |
| **Job** | The movement: references, parties, route, cargo, equipment, status, branch. | The centre of everything |
| **Milestone** | A dated step with planned, revised and actual dates, owner and visibility flag. | Belongs to job |
| **Customs stage** | Declaration type and number, filing date, duty, inspection, release, SLA clock. | Belongs to job |
| **Equipment** | Container or unit with type, seal, weights, gate-out and gate-in. | Belongs to job; drives free-time clocks |
| **Exception** | Reason code, severity, owner, clocks, narrative, cost impact, visibility. | Belongs to job; may write a charge |
| **Document** | Typed, versioned file with release state and author. | Belongs to job |
| **Charge line** | Cost or revenue, type, counterparty, currency, stored exchange rate, status. | Belongs to job; rolls into invoice |
| **Invoice** | Issued document per entity with numbering, tax treatment, currency and language. | Draws charge lines; has payments |
| **Message** | Email, WhatsApp or portal message, threaded and attributed. | Belongs to job or enquiry |
| **Audit entry** | Who, what, when, where, before and after. | Attaches to every entity above |

**Two rules hold the model together:**

1. **Prices are snapshots, not references.** A quote stores the rate card version it was priced on. Changing a rate tomorrow never rewrites what was quoted yesterday, so an invoice raised today against a March booking still reconciles.
2. **Nothing is deleted.** Records are superseded, closed or deactivated. Every state change leaves an audit entry. Claims and disputes are answered from the record rather than from memory.

---

## 8. External interfaces

| Interface | Direction | Purpose and notes | Release |
|---|---|---|---|
| **Email — outbound** | Out | Quotes, notifications, statements and reports, sent from Al-Qabandi's own domain with correct sender authentication. | R1 |
| **Email — inbound** | In | A per-branch mailbox, polled over IMAP or fed by a provider webhook, turns an email into an enquiry or threads a reply onto its job, attachments preserved. A model reads the body into a proposal the coordinator accepts; a known partner's bill is read into its lines. | R1 — built |
| **WhatsApp Business** | Both | Template notifications outbound; inbound messages threaded to the job. Requires a Business API number and template approval — an Al-Qabandi account, billed direct. **Not built:** the inbound webhook verifies and queues, nothing consumes the queue, and there is no outbound sender. Excluded by decision until the number exists (`Dev_Environment.md` §4). | Deferred |
| **Document storage** | Both | Encrypted object storage for the vault, with signed time-limited download links. | R1 |
| **PDF generation** | Out | Quotations, invoices, house bills of lading, house air waybills, delivery orders, packing lists, customs packs and consolidation manifests, per entity, in both languages including right-to-left. Chromium renders them, because Arabic shaping is the hard part. | R1 — built |
| **Exchange rates** | In | A daily rate feed with manual override, stored per transaction. | R1 — built |
| **Accounting export** | Out | File-based export of invoices, credit notes and payments, with a re-export guard. Direct integration awaits confirmation of which package is in use. | R1 — built |
| **Customer ERP** | Out | Read-only REST API under `/api/v1` with per-customer keys, plus outbound webhooks with retry and a delivery log. | R1 — built |
| **Carrier and vessel tracking** | In | Automatic milestone and arrival updates, carrier-direct on the DCSA standard — Maersk, Hapag-Lloyd and CMA CGM — polled hourly. No aggregator and no per-container fee, so the commercial decision this row deferred never had to be made. Live the day Al-Qabandi's carrier API credentials are entered under Settings → Integrations. | R1 — awaiting credentials |
| **Kuwait Customs Single Window** | Both | Direct filing and status retrieval. Stays manual, and now by decision rather than timing: Kuwait clearance runs through MicroClear, which is not an API a forwarder can buy (`Gulf_Market_Analysis.md` MK-03). R1 captures declaration references and states, estimates duty from a tariff table, and prints a customs pack for the broker. | Manual |
| **UAE e-invoicing transmission** | Out | Accredited service-provider transmission. The port and the hand-off exist (`adapters/einvoice.ts`); the PINT AE document and the provider appointment do not. R1 produces complete invoice data; transmission is added once the provider is appointed. | R2 |

---

## 9. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-01 | **Bilingual** | Every customer-facing and internal screen exists in English and Arabic. Arabic is laid out natively right-to-left — navigation, tables, charts, forms, date pickers — not a mirrored English layout. |
| NFR-02 | **Currency precision** | The Kuwaiti dinar is held and displayed to **three decimal places**; the UAE dirham, Qatari riyal and US dollar to two. Rounding rules applied per currency, never globally. |
| NFR-03 | **Working calendar** | SLA clocks and ageing use a per-branch working calendar. Kuwait, Qatar and the UAE do not share a weekend or a public-holiday list, and a clock that ignores this reports fiction. |
| NFR-04 | **Dates and numerals** | Gregorian dates throughout, with Hijri shown alongside where Arabic is selected. Numerals, decimal separators and date order follow the locale. |
| NFR-05 | **Performance** | Any list or job screen renders in under two seconds at expected data volumes. An instant quote returns in under ten seconds. Coverage lookup returns in under two. |
| NFR-06 | **Availability** | 99.5% monthly availability excluding announced maintenance, scheduled outside the Sunday-to-Thursday working week across all three countries. |
| NFR-07 | **Capacity** | Sized for at least five years of current volume, confirmed against real figures in discovery, with headroom to grow without re-architecture. |
| NFR-08 | **Security in transit and at rest** | TLS everywhere; AES-256 at rest; secrets in a managed store; no credentials in code or configuration files. |
| NFR-09 | **Access control** | Defence in depth — row-level security enforced in the database as well as permission checks in the application. Neither is trusted alone. |
| NFR-10 | **Audit retention** | Audit entries and access logs retained for twelve months minimum, searchable and exportable throughout. |
| NFR-11 | **Backup and recovery** | Daily backups retained fourteen days; weekly off-site retained thirty. Restore drills performed quarterly with written evidence. |
| NFR-12 | **Data residency** | Hosting region chosen with Al-Qabandi in discovery, taking account of any government or ministry contract obligations. Defaults to a Gulf region. |
| NFR-13 | **Devices and browsers** | Fully responsive on phone, tablet and desktop; current versions of Chrome, Safari, Edge and Firefox. Proof of delivery works in a mobile browser with no app install. |
| NFR-14 | **Connectivity** | Field capture tolerates poor signal: an interrupted proof-of-delivery submission is not lost. |
| NFR-15 | **Accessibility** | Keyboard navigable throughout, visible focus states, sufficient contrast in both light and dark presentation. |
| NFR-16 | **Branding** | Al-Qabandi's logo, colours, domain and document headers everywhere a customer or partner can see. No supplier branding in the product. |
| NFR-17 | **Ownership** | Source code, database, infrastructure configuration, documentation and design files are Al-Qabandi's on final payment — their repository, their cloud account, no lock-in. |
| NFR-18 | **Operability** | Structured logging, error tracking, uptime monitoring and alerting handed over in working order, with a written runbook. |

---

## 10. Delivery plan

Five gated increments over sixteen weeks, then four weeks of hypercare. Something usable is demonstrated in week three.

| Increment | Weeks | Contents | Demonstrated at the gate |
|---|---|---|---|
| **R1.0 — Foundation** | 1–3 | `FR-ID` (all), `FR-MD` (all). Five entities, roles, permissions, customers, agents, hauliers, carriers, locations, commodities, compliance register, bulk import. | Real Al-Qabandi customers and agents imported and searchable; a Doha user proven unable to see Dubai data. |
| **R1.1 — Quote to award** | 4–7 | `FR-RT` (all), `FR-EQ` (all). Rate cards, pricing engine, accessorials, enquiry queue, instant and agent pricing, quotation PDF, award. | A real Al-Qabandi lane quoted instantly from a real imported rate card, sent as a branded PDF, and awarded to a job. |
| **R1.2 — Execution** | 8–10 | `FR-JB` (all), `FR-DC` (all). Milestones by mode, customs stage, equipment, free-time clocks, exceptions, tasks, operations board, document vault, proof of delivery. | A job run end to end including a customs hold, a demurrage clock that writes its own charge, and a delivery proved from a phone. |
| **R1.3 — Portals** | 11–13 | `FR-CP` (all), `FR-AP` (all), `FR-NT` (all). Customer portal, public tracking, agent portal, notifications, and the full Arabic and right-to-left build across every screen. | A customer tracks a live shipment in Arabic; an agent answers an RFQ and posts a milestone the customer sees. |
| **R1.4 — Money and numbers** | 14–16 | `FR-FN` (all), `FR-RP` (all), `FR-AD` (all). Cost ledger, live margin, invoicing across three jurisdictions, receivables, dashboards, exports, read API, audit. | A completed job invoiced from Kuwait and from Dubai with correct tax treatment; group margin shown for the period and drilled to the jobs behind it. |
| **Hypercare** | 17–20 | Defect response against severity SLAs, user training per role, knowledge transfer, operational handover. | Al-Qabandi's own team running the platform unaided, with the runbook in their hands. |

### 10.1 How each gate works

- **A live demonstration** against the written exit criteria — which are the acceptance conditions in Section 6, nothing added, nothing removed.
- **A handover pack**: release notes, the criteria checklist marked off, known issues, and test evidence.
- **Five working days to accept** in writing. Written acceptance triggers the invoice; no response by the sixth day is deemed acceptance.
- **Two revision cycles per increment** included in the fee. Change requests beyond the specification are costed in writing before any work starts.

### 10.2 One deliberate change from the proposal deck

The deck placed Arabic and right-to-left in Phase 6, after the portals. We have moved it into R1.3, alongside the portals themselves. Retrofitting right-to-left onto a finished English interface is slower and produces a worse result than building both together — and in this market an English-only customer portal is not a viable first release.

---

## 11. Out of scope for Release One — and what happened since

Listed rather than quietly omitted. Each has a reason and a target release. The first three columns are as written in v1.0; the fourth was added on 23 August 2026 and records what the build did with each deferral. Several shipped inside Release One after all — not because the reasons were wrong, but because once the job spine existed the deferred thing was cheaper to build than to keep working around.

| Excluded | Why it waited | Target | Status, 23 Aug 2026 |
|---|---|---|---|
| **AI intake and automatic replies** | Parsing an emailed booking into structured fields, and drafting grounded status replies, needs a body of real Al-Qabandi messages to train and evaluate against. Release One creates that body. Building it first would be guessing. | R2 | **Intake shipped.** An emailed enquiry is read into a proposal (`extraction_proposals`) that the coordinator accepts or rejects on the enquiry page; a known partner's emailed bill is read into its lines and matched to the job's cost lines; an assistant answers questions over the operator's own data under that user's row-level security. Every model call is recorded in `ai_invocations` with its response. Automatic replies and model-drafted quotes remain deferred, and the evaluation harness that `Qabandi_AI_Surface.md` puts before any further surface is not built. |
| **Carrier and vessel tracking feeds** | Automatic milestones depend on a paid third-party provider whose selection and per-container cost are Al-Qabandi's commercial decision. R1 takes milestones from operations and agents. | R2 | **Built, blocked on credentials.** Carrier-direct on the DCSA standard for Maersk, Hapag-Lloyd and CMA CGM, polled hourly into the job's milestones, so there is no provider to select and no per-container fee. It runs the day Al-Qabandi's carrier API credentials are entered under Settings → Integrations. |
| **Air waybill and bill of lading generation** | Print-ready IATA and carrier-specific stock templates are a body of work in themselves, and depend on which carrier programmes Al-Qabandi wants covered first. | R2 | **Shipped 18 August 2026.** House bill of lading and house air waybill, with delivery order, packing list, customs pack and consolidation manifest — bilingual PDFs from the job's parties and cargo lines, a per-branch house-bill numbering series, a DRAFT watermark until a number is allocated, preview without storing and issue with versioning. Carrier-specific *master* stock stays out: a master is the carrier's document. The items a bank examines under UCP 600 article 20 followed on 23 August (migration `0036`): an on-board notation from the loaded milestone or the departure, separate original and non-negotiable copy sheets, the branch's terms printed on the reverse, place of receipt and delivery, and a telex-release stamp once the originals are surrendered. |
| **Direct customs single-window filing** | Requires technical access and credentials from the General Administration of Customs. R1 tracks declaration references, dates and states; it does not file them. | R2 | **Stays manual, now by decision.** Kuwait clearance runs through MicroClear, which is not an API a forwarder can buy (`Gulf_Market_Analysis.md` MK-03). R1 additionally estimates duty from a per-country tariff table, keeps the estimate beside the assessed figure, and prints a customs pack for the broker. |
| **Accredited e-invoicing transmission** | UAE transmission runs through an accredited service provider that Al-Qabandi appoints. R1 makes the invoice data complete and compliant so that connection is a plug, not a rebuild. | R2 | **Port built, transmission not.** The `EInvoiceTransmit` port and the hand-off to a provider exist; the PINT AE document and the appointment do not. The UAE timetable is unchanged: provider appointment due 30 October 2026, go-live 1 January 2027 for the largest filers. |
| **Direct accounting integration** | Depends entirely on which package is in use — unknown to us today. R1 exports a file that imports cleanly. | R2 | **File export shipped**, with a journal that posts invoices, credit notes and payments and a guard against exporting a period twice (`accounting_exports`). Direct integration still waits on the package name. |
| **Weighted agent scoring** | A score combining price, punctuality, responsiveness and claims needs a period of real data before its weights mean anything. R1 measures the inputs. | R2 | **Unchanged.** The agent portal answers rate requests and nothing else yet, so the inputs beyond response time are not being measured either — see `FR-AP-03…08` in §11.2. |
| **Automated credit control** | Dunning ladders and automatic credit holds need Al-Qabandi's actual credit policy, which we have not seen. R1 shows the ageing and stops there. | R2 | **Partly.** Each customer has a credit standing with recorded overrides, and invoice-overdue and quote-expiring reminders go out from the notification outbox on a daily schedule. Dunning ladders and automatic holds still wait on the policy. |
| **Warehouse management** | Inventory, locations, stock movements, pick and pack for the two owned 3PL centres is a product in its own right, not a module. It deserves its own specification. | R3 | Unchanged. |
| **Supply-chain and purchase-order management** | Vendor management, PO milestone tracking and origin consolidation programmes sit on top of a working job platform, not beside it. | R3 | Unchanged. Consolidation itself (`FR-JB-15`) shipped, with a candidates engine — §11.1. |
| **Native mobile applications** | R1's mobile browser experience covers field capture. Native apps with offline queues are justified only once field volume proves it. | R3 | Unchanged. Proof of delivery from a phone browser shipped as specified (`FR-DC-09`): signature, photographs, recipient and location. |

### 11.1 Built beyond this specification

Things the build produced that none of the 126 requirements asked for. Each is here because the work it replaces was the expensive kind — somebody's afternoon, every week — and because a later reader should not have to discover them from the code.

| Capability | What it does | Where |
|---|---|---|
| **Payables and partner settlement** | Supplier invoices captured from an upload or an emailed bill, read into lines, matched to the job's cost lines with the variance shown; supplier payments; and partner settlements that net what is owed each way with an agent. `FR-FN-09` asked for capture and matching; settlement and netting were not asked for. | `/payables`, `/settlements`, `core/matching.ts`, `core/netting.ts` |
| **Consolidation candidates** | Beside master–house grouping and cost apportionment (`FR-JB-15`), a rule-based panel proposing which open houses share a lane and a sailing window. No model; the rules are in `core/grouping.ts`. | `/consolidations` |
| **Duty estimation** | A duty estimate from a per-country tariff table, stored beside the assessed figure rather than overwritten by it, so the estimate's accuracy can be asked about later. | `core/duty.ts`, the customs stage |
| **Unbilled-revenue register** | Completed work with no invoice against it, as a list with a one-click draft invoice. `FR-RP-03` asked for a count. | `/finance` |
| **Assistant** | Question-answering over jobs, enquiries, exceptions, free-time clocks, overdue invoices and supplier variance, with threads kept per user and every tool call executed under that user's own row-level security. | `/assistant` |
| **Inbound mailboxes as rows** | Per-branch IMAP mailboxes an administrator configures in the interface, passwords sealed with AES-256-GCM under a key the database never sees; a bounce guard so a bounce cannot become an enquiry. | `/settings/mailboxes` |
| **Support access grants** | Time-boxed, recorded access for the supplier's support staff, visible to the customer as a banner while it is open. | `/settings/support` |
| **Cutover importers** | Customers, partners, locations, rate cards and open jobs from spreadsheets with a row-level validation report and downloadable templates. `FR-MD-11` and `FR-RT-09` asked for the first two. | `/imports` |
| **Fixture mode** | The whole interface runs on fixtures with no database (`QABANDI_PILOT_FIXTURES=1`), so a demonstration never depends on a connection. | `apps/web/src/lib/pilot` |

### 11.2 Requirements still open

Of the 126 functional requirements, these are not met, or only partly met, by the build as of 23 August 2026. Listed so each gap is a decision rather than a discovery. The list was compiled by checking each module against the code; a requirement absent from it is believed met, and a reader who finds otherwise should add it here rather than argue with the code.

| ID | In short | State |
|---|---|---|
| `FR-EQ-10` `FR-NT-02` `FR-NT-05` | WhatsApp — sending, the channel, inbound threading | Not built; excluded by decision until a Business API number exists. Email is built; in-app is a channel value with no adapter behind it yet, so a notification to a user with no email goes nowhere. |
| `FR-ID-03` | Editable permission matrix | Permissions are rows (`role_permissions`) read on every request, so a change needs no release — but there is no screen for it; an administrator edits the rows. |
| `FR-ID-05` | Lockout after repeated failures | **Met since 25 Aug 2026.** Five failures lock the account for fifteen minutes and the lock lifts by itself, so it cannot be used to deny service to a named person. Policy in `core/lockout.ts`, counters in `lib/lockout.ts`, enforced inside Better Auth by `lib/auth-guard.ts` so the raw `/api/auth` route cannot skip it. |
| `FR-MD-03` | Per-contact portal access | Portal and agent users are created by an administrator against a customer or partner. Granting access contact by contact, with per-contact permissions, is not built. |
| `FR-MD-05` | Compliance expiry warnings at 60, 30 and 7 days | The register, the documents and days-remaining on the partner record are built. The warnings are not sent. |
| `FR-EQ-11` | Quote acceptance with evidence | Operations records acceptance; the portal cannot, and manual acceptance does not require an attachment. |
| `FR-JB-04` | Milestones by agent portal or CSV | Operations and the carrier feed update milestones. Agents cannot, and there is no CSV upload. |
| `FR-JB-05` | Reason on every arrival change | A revised arrival notifies the customer; the reason is not captured. |
| `FR-JB-11` | Close blocked by open exceptions or missing documents | The state machine allows the transition; nothing checks exceptions or documents first. |
| `FR-NT-07` | Quiet hours and digests | Quiet hours are enforced by the dispatcher, which defers rather than drops. Batching into a digest is not built. |
| `FR-JB-07` | Container check digit | Container numbers are free text; the ISO 6346 check digit is not validated. |
| `FR-JB-12` | Dangerous-goods gating | A dangerous-goods flag exists on the enquiry and the commodity. UN number, class, packing group and the gate past booking are not built. |
| `FR-JB-13` | Tasks per job | Not built. |
| `FR-JB-14` | Saved views on the operations board | The board filters by status; saved views per user are not built. |
| `FR-JB-16` | Copy a job | Not built. |
| `FR-DC-03` | Release control overridable per customer | Per-type default and per-document release are built; a per-customer override is not. |
| `FR-DC-04` | Mandatory-document checklist and gate | Document types are rows; the per-mode checklist and the gate on progress are not built. |
| `FR-DC-06` | Document search | The search box finds jobs, containers and customers, and the Documents screen lists by job. A document is not found by its own filename or type. |
| `FR-DC-07` | Job pack as one archive | Not built. Documents download individually; the customs pack is one generated PDF, not the released set. |
| `FR-MD-06` | Haulier permitted countries | Not built. |
| `FR-MD-10` `FR-EQ-15` | Duplicate detection | Not built. |
| `FR-CP-03` `FR-CP-06…13` | Customer portal beyond shipments | The portal shows active shipments, arrivals and released documents, and public tracking works as specified. Quote request and acceptance, invoices and statements, messaging, notification preferences, entity switching and bulk booking are not in it. |
| `FR-AP-03…08` | Agent portal beyond rate requests | Agents see and answer the rate requests addressed to them. Rate-card upload with approval, the awarded-jobs view, milestone and document posting, compliance self-service, the lapsed-document award block and the performance view are not built. Compliance documents with expiry warnings are maintained by Al-Qabandi on the partner record. |
| `FR-FN-13` | Invoice gate on departure and open exceptions | Not built. The credit check gates billing instead. |
| `FR-RP-04` | Group view in one reporting currency | Branch figures are shown in their own currencies; normalisation to a single reporting currency at a stated rate is not built. |
| `FR-RP-06` | Every list exports to CSV | The margin report exports; other lists do not. |
| `FR-RP-07` | Scheduled reports | Registered as a job name with no handler and no schedule. |
| `FR-RP-08` | KPI dictionary | Not built. |
| `FR-AD-02` | Audit search and export | **Mostly met since 25 Aug 2026.** The screen searches by record id, person and address, narrowed by table, operation and period; `/api/audit.csv` exports the same query under the same row-level security, with an inclusive closing day and a truncation row when the ten-thousand-row cap binds. **Still short of the requirement in one way:** "by job" means the job's *id*, because that is what the trigger records in `row_id` — pasting a job reference such as a house-bill number finds nothing. Resolving a reference to its id before searching is the remaining piece. |
| `FR-AD-04` | Full data export as one action | Not built as one action. The accounting export and the import templates exist, and the database is Al-Qabandi's (`NFR-17`). |
| `NFR-04` | Hijri dates beside Gregorian | Not built. |

---

## 12. Open questions for discovery

Everything below changes the specification if the answer surprises us. This is the agenda for the half-day operations session.

### Volume and shape

- Monthly shipment volume, split by mode and by office — the single most important input to both sizing and the business case.
- Headcount by function: sales, operations, clearance, pricing, finance, warehouse. Where does the time actually go?
- How many enquiries arrive per month, and roughly what proportion are won? Nobody currently measures this — an estimate is enough to start.
- Which lanes carry the volume, and which of them could be covered by a stored rate card today?

### Systems as they are

- Is there any existing forwarding or transport system, or is the job file genuinely email plus spreadsheets plus an accounting package?
- Which accounting package, and who administers it? This determines whether `FR-FN-12` is a file or an integration.
- The company profile advertises "on-line connectivity to customs and clearance" — what is that in practice today? A portal login, a broker's system, or a phrase?
- How are rate cards held now — how many, in what format, refreshed how often, and by whom?
- How many active agents are in the network, and how many would realistically log in to a portal?

### Commercial and regulatory

- Who advises Al-Qabandi on UAE tax, and what is the current state of readiness for the 1 July 2026 e-invoicing mandate across the three UAE entities?
- Do any government or ministry contracts impose obligations on where data may be hosted, or who may access it?
- Are free-time agreements with customers and carriers written down anywhere, or negotiated per job?
- What are the standard trading conditions that must appear on every quotation and invoice, and do they differ by entity?

### Language, brand and access

- Is Arabic required for the internal operations interface, or only for customer-facing screens and documents? This meaningfully changes the translation effort.
- Which domain will the portal and tracking page use, and who controls the DNS?
- Is there an existing WhatsApp Business number, and is it on the Business API or the consumer app? Migration takes time and must start early.
- Who is the single named decision-maker with authority at each phase gate?

---

## 13. Traceability

Every pain point maps to requirements. Nothing in Release One exists without a reason traceable to a finding.

| Pain | In short | Requirements that answer it |
|---|---|---|
| PP-01 | Every enquiry costs a person | `FR-RT-01…12` `FR-EQ-05` `FR-EQ-06` `FR-EQ-07` `FR-EQ-14` |
| PP-02 | No customer visibility | `FR-JB-03…05` `FR-CP-03…05` `FR-NT-01` `FR-NT-02` |
| PP-03 | Five mailboxes, no queue | `FR-EQ-01` `FR-EQ-02` `FR-EQ-13` `FR-EQ-14` `FR-NT-05` |
| PP-04 | Agent rates by email | `FR-AP-01…03` `FR-AP-08` `FR-RT-09` `FR-RT-10` |
| PP-05 | Documents in mail threads | `FR-DC-01…07` `FR-DC-10` |
| PP-06 | Clearance invisible | `FR-JB-06` `FR-JB-09` `FR-JB-10` `FR-DC-04` `FR-RP-01` |
| PP-07 | Free time not counted | `FR-JB-07` `FR-JB-08` `FR-FN-03` `FR-RT-05` |
| PP-08 | Margin reconstructed late | `FR-EQ-12` `FR-FN-01…05` `FR-RP-02` `FR-RP-03` |
| PP-09 | Five invoicing worlds | `FR-ID-01` `FR-FN-06` `FR-FN-07` `FR-FN-14` `NFR-02` |
| PP-10 | No group customer view | `FR-MD-01` `FR-MD-02` `FR-RP-04` `FR-CP-12` |
| PP-11 | Reporting is a person | `FR-RP-01…08` |
| PP-12 | Knowledge undocumented | `FR-MD-02` `FR-MD-04` `FR-RT-02` `FR-RT-07` `FR-JB-10` `FR-AD-03` |
| PP-13 | English-only surface | `NFR-01` `NFR-04` `FR-CP-02` `FR-EQ-08` `FR-FN-06` `FR-NT-03` |

---

## 14. Acceptance and next steps

### 14.1 The three conversations

| Step | Duration | What happens |
|---|---|---|
| **1. Product walkthrough** | 60 minutes | We demonstrate the existing freight platform end to end. Al-Qabandi tells us what maps to their operation and what does not. Requirements are struck out or added on the spot. |
| **2. Operations discovery** | Half a day | We sit with operations, clearance, pricing and finance, answer Section 12, and re-run the business case on real volumes, headcount and margins. |
| **3. Costed scope and start date** | One week later | This document, revised to v2.0 with every open question closed, becomes the annex to a fixed-fee engagement letter with phase pricing, exit criteria and a delivery date. |

### 14.2 What we ask of Al-Qabandi

- **One named decision-maker** with authority to accept at each of the five gates.
- **Access to the people who do the work today** — operations, clearance and pricing staff, not only management. The specification is only as good as what they tell us.
- **Real material for the first increments**: a live rate card, a completed job file, a set of real customers and agents, and a month of quotations. Building against real data from week one is the difference between a demonstration and a system.

### 14.3 What Al-Qabandi gets

- **A working platform in sixteen weeks**, demonstrated every three, with something usable from week three.
- **Written exit criteria** — the acceptance conditions in Section 6 — so "done" is never a matter of opinion.
- **Full ownership on final payment**: code, database, infrastructure, documentation and design files, in Al-Qabandi's own repository and cloud account.

### 14.4 The honest summary

Al-Qabandi has thirty-four years of freight capability and almost no digital surface. Nothing in this document tries to change how the business works — every requirement describes something the team already does, moved out of five mailboxes and a spreadsheet and into one record that the customer, the agent and the accountant can all read.

That is the whole proposition: *thirty-four years of freight, finally visible online.*

---

## Appendix A — Sources

| Source | Used for |
|---|---|
| `qabandi.com` — services, resources, quotation form, contact pages | Digital surface today, service lines, 24-hour quote promise |
| `qabandi.com/.../Profile_Qabandi.pdf` — company profile | Founding dates, five offices, 100+ headcount, non-asset-based model, warehouse sizes, 3PL centres, Ministry of Defence work, the five branch mailboxes |
| LinkedIn company page | Headcount band (201–500) |
| Times Kuwait — Kuwait Customs electronic pre-clearance | Kuwait customs digitisation, single-window authorisation |
| trade.gov — Kuwait import requirements and documentation | Required import document set, licensing, legalisation |
| KPMG tax newsflash — UAE mandatory e-invoicing July 2026 | UAE e-invoicing mandate date and scope |
| GCC tax commentary (2026) | Qatar e-invoicing law status, Kuwait VAT deferral |

---

*Document ends. SRS v1.0 · Release One · techpotions · August 2026 · Internal.*
