# Kuwait Prospect Call Sheet

| | |
|---|---|
| **Prepared by** | techpotions |
| **Date** | 24 August 2026 |
| **Question asked** | Which Kuwaiti companies can we approach this week, and what do we say? |
| **Source of the list** | The FIATA Kuwait members directory (31 forwarders), cross-checked against company websites and trade directories on 24 August 2026. Al-Qabandi is on that same directory page — see §1. |
| **Relationship to the research** | Applies `Gulf_Market_Analysis.md` §4 ("Kuwait is the proving ground, not the market") to the one question it does not answer: if you *are* going to sell in Kuwait, to whom, and on what argument. |
| **Status** | Contact data gathered from public sources. Two commercial blockers are unresolved — §1. |

> **The finding in one line:** the callable Kuwaiti market is about fifteen companies, the ones worth calling first are those with a second entity outside Kuwait — because that is where the deadline is — and you have three working days before Mawlid closes the week.

---

## 1. Read this before you dial

Two things are unresolved, and neither is a detail.

**The resale question is still open.** `Gulf_Market_Analysis.md` §9 lists it as Q1, owner *techpotions / legal*, blocking *everything*: does the Al-Qabandi engagement permit resale of the platform? Nothing in the repository records an answer. Every name below is a company you would be selling Al-Qabandi's platform to, so this is the first call of the day, and it is internal.

**Every target is Al-Qabandi's direct competitor.** This is not incidental — Al-Qabandi & Partners is listed on the very FIATA Kuwait page this shortlist was built from, at Fahad Al Salem Street, three entries above Al Rashed. Kuwaiti forwarding is a small trade with a shared association directory. Assume anything you say in a meeting reaches Al-Qabandi within the week.

Three consequences worth accepting rather than working around:

- **Lead with the product, not the pedigree.** `packages/brand` makes the operator a parameter; the product was built to be whitelabelled. Sell Cargolane, not "the system we built for Al-Qabandi."
- **Do not name Al-Qabandi as a reference** until Q5 is answered by the account. Naming them uninvited converts a design partner into a party with a grievance.
- **Consider telling Al-Qabandi first.** A forwarder who hears from a competitor that their software vendor is selling next door has been surprised; one who was asked has been consulted. The second conversation is cheaper.

---

## 2. The calling window

Kuwait works **Sunday to Thursday**, roughly 08:00–16:30, UTC+3.

| Day | |
|---|---|
| **Mon 24 Aug** | Working — today |
| **Tue 25 Aug** | Working |
| **Wed 26 Aug** | Working — last full day |
| **Thu 27 Aug** | **Public holiday — Prophet's Birthday** |
| Fri 28 – Sat 29 | Weekend |
| **Sun 30 Aug** | Offices reopen |

Three days, not five. That is the honest reason to call today rather than build a better list first — and it is also a usable closing line, because everyone you ring is working to the same short week.

---

## 3. How this list was filtered

The spine is the **FIATA Kuwait individual members directory** — 31 companies. A forwarder who pays FIATA dues issues FBLs, sits inside a documentation standard and has already decided that paperwork discipline is worth money. That is the cheapest available filter for "will pay for software."

Then, three cuts:

**Too big to sell to.** Agility, KGL, GAC, DHL Global Forwarding, Expeditors, Maersk/Damco, PostaPlus. Global groups run global systems and the procurement decision is not made in Kuwait. Agility carries a further problem — §6.

**Too small to sell to.** The one-desk cargo shops in Dajeej and Murqab. A per-customer deployment does not price down to them, and pretending otherwise wastes the week.

**Ranked by whether a second entity exists.** This is the argument that matters, and it comes straight out of the research: `Gulf_Market_Analysis.md` §4 found that **Kuwait has no compliance deadline** — no VAT, no VAT law, ruled out before 2028 — so nothing in the country forces a forwarder to replace working software. The urgency has to be imported. It comes from one of two places:

1. **A UAE arm inside the same group.** MPCI has a hard stop on **30 September 2026** — five weeks — and carriers are already refusing bookings without filing confirmation. A Kuwaiti group with a Dubai office has the deadline whether or not the Kuwait office feels it.
2. **A CargoWise renewal.** The December 2025 Value Pack move put costs up 20–50%. Worth asking on every call; it is the one question that turns a cold call into a dated one.

