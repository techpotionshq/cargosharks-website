/**
 * The half of document generation that touches the database.
 *
 * `job-documents.test.ts` covers the templates as pure functions of a view.
 * This covers the other side: assembling that view out of eight tables, and
 * storing what came out. The templates can be wrong in ways a reader notices —
 * a heading in the wrong place. These loaders are wrong in ways nobody
 * notices, because a bill of lading with the consignee's *city* missing still
 * looks exactly like a bill of lading.
 *
 * Three things here are load-bearing and none of them are obvious:
 *
 * **The freight term is derived, not stored.** Prepaid or collect is the same
 * fact as whether we raised a revenue line on the job, so it is read back from
 * `charge_lines` rather than kept as a flag that is free to drift. That makes
 * "add a cost line to an import" quietly change what the bill of lading says,
 * which is correct and worth pinning down.
 *
 * **A stored chargeable weight always wins.** The number on the waybill has to
 * be the number the rate was applied against; a document that derives its own
 * is a document that disagrees with the invoice stapled to it.
 *
 * **Storing is versioned, never overwritten.** A corrected bill of lading is a
 * new original with the old one recalled — in the trade as much as in this
 * table — so the test that matters is that version 1 is still there, and
 * marked superseded, after version 2 is written.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

/** Chromium is the renderer's job and is verified by looking at a PDF. */
const printer = vi.hoisted(() => ({
  calls: [] as { html: string; locale: string }[],
}))

vi.mock('./renderer', () => ({
  createRenderer: () => ({
    render: async (request: { html: string; locale: string }) => {
      printer.calls.push({ html: request.html, locale: request.locale })
      return Buffer.from(`%PDF-1.7 ${request.html.length}`)
    },
    close: async () => {},
  }),
}))

const bucket = vi.hoisted(() => ({
  puts: [] as { key: string; bytes: number; contentType: string }[],
  fail: false,
}))

/**
 * The stub bucket, offered under both names the code has used for it.
 *
 * `pdf/store.ts` reads storage as `await fileStore()` — the resolver became a
 * query when object storage moved into `integration_settings`, so a key
 * pasted at 09:05 works at 09:06. This mock still only answered the older
 * synchronous `adapters().fileStore`, so every "storing what was issued" case
 * called `undefined()` and reported it as a storage fault — eight failures
 * whose names said nothing about a mock. `internal-handlers.test.ts` had the
 * identical rot and the identical fix.
 */
const bucketStub = {
  key: 'memory',
  put: async (key: string, body: Buffer, contentType: string) => {
    if (bucket.fail) throw new Error('bucket unreachable')
    bucket.puts.push({ key, bytes: body.byteLength, contentType })
    return { storageKey: key, byteSize: body.byteLength, checksum: `sha-${body.byteLength}` }
  },
  get: async () => Buffer.alloc(0),
  signedUrl: async () => 'https://storage.test/x',
  retire: async () => {},
}

vi.mock('../adapters/index', () => ({
  fileStore: async () => bucketStub,
  adapters: () => ({ fileStore: bucketStub }),
}))

const {
  assets,
  branches,
  chargeLines,
  chargeTypes,
  chargeableRules,
  consolidations,
  customers,
  customsStages,
  documentTypes,
  documents,
  dutyRates,
  equipment,
  jobCargo,
  jobMilestones,
  jobParties,
  jobs,
  locations,
  partners,
  principals,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const {
  loadConsolidationDocumentView,
  loadCustomsPackView,
  loadJobDocumentView,
  renderJobDocumentPdf,
  renderManifestPdf,
} = await import('./job-documents')
const { storeJobDocument, storageKeyFor } = await import('./store')
const { DocumentNotFoundError } = await import('./documents')

const BRANCH = '00000000-0000-7000-8000-00000000db01'
const CUSTOMER = '00000000-0000-7000-8000-00000000db02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000db03'
const BROKER = '00000000-0000-7000-8000-00000000db04'
const CARRIER = '00000000-0000-7000-8000-00000000db05'
/*
  The two ports are *looked up*, not asserted into existence.

  These were fixed ids copied from `apps/web/src/lib/testing/fixtures.ts`,
  which meant this suite passed only on a database where the web suite had run
  first and lost a race with the seed: `locations.unlocode` is unique, so on a
  seeded database the web fixture's insert conflicts, does nothing, and the ids
  never exist. Three tests here then failed with no explanation on any machine
  that had run `pnpm db:seed` — including CI's.

  Resolving by UN/LOCODE asks the question this suite actually cares about
  ("the seeded port called AEJEA"), and cannot be broken by whoever happened to
  create the row.
*/
let SHUWAIKH: string
let JEBEL_ALI: string
const ABSENT = '00000000-0000-7000-8000-00000000db00'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)

/*
  A tariff prefix nobody else can collide with.

  `duty_rates` is reference data and `DELETE` is revoked, so every run of this
  suite leaves its rows behind. Matching is by *prefix*, so a fixed prefix
  would have last week's row competing with this one on equal length — and
  `findRate` would then be picking between two rows at random. Six digits taken
  from the clock keeps each run's tariff to itself.
*/
const PREFIX = Date.now().toString().slice(-6)
const HS = `${PREFIX}1234`

let seq = 0
const next = () => (seq += 1)

let oceanFreightId: string

/** What each fixture was called, so a test can name it without counting. */
const references = new Map<string, string>()
const referenceOf = (id: string): string => references.get(id) ?? ''

async function job(over: Record<string, unknown> = {}): Promise<string> {
  const reference = `DOC-${RUN}-${next()}`
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference,
        branchId: BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_lcl',
        tradeDirection: 'import',
        status: 'in_transit',
        ...over,
      })
      .returning({ id: jobs.id })
    references.set(row!.id, reference)
    return row!.id
  })
}

const party = (jobId: string, values: Record<string, unknown>) =>
  withActor(systemActor, (tx) => tx.insert(jobParties).values({ jobId, ...values } as never))

const cargo = (jobId: string, values: Record<string, unknown>) =>
  withActor(systemActor, (tx) =>
    tx
      .insert(jobCargo)
      .values({ jobId, lineNo: next(), descriptionEn: 'Goods', ...values } as never),
  )

