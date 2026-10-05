// pnpm guide:stale [--base origin/qabandi] [--json]
//
// Which parts of the guide a change makes out of date, without building
// anything. The diff (committed since the merge base, plus whatever is in the
// working tree) is mapped two ways, and the answers are joined:
//
//   1. Each page and short declares what it shows: its screenshot directives
//      and routes, its front-matter routes, messages and components, its
//      caption keys. Each route is followed through its imports (graph.mjs),
//      and a catalogue change is narrowed to the keys that actually changed.
//   2. `pnpm q impact --json` is asked which screens each changed source file
//      reaches, as a second opinion from the repository's own index.
//
// The output says what will re-render on the next build and why: a picture,
// a whole short (its recording), or one step (its caption). Words in a manual
// section that describe a changed screen are listed too: those cannot be
// re-rendered, only re-read by a person.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { REPO } from './paths.mjs'
import { closure, matchRoute, screen } from './graph.mjs'
import { sections, findShots } from './manual/build.mjs'
import { parseShot, peekPath } from './manual/shots.mjs'
import { log } from './util.mjs'

const git = (args) =>
  execFileSync('git', args, {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()

function flatten(o, p = '', out = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v && typeof v === 'object') flatten(v, `${p}${k}.`, out)
    else out[`${p}${k}`] = v
  }
  return out
}

/** Keys whose text differs between the merge base and the working tree. */
function changedKeys(file, base) {
  let before = {}
  try {
    before = flatten(JSON.parse(git(['show', `${base}:${file}`])))
  } catch {}
  let after = {}
  try {
    after = flatten(JSON.parse(readFileSync(join(REPO, file), 'utf8')))
  } catch {}
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => before[k] !== after[k],
  )
}

export function changes(baseRef) {
  const base = git(['merge-base', baseRef, 'HEAD'])
  const files = new Set([
    ...git(['diff', '--name-only', base]).split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
  ])
  files.delete('')
  const appKeys = new Set()
  const captionKeys = new Set()
  for (const f of files) {
    if (/^apps\/web\/messages\/\w+\.json$/.test(f))
      for (const k of changedKeys(f, base)) appKeys.add(k)
    if (/^docs\/guide\/captions\/\w+\.json$/.test(f))
      for (const k of changedKeys(f, base)) captionKeys.add(k)
  }
  return { base, files, appKeys, captionKeys }
}

