/**
 * Draft one blog post, in English and Arabic, from a topic.
 *
 * Called by `src/app/cron/blog/route.ts`, which picks the topic from the CMS,
 * saves what this returns as a draft post and tells Slack. Nothing here
 * touches the database or the file system: it takes a topic and the site's
 * real pages, talks to OpenRouter, and returns the post and its cover.
 *
 *   1. Grounding from SearXNG, when `SEARXNG_URL` is set: framing and gaps,
 *      never the primary material.
 *   2. The English article through OpenRouter with a strict JSON schema, then
 *      the Arabic one written from it, for Arabic readers rather than
 *      translated line by line.
 *   3. The English claims fact-checked against SearXNG and GULF_FACTS
 *      (`factcheck.mjs`) before the Arabic is written from it.
 *   4. Both FAQs checked (`ensureFaqs`), dashes and "the article says"
 *      scrubbed (`scrub`), links to pages that do not exist unlinked, Arabic
 *      links moved to their /ar/ twins.
 *   5. A cover photograph from Pexels, found with a search query the model
 *      writes, cropped to 1280x720 WebP and credited. Best effort.
 *
 * Needs `OPENROUTER_API_KEY`. Optional: `OPENROUTER_MODEL`, `SEARXNG_URL`,
 * `PEXELS_API_KEY` (without it a post ships with no cover).
 */

import { readFileSync } from 'node:fs'
import { factCheck, GULF_FACTS } from './factcheck.mjs'
import { join } from 'node:path'
import {
  complete,
  formatSources,
  searxng,
  arabicTwins,
  checkLinks,
  ensureFaqs,
  MIN_FAQS,
  scrub,
  unlinkMissing,
  usableFaqs,
} from './lib.mjs'

// From the app's root, which the server build traces this file into
// (`outputFileTracingIncludes` in next.config.ts).
const PRODUCT_FACTS = readFileSync(join(process.cwd(), 'scripts/blog/product-facts.md'), 'utf8')

const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro'

// --- the voice -------------------------------------------------------------

/**
 * The system prompt every call starts from. `earlier` is the list of published
 * posts, from the CMS: without the real list the model writes a plausible
 * slug, which is how a draft once linked a post that did not exist.
 */
function voice(earlier) {
  return `You write for the CargoSharks blog. CargoSharks makes freight forwarding and customs brokerage software for Kuwait and the Gulf.
Readers: owners, operations, pricing, customs and finance staff at freight forwarders and customs brokers in Kuwait, the UAE and Saudi Arabia. They know the trade; do not explain what a forwarder is.
Voice: plain, specific and calm. Short sentences. Say what something is, when it happens and who does it. No hype, no "in today's fast-paced world", no "revolutionise", no exclamation marks, no em dashes.
Honesty: never invent statistics, rates, fees, dates, regulations, quotes, customer names or results. If the sources do not support a specific figure, stay qualitative and say the terms vary. When a regulation or date matters, link the official source. Never state a tax, duty or excise rate that is not in GULF FACTS or the sources.
Scope: Gulf trade lanes and Gulf practice. Leave out what does not apply here (ice-class or winter surcharges, US or EU-only rules).
Links: the anchor is a phrase in your own sentence, never "X like [X]".

GULF FACTS (settled, use as given):
${GULF_FACTS}
The product: mention CargoSharks at most twice, near the end, and only in the terms of the PRODUCT FACTS below. Never claim a feature that is not listed there. If a product limit is relevant, state it.

PRODUCT FACTS:
${PRODUCT_FACTS}
## Earlier posts

${earlier.length ? `Link only these; any other /blog/ path does not exist.\n\n${earlier.join('\n')}` : 'None yet. Do not link to /blog/ at all.'}
`
}

