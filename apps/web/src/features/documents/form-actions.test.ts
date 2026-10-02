/**
 * The documents a shipment produces — its parties, its cargo, and issuing.
 *
 * Three properties are worth the words here, and all three are about a piece
 * of paper somebody is holding.
 *
 * **One shipper and one consignee, enforced by the database.** A partial
 * unique index rather than a check in this action, because a check here can be
 * forgotten and an index cannot. Two consignees is not a variation to
 * tolerate; it is a bill that cannot be issued. What this asserts is that the
 * refusal arrives as a sentence rather than a stack trace.
 *
 * **Cargo lines take `max + 1`, never `count + 1`.** A line edited away leaves
 * a gap, and reusing its number silently renumbers a packing list a customs
 * officer is already holding. Proved by making a gap and taking the next
 * number across it.
 *
 * **The house bill number is allocated before the render, not after.** A bill
 * rendered before its number exists is watermarked DRAFT on its face, and
 * storing that as the issued original is precisely the mistake the watermark
 * exists to prevent. Allocation goes through `app.allocate_series_number`
 * because `branches` is configuration no coordinator may write — an inline
 * update matched no rows for exactly the people who release house bills, and
 * the miss was indistinguishable from "no series configured" (migration 0016).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { branches, jobCargo, jobParties, jobs, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PARTNER, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { saveJobParty, saveCargoLine, issueDocument, surrenderHouseBill } =
  await import('./form-actions')

const systemActor = { ...bothBranchesActor, type: 'system' as const }

function sessionWith(permissions: readonly string[]) {
  return {
    actor: bothBranchesActor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Documentation Clerk',
      nameAr: null,
      email: 'docs@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([
      [HOME_BRANCH, 'coordinator'],
      [AWAY_BRANCH, 'coordinator'],
    ]),
    requiresTwoFactor: false,
  }
}

const ALL = ['job.update', 'document.generate']

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

let seq = 0
const RUN = Date.now().toString(36).toUpperCase()

/** A shipment of its own, so a party or a cargo line has nothing to collide with. */
async function freshJob(branchId = HOME_BRANCH): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference: `DOC-${RUN}-${seq}`,
        branchId,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'export',
        status: 'in_transit',
      })
      .returning({ id: jobs.id })
    return row!.id
  })
}

