#!/usr/bin/env node
/**
 * `q` — the repository's own index.
 *
 * Every question below was already answerable with enough greps. The problem
 * was never that the answer was hidden; it was that each answer took four or
 * five round trips through a codebase with three layers of indirection, and
 * the indirection is deliberate in all three cases:
 *
 *   - **Text is a key.** A screen says "Awaiting customs"; the string lives in
 *     `messages/en.json` under a path; the path is used as `t('leaf')` against
 *     a namespace bound two hundred lines earlier, sometimes inside a
 *     `Promise.all` destructure. Going from what an operator reported to the
 *     line that renders it is three hops, and the middle one is easy to get
 *     wrong.
 *   - **A URL is not a path.** Route groups mean `/invoices` lives at
 *     `app/(ops)/invoices/page.tsx`, and nothing about the URL says `(ops)`.
 *   - **A table is four files.** Its declaration, the migration that created
 *     it, the migration that wrote its policy, and the one that attached its
 *     audit trigger — and the last two are frequently `do $$ ... end $$` loops
 *     over a name array rather than a line you can grep for.
 *
 * So this reads the whole tree once — 470 files, about 120ms — builds the
 * indexes in memory, answers, and exits. There is no cache on disk, which is
 * a decision rather than an omission: a cache would need invalidating, and
 * scanning is already faster than deciding whether the cache is stale.
 *
 * The parsing is deliberately the same shape as `scripts/check-*.mjs` — text
 * and regexes, no TypeScript program. Those checks have been wrong in
 * documented ways and were fixed; reusing their patterns inherits the fixes
 * instead of reinventing the bugs. Where a pattern here is a heuristic that
 * can be wrong, it says so in its own output rather than in a comment nobody
 * reads.
 *
 * Usage: `pnpm q <verb>` — `pnpm q help` for the list.
 */

import { globSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

/*
  Every glob and every path printed below is repo-relative, the same as the
  check scripts. Rather than resolving against the caller's directory in nine
  places, move there once — `pnpm q` from a package directory then behaves
  identically to `pnpm q` from the root.
*/
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(ROOT)

/**
 * `globSync` yields the platform separator and every path operation here is
 * written in terms of `/`. `check-links.mjs` learned this the hard way: without
 * it the whole scan silently matched nothing on Windows, and then crashed when
 * an unstripped `(ops)` reached a `RegExp` constructor as an unbalanced group.
 */
const posix = (f) => f.replaceAll('\\', '/')
const glob = (pattern) => globSync(pattern).map(posix).sort()

/**
 * Undoes MSYS path conversion on an argument that was meant to be a URL.
 *
 * Git Bash rewrites any argument that looks like an absolute POSIX path into a
 * Windows one before the process ever sees it, so `q where /invoices` arrives
 * as `C:/Program Files/Git/invoices` and matches nothing. It is not a mistake
 * anyone can avoid making — the shell does it silently, and the two shells on
 * this machine disagree about whether it happens at all.
 *
 * The recovery is to strip the longest prefix that exists on disk: the MSYS
 * root does, the route glued to the end of it does not. A genuine Windows path
 * to a real file survives, because then the whole thing exists.
 */
function unmangle(argument) {
  if (!argument || !/^[A-Za-z]:[\\/]/.test(argument)) return argument
  const path = posix(argument)

  /*
    A bare `/` becomes the MSYS root itself, which exists in full — so the
    "strip the part that does not exist" rule below finds nothing to strip and
    would hand back `C:/Program Files/Git`. Only `q where` calls this, and its
    argument is always a URL, so an existing absolute directory can only be
    the root that was typed as `/`.
  */
  if (existsSync(path)) return '/'

  const parts = path.split('/')
  for (let cut = parts.length - 1; cut > 0; cut--) {
    if (existsSync(parts.slice(0, cut).join('/'))) return `/${parts.slice(cut).join('/')}`
  }
  return argument
}

// --- output ---------------------------------------------------------------

const BOLD = (s) => `\x1b[1m${s}\x1b[0m`
const DIM = (s) => `\x1b[2m${s}\x1b[0m`
const RED = (s) => `\x1b[31m${s}\x1b[0m`
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`

const out = (s = '') => console.log(s)
const heading = (s) => out(`\n${BOLD(s)}`)

/**
 * A file reference, printed the way every terminal and editor links it.
 * `file:line` is the whole contract — this exists so no call site invents a
 * different one.
 */
const at = (file, line) => (line ? `${file}:${line}` : file)

/** Truncates for a register-style list without hiding that it truncated. */
function listing(rows, limit = 20) {
  for (const row of rows.slice(0, limit)) out(`  ${row}`)
  if (rows.length > limit) out(DIM(`  … and ${rows.length - limit} more`))
}

// --- lazy indexes ---------------------------------------------------------

/*
  Each verb needs two or three of these and none needs all of them, so they
  build on first touch. `q msg` reads the catalogues and the app sources;
  `q table` reads the schema and the migrations; neither pays for the other.
*/
const memo = new Map()
const lazy = (name, build) => () => {
  if (!memo.has(name)) memo.set(name, build())
  return memo.get(name)
}

const read = (file) => readFileSync(file, 'utf8')

/**
 * Maps a character offset to a 1-based line number.
 *
 * Built once per file and binary-searched, because the alternative —
 * `source.slice(0, index).split('\n').length` at every match — is quadratic
 * over a file like `fixtures.ts`, which is 7,800 lines and matches a lot.
 */
function lineFinder(source) {
  const offsets = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') offsets.push(i + 1)
  return (index) => {
    let lo = 0
    let hi = offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

/** Application and package sources — what a code question is asked about. */
const sources = lazy('sources', () => glob('{apps,packages}/*/src/**/*.{ts,tsx}'))

/** The web app alone. Message and route questions are about this one. */
const webSources = lazy('webSources', () => glob('apps/web/src/**/*.{ts,tsx}'))

const fileCache = new Map()
function source(file) {
  if (!fileCache.has(file)) fileCache.set(file, read(file))
  return fileCache.get(file)
}

// --- messages -------------------------------------------------------------

/**
 * Both catalogues, flattened to `key -> string`, plus the reverse index that
 * makes "the screen says X" answerable.
 *
 * The reverse index is keyed on the lowercased value because the question
 * always arrives as text somebody read off a screen, and they do not
 * reproduce the capitalisation.
 */
const messages = lazy('messages', () => {
  const raw = {
    en: JSON.parse(read('apps/web/messages/en.json')),
    ar: JSON.parse(read('apps/web/messages/ar.json')),
  }

  const flatten = (node, prefix, into) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, into)
      else into.set(path, String(value))
    }
    return into
  }

  const en = flatten(raw.en, '', new Map())
  const ar = flatten(raw.ar, '', new Map())

  return { raw, en, ar }
})

/**
 * `key -> [file:line]`, resolved through the namespace each `t` is bound to.
 *
 * Lifted from `check-messages.mjs`, including the second binding form. That
 * one is not an edge case: thirty-two files bind their namespaces inside a
 * `Promise.all` destructure, and they are disproportionately the dialogs —
 * every create-and-edit form in the product. A scan that only understands
 * `const t = useTranslations('ns')` reports those files as using no keys at
 * all, which is exactly the wrong answer to "where is this string used".
 */
const messageUsage = lazy('messageUsage', () => {
  const BIND =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(\s*'([^']+)'\s*\)/g
  const DESTRUCTURED =
    /(?:const|let)\s*\[([^\]]+)\]\s*=\s*(?:await\s+)?Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g
  const NAMESPACE_ARG = /^(?:await\s+)?(?:getTranslations|useTranslations)\(\s*'([^']+)'\s*\)$/
  const CALL = /\b(\w+)\(\s*'([^']+)'/g
  const DYNAMIC = /\b(\w+)\(\s*`([^`]*)`/g

  /*
    Splits an array literal on commas that are not inside brackets. Comments
    come out first, and that is not tidiness: these arrays are heavily
    commented in the house style and a prose comma is indistinguishable from
    an element boundary once you are counting brackets.
  */
  const topLevelElements = (body) => {
    const text = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const parts = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
      else if (ch === ',' && depth === 0) {
        parts.push(text.slice(start, i).trim())
        start = i + 1
      }
    }
    parts.push(text.slice(start).trim())
    return parts
  }

  const { en } = messages()
  const used = new Map() // key -> [{file, line}]
  const dynamic = [] // interpolated calls, reported rather than resolved
  const byFile = new Map() // file -> Set<namespace>

  const record = (key, file, line) => {
    if (!used.has(key)) used.set(key, [])
    used.get(key).push({ file, line })
  }

  for (const file of webSources()) {
    const text = source(file)
    const namespaces = new Map()
    const bind = (name, ns) => {
      if (!namespaces.has(name)) namespaces.set(name, new Set())
      namespaces.get(name).add(ns)
    }

    for (const m of text.matchAll(BIND)) bind(m[1], m[2])
    for (const m of text.matchAll(DESTRUCTURED)) {
      const names = m[1].split(',').map((n) => n.trim())
      topLevelElements(m[2]).forEach((element, index) => {
        const ns = element.match(NAMESPACE_ARG)?.[1]
        if (ns && names[index]) bind(names[index], ns)
      })
    }
    if (!namespaces.size) continue

    byFile.set(file, new Set([...namespaces.values()].flatMap((s) => [...s])))
    const lineOf = lineFinder(text)

    for (const m of text.matchAll(CALL)) {
      const bound = namespaces.get(m[1])
      if (!bound) continue
      const candidates = [...bound].map((ns) => `${ns}.${m[2]}`)
      record(candidates.find((key) => en.has(key)) ?? candidates[0], file, lineOf(m.index))
    }
    for (const m of text.matchAll(DYNAMIC)) {
      const bound = namespaces.get(m[1])
      if (!bound) continue
      for (const ns of bound) {
        dynamic.push({ file, line: lineOf(m.index), pattern: `${ns}.${m[2]}` })
      }
    }
  }

  return { used, dynamic, byFile }
})

