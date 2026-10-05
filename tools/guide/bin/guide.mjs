#!/usr/bin/env node
// pnpm guide <command>. See docs/guide/README.md.
//
//   build [manual|shorts|all] [ids…] [--voice] [--sheet] [--no-stop]
//   stale [--base origin/qabandi] [--json]
//   voice [ids…]                 build the voiced shorts, speaking any new lines
//   voice import <dir…>          seed the voice cache from earlier takes
//   publish [--dry-run]          upload changed outputs to R2
//   stack up|down [fixtures|seeded]
//   cache prune [--days 30]
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GUIDE, OUT, CACHE } from '../src/paths.mjs'
import { log, parseArgs, timer } from '../src/util.mjs'

const args = parseArgs(process.argv.slice(2))
const [cmd = 'help', ...rest] = args._

export async function loadShorts(ids = []) {
  const dir = join(GUIDE, 'shorts')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
  const out = []
  for (const f of files) {
    const file = join(dir, f)
    const spec = (await import(pathToFileURL(file).href)).default
    if (ids.length && !ids.some((id) => spec.id === id || spec.id.startsWith(id))) continue
    out.push({ spec, file })
  }
  return out
}

async function buildShorts(ids, opts) {
  const { buildShort } = await import('../src/video/short.mjs')
  const { stackFor } = await import('../src/stack/index.mjs')
  const results = []
  for (const { spec, file } of await loadShorts(ids)) {
    if (opts.stack && (spec.stack ?? 'fixtures') !== opts.stack) continue
    const stack = stackFor(spec.stack ?? 'fixtures')
    await stack.prime()
    results.push(await buildShort(spec, file, stack, opts))
  }
  return results
}

async function main() {
  const elapsed = timer()
  if (cmd === 'build' || cmd === 'voice') {
    if (cmd === 'voice' && rest[0] === 'import') {
      const { importTakes } = await import('../src/voice/tts.mjs')
      for (const d of rest.slice(1)) log(`${d}: ${await importTakes(d)} takes imported`)
      return
    }
    const what =
      cmd === 'voice' ? 'shorts' : ['manual', 'shorts', 'all'].includes(rest[0]) ? rest[0] : 'all'
    const ids =
      cmd === 'voice' ? rest : ['manual', 'shorts', 'all'].includes(rest[0]) ? rest.slice(1) : rest
    const report = { manual: null, shorts: [] }
    if (what === 'manual' || what === 'all') {
      const { buildManual } = await import('../src/manual/build.mjs')
      report.manual = await buildManual({
        locales: args.locale ? [args.locale] : undefined,
        pdf: args.pdf !== 'false',
        sections: ids,
      })
    }
    if (what === 'shorts' || what === 'all') {
      report.shorts = await buildShorts(what === 'all' ? [] : ids, {
        voice: cmd === 'voice' || Boolean(args.voice),
        sheet: Boolean(args.sheet),
        stack: args.stack,
      })
    }
    const { summary } = await import('../src/cache.mjs')
    const { closeGfx } = await import('../src/video/gfx.mjs')
    await closeGfx()
    log(`done in ${elapsed().toFixed(1)}s; ${summary() || 'nothing to do'}`)
    log(`outputs in ${OUT}`)
    // Stopped unless asked not to (`--no-stop`, or `--keep-stack`). This read
    // `args.stop`, which only an explicit `--stop` sets, so every build left
    // its servers running, and the next brand's build talked to them.
    if (!args['keep-stack'] && !args['no-stop']) {
      const { stopAll } = await import('../src/stack/index.mjs')
      await stopAll()
    }
    const failed = (report.manual ?? []).reduce((n, m) => n + m.failures.length, 0)
    if (failed) {
      process.exitCode = 1
      log(`${failed} screenshot directive(s) failed; see above`)
    }
    const problems = report.shorts.reduce((n, s) => n + s.problems, 0)
    if (problems) log(`WARNING: ${problems} annotation problem(s); see the *-check.txt files`)
    return
  }
  if (cmd === 'stale') {
    const { stale } = await import('../src/stale.mjs')
    await stale({ base: args.base ?? 'origin/qabandi', json: Boolean(args.json), loadShorts })
    return
  }
  if (cmd === 'publish') {
    const { publish } = await import('../src/publish.mjs')
    await publish({
      dryRun: Boolean(args['dry-run']),
      prefix: args.prefix,
      links: Boolean(args.links),
    })
    return
  }
  if (cmd === 'stack') {
    const kind = rest[1] ?? 'fixtures'
    if (rest[0] === 'down') {
      const mod = await import(
        kind === 'seeded' ? '../src/stack/seeded.mjs' : '../src/stack/fixtures.mjs'
      )
      await mod.stop()
      log(`${kind} stack stopped`)
    } else {
      const { getStack } = await import('../src/stack/index.mjs')
      const s = await getStack(kind)
      log(`${kind} stack on ${s.base}`)
    }
    return
  }
  if (cmd === 'cache' && rest[0] === 'prune') {
    const { prune } = await import('../src/cache.mjs')
    const before = Date.now() - Number(args.days ?? 30) * 86400000
    for (const kind of ['shot', 'rec', 'seg', 'voice', 'gfx', 'music', 'snapshot'])
      log(`${kind}: ${prune(kind, before)} removed`)
    return
  }
  console.log(
    `pnpm guide <build|stale|voice|publish|stack|cache>. Cache: ${CACHE}. See docs/guide/README.md.`,
  )
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
