/**
 * What each importable sheet looks like — `FR-MD-11`, `FR-RT-09`.
 *
 * The engine in `@qabandi/core/import` knows how to read delimited text and
 * report on it; these descriptors say what the columns mean. They are the only
 * place a column heading appears, which is what lets `templateCsv` generate
 * the published template from the same definition the validator uses — a
 * field added here cannot be missing from the file people download.
 *
 * Nothing here restates a database column's type. The parsers add only what
 * the column definition cannot express: that a code is uppercase and
 * hyphen-safe, that a country exists in the reference table, that a validity
 * window does not end before it starts.
 */

import {
  boolean,
  code,
  decimal,
  email,
  integer,
  isoDate,
  lookup,
  oneOf,
  optional,
  phone,
  text,
  withDefault,
  type ImportDescriptor as EngineDescriptor,
  type IssueDetail,
} from '@qabandi/core/import'

/**
 * What the cross-field checks below can say, as codes.
 *
 * The engine reports its own problems as codes and leaves the wording to the
 * screen; these are the sheet-specific ones, in the same form, so the console
 * translates every line of a report the same way. A closed union because
 * `issue-messages.ts` switches over it exhaustively — a check added here that
 * the screen cannot word fails the typecheck rather than rendering a code.
 */
export type ImportCheckCode =
  | 'validToBeforeFrom'
  | 'maximumBelowMinimum'
  | 'containerTypeNeeded'
  | 'zeroRateNeedsMinimum'
  | 'etaBeforeEtd'
  | 'totalMismatch'
  | 'overpaid'
  | 'nothingOutstanding'

type ImportDescriptor = EngineDescriptor<ImportCheckCode>

/**
 * The modes an agent writes in a tariff, mapped to `transport_mode`.
 *
 * The synonyms are not decoration: no agent in the Gulf writes `sea_fcl` in a
 * spreadsheet, and rejecting "FCL" would fail every real file on line 2.
 */
const MODE_SYNONYMS = {
  fcl: 'sea_fcl',
  oceanfcl: 'sea_fcl',
  seafreightfcl: 'sea_fcl',
  ocean: 'sea_fcl',
  sea: 'sea_fcl',
  lcl: 'sea_lcl',
  oceanlcl: 'sea_lcl',
  groupage: 'sea_lcl',
  consol: 'sea_lcl',
  airfreight: 'air',
  awb: 'air',
  road: 'land',
  truck: 'land',
  trucking: 'land',
  land: 'land',
} as const

const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const

const PARTNER_TYPES = ['agent', 'haulier', 'carrier', 'broker', 'terminal'] as const

const LOCATION_KINDS = ['seaport', 'airport', 'inland', 'warehouse', 'border', 'city'] as const

const BASES = ['flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent'] as const

/** Names used on a real tariff for each basis. */
const BASIS_SYNONYMS = {
  percontainer: 'per_container',
  percntr: 'per_container',
  perbox: 'per_container',
  perteu: 'per_container',
  perkg: 'per_kg',
  perkilo: 'per_kg',
  perkilogram: 'per_kg',
  perton: 'per_kg',
  perwm: 'per_unit',
  percbm: 'per_unit',
  perunit: 'per_unit',
  perday: 'per_day',
  lumpsum: 'flat',
  lump: 'flat',
  fixed: 'flat',
  flatrate: 'flat',
  percentage: 'percent',
} as const

const nameEn = text({ min: 2, max: 200 })
const country = lookup('countries', { label: 'country', length: 2 })
const currency = lookup('currencies', { label: 'currency', length: 3 })

/* -------------------------------------------------------------------- FR-MD */

