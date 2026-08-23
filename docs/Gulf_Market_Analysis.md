# Gulf Market Analysis — Productising Beyond Al-Qabandi

**Competitive and regulatory research for a second customer · v1.2 · Internal**

| | |
|---|---|
| **Prepared by** | techpotions |
| **Date** | 17 August 2026 |
| **Question asked** | Can the Qabandi platform be sold to other shipping and forwarding companies in Kuwait and the Gulf? |
| **Relationship to the SRS** | Tests `Qabandi_Release_One_SRS.md` §11 (out of scope) against what the market actually pays for. When this was written, every R2 deferral in the SRS reappeared here as a competitor's headline feature; several have shipped since, and §5 records which. |
| **Status** | Research complete. Recommendations not yet approved. Sources at §10. |
| **Revisions** | v1.1 (18 Aug 2026) adds Shipmnts to §2 — a direct competitor the first pass missed. External-service research has moved to `Integration_Landscape.md`; deployment findings to `Operations_Findings.md`. v1.2 (23 Aug 2026) refreshes our-side status only — §5, `MK-05`, Wedge 2, §8 and Q4 — against the working tree: document generation, carrier-tracking adapters, AI intake, payables and settlements, and the Playwright suite have shipped since v1.1. The research and the finding IDs are unchanged. |

> **The finding in one line:** the incumbent has just raised prices 20–50% and the region has three dated compliance mandates in the next six months — but none of them are in Kuwait.

---

## 1. Why now, and why this is the wrong time to be careful

WiseTech moved CargoWise onto its "Value Pack" pricing model in December 2025. Forwarders report cost increases of **20% to over 50%**, and the increase landed on top of complaints that already existed:

| Complaint | Figure |
|---|---|
| Implementation cost | $50,000 – $100,000+ |
| Implementation timeline | 6 – 12 months |
| Training | months of staff time |
| Support | ticket-based; *"if you call CargoWise, they tell you to watch a video"* |

The reassessment is concentrated among small and mid-sized operators — the segment where costs are rising faster than margins can absorb, and precisely the segment a five-branch Kuwaiti forwarder sits in.

`MK-01` **The window is timing, not technology.** Nothing we could build creates a reason to switch as strong as a 50% price rise on software a forwarder already resents. Windows like this close when the incumbent corrects pricing or when a well-funded regional player fills the gap. Both are plausible within eighteen months.

---

## 2. Who is already in this market

Three products matter. Two of them are more dangerous than CargoWise.

### Logistaas — the direct competitor

MENA-native, office in Amman, serving forwarders in 80+ countries. This is the closest thing to what we would be selling, and it already has what our SRS deferred:

- e-invoicing integration across 30+ countries, **including Saudi Fatoorah (ZATCA) and Jordan JoFatura**
- direct customs connections to **Dubai Customs and Oman Customs**
- stated readiness for the **UAE MPCI** requirement (§4)
- multi-entity, multi-currency across GCC and Levant
- FCL/LCL ocean and air (HAWB/MAWB), sales/CRM, quotations, operations, customs, accounting, customer portal

Their headline selling point — one platform where a shipment invoiced out of a Saudi entity and another out of a Jordanian entity run side by side — is a capability **we already have** and have built more rigorously (§5).

### CARGOES Runner (DP World) — the structural threat

DP World markets CARGOES Runner explicitly as *"an ERP solution for small and medium-sized freight forwarders to overcome technology barriers."* That is our exact stated segment, from a vendor that owns the ports, the terminal operating system, the customs relationships and the Digital Freight Alliance distribution channel.

`MK-02` **We cannot out-distribute DP World and should not try.** A forwarder choosing CARGOES Runner is choosing their landlord's software. The counter-position is independence and data ownership, not features.

### Shipmnts — the one this analysis missed

**Added 18 August 2026.** India-first freight ERP (Logistixian Technologies),
**6,000+ users across 180 companies**, fixed per-user pricing — and a dedicated
UAE/Gulf landing page naming *"Jebel Ali, DXB, and beyond"*, free-zone
operations and multi-currency, *"trusted by forwarders across the Middle East"*.

Module coverage is **wider than ours**: sales and pricing, forwarding, customs,
warehouse, transport, finance, insights. Warehouse and transport are both
`SRS §11` R3 deferrals for us and are shipping for them.

