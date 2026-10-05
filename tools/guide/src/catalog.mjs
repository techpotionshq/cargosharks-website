// Words. Two catalogues, and a rule for joining them.
//
// The product's own catalogue (apps/web/messages/<locale>.json) holds every
// label a reader sees on screen. The guide quotes those labels a lot ("press
// Update status"), and a quoted label is exactly what goes stale when the
// product renames a button. So guide text never copies a label: it names the
// key, `{app:jobs.detail.updateStatus}`, and the build puts in whatever the
// product calls it today. Rename the button and the manual, the captions and
// the voice-over all follow, and `guide:stale` lists what moved.
//
// Narration (captions, voice lines) is the guide's own and lives in
// docs/guide/captions/<locale>.json. It is kept out of the product catalogue
// on purpose: next-intl ships that catalogue to the browser, and a hundred
// lines of video narration have no business in every page load.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDE, WEB } from './paths.mjs'
import { brand } from './brand.mjs'

const memo = new Map()
const load = (file) => {
  if (!memo.has(file)) {
    try {
      memo.set(file, JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      memo.set(file, {})
    }
  }
  return memo.get(file)
}

export const productCatalog = (locale = 'en') => load(join(WEB, 'messages', `${locale}.json`))
export const captionCatalog = (locale = 'en') => load(join(GUIDE, 'captions', `${locale}.json`))

export function lookup(tree, key) {
  let node = tree
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** A product label by key. Throws on a missing key: a guide that prints a raw key is broken. */
export function app(key, locale = 'en') {
  const text = lookup(productCatalog(locale), key)
  if (text === undefined) throw new Error(`apps/web/messages/${locale}.json has no key "${key}"`)
  return text
}

export function caption(key, locale = 'en') {
  const text = lookup(captionCatalog(locale), key)
  if (text === undefined) throw new Error(`docs/guide/captions/${locale}.json has no key "${key}"`)
  return text
}

const TOKEN = /\{(app|brand)(?::([A-Za-z0-9_.-]+)((?:,[\w-]+=[^,}]*)*))?\}/g

/**
 * Just enough ICU to quote a label: `{name}` takes an argument (or vanishes),
 * and `{name, select|plural, a {…} other {…}}` picks the argument's branch,
 * else `other`. `{app:jobs.issueIn,language=ar}` reads "Issue in Arabic".
 */
export function icu(text, args = {}) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch !== '{') {
      out += ch
      i++
      continue
    }
    // find the matching brace
    let depth = 0
    let j = i
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}' && --depth === 0) break
    }
    const inner = text.slice(i + 1, j)
    const parts = inner.split(',')
    const name = parts[0].trim()
    if (parts.length === 1) out += args[name] ?? ''
    else {
      const body = parts.slice(2).join(',')
      const branches = {}
      for (const m of body.matchAll(/\s*(=?[\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g))
        branches[m[1]] = m[2]
      const v = args[name]
      const pick = branches[v] ?? branches[`=${v}`] ?? branches.other ?? ''
      out += icu(pick.replace(/#/g, v ?? ''), args)
    }
    i = j + 1
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Expands `{app:key}` and `{brand}` in a piece of guide text.
 * Returns the text and the product keys it used, which become dependencies.
 */
export function expand(text, locale = 'en') {
  const keys = []
  const out = text.replace(TOKEN, (_, kind, key, rawArgs) => {
    if (kind === 'brand') return brand.identity.nameEn
    keys.push(key)
    const args = Object.fromEntries(
      (rawArgs ?? '')
        .split(',')
        .filter(Boolean)
        .map((p) => p.split('=')),
    )
    return icu(app(key, locale), args)
  })
  return { text: out, keys }
}

/**
 * A caption in a short spec is either `{ key }` (the guide catalogue) or a
 * literal string. Either may use `{app:…}`. Returns the final text and every
 * key it depends on, so the cache and `guide:stale` can follow it.
 */
export function resolveCaption(spec, locale = 'en') {
  if (typeof spec === 'string') {
    const { text, keys } = expand(spec, locale)
    return { text, captionKey: null, appKeys: keys }
  }
  const raw = caption(spec.key, locale)
  const { text, keys } = expand(raw, locale)
  return { text, captionKey: spec.key, appKeys: keys }
}