export const customerDescriptor: ImportDescriptor = {
  key: 'customers',
  label: 'Customers',
  fields: [
    {
      key: 'code',
      label: 'Customer code',
      required: true,
      unique: true,
      aliases: ['code', 'account', 'account code', 'customer no', 'customer number'],
      parse: code(),
      hint: 'Short unique key, e.g. AGL',
    },
    {
      key: 'legalNameEn',
      label: 'Legal name (English)',
      required: true,
      aliases: ['name', 'customer name', 'legal name', 'company', 'company name'],
      parse: nameEn,
    },
    {
      key: 'legalNameAr',
      label: 'Legal name (Arabic)',
      required: false,
      aliases: ['arabic name', 'name ar'],
      parse: optional(text({ max: 200 })),
      hint: 'Rendered on Arabic documents',
    },
    {
      key: 'registration',
      label: 'Commercial registration',
      required: false,
      aliases: ['cr', 'cr number', 'registration number'],
      parse: optional(text({ max: 100 })),
    },
    {
      key: 'taxRegistration',
      label: 'Tax registration',
      required: false,
      aliases: ['trn', 'vat number', 'tax number'],
      parse: optional(text({ max: 100 })),
    },
    {
      key: 'countryCode',
      label: 'Country',
      required: false,
      aliases: ['country code', 'iso country'],
      parse: optional(country),
      hint: 'Two-letter code, e.g. KW',
    },
    {
      key: 'paymentTermsDays',
      label: 'Payment terms (days)',
      required: false,
      aliases: ['terms', 'credit days', 'payment days'],
      parse: withDefault(integer({ min: 0, max: 365 }), 30),
    },
    {
      key: 'creditLimit',
      label: 'Credit limit',
      required: false,
      aliases: ['limit', 'credit'],
      parse: optional(decimal()),
    },
    {
      key: 'creditCurrency',
      label: 'Credit currency',
      required: false,
      parse: optional(currency),
    },
    {
      key: 'freeTimeDays',
      label: 'Free time (days)',
      required: false,
      aliases: ['free days', 'free time'],
      parse: optional(integer({ min: 0, max: 120 })),
    },
    {
      key: 'defaultIncoterm',
      label: 'Default Incoterm',
      required: false,
      aliases: ['incoterm', 'terms of delivery'],
      parse: optional(text({ max: 20 })),
    },
    {
      key: 'isActive',
      label: 'Active',
      required: false,
      aliases: ['status'],
      parse: boolean({ default: true }),
    },
  ],
}

export const customerContactDescriptor: ImportDescriptor = {
  key: 'customer-contacts',
  label: 'Customer contacts',
  fields: [
    {
      key: 'customerCode',
      label: 'Customer code',
      required: true,
      aliases: ['code', 'account', 'customer'],
      parse: code(),
      hint: 'Must already exist, or be in the customer file imported first',
    },
    {
      key: 'nameEn',
      label: 'Contact name',
      required: true,
      aliases: ['name', 'contact', 'person'],
      parse: nameEn,
    },
    {
      key: 'nameAr',
      label: 'Contact name (Arabic)',
      required: false,
      parse: optional(text({ max: 200 })),
    },
    {
      key: 'email',
      label: 'Email',
      required: false,
      aliases: ['e-mail', 'mail'],
      parse: optional(email),
    },
    {
      key: 'phone',
      label: 'Phone',
      required: false,
      aliases: ['mobile', 'telephone', 'tel'],
      parse: optional(phone),
    },
    {
      key: 'role',
      label: 'Role',
      required: false,
      aliases: ['title', 'position', 'job title'],
      parse: optional(text({ max: 100 })),
    },
    {
      key: 'isPrimary',
      label: 'Primary contact',
      required: false,
      aliases: ['primary', 'main'],
      parse: boolean({ default: false }),
    },
  ],
}

/**
 * Agents, hauliers, carriers, brokers and terminals in one sheet.
 *
 * `FR-MD-11` names agents and hauliers separately, but they are one table
 * distinguished by `partner_type`. One descriptor with a Type column beats
 * three near-identical templates a user has to choose between.
 */
