/**
 * The resilient FX driver against the real providers — opt-in.
 *
 *     QABANDI_FX_LIVE=1 pnpm --filter @qabandi/service exec vitest run src/adapters/fx.live.test.ts
 *
 * Skipped unless the flag is set, so CI never depends on two free endpoints
 * being up. Run it before switching a deployment to the `resilient` driver:
 * it asks both providers for KWD and AED, exactly as the worker will, and
 * fails if today's figures would not pass the cross-check or the Gulf pegs.
 */

import { describe, expect, it } from 'vitest'
import { checkPegs, D } from '@qabandi/core'
import { resilientFxSource } from './fx'

const live = process.env.QABANDI_FX_LIVE === '1'
const QUOTES = ['USD', 'EUR', 'GBP', 'CNY', 'INR', 'KWD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR']

describe.skipIf(!live)('the FX providers, live', () => {
  for (const base of ['KWD', 'AED']) {
    it(`answers ${base}, cross-checked and on the pegs`, { timeout: 60_000 }, async () => {
      const lines: string[] = []
      const log = {
        info: () => {},
        warn: (o: unknown, m: string) => lines.push(`warn  ${m} ${JSON.stringify(o)}`),
        error: (o: unknown, m: string) => lines.push(`error ${m} ${JSON.stringify(o)}`),
      }
      const fx = resilientFxSource({ log })
      const report = await fx.fetchReport!(base, QUOTES)

      console.log(`\n${base}: providers ${JSON.stringify(report.providers)}`)
      for (const q of report.quotes) {
        console.log(`  ${q.from}→${q.to}  ${q.rate.padEnd(14)} ${q.effectiveOn}  ${q.source}`)
      }
      for (const line of lines) console.log(`  ${line}`)

      expect(report.providers.every((p) => p.ok)).toBe(true)
      expect(report.refused).toEqual([])
      expect(report.quotes.map((q) => q.to).sort()).toEqual(QUOTES.filter((c) => c !== base).sort())
      const rates = new Map(report.quotes.map((q) => [q.to, new D(q.rate)]))
      expect(checkPegs(base, rates)).toEqual(new Map())
    })
  }
})