const ARCHETYPE = {
  explainer:
    'EXPLAINER. Answer the target query directly in the first two sentences. Then define the terms, show how they differ (a Markdown table when comparing two or more things), and end with what a desk should do about it.',
  guide:
    'HOW-TO GUIDE. Practical and step by step, in the order the work actually happens. Lead each section with the takeaway. Numbered lists for sequences, tables for reference values.',
  checklist:
    'CHECKLIST. A short opening on why each item matters, then the checklist as grouped ## sections with bulleted items, each with a one-line reason. Close with the items people most often forget.',
  regulation:
    'REGULATION UPDATE. State what the rule is and who it applies to, citing the official source inline. Separate what is confirmed from what is not yet announced, and never guess a date. End with what a forwarder can prepare now.',
  comparison:
    'COMPARISON. A 2-3 sentence verdict in the first 100 words: who should choose which. Disclose that CargoSharks sells one of the options. A decision table (dimension | option A | option B). Lean on the expert note, not a feature matrix. Never crown a universal winner.',
  alternatives:
    'ALTERNATIVES. Best fit first, then each alternative with a "best for" line and an honest downside. Disclose that CargoSharks sells one of the options.',
  'use-case':
    'USE CASE. What this kind of operation involves, its real constraints from the expert note, and what doing it well looks like.',
}
// Searches for a thing rather than about one: the reader wants a template to
// copy, not an essay on templates.
const WANTS_ARTIFACT = /\b(template|sample|example|format|form|checklist)s?\b/i

const PROOF_REQUIRED = new Set(['comparison', 'alternatives', 'use-case'])

// --- schemas ---------------------------------------------------------------

const copyProps = {
  title: {
    type: 'string',
    description:
      '45-60 characters. Starts with, or contains near the start, the focusKeyword in its natural wording. No date, no brand name.',
  },
  excerpt: {
    type: 'string',
    description:
      'Plain-text summary for the page header and cards, at most 240 characters. It is shown directly above the article, so the article must not open with the same sentence.',
  },
  metaDescription: {
    type: 'string',
    description: 'SEO meta description, 140-160 characters, contains the focus keyword',
  },
  focusKeyword: {
    type: 'string',
    description: 'The primary search phrase, used naturally in the body',
  },
  markdown: {
    type: 'string',
    description:
      'The article body in Markdown. ## and ### headings only, no H1, no FAQ section, no trailing Sources/References list. Cite sources as inline links with descriptive anchor text. Internal links only to the paths in PRODUCT FACTS.',
  },
  faqs: {
    type: 'array',
    description:
      '2-4 real questions a reader would search, each answered in 1-3 sentences, directly, as the publication. Never refer to "the article", "this post" or "the guide". Not repeated in the markdown; the page renders them.',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['question', 'answer'],
      properties: { question: { type: 'string' }, answer: { type: 'string' } },
    },
  },
}

const EN_SCHEMA = {
  name: 'blog_post_en',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['slug', 'tags', 'photoQuery', ...Object.keys(copyProps)],
    properties: {
      slug: { type: 'string', description: 'kebab-case, English, 3-6 words, no date' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '2-4 short lowercase topic tags',
      },
      photoQuery: {
        type: 'string',
        description:
          'A 2-5 word stock photo search for the cover: one concrete, photographable subject from the post (e.g. "container ship at port", "customs inspection cargo", "warehouse forklift pallets"). No abstract ideas, no brand names.',
      },
      ...copyProps,
    },
  },
}

const FAQ_SCHEMA = {
  name: 'blog_post_faqs',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['faqs'],
    properties: { faqs: copyProps.faqs },
  },
}

const AR_SCHEMA = {
  name: 'blog_post_ar',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(copyProps),
    properties: copyProps,
  },
}

// --- cover -----------------------------------------------------------------

// Asked for when the post's own query finds nothing unused: always on topic for
// a freight blog, and deep enough on Pexels never to run dry.
const FALLBACK_QUERIES = ['container port', 'cargo ship', 'freight logistics warehouse']

/**
 * A real photograph rather than a generated image: generated covers read as
 * renders, which a trade audience notices. Pexels' licence allows downloading
 * and hosting the file ourselves (Unsplash requires hotlinking theirs), and
 * the photographer is credited under the cover anyway.
 *
 * `used` holds the Pexels ids already on the site, so two posts never share a
 * cover. Returns undefined, and the post ships without one, on any failure.
 */
