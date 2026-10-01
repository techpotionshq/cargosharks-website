/**
 * View models for the operational screens.
 *
 * These are read models, not entities: each one is the shape a *screen* wants,
 * flattened and already joined, so a page renders without walking relations.
 * They live in `lib` rather than in a slice because four slices and the
 * tracking page share them, and slices do not import each other (§4).
 *
 * They are deliberately not derived from the Drizzle row types. A row is what
 * the database stores; this is what an operations manager reads. Coupling them
 * would mean every schema change rippled into markup.
 */

export type Mode = 'sea_fcl' | 'sea_lcl' | 'air' | 'land' | 'courier'
export type Direction = 'import' | 'export' | 'cross_trade'

export interface Money {
  readonly amount: number
  readonly currency: string
}

/**
 * One alert as the topbar bell shows it — already rendered, already localised.
 *
 * Lives here rather than in the notifications slice because `fixtures.ts` (also
 * `lib`) has to build it for the demo, and `lib` is *below* the slices: a slice
 * may reach down for this shape, but this shape may not reach up into a slice.
 * The slice re-exports it as `InboxItem`.
 */
export interface NotificationView {
  /** The delivery row id — what mark-as-read writes against. Synthetic on fixtures. */
  readonly id: string
  readonly eventKey: string
  readonly title: string
  readonly body: string
  /** Where opening it lands, or null for an alert about nothing openable. */
  readonly href: string | null
  readonly createdAt: Date
  readonly read: boolean
}

export interface MilestoneView {
  /**
   * The row's own id, which the milestone dialog posts to `completeMilestone`.
   *
   * Optional, and absent on purpose where this view is built for the public
   * tracking page. That page is unauthenticated (FR-CP-05) and this shape is
   * shared with it, so an id present here would be an internal identifier
   * printed in the markup of a page anyone can open with a reference number.
   * The operator's job screen fills it in; nothing else needs to.
   *
   * On fixtures it is synthetic rather than a uuid. Nothing in fixture mode
   * writes — the action needs a database — so what matters is that it is
   * stable and unique per row, which is all a select option asks of it.
   */
  readonly id?: string
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly plannedAt: Date | null
  readonly revisedAt: Date | null
  readonly actualAt: Date | null
  readonly note?: string | null
}

interface ContainerView {
  readonly containerNo: string
  readonly type: string
  readonly sealNo: string | null
  readonly dischargedAt: Date | null
  readonly gateOutAt: Date | null
  readonly emptyReturnedAt: Date | null
}

/**
 * A running free-time clock — `FR-JB-08`, and the detail Pilot §3.1 calls
 * "the single most persuasive detail in the whole demo".
 *
 * `chargeLineWritten` is carried on the read model on purpose: the point of
 * the demo beat is not that a number is going up, it is that the number has
 * already written itself onto the job without anyone remembering to.
 */
export interface ClockView {
  readonly id: string
  readonly kind: 'demurrage' | 'detention' | 'storage'
  readonly containerNo: string | null
  readonly freeDays: number
  readonly startsOn: Date
  readonly elapsedDays: number
  readonly chargeableDays: number
  readonly perDiem: Money
  readonly accrued: Money
  readonly counterparty: string | null
  readonly chargeLineWritten: boolean
  /*
    What the edit form needs to open on the stored clock (O2). It could only
    ever start one: nothing rendered it with defaults, so nothing set
    `ends_on`, and a clock ran until the 730-day guard tripped.
  */
  readonly equipmentId: string | null
  readonly counterpartyId: string | null
  /** `YYYY-MM-DD`, as the date input and the column hold it. */
  readonly startsOnDay: string
  /** When it was stopped — the box came back. Null while it runs. */
  readonly endsOn: string | null
  /** The per-diem as stored, for the form; `perDiem` is for display. */
  readonly perDiemText: string
}

export interface ExceptionView {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
  readonly openedAt: Date
  readonly dueAt: Date | null
  readonly owner: string | null
  readonly description: string | null
  readonly customerName: string
  /** Falls back to `customerName` — the Arabic legal name is optional. */
  readonly customerNameAr: string
}

/**
 * A partner on a shipment — who is carrying it, clearing it, hauling it.
 *
 * `job_parties` is the shipper and consignee named on the bill; this is the
 * companies *we* engaged. The distinction matters at settlement time: the
 * consignee is not who we owe money to.
 */
export interface JobPartnerView {
  readonly id: string
  readonly partnerId: string
  readonly name: string
  /** Falls back to `name` — few partners have an Arabic legal name yet. */
  readonly nameAr: string
  readonly role: string
  readonly reference: string | null
}

export interface DocumentView {
  readonly id: string
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly version: number
  readonly releasedAt: Date | null
  readonly sizeKb: number
}

export interface JobSummary {
  readonly id: string
  readonly reference: string
  readonly branchCode: string
  readonly status: string
  readonly mode: Mode
  readonly direction: Direction
  readonly customerName: string
  readonly customerNameAr: string
  readonly originName: string
  readonly originNameAr: string
  readonly originCode: string
  readonly destinationName: string
  readonly destinationNameAr: string
  readonly destinationCode: string
  readonly vesselOrFlight: string | null
  readonly etd: Date | null
  readonly eta: Date | null
  readonly ata: Date | null
  readonly owner: string | null
  readonly customsStatus: string | null
  readonly containerCount: number
  readonly milestonesTotal: number
  readonly milestonesDone: number
  readonly openExceptions: number
  /** Accruing free-time money across the job's clocks, in the branch currency. */
  readonly accruing: Money | null
  readonly updatedAt: Date
}

export interface JobDetail extends JobSummary {
  /**
   * The foreign keys, alongside the display names `JobSummary` already
   * carries.
   *
   * A read projection that resolves everything to a name is fine for a table
   * and useless for an edit form: a `<select>` needs the id it is going to
   * submit. Carrying both on the detail read is cheaper than a second query
   * whose only job is to undo the joins.
   */
  readonly branchId: string
  readonly customerId: string
  readonly originId: string | null
  readonly destinationId: string | null
  readonly commodityId: string | null
  /*
    The raw columns behind `vesselOrFlight`, and the owner and quotation ids.

    The edit form was given the combined display string as the vessel name and
    nothing for the rest, and saving wrote what it was given: the voyage was
    appended to the vessel on every save, and the owner, flight, voyage and
    quotation were blanked.
  */
  readonly ownerId: string | null
  readonly quoteId: string | null
  /** The branch's zone — the one its times are typed and edited in. */
  readonly branchTimeZone: string
  readonly vesselName: string | null
  readonly voyageNumber: string | null
  readonly flightNumber: string | null
  readonly customerReference: string | null
  readonly masterBillNumber: string | null
  readonly houseBillNumber: string | null
  /** Telex release — set once, never cleared. Null until surrendered. */
  readonly houseBillSurrenderedAt: Date | null
  readonly bookingNumber: string | null
  /** The combined-transport boxes on the bill. Free text, printed as given. */
  readonly placeOfReceipt: string | null
  readonly placeOfDelivery: string | null
  readonly incoterm: string | null
  readonly commodity: string
  readonly grossWeightKg: number | null
  readonly chargeableWeightKg: number | null
  readonly volumeCbm: number | null
  readonly pieces: number | null
  readonly milestones: readonly MilestoneView[]
  readonly containers: readonly ContainerView[]
  readonly clocks: readonly ClockView[]
  readonly exceptions: readonly ExceptionView[]
  readonly documents: readonly DocumentView[]
  readonly partners: readonly JobPartnerView[]
  readonly customsNote: string | null
}