`MK-06` **They are a more direct competitor than CargoWise, and they compete on
the wedge we chose.** Their claims of a 2–3 week deployment and fixed per-user
pricing are precisely the implementation-cost argument §1 recommends we use
against the incumbent. An Indian cost base can price under us and still make
margin, and the India–Gulf corridor — which a Kuwaiti forwarder runs heavily —
is where their deep India compliance compounds with Gulf presence.

`MK-07` **Their Gulf page is thin exactly where we are strong.** It makes
regional claims and evidences almost none of them:

| | Shipmnts UAE page | Us |
|---|---|---|
| Arabic / RTL | not mentioned anywhere | from the first commit, logical properties throughout |
| VAT / e-invoicing | not mentioned | port declared, ASP hand-off built, PINT AE document pending |
| Multi-entity, per-branch invoice series | not addressed | `FR-ID-01`, five entities |
| Kuwait | absent — Jebel Ali and DXB only | home market |
| Data sovereignty | shared multi-tenant, presumed | deployment-per-customer by architecture |

Worth verifying rather than assuming: **whether they handle three-decimal
currencies correctly.** An INR-first product built around two decimal places
may well not, and KWD, BHD and OMR at three is a correctness fault rather than
a preference — a demonstrable difference if it holds.

The strategic reading: against CargoWise we compete on price and speed, where
Shipmnts also competes and can win. Against Shipmnts we compete on being
*actually* Arabic, *actually* multi-entity, *actually* Kuwaiti and ready for the
UAE mandate. That is a narrower claim and a far harder one to copy — and it
raises the priority of Wedge 2, because a well-funded competitor selling into
the UAE without an e-invoicing story is a window, and windows close.

### The second tier

**SynTrack** (Synergia, UAE/KSA/Oman) and **Bridge Logistics Catalyst** (KSA/UAE) are smaller regional vendors competing on localisation and price. **Aramex Connect**, an AI-powered digital freight platform, launched in the UAE and Saudi Arabia in November 2024 — carrier-owned, same structural dynamic as DP World.

Globally: GoFreight, Magaya, Freightoscope, Logitude, Scope by Riege, Softlink, Shipthis. These appear in every "CargoWise alternative" list but carry no GCC compliance story, which is exactly the opening.

---

## 3. The compliance landscape, by country

This is what regional buyers are actually buying. Dates are the reason a purchase order gets signed.

| Country | Mandate | Authority / platform | Status as of Aug 2026 |
|---|---|---|---|
| **UAE** | Maritime Pre-Load Cargo Information (MPCI) | NAIC | Launched 31 Jul 2025. **Grace period ends 30 Sep 2026.** Carriers already enforcing. |
| **UAE** | B2B e-invoicing, Peppol / PINT AE | MoF + FTA | Voluntary pilot live 1 Jul 2026. **ASP appointment due 30 Oct 2026.** Go-live 1 Jan 2027 (>AED 50m), Jul 2027 (SME), Oct 2027 (B2G). |
| **Saudi** | Fatoorah e-invoicing Phase 2 (integration) | ZATCA | Live and enforced in waves since 2023. |
| **Saudi** | FASAH national single window | Tabadul, under ZATCA | Live. Physical document submission cut from 12 to 2 (invoice + B/L); the rest flows agency-to-agency. |
| **Oman** | Customs integration | Oman Customs | Live; Logistaas already connected. |
| **Kuwait** | VAT | — | **None. No law passed; ruled out before 2028.** Excise proposals unlegislated. |
| **Kuwait** | Customs | KGAC via **MicroClear** | 90%+ of declarations electronic — but see `MK-03`. |

### The UAE e-invoicing trap

Becoming an Accredited Service Provider requires active Peppol certification **plus a new Experience Requirement: the solution must have been in operation for a minimum of two years.**

`MK-04` **We cannot become an ASP and must not plan to.** Generate PINT AE structured XML, hand off to an accredited provider. This is exactly what `SRS FR-FN-07` already specifies and what the `EInvoiceTransmit` port in `apps/service/src/ports/index.ts` was shaped for. The architecture called this correctly a year early.

---

## 4. Kuwait is the proving ground, not the market

This is the finding that should change the plan.