async function cover(query, used) {
  const key = process.env.PEXELS_API_KEY
  if (!key) {
    console.warn('cover: PEXELS_API_KEY is not set; the post ships without one')
    return undefined
  }
  try {
    const { default: sharp } = await import('sharp')
    for (const q of [query, ...FALLBACK_QUERIES].filter(Boolean)) {
      const url = new URL('https://api.pexels.com/v1/search')
      url.search = new URLSearchParams({
        query: q,
        orientation: 'landscape',
        size: 'large',
        per_page: '30',
      }).toString()
      const res = await fetch(url, {
        headers: { Authorization: key },
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`Pexels ${res.status} ${(await res.text()).slice(0, 200)}`)
      const { photos = [] } = await res.json()
      // Wide enough to crop to 1280x720 without scaling up.
      const photo = photos.find(
        (p) => !used.has(`pexels:${p.id}`) && p.width >= 1280 && p.height >= 720,
      )
      if (!photo) continue
      const file = await fetch(photo.src.large2x || photo.src.original, {
        signal: AbortSignal.timeout(30_000),
      })
      if (!file.ok) throw new Error(`Pexels download ${file.status}`)
      const data = await sharp(Buffer.from(await file.arrayBuffer()))
        // Always exactly 1280×720: `postMetadata` declares that size to
        // Open Graph. `attention` keeps the busiest part of the frame.
        .resize({ width: 1280, height: 720, fit: 'cover', position: sharp.strategy.attention })
        .webp({ quality: 82 })
        .toBuffer()
      console.log(`cover: Pexels ${photo.id} for "${q}"`)
      return {
        data,
        sourceId: `pexels:${photo.id}`,
        credit: photo.photographer,
        creditUrl: photo.url,
      }
    }
    console.warn(`cover: nothing unused for "${query}"; the post ships without one`)
  } catch (error) {
    console.warn(`cover: ${error.message}; the post ships without one`)
  }
  return undefined
}

// --- checks ----------------------------------------------------------------

function clean(markdown) {
  return (
    markdown
      // The site's own pages as relative links: an absolute www. URL redirects,
      // and the link checker only knows paths.
      .replace(
        /\]\(https?:\/\/(?:www\.)?cargosharks\.com(\/[^)\s]*)?\)/g,
        (_, path) => `](${path || '/'})`,
      )
      .replace(/^﻿?\s*---\n[\s\S]*?\n---\s*/, '')
      .replace(/^\s*#\s+.*\n/, '')
      .replace(
        /\n#{1,6}\s*(sources|references|further reading|citations|faqs?|frequently asked questions|المصادر|المراجع|الأسئلة الشائعة)\s*\n[\s\S]*$/i,
        '',
      )
      .trim()
      .concat('\n')
  )
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

// --- titles and meta --------------------------------------------------------

/** What Google shows of a title and a description before it cuts them off. */
const TITLE_MAX = 60
const META_MIN = 120
const META_MAX = 160
const ARABIC = /[\u0600-\u06FF]/

const containsInOrder = (text, phrase) => {
  const words = String(phrase).toLowerCase().split(/\s+/).filter(Boolean)
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('(?:\\s+\\S+){0,2}?\\s+')
  return new RegExp(pattern, 'iu').test(String(text))
}

/** Why `c`'s title, description or keyword would cost it in search, if they would. */
function searchProblems(lang, c) {
  const problems = []
  const title = String(c.title ?? '')
  const meta = String(c.metaDescription ?? '')
  const keyword = String(c.focusKeyword ?? '')
  if (!keyword) problems.push('focusKeyword is empty')
  else if (lang === 'ar' && !ARABIC.test(keyword))
    problems.push('focusKeyword must be the Arabic search phrase, in Arabic')
  // Every word of the keyword, in order, with room for the small words that
  // make it a sentence: "chargeable weight in air freight" carries the
  // keyword "chargeable weight air freight". Demanding the exact phrase gave
  // "Calculate Chargeable Weight Air Freight Correctly".
  else if (!containsInOrder(title, keyword))
    problems.push(
      `the title must carry the words of the focusKeyword "${keyword}" in order, near the start, reading as natural ${lang === 'ar' ? 'Arabic' : 'English'}`,
    )
  if (title.length > TITLE_MAX)
    problems.push(`the title is ${title.length} characters; at most ${TITLE_MAX}`)
  if (meta.length < META_MIN || meta.length > META_MAX)
    problems.push(
      `metaDescription is ${meta.length} characters; it must be ${META_MIN}-${META_MAX}`,
    )
  return problems
}

const SEARCH_FIELDS_SCHEMA = {
  name: 'search_fields',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'metaDescription', 'focusKeyword'],
    properties: {
      title: { type: 'string' },
      metaDescription: { type: 'string' },
      focusKeyword: { type: 'string' },
    },
  },
}

/**
 * The model ignores length and keyword rules in a long generation about half
 * the time: titles came back without their search phrase, descriptions at
 * 205 characters, and once an Arabic edition with no description and an
 * English keyword. A short call for those three fields alone fixes it; if it
 * still fails, the draft keeps what it has and the warning says why.
 */