export const partnerDescriptor: ImportDescriptor = {
  key: 'partners',
  label: 'Agents, hauliers and carriers',
  fields: [
    {
      key: 'code',
      label: 'Partner code',
      required: true,
      unique: true,
      aliases: ['code', 'agent code', 'supplier code'],
      parse: code(),
    },
    {
      key: 'type',
      label: 'Type',
      required: true,
      aliases: ['partner type', 'category'],
      parse: oneOf(PARTNER_TYPES, {
        overseasagent: 'agent',
        forwarder: 'agent',
        transporter: 'haulier',
        trucker: 'haulier',
        shippingline: 'carrier',
        airline: 'carrier',
        line: 'carrier',
        customsbroker: 'broker',
        clearingagent: 'broker',
        port: 'terminal',
        depot: 'terminal',
      }),
      hint: PARTNER_TYPES.join(', '),
    },
    {
      key: 'legalNameEn',
      label: 'Legal name (English)',
      required: true,
      aliases: ['name', 'company', 'company name', 'agent name'],
      parse: nameEn,
    },
    {
      key: 'legalNameAr',
      label: 'Legal name (Arabic)',
      required: false,
      aliases: ['arabic name'],
      parse: optional(text({ max: 200 })),
    },
    {
      key: 'countryCode',
      label: 'Country',
      required: false,
      aliases: ['country code'],
      parse: optional(country),
    },
    {
      key: 'currency',
      label: 'Currency',
      required: false,
      aliases: ['settlement currency', 'ccy'],
      parse: optional(currency),
    },
    {
      key: 'paymentTermsDays',
      label: 'Payment terms (days)',
      required: false,
      aliases: ['terms', 'credit days'],
      parse: optional(integer({ min: 0, max: 365 })),
    },
    {
      key: 'isActive',
      label: 'Active',
      required: false,
      aliases: ['status'],
      parse: boolean({ default: true }),
    },
  ],
}

export const locationDescriptor: ImportDescriptor = {
  key: 'locations',
  label: 'Ports and places',
  fields: [
    {
      key: 'unlocode',
      label: 'UN/LOCODE',
      required: true,
      unique: true,
      aliases: ['locode', 'un locode', 'port code', 'code'],
      parse: code({ min: 3, max: 5 }),
      hint: 'Five characters, e.g. KWSWK. IATA for airports.',
    },
    {
      key: 'nameEn',
      label: 'Name (English)',
      required: true,
      aliases: ['name', 'port', 'port name', 'place'],
      parse: nameEn,
    },
    {
      key: 'nameAr',
      label: 'Name (Arabic)',
      required: false,
      aliases: ['arabic name'],
      parse: optional(text({ max: 200 })),
    },
    {
      key: 'countryCode',
      label: 'Country',
      required: true,
      aliases: ['country code'],
      parse: country,
    },
    {
      key: 'kind',
      label: 'Kind',
      required: true,
      aliases: ['type', 'location type'],
      parse: oneOf(LOCATION_KINDS, {
        seaport: 'seaport',
        port: 'seaport',
        sea: 'seaport',
        air: 'airport',
        icd: 'inland',
        drydock: 'inland',
        depot: 'warehouse',
        cfs: 'warehouse',
        landborder: 'border',
        crossing: 'border',
      }),
      hint: LOCATION_KINDS.join(', '),
    },
    {
      key: 'isActive',
      label: 'Active',
      required: false,
      aliases: ['status'],
      parse: boolean({ default: true }),
    },
  ],
}

/* -------------------------------------------------------------------- FR-RT */

/**
 * An agent tariff, flattened to one row per charge.
 *
 * Grouping back into cards and lines happens in `groupRateCards`; the sheet
 * repeats the lane on every row because that is how every agent sends one.
 *
 * The cross-field check is the one error a per-cell parser cannot see, and it
 * is the one that matters: a card whose validity ends before it begins would
 * satisfy `FR-RT-01`'s date filter for exactly no enquiries, and would look
 * like missing coverage rather than a bad import.
 */