export interface EnquirySummary {
  readonly id: string
  readonly reference: string
  readonly branchCode: string
  readonly status: string
  readonly channel: string
  readonly mode: Mode | null
  readonly customerName: string
  readonly customerNameAr: string
  readonly originName: string
  readonly destinationName: string
  readonly owner: string | null
  readonly createdAt: Date
  readonly slaDueAt: Date | null
  readonly firstRespondedAt: Date | null
  /** Present once quoted — drives the margin column on the internal view. */
  readonly quotedSell: Money | null
  readonly quotedMargin: number | null
}

/**
 * A priced option — Moment 2b, the one that lands with whoever signs cheques.
 *
 * Buy, sell and margin sit on the same row deliberately (`FR-EQ-07`): margin
 * known at the moment of quoting rather than reconstructed at month-end is the
 * entire argument, and separating the three numbers across screens loses it.
 */
export interface QuoteOptionView {
  readonly id: string
  /*
    Null where the quotation was priced off a rate card, which is most of them.

    A card knows what a lane costs, not who sails it — carrier, service and
    transit only exist once an agent has answered an RFQ. Modelled as absent
    rather than as the string "—" so the screen can decide how to say so;
    a dash baked into a query reads as a rendering fault everywhere it lands.
  */
  readonly carrier: string | null
  readonly service: string | null
  readonly transitDays: number | null
  readonly buy: Money
  readonly sell: Money
  readonly marginPct: number
  readonly validUntil: Date
  readonly isRecommended: boolean
  readonly lines: readonly QuoteLineView[]
}

interface QuoteLineView {
  readonly chargeCode: string
  readonly nameEn: string
  readonly nameAr: string
  readonly basis: string
  readonly quantity: number
  /** Null where nothing recorded the buy side of this line — a card-priced quotation. */
  readonly buyRate: number | null
  readonly sellRate: number
  readonly amount: Money
}

export interface QuoteComparison {
  /** The enquiry's own status — decides which transitions are offered. */
  readonly status?: string
  readonly enquiryReference: string
  /** Null for an enquiry nobody has matched to a customer yet — a WhatsApp number, an unknown sender. */
  readonly customerName: string | null
  readonly lane: string | null
  /** Null until someone — or the model — records it; an emailed enquiry starts without one. */
  readonly mode: Mode | null
  /** Sea FCL's container count — pricing refuses without it. Null until recorded. */
  readonly containerCount: number | null
  readonly containerType: string | null
  readonly incoterm: string | null
  readonly preparedBy: string | null
  readonly pricedAt: Date
  /**
   * How long the same enquiry took by hand — Moment 2's punchline — and how
   * long the engine took to answer it.
   *
   * Both null unless they were actually measured. "Priced in 0 ms" is not a
   * fast quotation, it is a missing number wearing the punchline's clothes.
   */
  readonly manualTurnaroundHours: number | null
  readonly pricingMs: number | null
  /**
   * Whether the SLA clock has been stopped, and whether the enquiry is
   * finished.
   *
   * Both drive which actions the page offers, and both belong on this read
   * rather than on a second query: the page already has the enquiry row open.
   */
  readonly hasResponded: boolean
  readonly isClosed: boolean
  readonly options: readonly QuoteOptionView[]
}

/** What the public tracking page may show — `FR-CP-05`. */
export interface TrackingResult {
  readonly reference: string
  readonly status: string
  readonly mode: Mode
  readonly customerName: string
  readonly originName: string
  readonly originNameAr: string
  readonly destinationName: string
  readonly destinationNameAr: string
  readonly vesselOrFlight: string | null
  readonly etd: Date | null
  readonly eta: Date | null
  readonly ata: Date | null
  readonly containers: readonly ContainerView[]
  readonly milestones: readonly MilestoneView[]
  /** Released documents only. A draft bill of lading is not customer-visible. */
  readonly documents: readonly DocumentView[]
  /** Customer-visible exceptions only. */
  readonly notices: readonly { code: string; nameEn: string; nameAr: string }[]
}

export interface OpsOverview {
  readonly branchCode: string
  readonly enquiries: {
    readonly open: number
    readonly unassigned: number
    readonly breached: number
    readonly dueToday: number
    readonly trend: readonly { label: string; value: number }[]
    readonly byStatus: readonly { status: string; count: number }[]
  }
  readonly jobs: {
    readonly live: number
    readonly arrivingThisWeek: number
    readonly onHold: number
    readonly byStatus: readonly { status: string; count: number }[]
    readonly byMode: readonly { mode: Mode; count: number }[]
  }
  readonly quotes: {
    readonly sentThisMonth: number
    readonly winRatePct: number
    readonly averageMarginPct: number
    /** One figure per currency — amounts in two currencies do not add. */
    readonly quotedValue: readonly { readonly currency: string; readonly amount: string }[]
    readonly medianResponseMinutes: number
  }
  readonly clocks: {
    readonly running: number
    readonly accruing: readonly { readonly currency: string; readonly amount: string }[]
    readonly containersAtRisk: number
  }
  readonly exceptions: readonly ExceptionView[]
  readonly slaWatch: readonly EnquirySummary[]
  readonly arrivals: readonly JobSummary[]
  /** `laneAr` runs ← because an RTL line puts the origin on the right. */
  readonly topLanes: readonly { lane: string; laneAr: string; count: number; value: Money }[]
}

export interface PortalShipment {
  readonly id: string
  readonly reference: string
  readonly customerReference: string | null
  readonly status: string
  readonly mode: Mode
  readonly originName: string
  readonly destinationName: string
  readonly eta: Date | null
  readonly milestonesTotal: number
  readonly milestonesDone: number
  readonly documentsReleased: number
  readonly nextMilestone: string | null
}

/* ===========================================================================
   Register rows.

   Everything above is a *view model*: a shape invented for a screen. What
   follows is different in kind and the distinction is worth keeping — these
   are the row shapes the register queries already return, restated here so the
   fixture dataset can be built without `lib` importing a feature slice (§4,
   and a real import cycle: those slices import this file).

   So each interface below is a deliberate copy of one declared beside its
   query, named in the docstring. Structural typing does the rest: the fixture
   builder returns this shape, the query returns the slice's own, and the
   moment the two disagree the `return pilotX()` inside the query stops
   compiling. `pnpm typecheck` is the check that keeps the copies honest —
   nothing else does, which is why the pairing is written down.

   Money stays a string here, exactly as `numeric(19,6)` reaches the driver —
   `"1580.000000"`. Never a JS number: KWD carries three decimals and a
   round-trip through binary floating point is how a fils goes missing.
   ======================================================================== */

// --- the money trail — features/ledger/queries.ts ---------------------------

/** Mirrors `QuoteRow`. */
export interface QuoteRow {
  readonly id: string
  readonly reference: string
  readonly version: number
  readonly status: string
  readonly currency: string
  readonly totalSell: string | null
  readonly totalCost: string | null
  readonly validUntil: string | null
  readonly sentAt: Date | null
  readonly decidedAt: Date | null
  readonly customerName: string | null
  readonly enquiryReference: string | null
  readonly preparedBy: string | null
  readonly branchCode: string | null
}

/** Mirrors `InvoiceRow`. */
export interface InvoiceRow {
  readonly id: string
  readonly seriesNo: string | null
  readonly status: string
  readonly currency: string
  readonly subtotal: string | null
  readonly taxAmount: string | null
  readonly total: string | null
  readonly amountPaid: string | null
  readonly issuedAt: Date | null
  /** A `date` column, so a `YYYY-MM-DD` string rather than a `Date`. */
  readonly dueOn: string | null
  readonly isCreditNote: boolean
  readonly customerName: string | null
  readonly branchCode: string | null
}