async function polish(lang, c, topic, system) {
  let problems = searchProblems(lang, c)
  for (let attempt = 0; problems.length && attempt < 2; attempt++) {
    const current = {
      title: c.title,
      metaDescription: c.metaDescription,
      focusKeyword: c.focusKeyword,
    }
    const fields = await complete({
      model: MODEL,
      schema: SEARCH_FIELDS_SCHEMA,
      system,
      user: [
        `Target query (English): ${topic.targetQuery}`,
        `Language: ${lang === 'ar' ? 'Arabic' : 'English'}`,
        `Current: ${JSON.stringify(current)}`,
        `Fix these and nothing else:\n- ${problems.join('\n- ')}`,
        `The article begins:\n${String(c.markdown).slice(0, 1500)}`,
      ].join('\n\n'),
    })
    c = { ...c, ...fields }
    problems = searchProblems(lang, c)
  }
  if (problems.length) console.warn(`${lang}: ${problems.join('; ')}`)
  return c
}

// --- the run ---------------------------------------------------------------

/**
 * The topic to draft: the oldest `ready` one, except the archetypes that need
 * first-hand detail (comparison, alternatives, use-case) when nobody has
 * written their `expertNote`. Returns the reason when there is none.
 */
export function pickTopic(ready, known = new Set()) {
  // A topic whose search is already a landing page's (e.g. "WhatsApp for
  // freight forwarders" and /whatsapp-for-freight-forwarders/) would compete
  // with that page in Google rather than add to it.
  const covered = (t) => known.has(`/${slugify(t.targetQuery ?? '')}/`)
  const duplicates = ready.filter(covered)
  ready = ready.filter((t) => !covered(t))
  const topic = ready.find((t) => !PROOF_REQUIRED.has(t.archetype) || t.expertNote?.trim())
  if (topic) return { topic, duplicates }
  const blocked = ready.filter((t) => PROOF_REQUIRED.has(t.archetype)).map((t) => t.key ?? t.title)
  return {
    reason: ready.length
      ? `no ready topic cleared the proof gate (${blocked.join(', ')} need an expert note)`
      : 'no ready topics left',
    duplicates,
  }
}

/**
 * @param {{ topic: any, known: Set<string>, earlier: string[], taken: Set<string>, usedPhotos?: Set<string> }} input
 *   `known`: every real path (`knownPaths`); `earlier`: published posts as
 *   prompt lines; `taken`: slugs already used, so a new post never collides;
 *   `usedPhotos`: stock photo ids already on the site (`pexels:<id>`).
 */