export const rateCardDescriptor: ImportDescriptor = {
  key: 'rate-cards',
  label: 'Rate cards',
  fields: [
    {
      key: 'mode',
      label: 'Mode',
      required: true,
      aliases: ['transport mode', 'service'],
      parse: oneOf(MODES, MODE_SYNONYMS),
      hint: 'FCL, LCL, air, land',
    },
    {
      key: 'originCode',
      label: 'Origin',
      required: true,
      aliases: ['pol', 'port of loading', 'from', 'origin port', 'load port'],
      parse: lookup('locations', { label: 'location' }),
      hint: 'UN/LOCODE, e.g. AEJEA',
    },
    {
      key: 'destinationCode',
      label: 'Destination',
      required: true,
      aliases: ['pod', 'port of discharge', 'to', 'destination port', 'disport'],
      parse: lookup('locations', { label: 'location' }),
    },
    {
      key: 'currency',
      label: 'Currency',
      required: true,
      aliases: ['ccy', 'cur'],
      parse: currency,
    },
    {
      key: 'validFrom',
      label: 'Valid from',
      required: true,
      aliases: ['from date', 'effective from', 'validity from', 'start'],
      parse: isoDate,
      hint: 'YYYY-MM-DD or DD/MM/YYYY',
    },
    {
      key: 'validTo',
      label: 'Valid to',
      required: false,
      aliases: ['to date', 'expiry', 'effective to', 'validity to', 'end'],
      parse: optional(isoDate),
      hint: 'Blank for open-ended',
    },
    {
      key: 'chargeCode',
      label: 'Charge',
      required: true,
      aliases: ['charge type', 'charge code', 'description', 'item'],
      parse: lookup('chargeTypes', { label: 'charge type' }),
      hint: 'Must match a charge type key',
    },
    {
      key: 'basis',
      label: 'Basis',
      required: true,
      aliases: ['calculation', 'per', 'unit'],
      parse: oneOf(BASES, BASIS_SYNONYMS),
      hint: BASES.join(', '),
    },
    {
      key: 'rate',
      label: 'Rate',
      required: true,
      aliases: ['amount', 'price', 'buy rate', 'sell rate', 'tariff'],
      parse: decimal(),
    },
    {
      key: 'minimum',
      label: 'Minimum',
      required: false,
      aliases: ['min', 'minimum charge', 'min charge'],
      parse: optional(decimal()),
    },
    {
      key: 'maximum',
      label: 'Maximum',
      required: false,
      aliases: ['max', 'maximum charge'],
      parse: optional(decimal()),
    },
    {
      key: 'containerType',
      label: 'Container',
      required: false,
      aliases: ['equipment', 'container type', 'size', 'size type'],
      parse: optional(text({ max: 10 })),
      hint: 'e.g. 20GP, 40HC — blank where the rate is not per container',
    },
    {
      key: 'transitDays',
      label: 'Transit days',
      required: false,
      aliases: ['transit', 'transit time', 'tt'],
      parse: optional(integer({ min: 0, max: 400 })),
    },
    {
      key: 'notes',
      label: 'Notes',
      required: false,
      aliases: ['remarks', 'comment'],
      parse: optional(text({ max: 500 })),
    },
  ],
  check: (row) => {
    const from = row.validFrom as string
    const to = row.validTo as string | null
    if (to !== null && to < from) {
      return { code: 'validToBeforeFrom', message: 'Valid to is before valid from.' }
    }

    const rate = row.rate as string
    const minimum = row.minimum as string | null
    const maximum = row.maximum as string | null
    if (minimum !== null && maximum !== null && Number(maximum) < Number(minimum)) {
      return { code: 'maximumBelowMinimum', message: 'Maximum is below minimum.' }
    }
    // A per-container rate with no equipment cannot be applied to a booking.
    if (row.basis === 'per_container' && row.containerType === null) {
      return {
        code: 'containerTypeNeeded',
        message: 'A per-container rate needs a container type.',
      }
    }
    if (rate === '0' && minimum === null) {
      return {
        code: 'zeroRateNeedsMinimum',
        message: 'A zero rate needs a minimum charge, or it prices nothing.',
      }
    }
    return null
  },
}

/* --------------------------------------------------------------- row shapes */

/**
 * What a validated row holds, per sheet.
 *
 * The engine returns `Record<string, unknown>` because it is generic over
 * descriptors; these are the assertions that turn it back into something the
 * insert statements can be typechecked against. They are hand-written and they
 * have to agree with the parsers above — which is why the enum-valued fields
 * are typed as the enum union rather than `string`, so a parser widened by
 * accident fails here rather than at the database.
 */
export interface CustomerRowValues {
  readonly code: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly registration: string | null
  readonly taxRegistration: string | null
  readonly countryCode: string | null
  readonly paymentTermsDays: number
  readonly creditLimit: string | null
  readonly creditCurrency: string | null
  readonly freeTimeDays: number | null
  readonly defaultIncoterm: string | null
  readonly isActive: boolean
}