/** Mirrors the anonymous return of `invoiceSummary`. */
export interface InvoiceSummary {
  readonly issued: number
  readonly paid: number
  readonly overdue: number
  /** One entry per currency, largest balance first — see `invoiceSummary`. */
  readonly outstanding: readonly { readonly currency: string; readonly amount: string }[]
}

/** Mirrors `PaymentRow`. */
export interface PaymentRow {
  readonly id: string
  readonly amount: string
  readonly currency: string
  readonly receivedOn: string
  readonly method: string | null
  readonly reference: string | null
  readonly customerName: string | null
  readonly branchCode: string | null
  readonly recordedBy: string | null
  /** What of the receipt is matched to an invoice. Unmatched money is a hole. */
  readonly allocated: string
}

/** Mirrors the anonymous return of `paymentSummary`. */
export interface PaymentSummary {
  readonly count: number
  /** One entry per currency, largest first — see `paymentSummary`. */
  readonly received: readonly { readonly currency: string; readonly amount: string }[]
  readonly unallocated: number
}

/** Mirrors `AgeingBucket`. The keys are the query's, not new ones. */
export interface AgeingBucket {
  readonly key: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'
  readonly count: number
  readonly amount: string
}

/** Mirrors the anonymous return of `receivablesAgeing`. */
export interface ReceivablesAgeing {
  /** One ageing per currency, largest book first — see `receivablesAgeing`. */
  readonly byCurrency: {
    readonly currency: string
    readonly buckets: AgeingBucket[]
    readonly total: string
    readonly overdue: string
  }[]
}

/** Mirrors `DebtorRow`. */
export interface DebtorRow {
  readonly customerId: string
  readonly customerName: string
  readonly balance: string
  readonly currency: string
  readonly invoiceCount: number
  readonly oldestDueOn: string | null
  readonly daysOverdue: number
}

/** Mirrors `AccountingExportRow`. */
export interface AccountingExportRow {
  readonly id: string
  readonly branchCode: string | null
  readonly format: string
  readonly periodFrom: string
  readonly periodTo: string
  readonly rowCount: number
  readonly status: string
  readonly postedAt: Date | null
  readonly postedBy: string | null
  readonly voidedAt: Date | null
  readonly voidReason: string | null
}

// --- rate cards — features/rates/queries.ts ---------------------------------

/** Mirrors `RateCardRow`. */
export interface RateCardRow {
  readonly id: string
  readonly direction: 'buy' | 'sell'
  readonly mode: string
  readonly tradeDirection: string | null
  readonly originName: string | null
  readonly originCode: string | null
  readonly destinationName: string | null
  readonly destinationCode: string | null
  readonly partnerName: string | null
  readonly customerName: string | null
  readonly branchCode: string | null
  readonly currency: string
  readonly version: number
  readonly validFrom: string
  readonly validTo: string | null
  readonly lineCount: number
  readonly total: string
  readonly isLive: boolean
  readonly isExpiring: boolean
}

/** Mirrors the anonymous return of `rateCardSummary`. */
export interface RateCardSummary {
  readonly live: number
  readonly expiring: number
  readonly lanesCovered: number
  /** Lanes with traffic and no live buy card — quoting those is guessing. */
  readonly uncoveredLanes: number
}

/** Mirrors `LaneMarginRow`. `marginPct` is null where one side is missing. */
export interface LaneMarginRow {
  readonly lane: string
  readonly mode: string
  readonly buyTotal: string | null
  readonly sellTotal: string | null
  readonly currency: string | null
  readonly marginPct: number | null
}

/** Mirrors `ExpiringRateCard` in `@qabandi/db` — shared with the night digest. */
export interface ExpiringRateCardRow {
  readonly id: string
  readonly branchId: string
  readonly direction: 'buy' | 'sell'
  readonly mode: string
  readonly lane: string
  readonly laneAr: string
  readonly counterparty: string
  readonly counterpartyAr: string
  readonly partnerId: string | null
  readonly validTo: string
  readonly daysRemaining: number
}

// --- customers — features/customers/queries.ts ------------------------------

/** Mirrors `CustomerRow`. */
export interface CustomerRow {
  readonly id: string
  readonly code: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly countryCode: string | null
  readonly isActive: boolean
  readonly branchCode: string | null
  readonly openJobs: number
}

/** Mirrors `CustomerDetail`. The terms array is per branch — FR-ID-02. */
export interface CustomerDetail extends CustomerRow {
  readonly registration: string | null
  readonly taxRegistration: string | null
  readonly primaryBranchId: string | null
  readonly terms: {
    readonly branchId: string
    readonly branchCode: string
    readonly paymentTermsDays: number
    readonly creditLimit: string | null
    readonly creditCurrency: string | null
    readonly freeTimeDays: number | null
    readonly defaultIncoterm: string | null
    readonly isOnHold: boolean
  }[]
}

/** Mirrors `FormReference`. */
export interface FormReference {
  readonly branches: { id: string; code: string; name: string; currency: string }[]
  readonly countries: { code: string; name: string }[]
}

// --- the network — features/network/queries.ts ------------------------------

/** Mirrors `PartnerRow`. */
export interface PartnerRow {
  readonly id: string
  readonly code: string
  readonly type: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly countryCode: string | null
  readonly currency: string | null
  readonly paymentTermsDays: number | null
  readonly scac: string | null
  readonly isActive: boolean
  readonly openJobs: number
}

/** Mirrors `LocationRow`. */
export interface LocationRow {
  readonly id: string
  readonly unlocode: string | null
  readonly nameEn: string
  readonly nameAr: string | null
  readonly countryCode: string | null
  readonly kind: string
  readonly isActive: boolean
  /** How often the place is used, either end of a lane. */
  readonly useCount: number
}

/** Mirrors `PartnerDetail`. */
export interface PartnerDetail {
  readonly id: string
  readonly code: string
  readonly type: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly countryCode: string | null
  readonly currency: string | null
  readonly paymentTermsDays: number | null
  readonly scac: string | null
  readonly isActive: boolean
  readonly varianceTolerancePercent: string
  readonly varianceToleranceAbsolute: string
  readonly settlementCustomerId: string | null
  readonly settlementCurrency: string | null
  readonly openJobs: number
  readonly totalJobs: number
  readonly openExceptions: number
  readonly contacts: readonly {
    id: string
    nameEn: string
    email: string | null
    phone: string | null
    role: string | null
  }[]
  readonly jobs: readonly {
    id: string
    reference: string
    status: string
    role: string
    customerName: string | null
    lane: string | null
    eta: Date | null
  }[]
}

/** Mirrors `PartnerCoverageRow`. */
export interface PartnerCoverageRow {
  readonly id: string
  readonly mode: string
  readonly lane: string
  readonly transitDays: number | null
  readonly isActive: boolean
}

/** Mirrors `PartnerComplianceRow`. Superseded rows are returned, not filtered. */
export interface PartnerComplianceRow {
  readonly id: string
  readonly documentType: string
  readonly reference: string | null
  readonly issuedOn: string | null
  readonly expiresOn: string | null
  readonly supersededById: string | null
  readonly daysRemaining: number | null
}

// --- the operations registers — features/operations/queries.ts --------------

/**
 * Mirrors `ExceptionRow`.
 *
 * Not `ExceptionView` above, which is the *dashboard's* shape. This one is
 * wider — it carries the close date and the cost impact — and the register
 * needs both, so the two coexist rather than one being widened into the other.
 */
export interface ExceptionRow {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly customerName: string | null
  readonly customerNameAr: string | null
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly severity: string
  readonly description: string | null
  readonly openedAt: Date
  readonly dueAt: Date | null
  readonly closedAt: Date | null
  readonly owner: string | null
  readonly costImpact: string | null
  readonly costCurrency: string | null
}