/** Screens each changed source file reaches, according to `pnpm q impact`. */
function qImpact(files) {
  const screens = new Map()
  for (const f of files) {
    if (!/^(apps|packages)\/.*\.(tsx?|mjs)$/.test(f) || /\.test\./.test(f)) continue
    try {
      const j = JSON.parse(
        execFileSync('node', ['scripts/q.mjs', 'impact', f, '--json'], {
          cwd: REPO,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      )
      for (const s of j.screens) {
        if (!screens.has(s.url)) screens.set(s.url, [])
        screens.get(s.url).push(f)
      }
    } catch {}
  }
  return screens
}

const keyHit = (keys, ns) =>
  [...keys].filter((k) => ns.some((n) => k === n || k.startsWith(`${n}.`)))
const usedKeys = (text) => [...text.matchAll(/\{app:([\w.-]+)/g)].map((m) => m[1])
const concretePath = (p, locale) => peekPath(p, locale).split('?')[0]

/** Why a screen (by path) is stale, or null. */
function screenReasons(path, locale, ch, impact) {
  const s = screen(concretePath(path, locale), locale)
  const why = []
  const files = s.files.filter((f) => ch.files.has(f))
  if (files.length)
    why.push(
      `source: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` (+${files.length - 3})` : ''}`,
    )
  const keys = keyHit(ch.appKeys, s.namespaces)
  if (keys.length)
    why.push(
      `text: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ` (+${keys.length - 3})` : ''}`,
    )
  const q = impact.get(s.route.url)
  if (q && !files.length) why.push(`q impact: ${q.slice(0, 2).join(', ')}`)
  return why.length ? { route: s.route.url, why } : null
}

export async function stale({ base = 'origin/qabandi', json = false, loadShorts }) {
  const ch = changes(base)
  const impact = qImpact(ch.files)
  const toolChanged = [...ch.files].filter((f) => f.startsWith('tools/guide/'))
  const report = {
    base: ch.base,
    changed: ch.files.size,
    tool: toolChanged,
    manual: [],
    shorts: [],
  }

  for (const locale of ['en', 'ar']) {
    for (const sec of sections(locale)) {
      const file = relative(REPO, sec.file)
      const entry = { section: file, shots: [], text: [] }
      if (ch.files.has(file)) entry.text.push('the section itself changed')
      for (const sh of findShots(sec.body)) {
        const shot = parseShot(sh.target)
        const r = screenReasons(shot.path, shot.locale, ch, impact)
        if (r) entry.shots.push({ shot: sh.target, ...r })
      }
      // The words: routes, components and keys the section says it describes.
      for (const r of sec.meta.routes ?? []) {
        const route = matchRoute(r.replace(/\[[^\]]+\]/g, 'x'))
        if (!route) continue
        const own = [route.file, ...route.layouts].filter((f) => ch.files.has(f))
        if (own.length) entry.text.push(`${route.url} changed (${own.join(', ')})`)
      }
      for (const c of sec.meta.components ?? [])
        if (ch.files.has(c)) entry.text.push(`${c} changed`)
      const keys = [...new Set([...(sec.meta.messages ?? []), ...usedKeys(sec.body)])].filter((k) =>
        ch.appKeys.has(k),
      )
      if (keys.length)
        entry.text.push(
          `labels it quotes changed: ${keys.join(', ')} (the build picks up the new words)`,
        )
      if (entry.shots.length || entry.text.length) report.manual.push(entry)
    }
  }

  for (const { spec, file } of await loadShorts()) {
    const rel = relative(REPO, file)
    const locale = spec.locale ?? 'en'
    const entry = { short: spec.id, recording: [], steps: [] }
    if (ch.files.has(rel)) entry.recording.push('the spec changed')
    for (const r of spec.routes ?? [spec.start]) {
      const why = screenReasons(r, locale, ch, impact)
      if (why) entry.recording.push(`${why.route}: ${why.why.join('; ')}`)
    }
    const comp = closure(spec.components ?? []).filter((f) => ch.files.has(f))
    if (comp.length) entry.recording.push(`components: ${comp.join(', ')}`)
    const specKeys = usedKeys(readFileSync(file, 'utf8')).filter((k) => ch.appKeys.has(k))
    if (specKeys.length) entry.recording.push(`callout labels: ${specKeys.join(', ')}`)
    for (const s of spec.steps) {
      const why = []
      if (s.caption?.key && ch.captionKeys.has(s.caption.key)) why.push(`caption ${s.caption.key}`)
      let raw = typeof s.caption === 'string' ? s.caption : ''
      if (s.caption?.key) {
        try {
          const { caption } = await import('./catalog.mjs')
          raw = caption(s.caption.key, locale)
        } catch {}
      }
      const k = usedKeys(raw).filter((x) => ch.appKeys.has(x))
      if (k.length) why.push(`caption quotes ${k.join(', ')}`)
      if (why.length) entry.steps.push({ step: s.id, why })
    }
    if (entry.recording.length || entry.steps.length) report.shorts.push(entry)
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return report
  }
  const out = []
  out.push(
    `Guide staleness against ${base} (merge base ${report.base.slice(0, 8)}, ${report.changed} files changed)`,
  )
  if (toolChanged.length)
    out.push(
      `\nThe guide tooling changed (${toolChanged.length} files): entries it hashes will rebuild.`,
    )
  if (!report.manual.length && !report.shorts.length)
    out.push('\nNothing in the guide depends on this change.')
  if (report.manual.length) {
    out.push('\nManual')
    for (const m of report.manual) {
      out.push(`  ${m.section}`)
      for (const s of m.shots)
        out.push(`    picture ${s.shot}\n      ${s.route}: ${s.why.join('; ')}`)
      for (const t of m.text) out.push(`    words: ${t}`)
    }
  }
  if (report.shorts.length) {
    out.push('\nShorts')
    for (const s of report.shorts) {
      out.push(`  ${s.short}`)
      for (const r of s.recording) out.push(`    re-record: ${r}`)
      for (const st of s.steps) out.push(`    step ${st.step}: ${st.why.join('; ')}`)
    }
  }
  console.log(out.join('\n'))
  log(`${report.manual.length} manual section(s) and ${report.shorts.length} short(s) affected`)
  return report
}
