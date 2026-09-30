/**
 * Groupage — the master, the houses under it, and splitting one cost across them.
 *
 * The allocation is the part that decides whether the margin on house eleven
 * is real, and its arithmetic is `core/allocation.ts`, tested exhaustively
 * there against no infrastructure. What is tested here is everything the
 * engine cannot see: that a cost is split only once, that reversing it puts
 * the houses back, and that a master which has been closed does not quietly
 * accept another house.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'

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

const { chargeLines, consolidations, consolChargeLines, jobCargo, jobs, withActor } =
  await import('@qabandi/db')

const { HOME_BRANCH, AWAY_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const {
  saveConsolidation,
  attachHouse,
  detachHouse,
  closeConsolidation,
  addConsolCharge,
  allocateConsolCharge,
  reverseConsolAllocation,
} = await import('./form-actions')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Consol Test',
    nameAr: null,
    email: 'consol@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['consol.write', 'consol.allocate', 'job.update']),
  branchRoles: new Map([
    [HOME_BRANCH, 'operations_manager'],
    [AWAY_BRANCH, 'operations_manager'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

let chargeTypeId: string
let seq = 0

/** A master created through the real action, returning its id. */
async function master(): Promise<string> {
  const state = await saveConsolidation(
    {},
    form({ branchId: HOME_BRANCH, mode: 'sea_lcl', tradeDirection: 'import' }),
  )
  if (state.errors || state.message) {
    throw new Error(`fixture master failed: ${JSON.stringify(state)}`)
  }

  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({ id: consolidations.id })
      .from(consolidations)
      .where(eq(consolidations.reference, state.ok!.split(':')[0]!))
      .limit(1),
  )
  return row!.id
}

/**
 * A house with a cargo line, so an allocation has a driver to work from.
 *
 * The figures live on `job_cargo` rather than on the job — `volume_cbm` on a
 * shipment is the sum of what is in it — so a house with no cargo row
 * allocates as zero and the engine refuses the whole split.
 */
async function house(reference: string): Promise<string> {
  seq += 1
  return withActor(bothBranchesActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference: `${reference}-${seq}-${Date.now()}`,
        branchId: HOME_BRANCH,
        customerId: '00000000-0000-7000-8000-00000000c003',
        mode: 'sea_lcl',
        tradeDirection: 'import',
      })
      .returning({ id: jobs.id })

    await tx.insert(jobCargo).values({
      jobId: row!.id,
      descriptionEn: 'Palletised goods',
      volumeCbm: '2.000',
      grossWeightKg: '1000.000',
      packageCount: 10,
    })

    return row!.id
  })
}

/**
 * What a split has left on one house for one master cost: whether the shares
 * and their reversals net to zero, and how many reversal lines were posted.
 * The sum is compared in SQL — money is never a JS number, even in a test.
 */
async function splitOn(jobId: string, chargeLineId: string) {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({
        netsToZero: sql<boolean>`coalesce(sum(${chargeLines.amount}), 0) = 0`,
        reversals: sql<number>`count(*) filter (where ${chargeLines.sourceKind} = 'consol_allocation_reversal')::int`,
      })
      .from(chargeLines)
      .where(
        and(
          eq(chargeLines.jobId, jobId),
          eq(chargeLines.sourceId, chargeLineId),
          inArray(chargeLines.sourceKind, ['consol_allocation', 'consol_allocation_reversal']),
        ),
      ),
  )
  return row!
}

async function housesOn(consolidationId: string): Promise<number> {
  const rows = await withActor(bothBranchesActor, (tx) =>
    tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.consolidationId, consolidationId)),
  )
  return rows.length
}