Tier A is the companies with the first. Tier B is the right size and shape but Kuwait-only — a slower, feature-led sale.

---

## 4. Tier A — multi-entity, call these today

Five companies. Each runs at least two national entities, which is the product's structural strength rather than a feature: multi-entity, multi-currency and per-branch invoice series are enforced by RLS policy across all 80 tables, not assembled in application code.

### 1 · Fusion Shipping & Logistics Co. W.L.L. — *call first*

| | |
|---|---|
| **Phone** | +965 2495 4200 |
| **Email** | sony.sebastian@fusionshipping.com |
| **Web** | fusionshipping.com |
| **Where** | Waha Mall, Offices 35G–38G, Dajeej, Farwaniya (earlier listings: Elite Tower, 2nd Floor, Fahed Al Salem Street) |
| **Named** | Dr. Sony Sebastian; Mario D'Costa; Arun Ravindran; Jamal Dawod |
| **Shape** | Founded 2010. **Kuwait, Dubai, Abu Dhabi, Saudi Arabia, Iraq, UK.** ISO certified. Exhibition logistics, project forwarding, LCL consolidation, warehousing, defence logistics. |

**Why first.** Six entities across five countries is the hardest version of the problem the platform was built around, and the UAE arm puts MPCI on their desk in five weeks. A named contact with a published email removes the switchboard. Defence and exhibition work both carry documentation and audit obligations, which is the half of the product that is database-enforced and insert-only.

**The hook.** Ask how Kuwait, Dubai and Riyadh reconcile today. If the answer is a spreadsheet per entity, you are in the right room.

### 2 · Top Terminal Logistics (TTL)

| | |
|---|---|
| **Phone** | +965 2228 9172 |
| **Web** | ttl-co.com (contact form; LinkedIn/Instagram @ttl_logistics) |
| **Where** | Dalal Mall, Office 6, Mezzanine, 6th Ring Road, Dajeej — also listed at Boubyan Complex, Office 19 |
| **Shape** | **Kuwait, Dubai (Port Saeed, Deira), Alexandria (shipping agency).** Land FTL/LTL, sea, air; clearance; IOR/EOR/DDP; warehousing; project and temperature-controlled cargo. |

**Why.** Three countries and a Dubai entity. They *market* Kuwait customs clearance publicly — Shuwaikh, Shuaiba and the land borders, with KUCAS compliance coordination — which means customs stage tracking, duty estimation and an SLA clock are features they already sell by hand.

**The hook.** IOR/EOR/DDP work lives or dies on document versioning and who signed what. That is `0003_audit.sql`, not a roadmap item.

### 3 · TransCrate Logistics Trading Co. W.L.L.

| | |
|---|---|
| **Phone** | +965 1804949 · fax +965 2244 7723 |
| **Web** | transcrate.com |
| **Where** | Mirqab, Jasim Boodai Street, Office 23, Block 3, Plot 31 · Dubai: Parklane Building, Office 1819, Business Bay, +971 4 238 6479 |
| **Shape** | Founded 2014. Kuwait + Dubai. Freight management, customs clearance, e-commerce fulfilment, reverse logistics, moving. |

**Why.** Young enough to have no twenty-year legacy system to rip out, and e-commerce fulfilment plus reverse logistics means shipment counts high enough that manual operations hurt. Two entities.

**The hook.** Their public tracking accepts an airway number and nothing else. The customer portal, the public `/track` page and the per-customer read-only API are built and demonstrable in the same session.

### 4 · Seguro Shipping Company

| | |
|---|---|
| **Phone** | +965 2240 2603 · +965 2240 2604 · +965 2228 0773 |
| **Email** | management@seguroshipping.net |
| **Web** | seguroshipping.net |
| **Where** | Al-Salhiya, Al-Soor Street, Marzook Building (FIATA lists Adil Tower, Ali Al Saleem Street, 30th Floor) |
| **Shape** | Kuwait + **Cochin** + **Mumbai**. NVOCC, FCL/LCL, air consolidations, GCC overland, customs broking, project cargo, Iraq door delivery. |

**Why.** Three entities and an NVOCC licence — an NVOCC issues house bills at volume, and the house B/L with a per-branch numbering series shipped and renders through Chromium with Arabic shaping. A `management@` address that is published is an unusually short path to a decision-maker.

