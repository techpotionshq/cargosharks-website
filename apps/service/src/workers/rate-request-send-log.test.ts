/**
 * An RFQ sent under the log mail driver leaves a line in the log (ai-21).
 *
 * The drain resolved its channel with a no-op logger, so with `MAIL_DRIVER=log`
 * every RFQ was stamped sent and appeared nowhere — not in a mailbox, not in
 * the log. The driver is forced to `log` here and the logger is the test's.
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

vi.mock('../adapters/index', async () => {
  const { logChannel } = await import('../adapters/smtp')
  return {
    // The log driver, exactly as `resolveEmailChannel` builds it for `log`.
    resolveEmailChannel: async (log: (o: unknown, m: string) => void) => logChannel(log),
  }
})

const {
  branches,
  partnerContacts,
  partners,
  rateRequests,
  systemActor,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')
const { sendRateRequests } = await import('./rate-request-send')

const BRANCH = '00000000-0000-7000-8000-00000000f5a2'
const RUN = Date.now().toString(36).toLowerCase().slice(-6)

describe.skipIf(!enabled)('an RFQ under the log mail driver', () => {
  it('is written to the log with its recipient and subject', async () => {
    const actor = systemActor()
    const partnerId = randomUUID()
    const email = `log-${RUN}@rfq-log.test`
    await withActor(actor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')
      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'RLG',
          legalNameEn: 'RFQ Log Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'RLG',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()
      await tx.insert(partners).values({
        id: partnerId,
        code: `AGT-LOG-${RUN}`,
        type: 'agent',
        legalNameEn: 'Log Agent',
      })
      await tx.insert(partnerContacts).values({ partnerId, nameEn: 'Desk', email, isPrimary: true })
      await tx
        .insert(rateRequests)
        .values({ branchId: BRANCH, partnerId, status: 'sent', token: `log-${RUN}` })
    })

    const lines: { o: unknown; m: string }[] = []
    // Other suites' leftovers may drain first; sweep until ours has gone.
    for (let i = 0; i < 20 && !lines.some((l) => JSON.stringify(l.o).includes(email)); i++) {
      const result = await sendRateRequests({ log: (o, m) => lines.push({ o, m }) })
      if (result.sent === 0) break
    }

    const ours = lines.find((l) => (l.o as { to?: string }).to === email)
    expect(ours).toBeDefined()
    expect(ours!.m).toMatch(/not sent/)
    expect((ours!.o as { subject?: string }).subject).toBeTruthy()
  })
})
