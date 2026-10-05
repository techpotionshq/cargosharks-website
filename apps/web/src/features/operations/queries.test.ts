/**
 * The closed and released registers — O18.
 *
 * Both sorted oldest first with a cap of 200, which is right for the open
 * exceptions (the one nobody has looked at is the one to show) and wrong for
 * the history: past 200 rows, a closure made this morning never appeared.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { exceptionCodes, exceptions, withActor } = await import('@qabandi/db')
const { HOME_JOB, bothBranchesActor, world } = await import('@/lib/testing/fixtures')
const { listExceptions } = await import('./queries')

describe.skipIf(!enabled)('the exceptions register', () => {
  beforeAll(async () => {
    await world()
  })

  it('lists the most recently closed first', async () => {
    const [code] = await withActor(bothBranchesActor, (tx) =>
      tx.select({ id: exceptionCodes.id }).from(exceptionCodes).limit(1),
    )
    const now = Date.now()
    // An old exception closed long ago, and a new one closed just now.
    await withActor(bothBranchesActor, (tx) =>
      tx.insert(exceptions).values([
        {
          jobId: HOME_JOB,
          exceptionCodeId: code!.id,
          severity: 'low',
          description: 'closed long ago',
          openedAt: new Date(now - 400 * 86_400_000),
          closedAt: new Date(now - 399 * 86_400_000),
          resolution: 'done',
        },
        {
          jobId: HOME_JOB,
          exceptionCodeId: code!.id,
          severity: 'low',
          description: 'closed just now',
          openedAt: new Date(now - 60_000),
          closedAt: new Date(now),
          resolution: 'done',
        },
      ]),
    )

    const closed = (await listExceptions(bothBranchesActor, 'closed')).rows
    expect(closed[0]!.description).toBe('closed just now')
  })
})
