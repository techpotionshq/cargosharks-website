/**
 * What `generate.mjs` and `ideate.mjs` share: the OpenRouter call, SearXNG,
 * the backlog file and the list of paths a post may link to.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const APP = join(HERE, '..', '..')
export const CONTENT = join(APP, 'content', 'blog')
const TOPICS = join(HERE, 'topics.json')

export const readBacklog = () => JSON.parse(readFileSync(TOPICS, 'utf8'))
export const writeBacklog = (backlog) =>
  writeFileSync(TOPICS, `${JSON.stringify(backlog, null, 2)}\n`)

/**
 * Topic ids that already have an open pull request, passed by the workflow as
 * `--skip a,b`. Without this a draft waiting for review would be drafted again
 * the next morning, because `main` still lists its topic as `ready`.
 */
export function skipped(args) {
  const i = args.indexOf('--skip')
  return new Set(i === -1 ? [] : (args[i + 1] ?? '').split(',').filter(Boolean))
}

export function headers() {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not set')
  return {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    'http-referer': 'https://cargosharks.com',
    'x-title': 'CargoSharks blog',
  }
}

function extractJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1)
      throw new Error(`no JSON in model output: ${text.slice(0, 300)}`)
    return JSON.parse(text.slice(start, end + 1))
  }
}

/**
 * A structured completion. Native `json_schema` first; a provider that rejects
 * strict schemas gets `json_object`, and the tolerant parser does the rest.
 */
export async function complete({ system, user, schema, model }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  const post = (format) =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ model, response_format: format, messages }),
    })
  let res = await post({ type: 'json_schema', json_schema: schema })
  if (res.status === 400) res = await post({ type: 'json_object' })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 400)}`)
  const content = (await res.json()).choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter returned no content')
  return extractJson(content)
}

/** SearXNG results, or nothing. Never throws: grounding is a bonus, not a dependency. */
export async function searxng(query, limit = 6) {
  const base = process.env.SEARXNG_URL?.replace(/\/$/, '')
  if (!base) return []
  try {
    const res = await fetch(
      `${base}/search?${new URLSearchParams({ q: query, format: 'json', categories: 'general' })}`,
      {
        headers: { accept: 'application/json' },
      },
    )
    if (!res.ok) return []
    return ((await res.json()).results ?? []).slice(0, limit)
  } catch {
    return []
  }
}

export const formatSources = (results) =>
  results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.content ?? '').slice(0, 280)}`)
    .join('\n')

/** Every internal path a post may link to, read from the same lists the site is built from. */
export function knownPaths() {
  const read = (file) => readFileSync(join(APP, 'src', 'content', file), 'utf8')
  const solutions = [...read('solution-nav.ts').matchAll(/slug: '([a-z0-9-]+)'/g)].map((m) => m[1])
  const compares = [...read('comparisons.ts').matchAll(/^\s{4}slug: '([a-z0-9-]+)'/gm)].map(
    (m) => m[1],
  )
  const posts = existsSync(CONTENT) ? readdirSync(CONTENT) : []
  return new Set([
    '/',
    '/ar/',
    '/what-we-do/',
    '/compare/',
    '/blog/',
    '/ar/blog/',
    '/privacy/',
    '/terms/',
    ...solutions.flatMap((s) => [`/${s}/`, `/ar/${s}/`]),
    ...compares.map((s) => `/compare/${s}/`),
    ...posts.flatMap((s) => [`/blog/${s}/`, `/ar/blog/${s}/`]),
  ])
}

/** Titles already published or in the backlog, so ideation does not propose them twice. */
export function existingTitles(backlog) {
  const posts = existsSync(CONTENT)
    ? readdirSync(CONTENT).flatMap((slug) => {
        try {
          const meta = JSON.parse(readFileSync(join(CONTENT, slug, 'post.json'), 'utf8'))
          return [meta.en?.title, meta.ar?.title].filter(Boolean)
        } catch {
          return []
        }
      })
    : []
  return [...posts, ...backlog.topics.flatMap((t) => [t.title, t.targetQuery])]
}

/** One line for the workflow to read back (`steps.<id>.outputs.<key>`). */
export function output(values) {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  const lines = Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`)
  writeFileSync(file, `${lines.join('\n')}\n`, { flag: 'a' })
}
