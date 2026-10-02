/**
 * A thread keeps the lookups behind each answer, and shows a person only
 * their names (ai-2).
 *
 * `assistant.test.ts` proves a follow-up is answered from replayed lookups.
 * This is the storage half against a real database: what the stream route
 * records comes back out of `historyFor` as replayable calls, and does not
 * come back out of `readThread` — the panel's read — as raw rows.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { branches, principals, withActor, workingCalendars } = await import('@qabandi/db')
const { historyFor, readThread, recordExchange } = await import('./threads')

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const BRANCH = randomUUID()
const PRINCIPAL = randomUUID()
const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }

describe.skipIf(!enabled)('assistant threads', () => {
  beforeAll(async () => {
    await withActor({ ...actor, type: 'system' }, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx.insert(principals).values({
        id: PRINCIPAL,
        type: 'internal',
        email: `threads-${RUN}@qabandi.test`,
        nameEn: 'Threads Fixture',
      })
      await tx.insert(branches).values({
        id: BRANCH,
        code: `THR-${RUN}`,
        legalNameEn: 'Threads Branch',
        legalNameAr: 'فرع',
        country: 'KW',
        baseCurrency: 'KWD',
        invoiceSeries: `THR-${RUN}`,
        calendarId: calendar.id,
      })
    })
  })

  it('replays the stored lookups to the model and shows the panel their names', async () => {
    const call = {
      id: 'call-1',
      name: 'list_overdue_invoices',
      args: { customer: null, limit: null },
      result: { total: 1, shown: 1, rows: [{ number: 'KWI-INV-1', balance: '150.000000' }] },
      at: '2026-10-02T09:00:00.000Z',
    }

    const { threadId } = await recordExchange({
      actor,
      branchId: BRANCH,
      question: 'Which invoices are overdue?',
      answer: 'KWI-INV-1, 150.000 KWD.',
      proposals: [],
      used: [call, { ...call, id: 'call-2' }],
    })

    const history = await historyFor(actor, threadId)
    expect(history).toEqual([
      { role: 'user', content: 'Which invoices are overdue?' },
      {
        role: 'assistant',
        content: 'KWI-INV-1, 150.000 KWD.',
        calls: [call, { ...call, id: 'call-2' }],
      },
    ])

    const shown = await readThread(actor, threadId)
    // One name for two calls of the same tool, and no arguments or rows.
    expect(shown[1]!.used).toEqual([{ name: 'list_overdue_invoices' }])
  })

  it('sends a turn stored with names only as words, as rows from before ai-2 were', async () => {
    const { threadId } = await recordExchange({
      actor,
      branchId: BRANCH,
      question: 'q',
      answer: 'a',
      proposals: [],
      used: [{ name: 'search' }],
    })
    const history = await historyFor(actor, threadId)
    expect(history[1]).toEqual({ role: 'assistant', content: 'a' })
  })
})