const container = async (jobId: string, values: Record<string, unknown> = {}): Promise<string> =>
  withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(equipment)
      .values({ jobId, containerNo: `MSKU${RUN}${next()}`, containerType: '40HC', ...values })
      .returning({ id: equipment.id })
    return row!.id
  })

/** A revenue line — which is what makes the freight prepaid. */
const revenue = (jobId: string, currency = 'KWD') =>
  withActor(systemActor, (tx) =>
    tx.insert(chargeLines).values({
      jobId,
      branchId: BRANCH,
      direction: 'revenue',
      chargeTypeId: oceanFreightId,
      basis: 'flat',
      rate: '120.000',
      amount: '120.000',
      currency,
      amountBase: '120.000',
      baseCurrency: 'KWD',
    }),
  )

const cost = (jobId: string) =>
  withActor(systemActor, (tx) =>
    tx.insert(chargeLines).values({
      jobId,
      branchId: BRANCH,
      direction: 'cost',
      chargeTypeId: oceanFreightId,
      basis: 'flat',
      rate: '90.000',
      amount: '90.000',
      currency: 'USD',
      amountBase: '27.630',
      baseCurrency: 'KWD',
    }),
  )

/** A milestone, with the dates it was given and nothing inferred. */
const milestone = (jobId: string, code: string, values: Record<string, unknown> = {}) =>
  withActor(systemActor, (tx) =>
    tx
      .insert(jobMilestones)
      .values({ jobId, code, nameEn: code, nameAr: code, seq: next(), ...values } as never),
  )

const declaration = (jobId: string, values: Record<string, unknown> = {}) =>
  withActor(systemActor, (tx) =>
    tx.insert(customsStages).values({ jobId, status: 'documents_pending', ...values } as never),
  )

async function consolidation(over: Record<string, unknown> = {}): Promise<string> {
  const reference = `CON-${RUN}-${next()}`
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(consolidations)
      .values({
        reference,
        branchId: BRANCH,
        mode: 'sea_lcl',
        tradeDirection: 'import',
        ...over,
      })
      .returning({ id: consolidations.id })
    references.set(row!.id, reference)
    return row!.id
  })
}

const versionsOf = (jobId: string) =>
  withActor(actor, (tx) =>
    tx
      .select({
        id: documents.id,
        version: documents.version,
        supersededById: documents.supersededById,
        locale: documents.locale,
        generatedFrom: documents.generatedFrom,
        assetId: documents.assetId,
      })
      .from(documents)
      .where(eq(documents.jobId, jobId)),
  )