**No compliance urgency.** Kuwait has not implemented VAT, no VAT law has passed the National Assembly, and the government's own four-year plan rules it out before 2028. The excise alternative — 10% and 25% on tobacco, sugary drinks and luxury goods — remains under discussion and unlegislated. The single strongest reason a forwarder replaces working software does not exist in Kuwait.

**Customs integration is a commercial negotiation, not an API request.** In 2005 KGAC awarded a **25-year Build-Operate-Transfer contract** to Global Clearinghouse Systems — *a joint venture in which Agility is the majority shareholder* — to run Kuwait customs on the MicroClear platform. That concession runs to 2030.

`MK-03` **`SRS §11` mis-scopes this deferral.** It reads *"Direct customs single-window filing — requires technical access and credentials from the General Administration of Customs."* In fact access is controlled by a concessionaire majority-owned by one of the largest logistics groups in the region, who has no commercial reason to enable a competitor's software vendor. The doc should also stop calling it "Kuwait Single Window"; the system is **MicroClear**, operated under KGAC. Correcting this changes the R2 estimate from *months* to *unknown, possibly never*.

**Therefore:** Al-Qabandi remains the reference customer, the design partner and the proving ground — that relationship is the asset. But the compliance urgency, the deadlines and the buyers are in **Dubai and Riyadh**.

---

## 5. Gap analysis against what we have built

Verified against the working tree, not the documentation. Re-verified 23 August 2026.

### Already built — and competitors charge for it

| Capability | Where | Note |
|---|---|---|
| Multi-entity, multi-currency, multi-branch | `packages/db/migrations/0004_rls.sql` onward | Enforced by RLS policies on all 80 tables, not app code. Logistaas's headline feature; ours is structurally stronger. |
| Arabic + RTL, first-class | `apps/web/messages/{en,ar}.json` | 2,700 keys each, in sync, checked by `pnpm lint`. Competitors are English products with Arabic bolted on. |
| Whitelabel | `packages/brand` | Operator is a parameter — palette, logo, letterhead, PDF. Built for resale. |
| Customer portal / public tracking | `/(portal)`, `/(public)/track` | Plus an agent portal at `/(agent)` and a read-only customer API at `/api/v1` on per-customer keys. |
| Audit and immutability | `0003_audit.sql` | Database-enforced, insert-only. |
| All five transport modes | `modeEnum` | `sea_fcl`, `sea_lcl`, `air`, `land`, `courier` |
| Shipment reference capture | `packages/db/src/schema/jobs.ts` | `master_bill_number`, `house_bill_number`, `booking_number`, vessel, voyage, flight, containers, seals |
| Customs declaration tracking | `customs_stages` | Type, number, status, duty estimate from `duty_rates`, SLA clock |
| Tax data model | `packages/db/src/schema/finance.ts` | `tax_treatment`, `tax_rate_percent`, `tax_amount`, per-line `is_taxable` |
| House B/L, house AWB, delivery order, packing list, customs pack, consolidation manifest | `apps/service/src/pdf/` | SRS R2, shipped since v1.1. Rendered through Chromium with Arabic shaping; an issued document is versioned, stored, and numbered from the branch's house-bill series. |
| AI intake and an operator assistant | `apps/service/src/workers/enquiry-extract.ts`, `invoice-extract.ts`, `ai/assistant.ts` | SRS R2, shipped since v1.1. An emailed enquiry or a supplier's PDF becomes a proposal a person accepts or rejects; every model call is recorded in `ai_invocations`. The evaluation harness is not built. |
| Payables, partner settlements, consolidation, credit standing | `packages/core/src/{matching,netting,grouping,credit}.ts` | Shipped since v1.1. Supplier bills matched to charge lines, master costs split across houses, net settlement per partner. This is the "finance" module Shipmnts lists (§2). |

### Not built — and every regional competitor sells it