/** A cost on the master, ready to be split. */
async function cost(
  consolidationId: string,
  amount = '900.000',
  allocationBasis = 'volume',
): Promise<string> {
  const state = await addConsolCharge(
    {},
    form({
      consolidationId,
      direction: 'cost',
      chargeTypeId,
      amount,
      currency: 'KWD',
      fxRate: '1',
      allocationBasis,
    }),
  )
  if (state.errors || state.message) {
    throw new Error(`fixture charge failed: ${JSON.stringify(state)}`)
  }

  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({ id: consolChargeLines.id })
      .from(consolChargeLines)
      .where(eq(consolChargeLines.consolidationId, consolidationId)),
  )
  return row!.id
}

describe.skipIf(!enabled)('consolidations', () => {
  beforeAll(async () => {
    const built = await world()
    chargeTypeId = built.chargeTypeId
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  describe('the master', () => {
    it('creates one with its own reference series', async () => {
      const state = await saveConsolidation(
        {},
        form({ branchId: HOME_BRANCH, mode: 'sea_lcl', tradeDirection: 'import' }),
      )
      expect(state.errors).toBeUndefined()
      // `FXH-CNS-2026-00001` — the branch code, its own sequence, zero-padded.
      expect(state.ok).toMatch(/^FXH-CNS-\d{4}-\d{5}:/)
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      const state = await saveConsolidation({}, form({ branchId: HOME_BRANCH }))
      expect(state.errors).toBeDefined()
    })

    it('refuses a mode it does not carry', async () => {
      const state = await saveConsolidation(
        {},
        form({ branchId: HOME_BRANCH, mode: 'teleport', tradeDirection: 'import' }),
      )
      expect(state.errors?.mode).toBeDefined()
    })
  })

  describe('houses', () => {
    it('attaches a house and detaches it again', async () => {
      const consolidationId = await master()
      const jobId = await house('FXH-HSE')

      await attachHouse({}, form({ consolidationId, jobId }))
      expect(await housesOn(consolidationId)).toBe(1)

      await detachHouse({}, form({ consolidationId, jobId }))
      expect(await housesOn(consolidationId)).toBe(0)
    })

    /*
      Returned rather than thrown: the shipment is the one field on the form
      the operator chooses, and a thrown refusal is redacted in production.
    */
    it('asks for a shipment when none was chosen', async () => {
      const consolidationId = await master()
      const state = await attachHouse({}, form({ consolidationId }))
      expect(state.errors?.jobId).toBe('consolidationValidation.chooseShipment')
      expect(await housesOn(consolidationId)).toBe(0)
    })

    it('still throws when the master itself is missing — a tampered form', async () => {
      await expect(attachHouse({}, form({ jobId: await house('FXH-NOM') }))).rejects.toThrow(
        'Nothing to attach',
      )
    })

    /**
     * Its share of the master cost is a charge line on it, possibly invoiced.
     * The refusal is one the operator meets by clicking, so it is a sentence.
     */
    it('refuses to detach a house whose costs were split onto it', async () => {
      const consolidationId = await master()
      const jobId = await house('FXH-SPLIT')
      await attachHouse({}, form({ consolidationId, jobId }))
      const chargeLineId = await cost(consolidationId)
      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))

      const state = await detachHouse({}, form({ consolidationId, jobId }))

      expect(state.message).toBe('consolidationValidation.houseHasSplitCosts')
      expect(await housesOn(consolidationId)).toBe(1)
    })

    /**
     * Closing is the line under the master. Attaching afterwards would change
     * what the allocation was computed over without recomputing it.
     */
    it('refuses to attach to a closed master', async () => {
      const consolidationId = await master()
      const first = await house('FXH-HSE')
      await attachHouse({}, form({ consolidationId, jobId: first }))

      await closeConsolidation(form({ consolidationId }))

      const late = await house('FXH-LATE')
      await attachHouse({}, form({ consolidationId, jobId: late }))

      expect(await housesOn(consolidationId)).toBe(1)
    })
  })

  describe('splitting a cost', () => {
    it('adds a cost to the master', async () => {
      const consolidationId = await master()
      const chargeLineId = await cost(consolidationId)
      expect(chargeLineId).toBeTruthy()
    })

    it('splits it across the houses', async () => {
      const consolidationId = await master()
      for (const ref of ['FXH-A', 'FXH-B', 'FXH-C']) {
        await attachHouse({}, form({ consolidationId, jobId: await house(ref) }))
      }
      const chargeLineId = await cost(consolidationId, '900.000')

      const state = await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))

      expect(state.message).toBeUndefined()
      // One share per house.
      expect(state.ok).toMatch(/^3:/)
    })

    /**
     * The rule the engine exists to keep: the shares add up to the cost
     * exactly, to the last fils. A split that loses 0.003 twenty times a week
     * produces a cost account nobody can reconcile.
     */
    it('splits to the last fils', async () => {
      const consolidationId = await master()
      for (const ref of ['FXH-D', 'FXH-E', 'FXH-F']) {
        await attachHouse({}, form({ consolidationId, jobId: await house(ref) }))
      }
      // 100.000 over three equal houses is 33.333 each and one fils over.
      const chargeLineId = await cost(consolidationId, '100.000')
      const posted = await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      expect(posted.message).toBeUndefined()

      /*
        The shares are the charge lines written onto each house, not rows in
        `consol_allocation_shares` — that table records a *manual* split, where
        the operator's own figures are the record. For a computed basis the
        cost lines carrying `source_id` are the allocation.
      */
      const shares = await withActor(bothBranchesActor, (tx) =>
        tx.execute(
          `select sum(amount)::text as total, count(*)::int as lines
             from charge_lines
            where source_kind = 'consol_allocation' and source_id = '${chargeLineId}'`,
        ),
      )
      const row = shares.rows[0] as { total: string | null; lines: number }

      expect(row.lines).toBe(3)
      // Exactly, to the last fils: 33.333 + 33.333 + 33.334.
      expect(Number(row.total)).toBeCloseTo(100, 3)
    })

    /** Splitting twice would double the cost on every house. */
    it('refuses to split the same cost twice', async () => {
      const consolidationId = await master()
      await attachHouse({}, form({ consolidationId, jobId: await house('FXH-G') }))
      const chargeLineId = await cost(consolidationId)

      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      const again = await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))

      expect(again.message).toBe('consolidationValidation.alreadySplit')
    })

    it('reverses a split so it can be done again', async () => {
      const consolidationId = await master()
      await attachHouse({}, form({ consolidationId, jobId: await house('FXH-H') }))
      const chargeLineId = await cost(consolidationId)

      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      await reverseConsolAllocation(form({ consolidationId, chargeLineId }))

      const redone = await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      expect(redone.message).toBeUndefined()
    })

    /*
      The second reversal used to reverse *every* share ever posted under the
      cost — including the first, already reversed — leaving the house one
      share short: allocate, reverse, allocate, reverse netted to minus one
      share, not zero.
    */
    it('a second reversal undoes only the second split', async () => {
      const consolidationId = await master()
      const jobId = await house('FXH-RR')
      await attachHouse({}, form({ consolidationId, jobId }))
      const chargeLineId = await cost(consolidationId)

      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      await reverseConsolAllocation(form({ consolidationId, chargeLineId }))
      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      await reverseConsolAllocation(form({ consolidationId, chargeLineId }))

      const split = await splitOn(jobId, chargeLineId)
      expect(split.netsToZero).toBe(true)
      expect(split.reversals).toBe(2)
    })

    it('posts nothing when a reversal is submitted twice', async () => {
      const consolidationId = await master()
      const jobId = await house('FXH-R2')
      await attachHouse({}, form({ consolidationId, jobId }))
      const chargeLineId = await cost(consolidationId)

      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      await reverseConsolAllocation(form({ consolidationId, chargeLineId }))
      await reverseConsolAllocation(form({ consolidationId, chargeLineId }))

      const split = await splitOn(jobId, chargeLineId)
      expect(split.netsToZero).toBe(true)
      expect(split.reversals).toBe(1)
    })

    /*
      A reversal adds a line rather than removing one, so "any share on the
      house" stayed true forever and the refusal's own advice — reverse the
      split first — could not work.
    */
    it('lets a house go once its split has been reversed', async () => {
      const consolidationId = await master()
      const jobId = await house('FXH-RD')
      await attachHouse({}, form({ consolidationId, jobId }))
      const chargeLineId = await cost(consolidationId)

      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      await reverseConsolAllocation(form({ consolidationId, chargeLineId }))
      const state = await detachHouse({}, form({ consolidationId, jobId }))

      expect(state.message).toBeUndefined()
      expect(await housesOn(consolidationId)).toBe(0)
    })

    /*
      The engine's refusals arrive as catalogue keys, not as the English
      `core` keeps for its log. A house fixture carries volume and gross
      weight but no chargeable weight, so a cost split by that basis finds
      every driver at zero.
    */
    it('refuses a split with nothing to split by, in the catalogue’s words', async () => {
      const consolidationId = await master()
      await attachHouse({}, form({ consolidationId, jobId: await house('FXH-ZERO') }))
      const chargeLineId = await cost(consolidationId, '900.000', 'chargeable_weight')

      const state = await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))

      expect(state.message).toBe('consolidationValidation.allocationZeroChargeableWeight')
    })

    /*
      The totals come through as strings fixed to the dinar's three places —
      never through a JS number. The page posts no per-house shares yet, so a
      manual split states zero for every house.
    */
    it('says what a stated split adds up to, in the currency’s places', async () => {
      const consolidationId = await master()
      await attachHouse({}, form({ consolidationId, jobId: await house('FXH-MAN') }))
      const chargeLineId = await cost(consolidationId, '900.000', 'manual')

      const state = await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))

      expect(state.message).toBe(
        'consolidationValidation.allocationManualMismatch:{"stated":"0.000","expected":"900.000","currency":"KWD"}',
      )
    })

    /*
      The split form now sends one `share_<jobId>` per house for a cost stated
      by hand. Before, it sent none, so every manual split stated zero and was
      refused — the basis was offered and could not be used.
    */
    it('splits a cost stated by hand, house by house', async () => {
      const consolidationId = await master()
      const first = await house('FXH-MA1')
      const second = await house('FXH-MA2')
      await attachHouse({}, form({ consolidationId, jobId: first }))
      await attachHouse({}, form({ consolidationId, jobId: second }))
      const chargeLineId = await cost(consolidationId, '900.000', 'manual')

      const state = await allocateConsolCharge(
        {},
        form({
          consolidationId,
          chargeLineId,
          [`share_${first}`]: '600.000',
          [`share_${second}`]: '300.000',
        }),
      )
      expect(state.message).toBeUndefined()

      const shares = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ jobId: chargeLines.jobId, stated: sql<string>`${chargeLines.amount}::text` })
          .from(chargeLines)
          .where(
            and(
              eq(chargeLines.sourceId, chargeLineId),
              eq(chargeLines.sourceKind, 'consol_allocation'),
            ),
          ),
      )
      const byJob = Object.fromEntries(shares.map((row) => [row.jobId, row.stated]))
      expect(byJob[first]).toMatch(/^600\.0+$/)
      expect(byJob[second]).toMatch(/^300\.0+$/)
    })

    it('says so plainly when there is nothing to allocate', async () => {
      expect((await allocateConsolCharge({}, form({}))).message).toBe(
        'consolidationValidation.nothingToAllocate',
      )
    })

    it('reports field errors rather than throwing on a bad charge form', async () => {
      const consolidationId = await master()
      const state = await addConsolCharge({}, form({ consolidationId, direction: 'cost' }))
      expect(state.errors).toBeDefined()
    })
  })
})
