/**
 * The enquiry queue — where work enters the business.
 *
 * Three properties carry the slice, and each is a decision that could
 * reasonably have gone the other way:
 *
 * **The SLA clock is computed once, at creation, through the branch's own
 * calendar.** Kuwait, Qatar and the UAE share neither a weekend nor a holiday
 * list, so a due time computed against the wrong calendar is wrong by days
 * rather than minutes — and it is stored, not derived on read, so the
 * escalation job every fifteen minutes compares two timestamps instead of
 * recomputing a calendar for every open enquiry.
 *
 * **The first response stops the clock exactly once.** `coalesce` rather than a
 * plain set: a coordinator who replies twice has not answered faster, and a
 * second write would quietly reset the only number the SLA report is about.
 *
 * **A loss must say why.** `lostReason` is the whole point of recording the
 * loss — an enquiry closed `lost` with no reason is a row that tells nobody
 * anything, and this is the only place that answer is ever captured.
 *
 * The outbox row is written in the same transaction as the enquiry. Asserted
 * here rather than assumed, because a notification for a write that rolled
 * back is the failure a transactional outbox exists to make impossible.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

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

const {
  aiInvocations,
  commodities,
  enquiries,
  extractionProposals,
  notificationOutbox,
  rateRequests,
  withActor,
} = await import('@qabandi/db')

const {
  AWAY_BRANCH,
  CUSTOMER,
  DESTINATION,
  HOME_BRANCH,
  ORIGIN,
  PARTNER,
  PRINCIPAL,
  bothBranchesActor,
  world,
} = await import('@/lib/testing/fixtures')

const {
  submitEnquiry,
  assignEnquiryAction,
  respondEnquiryAction,
  closeEnquiryAction,
  advanceEnquiry,
  acceptProposal,
  acceptAllProposals,
  setEnquiryContainerCount,
  updateEnquiry,
} = await import('./form-actions')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Enquiry Desk',
    nameAr: null,
    email: 'enquiries@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['enquiry.assign', 'enquiry.close', 'enquiry.rate']),
  branchRoles: new Map([
    [HOME_BRANCH, 'sales'],
    [AWAY_BRANCH, 'sales'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const enquiryForm = (extra: Record<string, string> = {}) =>
  form({
    branchId: HOME_BRANCH,
    customerId: CUSTOMER,
    channel: 'email',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    ...extra,
  })

/**
 * One named enquiry, by id.
 *
 * Deliberately not "the most recent one in this branch": the sibling suites in
 * this slice write home-branch enquiries too, they run in parallel, and
 * "newest" was sometimes theirs. `submitEnquiry` hands back the reference it
 * allocated, which is the only handle that identifies the row it wrote.
 */
async function readEnquiry(id: string) {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({
        id: enquiries.id,
        reference: enquiries.reference,
        status: enquiries.status,
        ownerId: enquiries.ownerId,
        slaStartedAt: enquiries.slaStartedAt,
        slaDueAt: enquiries.slaDueAt,
        firstRespondedAt: enquiries.firstRespondedAt,
        lostReason: enquiries.lostReason,
        closedAt: enquiries.closedAt,
      })
      .from(enquiries)
      .where(eq(enquiries.id, id))
      .limit(1),
  )
  return row!
}

/** Raises one and reads back exactly the row it raised. */
async function raise(extra: Record<string, string> = {}) {
  const state = await submitEnquiry({}, enquiryForm(extra))
  expect(state.errors).toBeUndefined()

  // `succeed(reference)` returns `"<reference>:<sequence>"` — the counter that
  // makes two identical successes distinguishable to React.
  const reference = String(state.ok).replace(/:\d+$/, '')
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx.select({ id: enquiries.id }).from(enquiries).where(eq(enquiries.reference, reference)),
  )
  return readEnquiry(row!.id)
}