| Gap | Blocking which market | Difficulty |
|---|---|---|
| UAE MPCI filing | UAE, now | **Low** — narrow spec, published |
| ZATCA Fatoora Phase 2 integration | Saudi | Medium |
| PINT AE XML + ASP handoff | UAE, Jan 2027 | Medium for the document. The hand-off half exists: a generic accredited-provider adapter in `apps/service/src/adapters/einvoice.ts`, with nothing yet to send through it. |
| Dubai / Oman customs connectors | UAE, Oman | Medium, relationship-gated |
| FASAH integration | Saudi | Medium, relationship-gated |
| Container tracking feed | all | Code complete — DCSA carrier-direct adapters for Maersk, Hapag-Lloyd and CMA CGM (`adapters/dcsa-tracking.ts`, hourly poll). Blocked on carrier API credentials, which the client registers for, so the commercial decision is theirs rather than ours. |
| Direct accounting integration | all | Low per package, unbounded across packages. The file export ships (`accounting/export.ts`, journal CSV with a re-export guard); a package connector does not. |
| **End-to-end test coverage** | all | Largely closed since v1.1: Playwright sweeps every screen in both languages (`apps/web/e2e`), on fixtures and against a database, and CI runs both stages; 104 test files across the workspace. What remains is deployment history, which only a live customer produces — the Coolify path itself is documented in `Deployment_Coolify.md`. |

`MK-05` **The last row is the one that stops a sale, not a feature gap.** A second customer's IT reviewer will ask about test coverage and deployment history before they ask about MPCI. *(v1.2: the coverage half is answered; the deployment-history half only a live customer and time can answer.)*

---

## 6. The two wedges

### Wedge 1 — UAE MPCI · deadline 30 September 2026

Six weeks out. Freight forwarders and NVOCCs must register with NAIC to obtain an **MPCI Party ID** and submit cargo data **at least 24 hours before loading** at the last foreign port, including identifiers for every party in the transport chain and for the master co-loader or shipping line. Carriers are **already** requiring filing confirmation before accepting bookings, ahead of the official deadline.

Why this is the right first move:

- **Narrow.** One filing, one schema, one deadline. NAIC publishes a business specification document.
- **Urgent.** A forwarder who cannot file cannot load. Nothing sells like that.
- **Partner-shaped.** Forwarders must file through certified service providers, so we integrate rather than build a customs pipe.
- **Door-opening.** It is a reason to be in the room with a Dubai forwarder who is not currently shopping for a TMS.

### Wedge 2 — UAE e-invoicing · ASP appointment 30 October 2026, go-live 1 January 2027

Follows naturally from wedge 1 and from `FR-FN-07`, which already requires UAE invoices to carry the full mandated field set. Ship PINT AE XML generation behind the existing `EInvoiceTransmit` port; the ASP adapter is already there (`apps/service/src/adapters/einvoice.ts` — a URL, a bearer token, the invoice id as the idempotency key) and is waiting for a document to send.

---

## 7. What not to build

| Do not build | Why |
|---|---|
| Our own ASP / Peppol access point | Two-year operating-history requirement makes it impossible (`MK-04`) |
| Kuwait MicroClear integration | Concessionaire-gated, Agility-majority-owned, no route in (`MK-03`) |
| Feature parity with CargoWise | Losing game. Breadth is their moat and our liability. |
| A generic global TMS | Seven established products already do this better and cheaper |

---

## 8. Recommended sequence

1. **Resolve the IP question.** Confirm the Al-Qabandi engagement permits resale of the platform. Everything below is void if it does not. *(Blocking.)*
2. **Price a certified MPCI service provider** per filing. This number decides whether wedge 1 is a business or a give-away feature. *(Blocking on wedge 1.)*
3. **Close the credibility gap** — real Playwright coverage, a security review, and Al-Qabandi live in production. Without a running deployment there is no second sale. *(v1.2: the Playwright suite and the Coolify deployment path have shipped; nothing in the tree records a security review or a go-live.)*
4. **Build MPCI filing.** Smallest scope, nearest deadline, opens Dubai.
5. **ZATCA Fatoora** — opens Saudi, the highest-CAGR market in the region through 2033.
6. **PINT AE + ASP adapter** — retains UAE customers through the January 2027 mandate.
7. **Then** container tracking and accounting connectors, guided by what the first two non-Al-Qabandi customers actually ask for. *(v1.2: the tracking adapters are written and wait on carrier credentials; accounting is a file export, and the connector question stands.)*

Sell deployment-per-customer, whitelabelled, to mid-size UAE and Saudi forwarders — the ones too small for a $100k CargoWise implementation and too Arabic for its interface.

---