**The hook — and a test worth running.** They work the India–Gulf corridor, which is exactly where **Shipmnts** competes hardest (`MK-06`). If they are already looking at an India-first product, ask them to enter a KWD amount and print it. `MK-07` flags this as unverified on our side too: an INR-first system built around two decimals may mishandle three, and KWD at three decimals is a correctness fault, not a preference. Do not assert it — ask them to check.

### 5 · Amiral Shipping Co.

| | |
|---|---|
| **Phone** | +965 2262 6066 |
| **Web** | amiral.com.kw |
| **Where** | Hawally, Ibn Khaldoun Street, Cairo Complex, 3rd Floor |
| **Shape** | Multimodal — sea, air, overland, cargo in transit, customs clearance, project cargo. Agent network across Dubai, Saudi, Qatar, Bahrain, Oman, Jordan, Egypt, Lebanon, plus Europe, Asia-Pacific and the Americas. |

**Why.** The agent network *is* the business, and it is the part of the product with the least competition: an overseas agent signs in at the same form, lands in `/agent`, and sees a job because their partner is named on it — the policy keys off the partner, not a branch. Partner settlement and netting shipped alongside it.

**The hook.** Ask what happens today when a Dubai agent wants a status. If the answer is "they email us and we look," the agent portal demonstrates itself.

---

## 5. Tier B — right size, Kuwait-only, call Tuesday and Wednesday

No imported deadline, so these are feature-led and slower. Ordered by fit.

| # | Company | Phone | Email / web | Why it is on the list |
|---|---|---|---|---|
| 6 | **Greenways Logistics Intl** | +965 2476 0381 / 2476 0581 | admin@greenwayslogistics.com | NVOCC and LCL consolidation. Consolidation means master-to-house cost splitting, which is built (`core/grouping.ts`). |
| 7 | **Fast Logistics Co. W.L.L.** | +965 2228 0333 | fastlogisticsco.com | Founded ~2015, claims 49,000+ shipments and 130,000 TEU from one office. Growth without a system is the cleanest pitch on this page. |
| 8 | **Aayan International Cargo** | +965 2239 3064 | aayans.com | Sharq. Multimodal sea and air, FIATA member, mid-size. |
| 9 | **Crown Logistics Co. W.L.L.** | +965 2475 9295 | info@crownlogisticsco.com | Al Hamra Mall, Farwaniya. FIATA member, generalist forwarder. |
| 10 | **Dana Kuwait Shipping & Forwarding** | +965 2245 8893 | salesdks@dks-kwt.com.kw | Sharq. OPCA gold member — project cargo, which carries the heaviest documentation load per shipment. |
| 11 | **Al-Tamioz Global Shipping & Forwarding** | +965 2247 4742 | sales@tamioz.com · global@tamioz.com | Al-Khalid Tower, Fahd Al-Salem Street. Two published sales addresses. |
| 12 | **UAGSCO Shipping & Logistics Co. W.L.L.** | +965 2246 1651 (ext. 107) · +965 9999 3042 | shp@uagsco.com | Established 2000, Salhiya. Forwarding plus warehousing; privately managed, so the owner is the buyer. |
| 13 | **Dolphin Shipping & Logistics** | +965 2491 2151 | dolphinkuwait.com | Office inside the Shuwaikh Port Authority building — a working-forwarder address, not a sales one. |
| 14 | **Associated Shipping & Logistics (ASL)** | +965 2431 3477 | varghese@asl.com.kw | Dajeej, Farwaniya. **Verify first** — the domain did not resolve on 24 Aug 2026; the company may have moved or folded. |
| 15 | **Al Rashed International Shipping Co. (K.S.C.C.)** | +965 2291 2800 / 2243 6550 | aris@al-rashedgroup.com | Founded 1952. Shipping agency, chartering, clearance, forwarding, warehousing. Larger and family-held — a long sale, but the most recognisable Kuwaiti logo available to you. Call last, or first if you want a reference name more than a quick close. |

---

## 6. Do not call

