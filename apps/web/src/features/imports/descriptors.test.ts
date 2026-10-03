/**
 * The real sheets — `FR-MD-11`, `FR-RT-09`.
 *
 * `@qabandi/core/import` is tested against fixture descriptors; this file
 * tests the five descriptors the product actually ships. The failures it
 * exists to catch are the ones that cannot happen in the engine and are
 * invisible in review:
 *
 *   - two fields publishing the same column heading, or one field's alias
 *     colliding with another field's heading — on a client's own file that is
 *     how a column silently binds to the wrong thing;
 *   - a synonym table that has drifted from the database enum it feeds;
 *   - a cross-field rule that admits a row the rating engine cannot price.
 *
 * Note what is deliberately *not* asserted: that the generated template maps
 * back onto its own descriptor. That check looks meaningful and is vacuous —
 * the template emits exactly one heading per field, in field order, so a
 * greedy mapper can always satisfy it. The collisions below are asserted
 * against the definitions directly instead.
 *
 * No database: the reference sets are supplied the same way the server
 * supplies them, which is the whole reason they are parameters.
 */

import { describe, expect, it } from 'vitest'
import { groupRateCards, readImport, templateCsv, type RateRowValues } from '@qabandi/core/import'
import {
  IMPORT_KINDS,
  customerContactDescriptor,
  customerDescriptor,
  locationDescriptor,
  openJobDescriptor,
  openReceivableDescriptor,
  partnerDescriptor,
  rateCardDescriptor,
  type ImportCheckCode,
} from './descriptors'

const lookups = {
  countries: new Set(['KW', 'AE', 'QA', 'SA', 'IN', 'CN']),
  currencies: new Set(['KWD', 'USD', 'AED', 'QAR', 'EUR']),
  locations: new Set(['AEJEA', 'KWSWK', 'KWSAA', 'QADOH', 'INNSA', 'CNSHA']),
  chargeTypes: new Set(['OCEAN', 'THC', 'DOC', 'BAF', 'CLEARANCE', 'HAULAGE', 'DEMURRAGE']),
}

const ALL = [
  customerDescriptor,
  customerContactDescriptor,
  partnerDescriptor,
  locationDescriptor,
  rateCardDescriptor,
  openJobDescriptor,
  openReceivableDescriptor,
]

/* ------------------------------------------------------------- the templates */

/** The same normalisation `autoMap` matches on. */
const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

describe('the column definitions cannot collide', () => {
  for (const descriptor of ALL) {
    it(`${descriptor.key}: no two fields publish the same heading`, () => {
      // Two identical headings produce two identical template columns, and on
      // a real file only one of them can ever bind.
      const labels = descriptor.fields.map((field) => norm(field.label))
      expect(new Set(labels).size, `duplicate heading in ${descriptor.key}`).toBe(labels.length)
    })

    it(`${descriptor.key}: no field's alias is another field's heading or key`, () => {
      // This is the collision that bites on a *client's* file rather than on
      // our template: a sheet headed "Name" must not be claimed by whichever
      // field happens to list it as an alias first.
      const owned = new Map<string, string>()
      for (const field of descriptor.fields) {
        owned.set(norm(field.label), field.key)
        owned.set(norm(field.key), field.key)
      }
      for (const field of descriptor.fields) {
        for (const alias of field.aliases ?? []) {
          const owner = owned.get(norm(alias))
          expect(
            owner === undefined || owner === field.key,
            `${descriptor.key}: "${alias}" on ${field.key} collides with ${owner}`,
          ).toBe(true)
        }
      }
    })

    it(`${descriptor.key}: no alias is repeated across fields`, () => {
      const seen = new Map<string, string>()
      for (const field of descriptor.fields) {
        for (const alias of field.aliases ?? []) {
          const previous = seen.get(norm(alias))
          expect(
            previous,
            `${descriptor.key}: "${alias}" on both ${previous} and ${field.key}`,
          ).toBeUndefined()
          seen.set(norm(alias), field.key)
        }
      }
    })

    it(`${descriptor.key}: marks exactly the required columns with a star`, () => {
      const required = descriptor.fields.filter((field) => field.required).length
      expect(templateCsv(descriptor).match(/\*/g)?.length ?? 0).toBe(required)
    })

    it(`${descriptor.key}: the template is a single heading row`, () => {
      const csv = templateCsv(descriptor)
      expect(csv.endsWith('\n')).toBe(true)
      expect(csv.trimEnd().split('\n')).toHaveLength(1)
    })
  }
})

