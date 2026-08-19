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
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { consolidations, consolChargeLines, jobCargo, jobs, withActor } = await import('@qabandi/db')

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

async function housesOn(consolidationId: string): Promise<number> {
  const rows = await withActor(bothBranchesActor, (tx) =>
    tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.consolidationId, consolidationId)),
  )
  return rows.length
}

/** A cost on the master, ready to be split. */
async function cost(consolidationId: string, amount = '900.000'): Promise<string> {
  const state = await addConsolCharge(
    {},
    form({
      consolidationId,
      direction: 'cost',
      chargeTypeId,
      amount,
      currency: 'KWD',
      fxRate: '1',
      allocationBasis: 'volume',
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

      await attachHouse(form({ consolidationId, jobId }))
      expect(await housesOn(consolidationId)).toBe(1)

      await detachHouse(form({ consolidationId, jobId }))
      expect(await housesOn(consolidationId)).toBe(0)
    })

    it('refuses outright when no job was given', async () => {
      const consolidationId = await master()
      await expect(attachHouse(form({ consolidationId }))).rejects.toThrow('Nothing to attach')
      expect(await housesOn(consolidationId)).toBe(0)
    })

    /**
     * Closing is the line under the master. Attaching afterwards would change
     * what the allocation was computed over without recomputing it.
     */
    it('refuses to attach to a closed master', async () => {
      const consolidationId = await master()
      const first = await house('FXH-HSE')
      await attachHouse(form({ consolidationId, jobId: first }))

      await closeConsolidation(form({ consolidationId }))

      const late = await house('FXH-LATE')
      await attachHouse(form({ consolidationId, jobId: late }))

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
        await attachHouse(form({ consolidationId, jobId: await house(ref) }))
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
        await attachHouse(form({ consolidationId, jobId: await house(ref) }))
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
      await attachHouse(form({ consolidationId, jobId: await house('FXH-G') }))
      const chargeLineId = await cost(consolidationId)

      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      const again = await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))

      expect(again.message).toContain('already been split')
    })

    it('reverses a split so it can be done again', async () => {
      const consolidationId = await master()
      await attachHouse(form({ consolidationId, jobId: await house('FXH-H') }))
      const chargeLineId = await cost(consolidationId)

      await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      await reverseConsolAllocation(form({ consolidationId, chargeLineId }))

      const redone = await allocateConsolCharge({}, form({ consolidationId, chargeLineId }))
      expect(redone.message).toBeUndefined()
    })

    it('says so plainly when there is nothing to allocate', async () => {
      expect((await allocateConsolCharge({}, form({}))).message).toBe('Nothing to allocate.')
    })

    it('reports field errors rather than throwing on a bad charge form', async () => {
      const consolidationId = await master()
      const state = await addConsolCharge({}, form({ consolidationId, direction: 'cost' }))
      expect(state.errors).toBeDefined()
    })
  })
})
