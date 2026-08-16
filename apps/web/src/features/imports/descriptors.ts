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
  type ImportDescriptor,
} from '@qabandi/core/import'

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
    if (to !== null && to < from) return 'Valid to is before valid from.'

    const rate = row.rate as string
    const minimum = row.minimum as string | null
    const maximum = row.maximum as string | null
    if (minimum !== null && maximum !== null && Number(maximum) < Number(minimum)) {
      return 'Maximum is below minimum.'
    }
    // A per-container rate with no equipment cannot be applied to a booking.
    if (row.basis === 'per_container' && row.containerType === null) {
      return 'A per-container rate needs a container type.'
    }
    if (rate === '0' && minimum === null) {
      return 'A zero rate needs a minimum charge, or it prices nothing.'
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

/* ------------------------------------------------------------------ registry */

export const IMPORT_KINDS = [
  { key: 'customers', descriptor: customerDescriptor, permission: 'customer.write' },
  { key: 'customer-contacts', descriptor: customerContactDescriptor, permission: 'customer.write' },
  { key: 'partners', descriptor: partnerDescriptor, permission: 'partner.write' },
  { key: 'locations', descriptor: locationDescriptor, permission: 'admin.reference.write' },
  { key: 'rate-cards', descriptor: rateCardDescriptor, permission: 'rate.card.write' },
] as const

export type ImportKind = (typeof IMPORT_KINDS)[number]['key']

export function importKind(key: string): (typeof IMPORT_KINDS)[number] | undefined {
  return IMPORT_KINDS.find((kind) => kind.key === key)
}

export function isImportKind(value: string): value is ImportKind {
  return IMPORT_KINDS.some((kind) => kind.key === value)
}
