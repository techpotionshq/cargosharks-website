# Freight Forwarding for Developers

**A domain primer for the Qabandi build · v2.0 · Internal**

Everything in `Qabandi_Release_One_SRS.md` assumes this vocabulary and this flow. Read this once and the SRS stops being jargon.

Written for people who will model this in Postgres, not for people who will book a container.

**The centre of this document is [Section 9](#9-the-complete-flow--one-shipment-end-to-end)** — one real shipment traced from the customer's first email to the money landing in the bank, 45 days later, with every actor, document, system record and charge line called out at each step. If you read nothing else, read that.

---

## Contents

**Foundations**
1. [What a freight forwarder actually is](#1-what-a-freight-forwarder-actually-is)
2. [The parties](#2-the-parties)
3. [Modes, and how each one is measured](#3-modes-and-how-each-one-is-measured)
4. [Chargeable weight — the maths](#4-chargeable-weight--the-maths)
5. [Containers](#5-containers)
6. [Master vs house, and consolidation](#6-master-vs-house-and-consolidation)
7. [The document set](#7-the-document-set)
8. [Incoterms](#8-incoterms)

**The flow**

9. [**The complete flow — one shipment, end to end**](#9-the-complete-flow--one-shipment-end-to-end)
10. [Flow variants — air, land, export](#10-flow-variants--air-land-export)
11. [Who touches the job](#11-who-touches-the-job)
12. [State machines](#12-state-machines)

**Mechanics**

13. [Customs](#13-customs)
14. [The money](#14-the-money)
15. [Demurrage vs detention vs storage](#15-demurrage-vs-detention-vs-storage)
16. [How rates are actually structured](#16-how-rates-are-actually-structured)
17. [Codes and identifiers](#17-codes-and-identifiers)
18. [Gotchas that will bite you](#18-gotchas-that-will-bite-you)
19. [Quick glossary](#19-quick-glossary)

---

## 1. What a freight forwarder actually is

A freight forwarder does not own ships, planes or (usually) trucks. **They are a broker with liability.**

The model:

1. A customer needs 18 pallets moved from Shanghai to Kuwait.
2. The forwarder buys space from a shipping line at one price (**buy rate**).
3. They sell that movement to the customer at a higher price (**sell rate**).
4. They keep the difference (**margin**), and in exchange they take responsibility for the whole thing working — customs, trucking at both ends, paperwork, and the claim if it goes wrong.

Al-Qabandi is explicitly **non-asset-based**, which their own company profile states. This matters more than it sounds:

> **Dev implication:** the buy side is a *network*, not a fleet. There is no "our trucks" table with a capacity calendar. Instead there is a rate library — hundreds of negotiated price agreements with agents and carriers, each with a validity window. Pricing is a *lookup and comparison* problem, not a *scheduling and allocation* problem. This is why `FR-RT` (rate cards) is the largest module in the SRS, and why versioning (`FR-RT-08`) matters more than almost anything else.

A forwarder's real product is **coordination and paperwork**. That is precisely why software eats so much of the manual work.

---

## 2. The parties

| Party | What they are | In our schema |
|---|---|---|
| **Shipper** | The party sending the goods. Usually the exporter/seller. | A role on the job, often (not always) the customer |
| **Consignee** | The party receiving the goods. Usually the importer/buyer. | A role on the job |
| **Notify party** | Who gets told when cargo arrives. Often the consignee, often a broker. | A role on the job |
| **Customer / bill-to** | Whoever pays Al-Qabandi. May be shipper *or* consignee depending on Incoterm. | `Customer` entity |
| **Carrier** | Owns the vessel or aircraft. Maersk, MSC, Emirates SkyCargo. | `Partner` (type: carrier) |
| **Origin agent** | Another forwarder, overseas, handling the origin end. Al-Qabandi's "global agency network". | `Partner` (type: agent) |
| **Destination agent** | The mirror image, when Al-Qabandi is the origin side. | `Partner` (type: agent) |
| **Haulier / trucker** | Does the road leg. | `Partner` (type: haulier) |
| **Customs broker** | Files the declaration. Al-Qabandi holds their own licence, so usually in-house. | Internal role, or `Partner` |
| **Terminal / port** | Handles and stores the container. Charges THC and demurrage. | `Location` + charge counterparty |
| **NVOCC** | A forwarder who issues their own bills of lading — acting like a carrier. | Behaviour, not a table |

**The key asymmetry:** the shipper and the consignee are both on the job, but only one of them is the *customer*. Who pays depends on the Incoterm (§8). Get it wrong and you invoice the wrong company.

> **Dev implication:** parties are **roles on a job**, not a single foreign key. A job has a shipper, a consignee, a notify party and a bill-to, and they can all be different companies. Model as a join table (`job_parties`: job_id, party_id, role) rather than four nullable columns you will regret.

---

## 3. Modes, and how each one is measured

The mode determines *everything* downstream: pricing basis, documents, milestone names, transit time.

### Sea — FCL (Full Container Load)

The customer takes a whole container. Priced **per container**, flat, by container type. Simplest possible pricing. Transit Shanghai → Kuwait: 22–30 days. Kuwait → Jebel Ali: 3–5 days.

### Sea — LCL (Less than Container Load)

Cargo shares a container with other shippers. Consolidated at origin in a **CFS** (Container Freight Station), deconsolidated at destination. Priced per **revenue ton** (§4). Slower than FCL because of consolidation waiting time.

### Sea — Break bulk

Cargo too big or oddly shaped for containers, loaded directly into the hold. Steel, machinery, project cargo. Priced by negotiation, per shipment. Al-Qabandi does a lot of this — it is what "project cargo" means.

### Sea — RO-RO

"Roll-on/roll-off" — anything with wheels, driven on and off. Cars, trucks, cranes. Priced per unit or per lane-metre.

### Air

Fast, expensive, weight-sensitive. Priced per **chargeable kilo** on a descending scale (§16). Transit 1–5 days, but "transit" hides a lot — cargo often waits days for space. **Express / direct / deferred / consolidated** are service levels: express is next flight out, deferred is "whenever there's space, cheaper".

### Land — FTL / LTL

Full truckload vs less-than-truckload. Al-Qabandi runs GCC and Levant road freight. Cross-border adds a customs event at *each* border, and the border is almost always the largest source of variance.

### Sea-air

A Gulf specialty and a real Al-Qabandi service: sea freight to Dubai, then air onward. Cheaper than pure air, faster than pure sea. Two legs, two rate bases, one job.

> **Dev implication:** mode is not a display label — it is a **discriminator that changes the shape of the record**. Rate basis, required documents, milestone template and validation rules all branch on it. This is why `FR-RT-03`, `FR-JB-03` and `FR-DC-04` all say "per mode". Design for it on day one; retrofitting is miserable.

---

## 4. Chargeable weight — the maths

**The single most important calculation in freight.** Carriers charge for whichever is worse for you: how heavy it is, or how much space it takes. A container of feathers and a container of steel occupy the same slot.

### Air freight

```
volumetric_kg = (length_cm × width_cm × height_cm) / 6000
chargeable_kg = max(actual_gross_kg, volumetric_kg)
```

The `6000` is the **volumetric divisor** (IATA: 1 m³ = 166.67 kg). Some carriers use 5000. Must be configurable per rate card — `FR-RT-04`.

**Worked example.** 3 pallets, each 120 × 100 × 150 cm, total actual weight 400 kg:

```
volume per pallet     = 120 × 100 × 150 = 1,800,000 cm³
volumetric per pallet = 1,800,000 / 6000 = 300 kg
total volumetric      = 900 kg
chargeable            = max(400, 900) = 900 kg     ← you pay for 900
```

The customer thinks the shipment weighs 400 kg. The invoice says 900. **Every forwarder has this argument weekly.** Showing the calculation on the quote prevents it — worth doing in the UI.

### Sea LCL — revenue tons

```
cbm         = (L_m × W_m × H_m) × pieces
weight_tons = gross_kg / 1000
revenue_ton = max(cbm, weight_tons)
```

This is the **W/M** basis ("weight or measure"): 1 m³ treated as 1 tonne. Written `USD 45 W/M`. There is nearly always a **minimum** — a 0.3 m³ shipment still pays for 1 revenue ton.

### Road

Same idea, divisor typically 3000 for LTL, but varies by market and contract. Configurable.

### FCL

No chargeable weight — per container, flat. But watch **overweight surcharges**: a 20ft container has a payload limit around 28 tonnes, and road legs have axle-weight limits that are often stricter than the sea leg.

> **Dev implication:** store `actual_weight`, `volume`, **and** the computed `chargeable_weight` with the divisor used. Never recompute at display time from a divisor that may have changed since.

---

## 5. Containers

### Types you must support

| Code | Name | Capacity (approx) |
|---|---|---|
| `20GP` | 20ft general purpose | 33 m³, ~28 t payload |
| `40GP` | 40ft general purpose | 67 m³, ~26 t payload |
| `40HC` | 40ft high cube (extra foot of height) | 76 m³ |
| `20RF` / `40RF` | Reefer — refrigerated, needs a power plug | Less volume (insulation) |
| `20OT` / `40OT` | Open top — craned in from above | Over-height cargo |
| `20FR` / `40FR` | Flat rack — no sides | Over-width cargo |
| `45HC` | 45ft high cube | 86 m³ |

**Reefers** carry a temperature setpoint and need power at every stage — a reefer that loses its plug at a terminal is a claim. If reefer is in scope the job needs a `temperature_setpoint` and plug-in/plug-out events.

**OOG** ("out of gauge") means cargo exceeds container dimensions — flat racks, special permits, sometimes police escorts on the road leg. Always priced manually, never off a rate card.

### Container numbers and the check digit

Format under **ISO 6346**: `MSCU1234567`

- 3 letters — owner code
- 1 letter — category, almost always `U`
- 6 digits — serial
- 1 digit — **check digit**

The check digit is computable, so validate on input (`FR-JB-07`):

```js
const LETTERS = {A:10,B:12,C:13,D:14,E:15,F:16,G:17,H:18,I:19,J:20,K:21,L:23,
                 M:24,N:25,O:26,P:27,Q:28,R:29,S:30,T:31,U:32,V:34,W:35,X:36,Y:37,Z:38};

function isValidContainerNumber(cn) {
  if (!/^[A-Z]{3}U\d{7}$/.test(cn)) return false;
  const sum = [...cn.slice(0, 10)].reduce(
    (acc, ch, i) => acc + (LETTERS[ch] ?? +ch) * (1 << i), 0
  );
  return (sum % 11) % 10 === +cn[10];
}
```

Catching a typo at entry saves tracking the wrong box for a week.

---

## 6. Master vs house, and consolidation

This confuses every developer once, so here it is explicitly.

When Al-Qabandi consolidates cargo from three customers into one container:

- The **shipping line** issues **one** bill of lading to Al-Qabandi covering the whole container — the **Master Bill of Lading (MBL)**. Shipper: Al-Qabandi's origin agent. Consignee: Al-Qabandi Kuwait.
- Al-Qabandi issues **three** bills of lading, one per customer, covering only their portion — **House Bills of Lading (HBL)**. Shipper: the actual customer. Consignee: the actual receiver.

Identical in air: **MAWB** (airline-issued) and **HAWB** (forwarder-issued).

```
MBL / MAWB  ─┬─ HBL/HAWB #1  → Customer A  (job KWI-2026-04412)
             ├─ HBL/HAWB #2  → Customer B  (job KWI-2026-04413)
             └─ HBL/HAWB #3  → Customer C  (job KWI-2026-04414)
```

> **Dev implication:** this is `FR-JB-15`. A job needs an optional `master_job_id` self-reference. Costs land on the master (one container, one freight charge) and must be **apportioned** to the houses — usually by revenue ton or chargeable weight. Each house is separately invoiceable to a different customer. Store the apportionment rule, because someone will ask why house #2 got 40% of the freight cost.

---

## 7. The document set

Freight is a paperwork business. Each document exists because some party needs proof of something.

| Document | What it actually is | Issued by | Why it matters |
|---|---|---|---|
| **Bill of Lading (B/L)** | Three things at once: a receipt for the cargo, the contract of carriage, and — critically — a **document of title**. Whoever holds an original negotiable B/L owns the goods. | Carrier (MBL) / forwarder (HBL) | An **original** must be surrendered to release cargo. Lose it and the cargo is stuck. This is why Kuwait's rules say "3 originals". |
| **Sea waybill** | Like a B/L but *not* a document of title. Releases to the named consignee, no original needed. | Carrier | Faster, safer. Used where there is no letter of credit and trust exists. |
| **Telex release** | Carrier's confirmation that originals were surrendered at origin, so destination can release without paper. | Carrier | Extremely common. Saves couriering originals across the world. |
| **Air Waybill (AWB)** | Air equivalent. **Never** a document of title — air cargo moves faster than documents. | Airline (MAWB) / forwarder (HAWB) | IATA format, 11 digits: 3-digit airline prefix + 7 serial + 1 check digit (serial mod 7). |
| **Commercial invoice** | The seller's invoice to the buyer **for the goods**. Not the freight invoice. | Shipper | Customs values duty from this. Kuwait wants 1 original + 2 copies. |
| **Packing list** | What is physically in each carton/pallet: dimensions, weights, marks. | Shipper | Customs inspection matches against it. Must be stamped by exporter or forwarder for Kuwait. |
| **Certificate of Origin** | States where the goods were manufactured. | Chamber of commerce | Drives duty rate and preferential trade agreements. Often needs **legalisation** (embassy stamp) — a real cost and delay in the Gulf. |
| **Customs declaration** | The formal entry. Called a **bayan** (بيان) in Kuwait. | Broker (Al-Qabandi) | Carries a reference number that must live on the job. |
| **Arrival notice** | "Your cargo is here, here are the charges." | Carrier / agent | **Starts the free-time clock.** Timestamp it precisely. |
| **Delivery Order (DO)** | Instruction to the terminal to release cargo to the bearer. | Carrier or forwarder | Issued after the B/L is surrendered and charges paid. Common bottleneck. |
| **Proof of Delivery (POD)** | Signature/photo proving receipt. | Driver | Without it you cannot defend a non-delivery claim, and often cannot invoice. |
| **DG declaration + MSDS** | Dangerous goods declaration and safety data sheet. | Shipper | **Legally mandatory.** Moving DG without correct papers is a criminal matter, not a service failure. Hence the hard block in `FR-JB-12`. |
| **Insurance certificate** | Proof of cargo insurance. | Insurer / forwarder | Needed for CIF/CIP terms. |
| **Import licence / permit** | Authorisation for restricted goods. | Ministry | Kuwait requires these for a long list, and holders must be Kuwaiti citizens or Kuwait-based brokers. |

> **Dev implication:** documents are **typed, versioned and access-controlled** (`FR-DC-01…03`). Types drive the mandatory checklist per mode and direction (`FR-DC-04`). Versioning is not optional — a corrected B/L is routine and the old one must survive for the claim file. Release control matters commercially: an internal cost sheet accidentally visible in the customer portal is a disaster.

---

## 8. Incoterms

**Incoterms 2020** define, for a sale of goods, exactly where the seller's responsibility ends and the buyer's begins. Eleven exist; you will see maybe six.

| Term | Seller pays until | Risk transfers at | What it means for us |
|---|---|---|---|
| **EXW** | Nothing — buyer collects from the factory | Seller's premises | The buyer is our customer. We do everything. |
| **FCA** | Handing to the buyer's carrier | On handover | Common in air freight. |
| **FOB** | Loaded on the vessel at origin port | On board the vessel | Very common in sea. Seller pays origin costs, buyer pays freight onward. **This is our worked example.** |
| **CFR** | Freight to destination port | On board **at origin** | Seller pays freight but risk already passed. Trips people up constantly. |
| **CIF** | Freight **and insurance** to destination port | On board at origin | Same asymmetry as CFR, plus insurance. **GCC duty is assessed on CIF value** even when the term is not CIF. |
| **DAP** | Delivery to the named destination, duty unpaid | On arrival | Buyer clears customs and pays duty. |
| **DDP** | Everything, including import duty | On delivery | Seller carries all of it. Riskiest term for the seller. |

**Why this is in the system and not just on paper:** the Incoterm determines **which charges are ours to bill and to whom**. On FOB the origin haulage is the shipper's cost and the sea freight is the consignee's. Same physical movement, two invoices, two companies.

> **Dev implication:** `Incoterm` belongs on the enquiry (`FR-EQ-03`), on the customer as a default (`FR-MD-02`), and on the quotation (`FR-EQ-08`). It should drive which charge lines default to which bill-to party. Release One captures and displays it; automating the charge-split from it is a Release Two refinement — but model the field now.

---

## 9. The complete flow — one shipment, end to end

This is the core of the document. One real-shaped job, traced from first contact to cash collected.

### 9.1 The shipment we are tracing

| | |
|---|---|
| **Job reference** | `KWI-2026-04412` |
| **Movement** | Sea import, FCL |
| **Route** | Shanghai `CNSHA` → Shuwaikh `KWSWK` |
| **Customer (bill-to)** | Gulf Industrial Supplies Co., Kuwait — the importer/consignee |
| **Shipper** | Ningbo Precision Parts Ltd, China |
| **Incoterm** | **FOB Shanghai** — the shipper pays to get it on the vessel; our customer pays everything from there |
| **Cargo** | 18 pallets industrial spare parts, 14,200 kg gross, non-hazardous, HS `8483.40` |
| **Equipment** | 1 × `40HC`, container `MSCU4471820` |
| **Vessel** | MV Gulf Trader, voyage `V.428E`, with transhipment at Jebel Ali |
| **Origin agent** | Eastbound Logistics (Shanghai) — Al-Qabandi's network partner |
| **FX rate used** | 1 USD = 0.3065 KWD, stored on the job at award |

Because the term is **FOB**, Al-Qabandi's scope starts at the ship's rail in Shanghai and runs to the customer's warehouse door in Kuwait. Origin inland haulage and export clearance are the *shipper's* cost, arranged by our origin agent but billed to the shipper — not on our invoice.

**Day 0 is the vessel sailing.** Negative days are pre-departure.

---

### 9.2 Phase 0 — Enquiry to award (D-14 → D-10)

| Day | Actor | What happens | Document | System record |
|---|---|---|---|---|
| D-14 | Customer | Emails `saleskwt@qabandi.com`: *"Need pricing, 18 plt spares ex Shanghai, ~14.2t, FOB, ready next week."* | — | **`ENQ-2026-1187` created** from the inbound email, attachments preserved. Branch Kuwait, owner assigned, **SLA clock starts** (`FR-EQ-01`, `FR-EQ-02`) |
| D-14 | System | Parses cargo lines; computes totals. 18 pallets, 14,200 kg, 62 m³ → FCL, one 40HC | — | `chargeable_weight` and volume stored (`FR-EQ-04`) |
| D-14 | System | **Coverage lookup**: is there a valid sell card for CNSHA→KWSWK, 40HC, on the ready date? | — | Two instant options returned in under 10s (`FR-EQ-05`, `FR-RT-10`) |
| D-14 | System | Lane is partially covered, so it *also* raises an **agent RFQ** to three network agents including Eastbound Shanghai, deadline D-12 | RFQ | Agent RFQ dispatched via portal + email, reminder queued (`FR-EQ-06`) |
| D-13 | Origin agent | Eastbound responds: **USD 1,290 all-in** ocean freight, 24-day transit, validity 14 days | Agent quote | Lands in the same comparison view as the instant options (`FR-EQ-07`, `FR-AP-02`) |
| D-13 | Sales | Compares four options. Eastbound is not cheapest but has the best schedule and a 92 reliability score. Applies the standard mark-up | — | **Buy USD 1,290 · Sell USD 1,561 · margin 17.4%** — visible before anything is sent (`FR-RT-07`) |
| D-12 | Sales | Sends the quotation | **Quotation PDF**, Kuwait letterhead, EN, 14-day validity, Incoterm and exclusions stated | Sent by email + WhatsApp, delivery tracked (`FR-EQ-08`, `FR-EQ-10`) |
| D-10 | Customer | Accepts in the portal | — | **Job `KWI-2026-04412` created.** Buy, sell, margin and the **rate card version snapshot** lock to the job (`FR-EQ-11`, `FR-EQ-12`, `FR-RT-08`) |

> **What just happened commercially:** the margin is now *known and fixed* — on day −10, not at month-end. Today at Al-Qabandi this number does not exist until finance reconstructs it weeks later (`PP-08`).

---

### 9.3 Phase 1 — Origin (D-8 → D0)

| Day | Actor | What happens | Document | System record |
|---|---|---|---|---|
| D-8 | Origin agent | Books space with the carrier | **Booking confirmation** | Milestone `Booking confirmed`. Booking number stored as an external reference (`FR-JB-02`) |
| D-7 | Carrier | Releases an empty 40HC to the shipper's yard | — | Milestone `Empty released`. Container `MSCU4471820` registered — **check digit validated** (`FR-JB-07`) |
| D-6 | Shipper | Stuffs the container, applies seal `KW884213` | **Packing list**, **commercial invoice** (goods value USD 84,000) | Milestone `Cargo stuffed`. Seal number on the equipment record. Documents uploaded to the vault, typed (`FR-DC-01`) |
| D-5 | Origin agent | Files the Chinese export declaration | Export declaration | Milestone `Export cleared` |
| D-4 | Origin agent | Delivers to terminal | — | Milestone `Gate-in origin` |
| D-3 | Origin agent | Submits shipping instructions; carrier issues a draft B/L | Draft MBL | Uploaded for approval |
| D-2 | Shipper | Approves the draft | — | Milestone `B/L approved` |
| D-1 | Carrier | Container loaded aboard MV Gulf Trader | — | Milestone `Loaded on vessel` |
| **D0** | Carrier | **Vessel sails. ATD recorded.** | **MBL** issued carrier→agent; **HBL** issued Al-Qabandi→customer | Milestone `Vessel departed`, actual date set. Both B/Ls in the vault. **ETA Shuwaikh = D+24** published to the customer (`FR-JB-05`) |
| D0 | Shipper | Obtains and legalises the certificate of origin | **COO**, chamber-legalised | Uploaded, typed, marked customer-visible |

> **Where the master/house split appears:** the MBL names the agent and Al-Qabandi. The HBL names the actual shipper and the actual consignee. The customer only ever sees the HBL. (§6)

---

### 9.4 Phase 2 — Transit (D1 → D22)

| Day | Actor | What happens | Document | System record |
|---|---|---|---|---|
| D1–D11 | — | On water, Shanghai → Jebel Ali | — | Status `In transit`. Customer sees this on the tracking page without calling anyone (`FR-CP-05`) |
| D12 | Carrier | **Transhipment at Jebel Ali.** Discharged from the mother vessel to await the feeder | — | Milestone `Transhipped` |
| D14 | Carrier | Feeder vessel delayed 3 days — port congestion at Jebel Ali | — | **ETA revised D+24 → D+27, reason `port congestion`.** Change history retained (`FR-JB-05`) |
| D14 | System | Notifies the customer of the revision, with the reason, in their language | — | Notification sent, delivery status recorded (`FR-NT-01`, `FR-NT-02`) |
| D15 | Ops | Opens an **exception**: `vessel delay`, severity medium, owner assigned, customer-visible | — | Exception on the ops board with its own SLA clock (`FR-JB-09`) |
| D16–D21 | — | Feeder sails Jebel Ali → Shuwaikh | — | Status `In transit` |

> **This is the moment that removes the most phone calls.** Today the customer learns about a three-day delay by calling and asking. Here they were told, with the reason, before they thought to ask (`PP-02`).

---

### 9.5 Phase 3 — Arrival and customs (D22 → D29)

This phase is where the money leaks today.

| Day | Actor | What happens | Document | System record |
|---|---|---|---|---|
| D22 | Carrier | **Vessel arrives Shuwaikh. ATA recorded.** | — | Milestone `Vessel arrived` |
| D23 | Carrier | Container discharged | — | Milestone `Discharged` |
| D23 | Carrier | **Arrival notice issued** | **Arrival notice** | Milestone `Arrival notice`. ⏱ **Demurrage clock starts. 5 free days → expires end of D27** (`FR-JB-08`) |
| D23 | Al-Qabandi customs | Files the import declaration under their own licence | **Bayan** `KW-IMP-2026-88214` | **Customs stage opened** — declaration number, filing date, owner, its own SLA clock (`FR-JB-06`) |
| D24 | Customs | Duty assessed: **5% on CIF value**. CIF = goods 84,000 + freight 1,561 + insurance 105 = USD 85,666 → **duty USD 4,283 ≈ KWD 1,313** | Assessment notice | Duty recorded on the customs stage as a **disbursement**, not revenue (§14) |
| D24 | Al-Qabandi | Pays the duty on the customer's behalf | — | Disbursement cost line, to be recharged at cost |
| D25 | Customs | **Red channel — physical inspection selected** | — | Inspection flag set. **Exception `customs inspection` opened**, customer notified (`FR-JB-09`, `FR-JB-10`) |
| D27 | Customs | Inspection passed, goods released | Release note | Milestone `Customs released`. Customs stage closed, SLA clock stopped at 4 days |
| D27 | — | ⏱ **Free time expires at end of day.** | — | System flags demurrage will begin tomorrow |
| D28 | Customer | Surrenders the original HBL and pays charges | — | Document surrender recorded |
| D28 | Carrier | Issues the **Delivery Order** | **DO** | Milestone `DO released` |
| D29 | Haulier | Collects the container. **Gate-out.** | — | ⏱ **Demurrage stops at 1 chargeable day. Detention clock starts, 7 free days.** **A cost line and a revenue line are written automatically** (`FR-JB-08`, `FR-FN-03`) |

> **The single most valuable automation in the system.** That one day of demurrage — KWD 18 — is exactly the kind of charge that today gets remembered inconsistently and recovered partially (`PP-07`). Nobody had to notice it. The clock wrote the line.
>
> Note also the working calendar: free days here are counted in Kuwait working days, Sunday–Thursday (`NFR-03`). Counting calendar days would have over-billed the customer, which is worse than under-billing.

---

### 9.6 Phase 4 — Delivery (D29 → D31)

| Day | Actor | What happens | Document | System record |
|---|---|---|---|---|
| D29 | Haulier | Transports Shuwaikh port → customer warehouse | — | Milestone `Out for delivery` |
| D29 | Driver | Delivers and unloads. Captures signature, photo, timestamp on a phone browser | **POD** | Milestone `Delivered`, actual date set. POD bound to the job, visible to the customer within a minute (`FR-DC-09`) |
| D31 | Haulier | Returns the empty container to the depot | — | ⏱ **Detention stops at 2 days — inside the 7 free days, no charge.** Milestone `Empty returned` |
| D31 | Ops | Reviews the job: no open exceptions, all mandatory documents on file | — | **Job closed.** The close would have been blocked otherwise (`FR-JB-11`) |

---

### 9.7 Phase 5 — Money (D31 → D62)

| Day | Actor | What happens | System record |
|---|---|---|---|
| D31 | System | Cost ledger finalised from estimates plus everything the job wrote along the way | All lines `confirmed` (`FR-FN-01`, `FR-FN-02`) |
| D32 | Finance | Raises the sales invoice — Kuwait entity, KWD, 30-day terms, Kuwait numbering series and letterhead | Invoice issued (`FR-FN-06`). Blocked if there were no delivery event (`FR-FN-13`) |
| D33 | Origin agent | Their invoice arrives: **USD 1,340**, not the USD 1,290 quoted | **Variance flagged** — USD 50 (KWD 15.325) over quote, held for review before payment (`FR-FN-09`) |
| D34 | Pricing | Investigates: agent applied a mid-month GRI. Accepted, but recorded against the agent's record | Margin restated. Agent performance updated (`FR-AP-08`) |
| D62 | Customer | Pays | Payment recorded and allocated; portal balance updates (`FR-FN-11`) |

**The job P&L, final:**

| Line | Revenue (KWD) | Cost (KWD) |
|---|---|---|
| Ocean freight (USD 1,561 / USD 1,290 @ 0.3065) | 478.440 | 395.385 |
| Terminal handling (THC) | 28.000 | 28.000 |
| Customs clearance fee — own licence, no external cost | 35.000 | 0.000 |
| Delivery order fee | 12.000 | 12.000 |
| Haulage port → warehouse | 45.000 | 38.000 |
| Demurrage, 1 day | 18.000 | 18.000 |
| **Totals** | **616.440** | **491.385** |
| **Gross margin** | **KWD 125.055** | **20.3%** |
| *Agent variance (D33)* | *−15.325* | *→ KWD 109.730 · 17.8%* |

Duty of KWD 1,313 is a **disbursement** — paid out and recharged at cost, appearing on the invoice but never in revenue or margin. Treating disbursements as revenue is a classic modelling error that inflates turnover and destroys margin percentages.

**The cash cycle, which is the thing owners actually care about:**

```
D24  Al-Qabandi pays KWD 1,313 duty on the customer's behalf     ← cash out
D29  Al-Qabandi pays haulier, terminal, demurrage                ← cash out
D33  Agent invoice arrives, payable ~30 days → paid ~D63         ← cash out
D62  Customer pays                                               ← cash in

≈ 38 days of working capital funded by Al-Qabandi, per job.
```

> **Dev implication:** this is why `FR-FN-10` (receivables ageing) and `FR-FN-03` (automatic charge capture) matter more than they look. A forwarder funds its customers. Every day of unbilled or uncollected charge is a day of their own money on the street.

---

### 9.8 The whole thing on one page

```
        ENQUIRY                QUOTE                 AWARD
D-14 ───────────► D-13 ──────────────► D-12 ─────────────► D-10
  email lands      agent returns        PDF sent            job created
  SLA clock on     buy 1,290            margin known        buy/sell locked
                   sell 1,561           17.4%               rate snapshot

        ORIGIN                                    TRANSIT
D-8 ──── D-6 ──── D-5 ──── D-1 ──── D0 ═══════════════════════► D22
booking  stuffed  export   loaded   SAILS          transhipment    ARRIVES
         seal     cleared           MBL + HBL      D12            ATA
                                    ETA published  ETA revised D14
                                                   → customer told

        CUSTOMS                          DELIVERY              MONEY
D23 ──── D24 ──── D25 ──── D27 ──── D29 ──── D31 ──── D32 ──── D62
arrival  duty     red      released gate-out delivered invoice  paid
notice   assessed channel           ⏱ 1 day  POD      KWD 616
⏱ free   KWD1313  ⚠ exc.            demurrage empty
 time                                auto-charged returned
 starts                                        detention 0
```

---

### 9.9 Where each step lives today, and where it lives after

This table is the sales argument. It is also the requirements rationale.

| Step | Today at Al-Qabandi | After |
|---|---|---|
| Enquiry arrives | One of five branch mailboxes. No owner, no clock, no trace if unanswered | One queue, owner, SLA clock (`FR-EQ-01`) |
| Pricing | A person opens a spreadsheet, or asks someone who knows the lane | Instant off a versioned card; a person only for uncovered lanes (`FR-RT-10`, `FR-EQ-05`) |
| Agent RFQ | Email to several agents, replies compared by hand in the inbox | Dispatched, deadline-tracked, returned into one comparison (`FR-EQ-06`, `FR-AP-02`) |
| Quotation | Word document, retyped from the email | Generated from the enquiry, branded per entity, EN/AR (`FR-EQ-08`) |
| Award | Re-keyed into a job file or a spreadsheet | Quote becomes the job. Zero re-keying (`FR-EQ-12`) |
| Booking / milestones | Phone and email with the agent; status lives in someone's head | Posted by ops or by the agent's own portal login (`FR-JB-04`, `FR-AP-05`) |
| Customer asks "where is it" | Call → ops chases agent → calls back. ~35% of ops time | The customer looks it up. Nobody is called (`FR-CP-05`) |
| ETA change | Discovered, then relayed if someone remembers | Revised with a reason, customer notified automatically (`FR-JB-05`) |
| Documents | Attachments across mail threads | Typed, versioned vault on the job, released per rule (`FR-DC-01…03`) |
| Customs status | Known to the clearance officer, invisible to everyone else | A stage with a reference, an owner and an SLA clock (`FR-JB-06`) |
| Demurrage | Remembered, sometimes | Counted, and writes its own charge line (`FR-JB-08`, `FR-FN-03`) |
| Job margin | Reconstructed at invoicing, weeks later | Locked at award, live on the job throughout (`FR-FN-04`) |
| Agent overcharge | Usually paid — nobody compares to the quote | Variance flagged before payment (`FR-FN-09`) |
| Invoice | Typed per branch, per currency, by hand | Generated per entity with the right tax treatment (`FR-FN-06`) |
| Receivables | A spreadsheet, if that | Ageing by customer, branch and currency (`FR-FN-10`) |

---

## 10. Flow variants — air, land, export

The spine is identical: *enquiry → quote → award → origin → transit → destination → customs → delivery → invoice*. What changes is the middle.

### Air import (the fast version)

```
Booking → MAWB/HAWB issued → cargo received at origin terminal → export cleared
→ UPLIFTED (flight no. + date) → arrived → import declaration → duty
→ customs released → DO → delivered → POD
```

Differences that matter in code:

- **Days, not weeks.** A 3-day total transit means the customs stage is proportionally the *largest* part of the job. Delay hurts more.
- **No document of title.** Cargo releases against identity, not an original AWB — so no "originals in the courier" bottleneck.
- **Chargeable weight is the whole pricing story** (§4), with break points (§16).
- **Storage, not demurrage.** There is no container, so the airline terminal charges **storage** per kg per day after typically 24–48 hours free. The clock is much shorter and much more expensive per day.
- **Rollover risk.** Cargo gets bumped for higher-paying freight or weight limits. That is an exception reason code (`offload`).

### Land cross-border (Kuwait → Saudi → UAE)

```
Truck assigned → loaded → departed → BORDER OUT (exit clearance)
→ BORDER IN (entry clearance) → [repeat per border] → delivered → POD
```

- **Every border is a customs event.** A Kuwait→UAE truck crosses Kuwait/Saudi and Saudi/UAE — two more clearance stages, each with its own reference and its own delay.
- **The border is the variance.** Transit is 2 days of driving and 0–4 days of waiting.
- **Permits.** OOG or DG road movements need permits and sometimes escorts, arranged in advance.
- **Kuwait now runs electronic pre-clearance for land shipments** — declarations submitted *before* arrival. That is a new pre-arrival state worth modelling.
- No container, so **no demurrage or detention** — but truck **waiting time** (detention of the vehicle) is chargeable per hour.

### Sea export (Kuwait → elsewhere) — the mirror

```
Booking → empty released → stuffed at shipper/CFS → export declaration filed
→ export cleared → gate-in → loaded → SAILS (ATD) → [agent handles destination]
```

Al-Qabandi's role ends at the destination agent. The job still needs closing milestones (`arrived`, `delivered`) reported *by the agent* through their portal (`FR-AP-05`) — otherwise the customer sees a job that sails and then goes silent, which is exactly the current experience.

---

## 11. Who touches the job

The same job passes through six pairs of hands. Each one currently uses a different tool.

| Stage | Role | What they need to see | What they must not see |
|---|---|---|---|
| Enquiry → quote | **Sales** | Rate coverage, margin, customer terms, history | — |
| Rate negotiation | **Pricing** | Agent cards, buy costs, agent performance | — |
| Award → transit | **Operations** | Milestones, documents, exceptions, agent contacts | — |
| Arrival → release | **Customs / clearance** | Declaration, duty, inspection, HS codes, documents | — |
| Delivery | **Haulier / driver** | Address, contact, POD capture | Anything commercial |
| Invoice → collection | **Finance** | Cost ledger, margin, invoice, ageing | — |
| Throughout | **Customer** | Milestones, ETA, released documents, invoices | Buy rates, margin, internal notes, other customers |
| Origin/destination | **Agent** | Their own jobs, operational detail, their own price | Sell price, margin, other agents' quotes |

> **Dev implication:** this table *is* the permission model (`FR-ID-03`, `FR-AP-04`, `FR-JB-17`). Two lines carry real commercial risk: an agent seeing the sell price learns Al-Qabandi's margin and will renegotiate; a customer seeing the buy price learns the same. Both are enforced at the database row level, not in the UI (`FR-ID-04`, `FR-AP-09`).

---

## 12. State machines

### Enquiry

```
new → assigned → quoting → quoted → ┬→ accepted → (becomes a job)
                                    ├→ lost (reason code required)
                                    └→ expired (validity passed)
```

### Job

```
booked → in_transit → arrived → clearing → cleared → out_for_delivery
       → delivered → completed → invoiced → closed
                          │
                          └→ cancelled (at any point, reason required)
```

Guards worth enforcing in the service layer, not just the UI:

- `booked → in_transit` requires a departure actual date.
- `clearing → cleared` requires a declaration number and a release date.
- `delivered` requires a POD (`FR-DC-09`).
- `completed → invoiced` is blocked with an open blocking exception or a missing mandatory document (`FR-FN-13`, `FR-JB-11`).
- Any DG job is blocked past `booked` without class, UN number, packing group and declaration (`FR-JB-12`).

### Exception

```
open → acknowledged → in_progress → resolved → closed
```

Carries an SLA clock throughout, and may write a charge line at any point.

### The three clocks (§15)

```
demurrage:  arrival_notice ──── free_days ────► charging ──── gate_out
detention:  gate_out ────────── free_days ────► charging ──── empty_returned
storage:    arrival_at_facility ─ free_days ──► charging ──── collected
```

Each is a small state machine with its own free-day allowance drawn from the customer or carrier record, counted in the **branch working calendar**.

---

## 13. Customs

For Al-Qabandi this is a **profit centre**, not an afterthought — they hold their own clearance licence, which their profile flags as a differentiator. In our worked example the clearance fee was KWD 35 of pure margin, because the cost is internal.

### The flow

1. **Declaration filed** — goods description, HS code, value, origin, consignee.
2. **Duty assessed** — GCC common external tariff is **5% on most goods**, on the **CIF value** (goods + freight + insurance). Some categories differ; some are exempt.
3. **Payment** — often advanced by the forwarder and recharged.
4. **Channel selection** — green (release), yellow (document check), red (physical inspection). Red is where days disappear, and where demurrage accrues.
5. **Release.**

### HS codes

The **Harmonised System** code classifies goods. 6 digits internationally, extended to 8–10 nationally. Determines duty rate and whether a permit is needed. Misclassification is a fine, sometimes a seizure. Lives on the commodity master (`FR-MD-09`) and the job — never free text.

### Kuwait specifics

- The declaration is a **bayan**; its number belongs on the job (`FR-JB-06`).
- Customs has moved to a **Single Window** model requiring registered authorisation, and launched **electronic pre-clearance for land shipments**.
- Import licences are required for a long list of goods; holders must be Kuwaiti citizens or Kuwait-based brokers.
- Documents typically need **chamber of commerce legalisation** — a real cost and a real delay.

> **Dev implication:** `FR-JB-06` models customs as a **first-class stage with its own SLA clock**, not a milestone. Filing date, reference, assessed amount, inspection flag, release date, owner. The reason is visible in §9.5: a container held in customs is a container accruing demurrage, and today nobody sees it until someone asks. Direct filing into the Single Window is not built, and as of August 2026 is a decision rather than a deferral: Kuwait clearance runs through MicroClear, which is not an API a forwarder can buy (`Gulf_Market_Analysis.md` MK-03). We capture states and estimate duty from a tariff table; we do not submit.

---

## 14. The money

### Buy, sell, margin

```
buy      = what Al-Qabandi pays carriers, agents, hauliers
sell     = what Al-Qabandi charges the customer
margin   = sell − buy
margin % = (sell − buy) / sell
```

Forwarding gross margins typically run **12–25%**. Our worked example landed at 20.3%, then 17.8% after the agent variance.

**Disbursements are not revenue.** Duty, and anything else paid on the customer's behalf and recharged at cost, appears on the invoice but must sit outside revenue and margin. In §9.7 the duty was KWD 1,313 against a job whose actual margin was KWD 125 — treat it as revenue and the margin percentage becomes meaningless.

### Accessorials

The freight rate is never the whole invoice.

| Charge | What it is |
|---|---|
| **THC** | Terminal handling — the port's fee for moving your container. Both ends. |
| **BAF / CAF** | Bunker (fuel) and currency adjustment factors. Carrier surcharges that move monthly. |
| **Documentation fee** | For issuing the B/L. |
| **Customs clearance fee** | Al-Qabandi's own fee for filing. High margin — own licence. |
| **DO fee** | For issuing the delivery order. |
| **Haulage** | The road leg. |
| **DG surcharge** | Dangerous goods handling. |
| **Reefer plug-in** | Power at the terminal, per day. |
| **Inspection fee** | When customs goes red. |
| **Legalisation** | Embassy/chamber stamps. |
| **Demurrage / detention / storage** | §15 — the big three. |
| **Disbursements** | Duty, port dues, permits — paid out, recharged at cost. |

> **Dev implication:** `FR-RT-05` gives each accessorial a **calculation type** — flat, per unit, per kg, per container, per day, percentage. That set covers essentially every charge in freight. Model it as an enum with a rate and a basis, not a hardcoded formula per charge. Add an `is_disbursement` flag.

---

## 15. Demurrage vs detention vs storage

**Developers confuse these constantly, and getting it wrong loses real money.** All three are per-day charges starting after agreed **free days**.

| | Where the box is | Who charges | Clock starts | Clock stops |
|---|---|---|---|---|
| **Demurrage** | Container still **inside** the terminal | Shipping line | Discharge / arrival notice | Gate-out |
| **Detention** | Container **outside**, in your possession | Shipping line | Gate-out | Empty returned |
| **Storage** | **Cargo** (not the container) in a warehouse or CFS | Terminal / warehouse | Arrival at the facility | Collection |

Mnemonic: **demurrage = the box is stuck in the port. Detention = you are holding onto their box. Storage = the goods are sitting in a shed.**

In §9.5 both appear on one job: demurrage ran D23→D29 with 5 free days, giving 1 chargeable day. Detention ran D29→D31 with 7 free days, giving zero.

**Free time** is negotiated — typically 3–7 days demurrage, 3–14 detention, varying per customer and per carrier contract. Al-Qabandi may have better free time than their customer does; that spread is legitimate margin.

Regional note: some terminals bundle demurrage and port storage under one name. Do not hardcode assumptions — make the charge types configurable.

### Why this is a headline requirement

This is `PP-07` and `FR-JB-08`. Today these are remembered inconsistently and recovered partially — **money already earned and not collected.**

```
free_days  = from the customer or carrier record
days_used  = (clock_stop ?? now) − clock_start        ← in the branch working calendar
chargeable = max(0, days_used − free_days)
amount     = tiered_rate(chargeable)                  ← rates escalate: days 1–5 cheap, 6+ expensive
```

Two details that are easy to get wrong: rates **tier upward**, and Kuwait/Qatar/UAE **do not share a weekend** (`NFR-03`).

---

## 16. How rates are actually structured

### Air — break points

Air rates **decrease per kilo as weight increases**, in brackets:

```
M    (minimum charge)     KWD 25.000 flat
N    (normal, < 45 kg)    KWD  1.850 / kg
+45  kg                   KWD  1.420 / kg
+100 kg                   KWD  1.180 / kg
+300 kg                   KWD  0.960 / kg
+500 kg                   KWD  0.840 / kg
+1000 kg                  KWD  0.720 / kg
```

**The trap:** because the rate drops at each break, it is sometimes cheaper to declare a *higher* weight. 290 kg at the +100 rate = 342.20. Declaring 300 kg at the +300 rate = 288.00. Paying for 10 kg you do not have saves 54.20. This is **weight breaking**, it is entirely legitimate, and an engine that does not do it quotes worse prices than a human would.

```js
// evaluate every break at or below actual, plus the next break up, take the cheapest
function airPrice(chargeableKg, breaks, minimumCharge) {
  const totals = breaks.map(b => Math.max(chargeableKg, b.fromKg) * b.ratePerKg);
  return Math.max(minimumCharge, Math.min(...totals));
}
```

### Sea FCL

Flat per container type per lane. Simple — until the accessorials, which are where most of the money and all of the arguments are.

### Sea LCL

`rate × revenue_ton`, with a minimum (§4).

### Validity and versioning

Every card has an **effective from** and **effective to**. Carrier rates change monthly; some (**GRI** — general rate increase) change mid-month with two weeks' notice. That is exactly what caused the agent variance in §9.7.

> **The single most important rule in the system:** a quote stores a **snapshot** of the rate card version it was priced on (`FR-RT-08`). Never a foreign key to a mutable row.
>
> In our worked example the quote was priced on D-13 and the invoice raised on D32 — 45 days later. If the invoice recalculated from the current card, it would not match the quote, and that argument would happen every month.

---

## 17. Codes and identifiers

| Code | What | Example | Use |
|---|---|---|---|
| **UN/LOCODE** | UN location code: 2 country + 3 place | `KWSWK` Shuwaikh, `AEJEA` Jebel Ali, `CNSHA` Shanghai | The canonical location key |
| **IATA airport** | 3 letters | `KWI`, `DXB`, `DOH`, `AUH` | Air routing |
| **IATA airline prefix** | 3 digits, starts every AWB | `176` Emirates, `157` Qatar Airways | AWB numbering |
| **HS code** | 6–10 digits | `8483.40` gears and gearing | Duty classification |
| **SCAC** | 4 letters, ocean carrier | `MAEU` Maersk, `MSCU` MSC | Carrier identity, EDI |
| **ISO 6346** | Container number | `MSCU4471820` | With a check digit — validate it (§5) |
| **UN number** | 4 digits, dangerous goods | `UN1203` petrol | With class + packing group |
| **IMO class** | DG hazard class 1–9 | Class 3 = flammable liquid | Determines documents and stowage |

> **Dev implication:** `FR-MD-08` requires locations chosen from a master keyed on UN/LOCODE and IATA, **never free text**. Not tidiness — "Jebel Ali", "Jebel Ali Port", "JEA" and "جبل علي" are the same place, and a rate lookup that misses on a spelling variant silently returns "no coverage" and routes the enquiry to a human. Free-text locations quietly destroy the instant-quote value proposition.

---

## 18. Gotchas that will bite you

1. **Never recalculate a price.** Snapshot it. (§16) The number-one source of invoice disputes in every forwarding system ever built.
2. **The customer is not always the shipper.** Bill-to is its own party role, driven by the Incoterm. (§2, §8)
3. **Disbursements are not revenue.** Duty passed through at cost must sit outside margin. (§14)
4. **Chargeable weight ≠ actual weight**, and the customer will always quote you the actual weight. Show the calculation. (§4)
5. **Free time is in working days, and the working week is Sunday–Thursday** in Kuwait — and differs across their three countries. (`NFR-03`)
6. **KWD has three decimal places.** AED and QAR have two. Rounding globally produces wrong invoices in Kuwait. (`NFR-02`)
7. **Never delete anything.** Cargo claims run for years — under Hague-Visby the limitation is one year from delivery, and disputes surface late. The audit trail *is* the defence. (`FR-AD-01`)
8. **A container number typo tracks the wrong box for a week.** Validate the check digit. (§5)
9. **Dates need timezones, and they need the *local* date at the *place*.** "Departed 18 Aug" means 18 August at the origin port — not UTC, not the user's browser.
10. **Documents get corrected.** A B/L amendment is routine. Version, never overwrite. (`FR-DC-02`)
11. **DG without paperwork is a criminal matter**, not a validation warning. Hard block. (`FR-JB-12`)
12. **One movement can be many jobs** (consolidation, §6) and one job can be many containers. Neither relationship is one-to-one.
13. **"ETA" is three fields**, not one: originally promised, currently expected, actually happened. Customers care most about the *change*, and why. (`FR-JB-05`)
14. **The agent's invoice will not match their quote.** Build the variance check before you need it. (`FR-FN-09`)
15. **A job that sails and goes silent is the current experience.** If the destination agent does not post milestones, the customer portal is worse than a phone call. Agent adoption is a product risk, not just an integration task.

---

## 19. Quick glossary

| Term | Meaning |
|---|---|
| **ATA / ATD** | Actual time of arrival / departure |
| **AWB** | Air waybill |
| **BAF / CAF** | Bunker / currency adjustment factor (fuel and FX surcharges) |
| **Bayan** | Kuwaiti customs declaration |
| **B/L** | Bill of lading |
| **Break bulk** | Non-containerised cargo loaded loose |
| **CBM** | Cubic metre |
| **CFS** | Container freight station (where LCL is consolidated) |
| **Chargeable weight** | The greater of actual and volumetric weight |
| **CIF value** | Goods + insurance + freight — the base for GCC duty |
| **COO** | Certificate of origin |
| **Demurrage** | Per-day charge, container still in the terminal |
| **Detention** | Per-day charge, container out of the terminal and not returned |
| **DG** | Dangerous goods |
| **Disbursement** | Paid on the customer's behalf, recharged at cost, not revenue |
| **DO** | Delivery order |
| **ETA / ETD** | Estimated time of arrival / departure |
| **FCL / LCL** | Full / less-than container load |
| **FTL / LTL** | Full / less-than truckload |
| **Free time** | Days allowed before demurrage/detention/storage starts |
| **GRI** | General rate increase |
| **HAWB / HBL** | House air waybill / house bill of lading (forwarder-issued) |
| **HS code** | Harmonised System commodity classification |
| **Incoterm** | Three-letter code defining the buyer/seller responsibility split |
| **MAWB / MBL** | Master air waybill / master bill of lading (carrier-issued) |
| **NVOCC** | Non-vessel operating common carrier |
| **OOG** | Out of gauge (exceeds container dimensions) |
| **POD** | Proof of delivery |
| **Reefer** | Refrigerated container |
| **Revenue ton / W/M** | The greater of cubic metres and tonnes |
| **RO-RO** | Roll-on/roll-off (wheeled cargo) |
| **SCAC** | Standard carrier alpha code |
| **Telex release** | Carrier confirmation that originals were surrendered at origin |
| **THC** | Terminal handling charge |
| **Transhipment** | Moving cargo between vessels mid-route |
| **UN/LOCODE** | UN location code |
| **Volumetric divisor** | The constant converting volume to weight (6000 for air) |
| **Weight breaking** | Declaring a higher weight to reach a cheaper rate bracket |

---

*Document ends. Domain primer v2.0 · techpotions · August 2026 · Internal. Specification: `Qabandi_Release_One_SRS.md`. Pilot scope: `Qabandi_Pilot_15_Day.md`.*