| | Why not |
|---|---|
| **Agility** | Beyond size: Agility is majority shareholder in Global Clearinghouse Systems, the JV holding the 25-year BOT concession that runs Kuwait customs on **MicroClear** until 2030 (`MK-03`). They are simultaneously the largest competitor to every name above and the gatekeeper of the customs integration you cannot build. Nothing good comes of this call. |
| **KGL Logistics** | State-linked scale, own systems, procurement unlike anything on this page. |
| **GAC, DHL Global Forwarding, Expeditors, Maersk/Damco, PostaPlus** | Global groups on global platforms. The Kuwait office cannot buy this. |
| **One-desk cargo shops** | Andhra Cargo, Alkhesal, Al-Saifeen and similar. Will not fund a per-customer deployment; a free trial they never configure costs you a week. |

---

## 7. What to say

### The cold call — thirty seconds

> "Morning — is [name] there? … I'm [X] from techpotions, here in Kuwait. One question and I'll be quick: you run Kuwait and Dubai as separate companies — are those on one system today, or two sets of books?
>
> The reason I ask — we've built the operating system for a forwarder where running several entities is the foundation rather than a module you add. And it's genuinely Arabic, not an English product with Arabic switched on.
>
> Twenty minutes on a screen, Tuesday or Wednesday? It's a short week — Thursday's the holiday."

Then stop talking. If they run one entity, drop the opener and ask what they use today; if the answer is Excel and email, that is a better conversation than a competitive displacement.

### The follow-up email — English

> **Subject: A forwarding system that speaks Arabic and gets KWD right**
>
> Dear [name],
>
> Thank you for the moment on the phone. In one paragraph, in case it is useful to a colleague:
>
> We build Cargolane — booking, documents (house B/L, house AWB, delivery order, packing list, customs pack), customs stages, and invoicing, for freight forwarders. Three things usually decide it:
>
> - **Arabic and English are equal.** Every screen, every document, right-to-left throughout. Not a translation layer added later.
> - **Your data stays yours.** We deploy a separate database per customer. Nothing is shared, and nothing is deleted — records are superseded and the history is kept, enforced by the database.
> - **KWD is handled at three decimals**, correctly, in every document and report.
>
> Twenty minutes on a screen share suits most people better than a document. Tuesday or Wednesday this week, or Sunday after the holiday?
>
> Kind regards,
> [name] · techpotions, Kuwait

### The follow-up email — Arabic

<!-- Raw HTML rather than a Markdown blockquote: `dir="rtl"` has to sit on the
     element. Without it the bidi algorithm still orders the words correctly but
     the block stays left-aligned, and a right-to-left letter flush left is the
     exact tell that Arabic was an afterthought — which is the exact claim this
     email makes about competitors. -->
<blockquote dir="rtl" lang="ar" style="border-inline-start:0;border-inline-end:2.5pt solid #0f4c5c;padding:7pt 11pt 7pt 0;text-align:right;">
<p><strong>الموضوع: نظام لإدارة الشحن — بالعربية، وبالدينار الكويتي بثلاث خانات عشرية</strong></p>
<p>تحية طيبة وبعد،</p>
<p>شكراً لوقتكم على الهاتف. باختصار، إن أردتم مشاركتها مع زميل:</p>
<p>نحن شركة techpotions في الكويت، وقد طوّرنا منصة تشغيل متكاملة لشركات الشحن والتخليص: الحجوزات، والمستندات (بوليصة الشحن البيتية، وبوليصة الشحن الجوي البيتية، وأمر التسليم، وقائمة التعبئة، وملف التخليص الجمركي)، ومراحل التخليص، والفوترة.</p>
<p>ثلاث نقاط عادةً ما تحسم القرار:</p>
<ul>
<li><strong>العربية والإنجليزية متساويتان.</strong> كل شاشة وكل مستند، ومن اليمين إلى اليسار بالكامل — وليست ترجمة أُضيفت لاحقاً.</li>
<li><strong>بياناتكم تبقى لكم.</strong> نُنصّب قاعدة بيانات مستقلة لكل عميل. لا مشاركة مع غيركم، ولا حذف — السجلات تُستبدل ويُحتفظ بتاريخها، بضمان من قاعدة البيانات نفسها.</li>
<li><strong>الدينار الكويتي يُحتسب بثلاث خانات عشرية</strong> بشكل صحيح، في كل مستند وتقرير.</li>
</ul>
<p>عرض مباشر على الشاشة لمدة عشرين دقيقة عادةً أنفع من أي ملف. هل يناسبكم الثلاثاء أو الأربعاء هذا الأسبوع، أم الأحد بعد العطلة؟</p>
<p>وتفضلوا بقبول فائق الاحترام،<br>[الاسم] · techpotions — الكويت</p>
</blockquote>

