/**
 * `pnpm --filter @qabandi/service ai:eval` — score the extraction corpus, or
 * compare two prompt versions, without spending a fils.
 *
 * The reporting end of the evaluation harness. It replays `ai_invocations`
 * through the pure parsers (`replay.ts`) and prints the scorecard
 * (`core/evaluation.ts`). Shaped like `db:diagnose`: `loadEnv` first, read as
 * the system actor, print a table, exit.
 *
 *   ai:eval                                  every replayable surface
 *   ai:eval --surface invoice_extract        one surface
 *   ai:eval --surface invoice_extract --prompt-version invoice-extract@1
 *   ai:eval --surface invoice_extract --compare invoice-extract@1 invoice-extract@2
 *
 * `--compare` is the question `promptVersion` exists to answer: run the same
 * corpus through two revisions and print what moved. No key, no provider, no
 * cost — the responses were recorded when the calls were first made.
 *
 * The imports that reach the service config are loaded *after* `loadEnv`, so a
 * script run picks up `.env.local` before `config.ts` parses the environment —
 * the same ordering the test setup keeps.
 */

import { loadEnv } from '@qabandi/db'
import type { EvalMetrics, EvalSurface } from '@qabandi/core'

loadEnv()

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** Three decimals for a ratio, whole numbers left whole. */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

/** A rate as a percentage, so it never reads as a count beside `cases`. */
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

async function main(): Promise<void> {
  const { compareVersions } = await import('@qabandi/core')
  const { REPLAYABLE_SURFACES, replaySurface } = await import('./replay')

  const surfaceArg = flagValue('--surface')
  if (surfaceArg && !REPLAYABLE_SURFACES.includes(surfaceArg as EvalSurface)) {
    throw new Error(`--surface must be one of: ${REPLAYABLE_SURFACES.join(', ')}`)
  }

  const printMetrics = (metrics: EvalMetrics): void => {
    const lines = [
      `## ${metrics.surface}`,
      `cases: ${metrics.caseCount}  ·  parse-ok: ${pct(metrics.parseOkRate)}  ·  parse failures: ${metrics.parseFailures}`,
    ]
    if (metrics.reconcileRate !== undefined) lines.push(`reconcile: ${pct(metrics.reconcileRate)}`)
    if (metrics.selfConsistentRate !== undefined) {
      lines.push(`self-consistent: ${pct(metrics.selfConsistentRate)}`)
    }
    if (metrics.meanFields !== undefined) lines.push(`mean fields: ${fmt(metrics.meanFields)}`)
    if (metrics.refusedTotal !== undefined) lines.push(`refused (security signal): ${metrics.refusedTotal}`)
    if (metrics.declineRate !== undefined) lines.push(`declined: ${pct(metrics.declineRate)}`)
    if (metrics.meanLines !== undefined) lines.push(`mean lines: ${fmt(metrics.meanLines)}`)
    if (metrics.confidence?.mean != null) {
      lines.push(`mean confidence: ${fmt(metrics.confidence.mean)}`)
    }
    console.log(lines.join('\n'))
    console.log('')
  }

  const compareIndex = process.argv.indexOf('--compare')
  if (compareIndex !== -1) {
    const versionA = process.argv[compareIndex + 1]
    const versionB = process.argv[compareIndex + 2]
    if (!surfaceArg || !versionA || !versionB) {
      throw new Error('Usage: ai:eval --surface <surface> --compare <versionA> <versionB>')
    }

    const surface = surfaceArg as EvalSurface
    const before = await replaySurface(surface, { promptVersion: versionA })
    const after = await replaySurface(surface, { promptVersion: versionB })

    console.log(`# ${surface}: ${versionA} → ${versionB}`)
    console.log(`cases: ${before.metrics.caseCount} → ${after.metrics.caseCount}\n`)
    const deltas = compareVersions(before.metrics, after.metrics)
    if (deltas.length === 0) {
      console.log('No shared metric to compare — one version produced nothing.')
    }
    for (const d of deltas) {
      const sign = d.delta >= 0 ? '+' : ''
      console.log(`${d.metric}: ${fmt(d.before)} → ${fmt(d.after)}  (${sign}${fmt(d.delta)})`)
    }
    process.exit(0)
  }

  const promptVersion = flagValue('--prompt-version')
  const surfaces = surfaceArg ? [surfaceArg as EvalSurface] : REPLAYABLE_SURFACES

  for (const surface of surfaces) {
    const result = await replaySurface(surface, promptVersion ? { promptVersion } : {})
    printMetrics(result.metrics)
  }

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
