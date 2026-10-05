// What a screen is made of, so the cache knows when a picture of it is stale.
//
// A URL is not a path here (route groups), and a screen is not one file (its
// layouts, its feature slice, the shared UI, the fixtures it reads). This
// resolves a URL to its page and layouts, follows their imports through the
// repository, and fingerprints the result: every file's bytes, plus only the
// parts of the message catalogue those files ask for. That last part is what
// keeps a text change on the invoices screen from re-shooting the dashboard.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { REPO, WEB } from './paths.mjs'
import { fileHash, hash, stable } from './util.mjs'
import { productCatalog } from './catalog.mjs'

const APP = join(WEB, 'src', 'app')
const rel = (f) => relative(REPO, f).split('\\').join('/')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

let routeMemo
/** Every page and handler: `{ url, re, file, layouts, dynamic }`. */
export function routes() {
  if (routeMemo) return routeMemo
  routeMemo = []
  for (const file of walk(APP)) {
    const name = file.split('/').pop()
    if (!/^(page|route)\.(tsx|ts|jsx|js)$/.test(name)) continue
    const segs = relative(APP, dirname(file)).split('/').filter(Boolean)
    const urlSegs = segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'))
    const url = '/' + urlSegs.join('/')
    let dynamic = 0
    const re = new RegExp(
      '^/' +
        urlSegs
          .map((s) => {
            if (/^\[\[?\.\.\./.test(s)) return ((dynamic += 10), '.+')
            if (/^\[.*\]$/.test(s)) return (dynamic++, '[^/]+')
            return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          })
          .join('/') +
        '/?$',
    )
    const layouts = []
    let d = dirname(file)
    while (d.startsWith(APP)) {
      for (const l of ['layout.tsx', 'template.tsx', 'layout.ts'])
        if (existsSync(join(d, l))) layouts.push(join(d, l))
      if (d === APP) break
      d = dirname(d)
    }
    routeMemo.push({
      url,
      re,
      file: rel(file),
      layouts: layouts.map(rel),
      dynamic,
      kind: name.startsWith('page') ? 'page' : 'handler',
    })
  }
  return routeMemo
}

/** The route a concrete path is served by (`/jobs/abc` -> `/jobs/[id]`). */
export function matchRoute(path) {
  const p = path.split(/[?#]/)[0] || '/'
  const hits = routes().filter((r) => r.re.test(p) || (p === '/' && r.url === '/'))
  hits.sort((a, b) => a.dynamic - b.dynamic)
  return hits[0]
}

// --- imports --------------------------------------------------------------

const EXTS = ['', '.ts', '.tsx', '.mjs', '.js', '.css', '/index.ts', '/index.tsx', '/index.js']
const pkgExports = new Map()
function workspacePackage(spec) {
  const m = spec.match(/^@qabandi\/([^/]+)(\/.*)?$/)
  if (!m) return null
  const dir = join(REPO, 'packages', m[1])
  if (!existsSync(join(dir, 'package.json'))) return null
  if (!pkgExports.has(dir))
    pkgExports.set(dir, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).exports ?? {})
  const target = pkgExports.get(dir)['.' + (m[2] ?? '')]
  return typeof target === 'string' ? join(dir, target) : null
}

function resolveImport(from, spec) {
  let base
  if (spec.startsWith('@/')) base = join(WEB, 'src', spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return workspacePackage(spec)
  const noJs = base.replace(/\.js$/, '')
  for (const b of [base, noJs])
    for (const e of EXTS) {
      const p = b + e
      if (existsSync(p) && statSync(p).isFile()) return p
    }
  return null
}

const IMPORT =
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g
const importMemo = new Map()
function importsOf(abs) {
  if (!importMemo.has(abs)) {
    const src = readFileSync(abs, 'utf8')
    const out = []
    for (const m of src.matchAll(IMPORT)) {
      const r = resolveImport(abs, m[1] ?? m[2] ?? m[3])
      if (r) out.push(r)
    }
    importMemo.set(abs, out)
  }
  return importMemo.get(abs)
}

/** Every repository file reachable from `files` by import, as repo-relative paths. */
export function closure(files) {
  const seen = new Set()
  const stack = files.map((f) => resolve(REPO, f))
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f) || !existsSync(f)) continue
    seen.add(f)
    if (!/\.(tsx?|mjs|js)$/.test(f)) continue
    stack.push(...importsOf(f))
  }
  return [...seen].map(rel).sort()
}

const NS = /(?:use|get)Translations\(\s*(?:['"]([\w.]+)['"]|\{[^}]*?namespace:\s*['"]([\w.]+)['"])/g
/** The message namespaces a set of files reads. */
export function namespaces(files) {
  const out = new Set()
  for (const f of files) {
    if (!/\.(tsx?|mjs|js)$/.test(f)) continue
    for (const m of readFileSync(join(REPO, f), 'utf8').matchAll(NS)) out.add(m[1] ?? m[2])
  }
  return [...out].sort()
}

function subtree(locale, ns) {
  let node = productCatalog(locale)
  for (const part of ns.split('.')) node = node?.[part]
  return node ?? null
}

const fpMemo = new Map()
/**
 * The fingerprint of a screen in a locale: the bytes of every file it is built
 * from, and the catalogue entries it can print. Also returns what went in, for
 * `guide:stale` to compare against a diff.
 */
export function screen(path, locale = 'en') {
  const route = matchRoute(path)
  if (!route) throw new Error(`no route serves ${path}`)
  const k = `${route.url}|${locale}`
  if (!fpMemo.has(k)) {
    const files = closure([route.file, ...route.layouts])
    const ns = namespaces(files)
    const fp = hash({
      files: files.map((f) => [f, fileHash(join(REPO, f))]),
      messages: ns.map((n) => [n, stable(subtree(locale, n))]),
    })
    fpMemo.set(k, { route, files, namespaces: ns, fingerprint: fp })
  }
  return fpMemo.get(k)
}

/** Fingerprint of an explicit list of extra files (a spec's `components`, the tool's own code). */
export const filesFingerprint = (files) => hash(files.map((f) => [f, fileHash(resolve(REPO, f))]))