export interface CustomerContactRowValues {
  readonly customerCode: string
  readonly nameEn: string
  readonly nameAr: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly role: string | null
  readonly isPrimary: boolean
}

export interface PartnerRowValues {
  readonly code: string
  readonly type: (typeof PARTNER_TYPES)[number]
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly countryCode: string | null
  readonly currency: string | null
  readonly paymentTermsDays: number | null
  readonly isActive: boolean
}

export interface LocationRowValues {
  readonly unlocode: string
  readonly nameEn: string
  readonly nameAr: string | null
  readonly countryCode: string
  readonly kind: (typeof LOCATION_KINDS)[number]
  readonly isActive: boolean
}

export type TransportMode = (typeof MODES)[number]
export type ChargeBasis = (typeof BASES)[number]

/* ------------------------------------------------------------------- cutover */

/*
  The two sheets a real cutover cannot happen without.

  Everything above this line migrates a customer's *reference* data — who they
  trade with, where, at what rate. That is the easy half, and it is the half a
  demonstration covers. The hard half is that nobody switches forwarding
  systems on a clean slate: on the Monday morning of go-live there are forty
  shipments on the water and three hundred thousand dinar of unpaid invoices,
  and a platform that cannot accept those is a platform that runs in parallel
  with the old one for a quarter.

  Both sheets are deliberately narrow. A job mid-passage does not need its
  quote history, and an open receivable does not need its line detail — it
  needs to age correctly and to accept a payment. Asking for more than that
  turns a two-day migration into a two-month reconciliation, and the extra
  fields are the ones nobody can source anyway.
*/

const JOB_STATUSES = ['booked', 'in_transit', 'arrived', 'customs', 'delivered', 'on_hold'] as const

/** What an operations team writes in a status column of a handover sheet. */
const JOB_STATUS_SYNONYMS = {
  open: 'in_transit',
  active: 'in_transit',
  onwater: 'in_transit',
  sailed: 'in_transit',
  intransit: 'in_transit',
  departed: 'in_transit',
  shipped: 'in_transit',
  confirmed: 'booked',
  booking: 'booked',
  atdestination: 'arrived',
  discharged: 'arrived',
  clearance: 'customs',
  customsclearance: 'customs',
  underclearance: 'customs',
  cleared: 'delivered',
  held: 'on_hold',
  hold: 'on_hold',
} as const

/**
 * Shipments in flight at cutover — the sheet that decides whether go-live is a
 * date or a gradual migration.
 *
 * `status` is constrained to the *open* states on purpose. `completed`,
 * `closed` and `cancelled` are excluded because a finished shipment has no
 * operational value in the new system and every one imported is a row someone
 * has to look past on the board for the next year. History belongs in the
 * archive of the system being retired, not in the register of the one
 * replacing it.
 *
 * `draft` is excluded for the opposite reason: a draft is work in progress in
 * a system nobody will open again, and it should be entered properly or not at
 * all.
 */