/** Mirrors `CustomsRow`. */
export interface CustomsRow {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly customerName: string | null
  readonly customerNameAr: string | null
  readonly status: string
  readonly declarationType: string | null
  readonly declarationNo: string | null
  readonly filedAt: Date | null
  readonly releasedAt: Date | null
  readonly slaDueAt: Date | null
  readonly inspectionRequired: boolean
  readonly dutyAmount: string | null
  readonly dutyCurrency: string | null
  readonly brokerName: string | null
  readonly brokerNameAr: string | null
}

/**
 * Mirrors `DocumentRow`.
 *
 * Distinct from `DocumentView`, which is the job file's shape: this one names
 * the job and the author, because the register is read across shipments.
 */
export interface DocumentRow {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly customerName: string | null
  readonly customerNameAr: string | null
  readonly typeCode: string
  readonly typeNameEn: string
  readonly typeNameAr: string
  readonly category: string
  readonly version: number
  readonly releasedAt: Date | null
  readonly authorName: string | null
  readonly createdAt: Date
  readonly isSuperseded: boolean
}

// --- payables — features/payables/queries.ts --------------------------------

/** Mirrors `SupplierInvoiceRow`. */
export interface SupplierInvoiceRow {
  readonly id: string
  readonly reference: string
  readonly partnerId: string
  readonly partnerName: string
  readonly status: string
  readonly currency: string
  readonly total: string
  readonly amountPaid: string
  readonly invoiceDate: string
  readonly dueOn: string | null
  readonly baseCurrency: string
  /** Billed minus accrued, in base currency. Positive means they billed over. */
  readonly varianceBase: string
  readonly lineCount: number
  readonly unmatchedCount: number
}

/** Mirrors `PayablesSummary`. */
export interface PayablesSummary {
  readonly outstanding: number
  readonly overdue: number
  readonly awaitingApproval: number
  readonly inDispute: number
  readonly needingReview: number
}

/**
 * What `payablesAgeing` reads before `ageItems` buckets it.
 *
 * The fixture stops here rather than returning an `Ageing`: the real query
 * selects two columns and hands them to `core`, and a fixture that skipped
 * that step would be exercising a different code path from the one a
 * database-backed deployment runs. The branch in the query calls `ageItems`
 * over these, exactly as it does over the rows.
 */
export interface AgeableBill {
  readonly outstanding: string
  readonly dueOn: Date | null
}

/** Mirrors `SupplierPaymentRow`. */
export interface SupplierPaymentRow {
  readonly id: string
  readonly partnerId: string
  readonly partnerName: string
  readonly amount: string
  readonly currency: string
  readonly paidOn: string
  readonly method: string
  readonly reference: string | null
  readonly allocated: string
}

/** Mirrors `SettlementRow`. */
export interface SettlementRow {
  readonly id: string
  readonly reference: string
  readonly partnerId: string
  readonly partnerName: string
  readonly status: string
  readonly currency: string
  readonly periodFrom: string
  readonly periodTo: string
  readonly receivableTotal: string
  readonly payableTotal: string
  readonly offsetAmount: string
  readonly residualAmount: string
  /** `settlementDirectionEnum` — widening this to `string` is what let
   *  `'payable'` through and threw `MISSING_MESSAGE` on every row. */
  readonly residualDirection: 'they_owe_us' | 'we_owe_them' | 'square'
  readonly agreedAt: Date | null
  readonly settledAt: Date | null
}

// --- consolidation — features/consolidation/queries.ts ----------------------

/** Mirrors `ConsolidationSummary`. */
export interface ConsolidationSummary {
  readonly id: string
  readonly reference: string
  readonly status: 'open' | 'closed' | 'cancelled'
  readonly mode: string
  readonly tradeDirection: string
  readonly masterBillNumber: string | null
  readonly vesselName: string | null
  readonly voyageNumber: string | null
  readonly flightNumber: string | null
  readonly originName: string | null
  readonly destinationName: string | null
  readonly etd: Date | null
  readonly eta: Date | null
  readonly houseCount: number
  readonly volumeCbm: string
  readonly grossWeightKg: string
  /** Master costs raised but not yet split across the houses. */
  readonly unallocatedCount: number
}

/**
 * Mirrors `GroupableShipment` in `@qabandi/core`.
 *
 * The candidates panel's fixture stops at the shipments for the same reason
 * the payables ageing does: `clusterShipments` is the thing being demonstrated
 * and it must be the same call in both modes.
 */
export interface GroupableShipmentRow {
  readonly jobId: string
  readonly reference: string
  readonly branchId: string
  readonly customerId: string | null
  readonly customerName: string | null
  readonly mode: string
  readonly originId: string | null
  readonly destinationId: string | null
  readonly originName: string | null
  readonly destinationName: string | null
  readonly readyOn: Date | null
  readonly volumeCbm: number | null
  readonly grossWeightKg: number | null
  readonly pieces: number | null
}

// --- administration — features/admin/queries.ts -----------------------------

/** Mirrors `UserRow`. */
export interface UserRow {
  readonly id: string
  readonly nameEn: string
  readonly nameAr: string | null
  readonly email: string
  readonly type: string
  readonly locale: string
  readonly isActive: boolean
  readonly lastSeenAt: Date | null
  readonly hasLogin: boolean
  readonly assignments: { branchCode: string; roleKey: string; requiresTwoFactor: boolean }[]
}

/** Mirrors the anonymous row of `listRoles`. */
export interface RoleRow {
  readonly key: string
  readonly nameEn: string
  readonly nameAr: string
  readonly requiresTwoFactor: boolean
  readonly permissions: number
}

/** Mirrors `BranchRow`. A branch is a legal entity, hence the paper columns. */
export interface BranchRow {
  readonly id: string
  readonly code: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly country: string
  readonly baseCurrency: string
  readonly timeZone: string
  readonly mailFrom: string | null
  readonly quietHoursEnabled: boolean
  readonly quietHoursFromHour: number
  readonly quietHoursToHour: number
  readonly invoiceSeries: string | null
  readonly invoiceSeriesNext: number
  readonly taxRegistration: string | null
  readonly houseBillSeries: string | null
  readonly arAccountCode: string | null
  readonly apAccountCode: string | null
  readonly taxAccountCode: string | null
  readonly bankAccountCode: string | null
  readonly fxVarianceAccountCode: string | null
  readonly roundingAccountCode: string | null
  readonly tradingConditionsEn: string | null
  readonly tradingConditionsAr: string | null
  readonly billOfLadingTermsEn: string | null
  readonly billOfLadingTermsAr: string | null
  readonly defaultExclusionsEn: string | null
  readonly defaultExclusionsAr: string | null
  readonly isActive: boolean
  readonly calendarId: string
  readonly calendarName: string | null
  readonly calendarNameAr: string | null
  readonly people: number
  readonly openJobs: number
}

/** Mirrors `ReferenceTable`. The key is the table name, in snake case. */
export interface ReferenceTable {
  readonly key: string
  readonly count: number
}

/** Mirrors the anonymous row of `listChargeTypes`. */
export interface ChargeTypeRow {
  readonly id: string
  readonly key: string
  readonly nameEn: string
  readonly nameAr: string
  readonly category: string
  readonly basis: string
  readonly revenueAccountCode: string | null
  readonly costAccountCode: string | null
}

/** Mirrors the anonymous return of `listReferenceSample`. */
export interface ReferenceSample {
  readonly incoterms: { code: string; name: string }[]
  readonly containers: { code: string; name: string; teu: string | null }[]
  readonly exceptions: { code: string; name: string; slaHours: number | null }[]
  readonly documents: { code: string; name: string; category: string }[]
  readonly calendars: { key: string; name: string; timeZone: string }[]
  readonly currencies: { code: string; name: string | null }[]
  readonly countries: { code: string; name: string }[]
  readonly milestones: number
}