describe('the registry', () => {
  it('covers every descriptor exactly once, each with a permission', () => {
    expect(IMPORT_KINDS).toHaveLength(ALL.length)
    expect(new Set(IMPORT_KINDS.map((k) => k.key)).size).toBe(ALL.length)
    for (const entry of IMPORT_KINDS) {
      expect(entry.permission).toMatch(/^[a-z]+(\.[a-z_]+)+$/)
      expect(entry.descriptor.key).toBe(entry.key)
    }
  })

  it('gates bulk creation on the same permission as creating one by hand', () => {
    const byKey = Object.fromEntries(IMPORT_KINDS.map((k) => [k.key, k.permission]))
    expect(byKey.customers).toBe('customer.write')
    expect(byKey['customer-contacts']).toBe('customer.write')
    expect(byKey.partners).toBe('partner.write')
    expect(byKey.locations).toBe('admin.reference.write')
    expect(byKey['rate-cards']).toBe('rate.card.write')
  })
})

/* ---------------------------------------------------------------- customers */

describe('the customer sheet', () => {
  const header =
    'Customer code,Legal name (English),Legal name (Arabic),Commercial registration,' +
    'Tax registration,Country,Payment terms (days),Credit limit,Credit currency,' +
    'Free time (days),Default Incoterm,Active\n'

  it('reads a filled row', () => {
    const report = readImport(
      `${header}AGL,Agility Logistics,أجيليتي للخدمات اللوجستية,CR-12345,,KW,45,25000.000,KWD,7,CIF,Yes\n`,
      customerDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({
      code: 'AGL',
      legalNameAr: 'أجيليتي للخدمات اللوجستية',
      countryCode: 'KW',
      paymentTermsDays: 45,
      creditLimit: '25000.000',
      freeTimeDays: 7,
      isActive: true,
    })
  })

  it('needs only the two starred columns', () => {
    const report = readImport(
      'Customer code,Legal name (English)\nKGL,Kuwait Gulf Link\n',
      customerDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(true)
    // The defaults the form would have applied apply here too.
    expect(report.rows[0]!.values).toMatchObject({ paymentTermsDays: 30, isActive: true })
  })

  it('accepts the headings a client is likely to already have', () => {
    const report = readImport(
      'Account Code,Customer Name,Country Code,Terms\nAGL,Agility,KW,60\n',
      customerDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({ code: 'AGL', paymentTermsDays: 60 })
  })

  it('rejects an unknown currency rather than storing it', () => {
    const report = readImport(
      'Customer code,Legal name (English),Credit currency\nAGL,Agility,XYZ\n',
      customerDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(false)
    expect(report.issues[0]).toMatchObject({
      code: 'unknownReference',
      values: { set: 'currencies', value: 'XYZ' },
      label: 'Credit currency',
    })
  })
})

/* ----------------------------------------------------------------- partners */

describe('the partner sheet', () => {
  it('maps the words a forwarder writes onto the partner_type enum', () => {
    const report = readImport(
      'Partner code,Type,Legal name (English)\n' +
        'MSC,Shipping Line,MSC\n' +
        'ALX,Overseas Agent,Alexandria Freight\n' +
        'TRK,Transporter,Gulf Trucking\n' +
        'CLR,Clearing Agent,Fast Clearance\n',
      partnerDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows.map((row) => row.values.type)).toEqual([
      'carrier',
      'agent',
      'haulier',
      'broker',
    ])
  })

  it('refuses a type that is not in the enum', () => {
    const report = readImport(
      'Partner code,Type,Legal name (English)\nXX,Consultant,Someone\n',
      partnerDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(false)
    expect(report.issues[0]!.code).toBe('notOneOf')
    expect(report.issues[0]!.values?.options).toContain('agent')
  })
})

/* ---------------------------------------------------------------- locations */

describe('the location sheet', () => {
  it('reads ports, airports and border posts', () => {
    const report = readImport(
      'UN/LOCODE,Name (English),Country,Kind\n' +
        'KWSWK,Shuwaikh,KW,Port\n' +
        'KWKWI,Kuwait International,KW,Airport\n' +
        'KWABD,Abdali,KW,Land Border\n',
      locationDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows.map((row) => row.values.kind)).toEqual(['seaport', 'airport', 'border'])
  })

  it('requires a country, because a port with no country routes nothing', () => {
    const report = readImport(
      'UN/LOCODE,Name (English),Kind\nKWSWK,Shuwaikh,Port\n',
      locationDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(false)
    expect(report.missingRequired).toContain('countryCode')
  })
})

/* --------------------------------------------------------------- rate cards */

describe('the rate card sheet', () => {
  const header =
    'Mode,Origin,Destination,Currency,Valid from,Valid to,Charge,Basis,Rate,Minimum,Maximum,Container,Transit days,Notes\n'

  it('reads a realistic agent tariff', () => {
    const report = readImport(
      header +
        'FCL,AEJEA,KWSWK,USD,01/03/2026,31/03/2026,OCEAN,Per Container,"$1,250.00",,,40HC,18,Weekly\n' +
        'FCL,AEJEA,KWSWK,USD,01/03/2026,31/03/2026,THC,Per Container,120,,,40HC,,\n' +
        'LCL,INNSA,KWSWK,USD,01/03/2026,,OCEAN,Per W/M,45.500,75,,,22,\n',
      rateCardDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.rows[0]!.values).toMatchObject({
      mode: 'sea_fcl',
      basis: 'per_container',
      rate: '1250.00',
      validFrom: '2026-03-01',
      validTo: '2026-03-31',
      transitDays: 18,
    })
    // A W/M rate is the revenue ton, not a per-package rate (N1).
    expect(report.rows[2]!.values).toMatchObject({
      mode: 'sea_lcl',
      basis: 'per_wm',
      rate: '45.500',
      minimum: '75',
      validTo: null,
    })
  })

  it('rejects a lane whose port is not in the location master', () => {
    // FR-MD-08: origin and destination are chosen from the master, never free
    // text — and that has to hold for an imported tariff too.
    const report = readImport(
      header + 'FCL,ZZZZZ,KWSWK,USD,01/03/2026,,OCEAN,Per Container,850,,,40HC,,\n',
      rateCardDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(false)
    expect(report.issues[0]).toMatchObject({
      code: 'unknownReference',
      values: { set: 'locations' },
    })
  })

  it('rejects a charge type the catalogue does not have', () => {
    const report = readImport(
      header + 'FCL,AEJEA,KWSWK,USD,01/03/2026,,MYSTERY,Per Container,850,,,40HC,,\n',
      rateCardDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(false)
    expect(report.issues[0]).toMatchObject({
      code: 'unknownReference',
      values: { set: 'chargeTypes' },
    })
  })

  it('composes end to end: a multi-lane tariff becomes cards and lines', () => {
    // The closest thing to the real path without a database — the shape the
    // write step in `actions.ts` iterates over. Everything above tests one
    // stage; this tests that they fit together.
    const report = readImport<RateRowValues, ImportCheckCode>(
      header +
        'FCL,AEJEA,KWSWK,USD,01/03/2026,31/03/2026,OCEAN,Per Container,850,,,40HC,18,Weekly service\n' +
        'FCL,AEJEA,KWSWK,USD,01/03/2026,31/03/2026,THC,Per Container,120,,,40HC,,\n' +
        'FCL,AEJEA,KWSWK,USD,01/03/2026,31/03/2026,DOC,Lump Sum,45,,,,,\n' +
        'FCL,AEJEA,QADOH,USD,01/03/2026,31/03/2026,OCEAN,Per Container,700,,,40HC,12,\n' +
        'FCL,AEJEA,QADOH,USD,01/03/2026,31/03/2026,THC,Per Container,95,,,40HC,,\n' +
        'LCL,INNSA,KWSWK,USD,01/04/2026,,OCEAN,Per W/M,45.50,75,,,22,\n',
      rateCardDescriptor,
      { lookups },
    )
    expect(report.ok).toBe(true)
    expect(report.totalRows).toBe(6)

    const cards = groupRateCards(report.rows)

    // Three lanes, not six rows.
    expect(cards).toHaveLength(3)
    expect(cards.map((card) => card.lines.length)).toEqual([3, 2, 1])

    const [jebelAliShuwaikh] = cards
    expect(jebelAliShuwaikh).toMatchObject({
      mode: 'sea_fcl',
      originCode: 'AEJEA',
      destinationCode: 'KWSWK',
      currency: 'USD',
      validFrom: '2026-03-01',
      validTo: '2026-03-31',
      transitDays: 18,
      notes: 'Weekly service',
    })
    expect(jebelAliShuwaikh!.lines.map((line) => [line.chargeCode, line.rate])).toEqual([
      ['OCEAN', '850'],
      ['THC', '120'],
      ['DOC', '45'],
    ])

    // Every line keeps the file line it came from, so a database rejection can
    // still be reported against the row the operator has to fix.
    expect(cards.flatMap((card) => card.lines.map((line) => line.line))).toEqual([2, 3, 4, 5, 6, 7])

    // Each card's key is unique — the temporal WITHOUT OVERLAPS constraint on
    // rate_cards would reject a duplicate, and it must never see one from here.
    expect(new Set(cards.map((card) => card.key)).size).toBe(cards.length)
  })

  describe('the cross-field checks', () => {
    const row = (overrides: Partial<Record<string, string>> = {}): string => {
      const base: Record<string, string> = {
        mode: 'FCL',
        origin: 'AEJEA',
        destination: 'KWSWK',
        currency: 'USD',
        validFrom: '01/03/2026',
        validTo: '',
        charge: 'OCEAN',
        basis: 'Per Container',
        rate: '850',
        minimum: '',
        maximum: '',
        container: '40HC',
        transit: '',
        notes: '',
      }
      const merged = { ...base, ...overrides }
      return `${Object.values(merged).join(',')}\n`
    }

    const check = (csv: string) => readImport(header + csv, rateCardDescriptor, { lookups })

    it('accepts the baseline row', () => {
      expect(check(row()).ok).toBe(true)
    })

    it('rejects a validity window that ends before it starts', () => {
      const report = check(row({ validFrom: '01/03/2026', validTo: '01/02/2026' }))
      expect(report.ok).toBe(false)
      expect(report.issues[0]!.code).toBe('validToBeforeFrom')
    })

    it('rejects a maximum below the minimum', () => {
      const report = check(row({ minimum: '500', maximum: '100' }))
      expect(report.ok).toBe(false)
      expect(report.issues[0]!.code).toBe('maximumBelowMinimum')
    })

    it('rejects a per-container rate with no container type', () => {
      // It would price nothing: the rating engine has no equipment to match.
      const report = check(row({ container: '' }))
      expect(report.ok).toBe(false)
      expect(report.issues[0]!.code).toBe('containerTypeNeeded')
    })

    it('rejects a zero rate with no minimum', () => {
      const report = check(row({ rate: '0' }))
      expect(report.ok).toBe(false)
      expect(report.issues[0]!.code).toBe('zeroRateNeedsMinimum')
    })

    it('allows a zero rate that carries a minimum', () => {
      expect(check(row({ rate: '0', minimum: '50' })).ok).toBe(true)
    })

    it('allows a non-container basis with no container type', () => {
      expect(check(row({ basis: 'Per Kg', container: '' })).ok).toBe(true)
    })
  })
})

/* --------------------------------------------------------------- the cutover */

/**
 * The two sheets that decide whether go-live is a date or a gradual migration.
 *
 * Their cross-field checks are the point. Every per-cell rule here is ordinary
 * — a date is a date, an amount is an amount — and the defects that actually
 * arrive in a handover sheet are all relationships between cells: dates in the
 * wrong two columns, a total that does not foot, an invoice that is already
 * paid sitting in a file of unpaid ones.
 */

const cutoverLookups = {
  ...lookups,
  incoterms: new Set(['CIF', 'FOB', 'EXW', 'DAP', 'CFR']),
}

const jobSheet = (rows: string): string =>
  ['Job reference,Customer code,Status,Mode,Direction,ETD,ETA', rows].join('\n')

describe('open jobs', () => {
  it('accepts a shipment on the water', () => {
    const report = readImport(
      jobSheet('KWI-2024-0912,AGL,on water,FCL,import,2026-08-01,2026-08-21'),
      openJobDescriptor,
      { lookups: cutoverLookups, existing: {} },
    )
    expect(report.issues).toEqual([])
    expect(report.ok).toBe(true)
    // "on water" is not a status anyone stores; it is what an operations team
    // writes, and the synonym table is what makes the file import on line 2.
    expect(report.rows[0]!.values.status).toBe('in_transit')
  })

  /**
   * The most common defect in a hand-assembled handover sheet: the ETD and ETA
   * columns sit next to each other and half the rows get filled by dragging.
   * Neither date is wrong on its own, so only a row-level check sees it.
   */
  it('rejects an arrival before its departure', () => {
    const report = readImport(
      jobSheet('KWI-2024-0913,AGL,in transit,FCL,import,2026-08-21,2026-08-01'),
      openJobDescriptor,
      { lookups: cutoverLookups, existing: {} },
    )
    expect(report.ok).toBe(false)
    expect(report.issues[0]!.code).toBe('etaBeforeEtd')
  })

  /**
   * A migration is never run once — it is run against a copy, corrected, and
   * run again. The second run must refuse what the first one created rather
   * than producing a duplicate board.
   */
  it('refuses a reference already in the system', () => {
    const report = readImport(
      jobSheet('KWI-2024-0912,AGL,in transit,FCL,import,2026-08-01,2026-08-21'),
      openJobDescriptor,
      { lookups: cutoverLookups, existing: { reference: new Set(['KWI-2024-0912']) } },
    )
    expect(report.ok).toBe(false)
  })

  /** Closed and cancelled shipments belong in the retired system's archive. */
  it('refuses a status that is not an open one', () => {
    for (const status of ['completed', 'closed', 'cancelled', 'draft']) {
      const report = readImport(
        jobSheet(`KWI-2024-1000,AGL,${status},FCL,import,2026-08-01,2026-08-21`),
        openJobDescriptor,
        { lookups: cutoverLookups, existing: {} },
      )
      expect(report.ok, `${status} was accepted as an open job`).toBe(false)
    }
  })
})

const arSheet = (rows: string): string =>
  [
    'Invoice number,Customer code,Currency,Issue date,Net amount,Tax amount,Gross total,Amount received',
    rows,
  ].join('\n')

describe('open receivables', () => {
  it('accepts a wholly unpaid invoice', () => {
    const report = readImport(
      arSheet('INV-10231,AGL,KWD,2026-06-30,1284.500,0,1284.500,0'),
      openReceivableDescriptor,
      { lookups: cutoverLookups, existing: {} },
    )
    expect(report.issues).toEqual([])
    expect(report.rows[0]!.values.total).toBe('1284.500')
  })

  it('accepts a part payment', () => {
    const report = readImport(
      arSheet('INV-10232,AGL,KWD,2026-06-30,1000.000,0,1000.000,400.000'),
      openReceivableDescriptor,
      { lookups: cutoverLookups, existing: {} },
    )
    expect(report.ok).toBe(true)
  })

  /** A sheet exported with tax in a column nobody added into the total. */
  it('rejects a total that does not foot', () => {
    const report = readImport(
      arSheet('INV-10233,AGL,AED,2026-06-30,1000.00,50.00,1000.00,0'),
      openReceivableDescriptor,
      { lookups: cutoverLookups, existing: {} },
    )
    expect(report.ok).toBe(false)
    // The figures as typed, not as a JS number reprints them — '1000.00', not 1000.
    expect(report.issues[0]).toMatchObject({
      code: 'totalMismatch',
      values: { net: '1000.00', tax: '50.00', total: '1000.00' },
    })
  })

  /** A settled invoice is not an open receivable, and imports as noise. */
  it('rejects an invoice with nothing outstanding', () => {
    const report = readImport(
      arSheet('INV-10234,AGL,KWD,2026-06-30,500.000,0,500.000,500.000'),
      openReceivableDescriptor,
      { lookups: cutoverLookups, existing: {} },
    )
    expect(report.ok).toBe(false)
    expect(report.issues[0]!.code).toBe('nothingOutstanding')
  })

  /** An overpayment is a credit note nobody raised, not a negative balance. */
  it('rejects a receipt larger than the invoice', () => {
    const report = readImport(
      arSheet('INV-10235,AGL,KWD,2026-06-30,500.000,0,500.000,600.000'),
      openReceivableDescriptor,
      { lookups: cutoverLookups, existing: {} },
    )
    expect(report.ok).toBe(false)
    expect(report.issues[0]).toMatchObject({
      code: 'overpaid',
      values: { paid: '600.000', total: '500.000' },
    })
  })

  /**
   * KWD carries three decimals. The tolerance in the footing check is half a
   * fils, so a sheet rounded per line still foots — but a genuine discrepancy
   * of one fils does not pass.
   */
  it('holds the footing check to KWD precision', () => {
    const oneFilsOut = readImport(
      arSheet('INV-10236,AGL,KWD,2026-06-30,1000.000,0,1000.001,0'),
      openReceivableDescriptor,
      { lookups: cutoverLookups, existing: {} },
    )
    expect(oneFilsOut.ok, 'a one-fils discrepancy was accepted').toBe(false)
  })
})
