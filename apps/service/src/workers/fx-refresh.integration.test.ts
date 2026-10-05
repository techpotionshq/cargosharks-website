/**
 * The real FX refresh, against the real providers and a real database — opt-in.
 *
 *     QABANDI_FX_INTEGRATION=1 TEST_DATABASE_URL=postgres://…/qt_fx \
 *       pnpm --filter @qabandi/service exec vitest run src/workers/fx-refresh.integration.test.ts
 *
 * Never against a shared database: it writes today's rows, under the real
 * provider sources, and those become the rate every quotation on that
 * database converts at. Point it at a local container made for the purpose.
 *
 * It switches the `fx` integration to `resilient` for the run, refreshes
 * twice — the second must write nothing — and puts the row back the way it
 * found it, switched off.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { todayIn } from '@qabandi/core'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = process.env.QABANDI_FX_INTEGRATION === '1' && Boolean(APP_URL)
if (enabled) process.env.DATABASE_URL = APP_URL

describe.skipIf(!enabled)('the FX refresh, live, on a local database', () => {
  const lines: string[] = []
  const log = {
    info: (o: unknown, m: string) => lines.push(`info  ${m} ${JSON.stringify(o)}`),
    warn: (o: unknown, m: string) => lines.push(`warn  ${m} ${JSON.stringify(o)}`),
    error: (o: unknown, m: string) => lines.push(`error ${m} ${JSON.stringify(o)}`),
  }

  afterAll(async () => {
    if (!enabled) return
    const { integrationSettings, systemActor, withActor } = await import('@qabandi/db')
    await withActor(systemActor(), (tx) =>
      tx
        .update(integrationSettings)
        .set({ isActive: false })
        .where(eq(integrationSettings.key, 'fx')),
    )
  })

  it(
    'writes today’s rates for KWD and AED once, and nothing on a second run',
    {
      timeout: 120_000,
    },
    async () => {
      const { fxRates, integrationSettings, systemActor, withActor } = await import('@qabandi/db')
      const { runFxRefresh } = await import('./fx-refresh')

      await withActor(systemActor(), (tx) =>
        tx
          .insert(integrationSettings)
          .values({ key: 'fx', driver: 'resilient', settings: {}, secrets: {}, isActive: true })
          .onConflictDoUpdate({
            target: integrationSettings.key,
            set: { driver: 'resilient', isActive: true, lastError: null },
          }),
      )

      const first = await runFxRefresh({ log })
      const second = await runFxRefresh({ log })
      const today = todayIn()

      const rows = await withActor(systemActor(), (tx) =>
        tx
          .select({
            from: fxRates.fromCurrency,
            to: fxRates.toCurrency,
            rate: fxRates.rate,
            effectiveOn: fxRates.effectiveOn,
            source: fxRates.source,
          })
          .from(fxRates)
          .where(
            and(
              inArray(fxRates.source, ['er-api', 'currency-api']),
              inArray(fxRates.effectiveOn, first.effectiveOn ?? []),
            ),
          ),
      )

      console.log(`\ntoday (Kuwait): ${today}`)
      console.log('first run:', JSON.stringify(first, null, 2))
      console.log('second run:', JSON.stringify(second))
      for (const r of rows
        .filter((r) => ['KWD', 'AED'].includes(r.to) || ['KWD', 'AED'].includes(r.from))
        .sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`))) {
        console.log(`  ${r.from}→${r.to}  ${r.rate}  ${r.effectiveOn}  ${r.source}`)
      }
      for (const line of lines) console.log(`  ${line}`)

      expect(first.source).toBe('resilient')
      expect(first.bases).toEqual(expect.arrayContaining(['AED', 'KWD']))
      expect(first.failed).toEqual([])
      expect(first.refused).toEqual([])
      expect(first.written).toBeGreaterThan(0)
      const pair = (from: string, to: string) => rows.find((r) => r.from === from && r.to === to)
      expect(pair('USD', 'KWD')).toBeDefined()
      expect(pair('KWD', 'USD')).toBeDefined()
      expect(pair('USD', 'AED')).toBeDefined()
      expect(pair('AED', 'USD')).toBeDefined()

      expect(second.written).toBe(0)
    },
  )
})
