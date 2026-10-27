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

/** The FAQ entries a page can render: both halves present and not blank. */
export const usableFaqs = (copy) =>
  (copy?.faqs ?? []).filter((f) => f?.question?.trim() && f?.answer?.trim())

export const MIN_FAQS = 2

/**
 * `copy` with at least `MIN_FAQS` usable FAQ entries, or an error.
 *
 * A short list is topped up by `ask(copy)`, which returns a fresh `faqs`
 * array for the finished article: a call for the FAQ alone takes seconds,
 * where regenerating the article takes minutes. `attempts` such calls, then
 * the run fails rather than ship a page with no FAQ section.
 */
export async function ensureFaqs(lang, copy, ask, attempts = 2) {
  for (let attempt = 1; usableFaqs(copy).length < MIN_FAQS; attempt++) {
    const have = usableFaqs(copy).length
    if (attempt > attempts)
      throw new Error(
        `${lang}: ${have} usable FAQ(s) after ${attempts} requests for them; a post needs at least ${MIN_FAQS}`,
      )
    console.warn(`${lang}: ${have} usable FAQ(s), asking for them alone (${attempt}/${attempts})`)
    copy = { ...copy, faqs: (await ask(copy)) ?? [] }
  }
  return copy
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

/**
 * The `#` anchors a post may link to, by page. A link to `/#anything-else`
 * resolves to the top of the page, which reads to a visitor as a link to a
 * thing that does not exist; that is how the first draft sent readers to a
 * "free time calculator" at the top of the home page.
 */
export const KNOWN_ANCHORS = new Map([
  ['/', new Set(['calculator'])],
  ['/ar/', new Set(['calculator'])],
])

const INTERNAL_LINK = /\]\((\/[^)\s#]*)(?:#([^)\s]*))?\)/g

export function checkLinks(markdown, lang, known) {
  const bad = [...markdown.matchAll(INTERNAL_LINK)]
    .filter(([, path, anchor]) =>
      anchor ? !KNOWN_ANCHORS.get(path)?.has(anchor) : !known.has(path),
    )
    .map(([, path, anchor]) => (anchor ? `${path}#${anchor}` : path))
  if (bad.length)
    throw new Error(`${lang}.md links to paths that do not exist: ${[...new Set(bad)].join(', ')}`)
}

/*
  The Arabic prompt asks for the /ar/ twin of every page that has one, and the
  first draft still sent Arabic readers to the English home page. Where a twin
  exists the right link is not a judgement, so it is rewritten rather than
  failed: the anchor text is already Arabic, only the path was wrong.
*/
export function arabicTwins(markdown, known) {
  return markdown.replace(INTERNAL_LINK, (link, path, anchor) => {
    const twin = path === '/' ? '/ar/' : `/ar${path}`
    if (path.startsWith('/ar/') || !known.has(twin)) return link
    return `](${twin}${anchor ? `#${anchor}` : ''})`
  })
}

/** Models still add an H1, frontmatter, a FAQ or a trailing sources list now and then. */
/**
 * Internal links to pages or anchors that do not exist, turned back into their
 * text. The second run's draft linked `/blog/<its own slug>/`, a page that
 * would not exist until it merged; failing four minutes of drafting for one
 * link costs more than the link is worth, while shipping it is a 404. The
 * text reads the same without the link, and `removed` goes into the pull
 * request so a reviewer sees what was taken out.
 */
export function unlinkMissing(markdown, known) {
  const removed = []
  const text = markdown.replace(
    /\[([^\]]*)\]\((\/[^)\s#]*)(?:#([^)\s]*))?\)/g,
    (link, label, path, anchor) => {
      if (anchor ? KNOWN_ANCHORS.get(path)?.has(anchor) : known.has(path)) return link
      removed.push(anchor ? `${path}#${anchor}` : path)
      return label
    },
  )
  return { markdown: text, removed }
}

/**
 * The posts already on the site, as the prompt's list of what it may link.
 * product-facts.md can only say "earlier posts" in general; without the real
 * list the model writes a plausible slug, which is how the second run's draft
 * came to link a post that does not exist.
 */
export function earlierPosts() {
  if (!existsSync(CONTENT)) return []
  return readdirSync(CONTENT).flatMap((slug) => {
    try {
      const meta = JSON.parse(readFileSync(join(CONTENT, slug, 'post.json'), 'utf8'))
      return [
        meta.en && `- \`/blog/${slug}/\` — ${meta.en.title}`,
        meta.ar && `- \`/ar/blog/${slug}/\` — ${meta.ar.title}`,
      ].filter(Boolean)
    } catch {
      return []
    }
  })
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