export const openJobDescriptor: ImportDescriptor = {
  key: 'open-jobs',
  label: 'Open jobs',
  fields: [
    {
      key: 'reference',
      label: 'Job reference',
      required: true,
      // `unique` is what puts the collision set to work — a migration run
      // twice must refuse the references the first pass created rather than
      // producing a duplicate board.
      unique: true,
      aliases: ['job no', 'job number', 'file', 'file no', 'shipment', 'shipment no', 'our ref'],
      parse: code({ max: 40 }),
      hint: 'The reference from the system being replaced — kept, not renumbered',
    },
    {
      key: 'customerCode',
      label: 'Customer code',
      required: true,
      aliases: ['customer', 'client', 'account', 'shipper'],
      parse: code({ max: 40 }),
      hint: 'Must already exist — import customers first',
    },
    {
      key: 'status',
      label: 'Status',
      required: true,
      aliases: ['stage', 'state', 'job status'],
      parse: oneOf(JOB_STATUSES, JOB_STATUS_SYNONYMS),
      hint: JOB_STATUSES.join(', '),
    },
    {
      key: 'mode',
      label: 'Mode',
      required: true,
      aliases: ['transport mode', 'service'],
      parse: oneOf(MODES, MODE_SYNONYMS),
      hint: 'FCL, LCL, air, land',
    },
    {
      key: 'tradeDirection',
      label: 'Direction',
      required: true,
      aliases: ['trade', 'import/export', 'type'],
      parse: oneOf(['import', 'export', 'cross_trade'] as const, {
        imp: 'import',
        exp: 'export',
        crosstrade: 'cross_trade',
        triangle: 'cross_trade',
      }),
    },
    {
      key: 'originCode',
      label: 'Origin',
      required: false,
      aliases: ['pol', 'port of loading', 'from', 'load port'],
      parse: optional(lookup('locations', { label: 'location' })),
      hint: 'UN/LOCODE',
    },
    {
      key: 'destinationCode',
      label: 'Destination',
      required: false,
      aliases: ['pod', 'port of discharge', 'to', 'disport'],
      parse: optional(lookup('locations', { label: 'location' })),
    },
    {
      key: 'masterBillNumber',
      label: 'Master bill',
      required: false,
      aliases: ['mbl', 'mawb', 'master awb', 'master b/l', 'obl'],
      parse: optional(text({ max: 60 })),
    },
    {
      key: 'houseBillNumber',
      label: 'House bill',
      required: false,
      aliases: ['hbl', 'hawb', 'house awb', 'house b/l'],
      parse: optional(text({ max: 60 })),
    },
    {
      key: 'bookingNumber',
      label: 'Booking',
      required: false,
      aliases: ['booking no', 'carrier booking'],
      parse: optional(text({ max: 60 })),
    },
    {
      key: 'vesselName',
      label: 'Vessel',
      required: false,
      aliases: ['ship', 'vessel name', 'carrier vessel'],
      parse: optional(text({ max: 120 })),
    },
    {
      key: 'voyageNumber',
      label: 'Voyage',
      required: false,
      aliases: ['voy', 'voyage no'],
      parse: optional(text({ max: 40 })),
    },
    {
      key: 'flightNumber',
      label: 'Flight',
      required: false,
      aliases: ['flt', 'flight no'],
      parse: optional(text({ max: 40 })),
    },
    {
      key: 'etd',
      label: 'ETD',
      required: false,
      aliases: ['departure', 'sailing', 'etd date', 'sailed on'],
      parse: optional(isoDate),
      hint: 'YYYY-MM-DD or DD/MM/YYYY',
    },
    {
      key: 'eta',
      label: 'ETA',
      required: false,
      aliases: ['arrival', 'eta date', 'due'],
      parse: optional(isoDate),
    },
    {
      key: 'customerReference',
      label: 'Customer reference',
      required: false,
      aliases: ['their ref', 'client ref', 'po', 'po number', 'order no'],
      parse: optional(text({ max: 80 })),
    },
    {
      key: 'incoterm',
      label: 'Incoterm',
      required: false,
      aliases: ['terms', 'delivery terms'],
      parse: optional(lookup('incoterms', { label: 'incoterm', length: 3 })),
    },
  ],
  /**
   * A shipment that arrived before it departed is a transposed pair of
   * columns, not a fact — and it is the single most common defect in a
   * hand-assembled handover sheet, because the two columns sit next to each
   * other and half the rows get filled by dragging.
   *
   * Caught here rather than per cell, because neither date is wrong alone.
   */
  check: (row) => {
    const etd = row.etd as string | null
    const eta = row.eta as string | null
    if (etd && eta && eta < etd) {
      return {
        code: 'etaBeforeEtd',
        message: 'ETA is before ETD — check the two columns are not swapped',
      }
    }
    return null
  },
}

const AR_TAX_TREATMENTS = [
  'out_of_scope',
  'zero_rated',
  'exempt',
  'standard',
  'reverse_charge',
] as const

/**
 * Unpaid invoices at cutover — the sheet that decides whether finance can
 * stop opening the old system.
 *
 * Modelled as an **opening balance**, not as a reconstructed invoice. Each row
 * carries what was billed and what has been received, and the difference is
 * what ages. Rebuilding the line detail of a two-year-old invoice is
 * archaeology: the charge types will not map, the FX rates are gone, and the
 * total — which is the only figure anyone will ever chase — is already known.
 *
 * `amountPaid` rather than an outstanding figure, because part-payment is
 * normal and the platform has to know both halves: `total` drives the customer
 * statement, the difference drives the ageing bucket, and an outstanding-only
 * sheet cannot produce the first.
 */