/** Mirrors `MilestoneTemplateRow`. */
export interface MilestoneTemplateRow {
  readonly id: string
  readonly mode: string
  readonly direction: string
  readonly seq: number
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly ownerRole: string | null
  readonly plannedOffsetDays: number | null
  readonly customerVisible: boolean
  readonly isActive: boolean
}

/** Mirrors `CalendarRow`. `weekend` is ISO weekday numbers. */
export interface CalendarRow {
  readonly id: string
  readonly key: string
  readonly nameEn: string
  readonly nameAr: string
  readonly timeZone: string
  readonly weekend: number[]
  readonly dayStartMinute: number
  readonly dayEndMinute: number
  readonly isActive: boolean
  readonly holidays: number
}

/** Mirrors `DutyRateRow`. */
export interface DutyRateRow {
  readonly id: string
  readonly country: string
  readonly hsPrefix: string
  readonly ratePercent: string
  readonly descriptionEn: string
  readonly descriptionAr: string | null
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly notes: string | null
  readonly isActive: boolean
}

/** Mirrors `EngineRuleRow`. `raw` pre-fills the edit dialog. */
export interface EngineRuleRow {
  readonly id: string
  readonly label: string
  readonly scope: string
  readonly detail: string
  readonly isActive: boolean
  readonly raw: Record<string, unknown>
}

/**
 * Mirrors `AuditFilters`.
 *
 * Mirrored rather than imported, like everything else in this file: the pilot
 * layer states the shape it is asked for so a change to the query's signature
 * shows up here as a type error rather than as a fixture that quietly ignores
 * a filter it was never told about.
 */
export interface AuditFilters {
  readonly table?: string
  readonly op?: string
  readonly q?: string
  readonly from?: string
  readonly to?: string
  readonly limit?: number
}

/**
 * Mirrors `AuditRow`.
 *
 * `id` is a `bigint` because the audit table is append-only and long, so the
 * fixture states it as one too. A `number` here would type-check on the
 * register and fail the first time somebody paged with a keyset.
 */
export interface AuditRow {
  readonly id: bigint
  readonly at: Date
  readonly op: string
  readonly tableName: string
  readonly rowId: string
  readonly principalName: string | null
  readonly principalNameAr: string | null
  readonly principalType: string | null
  readonly branchCode: string | null
  readonly ip: string | null
}

// --- notifications and integrations ----------------------------------------

/** Mirrors `TemplateRow` in `features/admin/notifications.ts`. */
export interface NotificationTemplateRow {
  readonly id: string
  readonly eventKey: string
  readonly channel: string
  readonly locale: 'en' | 'ar'
  readonly branchId: string | null
  readonly branchCode: string | null
  readonly subject: string | null
  readonly body: string
  readonly isActive: boolean
}

/**
 * Mirrors `NotificationSwitch` in `@qabandi/core`.
 *
 * A null `eventKey` is the master switch for the channel; a key narrows it to
 * one event. `channelDecision` in core resolves the precedence, and the
 * fixture deliberately does not — two implementations of "is this on" is the
 * thing that file's docstring exists to prevent.
 */
export interface NotificationSwitchRow {
  readonly eventKey: string | null
  readonly channel: string
  readonly isEnabled: boolean
}

/** Mirrors `DeliveryRow` in `features/admin/notifications.ts`. */
export interface NotificationDeliveryRow {
  readonly id: string
  readonly eventKey: string
  readonly channel: string
  readonly recipient: string | null
  readonly status: string
  readonly attempts: number
  readonly lastError: string | null
  readonly suppressedReason: string | null
  readonly deferredUntil: Date | null
  readonly sentAt: Date | null
  readonly createdAt: Date
}

/**
 * An `integration_settings` row as `listIntegrations` selects it.
 *
 * The fixture stops at the row rather than at `IntegrationView`, and that is
 * the whole point of the shape: the screen's answer is the *catalogue* merged
 * over the *environment* merged over the row, and only the last of those three
 * needs a database. Returning finished views would mean fixture mode showed a
 * configuration this deployment does not have — which is exactly what
 * `harness.ts` says it must not do.
 *
 * `secrets` holds sealed ciphertext in the real table and is never opened.
 * Here it holds the same shape with obviously-fake values, so the screen can
 * say "set" without anything having been sealed.
 */
