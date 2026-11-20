/**
 * What the blog generator shares: the OpenRouter and SearXNG calls, and the
 * guards every draft passes through (FAQ count, links, Arabic twins).
 *
 * Pure: the CMS reads and writes happen in `src/app/cron/blog/route.ts`, and
 * the lists these check against are passed in.
 */

import { comparisons } from '../../src/content/comparisons'
import { solutionNav } from '../../src/content/solution-nav'

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

/**
 * Em dashes out, and FAQ answers that talk about "the article" turned into
 * direct answers. The voice forbids both; the model writes them anyway (54 em
 * dashes in one draft, mostly `**Term** — reason` list items).
 *
 * A dash after a bold list label becomes a colon; any other em dash, or an en
 * dash with spaces round it, becomes a comma. An unspaced en dash is a range
 * (5–7 days) and stays.
 */
export function scrub(text) {
  // Table rows first: a cell holding only a dash means "nothing", and turned
  // into a stray comma when the rules below reached it.
  const rows = String(text).replace(/^\s*\|.*\|\s*$/gm, (row) =>
    row.replace(/\|\s*[—–]\s*(?=\|)/g, '| - '),
  )
  return (
    rows
      .replace(/^(\s*(?:[-*]|\d+\.)\s+\*\*[^*\n]+\*\*)\s*[—–]\s*/gm, '$1: ')
      // Arabic takes its own comma.
      .replace(
        /(\S?)\s*(?:—|\s–\s)\s*/g,
        (_, before) => before + (/[\u0600-\u06FF]/.test(before) ? '، ' : ', '),
      )
      .replace(
        /(^|[.!?]\s+)(?:according to |as )?(?:the|this) (?:article|post|guide|checklist)(?: (?:says|recommends|suggests|explains|notes|advises|states))?(?: that| to)?[,:]?\s+(\p{L})/giu,
        (_, lead, first) => lead + first.toUpperCase(),
      )
  )
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

/*
  The language guard. The draft of 20 November 2026 came back with its English
  edition entirely in Bengali (body, headings, FAQ, description and search
  phrase) from an English topic and English and German search results. Nothing
  asked for Bengali: the model drifted, and nothing after it looked.

  Counting letters by script is enough to see it. Measured on the 18 posts
  published by then: English editions are at least 97% Latin, Arabic ones at
  least 65% Arabic (names, codes and units stay in Latin there), and neither
  has a letter from any other script. Link targets, URLs and code are left out
  first, since they are Latin in either edition.
*/

const prose = (text) =>
  String(text ?? '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`[^`]*`/g, ' ')

const SCRIPT = { en: /\p{Script=Latin}/gu, ar: /\p{Script=Arabic}/gu }
// A letter in any script but Latin and Arabic. Common and Inherited are left
// out: the tatweel in بـ and لـ is a Common letter, and good Arabic uses it.
const FOREIGN = /[^\p{Script=Latin}\p{Script=Arabic}\p{Script=Common}\p{Script=Inherited}\P{L}]/gu
// Letters Urdu uses and Arabic never does (ٹ ڈ ڑ ں ے ۓ). Arabic script alone
// would let an edition written in Urdu through.
const URDU = /[ٹڈڑںےۓ]/gu
/** The least share of an edition's letters in its own script, with room below what was measured. */
const MIN_SHARE = { en: 0.85, ar: 0.4 }
const LANGUAGE = { en: 'English', ar: 'Arabic' }

const count = (text, pattern) => text.match(pattern)?.length ?? 0
const percent = (share) => `${Math.round(share * 100)}%`

/** Why `text` does not read as `lang` ('en' or 'ar'), or undefined when it does. */
export function wrongScript(lang, text) {
  const words = prose(text)
  const own = count(words, SCRIPT[lang])
  const foreign = count(words, FOREIGN)
  const letters = own + foreign + count(words, SCRIPT[lang === 'en' ? 'ar' : 'en'])
  if (!letters) return undefined
  if (foreign > Math.max(2, letters * 0.01)) {
    const example = words.match(/[\p{L}\p{M}]+/gu)?.find((w) => count(w, FOREIGN))
    return `${percent(foreign / letters)} of its letters are in another script, e.g. "${example}"`
  }
  if (own / letters < MIN_SHARE[lang])
    return `only ${percent(own / letters)} of its letters are ${LANGUAGE[lang]}`
  const urdu = lang === 'ar' ? count(words, URDU) : 0
  if (urdu > Math.max(2, own * 0.005))
    return `it has ${urdu} letters only Urdu uses (ے ں ٹ), so it reads as Urdu`
  return undefined
}

/**
 * What in an edition is not in its language, field by field: the parts a
 * reader sees. `focusKeyword` is left to `polish` in generate.mjs, which can
 * fix it in seconds; one published English keyword carries its Arabic
 * translation in brackets, which a reader never sees.
 */
export function languageProblems(lang, copy) {
  const fields = {
    title: copy.title,
    excerpt: copy.excerpt,
    metaDescription: copy.metaDescription,
    markdown: copy.markdown,
    faqs: usableFaqs(copy)
      .map((f) => `${f.question}\n${f.answer}`)
      .join('\n'),
  }
  return Object.entries(fields).flatMap(([field, text]) => {
    const why = wrongScript(lang, text)
    return why ? [`${field} is not ${LANGUAGE[lang]}: ${why}`] : []
  })
}

/**
 * `copy` in its language, or an error.
 *
 * Written in the wrong one, it is written once more by `write(problems)`, with
 * the problems to put in front of the model; still wrong, the run fails. The
 * route then tells Slack and leaves the topic `ready`, so the next day's run
 * drafts it again, rather than leaving a draft nobody can read.
 */
export async function ensureLanguage(lang, copy, write) {
  const problems = languageProblems(lang, copy)
  if (!problems.length) return copy
  console.warn(`${lang}: not in ${LANGUAGE[lang]}, writing it again: ${problems.join('; ')}`)
  const again = await write(problems)
  const still = languageProblems(lang, again)
  if (still.length)
    throw new Error(`${lang}: not in ${LANGUAGE[lang]} after a second attempt: ${still.join('; ')}`)
  return again
}

/** What a second attempt is told about the first. Empty for a first attempt. */
export const retryNote = (lang, problems = []) =>
  problems.length
    ? `\n\nYOUR PREVIOUS ATTEMPT WAS NOT IN ${LANGUAGE[lang].toUpperCase()}:\n- ${problems.join('\n- ')}\nWrite every field in ${LANGUAGE[lang]}.`
    : ''

/**
 * SearXNG results, or nothing. Never throws: grounding is a bonus, not a dependency.
 *
 * `language` matters: left out, the instance answered "freight quotation
 * Dachser" with German pages, which went into the English draft's prompt.
 */
export async function searxng(query, limit = 6, language) {
  const base = process.env.SEARXNG_URL?.replace(/\/$/, '')
  if (!base) return []
  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      categories: 'general',
      ...(language ? { language } : {}),
    })
    const res = await fetch(`${base}/search?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
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
/**
 * Every path a post may link to: the site's pages, from the same lists the
 * menus and the sitemap use, plus the published posts' own addresses.
 */
export function knownPaths(postSlugs = []) {
  return new Set([
    '/',
    '/ar/',
    '/what-we-do/',
    '/compare/',
    '/pricing/',
    '/ar/pricing/',
    '/blog/',
    '/ar/blog/',
    '/privacy/',
    '/terms/',
    ...solutionNav.flatMap(({ slug }) => [`/${slug}/`, `/ar/${slug}/`]),
    ...comparisons.map(({ slug }) => `/compare/${slug}/`),
    ...postSlugs.flatMap((slug) => [`/blog/${slug}/`, `/ar/blog/${slug}/`]),
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
  // The quote form, which every call to action in a post points at.
  ['/pricing/', new Set(['quote'])],
  ['/ar/pricing/', new Set(['quote'])],
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
 * list the model writes a plausible slug, which is how an early draft came to
 * link a post that did not exist.
 *
 * @param {{ slug: string, en?: { title: string }, ar?: { title: string } }[]} posts
 * @returns {string[]}
 */
export function earlierPosts(posts) {
  return posts.flatMap((post) =>
    /** @type {string[]} */
    [
      post.en && `- \`/blog/${post.slug}/\` — ${post.en.title}`,
      post.ar && `- \`/ar/blog/${post.slug}/\` — ${post.ar.title}`,
    ].filter(Boolean),
  )
}