## 9. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| Q1 | Does the Al-Qabandi contract permit resale of the platform? | techpotions / legal | Everything |
| Q2 | Per-filing cost from a certified MPCI provider? | commercial | Wedge 1 pricing |
| Q3 | Which accredited ASPs will white-label or resell? | commercial | Wedge 2 |
| Q4 | Does deployment-per-customer or true multi-tenancy fit the sales motion? | architecture | Schema — `branch` is still the top scoping unit, with no tenant above it. The tooling has since committed to a database per customer: `pnpm tenant:new`, `fleet:migrate` and `fleet:backup` over a `fleet.json` of tenants (`packages/db/src/fleet.ts`). Reversing that is now a schema decision, not a blank page. |
| Q5 | Would Al-Qabandi act as a named reference for UAE prospects? | account | Sales credibility |
| Q6 | Does Shipmnts render three-decimal currencies (KWD/BHD/OMR) correctly? | product | Whether `MK-07` is a demonstrable difference or only a claim |

---

## 10. Sources

Accessed 17 August 2026.

**Competitors**
- [Shipmnts](https://shipmnts.com/) · [Shipmnts UAE & Gulf](https://shipmnts.com/uae/)

**Market and incumbent pricing**
- [Forwarders trapped in CargoWise 'monopoly' as new pricing hikes costs — The Loadstar](https://theloadstar.com/forwarders-trapped-in-cargowise-monopoly-as-new-pricing-hikes-costs/)
- [Forwarders are rethinking CargoWise: what are their options? — The Loadstar](https://theloadstar.com/forwarders-are-rethinking-cargowise-what-are-their-options/)
- [CargoWise Pricing 2026: Understanding the New Value Pack Model — GoFreight](https://gofreight.com/blog/cargowise-pricing-2025)
- [GCC logistics and freight forwarding outlook for 2026 — Logistics Middle East](https://www.logisticsmiddleeast.com/logistics/gcc-logistics-and-freight-forwarding-outlook-for-2026)

**Competitors**
- [Best Freight Forwarding Software for the Middle East (2026) — Logistaas](https://logistaas.com/best-freight-forwarding-software-for-the-middle-east-2026/)
- [DP World launches CARGOES Logistics](https://www.dpworld.com/en/news/dp-world-launches-cargoes-logistics)
- [DP World takes digital battle to carriers and forwarders — Splash247](https://splash247.com/dp-world-takes-digital-battle-to-carriers-and-forwarders-with-launch-of-cargoes-logistics/)
- [Freight Forwarding Software UAE — SynTrack / Synergia](https://synergiasoft.com/freight-forwarding-software/)

**UAE MPCI**
- [UAE MPCI Business Specification Document V1.0 — NAIC](https://naic.icp.gov.ae/portal/assets/mpci-guidelines/UAE%20MPCI%20Business%20Specification%20Document%20V1.0.pdf)
- [UAE MPCI Grace Period Extended to September 30, 2026 — Trade Tech](https://site.tradetech.net/uae-mpci-grace-period-extended-september-2026/)
- [UAE MPCI Filing FAQ — Cargofiling](https://cargofiling.com/uae-mpci-filing-your-complete-faq-guide/)
- [UAE Maritime Pre-load Cargo Information (MPCI) Update — ONE](https://us.one-line.com/news/uae-maritime-pre-load-cargo-information-mpci-update)

**E-invoicing**
- [UAE e-invoicing mandate 2026: Readiness, ASP, and PINT AE — Avalara](https://www.avalara.com/blog/en/europe/2026/03/uae-e-invoicing-mandate-2026-readiness-asp-pint-ae.html)
- [UAE Extends E-Invoicing ASP Deadline to Oct 2026 — NR Doshi & Partners](https://www.nrdoshi.ae/uae-e-invoicing-asp-deadline-extended-october-2026)
- [ZATCA e-invoicing roll-out phases](https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx)

**Customs**
- [FASAH: Saudi customs data exchange, ports & trade — Motaded](https://motaded.com.sa/platforms/fasah)
- [Kuwait General Administration of Customs Project — ICS](https://icsinspections.com/projects/kuwait-general-administration-of-customs-project/)
- [Kuwait General Administration of Customs](https://cs.kgac.gov.kw/)

**Kuwait tax**
- [Kuwait's 2026 VAT Rollout: Essential Business Preparation Guide — Beaumont Capital Markets](https://beaumont-capitalmarkets.co.uk/kuwait-vat-implementation-2026-business-preparation-guide/)
- [VAT in Qatar & Kuwait 2026 — Status, Timeline — FinanceINME](https://financeinme.com/vat-qatar-kuwait-guide-2026.php)