export async function draftPost({ topic, known, earlier, taken, usedPhotos = new Set() }) {
  const VOICE = voice(earlier)
  console.log(`blog: drafting "${topic.title}" (${topic.archetype})`)
  const found = await searxng([topic.targetQuery, ...(topic.keywords ?? [])].join(' '))

  const brief = [
    `Working title: ${topic.title}`,
    `Target query: ${topic.targetQuery}`,
    topic.audience && `Audience: ${topic.audience}`,
    topic.angle && `Angle: ${topic.angle}`,
    topic.keywords?.length && `Secondary keywords: ${topic.keywords.join(', ')}`,
    topic.internalLinks?.length &&
      `Link these pages where they fit naturally: ${topic.internalLinks.join(', ')}`,
    topic.expertNote?.trim() &&
      `\nEXPERT NOTE (first-hand, build the piece around it):\n${topic.expertNote}`,
    `\nWeb context for framing and gaps (do not just summarise it):\n${formatSources(found) || '(none)'}`,
  ]
    .filter(Boolean)
    .join('\n')

  let en = await complete({
    model: MODEL,
    schema: EN_SCHEMA,
    user: brief,
    system: `${VOICE}

ARCHETYPE: ${ARCHETYPE[topic.archetype] ?? ARCHETYPE.guide}

SEO rules:
- The target query "${topic.targetQuery}" appears in the first sentence, in at least one ## heading, and naturally after that. No stuffing.
- ## headings phrased the way people search. Lead every section with the answer.
- 900-1500 words. Tables and lists where they help a reader scan.
- At least two internal links to the site's own pages listed in PRODUCT FACTS, where the reader would want them. Posts with none leave the landing pages without the links that help them rank.${
      WANTS_ARTIFACT.test(topic.targetQuery)
        ? `\n- "${topic.targetQuery}" asks for the thing itself: include it, as a Markdown table a reader can copy, in the first third of the article.`
        : ''
    }`,
  })

  /*
  Every draft carries an FAQ in both languages, and nothing upstream enforces
  that. The schema's "2-4" is a description, not a minimum, and `complete`
  drops to plain JSON when a provider refuses the schema. The first draft came
  back with five Arabic answers and an empty English list, so the English page
  had no FAQ section and no FAQPage schema.

  A short answer is topped up with a call for the FAQ alone, with the finished
  article as its context: seconds, where regenerating the article is minutes.
  Still short after that, the run fails; `blog.ts` refuses the same post at
  build time, so a hand edit cannot ship it either.
*/
  const askForFaqs = (system) => (copy) =>
    complete({
      model: MODEL,
      schema: FAQ_SCHEMA,
      system,
      user: `THE ARTICLE:\n\nTitle: ${copy.title}\n\n${copy.markdown}\n\nWrite its FAQ in the article's language: ${MIN_FAQS}-4 real questions a reader would search, each answered directly in 1-3 sentences using what the article says. Answer as the publication; never write "the article says" or refer to the article at all. Return them in "faqs".`,
    }).then((reply) => reply.faqs)

  en = await ensureFaqs('en', en, askForFaqs(VOICE))
  // Before the Arabic is written, so a corrected claim reaches both editions.
  const checked = await factCheck(en, { model: MODEL, system: VOICE })
  en = checked.copy

  const AR_SYSTEM = `${VOICE}

You are now writing the ARABIC edition of an article already written in English. Write it for Arabic-speaking freight professionals in the Gulf, in clear Modern Standard Arabic, addressing the reader in the plural (أنتم) as the rest of the CargoSharks site does.
Adapt rather than translate: keep every fact, heading and table from the English, but phrase it the way an Arabic trade article would. Use the trade's Arabic terms (وقت السماح for free time, الأرضيات for demurrage, التخليص for clearance), keep company names, codes and units in Latin script, and use Western digits.
Internal links must point to the /ar/ twin of a page where one exists (see PRODUCT FACTS); pages marked English only keep their English path. Keep external links unchanged.
The Arabic search phrase goes in focusKeyword; the title is at most 60 characters.`

  const enFaq = usableFaqs(en)
    .map((f) => `- ${f.question}\n  ${f.answer}`)
    .join('\n')
  let ar = await complete({
    model: MODEL,
    schema: AR_SCHEMA,
    user: `Target query (English): ${topic.targetQuery}\n\nTHE ENGLISH ARTICLE:\n\nTitle: ${en.title}\n\n${en.markdown}\n\nFAQ:\n${enFaq}`,
    system: AR_SYSTEM,
  })
  ar = await ensureFaqs('ar', ar, askForFaqs(AR_SYSTEM))

  let slug = slugify(en.slug || en.title)
  for (let n = 2; taken.has(slug); n++) slug = `${slugify(en.slug || en.title)}-${n}`

  const pick = (c) => ({
    title: scrub(String(c.title).trim()),
    excerpt: scrub(String(c.excerpt).trim()),
    metaDescription: scrub(String(c.metaDescription).trim()),
    focusKeyword: String(c.focusKeyword).trim(),
    faqs: usableFaqs(c).map((f) => ({ question: scrub(f.question), answer: scrub(f.answer) })),
  })
  en = await polish('en', en, topic, VOICE)
  ar = await polish('ar', ar, topic, AR_SYSTEM)
  const enLinks = unlinkMissing(scrub(clean(en.markdown)), known)
  const arLinks = unlinkMissing(arabicTwins(scrub(clean(ar.markdown)), known), known)
  const enBody = enLinks.markdown
  const arBody = arLinks.markdown
  const unlinked = [...new Set([...enLinks.removed, ...arLinks.removed])]
  if (unlinked.length) console.warn(`unlinked, no such page: ${unlinked.join(', ')}`)
  // After the unlinking, so this can only fail on a bug in it.
  checkLinks(enBody, 'en', known)
  checkLinks(arBody, 'ar', known)

  const coverImage = await cover(en.photoQuery, usedPhotos)

  return {
    slug,
    tags: (en.tags ?? []).map(String).slice(0, 4),
    en: { ...pick(en), body: enBody },
    ar: { ...pick(ar), body: arBody },
    cover: coverImage,
    unlinked,
    flagged: checked.flagged,
  }
}