// --- routes ---------------------------------------------------------------

/**
 * URL -> the file that answers it, plus whether fixture mode can render it.
 *
 * Route handlers count as routes. `check-links.mjs` collected only `page.tsx`
 * and scored every `href` at an API route as dead — and `/api/documents/[id]`
 * is a link a person clicks: it downloads their bill of lading.
 */
const routes = lazy('routes', () => {
  const toUrl = (file) =>
    file
      .replace('apps/web/src/app', '')
      .replace(/\/(page\.tsx|route\.ts)$/, '')
      .replace(/\/\([a-z]+\)/g, '') || '/'

  const needsDatabase = new Map()
  const harness = 'apps/web/e2e/support/harness.ts'
  if (existsSync(harness)) {
    const block = read(harness).split('export const NEEDS_DATABASE')[1] ?? ''
    for (const m of block.matchAll(/'([^']+)':\s*'([^']+)'/g)) needsDatabase.set(m[1], m[2])
  }

  return glob('apps/web/src/app/**/{page.tsx,route.ts}').map((file) => {
    const url = toUrl(file)
    return {
      url,
      file,
      group: file.match(/\/\(([a-z]+)\)\//)?.[1] ?? null,
      kind: file.endsWith('route.ts') ? 'handler' : 'page',
      dynamic: url.includes('['),
      needsDatabase: needsDatabase.get(url) ?? null,
    }
  })
})

// --- the import graph -----------------------------------------------------

/**
 * Who imports whom, resolved to real files.
 *
 * `apps/web` and `apps/landing` alias `@/*` to their own `src`; `apps/service`
 * has no alias and uses relative paths throughout. Both are resolved here.
 * A cross-package specifier (`@qabandi/core`) resolves to that package's
 * barrel, which is as precise as the specifier itself is — the barrel is what
 * the importer named.
 */
const graph = lazy('graph', () => {
  const files = new Set(sources())
  const SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g

  const resolveSpec = (spec, from) => {
    let base
    if (spec.startsWith('.')) base = posix(join(dirname(from), spec))
    else if (spec.startsWith('@/')) {
      const app = from.startsWith('apps/landing') ? 'apps/landing' : 'apps/web'
      base = `${app}/src/${spec.slice(2)}`
    } else if (spec.startsWith('@qabandi/')) {
      const pkg = spec.slice('@qabandi/'.length).split('/')[0]
      base = `packages/${pkg}/src/index`
    } else return null

    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
      if (files.has(candidate)) return candidate
    }
    return null
  }

  const importsOf = new Map() // file -> Set<file>
  const importedBy = new Map() // file -> Set<file>

  for (const file of files) {
    const targets = new Set()
    for (const m of source(file).matchAll(SPECIFIER)) {
      const target = resolveSpec(m[1], file)
      if (!target || target === file) continue
      targets.add(target)
      if (!importedBy.has(target)) importedBy.set(target, new Set())
      importedBy.get(target).add(file)
    }
    importsOf.set(file, targets)
  }

  return { importsOf, importedBy }
})