export const openReceivableDescriptor: ImportDescriptor = {
  key: 'open-receivables',
  label: 'Open receivables',
  fields: [
    {
      key: 'seriesNo',
      label: 'Invoice number',
      required: true,
      // Same reason as the job reference: the second run of a migration must
      // not re-import the balances the first one carried over.
      unique: true,
      aliases: ['invoice no', 'invoice', 'inv no', 'document no', 'number'],
      parse: code({ max: 40 }),
      hint: 'As issued by the system being replaced',
    },
    {
      key: 'customerCode',
      label: 'Customer code',
      required: true,
      aliases: ['customer', 'client', 'account', 'debtor'],
      parse: code({ max: 40 }),
    },
    {
      key: 'currency',
      label: 'Currency',
      required: true,
      aliases: ['ccy', 'cur'],
      parse: currency,
    },
    {
      key: 'issuedOn',
      label: 'Issue date',
      required: true,
      aliases: ['invoice date', 'date', 'issued'],
      parse: isoDate,
      hint: 'Drives the ageing bucket',
    },
    {
      key: 'dueOn',
      label: 'Due date',
      required: false,
      aliases: ['due', 'payment due', 'maturity'],
      parse: optional(isoDate),
      hint: 'Blank uses the customer payment terms',
    },
    {
      key: 'subtotal',
      label: 'Net amount',
      required: true,
      aliases: ['net', 'subtotal', 'amount before tax', 'goods value'],
      parse: decimal({ min: 0 }),
    },
    {
      key: 'taxAmount',
      label: 'Tax amount',
      required: false,
      aliases: ['vat', 'tax', 'vat amount'],
      parse: withDefault(decimal({ min: 0 }), '0'),
      hint: 'Zero in Kuwait — no VAT is in force',
    },
    {
      key: 'total',
      label: 'Gross total',
      required: true,
      aliases: ['total', 'gross', 'invoice total', 'amount'],
      parse: decimal({ min: 0 }),
    },
    {
      key: 'amountPaid',
      label: 'Amount received',
      required: false,
      aliases: ['paid', 'received', 'settled', 'payments'],
      parse: withDefault(decimal({ min: 0 }), '0'),
      hint: 'Blank or zero for a wholly unpaid invoice',
    },
    {
      key: 'taxTreatment',
      label: 'Tax treatment',
      required: false,
      aliases: ['vat treatment', 'tax code'],
      parse: withDefault(
        oneOf(AR_TAX_TREATMENTS, {
          none: 'out_of_scope',
          na: 'out_of_scope',
          outofscope: 'out_of_scope',
          zero: 'zero_rated',
          zerorated: 'zero_rated',
          std: 'standard',
          vat: 'standard',
          rc: 'reverse_charge',
        }),
        'out_of_scope',
      ),
      hint: AR_TAX_TREATMENTS.join(', '),
    },
    {
      key: 'jobReference',
      label: 'Job reference',
      required: false,
      aliases: ['job', 'file', 'shipment', 'job no'],
      parse: optional(code({ max: 40 })),
      hint: 'Optional — links the balance to an imported job',
    },
  ],
  /**
   * Three arithmetic checks, and each catches a different real defect.
   *
   * The first is a sheet exported with tax in a column nobody added in. The
   * second is an invoice that is already settled and does not belong in an
   * *open* receivables file at all. The third is an overpayment, which is a
   * credit note in the old system that was never issued in this one — real,
   * but not something to import silently as a negative balance.
   */
  check: (row): IssueDetail<ImportCheckCode> | null => {
    const subtotal = Number(row.subtotal as string)
    const tax = Number((row.taxAmount as string) ?? '0')
    const total = Number(row.total as string)
    const paid = Number((row.amountPaid as string) ?? '0')

    /*
      The figures in the report are the parsed strings, not the numbers the
      comparison used — `Number('100.000')` prints as `100`, and a Kuwaiti
      operator checking a three-decimal sheet should see the three decimals
      they typed (§11). The comparison itself stays as it was.
    */
    const shown = {
      net: row.subtotal as string,
      tax: (row.taxAmount as string) ?? '0',
      total: row.total as string,
      paid: (row.amountPaid as string) ?? '0',
    }

    // A tolerance of half a fils: KWD carries three decimals, and a sheet
    // rounded per line will not foot to the last place.
    if (Math.abs(subtotal + tax - total) > 0.0005) {
      return {
        code: 'totalMismatch',
        values: { net: shown.net, tax: shown.tax, total: shown.total },
        message: `Net ${shown.net} plus tax ${shown.tax} does not equal total ${shown.total}`,
      }
    }
    if (paid > total + 0.0005) {
      return {
        code: 'overpaid',
        values: { paid: shown.paid, total: shown.total },
        message: `Received ${shown.paid} exceeds the total ${shown.total} — raise a credit note instead`,
      }
    }
    if (Math.abs(total - paid) <= 0.0005) {
      return {
        code: 'nothingOutstanding',
        message:
          'Nothing outstanding — a settled invoice does not belong in an open receivables file',
      }
    }
    return null
  },
}