describe.skipIf(!enabled)('shipment documents', () => {
  beforeAll(async () => {
    await world()
    harness.session = sessionWith(ALL)
  })

  afterAll(() => {
    harness.session = null
  })

  describe('the parties on a bill', () => {
    it('records a shipper as they wish to appear', async () => {
      const jobId = await freshJob()

      const state = await saveJobParty(
        {},
        form({
          jobId,
          role: 'shipper',
          nameEn: 'Gulf Metals Trading W.L.L.',
          nameAr: 'الخليج للمعادن',
          address: 'Block 4, Street 12\nShuwaikh Industrial',
          city: 'Kuwait City',
          country: 'kw',
          email: 'docs@gulfmetals.example',
        }),
      )

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select().from(jobParties).where(eq(jobParties.jobId, jobId)),
      )
      expect(row?.nameEn).toBe('Gulf Metals Trading W.L.L.')
      expect(row?.country).toBe('KW')
      // An address is laid out, not written — the newline survives.
      expect(row?.address).toContain('\n')
    })

    /** "TO ORDER" is a consignee, and `jobs.customer_id` cannot express it. */
    it('records a consignee that is not a customer at all', async () => {
      const jobId = await freshJob()
      const state = await saveJobParty({}, form({ jobId, role: 'consignee', nameEn: 'TO ORDER' }))

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ nameEn: jobParties.nameEn })
          .from(jobParties)
          .where(eq(jobParties.jobId, jobId)),
      )
      expect(row?.nameEn).toBe('TO ORDER')
    })

    it('edits the party it was given rather than adding another', async () => {
      const jobId = await freshJob()
      await saveJobParty({}, form({ jobId, role: 'shipper', nameEn: 'First Name' }))

      const [existing] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: jobParties.id }).from(jobParties).where(eq(jobParties.jobId, jobId)),
      )
      await saveJobParty(
        {},
        form({ jobId, partyId: existing!.id, role: 'shipper', nameEn: 'Corrected Name' }),
      )

      const rows = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ nameEn: jobParties.nameEn })
          .from(jobParties)
          .where(eq(jobParties.jobId, jobId)),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.nameEn).toBe('Corrected Name')
    })

    /**
     * The index refusing, reported as a sentence. Two consignees on one bill
     * is not a variation — it is a document that cannot be issued.
     */
    it('says so plainly when the shipment already has that party', async () => {
      const jobId = await freshJob()
      await saveJobParty({}, form({ jobId, role: 'consignee', nameEn: 'First Consignee' }))

      const again = await saveJobParty(
        {},
        form({ jobId, role: 'consignee', nameEn: 'Second Consignee' }),
      )

      expect(again.message).toBe('documentsValidation.partyRoleTaken')
    })

    /** Two notify parties is normal — the index covers the principals only. */
    it('allows more than one notify party', async () => {
      const jobId = await freshJob()
      await saveJobParty({}, form({ jobId, role: 'notify', nameEn: 'Bank of Kuwait' }))
      const second = await saveJobParty(
        {},
        form({ jobId, role: 'notify', nameEn: 'Customs Broker' }),
      )

      expect(second.message).toBeUndefined()
      const rows = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: jobParties.id }).from(jobParties).where(eq(jobParties.jobId, jobId)),
      )
      expect(rows.length).toBe(2)
    })

    it('links a party to the customer record behind it', async () => {
      const jobId = await freshJob()
      await saveJobParty(
        {},
        form({ jobId, role: 'shipper', nameEn: 'Fixture Home Customer', customerId: CUSTOMER }),
      )

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ customerId: jobParties.customerId })
          .from(jobParties)
          .where(eq(jobParties.jobId, jobId)),
      )
      expect(row?.customerId).toBe(CUSTOMER)
    })

    it('links a delivery agent to the partner behind it', async () => {
      const jobId = await freshJob()
      await saveJobParty(
        {},
        form({ jobId, role: 'delivery_agent', nameEn: 'Fixture Agent', partnerId: PARTNER }),
      )

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ partnerId: jobParties.partnerId })
          .from(jobParties)
          .where(eq(jobParties.jobId, jobId)),
      )
      expect(row?.partnerId).toBe(PARTNER)
    })

    it('insists a party has a name', async () => {
      const jobId = await freshJob()
      const state = await saveJobParty({}, form({ jobId, role: 'shipper', nameEn: '' }))
      expect(state.errors?.nameEn).toBeDefined()
    })

    it('refuses a role a bill of lading does not have', async () => {
      const jobId = await freshJob()
      const state = await saveJobParty({}, form({ jobId, role: 'auditor', nameEn: 'Someone' }))
      expect(state.errors?.role).toBeDefined()
    })

    it('refuses an address that is not an email', async () => {
      const jobId = await freshJob()
      const state = await saveJobParty(
        {},
        form({ jobId, role: 'shipper', nameEn: 'Somebody', email: 'not-an-email' }),
      )
      expect(state.errors?.email).toBeDefined()
    })

    /** A blank email field is no email, not an invalid one. */
    it('treats a blank email as absent', async () => {
      const jobId = await freshJob()
      const state = await saveJobParty(
        {},
        form({ jobId, role: 'shipper', nameEn: 'No Email Here', email: '' }),
      )

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ email: jobParties.email }).from(jobParties).where(eq(jobParties.jobId, jobId)),
      )
      expect(row?.email).toBeNull()
    })

    it('refuses a caller who may not touch the shipment', async () => {
      harness.session = sessionWith(['document.generate'])
      try {
        await expect(
          saveJobParty({}, form({ jobId: await freshJob(), role: 'shipper', nameEn: 'X' })),
        ).resolves.toMatchObject({ message: expect.stringContaining('forbiddenAction') })
      } finally {
        harness.session = sessionWith(ALL)
      }
    })
  })

  describe('the cargo on a packing list', () => {
    it('records the goods as they are stencilled on the carton', async () => {
      const jobId = await freshJob()

      const state = await saveCargoLine(
        {},
        form({
          jobId,
          marksAndNumbers: 'GMT/KWI/1-40\nMADE IN KUWAIT',
          packageCount: '40',
          packageType: 'Pallets',
          descriptionEn: 'Aluminium extrusions, mill finish',
          descriptionAr: 'مقاطع ألمنيوم',
          hsCode: '7604.21',
          grossWeightKg: '18400.500',
          volumeCbm: '42.750',
        }),
      )

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select().from(jobCargo).where(eq(jobCargo.jobId, jobId)),
      )
      expect(row?.lineNo).toBe(1)
      expect(row?.packageCount).toBe(40)
      expect(row?.hsCode).toBe('7604.21')
      expect(Number(row?.grossWeightKg)).toBeCloseTo(18400.5, 3)
      expect(row?.marksAndNumbers).toContain('\n')
    })

    it('numbers a second line after the first', async () => {
      const jobId = await freshJob()
      await saveCargoLine({}, form({ jobId, descriptionEn: 'First line' }))
      await saveCargoLine({}, form({ jobId, descriptionEn: 'Second line' }))

      const rows = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ lineNo: jobCargo.lineNo })
          .from(jobCargo)
          .where(eq(jobCargo.jobId, jobId))
          .orderBy(jobCargo.lineNo),
      )
      expect(rows.map((row) => row.lineNo)).toEqual([1, 2])
    })

    /**
     * `max + 1`, not `count + 1`. With lines 1 and 7 present a count would
     * hand back 3 and quietly renumber a list somebody is holding.
     */
    it('takes the next number across a gap rather than filling it', async () => {
      const jobId = await freshJob()
      await withActor(systemActor, (tx) =>
        tx.insert(jobCargo).values([
          { jobId, lineNo: 1, descriptionEn: 'Kept' },
          { jobId, lineNo: 7, descriptionEn: 'Kept, later' },
        ]),
      )

      await saveCargoLine({}, form({ jobId, descriptionEn: 'The new one' }))

      const [added] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ lineNo: jobCargo.lineNo })
          .from(jobCargo)
          .where(eq(jobCargo.jobId, jobId))
          .orderBy(desc(jobCargo.lineNo))
          .limit(1),
      )
      expect(added?.lineNo).toBe(8)
    })

    it('edits the line it was given rather than adding another', async () => {
      const jobId = await freshJob()
      await saveCargoLine({}, form({ jobId, descriptionEn: 'Before correction' }))
      const [existing] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: jobCargo.id }).from(jobCargo).where(eq(jobCargo.jobId, jobId)),
      )

      await saveCargoLine(
        {},
        form({ jobId, cargoId: existing!.id, descriptionEn: 'After correction' }),
      )

      const rows = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ descriptionEn: jobCargo.descriptionEn })
          .from(jobCargo)
          .where(eq(jobCargo.jobId, jobId)),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.descriptionEn).toBe('After correction')
    })

    it('insists the goods are described', async () => {
      const jobId = await freshJob()
      expect((await saveCargoLine({}, form({ jobId }))).errors?.descriptionEn).toBeDefined()
    })

    it('refuses a package count that is not a whole number of packages', async () => {
      const jobId = await freshJob()
      const state = await saveCargoLine(
        {},
        form({ jobId, descriptionEn: 'Something', packageCount: '-4' }),
      )
      expect(state.errors?.packageCount).toBeDefined()
    })

    it('refuses a weight that is not a number', async () => {
      const jobId = await freshJob()
      const state = await saveCargoLine(
        {},
        form({ jobId, descriptionEn: 'Something', grossWeightKg: 'heavy' }),
      )
      expect(state.errors?.grossWeightKg).toBeDefined()
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      expect((await saveCargoLine({}, form({}))).errors).toBeDefined()
    })
  })

  describe('issuing', () => {
    const fetchMock = vi.fn()

    beforeAll(() => {
      vi.stubGlobal('fetch', fetchMock)
      vi.stubEnv('SERVICE_URL', 'http://service.test')
      vi.stubEnv('INTERNAL_API_SECRET', 'secret')

      /*
        The away branch gets a house-bill series so both halves of the
        allocator can be exercised: the home branch has none configured, which
        is a choice rather than a failure, and the away branch numbers its own.
      */
      return withActor(systemActor, (tx) =>
        tx.update(branches).set({ houseBillSeries: 'FXA' }).where(eq(branches.id, AWAY_BRANCH)),
      )
    })

    afterEach(() => {
      fetchMock.mockReset()
    })

    afterAll(() => {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    })

    const ok = () => ({ ok: true, status: 200, json: async () => ({}) })

    it('asks the service to render and store it', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue(ok())

      await issueDocument({}, form({ jobId, kind: 'packing_list', locale: 'en' }))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe(`http://service.test/internal/documents/job/${jobId}`)
      const body = JSON.parse((init as { body: string }).body)
      // `store: true` is what makes this issuing rather than previewing.
      expect(body.store).toBe(true)
      expect(body.kind).toBe('packing_list')
    })

    it('renders in Arabic when Arabic was asked for', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue(ok())

      await issueDocument({}, form({ jobId, kind: 'delivery_order', locale: 'ar' }))

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
      expect(body.locale).toBe('ar')
    })

    it('falls back to English for a locale it does not print', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue(ok())

      await issueDocument({}, form({ jobId, kind: 'delivery_order', locale: 'fr' }))

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
      expect(body.locale).toBe('en')
    })

    /**
     * Allocated *before* the render. A bill rendered before its number exists
     * carries a DRAFT watermark, and storing that as the original is the
     * mistake the watermark is there to prevent.
     */
    it('numbers a house bill before asking for the render', async () => {
      const jobId = await freshJob(AWAY_BRANCH)
      fetchMock.mockImplementation(async () => {
        const [row] = await withActor(bothBranchesActor, (tx) =>
          tx.select({ number: jobs.houseBillNumber }).from(jobs).where(eq(jobs.id, jobId)),
        )
        // The number exists by the time the service is called, not after.
        expect(row?.number).toMatch(/^FXA-\d{4}-\d{5}$/)
        return ok()
      })

      await issueDocument({}, form({ jobId, kind: 'house_bill' }))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('gives consecutive house bills consecutive numbers', async () => {
      fetchMock.mockResolvedValue(ok())
      const first = await freshJob(AWAY_BRANCH)
      const second = await freshJob(AWAY_BRANCH)

      await issueDocument({}, form({ jobId: first, kind: 'house_bill' }))
      await issueDocument({}, form({ jobId: second, kind: 'house_bill' }))

      const numbers = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: jobs.id, number: jobs.houseBillNumber }).from(jobs),
      )
      const value = (id: string) =>
        Number(numbers.find((row) => row.id === id)!.number!.split('-')[2])
      expect(value(second)).toBe(value(first) + 1)
    })

    /** A branch with no series keeps whatever was typed by hand — a choice. */
    it('leaves the number alone where the branch numbers nothing', async () => {
      const jobId = await freshJob(HOME_BRANCH)
      fetchMock.mockResolvedValue(ok())

      await issueDocument({}, form({ jobId, kind: 'house_bill' }))

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ number: jobs.houseBillNumber }).from(jobs).where(eq(jobs.id, jobId)),
      )
      expect(row?.number).toBeNull()
    })

    it('never renumbers a bill that already has a number', async () => {
      const jobId = await freshJob(AWAY_BRANCH)
      await withActor(systemActor, (tx) =>
        tx
          .update(jobs)
          .set({ houseBillNumber: `AGENT-ISSUED-118-${RUN}` })
          .where(eq(jobs.id, jobId)),
      )
      fetchMock.mockResolvedValue(ok())

      await issueDocument({}, form({ jobId, kind: 'house_bill' }))

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ number: jobs.houseBillNumber }).from(jobs).where(eq(jobs.id, jobId)),
      )
      expect(row?.number).toBe(`AGENT-ISSUED-118-${RUN}`)
    })

    it('refuses a document kind it does not produce', async () => {
      const jobId = await freshJob()
      await expect(
        issueDocument({}, form({ jobId, kind: 'certificate_of_origin' })),
      ).rejects.toThrow('Nothing to issue')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses when no shipment was named', async () => {
      await expect(issueDocument({}, form({ kind: 'packing_list' }))).rejects.toThrow(
        'Nothing to issue',
      )
    })

    /**
     * Named rather than defaulted. This fell back to `http://localhost:3001`,
     * which is right on one machine and silently wrong everywhere else — a
     * deployment missing the variable reported a connection refused, which
     * reads as "the service is down" rather than "nobody set SERVICE_URL".
     */
    it('says which variable is missing rather than dialling localhost', async () => {
      vi.stubEnv('SERVICE_URL', '')
      try {
        const state = await issueDocument(
          {},
          form({ jobId: await freshJob(), kind: 'packing_list' }),
        )
        // Returned, not thrown: production redacts a thrown message.
        expect(state.message).toBe('documentsValidation.issueNeedsService')
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        vi.stubEnv('SERVICE_URL', 'http://service.test')
      }
    })

    /**
     * The service's reason, worded from its code — it is the actionable one —
     * and never its English `message`.
     */
    it('words the service’s reason in the reader’s language', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: 'document_type_missing',
          message:
            'No seeded document type customs_pack — run pnpm db:seed visible to this principal',
          values: { kind: 'customs_pack' },
        }),
      })

      const state = await issueDocument({}, form({ jobId, kind: 'customs_pack' }))
      expect(state.message).toBe('documentsValidation.issueTypeNotSetUp:{"kind":"customs_pack"}')
    })

    it.each([
      ['not_found', 'documentsValidation.issueShipmentNotFound'],
      ['storage_failed', 'documentsValidation.issueNotStored'],
      ['unknown_kind', 'documentsValidation.issueUnknownKind'],
    ])('words the %s refusal', async (error, message) => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error, message: 'English, for the log' }),
      })

      const state = await issueDocument({}, form({ jobId, kind: 'packing_list' }))
      expect(state.message).toBe(message)
    })

    it('falls back to the status for a code it does not know, not the English', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'something_new', message: 'An English sentence' }),
      })

      const state = await issueDocument({}, form({ jobId, kind: 'packing_list' }))
      expect(state.message).toBe('documentsValidation.issueRefused:{"status":500}')
    })

    it('falls back to the status where the service said nothing', async () => {
      const jobId = await freshJob()
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json')
        },
      })

      const state = await issueDocument({}, form({ jobId, kind: 'packing_list' }))
      expect(state.message).toBe('documentsValidation.issueRefused:{"status":503}')
    })

    it('refuses a caller who may not issue documents', async () => {
      harness.session = sessionWith(['job.update'])
      try {
        await expect(
          issueDocument({}, form({ jobId: await freshJob(), kind: 'packing_list' })),
        ).resolves.toMatchObject({ message: expect.stringContaining('forbiddenAction') })
      } finally {
        harness.session = sessionWith(ALL)
      }
    })
  })

  /**
   * The panel offers the button only on a numbered sea bill, so these are the
   * stale-screen cases — somebody changed the mode or the number since it was
   * drawn. They come back as sentences, not as an error page.
   */
  describe('surrendering the bill', () => {
    beforeAll(() => {
      harness.session = sessionWith([...ALL, 'document.release'])
    })

    afterAll(() => {
      harness.session = sessionWith(ALL)
    })

    it('asks for the bill to be issued before it is surrendered', async () => {
      const state = await surrenderHouseBill({}, form({ jobId: await freshJob() }))
      expect(state.message).toBe('documentsValidation.surrenderNotIssued')
    })

    it('refuses an air waybill, which has no originals to hand back', async () => {
      const jobId = await freshJob()
      await withActor(systemActor, (tx) =>
        tx
          .update(jobs)
          .set({ mode: 'air', houseBillNumber: `AWB-118-${RUN}` })
          .where(eq(jobs.id, jobId)),
      )

      const state = await surrenderHouseBill({}, form({ jobId }))

      expect(state.message).toBe('documentsValidation.surrenderAirWaybill')
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ at: jobs.houseBillSurrenderedAt }).from(jobs).where(eq(jobs.id, jobId)),
      )
      expect(row?.at).toBeNull()
    })

    it('records a numbered sea bill as surrendered', async () => {
      const jobId = await freshJob()
      await withActor(systemActor, (tx) =>
        tx
          .update(jobs)
          .set({ houseBillNumber: `HBL-118-${RUN}` })
          .where(eq(jobs.id, jobId)),
      )

      const state = await surrenderHouseBill({}, form({ jobId }))

      expect(state.message).toBeUndefined()
      expect(state.ok).toBeDefined()
    })
  })
})