export interface IntegrationSettingRow {
  readonly id: string
  readonly key: string
  readonly driver: string | null
  readonly settings: Record<string, string | number | boolean>
  readonly secrets: Record<string, string>
  readonly isActive: boolean
  readonly lastCheckedAt: Date | null
  readonly lastOkAt: Date | null
  readonly lastError: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

// --- the dashboard map — features/dashboard/queries.ts ----------------------

/** Mirrors `MapData`. A lane with no coordinates is dropped, never plotted. */
export interface MapData {
  readonly lanes: {
    id: string
    originName: string
    originLon: number
    originLat: number
    destinationName: string
    destinationLon: number
    destinationLat: number
    count: number
    mode: string
  }[]
  readonly ports: {
    id: string
    name: string
    longitude: number
    latitude: number
    count: number
  }[]
}

// --- proof of delivery — features/pod/queries.ts ----------------------------

/** Mirrors `PodPhotoRow`. */
export interface PodPhotoRow {
  readonly id: string
  readonly assetId: string
  readonly caption: string | null
}

/** Mirrors `PodRow`. Coordinates are `numeric`, so strings. */
export interface PodRow {
  readonly id: string
  readonly deliveredAt: Date
  readonly receivedByName: string
  readonly receivedByIdNumber: string | null
  readonly signatureAssetId: string | null
  readonly containerNo: string | null
  readonly latitude: string | null
  readonly longitude: string | null
  readonly accuracyMetres: string | null
  readonly hasException: boolean
  readonly exceptionNotes: string | null
  readonly notes: string | null
  readonly capturedByEn: string | null
  readonly capturedByAr: string | null
  readonly createdAt: Date
  readonly supersededById: string | null
  readonly photos: readonly PodPhotoRow[]
}

// --- one document at a time — features/ledger/queries.ts --------------------

/*
   The two detail reads in the ledger slice, and the one place in this file
   where the mirrors are deliberately *narrower* than the query they copy.

   `getQuoteDetail` and `getInvoiceDetail` both cast a raw statement's rows, so
   every status, basis and method arrives there as `string`. The screens render
   them as message keys — `quotes.statuses.<status>`,
   `invoiceDetail.treatments.<treatment>`, `paymentForm.methods.<method>` — and
   a value outside the list is not a wrong label but `MISSING_MESSAGE` thrown
   while the page renders, with nothing having failed to compile. That is a bug
   this repository has already shipped once, from a fixture whose field was
   typed `string`.

   Narrower is still assignable, so the `return pilotX()` inside the query
   compiles exactly as before. What it buys is that a value the messages cannot
   resolve stops compiling *here*, in the file that invents it.
*/

/** `quote_status`. Every value is a key under `quotes.statuses`. */
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'superseded'

/** `invoice_status`. Every value is a key under `invoices.statuses`. */
export type InvoiceStatus =
  'draft' | 'approved' | 'issued' | 'part_paid' | 'paid' | 'credited' | 'void'

/** `tax_treatment`. Every value is a key under `invoiceDetail.treatments`. */
export type TaxTreatment = 'out_of_scope' | 'zero_rated' | 'exempt' | 'standard' | 'reverse_charge'

/** `charge_basis`. Printed as-is on a quotation line, so no message key. */
export type ChargeBasis = 'flat' | 'per_unit' | 'per_kg' | 'per_container' | 'per_day' | 'percent'

/**
 * `payments.method`, which is a text column and not an enum.
 *
 * The union is the *message* file's, not the schema's: `paymentForm.methods`
 * is what decides which values a screen can name.
 */
export type PaymentMethod = 'bank_transfer' | 'cheque' | 'cash' | 'card' | 'offset'

/** Mirrors `QuoteDetail`. */
export interface QuoteDetail {
  readonly id: string
  readonly reference: string
  readonly enquiryId: string
  readonly enquiryReference: string
  readonly branchId: string
  readonly branchCode: string | null
  readonly customerId: string | null
  readonly customerName: string | null
  readonly version: number
  readonly status: QuoteStatus
  readonly currency: string
  readonly totalSell: string | null
  readonly totalCost: string | null
  /** A `date` column — `YYYY-MM-DD`, as `valid_until::text` gives it. */
  readonly validUntil: string | null
  readonly preparedBy: string | null
  readonly sentAt: Date | null
  readonly decidedAt: Date | null
  readonly createdAt: Date
  /** `o.name_en || ' → ' || d.name_en`, or null where either end is missing. */
  readonly lane: string | null
  readonly mode: Mode | null
  /** `priced_snapshot ->> 'notes'` — what was typed at the moment of quoting. */
  readonly notes: string | null
  /** The covering note the model drafts and a coordinator edits — one per language. */
  readonly coverNoteEn: string | null
  readonly coverNoteAr: string | null
  readonly lines: readonly {
    id: string
    chargeName: string
    description: string | null
    basis: ChargeBasis
    quantity: string
    rate: string
    amount: string
    currency: string
  }[]
  /** Every other version of the same enquiry's quotation, newest first. */
  readonly history: readonly {
    id: string
    reference: string
    version: number
    status: QuoteStatus
  }[]
}

/** Mirrors `InvoiceDetail`. */
export interface InvoiceDetail {
  readonly id: string
  /** Null on a draft: the series is consumed at issue, not at save. */
  readonly seriesNo: string | null
  readonly status: InvoiceStatus
  readonly branchId: string
  readonly branchCode: string | null
  readonly customerId: string
  readonly customerName: string | null
  readonly currency: string
  readonly subtotal: string
  readonly taxAmount: string
  readonly total: string
  readonly amountPaid: string
  readonly taxTreatment: TaxTreatment
  readonly taxRatePercent: string
  /** Which of the bilingual columns the PDF renders, and which way it runs. */
  readonly language: 'en' | 'ar'
  readonly issuedAt: Date | null
  readonly dueOn: string | null
  readonly issuedBy: string | null
  readonly notes: string | null
  /**
   * `invoice_lines`, in `sort_order`.
   *
   * English only, because that is what the read selects. The table carries a
   * `description_ar` the PDF uses; the screen does not ask for it, and a
   * fixture returning a column the query does not would be inventing a shape
   * the database cannot produce.
   */
  readonly lines: readonly {
    id: string
    descriptionEn: string
    quantity: string
    unitPrice: string
    amount: string
    taxAmount: string
  }[]
  /** The receipts matched against this invoice, newest first. */
  readonly allocations: readonly {
    id: string
    amount: string
    receivedOn: string
    reference: string | null
    method: PaymentMethod
  }[]
}

/* ===========================================================================
   The six detail reads — the charge ledger and everything that argues with it.

   Every shape below stops where the query hands its rows to `@qabandi/core`,
   for the reason `AgeableBill` above already gives at length: `compareToAccrual`,
   `summariseInvoice`, `buildStatement`, `netPosition` and `ageItems` are the
   arithmetic being demonstrated, and a fixture that returned their answers
   would be exercising a different code path from the one a database-backed
   deployment runs. So the branch in each query returns *rows* and the same
   call runs over them.

   Money is a string here as everywhere else in this file — `numeric(19,6)` as
   the driver hands it over. A ledger read back through `Number` is a ledger
   that stops adding up in the third decimal, which is the one KWD needs.
   ======================================================================== */

// --- the charge ledger — features/costing/queries.ts ------------------------

/**
 * Mirrors `ChargeLineRow`.
 *
 * `direction` is `chargeDirectionEnum`'s own two values rather than `string`:
 * the card renders `charges.revenueShort` / `charges.costShort` off it and the
 * P&L filters on it, so a third value would be a silently mis-sided line.
 */
export interface LedgerLineRow {
  readonly id: string
  readonly direction: 'cost' | 'revenue'
  readonly chargeTypeId: string
  readonly chargeTypeName: string
  readonly description: string | null
  readonly basis: ChargeBasis
  readonly quantity: string
  readonly rate: string
  readonly amount: string
  readonly currency: string
  readonly amountBase: string
  readonly baseCurrency: string
  readonly fxRate: string
  /** The ids behind `counterpartyName`, so the edit form can pre-select it. */
  readonly counterpartyPartnerId: string | null
  readonly counterpartyCustomerId: string | null
  readonly counterpartyName: string | null
  readonly isAccrual: boolean
  /**
   * Which worker wrote the line, or null where somebody typed it.
   *
   * `panels.tsx` falls back to the raw key for an unknown source rather than
   * crashing, so this stays `string | null` — narrowing it here would claim a
   * closed set the column does not have.
   */
  readonly sourceKind: string | null
  readonly isBilled: boolean
  readonly matchedAmount: string
  readonly matchCount: number
  readonly createdAt: Date
}

/**
 * What `getJobLedger` reads before `jobMargin` reduces it.
 *
 * The margin is deliberately absent: it is the figure the screen exists to
 * show and `core/margin.ts` is what computes it, in both modes.
 */
export interface JobLedgerRows {
  readonly jobId: string
  readonly jobReference: string
  readonly baseCurrency: string
  readonly marginFloorPercent: string | null
  readonly lines: readonly LedgerLineRow[]
}

/** Mirrors `MatchCandidate` — the cost lines a supplier line can be matched to. */
export interface MatchCandidateRow {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly chargeTypeId: string
  readonly chargeTypeName: string
  readonly description: string | null
  readonly amount: string
  readonly currency: string
  readonly matchedAmount: string
  readonly counterpartyName: string | null
}

// --- one supplier bill — features/payables/queries.ts -----------------------

/**
 * The header of `getSupplierInvoice`'s first select, tolerances included.
 *
 * The two tolerance columns are on this shape and not on `SupplierInvoiceDetail`
 * because they are an *input* to `resolveTolerance`, not something the screen
 * renders. The real query spreads the same row into its return, which is why
 * they reach the caller there too.
 *
 * `status` is `supplierInvoiceStatusEnum`'s own values: the page renders
 * `payables.statuses.<status>` and decides from it whether the bill may still
 * be edited or disputed.
 */
export interface SupplierBillRow {
  readonly id: string
  readonly reference: string
  readonly branchId: string
  readonly partnerId: string
  readonly partnerName: string
  readonly partnerTolerancePercent: string | null
  readonly partnerToleranceAbsolute: string | null
  readonly status: 'received' | 'approved' | 'part_paid' | 'paid' | 'disputed' | 'void'
  readonly currency: string
  readonly baseCurrency: string
  readonly subtotal: string
  readonly taxAmount: string
  readonly total: string
  readonly amountPaid: string
  readonly fxRate: string
  readonly invoiceDate: string
  readonly dueOn: string | null
  readonly assetId: string | null
  readonly varianceAcceptedReason: string | null
  readonly disputeReason: string | null
  readonly notes: string | null
  readonly approvedAt: Date | null
  readonly settlementId: string | null
}

/** One line of the supplier's own invoice, before any verdict is reached. */
export interface SupplierBillLineRow {
  readonly id: string
  readonly description: string
  readonly chargeTypeId: string | null
  readonly chargeTypeName: string | null
  readonly tolerancePercent: string | null
  readonly toleranceAbsolute: string | null
  readonly jobId: string | null
  readonly jobReference: string | null
  readonly quantity: string
  readonly unitPrice: string
  readonly amount: string
  readonly taxAmount: string
}

/**
 * One match, joined to the charge line it claims.
 *
 * `claimed` is in the *bill's* currency and `accruedAmount` in the charge
 * line's, which is the pair the argument with the agent is had in;
 * `accruedBase` is the only one the verdict is computed from.
 */
export interface SupplierBillMatchRow {
  readonly id: string
  readonly lineId: string
  readonly chargeLineId: string
  readonly claimed: string
  readonly jobId: string
  readonly jobReference: string
  readonly chargeTypeName: string
  readonly accruedBase: string
  readonly accruedAmount: string
  readonly accruedCurrency: string
}

/** The three selects `getSupplierInvoice` runs, before `summariseInvoice`. */
export interface SupplierBillRows {
  readonly bill: SupplierBillRow
  readonly lines: readonly SupplierBillLineRow[]
  readonly matches: readonly SupplierBillMatchRow[]
}

// --- the agent current account — features/payables/queries.ts ---------------

/**
 * Mirrors `StatementEntry` in `@qabandi/core`, narrowed to the three kinds
 * this read produces: our invoice, our credit note, their bill.
 *
 * A receipt or a payment would be a fourth and a fifth, and neither is
 * selected — the account is built from open documents, and money that has
 * already moved is in `amount_paid`.
 */
export interface StatementEntryRow {
  readonly id: string
  readonly kind: 'invoice' | 'credit_note' | 'bill'
  readonly date: Date
  readonly reference: string
  readonly description: string
  readonly amount: string
  readonly outstanding: string
  readonly dueOn: Date | null
}

/**
 * What `getPartnerAccount` reads before `buildStatement`, `netPosition` and
 * `ageItems` turn it into a position.
 *
 * `customerId` is null where nobody has said the agent is also a customer of
 * ours, and the card says so rather than showing a one-sided balance — so the
 * field is load-bearing rather than incidental.
 */
export interface PartnerAccountRows {
  readonly partnerId: string
  readonly partnerName: string
  readonly currency: string
  readonly customerId: string | null
  readonly entries: readonly StatementEntryRow[]
}

// --- one settlement — features/payables/queries.ts --------------------------

/** Mirrors `SettlementLineRow`. `kind` is `settlementLineKindEnum`. */
export interface SettlementLineRow {
  readonly id: string
  readonly kind: 'invoice' | 'bill'
  readonly reference: string
  readonly amount: string
  readonly isFull: boolean
  readonly documentId: string
}

/**
 * Mirrors `SettlementDetail`.
 *
 * No core call sits behind this one — `settlement.ts` did its arithmetic when
 * the statement was drawn, and the row carries the answer — so the fixture
 * returns the finished shape. Every figure on it comes from the register row
 * `pilotSettlements` already built, which is what stops the header of this
 * page disagreeing with the row the reader clicked a second ago.
 */
export interface SettlementDetail extends SettlementRow {
  readonly branchId: string
  readonly notes: string | null
  readonly voidReason: string | null
  readonly lines: readonly SettlementLineRow[]
}

// --- one consolidation — features/consolidation/queries.ts ------------------

/** Mirrors `ConsolidationHouse`. The cargo figures are sums over `job_cargo`. */
export interface ConsolidationHouseRow {
  readonly jobId: string
  readonly reference: string
  readonly houseBillNumber: string | null
  readonly customerName: string
  readonly status: string
  readonly packages: number
  readonly grossWeightKg: string
  readonly volumeCbm: string
  readonly chargeableWeightKg: string | null
}

/**
 * Mirrors `ConsolidationCharge`.
 *
 * `allocationBasis` is `allocationBasisEnum`'s own values, not `string`: the
 * card renders `consolidations.bases.<basis>` and a value outside the list is
 * `MISSING_MESSAGE` thrown mid-render rather than a wrong label.
 */
export interface ConsolidationChargeRow {
  readonly id: string
  readonly direction: 'cost' | 'revenue'
  readonly chargeTypeId: string
  readonly counterpartyPartnerId: string | null
  readonly fxRate: string
  readonly chargeTypeName: string
  readonly description: string | null
  readonly amount: string
  readonly currency: string
  readonly amountBase: string
  readonly baseCurrency: string
  readonly allocationBasis:
    'chargeable_weight' | 'volume' | 'gross_weight' | 'packages' | 'equal' | 'manual'
  readonly allocatedAt: Date | null
  readonly counterpartyName: string | null
  readonly shareCount: number
}

/**
 * The master's own row, and the two lists under it.
 *
 * Stops short of `ConsolidationDetail` because that shape's `houseCount`,
 * `volumeCbm`, `grossWeightKg` and `unallocatedCount` are *reductions* over
 * these two lists which the query performs itself. Returning them pre-summed
 * would let the fixture's totals drift from its own houses — the one number on
 * a master file that has to be right.
 */
export interface ConsolidationDetailRows {
  readonly row: {
    readonly id: string
    readonly branchId: string
    readonly branchTimeZone: string
    readonly carrierPartnerId: string | null
    readonly coloadPartnerId: string | null
    readonly originId: string | null
    readonly destinationId: string | null
    readonly reference: string
    readonly status: 'open' | 'closed' | 'cancelled'
    readonly mode: string
    readonly tradeDirection: string
    readonly masterBillNumber: string | null
    readonly bookingNumber: string | null
    readonly vesselName: string | null
    readonly voyageNumber: string | null
    readonly flightNumber: string | null
    readonly originName: string | null
    readonly destinationName: string | null
    readonly etd: Date | null
    readonly eta: Date | null
    readonly closedAt: Date | null
    readonly notes: string | null
    readonly carrierName: string | null
    readonly coloadPartnerName: string | null
  }
  readonly houses: readonly ConsolidationHouseRow[]
  readonly charges: readonly ConsolidationChargeRow[]
}

/**
 * One house's slice of one allocated master cost —
 * `features/consolidation/queries.ts listAllocationShares`.
 *
 * Flat rather than nested under the charge for the same reason the query is
 * flat: it is what a `select` over `consol_allocation_shares` returns, and the
 * page groups it. A fixture that pre-grouped would be the one shape the
 * database could not produce.
 */
export interface ConsolAllocationShareRow {
  readonly consolChargeLineId: string
  readonly jobId: string
  readonly jobReference: string
  readonly shareAmount: string
}

// --- what a model read off the mail — features/enquiries/proposals.ts -------

/**
 * Mirrors `EnquiryProposal`.
 *
 * `field` stays `string` deliberately, matching the panel: an unknown field
 * degrades to its own name there rather than throwing, so narrowing it here
 * would claim a closed set that a new extraction surface is allowed to widen.
 * `confidence` is `numeric(5,4)` and therefore a string — it is displayed and
 * never computed on.
 */
export interface EnquiryProposalRow {
  readonly id: string
  readonly field: string
  readonly value: string
  readonly confidence: string | null
  readonly evidence: string | null
  readonly targetWasEmpty: boolean
  readonly model: string | null
  readonly promptVersion: string | null
}

// --- reads that live outside a queries.ts — the ones the sweep found -------

/**
 * The shapes behind four reads that were written where they were used rather
 * than in a slice's `queries.ts`: two option loaders in `ledger/ui/dialogs`,
 * one in `operations/ui/dialogs`, and the unbilled register in
 * `ledger/unbilled.ts`.
 *
 * Being outside a `queries.ts` is why they were the last four reads with no
 * fixture branch, and why `/quotes`, `/payments`, `/exceptions`, `/finance`
 * and the job file all answered 500 with no database while every register
 * behind them rendered. `scripts/check-fixtures.mjs` now fails the build for
 * the next one.
 *
 * Each shape is the *select*, not the rendered option. The loaders build their
 * label from these rows below the branch, so the two modes cannot disagree
 * about how an option reads — which is the failure a fixture that returned
 * finished `{ value, label }` pairs would invite.
 */

/** Mirrors the select in `loadOpenEnquiries` — enquiries still worth quoting. */
export interface OpenEnquiryRow {
  readonly id: string
  readonly reference: string
  readonly customer: string | null
  readonly contact: string | null
}

/** Mirrors the statement in `loadOutstandingInvoices`. */
export interface OutstandingInvoiceRow {
  readonly id: string
  /** `series_no`; null until the invoice is numbered — the dialog labels it in the operator's language. */
  readonly label: string | null
  readonly customer: string
  readonly balance: string
  readonly currency: string
}

/** Mirrors the select in `loadOpenShipments`. */
export interface OpenShipmentRow {
  readonly id: string
  readonly reference: string
  readonly customer: string | null
  readonly customerAr: string | null
}

/**
 * Mirrors one row of `unbilledRevenue`'s aggregate.
 *
 * `oldestAt` is a `Date` here and a string from the driver — the query
 * converts once on its own side, so both arms hand the caller the same thing.
 */
export interface UnbilledJobRow {
  readonly jobId: string
  readonly reference: string
  readonly status: string
  readonly customerId: string | null
  readonly customerName: string | null
  readonly lines: number
  readonly amountBase: string
  readonly baseCurrency: string
  readonly currencies: readonly string[]
  readonly oldestAt: Date
}

/** Mirrors `unbilledLinesFor` — the lines behind one shipment's figure. */
export interface UnbilledLineRow {
  readonly id: string
  readonly description: string | null
  readonly chargeTypeId: string | null
  readonly quantity: string
  readonly rate: string
  readonly amount: string
  readonly currency: string
}

/**
 * Mirrors `ReportRow` — one row of the margin report, already summed.
 *
 * The amounts are strings because the query computes them in PostgreSQL on
 * `numeric` and never lets a JS `number` near them. The fixture holds to the
 * same rule through `Decimal`: a year of Kuwaiti margins reduced through
 * `Number()` loses fils, and this screen exists to be reconciled against the
 * job files.
 */
export interface ReportRowLike {
  readonly key: string
  readonly labelEn: string
  readonly labelAr: string | null
  readonly jobCount: number
  readonly revenue: string
  readonly cost: string
  readonly grossProfit: string
  readonly currency: string
}

/** Mirrors `ApiKeyRow` — live keys first, revoked ones still listed (§5.5). */
export interface ApiKeyRowLike {
  readonly id: string
  readonly prefix: string
  readonly name: string
  readonly customerName: string | null
  readonly customerNameAr: string | null
  readonly branchId: string | null
  readonly scopes: string[]
  readonly createdBy: string | null
  readonly createdAt: Date
  readonly lastUsedAt: Date | null
  readonly expiresAt: Date | null
  readonly revokedAt: Date | null
}

/** Mirrors `WebhookEndpointRow`, delivery counts included — FR-AD-06. */
export interface WebhookEndpointRowLike {
  readonly id: string
  readonly url: string
  readonly customerName: string | null
  readonly customerNameAr: string | null
  readonly events: string[]
  readonly isActive: boolean
  readonly disabledAt: Date | null
  readonly disabledReason: string | null
  readonly queued: number
  readonly failed: number
  readonly lastDeliveredAt: Date | null
}

/** Mirrors `MailboxRow`. `password_sealed` is absent from both, deliberately. */
export interface MailboxRowLike {
  readonly id: string
  readonly branchId: string
  readonly branchCode: string
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly username: string
  readonly folder: string
  readonly archiveFolder: string | null
  readonly isActive: boolean
  readonly lastPolledAt: Date | null
  readonly lastMessageAt: Date | null
  readonly lastError: string | null
}

/** Mirrors `WhatsappNumberRow` from `features/admin/whatsapp-numbers.ts`. */
export interface WhatsappNumberRowLike {
  readonly id: string
  readonly branchId: string
  readonly branchCode: string
  readonly phoneNumberId: string
  readonly displayNumber: string | null
  readonly label: string | null
  readonly isActive: boolean
  readonly lastMessageAt: Date | null
}

/** Mirrors the anonymous override row inside `CreditView`. */
export interface CreditOverrideRowLike {
  readonly id: string
  readonly jobId: string | null
  readonly invoiceId: string | null
  readonly expiresOn: string | null
  readonly reason: string
  readonly approvedByEn: string
  readonly approvedByAr: string | null
  readonly approvedAt: Date
  readonly exposure: string
  readonly creditLimit: string
  readonly currency: string
}

/* -------------------------------------------------------------------------
 * Rate procurement — RFQ requests and the comparison of what came back (FR-RT-10)
 * ---------------------------------------------------------------------- */

/** One agent's request and reply, as the comparison panel reads it. */
export interface RateRequestView {
  readonly id: string
  readonly partnerId: string
  readonly partnerName: string
  readonly status:
    'sent' | 'responded' | 'parsed' | 'accepted' | 'declined' | 'expired' | 'superseded'
  readonly sentAt: Date | null
  readonly respondedAt: Date | null
  /** The broker's own figure, in their own currency. */
  readonly quotedTotal: string | null
  readonly quotedCurrency: string | null
  /**
   * The same figure converted to the branch's base currency for ranking, or
   * null where no FX rate is on file for the pair — in which case the reply is
   * shown but excluded from the cheapest comparison rather than mis-ranked.
   */
  readonly normalizedTotal: string | null
  readonly comparable: boolean
  /** Cheapest among the comparable, answered, non-declined replies. */
  readonly isCheapest: boolean
  /** Rate lines the model read that validated — what an accept would promote. */
  readonly lineCount: number
  /**
   * Lines the total could not price, so `quotedTotal` is partial and the reply
   * is left out of the cheapest comparison (F69).
   */
  readonly unpricedLines: number
  /** Set where the model read a lane that disagreed with the one we asked about. */
  readonly laneMismatch: string | null
  readonly declinedReason: string | null
  /** True when this reply is parsed, clean and not yet promoted to a card. */
  readonly canPromote: boolean
  /** The buy card this reply was promoted into, once accepted. */
  readonly rateCardId: string | null
}

export interface RateRequestsView {
  readonly baseCurrency: string
  readonly requests: readonly RateRequestView[]
  /** Requests sent, still awaiting a reply. */
  readonly awaiting: number
  /** Requests the agent replied to — responded, parsed, accepted or declined. */
  readonly answered: number
}

/** A rate-card renewal in flight — an RFQ the expiry sweep opened (FR-RT-11). */
export interface RenewalView {
  readonly id: string
  readonly partnerName: string
  /** `AEJEA → KWSWK`, from the expiring card's lane. */
  readonly lane: string
  readonly mode: string | null
  readonly status: 'sent' | 'responded' | 'parsed' | 'accepted' | 'declined' | 'expired'
  /** When the current rate lapses — the renewal deadline. */
  readonly oldValidTo: string | null
  readonly quotedTotal: string | null
  readonly quotedCurrency: string | null
  readonly lineCount: number
  readonly declinedReason: string | null
  readonly canPromote: boolean
}

/** An agent that covers the enquiry's lane, offered in the request-rates picker. */
export interface CoveringAgent {
  readonly partnerId: string
  readonly name: string
  readonly type: string
  readonly transitDays: number | null
  /** A primary contact with an email is a place an RFQ can actually go. */
  readonly hasEmail: boolean
  /** An RFQ is already out to this agent for this enquiry. */
  readonly alreadyRequested: boolean
}