describe.skipIf(!enabled)('assembling a job’s documents', () => {
  beforeAll(async () => {
    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      const ports = await tx
        .select({ id: locations.id, unlocode: locations.unlocode })
        .from(locations)
        .where(inArray(locations.unlocode, ['KWSWK', 'AEJEA']))
      SHUWAIKH = ports.find((port) => port.unlocode === 'KWSWK')?.id ?? ''
      JEBEL_ALI = ports.find((port) => port.unlocode === 'AEJEA')?.id ?? ''
      if (!SHUWAIKH || !JEBEL_ALI) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'documents@qabandi.test',
          nameEn: 'Documents Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'DOC',
          legalNameEn: 'Documents Branch Co.',
          legalNameAr: 'فرع المستندات',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'DOC',
          taxRegistration: 'KW-TRN-DOC',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-DOCUMENTS',
          legalNameEn: 'Documents Fixture Customer',
          legalNameAr: 'عميل المستندات',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      await tx
        .insert(partners)
        .values([
          {
            id: BROKER,
            code: 'PTR-DOCS-BROKER',
            type: 'broker',
            legalNameEn: 'Bayan Clearing Co.',
          },
          {
            id: CARRIER,
            code: 'PTR-DOCS-CARRIER',
            type: 'carrier',
            legalNameEn: 'Gulf Feeder Line',
          },
        ])
        .onConflictDoNothing()

      await tx
        .insert(dutyRates)
        .values({
          country: 'KW',
          hsPrefix: PREFIX,
          ratePercent: '5',
          descriptionEn: `Fixture tariff ${RUN}`,
          effectiveFrom: '2020-01-01',
        })
        .onConflictDoNothing()

      const [freight] = await tx
        .select({ id: chargeTypes.id })
        .from(chargeTypes)
        .where(eq(chargeTypes.key, 'ocean_freight'))
        .limit(1)
      if (!freight) throw new Error('Run `pnpm db:seed` before this suite')
      oceanFreightId = freight.id
    })
  })

  afterAll(async () => {
    // Closed, so no sweep or poll picks these shipments up afterwards.
    if (!enabled) return
    await withActor(systemActor, (tx) =>
      tx.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.branchId, BRANCH)),
    )
  })

  beforeEach(() => {
    printer.calls.length = 0
    bucket.puts.length = 0
    bucket.fail = false
  })

  describe('the shipment view', () => {
    /**
     * Not found rather than forbidden — FR-ID-04. RLS makes a job outside the
     * principal's scope invisible rather than refused, so from where the query
     * stands there is genuinely no such row and saying "forbidden" would leak
     * that one exists.
     */
    it('refuses a job it cannot see rather than saying who owns it', async () => {
      await expect(loadJobDocumentView(actor, ABSENT)).rejects.toBeInstanceOf(DocumentNotFoundError)
      // Named, because the caller sees only a bare 404 and the log line is all
      // a support engineer has to say which table to look in.
      await expect(loadJobDocumentView(actor, ABSENT)).rejects.toThrow(`No job ${ABSENT}`)
    })

    it('carries the shipment’s own identifiers onto the document', async () => {
      const id = await job({
        houseBillNumber: 'QBD-DOC-2026-00001',
        masterBillNumber: 'MSCU7654321',
        bookingNumber: 'BK-DOC-1',
        customerReference: 'PO-8814',
        incoterm: 'CIF',
        vesselName: 'MSC SHUWAIKH',
        voyageNumber: '118W',
      })

      const view = await loadJobDocumentView(actor, id)

      expect(view.houseBillNumber).toBe('QBD-DOC-2026-00001')
      expect(view.masterBillNumber).toBe('MSCU7654321')
      expect(view.bookingNumber).toBe('BK-DOC-1')
      expect(view.customerReference).toBe('PO-8814')
      expect(view.incoterm).toBe('CIF')
      expect(view.vesselName).toBe('MSC SHUWAIKH')
      expect(view.customer.nameEn).toBe('Documents Fixture Customer')
      expect(view.branch.taxRegistration).toBe('KW-TRN-DOC')
    })

    /** The branch code, because a bill of lading states where it was issued. */
    it('issues from the branch that holds the shipment', async () => {
      expect((await loadJobDocumentView(actor, await job())).placeOfIssue).toBe('DOC')
    })

    it('resolves the ports it was routed between', async () => {
      const id = await job({ originId: JEBEL_ALI, destinationId: SHUWAIKH })

      const view = await loadJobDocumentView(actor, id)

      expect(view.origin?.unlocode).toBe('AEJEA')
      expect(view.destination?.unlocode).toBe('KWSWK')
      expect(view.destination?.nameAr).toBeTruthy()
    })

    /** A quotation-stage job may have neither yet, and still needs a pack. */
    it('leaves the ports empty rather than inventing them', async () => {
      const view = await loadJobDocumentView(actor, await job())

      expect(view.origin).toBeNull()
      expect(view.destination).toBeNull()
    })

    /**
     * The enum's order, which is the order the boxes appear on a bill —
     * shipper, consignee, notify. Sorting by the *text* of the role would give
     * consignee, notify, shipper, and the templates would still find each
     * party by role, so nothing would look wrong until somebody printed a
     * second-notify onto a document that lists them in order.
     */
    it('orders the parties as the boxes run down the bill', async () => {
      const id = await job()
      await party(id, { role: 'notify', nameEn: 'Notify Party', sortOrder: 0 })
      await party(id, { role: 'consignee', nameEn: 'TO ORDER', sortOrder: 0 })
      await party(id, { role: 'shipper', nameEn: 'Shanghai Everbright', sortOrder: 0 })

      const view = await loadJobDocumentView(actor, id)

      expect(view.parties.map((p) => p.role)).toEqual(['shipper', 'consignee', 'notify'])
    })

    /** Two of one role keep the order the operator put them in. */
    it('keeps two parties of one role in the order they were entered', async () => {
      const id = await job()
      await party(id, { role: 'notify', nameEn: 'Second', sortOrder: 2 })
      await party(id, { role: 'notify', nameEn: 'First', sortOrder: 1 })

      const view = await loadJobDocumentView(actor, id)

      expect(view.parties.map((p) => p.nameEn)).toEqual(['First', 'Second'])
    })

    it('carries a party’s address, contact and tax id through unaltered', async () => {
      const id = await job()
      await party(id, {
        role: 'shipper',
        nameEn: 'Shanghai Everbright Ltd.',
        nameAr: 'شنغهاي إيفربرايت',
        address: 'No. 88 Pudong Avenue\nBuilding C, Floor 12',
        city: 'Shanghai',
        country: 'CN',
        contactName: 'Wei Zhang',
        phone: '+86 21 5555 0100',
        email: 'export@everbright.example',
        taxId: 'CN-91310000',
      })

      const [shipper] = (await loadJobDocumentView(actor, id)).parties

      expect(shipper?.address).toContain('\n')
      expect(shipper?.city).toBe('Shanghai')
      expect(shipper?.contactName).toBe('Wei Zhang')
      expect(shipper?.taxId).toBe('CN-91310000')
    })

    it('lists the cargo lines in the order they were entered', async () => {
      const id = await job()
      await cargo(id, { descriptionEn: 'Steel pipes', packageCount: 10 })
      await cargo(id, { descriptionEn: 'Valves', packageCount: 4 })

      const view = await loadJobDocumentView(actor, id)

      expect(view.cargo.map((c) => c.descriptionEn)).toEqual(['Steel pipes', 'Valves'])
    })

    it('names the container a line is stuffed in', async () => {
      const id = await job()
      const box = await container(id, { sealNo: 'SEAL-991' })
      await cargo(id, { descriptionEn: 'Stuffed', equipmentId: box })
      await cargo(id, { descriptionEn: 'Loose' })

      const view = await loadJobDocumentView(actor, id)

      expect(view.cargo.find((c) => c.descriptionEn === 'Stuffed')?.containerNo).toMatch(/^MSKU/)
      expect(view.cargo.find((c) => c.descriptionEn === 'Loose')?.containerNo).toBeNull()
      expect(view.equipment[0]?.sealNo).toBe('SEAL-991')
      expect(view.equipment[0]?.containerType).toBe('40HC')
    })

    describe('the on-board date', () => {
      /**
       * UCP 600 art. 20: the notation dates the *loading* onto the vessel, so
       * the `loaded` milestone wins; departure is the fallback; and `jobs.atd`
       * — which nothing in the application writes — is last. Only actual
       * dates: a planned one is a forecast, and a forecast on a document of
       * title is a false statement.
       */
      it('takes the loaded milestone over the departure', async () => {
        const id = await job({ atd: new Date('2026-06-03T00:00:00Z') })
        await milestone(id, 'loaded', { actualAt: new Date('2026-06-01T14:00:00Z') })
        await milestone(id, 'vessel_departed', { actualAt: new Date('2026-06-02T06:00:00Z') })

        const view = await loadJobDocumentView(actor, id)
        expect(view.shippedOnBoardAt?.toISOString()).toBe('2026-06-01T14:00:00.000Z')
      })

      it('falls back to the departure where loading was never recorded', async () => {
        const id = await job({ atd: new Date('2026-06-03T00:00:00Z') })
        await milestone(id, 'vessel_departed', { actualAt: new Date('2026-06-02T06:00:00Z') })

        const view = await loadJobDocumentView(actor, id)
        expect(view.shippedOnBoardAt?.toISOString()).toBe('2026-06-02T06:00:00.000Z')
      })

      it('falls back to atd where no milestone was completed', async () => {
        const id = await job({ atd: new Date('2026-06-03T00:00:00Z') })
        await milestone(id, 'loaded', { plannedAt: new Date('2026-06-01T14:00:00Z') })

        const view = await loadJobDocumentView(actor, id)
        expect(view.shippedOnBoardAt?.toISOString()).toBe('2026-06-03T00:00:00.000Z')
      })

      it('is null, not a forecast, where nothing has actually happened', async () => {
        const id = await job()
        await milestone(id, 'loaded', { plannedAt: new Date('2026-06-01T14:00:00Z') })
        await milestone(id, 'vessel_departed', { revisedAt: new Date('2026-06-02T06:00:00Z') })

        const view = await loadJobDocumentView(actor, id)
        expect(view.shippedOnBoardAt).toBeNull()
      })
    })

    it('carries the surrender, the delivery boxes and the branch terms', async () => {
      const id = await job({
        placeOfReceipt: 'Shanghai CFS',
        placeOfDelivery: 'Shuwaikh, Block 4',
        houseBillSurrenderedAt: new Date('2026-06-09T09:00:00Z'),
      })

      const view = await loadJobDocumentView(actor, id)
      expect(view.placeOfReceipt).toBe('Shanghai CFS')
      expect(view.placeOfDelivery).toBe('Shuwaikh, Block 4')
      expect(view.houseBillSurrenderedAt?.toISOString()).toBe('2026-06-09T09:00:00.000Z')
      // The fixture branch has none; the point is that the view carries the
      // columns at all, so a template can print a back page from them.
      expect(view.branch).toHaveProperty('billOfLadingTermsEn')
      expect(view.branch).toHaveProperty('billOfLadingTermsAr')
    })

    describe('prepaid or collect', () => {
      /**
       * Derived from the charge lines rather than stored, so it cannot drift
       * from the money. An import handled for an overseas agent carries the
       * cost and no freight revenue — which is exactly what collect means.
       */
      it('is prepaid where we raised revenue on the shipment', async () => {
        const id = await job()
        await revenue(id)

        const view = await loadJobDocumentView(actor, id)

        expect(view.freightTerm).toBe('prepaid')
        expect(view.currency).toBe('KWD')
      })

      it('is collect where only a cost was booked', async () => {
        const id = await job()
        await cost(id)

        const view = await loadJobDocumentView(actor, id)

        expect(view.freightTerm).toBe('collect')
        expect(view.currency).toBeNull()
      })

      it('is collect on a job with no charges at all', async () => {
        expect((await loadJobDocumentView(actor, await job())).freightTerm).toBe('collect')
      })

      it('states the currency the revenue was raised in, not the branch’s', async () => {
        const id = await job()
        await revenue(id, 'USD')

        expect((await loadJobDocumentView(actor, id)).currency).toBe('USD')
      })
    })

    describe('the chargeable weight', () => {
      /**
       * The number the rate was applied against wins outright. A waybill that
       * prints a weight the invoice beside it disagrees with is a dispute
       * waiting for somebody to notice.
       */
      it('prints the weight the shipment was rated at, not one it recomputed', async () => {
        const id = await job({ mode: 'air', chargeableWeightKg: '250.000' })
        await cargo(id, { grossWeightKg: '100.000', volumeCbm: '1.200' })

        const view = await loadJobDocumentView(actor, id)

        expect(Number(view.chargeableWeightKg)).toBeCloseTo(250, 3)
        // Silent about the basis: the engine decided which side won and this
        // layer does not know, so it says nothing rather than guessing.
        expect(view.chargeableBasis).toBeNull()
      })

      it('derives one from the cargo where the shipment was never rated', async () => {
        const id = await job({ mode: 'air' })
        await cargo(id, { grossWeightKg: '100.000', volumeCbm: '1.200' })

        const view = await loadJobDocumentView(actor, id)

        // 1.2 cbm at the seeded 6000 divisor is 200 kg, against 100 actual.
        expect(Number(view.chargeableWeightKg)).toBeCloseTo(200, 3)
        expect(view.chargeableBasis).toBe('volumetric')
      })

      /** The divisor is a seeded rule, so the document agrees with the rating. */
      it('applies the mode’s own minimum rather than a literal', async () => {
        const id = await job({ mode: 'air' })
        await cargo(id, { grossWeightKg: '10.000', volumeCbm: '0.010' })

        const view = await loadJobDocumentView(actor, id)

        expect(Number(view.chargeableWeightKg)).toBeCloseTo(45, 3)
        expect(view.chargeableBasis).toBe('minimum')
      })

      it('adds the cargo lines up before deriving anything', async () => {
        const id = await job({ mode: 'air' })
        await cargo(id, { grossWeightKg: '60.000', volumeCbm: '0.300' })
        await cargo(id, { grossWeightKg: '80.000', volumeCbm: '0.300' })

        // 0.6 cbm is 100 kg volumetric, against 140 actual — gross wins.
        const view = await loadJobDocumentView(actor, id)

        expect(Number(view.chargeableWeightKg)).toBeCloseTo(140, 3)
        expect(view.chargeableBasis).toBe('gross')
      })

      /** A blank box beats a fabricated number on a booking with no cargo. */
      it('leaves it empty on a shipment with no cargo lines', async () => {
        const view = await loadJobDocumentView(actor, await job({ mode: 'air' }))

        expect(view.chargeableWeightKg).toBeNull()
        expect(view.chargeableBasis).toBeNull()
      })

      /**
       * The three below are the regression, and the bug they cover shipped.
       *
       * The loader read `SEED_CHARGEABLE_RULES` — the constant the seed writes
       * the table *from* — while its own comment said it read the seeded rule
       * so that a divisor change would be an admin edit (FR-AD-03). Every
       * assertion above passes either way, because a freshly seeded table and
       * the constant agree by construction. They only disagree once somebody
       * exercises the edit the feature exists for, which is what these do.
       */
      describe('comes from the table, not from the constant it was seeded with', () => {
        /** The seeded air row: 6000 cm³/kg, rounded to the half kilo, floor 45. */
        const SEEDED = { divisorCm3PerKg: '6000.000', roundUpToKg: '0.500', minimumKg: '45.000' }

        interface RuleEdit {
          divisorCm3PerKg?: string | null
          roundUpToKg?: string
          minimumKg?: string
          isActive?: boolean
        }

        // Active unless a case says otherwise, so no test has to restate the
        // flag it is not interested in.
        const setDefault = (over: RuleEdit) =>
          withActor(systemActor, (tx) =>
            tx
              .update(chargeableRules)
              .set({ isActive: true, ...over })
              .where(and(eq(chargeableRules.mode, 'air'), isNull(chargeableRules.branchId))),
          )

        /*
          The branch's own row is upserted and then deactivated, never removed.

          `DELETE` is revoked from `app_user` — the first draft of this cleaned
          up with one and the database refused, which is the rule working. So
          the row is created once and toggled by `is_active` from then on, and
          the upsert is what makes a second run of the suite find its own row
          rather than collide with `unique (mode, branch_id)`.
        */
        const setBranchRule = (over: RuleEdit) =>
          withActor(systemActor, (tx) =>
            tx
              .insert(chargeableRules)
              .values({ mode: 'air', branchId: BRANCH, ...SEEDED, ...over } as never)
              .onConflictDoUpdate({
                target: [chargeableRules.mode, chargeableRules.branchId],
                set: over,
              }),
          )

        // Both rows are put back whatever the test did, and the default is
        // restored last so a failure part-way through still leaves the shared
        // reference data as the rest of this file expects to find it.
        afterEach(async () => {
          await setBranchRule({ isActive: false })
          await setDefault(SEEDED)
        })

        it('follows the divisor an administrator changed', async () => {
          // The move every air department eventually makes: 6000 to 5000.
          await setBranchRule({ isActive: false })
          await setDefault({ divisorCm3PerKg: '5000.000' })

          const id = await job({ mode: 'air' })
          await cargo(id, { grossWeightKg: '100.000', volumeCbm: '1.200' })

          // 1.2 cbm at 5000 is 240 kg, where 6000 gave the 200 above.
          const view = await loadJobDocumentView(actor, id)
          expect(Number(view.chargeableWeightKg)).toBeCloseTo(240, 3)
          expect(view.chargeableBasis).toBe('volumetric')
        })

        /** `unique (mode, branch_id)` exists so a branch can differ. */
        it('prefers the branch’s own rule over the default', async () => {
          await setDefault(SEEDED)
          await setBranchRule({ divisorCm3PerKg: '4000.000', isActive: true })

          const id = await job({ mode: 'air' })
          await cargo(id, { grossWeightKg: '100.000', volumeCbm: '1.200' })

          // 1.2 cbm at the branch's 4000, not the default 6000.
          expect(Number((await loadJobDocumentView(actor, id)).chargeableWeightKg)).toBeCloseTo(
            300,
            3,
          )
        })

        /**
         * No silent fallback to the constant.
         *
         * A fallback is what made the original fault invisible: the box fills
         * with a plausible number sourced from something nobody can edit. An
         * unconfigured mode prints nothing, the same as cargo with no
         * dimensions — and `/reference` counts these rows so the empty table
         * is visible before the document is.
         */
        it('prints nothing where the mode has no active rule', async () => {
          await setBranchRule({ isActive: false })
          await setDefault({ isActive: false })

          const id = await job({ mode: 'air' })
          await cargo(id, { grossWeightKg: '100.000', volumeCbm: '1.200' })

          const view = await loadJobDocumentView(actor, id)
          expect(view.chargeableWeightKg).toBeNull()
          expect(view.chargeableBasis).toBeNull()
        })
      })
    })
  })

  describe('the customs pack', () => {
    it('takes the declaration details and the broker from the customs stage', async () => {
      const id = await job()
      await declaration(id, {
        declarationType: 'import_consumption',
        declarationNo: 'KWD-2026-77123',
        brokerPartnerId: BROKER,
        customsValue: '1000.000',
        customsValueCurrency: 'KWD',
      })

      const pack = await loadCustomsPackView(actor, id)

      expect(pack.declarationType).toBe('import_consumption')
      expect(pack.declarationNo).toBe('KWD-2026-77123')
      expect(pack.brokerName).toBe('Bayan Clearing Co.')
      expect(pack.goodsValue).toBe('1000.000000')
    })

    /** The pack is produced before anybody files, which is the point of it. */
    it('produces a pack for a shipment with no customs stage yet', async () => {
      const pack = await loadCustomsPackView(actor, await job())

      expect(pack.declarationType).toBeNull()
      expect(pack.brokerName).toBeNull()
      expect(pack.goodsValue).toBeNull()
      expect(pack.currency).toBe('KWD')
    })

    it('leaves the broker unnamed where the stage names none', async () => {
      const id = await job()
      await declaration(id, { declarationNo: 'KWD-2026-77124' })

      expect((await loadCustomsPackView(actor, id)).brokerName).toBeNull()
    })

    describe('which currency the pack is stated in', () => {
      it('uses the one the value was declared in', async () => {
        const id = await job()
        await declaration(id, { customsValue: '500.00', customsValueCurrency: 'USD' })

        expect((await loadCustomsPackView(actor, id)).currency).toBe('USD')
      })

      it('lets the caller override it', async () => {
        const id = await job()
        await declaration(id, { customsValue: '500.00', customsValueCurrency: 'USD' })

        expect((await loadCustomsPackView(actor, id, { currency: 'KWD' })).currency).toBe('KWD')
      })

      /** KWD carries three decimals; a global two would lose a fils a line. */
      it('rounds to the currency’s own minor units', async () => {
        const id = await job()
        await cargo(id, { descriptionEn: 'Fasteners', hsCode: HS, grossWeightKg: '1.000' })
        await declaration(id, { customsValue: '100.0005', customsValueCurrency: 'KWD' })

        const pack = await loadCustomsPackView(actor, id)

        expect(pack.customsValue).toBe('100.001')
      })
    })

    describe('the duty estimate', () => {
      it('matches a code against the tariff and shows which line answered', async () => {
        const id = await job()
        await cargo(id, { descriptionEn: 'Steel pipes', hsCode: HS, grossWeightKg: '100.000' })
        await declaration(id, { customsValue: '1000.000', customsValueCurrency: 'KWD' })

        const pack = await loadCustomsPackView(actor, id)

        expect(pack.lines[0]?.matchedPrefix).toBe(PREFIX)
        expect(Number(pack.lines[0]?.ratePercent)).toBe(5)
        expect(Number(pack.lines[0]?.duty)).toBeCloseTo(50, 3)
        expect(Number(pack.estimatedDuty)).toBeCloseTo(50, 3)
        expect(pack.unmatched).toEqual([])
      })

      /**
       * The unmatched codes are the broker's actual work, so they are printed
       * rather than quietly given the general rate. A figure that looks
       * researched and is a guess is worse than an admitted gap.
       */
      it('names a code the tariff has no line for instead of guessing', async () => {
        const id = await job()
        await cargo(id, {
          descriptionEn: 'Unknown goods',
          hsCode: '0000000099',
          grossWeightKg: '1',
        })
        await declaration(id, { customsValue: '100.000', customsValueCurrency: 'KWD' })

        const pack = await loadCustomsPackView(actor, id)

        expect(pack.unmatched).toEqual(['0000000099'])
        expect(pack.lines[0]?.ratePercent).toBeNull()
        expect(pack.lines[0]?.duty).toBeNull()
        expect(Number(pack.estimatedDuty)).toBe(0)
      })

      it('names an unclassified line once, however many carry no code', async () => {
        const id = await job()
        await cargo(id, { descriptionEn: 'Sundries A', grossWeightKg: '1' })
        await cargo(id, { descriptionEn: 'Sundries B', grossWeightKg: '1' })
        await declaration(id, { customsValue: '100.000', customsValueCurrency: 'KWD' })

        expect((await loadCustomsPackView(actor, id)).unmatched).toEqual(['(no code)'])
      })

      /**
       * Apportioned by weight where only a shipment total is declared — not
       * because it is accurate, but because a duty column with one figure on
       * the first row and blanks below is a sheet the broker cannot use.
       */
      it('apportions a shipment value across the lines by weight', async () => {
        const id = await job()
        await cargo(id, { descriptionEn: 'Heavy', hsCode: HS, grossWeightKg: '700.000' })
        await cargo(id, { descriptionEn: 'Light', hsCode: HS, grossWeightKg: '300.000' })
        await declaration(id, { customsValue: '1000.000', customsValueCurrency: 'KWD' })

        const pack = await loadCustomsPackView(actor, id)
        const heavy = pack.lines.find((l) => l.description === 'Heavy')
        const light = pack.lines.find((l) => l.description === 'Light')

        expect(Number(heavy?.value)).toBeCloseTo(700, 3)
        expect(Number(light?.value)).toBeCloseTo(300, 3)
        expect(Number(pack.estimatedDuty)).toBeCloseTo(50, 3)
      })

      /**
       * Two lines of the same goods in different containers is routine, and
       * the join back onto the estimate has to survive it. Keying on the
       * description would give the second line the first one's value — a
       * per-line duty that is wrong while the total is right, which is the
       * hardest kind of error for a broker to spot.
       */
      it('keeps two lines of the same description apart', async () => {
        const id = await job()
        await cargo(id, { descriptionEn: 'Steel pipes', hsCode: HS, grossWeightKg: '800.000' })
        await cargo(id, { descriptionEn: 'Steel pipes', hsCode: HS, grossWeightKg: '200.000' })
        await declaration(id, { customsValue: '1000.000', customsValueCurrency: 'KWD' })

        const pack = await loadCustomsPackView(actor, id)
        const values = pack.lines.map((l) => Number(l.value)).sort((a, b) => a - b)

        expect(values[0]).toBeCloseTo(200, 3)
        expect(values[1]).toBeCloseTo(800, 3)
      })

      /** Nothing to apportion by, so the value is split evenly instead. */
      it('splits evenly where no line carries a weight', async () => {
        const id = await job()
        await cargo(id, { descriptionEn: 'Documents A', hsCode: HS })
        await cargo(id, { descriptionEn: 'Documents B', hsCode: HS })
        await declaration(id, { customsValue: '100.000', customsValueCurrency: 'KWD' })

        const pack = await loadCustomsPackView(actor, id)

        expect(pack.lines.every((l) => Number(l.value) === 50)).toBe(true)
      })

      it('values every line at nothing where no goods value is known at all', async () => {
        const id = await job()
        await cargo(id, { descriptionEn: 'Steel pipes', hsCode: HS, grossWeightKg: '100.000' })

        const pack = await loadCustomsPackView(actor, id)

        expect(pack.goodsValue).toBeNull()
        expect(pack.customsValue).toBeNull()
        expect(Number(pack.lines[0]?.value)).toBe(0)
      })

      it('prefers a value the caller passed over the one on the stage', async () => {
        const id = await job()
        await cargo(id, { descriptionEn: 'Steel pipes', hsCode: HS, grossWeightKg: '100.000' })
        await declaration(id, { customsValue: '1000.000', customsValueCurrency: 'KWD' })

        const pack = await loadCustomsPackView(actor, id, { goodsValue: '2000.000' })

        expect(Number(pack.estimatedDuty)).toBeCloseTo(100, 3)
      })
    })
  })

  describe('the consolidation manifest', () => {
    it('refuses a consolidation it cannot see', async () => {
      await expect(loadConsolidationDocumentView(actor, ABSENT)).rejects.toThrow(
        `No consolidation ${ABSENT}`,
      )
    })

    it('names the carrier and the co-loader it was booked with', async () => {
      const id = await consolidation({
        carrierPartnerId: CARRIER,
        coloadPartnerId: BROKER,
        masterBillNumber: 'GFL-2026-0099',
        originId: JEBEL_ALI,
        destinationId: SHUWAIKH,
      })

      const view = await loadConsolidationDocumentView(actor, id)

      expect(view.carrierName).toBe('Gulf Feeder Line')
      expect(view.coloadPartnerName).toBe('Bayan Clearing Co.')
      expect(view.masterBillNumber).toBe('GFL-2026-0099')
      expect(view.origin?.unlocode).toBe('AEJEA')
      expect(view.branch.legalNameAr).toBe('فرع المستندات')
    })

    it('leaves the carrier unnamed where none was booked', async () => {
      const view = await loadConsolidationDocumentView(actor, await consolidation())

      expect(view.carrierName).toBeNull()
      expect(view.coloadPartnerName).toBeNull()
    })

    /** A consolidation exists before anything is attached to it. */
    it('answers with no houses rather than failing on an empty master', async () => {
      expect((await loadConsolidationDocumentView(actor, await consolidation())).houses).toEqual([])
    })

    /**
     * By reference, not by insert order. A manifest is checked against a
     * carrier's own list line by line, and a house that moves position between
     * two prints of the same master is a reconciliation nobody can finish.
     */
    it('lists the houses under the master in reference order', async () => {
      const master = await consolidation()
      // Inserted in the reverse of the order they must be listed in.
      await job({ consolidationId: master, reference: `DOC-${RUN}-ZZZ` })
      await job({ consolidationId: master, reference: `DOC-${RUN}-AAA` })

      const listed = (await loadConsolidationDocumentView(actor, master)).houses.map(
        (h) => h.jobReference,
      )

      expect(listed).toEqual([`DOC-${RUN}-AAA`, `DOC-${RUN}-ZZZ`])
    })

    /**
     * One line per house, summed — a manifest is a list of bills, not of cargo
     * lines. The description is the first line's, which is the convention.
     */
    it('sums a house’s cargo onto one manifest line', async () => {
      const master = await consolidation()
      const house = await job({ consolidationId: master, houseBillNumber: 'QBD-DOC-M-1' })
      await cargo(house, {
        descriptionEn: 'Steel pipes',
        packageCount: 10,
        packageType: 'PALLETS',
        grossWeightKg: '1200.500',
        volumeCbm: '3.250',
        marksAndNumbers: 'NO MARKS',
      })
      await cargo(house, {
        descriptionEn: 'Valves',
        packageCount: 4,
        grossWeightKg: '300.500',
        volumeCbm: '0.750',
      })

      const [line] = (await loadConsolidationDocumentView(actor, master)).houses

      expect(line?.descriptionEn).toBe('Steel pipes')
      expect(line?.packageCount).toBe(14)
      expect(Number(line?.grossWeightKg)).toBeCloseTo(1501, 3)
      expect(Number(line?.volumeCbm)).toBeCloseTo(4, 3)
      expect(line?.packageType).toBe('PALLETS')
      expect(line?.marksAndNumbers).toBe('NO MARKS')
    })

    it('carries the container the first line is stuffed in', async () => {
      const master = await consolidation()
      const house = await job({ consolidationId: master })
      const box = await container(house)
      await cargo(house, { descriptionEn: 'Stuffed', equipmentId: box })

      expect((await loadConsolidationDocumentView(actor, master)).houses[0]?.containerNo).toMatch(
        /^MSKU/,
      )
    })

    it('names the shipper and consignee off the bill', async () => {
      const master = await consolidation()
      const house = await job({ consolidationId: master })
      await party(house, { role: 'shipper', nameEn: 'Shanghai Everbright' })
      await party(house, { role: 'consignee', nameEn: 'Gulf Trading Co.' })
      await party(house, { role: 'notify', nameEn: 'Notify Party' })

      const [line] = (await loadConsolidationDocumentView(actor, master)).houses

      expect(line?.shipperName).toBe('Shanghai Everbright')
      expect(line?.consigneeName).toBe('Gulf Trading Co.')
      expect(line?.notifyName).toBe('Notify Party')
    })

    /**
     * The customer, where no shipper was named — a manifest line with a blank
     * shipper is one the carrier rejects, and the booking party is the best
     * answer available.
     */
    it('falls back to the booking customer where no shipper was named', async () => {
      const master = await consolidation()
      await job({ consolidationId: master })

      const [line] = (await loadConsolidationDocumentView(actor, master)).houses

      expect(line?.shipperName).toBe('Documents Fixture Customer')
      expect(line?.consigneeName).toBe('—')
      expect(line?.notifyName).toBeNull()
      expect(line?.descriptionEn).toBe('—')
      expect(line?.packageCount).toBeNull()
    })
  })

  describe('rendering', () => {
    /**
     * One kind, two documents, decided by the mode. A job has one house bill
     * number from one series, so offering both as separate kinds would let an
     * operator issue two documents each claiming to be the contract of
     * carriage for the same shipment.
     */
    it('prints a bill of lading for a sea shipment', async () => {
      const id = await job({ houseBillNumber: 'QBD-DOC-SEA-1' })

      const result = await renderJobDocumentPdf(actor, id, 'house_bill', 'en')

      expect(result.html).toContain('House Bill of Lading')
      expect(result.filename).toBe('QBD-DOC-SEA-1-house_bill-en.pdf')
    })

    it('prints an air waybill for the same kind on an air shipment', async () => {
      const id = await job({ mode: 'air', houseBillNumber: '176-DOC0001' })

      const result = await renderJobDocumentPdf(actor, id, 'house_bill', 'en')

      expect(result.html).toContain('House Air Waybill')
      // Filed as what it is. `house_bill` stays the stored key, but a folder
      // of `-house_bill.pdf` files for air jobs is a folder nobody can search.
      expect(result.filename).toBe('176-DOC0001-air_waybill-en.pdf')
    })

    it('falls back to the job reference where no bill number is allocated', async () => {
      const id = await job()

      const result = await renderJobDocumentPdf(actor, id, 'house_bill', 'en')

      expect(result.filename).toBe(`${referenceOf(id)}-house_bill-en.pdf`)
    })

    it('strips anything a filesystem would object to out of the name', async () => {
      const id = await job({ houseBillNumber: 'QBD/DOC 2026:01' })

      const result = await renderJobDocumentPdf(actor, id, 'house_bill', 'en')

      expect(result.filename).toBe('QBD-DOC-2026-01-house_bill-en.pdf')
    })

    it('prints a delivery order', async () => {
      const result = await renderJobDocumentPdf(actor, await job(), 'delivery_order', 'en')

      expect(result.html).toContain('Delivery Order')
      expect(result.filename).toContain('-delivery_order-en.pdf')
    })

    it('prints a packing list', async () => {
      const id = await job()
      await cargo(id, { descriptionEn: 'Steel pipes', netWeightKg: '90.000' })

      const result = await renderJobDocumentPdf(actor, id, 'packing_list', 'en')

      expect(result.html).toContain('Packing List')
    })

    it('prints a customs pack with the estimate on it', async () => {
      const id = await job()
      await cargo(id, { descriptionEn: 'Steel pipes', hsCode: HS, grossWeightKg: '100.000' })
      await declaration(id, { customsValue: '1000.000', customsValueCurrency: 'KWD' })

      const result = await renderJobDocumentPdf(actor, id, 'customs_pack', 'en')

      expect(result.html).toContain('Customs Declaration Pack')
      expect(result.html).toContain(PREFIX)
      expect(result.filename).toContain('-customs_pack-en.pdf')
    })

    /** The locale reaches Chromium, so `Intl` inside the page agrees with it. */
    it('renders in Arabic and says so in the filename', async () => {
      const result = await renderJobDocumentPdf(actor, await job(), 'delivery_order', 'ar')

      expect(printer.calls[0]?.locale).toBe('ar')
      expect(result.html).toContain('dir="rtl"')
      expect(result.filename).toContain('-ar.pdf')
    })

    it('prints a manifest named for the master bill', async () => {
      const id = await consolidation({ masterBillNumber: 'GFL/2026 0100' })

      const result = await renderManifestPdf(actor, id, 'en')

      expect(result.html).toContain('Cargo Manifest')
      expect(result.filename).toBe('GFL-2026-0100-manifest-en.pdf')
    })

    it('names a manifest for the consolidation where no master bill exists', async () => {
      const id = await consolidation()

      const result = await renderManifestPdf(actor, id, 'en')

      expect(result.filename).toBe(`${referenceOf(id)}-manifest-en.pdf`)
    })
  })

  describe('storing what was issued', () => {
    describe('where it goes in the bucket', () => {
      it('keys by shipment and version, so a re-render of one is idempotent', () => {
        expect(storageKeyFor('KWI', 'KWI-JOB-2026-00042', 'house_bill', 2, 'en')).toBe(
          'documents/KWI/KWI-JOB-2026-00042/house_bill-v2-en.pdf',
        )
      })

      it('keeps a slash in a reference out of the path', () => {
        expect(storageKeyFor('KWI', 'A/B C', 'hbl', 1, 'ar')).toBe(
          'documents/KWI/A-B-C/hbl-v1-ar.pdf',
        )
      })
    })

    it('refuses to store against a job it cannot see', async () => {
      await expect(
        storeJobDocument(actor, ABSENT, 'house_bill', 'en', Buffer.from('x'), 'x.pdf'),
      ).rejects.toBeInstanceOf(DocumentNotFoundError)
    })

    it('records the bytes it wrote, and where it wrote them', async () => {
      const id = await job()
      const pdf = Buffer.from('%PDF-1.7 stored')

      const stored = await storeJobDocument(actor, id, 'house_bill', 'en', pdf, 'hbl.pdf')

      expect(stored.version).toBe(1)
      expect(bucket.puts[0]?.key).toBe(stored.storageKey)
      expect(bucket.puts[0]?.contentType).toBe('application/pdf')

      const [asset] = await withActor(actor, (tx) =>
        tx.select().from(assets).where(eq(assets.id, stored.assetId)),
      )
      expect(asset?.byteSize).toBe(pdf.byteLength)
      expect(asset?.checksum).toBe(`sha-${pdf.byteLength}`)
      expect(asset?.fileName).toBe('hbl.pdf')
      expect(asset?.meta).toMatchObject({ kind: 'house_bill', locale: 'en', generated: true })
    })

    /**
     * `generated_from` is the template that made it; `document_type_id` is
     * what it *is*. They are separate because an operator filters the file
     * cabinet by type and support asks which template produced a bad one.
     */
    it('files the document under the seeded type and records what made it', async () => {
      const id = await job()

      await storeJobDocument(actor, id, 'packing_list', 'ar', Buffer.from('x'), 'pl.pdf')

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({
            code: documentTypes.code,
            generatedFrom: documents.generatedFrom,
            locale: documents.locale,
          })
          .from(documents)
          .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
          .where(eq(documents.jobId, id)),
      )

      expect(row?.code).toBe('packing_list')
      expect(row?.generatedFrom).toBe('packing_list')
      expect(row?.locale).toBe('ar')
    })

    /**
     * A corrected bill of lading is a new original with the old one recalled,
     * in the trade as much as in this table. `documents_scope` shows a
     * customer only released documents, so a superseded original stays visible
     * to staff and disappears from the portal — which is the behaviour a
     * recall needs.
     */
    it('writes a new version and recalls the old one rather than overwriting', async () => {
      const id = await job()

      const first = await storeJobDocument(actor, id, 'house_bill', 'en', Buffer.from('a'), 'a.pdf')
      const second = await storeJobDocument(
        actor,
        id,
        'house_bill',
        'en',
        Buffer.from('bb'),
        'b.pdf',
      )

      expect(second.version).toBe(2)
      expect(second.storageKey).not.toBe(first.storageKey)

      const rows = await versionsOf(id)
      const v1 = rows.find((r) => r.version === 1)
      const v2 = rows.find((r) => r.version === 2)

      expect(rows).toHaveLength(2)
      expect(v1?.supersededById).toBe(second.documentId)
      expect(v2?.supersededById).toBeNull()
    })

    /** Versions are per document type, not per job. */
    it('versions each kind on its own', async () => {
      const id = await job()

      await storeJobDocument(actor, id, 'house_bill', 'en', Buffer.from('a'), 'a.pdf')
      const other = await storeJobDocument(
        actor,
        id,
        'delivery_order',
        'en',
        Buffer.from('b'),
        'b.pdf',
      )

      expect(other.version).toBe(1)
    })

    /**
     * Storage first, the row second. A row pointing at bytes that were never
     * written is a download that 404s from a screen saying the document
     * exists; bytes with no row are an orphan that costs pennies and confuses
     * nobody.
     */
    it('writes no row at all when the bucket refuses the bytes', async () => {
      const id = await job()
      bucket.fail = true

      await expect(
        storeJobDocument(actor, id, 'house_bill', 'en', Buffer.from('x'), 'x.pdf'),
      ).rejects.toThrow('bucket unreachable')

      expect(await versionsOf(id)).toEqual([])
    })

    it('stores what was rendered, end to end', async () => {
      const id = await job({ houseBillNumber: 'QBD-DOC-E2E-1' })
      const rendered = await renderJobDocumentPdf(actor, id, 'house_bill', 'en')

      const stored = await storeJobDocument(
        actor,
        id,
        'house_bill',
        'en',
        rendered.pdf,
        rendered.filename,
      )

      expect(stored.filename).toBe('QBD-DOC-E2E-1-house_bill-en.pdf')
      // The bucket is keyed by the shipment, not by the bill number: an
      // operator with bucket access finds a job's documents without joining
      // anything, and a bill number can be reallocated.
      expect(stored.storageKey).toContain(referenceOf(id))

      const [document] = await withActor(actor, (tx) =>
        tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.jobId, id), eq(documents.version, 1))),
      )
      expect(document?.id).toBe(stored.documentId)
    })
  })
})