export interface OpenJobRowValues {
  readonly reference: string
  readonly customerCode: string
  readonly status: (typeof JOB_STATUSES)[number]
  readonly mode: TransportMode
  readonly tradeDirection: 'import' | 'export' | 'cross_trade'
  readonly originCode: string | null
  readonly destinationCode: string | null
  readonly masterBillNumber: string | null
  readonly houseBillNumber: string | null
  readonly bookingNumber: string | null
  readonly vesselName: string | null
  readonly voyageNumber: string | null
  readonly flightNumber: string | null
  readonly etd: string | null
  readonly eta: string | null
  readonly customerReference: string | null
  readonly incoterm: string | null
}

export interface OpenReceivableRowValues {
  readonly seriesNo: string
  readonly customerCode: string
  readonly currency: string
  readonly issuedOn: string
  readonly dueOn: string | null
  readonly subtotal: string
  readonly taxAmount: string
  readonly total: string
  readonly amountPaid: string
  readonly taxTreatment: (typeof AR_TAX_TREATMENTS)[number]
  readonly jobReference: string | null
}

/* ------------------------------------------------------------------ registry */

export const IMPORT_KINDS = [
  { key: 'customers', descriptor: customerDescriptor, permission: 'customer.write' },
  { key: 'customer-contacts', descriptor: customerContactDescriptor, permission: 'customer.write' },
  { key: 'partners', descriptor: partnerDescriptor, permission: 'partner.write' },
  { key: 'locations', descriptor: locationDescriptor, permission: 'admin.reference.write' },
  { key: 'rate-cards', descriptor: rateCardDescriptor, permission: 'rate.card.write' },
  /*
    The cutover pair, last because they are imported last: a job needs its
    customer, and a receivable may reference its job. The order of this list is
    the order of a migration.
  */
  { key: 'open-jobs', descriptor: openJobDescriptor, permission: 'job.read' },
  { key: 'open-receivables', descriptor: openReceivableDescriptor, permission: 'finance.export' },
] as const

export type ImportKind = (typeof IMPORT_KINDS)[number]['key']

export function importKind(key: string): (typeof IMPORT_KINDS)[number] | undefined {
  return IMPORT_KINDS.find((kind) => kind.key === key)
}

export function isImportKind(value: string): value is ImportKind {
  return IMPORT_KINDS.some((kind) => kind.key === value)
}

/**
 * Which sheets write a branch-scoped row, and therefore need a destination
 * chosen before the file means anything.
 *
 * Stated once because it was stated twice: the server action decided whether
 * to demand a branch, and the page decided whether to *offer* the selector,
 * from two independent expressions. Adding a sheet to one and not the other
 * gives a form with no branch field whose submit fails on a `not null`
 * violation at the end of a two-thousand-row transaction — a bug that only
 * appears on the largest file someone tries.
 */
export function importNeedsBranch(kind: ImportKind): boolean {
  return (
    kind === 'customers' ||
    kind === 'rate-cards' ||
    kind === 'open-jobs' ||
    kind === 'open-receivables'
  )
}