---

## 8. What not to promise

Four of these will come up on a first call. Answering them straight is worth more than the sale you would lose by hedging.

| If they ask | Say |
|---|---|
| *"Does it file with Kuwait customs?"* | **No, and be direct.** Access runs through MicroClear under a concession majority-owned by Agility, and there is no route in (`MK-03`). The platform tracks declarations, numbers, duty estimates and the SLA clock; it does not file. Anyone promising you Kuwait single-window filing is guessing. |
| *"Are you an accredited e-invoicing provider?"* | **No, and we will not be.** UAE ASP accreditation requires a two-year operating history (`MK-04`). We generate the structured document and hand off to an accredited provider — the adapter exists. |
| *"Who else runs this?"* | Al-Qabandi is the design partner — **but do not name them until Q5 is answered.** Until then: one Kuwaiti forwarder built it with us and it is going live. |
| *"What does it cost?"* | **Do not quote.** Every figure in `pricing.md` is a placeholder. Take the requirement away and come back with a number you will honour. |
| *"How do we know it works?"* | The honest answer, which is stronger than it sounds: Playwright covers every screen in both languages, on fixtures and against a live database, across 104 test files, and CI runs both stages. What we do not yet have is years of production history — `MK-05` says their IT reviewer asks this before they ask about features, so have the answer ready rather than discovered. |

---

## 9. Before the next list

| # | Question | Owner | Blocks |
|---|---|---|---|
| P1 | Does the Al-Qabandi contract permit resale? (= Q1) | legal | Every call on this page |
| P2 | Do we tell Al-Qabandi before or after the first meeting? | account | The relationship, not the sale |
| P3 | Which of these fifteen are on CargoWise today? | commercial | Turns a cold list into a dated one — ask on every call and record it here |
| P4 | Is the Kuwait pitch worth it at all, versus the same week spent in Dubai? | commercial | `Gulf_Market_Analysis.md` §4 says the buyers are in Dubai and Riyadh. This page does not overturn that finding — it works within it. Fifteen calls is a cheap test of whether Kuwait pays; a month is not. |

---

## 10. Sources

Accessed 24 August 2026.

- [FIATA Members Directory — Kuwait](https://fiata.org/directory/kw/) — the 31-company spine of this list
- [Cargo Yellow Pages — Kuwait freight forwarders A–F](https://www.cargoyellowpages.com/kuwait_freight_forwarders_cargo_agents.html) and [G–Z](http://www.cargoyellowpages.com/kuwait_gz_freight_forwarders_cargo_agents.html)
- Company websites: [Fusion Shipping](https://www.fusionshipping.com/), [Top Terminal Logistics](https://ttl-co.com), [TransCrate](http://www.transcrate.com), [Seguro Shipping](http://www.seguroshipping.net), [Amiral Shipping](https://amiral.com.kw), [Greenways Logistics](https://www.greenwayslogistics.com/), [Fast Logistics](http://www.fastlogisticsco.com), [UAGSCO](http://www.uagsco.com), [Al-Rashed Group](https://www.al-rashedgroup.com/)
- [Fusion Shipping & Logistics — Dun & Bradstreet profile](https://www.dnb.com/business-directory/company-profiles.fusion_shipping__logistics_cowll.1cef6206bcd38dfd48ac1f5b363e338a.html)
- [Kuwait customs clearance — Shuwaikh, Shuaiba and land borders (TTL)](https://www.ttl-co.com/en/customs-clearance/kuwait)
- [Prophet's Birthday 2026 — Gulf public holidays, Khaleej Times](https://www.khaleejtimes.com/world/gulf/prophet-brithday-2026-public-holidays-gulf-countries) and [Birthday of Prophet Muhammed in Kuwait, Office Holidays](https://www.officeholidays.com/holidays/kuwait/mawlid)
- Internal: `Gulf_Market_Analysis.md` §2, §4, §5, §9 and findings `MK-03` – `MK-07`

**A caution on the numbers.** Phone numbers and addresses were taken from trade directories and company sites, and both go stale — several listings still carry seven-digit Kuwaiti numbers from before the 2009 renumbering. Check the company's own site before dialling, and treat entry 14 as unverified.