/** Every exported name, with where it is declared. */
const symbols = lazy('symbols', () => {
  const EXPORT =
    /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(const|let|function|class|type|interface|enum)\s+(\w+)/gm
  const index = new Map() // name -> [{file, line, kind}]
  for (const file of sources()) {
    const text = source(file)
    const lineOf = lineFinder(text)
    for (const m of text.matchAll(EXPORT)) {
      if (!index.has(m[2])) index.set(m[2], [])
      index.get(m[2]).push({ file, line: lineOf(m.index), kind: m[1] })
    }
  }
  return index
})

// --- feature slices -------------------------------------------------------

/**
 * The twenty-five slices, each with what it owns.
 *
 * A slice is a convention, not a type: `queries.ts` reads, `form-actions.ts`
 * writes, `ui/` renders, `*.test.ts` proves. Listing the four together with
 * the permissions it enforces and the message namespaces it owns is the
 * orientation that otherwise costs a directory listing and four greps.
 */
const slices = lazy('slices', () => {
  const ASSERT = /assertCan\(\s*\w+\s*,\s*'([a-z_]+\.[a-z_.]+)'/g
  const NAMESPACE = /(?:getTranslations|useTranslations)\(\s*'([^']+)'\s*\)/g
  const EXPORT = /^export\s+(?:async\s+)?(?:const|function|class|type|interface)\s+(\w+)/gm

  const { importedBy } = graph()
  const map = new Map()

  for (const file of glob('apps/web/src/features/**/*.{ts,tsx}')) {
    const name = file.split('/')[4]
    if (!map.has(name)) {
      map.set(name, {
        name,
        files: [],
        tests: [],
        exports: [],
        permissions: new Set(),
        namespaces: new Set(),
        loc: 0,
      })
    }
    const slice = map.get(name)
    const text = source(file)

    slice.loc += text.split('\n').length
    ;(file.includes('.test.') ? slice.tests : slice.files).push(file)
    if (!file.includes('.test.')) {
      for (const m of text.matchAll(EXPORT)) slice.exports.push({ name: m[1], file })
    }
    for (const m of text.matchAll(ASSERT)) slice.permissions.add(m[1])
    for (const m of text.matchAll(NAMESPACE)) slice.namespaces.add(m[1])
  }

  /*
    Which screens render a slice. Read off the import graph rather than by
    matching names, because the two diverge constantly and usefully: the
    invoice register is `app/(ops)/invoices` and imports `features/ledger`.
  */
  for (const slice of map.values()) {
    const renderedBy = new Set()
    for (const file of slice.files) {
      for (const importer of importedBy.get(file) ?? []) {
        if (importer.startsWith('apps/web/src/app/')) renderedBy.add(importer)
      }
    }
    slice.routes = routes()
      .filter((r) => renderedBy.has(r.file))
      .map((r) => r.url)
      .sort()
  }

  return map
})

// --- tables ---------------------------------------------------------------

/**
 * Every declared table, with the four places it lives.
 *
 * RLS and audit status is read from the migration text, and **that reading is
 * a heuristic**: both are routinely applied by a `do $$ ... end $$` loop over
 * a name array rather than by a greppable statement, so a table protected
 * inside a loop is found by its name appearing in the same migration as the
 * loop. The authority is `pnpm test:db`, which walks the registry against a
 * real database — this says where to look, not whether it is correct, and the
 * output labels which of the two it is giving you.
 */
