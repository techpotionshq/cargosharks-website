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

export interface MilestoneView {
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly plannedAt: Date | null
  readonly revisedAt: Date | null
  readonly actualAt: Date | null
  readonly note?: string | null
}

export interface ContainerView {
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
  readonly customerReference: string | null
  readonly masterBillNumber: string | null
  readonly houseBillNumber: string | null
  readonly bookingNumber: string | null
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
  readonly carrier: string
  readonly service: string
  readonly transitDays: number
  readonly buy: Money
  readonly sell: Money
  readonly marginPct: number
  readonly validUntil: Date
  readonly isRecommended: boolean
  readonly lines: readonly QuoteLineView[]
}

export interface QuoteLineView {
  readonly chargeCode: string
  readonly nameEn: string
  readonly nameAr: string
  readonly basis: string
  readonly quantity: number
  readonly buyRate: number
  readonly sellRate: number
  readonly amount: Money
}

export interface QuoteComparison {
  readonly enquiryReference: string
  readonly customerName: string
  readonly lane: string
  readonly mode: Mode
  readonly containerType: string | null
  readonly incoterm: string
  readonly preparedBy: string
  readonly pricedAt: Date
  /** How long the same enquiry took by hand — Moment 2's punchline. */
  readonly manualTurnaroundHours: number
  readonly pricingMs: number
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
    readonly quotedValue: Money
    readonly medianResponseMinutes: number
  }
  readonly clocks: {
    readonly running: number
    readonly accruing: Money
    readonly containersAtRisk: number
  }
  readonly exceptions: readonly ExceptionView[]
  readonly slaWatch: readonly EnquirySummary[]
  readonly arrivals: readonly JobSummary[]
  readonly topLanes: readonly { lane: string; count: number; value: Money }[]
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
