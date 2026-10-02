/**
 * The matching picker's candidates — QA P2-9.
 *
 * Reversing a consolidation allocation posts a negative copy of each share and
 * leaves the original in place, because nothing is deleted. The picker offered
 * both halves of every such pair, unlabelled, as costs a supplier's bill could
 * be matched against. Against real rows, because the pairing is a SQL rule.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { chargeLines, jobs, withActor } = await import('@qabandi/db')
const { CUSTOMER, HOME_BRANCH, bothBranchesActor, world } = await import('@/lib/testing/fixtures')
const { listMatchCandidates } = await import('./queries')

describe.skipIf(!enabled)('match candidates', () => {
  let chargeTypeId: string

  beforeAll(async () => {
    chargeTypeId = (await world()).chargeTypeId
  })

  async function aJob(): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(jobs)
        .values({
          reference: `MCH-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
          status: 'in_transit',
        })
        .returning({ id: jobs.id })
      return row!.id
    })
  }

  async function aCost(
    jobId: string,
    amount: string,
    source?: { kind: string; id: string },
  ): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(chargeLines)
        .values({
          branchId: HOME_BRANCH,
          jobId,
          chargeTypeId,
          direction: 'cost',
          basis: 'flat',
          quantity: '1',
          rate: amount,
          amount,
          currency: 'KWD',
          fxRate: '1',
          amountBase: amount,
          baseCurrency: 'KWD',
          sourceKind: source?.kind ?? null,
          sourceId: source?.id ?? null,
        })
        .returning({ id: chargeLines.id })
      return row!.id
    })
  }

  it('offers live costs only — not reversals, nor the shares they undid', async () => {
    const jobId = await aJob()
    const master = randomUUID()
    const own = await aCost(jobId, '75.000')
    const undone = await aCost(jobId, '150.000', { kind: 'consol_allocation', id: master })
    const reversal = await aCost(jobId, '-150.000', {
      kind: 'consol_allocation_reversal',
      id: master,
    })
    const reallocated = await aCost(jobId, '140.000', { kind: 'consol_allocation', id: master })

    const offered = (await listMatchCandidates(bothBranchesActor, { jobId })).map((c) => c.id)

    expect(offered).toContain(own)
    expect(offered).toContain(reallocated)
    expect(offered).not.toContain(undone)
    expect(offered).not.toContain(reversal)
  })
})
