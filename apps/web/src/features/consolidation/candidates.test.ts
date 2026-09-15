/**
 * Forming a consolidation from a suggestion.
 *
 * The clustering arithmetic is `core/grouping.ts` and is tested there against
 * no infrastructure. What needs a database is the act: creating the master and
 * moving houses onto it, under the same guard a single `attachHouse` click
 * uses.
 *
 * That guard is the whole reason this file exists. A suggestion is a list of
 * things nobody has done yet, so it goes stale by design — between the screen
 * being drawn and the button being pressed, one of those shipments may have
 * been consolidated by somebody else. Pulling it off the master whose costs
 * have already been split across it would leave that allocation referring to a
 * house that is no longer under it, and the margin on every remaining house
 * would be quietly wrong.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { consolidations, jobs, locations, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { consolidateCluster } = await import('./form-actions')
const { consolidationCandidates } = await import('./candidates')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Consol Desk',
    nameAr: null,
    email: 'consol@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['consol.write']),
  branchRoles: new Map([
    [HOME_BRANCH, 'operations'],
    [AWAY_BRANCH, 'operations'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>, jobIds: readonly string[]): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  for (const id of jobIds) data.append('jobId', id)
  return data
}

describe.skipIf(!enabled)('forming a consolidation from a suggestion', () => {
  /**
   * A lane of this run's own, so the arithmetic is over this run's shipments.
   *
   * The first version used the shared fixture lane and asserted that three
   * twelve-cubic-metre bookings fit a container. They did, once. Nothing is
   * deleted (§5.5), every run of this file left its bookings loose on that
   * lane, and by the fourth run the window held more cargo than a 40HC takes —
   * `fit` came back null and the assertion read like a bug in `fitFor`. It was
   * the test asserting about "these three shipments" on a lane every earlier
   * run had also written to. Two fresh locations per run make the cluster
   * exactly the shipments this file created.
   */
  let ORIGIN: string
  let DESTINATION: string

  /** Two fresh places nothing else will ever write a booking between. */
  async function freshLane(): Promise<{ originId: string; destinationId: string }> {
    const tag = Math.random().toString(36).slice(2, 7).toUpperCase()
    const [from, to] = await withActor(bothBranchesActor, (tx) =>
      tx
        .insert(locations)
        .values([
          { kind: 'seaport', nameEn: `Grouping Origin ${tag}`, countryCode: 'CN', unlocode: null },
          {
            kind: 'seaport',
            nameEn: `Grouping Destination ${tag}`,
            countryCode: 'KW',
            unlocode: null,
          },
        ])
        .returning({ id: locations.id }),
    )
    return { originId: from!.id, destinationId: to!.id }
  }

  beforeAll(async () => {
    await world()
    harness.session = session
    ;({ originId: ORIGIN, destinationId: DESTINATION } = await freshLane())
  })

  /** A loose LCL booking on this run's lane, with cargo figures to add up. */
  async function looseJob(over: Record<string, unknown> = {}): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(jobs)
        .values({
          reference: `GRP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_lcl',
          tradeDirection: 'import',
          status: 'booked',
          originId: ORIGIN,
          destinationId: DESTINATION,
          etd: new Date('2026-11-02T00:00:00Z'),
          volumeCbm: '12',
          grossWeightKg: '3000',
          pieces: 40,
          ...over,
        })
        .returning({ id: jobs.id })
      return row!.id
    })
  }

  const readJobs = async (ids: readonly string[]) =>
    withActor(bothBranchesActor, (tx) =>
      tx
        .select({ id: jobs.id, consolidationId: jobs.consolidationId })
        .from(jobs)
        .where(inArray(jobs.id, [...ids])),
    )

  const base = () => ({
    branchId: HOME_BRANCH,
    mode: 'sea_lcl',
    originId: ORIGIN,
    destinationId: DESTINATION,
  })

  it('creates an open master and moves the houses onto it', async () => {
    const a = await looseJob()
    const b = await looseJob()

    const state = await consolidateCluster({}, form(base(), [a, b]))

    expect(state.message).toBeUndefined()

    const moved = await readJobs([a, b])
    const consolidationId = moved[0]?.consolidationId
    expect(consolidationId).toBeTruthy()
    expect(moved.every((j) => j.consolidationId === consolidationId)).toBe(true)

    const [master] = await withActor(bothBranchesActor, (tx) =>
      tx.select().from(consolidations).where(eq(consolidations.id, consolidationId!)).limit(1),
    )
    expect(master?.status).toBe('open')
    expect(master?.mode).toBe('sea_lcl')
    expect(master?.originId).toBe(ORIGIN)
    expect(master?.destinationId).toBe(DESTINATION)
    expect(master?.reference).toMatch(/-CNS-/)
    // The direction is read off the houses, so the master agrees with them.
    expect(master?.tradeDirection).toBe('import')
  })

  /**
   * Nothing is invented on the master.
   *
   * Carrier, booking number, vessel and ETD are what a coordinator negotiates
   * *after* deciding to consolidate. Filling them in would put figures on a
   * record that reads as agreed.
   */
  it('leaves the carrier and the sailing blank for a person to fill in', async () => {
    const ids = [await looseJob(), await looseJob()]
    await consolidateCluster({}, form(base(), ids))

    const [job] = await readJobs(ids)
    const [master] = await withActor(bothBranchesActor, (tx) =>
      tx.select().from(consolidations).where(eq(consolidations.id, job!.consolidationId!)).limit(1),
    )

    expect(master?.carrierPartnerId).toBeNull()
    expect(master?.bookingNumber).toBeNull()
    expect(master?.vesselName).toBeNull()
    expect(master?.etd).toBeNull()
  })

  /**
   * The stale-suggestion case, and the one that would cost money.
   *
   * A house already under another master keeps its place — its costs have been
   * allocated there, and moving it would leave that split referring to a house
   * no longer under it.
   */
  it('leaves a shipment that has been consolidated since where it is', async () => {
    const a = await looseJob()
    const b = await looseJob()
    const c = await looseJob()

    // Somebody else consolidates `a` first.
    await consolidateCluster({}, form(base(), [a, b]))
    const [first] = await readJobs([a])
    const firstMaster = first!.consolidationId

    // The stale screen still offers a, b and c together.
    await consolidateCluster({}, form(base(), [a, b, c]))

    const after = await readJobs([a, b, c])
    const byId = new Map(after.map((j) => [j.id, j.consolidationId]))

    expect(byId.get(a)).toBe(firstMaster)
    expect(byId.get(b)).toBe(firstMaster)
    // `c` was the only one still loose, and one shipment is not a consolidation.
    expect(byId.get(c)).toBeNull()
  })

  it('refuses a suggestion with fewer than two shipments', async () => {
    const only = await looseJob()
    const state = await consolidateCluster({}, form(base(), [only]))

    expect(state.message).toMatch(/incomplete/)
    expect((await readJobs([only]))[0]?.consolidationId).toBeNull()
  })

  /** A cluster whose houses have all gone creates nothing rather than an empty master. */
  it('creates no master when nothing is left to attach', async () => {
    const a = await looseJob()
    const b = await looseJob()
    await consolidateCluster({}, form(base(), [a, b]))

    const again = await consolidateCluster({}, form(base(), [a, b]))

    expect(again.message).toMatch(/consolidated or closed/)
  })

  describe('the suggestion itself', () => {
    /*
      On a lane of its own, not the run's shared one.

      Two earlier cases deliberately leave a booking loose — the lone shipment
      that is refused, and the third house the stale suggestion cannot move —
      and both sit on the shared lane in the same sailing window. With them
      the cluster here is five shipments at exactly 60 CBM, which is a 40HC at
      its boundary and not the three-shipment 40GP this asserts. Asserting
      exact figures needs a lane exactly these three are on.
    */
    it('offers a lane with enough loose shipments on it', async () => {
      const lane = await freshLane()
      const ids = [await looseJob(lane), await looseJob(lane), await looseJob(lane)]

      const clusters = await consolidationCandidates(bothBranchesActor)
      const mine = clusters.find((c) => ids.every((id) => c.shipments.some((s) => s.jobId === id)))

      expect(mine).toBeDefined()
      expect(mine?.shipments).toHaveLength(3)
      expect(mine?.totalCbm).toBe(36)
      // 36 CBM is past a 20GP's usable 28 and well inside a 40GP's 56.
      expect(mine?.fit?.code).toBe('40GP')
    })

    /** A full container is already the whole box — there is nothing to share. */
    it('never offers an FCL shipment', async () => {
      const fcl = await looseJob({ mode: 'sea_fcl' })

      const clusters = await consolidationCandidates(bothBranchesActor)

      expect(clusters.some((c) => c.shipments.some((s) => s.jobId === fcl))).toBe(false)
    })

    it('drops a shipment once it is on a master', async () => {
      const ids = [await looseJob(), await looseJob()]
      await consolidateCluster({}, form(base(), ids))

      const clusters = await consolidationCandidates(bothBranchesActor)

      expect(clusters.some((c) => c.shipments.some((s) => ids.includes(s.jobId)))).toBe(false)
    })

    /** Nothing to add up is worse than absent — it makes a cluster read light. */
    it('ignores a booking with neither a volume nor a weight', async () => {
      const blank = await looseJob({ volumeCbm: null, grossWeightKg: null })

      const clusters = await consolidationCandidates(bothBranchesActor)

      expect(clusters.some((c) => c.shipments.some((s) => s.jobId === blank))).toBe(false)
    })
  })
})