const tables = lazy('tables', () => {
  const DECLARE = /export const (\w+) = (pgTable|systemTable\([\s\S]*?\))\(\s*\n?\s*'([a-z_]+)'/g

  const map = new Map()
  for (const file of glob('packages/db/src/schema/*.ts')) {
    const text = source(file)
    const lineOf = lineFinder(text)
    for (const m of text.matchAll(DECLARE)) {
      map.set(m[3], {
        name: m[3],
        binding: m[1],
        class: m[2].startsWith('systemTable') ? 'system' : 'business',
        file,
        line: lineOf(m.index),
      })
    }
  }

  const migrations = glob('packages/db/migrations/*.sql').map((file) => ({
    file,
    text: read(file),
  }))

  for (const table of map.values()) {
    const name = table.name
    const quoted = new RegExp(`'${name}'|"${name}"|\\b${name}\\b`)

    table.createdIn = migrations.find((m) =>
      new RegExp(`create table (if not exists )?"?${name}"?`, 'i').test(m.text),
    )?.file
    table.rlsIn = migrations.find((m) =>
      new RegExp(`alter table "?${name}"? enable row level security`, 'i').test(m.text),
    )?.file
    table.policyIn = migrations.find((m) =>
      new RegExp(`create policy [\\w_]+ on "?${name}"?`, 'i').test(m.text),
    )?.file
    table.auditIn = migrations.find((m) =>
      new RegExp(`attach_audit\\(\\s*'${name}'`, 'i').test(m.text),
    )?.file

    /*
      The loop forms. Only consulted when the direct form found nothing, and
      reported differently, because "the name appears in a migration that also
      runs a loop" is evidence and not proof.
    */
    if (!table.policyIn || !table.auditIn) {
      const looped = migrations.find(
        (m) =>
          /do \$\$|perform app\.attach_audit\(|execute format/.test(m.text) && quoted.test(m.text),
      )
      if (looped) {
        table.loopedIn = looped.file
        table.policyIn ??= null
        table.auditIn ??= null
      }
    }
  }

  return map
})

// --- verbs ----------------------------------------------------------------

const VERBS = {}
const verb = (name, summary, run) => (VERBS[name] = { name, summary, run })

verb('help', 'this list', () => {
  out(BOLD('\nq — the repository index. Everything prints file:line.\n'))
  for (const { name, summary } of Object.values(VERBS)) {
    out(`  ${BOLD(name.padEnd(9))} ${summary}`)
  }
  out(DIM('\n  Run as `pnpm q <verb>`. Nothing here touches the database or the network.'))
  out(DIM('  `pnpm q gate` is the one that runs checks; it refuses the expensive ones.\n'))
})

verb('map', 'the whole repository at one screen', () => {
  heading('Feature slices — apps/web/src/features')
  const rows = [...slices().values()].sort((a, b) => b.loc - a.loc)
  for (const s of rows) {
    const where = s.routes.length ? DIM(s.routes.slice(0, 3).join(' ')) : DIM('(no route)')
    out(`  ${s.name.padEnd(15)} ${String(s.loc).padStart(5)} loc  ${where}`)
  }

  heading('Packages')
  out(`  core        ${glob('packages/core/src/*.ts').length} engines, imports nothing`)
  out(
    `  db          ${tables().size} tables, ${glob('packages/db/migrations/*.sql').length} migrations`,
  )
  out(`  brand       the only place a colour literal is legal`)

  heading('Service — apps/service/src')
  for (const dir of glob('apps/service/src/*').filter((f) => !f.includes('.'))) {
    out(`  ${dir.split('/').pop().padEnd(12)} ${glob(`${dir}/**/*.ts`).length} files`)
  }

  heading('Routes')
  const rs = routes()
  const groups = [...new Set(rs.map((r) => r.group).filter(Boolean))]
  out(
    `  ${rs.filter((r) => r.kind === 'page').length} pages, ${rs.filter((r) => r.kind === 'handler').length} handlers`,
  )
  out(`  groups: ${groups.map((g) => `(${g})`).join(' ')}`)
  out(
    `  ${rs.filter((r) => r.needsDatabase).length} need a database even in fixture mode — q where <url>`,
  )

  heading('Messages')
  const { en, ar } = messages()
  out(`  ${en.size} keys en, ${ar.size} ar${en.size === ar.size ? '' : RED('  ← out of parity')}`)
})

verb('find', 'one query against every index at once', (args) => {
  const query = args.join(' ').trim()
  if (!query) return fail('q find <anything> — a string, a key, a url, a table, a symbol')
  const needle = query.toLowerCase()
  const hit = (s) => s.toLowerCase().includes(needle)
  const exact = (s) => s.toLowerCase() === needle
  let found = 0

  const section = (title, rows, limit) => {
    if (!rows.length) return
    found += rows.length
    heading(title)
    listing(rows, limit)
  }

  // Messages first: "where does it say X" is the question that arrives most.
  const { en, ar } = messages()
  const { used } = messageUsage()
  const textHits = [...en].filter(([key, value]) => hit(value) || hit(key))
  section(
    `Message strings (${textHits.length})`,
    textHits.map(([key, value]) => {
      const sites = used.get(key) ?? []
      /*
        "unused" would be a lie here. Enum-backed groups are read as
        `t(`kinds.${row.kind}`)` and resolve at run time from a database enum —
        `check-messages` covers those by checking the group against the enum
        rather than by finding a call site. `q msg <key>` says which case a
        given key is in.
      */
      const where = sites.length
        ? at(sites[0].file, sites[0].line)
        : DIM('no static call site — q msg for why')
      return `${BOLD(key)}\n    en  ${value}\n    ar  ${ar.get(key) ?? RED('MISSING')}\n    ${where}${sites.length > 1 ? DIM(` +${sites.length - 1}`) : ''}`
    }),
    8,
  )

  section(
    'Routes',
    routes()
      .filter((r) => hit(r.url) || hit(r.file))
      .map((r) => `${r.url.padEnd(30)} ${r.file}${r.needsDatabase ? YELLOW('  needs db') : ''}`),
  )

  section(
    'Slices',
    [...slices().values()]
      .filter((s) => hit(s.name))
      .map(
        (s) => `${s.name.padEnd(15)} ${s.files.length} files, ${s.loc} loc  — q slice ${s.name}`,
      ),
  )

  section(
    'Tables',
    [...tables().values()]
      .filter((t) => hit(t.name) || hit(t.binding))
      .map((t) => `${t.name.padEnd(28)} ${at(t.file, t.line)}  — q table ${t.name}`),
  )

  const symbolHits = [...symbols()]
    .filter(([name]) => hit(name))
    .sort(([a], [b]) => Number(exact(b)) - Number(exact(a)) || a.length - b.length)
  section(
    'Exported symbols',
    symbolHits.flatMap(([name, sites]) =>
      sites.map((s) => `${DIM(s.kind.padEnd(9))} ${name.padEnd(28)} ${at(s.file, s.line)}`),
    ),
  )

  section(
    'File paths',
    sources().filter((f) => hit(f)),
    10,
  )

  if (!found) {
    out(`\nNothing indexed matches ${BOLD(query)}.`)
    out(DIM('  Indexes cover messages, routes, slices, tables, exports and paths.'))
    out(DIM('  For prose, comments or SQL bodies, grep — that is what grep is good at.'))
  }
})

verb('msg', 'text -> key -> both catalogues -> every use', (args) => {
  if (args[0] === 'set') return setMessage(args.slice(1))
  if (args[0] === 'rm') return removeMessage(args[1])
  const query = args.join(' ').trim()
  if (!query)
    return fail(
      'q msg "<english text>" | q msg <key> | q msg set <key> --en … --ar … | q msg rm <key>',
    )

  const { en, ar } = messages()
  const { used, dynamic } = messageUsage()
  const needle = query.toLowerCase()

  const matches = [...en].filter(
    ([key, value]) =>
      key === query || key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle),
  )
  if (!matches.length) {
    out(`\nNo English message matches ${BOLD(query)}.`)
    const arabic = [...ar].filter(([, value]) => value.includes(query))
    if (arabic.length) {
      heading('It matches Arabic, though')
      listing(arabic.map(([key, value]) => `${key}  ${value}`))
    }
    return
  }

  for (const [key, value] of matches.slice(0, 12)) {
    heading(key)
    out(`  en  ${value}`)
    out(`  ar  ${ar.get(key) ?? RED('MISSING — check-messages will fail')}`)
    const sites = used.get(key) ?? []
    if (sites.length)
      listing(
        sites.map((s) => at(s.file, s.line)),
        8,
      )
    else {
      /*
        Not necessarily dead. Enum-backed groups (`t(`statuses.${row.status}`)`)
        and the integrations catalogue are read through interpolated keys, which
        no static scan resolves — check-messages covers those separately by
        checking the group against the enum. So say which it is rather than
        implying the key is unused.
      */
      const prefix = key.slice(0, key.lastIndexOf('.'))
      const interpolated = dynamic.filter((d) => d.pattern.startsWith(prefix))
      if (interpolated.length) {
        out(DIM('  used through an interpolated key:'))
        listing(
          interpolated.map((d) => `${at(d.file, d.line)}  ${d.pattern}`),
          4,
        )
      } else out(DIM('  no static use found — may be dead, or read through an interpolated key'))
    }
  }
  if (matches.length > 12) out(DIM(`\n… and ${matches.length - 12} more. Narrow the query.`))
})

/**
 * Writes a key into both catalogues in one step, then runs the check.
 *
 * The whole point is atomicity. Two separate edits is how a key reaches
 * production in English only, and the failure is worse than a missing string:
 * half a screen silently falls back to the other language, which looks
 * deliberate. Doing both in one command means the half-done state never
 * exists on disk.
 */
function setMessage(args) {
  const key = args[0]
  const value = (flag) => {
    const i = args.indexOf(flag)
    return i === -1 ? null : args[i + 1]
  }
  const en = value('--en')
  const ar = value('--ar')

  if (!key || !key.includes('.') || !en || !ar) {
    return fail(`q msg set <key> --en "English" --ar "العربية"

Both languages are required — that is the entire reason this command exists.
Simplified Technical English for the English side: one idea per sentence,
active voice, an approved verb, no synonyms for a term used elsewhere.`)
  }

  for (const [language, text] of [
    ['en', en],
    ['ar', ar],
  ]) {
    const file = `apps/web/messages/${language}.json`
    const root = JSON.parse(read(file))
    const path = key.split('.')
    const leaf = path.pop()

    let node = root
    for (const segment of path) {
      if (node[segment] === undefined) node[segment] = {}
      if (typeof node[segment] !== 'object' || Array.isArray(node[segment])) {
        return fail(`${file}: ${key} collides — '${segment}' is already a string, not a group.`)
      }
      node = node[segment]
    }

    const existed = node[leaf] !== undefined
    node[leaf] = text
    /*
      Prettier formats these files and CI runs `format:check`, so match it
      exactly: two spaces, trailing newline. Writing it any other way turns a
      message edit into a formatting failure one job later.
    */
    writeFileSync(file, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
    out(`  ${existed ? 'updated' : 'added  '} ${language}  ${key}`)
  }

  out('')
  return report(run(process.execPath, ['scripts/check-messages.mjs'], 'check-messages'))
}

/**
 * Takes a key out of both catalogues, and refuses while code still reads it.
 *
 * Removing a key that a screen still calls does not fail a build — `next-intl`
 * renders the raw key path, so an operator sees `payables.approve` in the
 * middle of a table and reasonably concludes the software is broken. The check
 * would catch it a moment later; refusing here means the broken state never
 * exists on disk.
 */
function removeMessage(key) {
  if (!key) return fail('q msg rm <key>')

  const { en } = messages()
  if (!en.has(key)) return fail(`${key} is not in the English catalogue.`)

  const sites = messageUsage().used.get(key) ?? []
  if (sites.length) {
    return fail(
      `${key} is still read in ${sites.length} place(s):\n` +
        sites.map((s) => `  ${at(s.file, s.line)}`).join('\n') +
        '\n\nRemove the calls first — a missing key renders as its own path on the screen.',
    )
  }

  for (const language of ['en', 'ar']) {
    const file = `apps/web/messages/${language}.json`
    const root = JSON.parse(read(file))
    const path = key.split('.')
    const leaf = path.pop()

    let node = root
    for (const segment of path) {
      node = node?.[segment]
      if (!node) break
    }
    if (node && node[leaf] !== undefined) {
      delete node[leaf]
      writeFileSync(file, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
      out(`  removed ${language}  ${key}`)
    } else out(DIM(`  absent  ${language}  ${key}`))
  }

  out('')
  return report(run(process.execPath, ['scripts/check-messages.mjs'], 'check-messages'))
}

/** Prints a finished command's verdict, and fails the process if it failed. */
async function report(pending) {
  const result = await pending
  if (result.code === 0) return out(GREEN(`  ${result.label} passes`))
  out(RED(`  ${result.label} fails`))
  out(result.output.trimEnd())
  process.exitCode = 1
}

verb('where', 'a url -> the file that answers it', (args) => {
  const query = unmangle(args[0])
  if (!query) return fail('q where /invoices  (a bare `invoices` works too)')
  // A template literal is never falsy, so no `|| '/'` fallback: stripping both
  // ends of `/` already leaves the root as `/`.
  const wanted = `/${query.replace(/^\/+/, '').replace(/\/+$/, '')}`

  const all = routes()
  const matched = all
    // `/` is a substring of every route, so the root is an exact match only.
    .filter((r) =>
      wanted === '/'
        ? r.url === '/'
        : r.url === wanted || r.url.startsWith(`${wanted}/`) || r.url.includes(wanted),
    )
    // The exact route first. Asking for `/invoices` and being shown
    // `/invoices/[id]` first is a small thing that costs a second every time.
    .sort(
      (a, b) => Number(b.url === wanted) - Number(a.url === wanted) || a.url.localeCompare(b.url),
    )
  if (!matched.length) {
    out(`\nNo route answers ${BOLD(wanted)}.`)
    const near = all.filter((r) => r.url.includes(wanted.split('/')[1] ?? '')).map((r) => r.url)
    if (near.length) listing(['Nearby:', ...near])
    return
  }

  const { importsOf } = graph()
  for (const route of matched.slice(0, 6)) {
    heading(`${route.url}   ${DIM(route.kind)}`)
    out(`  ${route.file}`)
    if (route.group) out(DIM(`  route group (${route.group}) — invisible in the url`))

    const layouts = route.file
      .split('/')
      .slice(0, -1)
      .map((_, i, parts) => `${parts.slice(0, i + 1).join('/')}/layout.tsx`)
      .filter((f) => existsSync(f))
    if (layouts.length) listing(['', DIM('wrapped by'), ...layouts.map((l) => `  ${l}`)])

    const imported = [...(importsOf.get(route.file) ?? [])].filter((f) => f.includes('/features/'))
    if (imported.length) {
      out(DIM('\n  reads from'))
      listing(
        imported.map((f) => `  ${f}`),
        8,
      )
    }

    if (route.needsDatabase) {
      out(YELLOW(`\n  NEEDS_DATABASE — ${route.needsDatabase}`))
      out(DIM('  QABANDI_PILOT_FIXTURES=1 will not render this one.'))
    } else if (route.kind === 'page') {
      out(GREEN('\n  renders on fixtures — QABANDI_PILOT_FIXTURES=1 pnpm dev'))
    }
  }
})

verb('slice', 'everything one feature slice owns', (args) => {
  const name = args[0]
  const all = slices()
  if (!name) {
    heading('Slices')
    listing(
      [...all.values()]
        .sort((a, b) => b.loc - a.loc)
        .map(
          (s) => `${s.name.padEnd(15)} ${String(s.loc).padStart(5)} loc  ${s.files.length} files`,
        ),
      30,
    )
    return
  }

  const slice = all.get(name) ?? [...all.values()].find((s) => s.name.startsWith(name))
  if (!slice) return fail(`No slice named ${name}. Try: ${[...all.keys()].join(' ')}`)

  heading(`${slice.name} — ${slice.loc} loc`)
  listing(
    slice.files.map((f) => f.replace(`apps/web/src/features/${slice.name}/`, '  ')),
    20,
  )

  if (slice.routes.length) {
    heading('Rendered at')
    listing(slice.routes)
  }
  if (slice.permissions.size) {
    heading('Enforces')
    listing([...slice.permissions].sort())
  }
  if (slice.namespaces.size) {
    heading('Message namespaces')
    listing([...slice.namespaces].sort())
  }
  heading('Tests')
  listing(slice.tests.length ? slice.tests : [DIM('none — this slice has no unit test')])

  heading('Exports')
  listing(
    slice.exports.map((e) => `${e.name.padEnd(28)} ${e.file.split('/').pop()}`),
    24,
  )
  out(DIM(`\n  Slices never import each other (check-boundaries). Shared logic goes down`))
  out(DIM(`  into packages/core or packages/db.`))
})

verb('table', 'a table -> schema, migration, policy, audit, callers', (args) => {
  const name = args[0]
  const all = tables()
  if (!name) {
    heading(`${all.size} tables`)
    listing(
      [...all.values()].map(
        (t) => `${t.name.padEnd(30)} ${t.class === 'system' ? DIM('system') : ''}`,
      ),
      80,
    )
    return
  }

  const table =
    all.get(name) ?? [...all.values()].find((t) => t.name.includes(name) || t.binding === name)
  if (!table) return fail(`No table named ${name}. \`q table\` lists them all.`)

  heading(`${table.name}   ${DIM(table.class)}`)
  out(`  declared   ${at(table.file, table.line)}  as \`${table.binding}\``)
  out(`  created    ${table.createdIn ?? RED('not found in any migration')}`)

  if (table.class === 'business') {
    const status = (label, file, note) => {
      if (file) return out(`  ${label.padEnd(10)} ${GREEN(file)}`)
      if (table.loopedIn)
        return out(`  ${label.padEnd(10)} ${YELLOW(`probably ${table.loopedIn}`)} ${DIM(note)}`)
      out(`  ${label.padEnd(10)} ${RED('none found')} ${DIM(note)}`)
    }
    status('rls', table.rlsIn, '— enabled with no policy denies every row, silently')
    status('policy', table.policyIn, '— applied inside a do-block loop; grep that file to confirm')
    status('audit', table.auditIn, '— applied inside a do-block loop; grep that file to confirm')
    out(DIM('\n  These three are read from migration text. The authority is `pnpm test:db`,'))
    out(DIM('  which walks the registry against a real database.'))
  } else {
    out(DIM('\n  systemTable — outside the §5 RLS and audit obligations, with a stated reason.'))
  }

  /*
    A caller is a file that imports the schema *and* names the binding — not
    merely a file containing the word. `jobs` is the binding for the job spine
    and also an ordinary English noun: matching on the word alone put four
    landing-page marketing files at the top of this list, which is the kind of
    wrong answer that gets a tool abandoned after one use.
  */
  const callers = sources().filter((file) => {
    if (file.startsWith('packages/db/src/schema')) return false
    const text = source(file)
    if (!/from '(@qabandi\/db|[^']*\/schema[^']*)'/.test(text)) return false
    return new RegExp(`\\b${table.binding}\\b`).test(text)
  })
  if (callers.length) {
    heading(`Read or written by (${callers.length})`)
    listing(callers, 16)
  }
})

verb('sym', 'a symbol -> where it is declared and who imports it', (args) => {
  const name = args[0]
  if (!name) return fail('q sym <ExportedName>')

  const index = symbols()
  const sites = index.get(name) ?? []
  if (!sites.length) {
    const near = [...index.keys()].filter((k) => k.toLowerCase().includes(name.toLowerCase()))
    out(`\nNo export named ${BOLD(name)}.`)
    if (near.length) listing(['Did you mean:', ...near.slice(0, 12)])
    return
  }

  const { importedBy } = graph()
  const named = new RegExp(`\\b${name}\\b`)

  for (const site of sites) {
    heading(`${site.kind} ${name}`)
    out(`  ${at(site.file, site.line)}`)

    /*
      Through the barrel as well as directly.
      `withActor` is declared in `db/src/actor.ts`, re-exported from
      `db/src/index.ts`, and imported by every app file as `@qabandi/db`. Only
      following the direct edge answered "used in 7 files, all inside
      packages/db" for the single most-used function in the repository — true
      of the edge, and the opposite of the truth about the symbol.
    */
    const direct = importedBy.get(site.file) ?? new Set()
    const barrels = [...direct].filter((f) => f.endsWith('/index.ts'))
    const throughBarrel = barrels.flatMap((b) => [...(importedBy.get(b) ?? [])])

    const users = [...new Set([...direct, ...throughBarrel])]
      .filter((f) => f !== site.file && named.test(source(f)))
      .sort()

    if (users.length) {
      out(
        DIM(
          `\n  named in ${users.length} importing file(s)${barrels.length ? ` (including via ${barrels.join(', ')})` : ''}`,
        ),
      )
      listing(
        users.map((f) => `  ${f}`),
        14,
      )
    } else out(DIM('\n  nothing imports it — an unused export is one oxlint will not catch'))
  }
})

verb('impact', 'what a change to this file can break, without running anything', (args) => {
  const target = args[0] && posix(args[0]).replace(/^\.\//, '')
  if (!target) return fail('q impact <file>')

  const file = sources().find((f) => f === target || f.endsWith(`/${target}`) || f.includes(target))
  if (!file) return fail(`${target} is not an indexed source file.`)

  const { importedBy } = graph()
  if (!args.includes('--json')) heading(file)

  const seen = new Set([file])
  const frontier = [file]
  const reached = []
  while (frontier.length) {
    const current = frontier.shift()
    for (const importer of importedBy.get(current) ?? []) {
      if (seen.has(importer)) continue
      seen.add(importer)
      reached.push(importer)
      frontier.push(importer)
    }
  }

  const tests = reached.filter((f) => f.includes('.test.')).sort()
  const pages = routes().filter((r) => seen.has(r.file))
  const direct = [...(importedBy.get(file) ?? [])].sort()

  // `--json` is for tools that act on the answer — `pnpm guide:stale` maps a
  // diff to the screens it changes this way. Nothing is truncated here.
  if (args.includes('--json')) {
    out(
      JSON.stringify({
        file,
        direct,
        reached: reached.sort(),
        tests,
        screens: pages.map((r) => ({ url: r.url, file: r.file })),
      }),
    )
    return
  }

  out(`  ${direct.length} direct importer(s), ${reached.length} reachable transitively`)

  heading('Directly imports it')
  listing(direct.length ? direct : [DIM('nothing — this is a leaf')], 14)

  heading(`Tests that reach it (${tests.length}, transitively)`)
  if (tests.length) listing(tests, 14)
  else out(DIM('  none — a change here is unproven by the unit suites'))

  heading('Screens that render it')
  if (pages.length)
    listing(
      pages.map((r) => `${r.url.padEnd(28)} ${r.file}`),
      14,
    )
  else out(DIM('  none'))

  heading('Therefore')
  const advice = new Set()
  for (const f of [file, ...reached]) advice.add(checksFor(f))
  out(`  ${[...new Set([...advice].flat())].sort().join('  ') || 'nothing'}`)
  out(DIM('  Run it with `pnpm q gate`.'))
})

// --- the gate -------------------------------------------------------------

/**
 * What a change to a given path can break.
 *
 * The mapping is the useful part of this whole file. Running everything is
 * slow enough that it gets skipped; running nothing is how an English-only
 * string ships. This runs the checks that the diff can actually fail.
 */
function checksFor(file) {
  const checks = new Set(['oxlint'])
  const add = (...names) => names.forEach((n) => checks.add(n))

  if (file.startsWith('packages/core/')) add('boundaries', 'permissions', 'tsc:core', 'test:core')
  if (file.startsWith('packages/db/migrations/')) add('migrations')
  if (file.startsWith('packages/db/src/schema/'))
    add('boundaries', 'messages', 'tsc:db', 'migrations')
  if (file.startsWith('packages/db/src/')) add('boundaries', 'tsc:db')
  if (file.startsWith('packages/brand/')) add('brand', 'tsc:brand')
  if (file.startsWith('apps/web/messages/')) add('messages')
  if (file.startsWith('apps/web/src/')) add('boundaries', 'messages', 'permissions', 'tsc:web')
  if (file.startsWith('apps/web/src/app/')) add('links')
  if (/\.(tsx|css)$/.test(file)) add('brand', 'links')
  if (file.startsWith('apps/service/src/')) add('boundaries', 'permissions', 'tsc:service')
  if (/apps\/service\/src\/(queue|workers\/)/.test(file)) add('schedules')
  if (file.startsWith('apps/service/src/pdf/')) add('brand')
  if (file.startsWith('apps/landing/')) add('brand', 'tsc:landing')

  return [...checks]
}

/** Everything free. Measured on this repository, whole-repo, in milliseconds. */
const CHECK = {
  /*
    The package's own entry, not the `.bin` shim. The shim is a POSIX shell
    script; under `cmd.exe` a forward-slashed path to it is not a command at
    all. The entry is plain ESM, so `node` runs it directly on both shells and
    skips a shell process into the bargain.
  */
  oxlint: { cmd: ['node_modules/oxlint/bin/oxlint'], node: true, ms: 320 },
  boundaries: { cmd: ['scripts/check-boundaries.mjs'], node: true, ms: 130 },
  migrations: { cmd: ['scripts/check-migrations.mjs'], node: true, ms: 140 },
  messages: { cmd: ['scripts/check-messages.mjs'], node: true, ms: 140 },
  links: { cmd: ['scripts/check-links.mjs'], node: true, ms: 100 },
  schedules: { cmd: ['scripts/check-schedules.mjs'], node: true, ms: 80 },
  permissions: { cmd: ['scripts/check-permissions.mjs'], node: true, ms: 110 },
  brand: { cmd: ['scripts/check-brand.mjs'], node: true, ms: 150 },
  'tsc:core': { cmd: ['pnpm', '--filter', '@qabandi/core', 'typecheck'], shell: true, ms: 900 },
  'tsc:db': { cmd: ['pnpm', '--filter', '@qabandi/db', 'typecheck'], shell: true, ms: 900 },
  'tsc:web': { cmd: ['pnpm', '--filter', '@qabandi/web', 'typecheck'], shell: true, ms: 2000 },
  'tsc:service': {
    cmd: ['pnpm', '--filter', '@qabandi/service', 'typecheck'],
    shell: true,
    ms: 1200,
  },
  'tsc:brand': { cmd: ['pnpm', '--filter', '@qabandi/brand', 'typecheck'], shell: true, ms: 800 },
  'tsc:landing': {
    cmd: ['pnpm', '--filter', '@qabandi/landing', 'typecheck'],
    shell: true,
    ms: 1200,
  },
  'test:core': { cmd: ['pnpm', '--filter', '@qabandi/core', 'test'], shell: true, ms: 3700 },
}

/**
 * The suites that talk to the remote database, and the reason `gate` will not
 * start them on its own.
 *
 * There is no local database. `qabandi_test` is a shared remote, and
 * concurrent runs against it fail a different test each time — CI is
 * sequential for exactly this reason. So these are advised, never scheduled,
 * and `--full` runs them one after another rather than in the parallel pool.
 */
const SERIAL = {
  'test:db': {
    cmd: ['pnpm', 'test:db'],
    why: 'migrations, seed and the RLS matrix, against the shared remote',
  },
  'test:web': {
    cmd: ['pnpm', '--filter', '@qabandi/web', 'test'],
    why: 'web unit suite — also hits qabandi_test',
  },
  'test:service': {
    cmd: ['pnpm', '--filter', '@qabandi/service', 'test'],
    why: 'service unit suite — also hits qabandi_test',
  },
}

/** Minutes, not seconds. Never automatic. */
const SLOW = {
  'test:e2e': { cmd: ['pnpm', 'test:e2e'], why: 'every screen in both languages' },
  build: { cmd: ['pnpm', 'build'], why: 'the production build both apps ship as' },
}

function serialFor(files) {
  const wanted = new Set()
  for (const file of files) {
    if (/^packages\/db\/(migrations|src)\//.test(file)) wanted.add('test:db')
    if (/^apps\/web\/src\/.*\.ts$/.test(file)) wanted.add('test:web')
    if (/^apps\/service\/src\//.test(file)) wanted.add('test:service')
  }
  return [...wanted]
}

function slowFor(files) {
  const wanted = new Set()
  for (const file of files) {
    if (/^apps\/web\/(src\/app|e2e)\//.test(file)) wanted.add('test:e2e')
    if (/^(Dockerfile|compose\.|apps\/\w+\/(next\.config|build\.mjs))/.test(file))
      wanted.add('build')
  }
  return [...wanted]
}

/**
 * Runs one command and captures everything it said.
 *
 * `pnpm` is a `.cmd` shim on Windows, so it has to go through a shell — but
 * passing an args array *and* `shell: true` is deprecated (Node concatenates
 * without escaping). So the shell path gets one pre-joined string and the
 * direct path gets a real argv. Nothing here takes user input; the arguments
 * are the literals in `CHECK`.
 */
function run(command, args, label) {
  const shell = command !== process.execPath && command !== 'git'
  return new Promise((done) => {
    const child = shell
      ? spawn([command, ...args].join(' '), { stdio: ['ignore', 'pipe', 'pipe'], shell: true })
      : spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    child.on('close', (code) => done({ label, code: code ?? 1, output }))
    child.on('error', (error) => done({ label, code: 1, output: String(error) }))
  })
}

const runCheck = (name) => {
  const check = CHECK[name] ?? SERIAL[name] ?? SLOW[name]
  return check.node
    ? run(process.execPath, check.cmd, name)
    : run(check.cmd[0], check.cmd.slice(1), name)
}

/** The diff, as paths. Staged, unstaged and untracked — all of it is the change. */
async function changedFiles(against) {
  const git = (args) => run('git', args, 'git')
  const results = await Promise.all([
    git(['diff', '--name-only', '--diff-filter=d']),
    git(['diff', '--name-only', '--cached', '--diff-filter=d']),
    git(['ls-files', '--others', '--exclude-standard']),
    against
      ? git(['diff', '--name-only', '--diff-filter=d', `${against}...HEAD`])
      : Promise.resolve({ output: '' }),
  ])
  return [
    ...new Set(
      results
        .flatMap((r) => r.output.split('\n'))
        .map((f) => f.trim())
        .filter(Boolean),
    ),
  ]
}

verb('gate', 'run only the checks the current diff can break', async (args) => {
  const dry = args.includes('--dry')
  const full = args.includes('--full')
  const against = args.includes('--against') ? args[args.indexOf('--against') + 1] : null

  const files = await changedFiles(against)
  if (!files.length) {
    out(GREEN('\nNothing changed. Nothing to check.'))
    return
  }

  const wanted = [...new Set(files.flatMap(checksFor))].filter((c) => CHECK[c])
  const serial = serialFor(files)
  const slow = slowFor(files)
  const budget = Math.max(...wanted.map((c) => CHECK[c].ms), 0)

  heading(`${files.length} changed file(s)`)
  listing(files, 12)

  heading(`${wanted.length} check(s) — about ${(budget / 1000).toFixed(1)}s in parallel`)
  out(`  ${wanted.sort().join('  ')}`)

  if (serial.length || slow.length) {
    heading('Not run — these are the expensive ones')
    for (const name of serial) out(`  ${YELLOW(name.padEnd(13))} ${SERIAL[name].why}`)
    for (const name of slow) out(`  ${YELLOW(name.padEnd(13))} ${SLOW[name].why}`)
    out(DIM(serial.length ? '\n  The database suites share one remote and must not overlap.' : ''))
    out(DIM('  `pnpm q gate --full` runs them, strictly one at a time, after the rest.'))
  }

  if (dry) return out(DIM('\n--dry: nothing was run.'))

  const started = Date.now()
  const results = await Promise.all(wanted.map(runCheck))

  if (full) {
    /*
      Sequential, and not as a formality. Two suites against `qabandi_test` at
      once fail a different test each time, which reads as flakiness and costs
      an afternoon before somebody remembers why CI is ordered.
    */
    for (const name of [...serial, ...slow]) {
      out(DIM(`\n  running ${name} …`))
      results.push(await runCheck(name))
    }
  }

  const failed = results.filter((r) => r.code !== 0)
  heading(`${((Date.now() - started) / 1000).toFixed(1)}s`)

  for (const result of results.sort((a, b) => a.label.localeCompare(b.label))) {
    out(`  ${result.code === 0 ? GREEN('pass') : RED('FAIL')}  ${result.label}`)
  }

  for (const result of failed) {
    heading(`${result.label}`)
    out(result.output.trimEnd())
  }

  if (failed.length) process.exitCode = 1
  else if (!full && (serial.length || slow.length)) {
    out(YELLOW(`\n  Green, but ${[...serial, ...slow].join(', ')} did not run.`))
  }
})

// --- entry ----------------------------------------------------------------

function fail(message) {
  console.error(`\n${message}\n`)
  process.exitCode = 1
}

const [name = 'help', ...rest] = process.argv.slice(2)
const chosen = VERBS[name]

if (!chosen) {
  fail(`Unknown verb ${BOLD(name)}. Try \`pnpm q help\`.`)
} else {
  await chosen.run(rest)
}