describe.skipIf(!enabled)('the enquiry queue', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  describe('taking an enquiry', () => {
    it('raises one and numbers it', async () => {
      const row = await raise()

      // `FXH-ENQ-2026-00001` — branch, kind, year, sequence.
      expect(row.reference).toMatch(/^FXH-ENQ-\d{4}-\d{5}$/)
      expect(row.status).toBe('new')
    })

    /**
     * One sequence across every branch, so a branch's own numbers have gaps —
     * fine for a handle people say on the phone, and not fine for an invoice
     * series where a gap reads as a deleted document (FR-ID-01).
     *
     * This and the away-branch case below moved here when the duplicate
     * `actions.ts` was removed: both cover `nextReference`, which that file
     * carried its own copy of, and this is now the only copy.
     */
    it('never issues the same number twice', async () => {
      const first = await raise()
      const second = await raise()

      expect(second.reference).not.toBe(first.reference)
    })

    it('numbers an away-branch enquiry with the away branch code', async () => {
      const row = await raise({ branchId: AWAY_BRANCH })

      expect(row.reference).toMatch(/^FXA-ENQ-/)
    })

    /**
     * The clock is stored, not derived. Four working hours from now through
     * the branch's calendar, which is never four wall-clock hours across a
     * weekend.
     */
    it('starts the SLA clock and stores when it is due', async () => {
      const row = await raise()

      expect(row.slaStartedAt).toBeInstanceOf(Date)
      expect(row.slaDueAt).toBeInstanceOf(Date)
      expect(row.slaDueAt!.getTime()).toBeGreaterThan(row.slaStartedAt!.getTime())
    })

    it('writes the outbox row in the same transaction', async () => {
      const row = await raise()

      const events = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ key: notificationOutbox.eventKey })
          .from(notificationOutbox)
          .where(eq(notificationOutbox.enquiryId, row.id)),
      )
      expect(events.map((event) => event.key)).toContain('enquiry.created')
    })

    /**
     * A lead from a company nobody has shipped for is the normal state of a new
     * enquiry (FR-EQ-02), so a contact email stands in for a customer row.
     */
    it('accepts a lead with a contact email and no customer', async () => {
      const state = await submitEnquiry(
        {},
        form({
          branchId: HOME_BRANCH,
          contactName: 'Yousef Al-Sabah',
          contactEmail: 'yousef@example.com',
          channel: 'email',
        }),
      )
      expect(state.errors).toBeUndefined()
    })

    it('refuses one with neither a customer nor a way to reply', async () => {
      const state = await submitEnquiry({}, form({ branchId: HOME_BRANCH, channel: 'email' }))
      expect(state.errors?.customerId).toBeDefined()
    })

    /** A lane with the same port at both ends is a typing mistake, every time. */
    it('refuses a lane that starts where it ends', async () => {
      const state = await submitEnquiry(
        {},
        enquiryForm({ originId: ORIGIN, destinationId: ORIGIN }),
      )
      expect(state.errors?.destinationId).toBeDefined()
    })

    /** U6. "1e3" was answered with "not a floating-point number", in English. */
    it('refuses an exponent as a weight, in the catalogue’s words', async () => {
      const state = await submitEnquiry({}, enquiryForm({ grossWeightKg: '1e3' }))
      expect(state.errors?.grossWeightKg).toBe('enquiriesValidation.weightAmount')
    })

    it('accepts a lane with two different ends', async () => {
      const state = await submitEnquiry(
        {},
        enquiryForm({ originId: ORIGIN, destinationId: DESTINATION }),
      )
      expect(state.errors).toBeUndefined()
    })

    it('records the cargo figures and the dangerous-goods flag', async () => {
      const raised = await raise({
        grossWeightKg: '2400.500',
        volumeCbm: '18.750',
        pieces: '12',
        isDangerous: 'on',
      })

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            weight: enquiries.grossWeightKg,
            volume: enquiries.volumeCbm,
            pieces: enquiries.pieces,
            dangerous: enquiries.isDangerous,
          })
          .from(enquiries)
          .where(eq(enquiries.id, raised.id)),
      )
      expect(Number(row!.weight)).toBeCloseTo(2400.5, 3)
      expect(row!.pieces).toBe(12)
      expect(row!.dangerous).toBe(true)
    })

    /*
      Sea FCL is priced per container and refuses without a count. An enquiry
      that arrived by email or WhatsApp has no other way to get one than this
      field on its page.
    */
    it('records a container count set on the enquiry page', async () => {
      const raised = await raise()
      const count = async () =>
        (
          await withActor(bothBranchesActor, (tx) =>
            tx
              .select({ n: enquiries.containerCount })
              .from(enquiries)
              .where(eq(enquiries.id, raised.id)),
          )
        )[0]!.n

      const state = await setEnquiryContainerCount(
        {},
        form({ enquiryId: raised.id, containerCount: '3' }),
      )
      expect(state.errors).toBeUndefined()
      expect(await count()).toBe(3)

      for (const bad of ['0', '2.5', 'two', '']) {
        const refused = await setEnquiryContainerCount(
          {},
          form({ enquiryId: raised.id, containerCount: bad }),
        )
        expect(refused.errors?.containerCount).toBe('enquiriesValidation.containerCountWhole')
      }
      expect(await count()).toBe(3)
    })

    /** The form is only shown on an open sea FCL enquiry; the action agrees (R6). */
    it('refuses a container count on an enquiry that is not sea FCL', async () => {
      const raised = await raise({ mode: 'air' })

      const state = await setEnquiryContainerCount(
        {},
        form({ enquiryId: raised.id, containerCount: '2' }),
      )

      expect(state.message).toBe('enquiriesValidation.containerCountNotHere')
    })

    it('refuses a count past the ceiling the other paths keep', async () => {
      const state = await submitEnquiry({}, enquiryForm({ containerCount: '3000000000' }))
      expect(state.errors?.containerCount).toBe('enquiriesValidation.containerCountWhole')
    })

    /**
     * A reply read before the count was entered had every per-container line
     * unpriced, and stayed "partial" — unranked — after the count was set (R1).
     * Setting the count re-prices it from the lines it stored.
     */
    it('re-prices the replies already read when the count is entered', async () => {
      const raised = await raise()
      const token = `r1-${Date.now().toString(36)}`
      await withActor({ ...bothBranchesActor, type: 'system' }, (tx) =>
        tx.insert(rateRequests).values({
          branchId: HOME_BRANCH,
          enquiryId: raised.id,
          partnerId: PARTNER,
          status: 'parsed',
          token,
          quotedTotal: '60',
          quotedCurrency: 'USD',
          response: {
            ok: true,
            unpriced: 1,
            rows: [
              {
                mode: 'sea_fcl',
                originCode: 'KWFX1',
                destinationCode: 'AEFX1',
                currency: 'USD',
                validFrom: '2035-01-01',
                validTo: null,
                chargeCode: 'ocean_freight',
                basis: 'per_container',
                rate: '1850',
                minimum: null,
                maximum: null,
                containerType: null,
                transitDays: null,
                notes: null,
              },
              {
                mode: 'sea_fcl',
                originCode: 'KWFX1',
                destinationCode: 'AEFX1',
                currency: 'USD',
                validFrom: '2035-01-01',
                validTo: null,
                chargeCode: 'documentation',
                basis: 'flat',
                rate: '60',
                minimum: null,
                maximum: null,
                containerType: null,
                transitDays: null,
                notes: null,
              },
            ],
          },
        }),
      )

      await setEnquiryContainerCount({}, form({ enquiryId: raised.id, containerCount: '2' }))

      const [stored] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ total: rateRequests.quotedTotal, response: rateRequests.response })
          .from(rateRequests)
          .where(eq(rateRequests.token, token)),
      )
      // 2 × 1,850 + 60 — was the 60 flat fee alone.
      expect(stored!.total).toBe('3760.000000')
      expect(stored!.response).toMatchObject({ unpriced: 0, partial: 0 })
    })

    /** An unchecked box arrives absent, not as `false` — the usual HTML trap. */
    it('reads an absent dangerous-goods box as not dangerous', async () => {
      const row = await raise()
      const [stored] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ dangerous: enquiries.isDangerous })
          .from(enquiries)
          .where(eq(enquiries.id, row.id)),
      )
      expect(stored!.dangerous).toBe(false)
    })

    it('refuses a branch the desk does not hold', async () => {
      await expect(
        submitEnquiry({}, enquiryForm({ branchId: '00000000-0000-7000-8000-0000000000fb' })),
      ).resolves.toMatchObject({ message: expect.stringContaining('forbiddenAction') })
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      expect((await submitEnquiry({}, form({}))).errors).toBeDefined()
    })
  })

  describe('handing it to someone', () => {
    it('assigns a new enquiry and moves it on', async () => {
      const row = await raise()

      const state = await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      expect(state.errors).toBeUndefined()
      const after = await readEnquiry(row.id)
      expect(after.status).toBe('assigned')
      expect(after.ownerId).toBe(PRINCIPAL)
    })

    /**
     * Reassignment is not a transition. The machine governs the first move out
     * of `new`; after that, handing the work to someone else is an everyday
     * correction and refusing it would send people back to the database.
     */
    it('reassigns an assigned enquiry without refusing it', async () => {
      const row = await raise()
      await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      const again = await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      expect(again.errors).toBeUndefined()
      expect((await readEnquiry(row.id)).status).toBe('assigned')
    })

    it('asks who should own it when nobody was chosen', async () => {
      const row = await raise()
      const state = await assignEnquiryAction({}, form({ enquiryId: row.id }))
      expect(state.errors?.ownerId).toBeDefined()
    })

    /** Invisible under RLS is not-found, not forbidden — no enumeration signal. */
    it('treats an enquiry in nobody’s branch as missing', async () => {
      await expect(
        assignEnquiryAction(
          {},
          form({ enquiryId: '00000000-0000-7000-8000-0000000000fc', ownerId: PRINCIPAL }),
        ),
      ).rejects.toThrow('not_found')
    })
  })

  describe('stopping the clock', () => {
    it('records the first reply', async () => {
      const row = await raise()
      expect(row.firstRespondedAt).toBeNull()

      const state = await respondEnquiryAction({}, form({ enquiryId: row.id }))

      expect(state.errors).toBeUndefined()
      expect((await readEnquiry(row.id)).firstRespondedAt).toBeInstanceOf(Date)
    })

    /**
     * `coalesce`, not a plain set. Replying twice does not make the answer
     * faster, and overwriting would silently improve the only number the SLA
     * report is about.
     */
    it('keeps the first reply time when someone replies again', async () => {
      const row = await raise()
      await respondEnquiryAction({}, form({ enquiryId: row.id }))
      const first = (await readEnquiry(row.id)).firstRespondedAt

      await respondEnquiryAction({}, form({ enquiryId: row.id }))

      expect((await readEnquiry(row.id)).firstRespondedAt?.getTime()).toBe(first?.getTime())
    })

    it('says so plainly when no enquiry was named', async () => {
      expect((await respondEnquiryAction({}, form({}))).errors).toBeDefined()
    })
  })

  describe('closing it', () => {
    it('closes an assigned enquiry as lost, with the reason', async () => {
      const row = await raise()
      await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      const state = await closeEnquiryAction(
        {},
        form({ enquiryId: row.id, outcome: 'lost', reason: 'Rate beaten by the incumbent' }),
      )

      expect(state.errors).toBeUndefined()
      const after = await readEnquiry(row.id)
      expect(after.status).toBe('lost')
      expect(after.lostReason).toBe('Rate beaten by the incumbent')
      expect(after.closedAt).toBeInstanceOf(Date)
    })

    /** The reason is the data. A loss with no reason tells nobody anything. */
    it('refuses a loss with no reason', async () => {
      const row = await raise()
      const state = await closeEnquiryAction({}, form({ enquiryId: row.id, outcome: 'lost' }))

      expect(state.errors?.reason).toBeDefined()
      expect((await readEnquiry(row.id)).status).toBe('new')
    })

    it('insists on won or lost, not something else', async () => {
      const row = await raise()
      const state = await closeEnquiryAction(
        {},
        form({ enquiryId: row.id, outcome: 'maybe', reason: 'unsure' }),
      )
      expect(state.errors?.outcome).toBeDefined()
    })

    /**
     * `won` is only reachable from `quoted` — a customer cannot accept a price
     * nobody sent them. The machine refuses it, and the action says so against
     * the field (S1): thrown, it reached the error page, which production
     * redacts to "something went wrong".
     */
    it('refuses a win on an enquiry nobody has quoted, with a sentence', async () => {
      const row = await raise()
      await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      const state = await closeEnquiryAction({}, form({ enquiryId: row.id, outcome: 'won' }))

      expect(state.errors?.outcome).toBe('enquiriesValidation.wonNeedsQuoted')
      expect((await readEnquiry(row.id)).status).toBe('assigned')
    })

    /** `new → lost` is not a move the machine has; it crashed the same way (S1). */
    it('refuses to close a new enquiry as lost, with a sentence', async () => {
      const row = await raise()

      const state = await closeEnquiryAction(
        {},
        form({ enquiryId: row.id, outcome: 'lost', reason: 'Went elsewhere' }),
      )

      expect(state.errors?.outcome).toBe('enquiriesValidation.lostNotYet')
      expect((await readEnquiry(row.id)).status).toBe('new')
    })

    it('records a win once the price has been quoted', async () => {
      const row = await raise()
      await withActor({ ...bothBranchesActor, type: 'system' }, (tx) =>
        tx.update(enquiries).set({ status: 'quoted' }).where(eq(enquiries.id, row.id)),
      )

      const state = await closeEnquiryAction({}, form({ enquiryId: row.id, outcome: 'won' }))

      expect(state.errors).toBeUndefined()
      const after = await readEnquiry(row.id)
      expect(after.status).toBe('won')
      // Nothing was lost, so there is nothing to explain.
      expect(after.lostReason).toBeNull()
    })
  })

  /**
   * Back to rating — reached from two states, on two different keys.
   *
   * `entryPermission` cannot answer "what does reaching rating need" because
   * the answer depends on where from, and asking it anyway made "Start rating"
   * a 500 for everyone (QA P1-1). The transition taken decides.
   */
  describe('starting to price it', () => {
    const toQuoted = (id: string) =>
      withActor({ ...bothBranchesActor, type: 'system' }, (tx) =>
        tx.update(enquiries).set({ status: 'quoted' }).where(eq(enquiries.id, id)),
      )

    it('starts rating an assigned enquiry on enquiry.rate', async () => {
      const row = await raise()
      await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))

      const state = await advanceEnquiry({}, form({ enquiryId: row.id, to: 'rating' }))

      expect(state.message).toBeUndefined()
      expect(state.ok).toBeDefined()
      expect((await readEnquiry(row.id)).status).toBe('rating')
    })

    it('refuses to reopen a quoted enquiry without quote.revise, with a sentence', async () => {
      const row = await raise()
      await toQuoted(row.id)

      // enquiry.rate is held, and it is not the key for this move.
      const state = await advanceEnquiry({}, form({ enquiryId: row.id, to: 'rating' }))

      expect(state.message).toBe('enquiriesValidation.notPermitted')
      expect((await readEnquiry(row.id)).status).toBe('quoted')
    })

    it('reopens a quoted enquiry for revision on quote.revise', async () => {
      const row = await raise()
      await toQuoted(row.id)
      harness.session = {
        ...session,
        permissions: new Set(['enquiry.assign', 'quote.revise']),
      }
      try {
        const state = await advanceEnquiry({}, form({ enquiryId: row.id, to: 'rating' }))
        expect(state.ok).toBeDefined()
      } finally {
        harness.session = session
      }
      expect((await readEnquiry(row.id)).status).toBe('rating')
    })

    it('refuses rating from new, which the machine does not allow', async () => {
      const row = await raise()
      const state = await advanceEnquiry({}, form({ enquiryId: row.id, to: 'rating' }))
      expect(state.message).toBe('enquiriesValidation.illegalTransition')
    })
  })

  /**
   * The one-click fill — accepting every open suggestion at once.
   *
   * The rule that carries it is never-overwrite: a field a person filled between
   * the model reading the mail and this click is left alone, not overwritten,
   * and an unresolvable suggestion is skipped and counted rather than failing
   * the batch. Both are checked against real rows, because both are `where`
   * clauses and a state machine the database enforces.
   */
  describe('accepting what a model read, in one click', () => {
    // Every proposal cites the invocation that produced it — the column is not null.
    let invocationId: string
    beforeAll(async () => {
      invocationId = await withActor({ ...bothBranchesActor, type: 'system' }, async (tx) => {
        const [row] = await tx
          .insert(aiInvocations)
          .values({
            branchId: HOME_BRANCH,
            principalId: bothBranchesActor.principalId,
            surface: 'enquiry_extract',
            modelRequested: 'test-model',
            promptVersion: 'test',
            inputHash: `accept-all-${Date.now()}`,
          })
          .returning({ id: aiInvocations.id })
        return row!.id
      })
    })

    async function propose(
      enquiryId: string,
      entries: readonly { field: string; value: string }[],
    ) {
      await withActor({ ...bothBranchesActor, type: 'system' }, async (tx) => {
        for (const entry of entries) {
          await tx.insert(extractionProposals).values({
            branchId: HOME_BRANCH,
            invocationId,
            targetTable: 'enquiries',
            targetId: enquiryId,
            field: entry.field,
            value: entry.value,
            status: 'proposed',
            confidence: '0.9',
          })
        }
      })
    }

    const fieldsOf = async (enquiryId: string) => {
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            incoterm: enquiries.incoterm,
            pieces: enquiries.pieces,
            containerCount: enquiries.containerCount,
            grossWeightKg: enquiries.grossWeightKg,
          })
          .from(enquiries)
          .where(eq(enquiries.id, enquiryId))
          .limit(1),
      )
      return row!
    }

    const statuses = (enquiryId: string) =>
      withActor(bothBranchesActor, (tx) =>
        tx
          .select({ field: extractionProposals.field, status: extractionProposals.status })
          .from(extractionProposals)
          .where(eq(extractionProposals.targetId, enquiryId)),
      )

    it('applies every open suggestion and closes each one', async () => {
      const row = await raise()
      await propose(row.id, [
        { field: 'incoterm', value: 'CIF' },
        { field: 'grossWeightKg', value: '1200.500' },
        { field: 'pieces', value: '10' },
      ])

      const state = await acceptAllProposals({}, form({ enquiryId: row.id }))

      // `succeed(String(applied))` — three applied, tokenised.
      expect(state.ok).toMatch(/^3:/)
      const fields = await fieldsOf(row.id)
      expect(fields.incoterm).toBe('CIF')
      expect(Number(fields.grossWeightKg)).toBeCloseTo(1200.5, 3)
      expect(fields.pieces).toBe(10)
      expect((await statuses(row.id)).every((p) => p.status === 'applied')).toBe(true)
    })

    /**
     * The field a person already filled is left as they left it, and the
     * proposal for it stays open for them to look at.
     */
    it('does not overwrite a field a person has already filled', async () => {
      const row = await raise({ incoterm: 'FOB' })
      await propose(row.id, [
        { field: 'incoterm', value: 'CIF' },
        { field: 'pieces', value: '5' },
      ])

      const state = await acceptAllProposals({}, form({ enquiryId: row.id }))

      // One applied (pieces), one skipped (incoterm was authored).
      expect(state.ok).toMatch(/^1:/)
      const fields = await fieldsOf(row.id)
      expect(fields.incoterm).toBe('FOB')
      expect(fields.pieces).toBe(5)
    })

    /**
     * A dangerous-goods flag a person set is not cleared by a model reading
     * "not dangerous" (S20) — the column was never read, so it always looked
     * empty. An unset flag can still be raised.
     */
    it('never clears a dangerous-goods flag a person set, but can raise one', async () => {
      const flagged = await raise({ isDangerous: 'on' })
      await propose(flagged.id, [{ field: 'isDangerous', value: 'false' }])
      const plain = await raise()
      await propose(plain.id, [{ field: 'isDangerous', value: 'true' }])

      await acceptAllProposals({}, form({ enquiryId: flagged.id }))
      await acceptAllProposals({}, form({ enquiryId: plain.id }))

      const dangerous = async (id: string) =>
        (
          await withActor(bothBranchesActor, (tx) =>
            tx.select({ d: enquiries.isDangerous }).from(enquiries).where(eq(enquiries.id, id)),
          )
        )[0]!.d
      expect(await dangerous(flagged.id)).toBe(true)
      expect(await dangerous(plain.id)).toBe(true)
    })

    /** A suggestion that will not resolve is skipped, not fatal to the rest. */
    it('skips an unresolvable suggestion and applies the others', async () => {
      const row = await raise()
      await propose(row.id, [
        { field: 'origin', value: 'Nowhereville-on-Sea' },
        { field: 'pieces', value: '7' },
      ])

      const state = await acceptAllProposals({}, form({ enquiryId: row.id }))

      expect(state.ok).toMatch(/^1:/)
      expect((await fieldsOf(row.id)).pieces).toBe(7)
    })

    /**
     * F50: a container count the model read lands in `container_count`, which
     * is what FCL pricing multiplies by — not in `pieces`, which counts packages.
     */
    it('writes an accepted container count to the container column', async () => {
      const row = await raise()
      await propose(row.id, [{ field: 'containerCount', value: '2' }])
      const [open] = await statuses(row.id)
      expect(open?.field).toBe('containerCount')
      const [proposal] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ id: extractionProposals.id })
          .from(extractionProposals)
          .where(eq(extractionProposals.targetId, row.id))
          .limit(1),
      )

      const state = await acceptProposal({}, form({ proposalId: proposal!.id, enquiryId: row.id }))

      expect(state.errors).toBeUndefined()
      expect(state.message).toBeUndefined()
      const fields = await fieldsOf(row.id)
      expect(fields.containerCount).toBe(2)
      expect(fields.pieces).toBeNull()
      expect((await statuses(row.id))[0]?.status).toBe('applied')
    })

    /**
     * Zero is refused before the write rather than by the 0048 constraint, so
     * the coordinator reads a sentence instead of a server error.
     */
    it('refuses a container count of zero and leaves the suggestion open', async () => {
      const row = await raise()
      await propose(row.id, [{ field: 'containerCount', value: '0' }])

      const state = await acceptAllProposals({}, form({ enquiryId: row.id }))

      expect(state.message).toBe('enquiriesValidation.noneApplied')
      expect((await fieldsOf(row.id)).containerCount).toBeNull()
      expect((await statuses(row.id))[0]?.status).toBe('proposed')
    })

    /** When nothing could be applied, it says so rather than claiming success. */
    it('reports when every suggestion was already overtaken', async () => {
      const row = await raise({ incoterm: 'FOB' })
      await propose(row.id, [{ field: 'incoterm', value: 'CIF' }])

      const state = await acceptAllProposals({}, form({ enquiryId: row.id }))

      expect(state.ok).toBeUndefined()
      expect(state.message).toBe('enquiriesValidation.noneApplied')
    })

    it('asks for an enquiry when none was named', async () => {
      const state = await acceptAllProposals({}, form({}))
      expect(state.message).toBe('enquiriesValidation.nothingToDo')
    })
  })

  /*
    D4: an open enquiry's facts can be corrected after it arrived, under the
    rules that raised it, and a hand edit settles what the model proposed for
    the field it changed.
  */
  describe('editing an open enquiry', () => {
    let invocationId: string
    let commodityId: string
    beforeAll(async () => {
      invocationId = await withActor({ ...bothBranchesActor, type: 'system' }, async (tx) => {
        const [row] = await tx
          .insert(aiInvocations)
          .values({
            branchId: HOME_BRANCH,
            principalId: bothBranchesActor.principalId,
            surface: 'enquiry_extract',
            modelRequested: 'test-model',
            promptVersion: 'test',
            inputHash: `edit-${Date.now()}`,
          })
          .returning({ id: aiInvocations.id })
        return row!.id
      })
      const [commodity] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: commodities.id }).from(commodities).limit(1),
      )
      if (!commodity) throw new Error('Run `pnpm db:seed` before this suite')
      commodityId = commodity.id
    })

    const editForm = (id: string, extra: Record<string, string> = {}) =>
      form({
        enquiryId: id,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        ...extra,
      })

    const facts = async (id: string) => {
      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            commodityId: enquiries.commodityId,
            originId: enquiries.originId,
            destinationId: enquiries.destinationId,
            grossWeightKg: enquiries.grossWeightKg,
            containerType: enquiries.containerType,
            incoterm: enquiries.incoterm,
            branchId: enquiries.branchId,
            channel: enquiries.channel,
          })
          .from(enquiries)
          .where(eq(enquiries.id, id))
          .limit(1),
      )
      return row!
    }

    async function propose(enquiryId: string, field: string, value: string) {
      await withActor({ ...bothBranchesActor, type: 'system' }, (tx) =>
        tx.insert(extractionProposals).values({
          branchId: HOME_BRANCH,
          invocationId,
          targetTable: 'enquiries',
          targetId: enquiryId,
          field,
          value,
          status: 'proposed',
          confidence: '0.9',
        }),
      )
    }

    const proposalsOf = (enquiryId: string) =>
      withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            field: extractionProposals.field,
            status: extractionProposals.status,
            decidedById: extractionProposals.decidedById,
            closedAt: extractionProposals.closedAt,
          })
          .from(extractionProposals)
          .where(eq(extractionProposals.targetId, enquiryId)),
      )

    it('corrects the commodity, the lane and the cargo, and keeps branch and channel', async () => {
      const row = await raise()

      const state = await updateEnquiry(
        {},
        editForm(row.id, {
          commodityId,
          originId: ORIGIN,
          destinationId: DESTINATION,
          grossWeightKg: '1250.5',
          containerType: '40hc',
          incoterm: 'FOB',
          branchId: AWAY_BRANCH,
          channel: 'whatsapp',
        }),
      )

      expect(state.errors).toBeUndefined()
      expect(state.message).toBeUndefined()
      const after = await facts(row.id)
      expect(after.commodityId).toBe(commodityId)
      expect(after.originId).toBe(ORIGIN)
      expect(after.destinationId).toBe(DESTINATION)
      expect(after.grossWeightKg).toMatch(/^1250\.50*$/)
      expect(after.containerType).toBe('40HC')
      expect(after.incoterm).toBe('FOB')
      // Never read off the form: an edit does not move an enquiry or rewrite how it came.
      expect(after.branchId).toBe(HOME_BRANCH)
      expect(after.channel).toBe('email')
    })

    it('refuses what raising one refuses, in the same words', async () => {
      const row = await raise()

      const weight = await updateEnquiry({}, editForm(row.id, { grossWeightKg: '1e3' }))
      expect(weight.errors?.grossWeightKg).toBe('enquiriesValidation.weightAmount')

      const lane = await updateEnquiry(
        {},
        editForm(row.id, { originId: ORIGIN, destinationId: ORIGIN }),
      )
      expect(lane.errors?.destinationId).toBe('enquiriesValidation.originDestinationDiffer')

      const nobody = await updateEnquiry({}, form({ enquiryId: row.id }))
      expect(nobody.errors?.customerId).toBe('enquiriesValidation.customerOrEmail')

      const box = await updateEnquiry({}, editForm(row.id, { containerType: 'NOPE' }))
      expect(box.errors?.containerType).toBe('enquiriesValidation.containerTypeUnknown')

      expect((await facts(row.id)).originId).toBeNull()
    })

    it('refuses a closed enquiry, and leaves it as it was', async () => {
      const row = await raise()
      await assignEnquiryAction({}, form({ enquiryId: row.id, ownerId: PRINCIPAL }))
      await closeEnquiryAction(
        {},
        form({ enquiryId: row.id, outcome: 'lost', reason: 'Went elsewhere' }),
      )

      const state = await updateEnquiry({}, editForm(row.id, { incoterm: 'CIF' }))

      expect(state.message).toBe('enquiriesValidation.editClosed')
      expect((await facts(row.id)).incoterm).toBeNull()
    })

    it('refuses an enquiry in a branch where the editor only reads', async () => {
      const row = await raise({ branchId: AWAY_BRANCH })
      harness.session = {
        ...session,
        branchPermissions: new Map([
          [HOME_BRANCH, new Set(['enquiry.assign'])],
          [AWAY_BRANCH, new Set(['enquiry.read'])],
        ]),
      }
      try {
        const state = await updateEnquiry({}, editForm(row.id, { incoterm: 'CIF' }))
        expect(state.message).toEqual(expect.stringContaining('forbiddenAction'))
      } finally {
        harness.session = session
      }
      expect((await facts(row.id)).incoterm).toBeNull()
    })

    it('settles the proposal for a field set by hand, and leaves the others open', async () => {
      const row = await raise()
      await propose(row.id, 'commodity', 'steel pipes')
      await propose(row.id, 'incoterm', 'CIF')

      const state = await updateEnquiry({}, editForm(row.id, { commodityId }))
      expect(state.errors).toBeUndefined()

      const proposals = await proposalsOf(row.id)
      const commodity = proposals.find((p) => p.field === 'commodity')!
      expect(commodity.status).toBe('superseded')
      expect(commodity.decidedById).toBe(PRINCIPAL)
      expect(commodity.closedAt).toBeInstanceOf(Date)
      // Untouched by this edit, so still waiting for a person.
      expect(proposals.find((p) => p.field === 'incoterm')!.status).toBe('proposed')
    })

    it('leaves a proposal open when its field was saved unchanged', async () => {
      const row = await raise({ grossWeightKg: '2400.5' })
      await propose(row.id, 'grossWeightKg', '2500')

      // The column reads back as 2400.500000; the form sends what a person sees.
      await updateEnquiry({}, editForm(row.id, { grossWeightKg: '2400.50' }))

      expect((await proposalsOf(row.id))[0]!.status).toBe('proposed')
    })

    /*
      The dialog is filled when the page loads and posts every field. Opened
      before "Accept all", it carried the empty values the suggestions then
      filled, and saving it cleared them; its version is what tells the two
      apart.
    */
    it('refuses a form filled before the suggestions were accepted, and keeps them', async () => {
      const row = await raise()
      const versionOf = async () => {
        const [current] = await withActor(bothBranchesActor, (tx) =>
          tx
            .select({ updatedAt: enquiries.updatedAt })
            .from(enquiries)
            .where(eq(enquiries.id, row.id))
            .limit(1),
        )
        return current!.updatedAt.toISOString()
      }
      const opened = await versionOf()
      await propose(row.id, 'incoterm', 'CIF')
      expect((await acceptAllProposals({}, form({ enquiryId: row.id }))).ok).toBeTruthy()

      const stale = await updateEnquiry({}, editForm(row.id, { version: opened }))
      expect(stale.message).toBe('enquiriesValidation.editStale')
      expect((await facts(row.id)).incoterm).toBe('CIF')

      // The refreshed form carries the new version, and that one saves.
      const fresh = await updateEnquiry(
        {},
        editForm(row.id, { version: await versionOf(), incoterm: 'CIF', grossWeightKg: '900' }),
      )
      expect(fresh.message).toBeUndefined()
      expect(fresh.errors).toBeUndefined()
      expect((await facts(row.id)).grossWeightKg).toMatch(/^900\.?0*$/)
    })

    /*
      A WhatsApp lead from an unknown number has no customer and no email: its
      way to answer is the thread. Editing one must not demand a customer.
    */
    it('saves a WhatsApp enquiry with no customer and no email', async () => {
      const row = await raise()
      await withActor({ ...bothBranchesActor, type: 'system' }, (tx) =>
        tx
          .update(enquiries)
          .set({ channel: 'whatsapp', customerId: null, contactEmail: null })
          .where(eq(enquiries.id, row.id)),
      )

      const state = await updateEnquiry({}, form({ enquiryId: row.id, incoterm: 'EXW' }))

      expect(state.errors).toBeUndefined()
      expect((await facts(row.id)).incoterm).toBe('EXW')
    })
  })
})
