/**
 * Draft one blog post, in English and Arabic, from the backlog.
 *
 *   pnpm --filter @qabandi/landing blog:generate                 # next ready topic
 *   pnpm --filter @qabandi/landing blog:generate -- --topic <id>
 *   pnpm --filter @qabandi/landing blog:generate -- --skip a,b   # topics with open or rejected PRs
 *   pnpm --filter @qabandi/landing blog:generate -- --dry        # print, write nothing
 *
 * There is no CMS to hold a draft, so a draft is files: this writes them under
 * `content/blog/<slug>/` and `.github/workflows/blog.yml` opens a pull request.
 * Merging it is publishing — Coolify rebuilds on push, the site stays a static
 * export, and `blog-indexnow.yml` tells the search engines.
 *
 *   1. The first `ready` topic in `topics.json` that is not in an open or a
 *      rejected draft PR. Commercial archetypes need an `expertNote` (first-hand detail the
 *      model cannot invent) or are skipped.
 *   2. Grounding from SearXNG, when `SEARXNG_URL` is set: framing and gaps,
 *      never the primary material.
 *   3. The English article through OpenRouter with a strict JSON schema, then
 *      the Arabic one written from it — written for Arabic readers, not
 *      translated line by line, which is the rule the rest of the site keeps.
 *   4. A cover through OpenRouter's image API, re-encoded to WebP by sharp.
 *      Best-effort: a failure leaves the post without a cover.
 *   5. Every internal link is checked against the site's real paths; one that
 *      does not exist fails the run rather than shipping a 404.
 *
 * Needs `OPENROUTER_API_KEY`. Optional: `OPENROUTER_MODEL`,
 * `OPENROUTER_IMAGE_MODEL`, `SEARXNG_URL`, `BLOG_COVER_IMAGE=off`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP,
  CONTENT,
  HERE,
  complete,
  formatSources,
  headers,
  knownPaths,
  output,
  readBacklog,
  searxng,
  skipped,
  arabicTwins,
  checkLinks,
  earlierPosts,
  ensureFaqs,
  MIN_FAQS,
  unlinkMissing,
  usableFaqs,
  writeBacklog,
} from './lib.mjs'

const POSTS = earlierPosts()
const FACTS = `${readFileSync(join(HERE, 'product-facts.md'), 'utf8')}
## Earlier posts

${POSTS.length ? `Link only these; any other /blog/ path does not exist.\n\n${POSTS.join('\n')}` : 'None yet. Do not link to /blog/ at all.'}
`

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const ONLY = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : null
const SKIP = skipped(args)

const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-pro'
const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-3.1-flash-image'

// --- the voice -------------------------------------------------------------

const VOICE = `You write for the CargoSharks blog. CargoSharks makes freight forwarding and customs brokerage software for Kuwait and the Gulf.
Readers: owners, operations, pricing, customs and finance staff at freight forwarders and customs brokers in Kuwait, the UAE and Saudi Arabia. They know the trade; do not explain what a forwarder is.
Voice: plain, specific and calm. Short sentences. Say what something is, when it happens and who does it. No hype, no "in today's fast-paced world", no "revolutionise", no exclamation marks, no em dashes.
Honesty: never invent statistics, rates, fees, dates, regulations, quotes, customer names or results. If the sources do not support a specific figure, stay qualitative and say the terms vary. When a regulation or date matters, link the official source.
The product: mention CargoSharks at most twice, near the end, and only in the terms of the PRODUCT FACTS below. Never claim a feature that is not listed there. If a product limit is relevant, state it.

PRODUCT FACTS:
${FACTS}`

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
const PROOF_REQUIRED = new Set(['comparison', 'alternatives', 'use-case'])

// --- schemas ---------------------------------------------------------------

const copyProps = {
  title: {
    type: 'string',
    description: 'At most 60 characters, no colon-and-subtitle, no date, no brand name',
  },
  excerpt: {
    type: 'string',
    description: 'Plain-text summary for the page header and cards, at most 240 characters',
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
      '2-4 real questions a reader would search, each answered in 1-3 sentences. Not repeated in the markdown; the page renders them.',
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
    required: ['slug', 'tags', 'imagePrompt', ...Object.keys(copyProps)],
    properties: {
      slug: { type: 'string', description: 'kebab-case, English, 3-6 words, no date' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '2-4 short lowercase topic tags',
      },
      imagePrompt: {
        type: 'string',
        description:
          'ONE concrete visual subject for the cover, a sentence or two. No text, words or numbers in the image, no style notes.',
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

const COVER_STYLE =
  'Calm editorial photograph-like 3D render of a Gulf port and logistics scene, soft early-morning light, ' +
  'restrained palette of deep navy #0B2545, corporate blue #1F6FEB, light blue #79B0FF and warm off-white, ' +
  'a single clear subject with generous negative space, 16:9 composition, premium and quiet. ' +
  'Absolutely no text, letters, numbers, logos, flags or UI.'

async function cover(slug, concept) {
  if (process.env.BLOG_COVER_IMAGE === 'off') return undefined
  try {
    const { default: sharp } = await import('sharp')
    let lastError = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch('https://openrouter.ai/api/v1/images', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt: `${concept}\n\n${COVER_STYLE}`,
          aspect_ratio: '16:9',
        }),
      })
      const b64 = res.ok ? (await res.json()).data?.[0]?.b64_json : null
      if (b64) {
        const webp = await sharp(Buffer.from(b64, 'base64'))
          // Always exactly 1280×720: `postMetadata` declares that size to
          // Open Graph, so a smaller source is scaled up rather than kept.
          .resize({ width: 1280, height: 720, fit: 'cover' })
          .webp({ quality: 82 })
          .toBuffer()
        if (!DRY) {
          mkdirSync(join(APP, 'public', 'blog'), { recursive: true })
          writeFileSync(join(APP, 'public', 'blog', `${slug}.webp`), webp)
        }
        return `/blog/${slug}.webp`
      }
      lastError = res.ok
        ? 'no image in response'
        : `${res.status} ${(await res.text()).slice(0, 200)}`
      // Gemini image requests are sometimes routed to an upstream that rejects
      // the region; those are not billed, so retrying is the fix.
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
    }
    console.warn(`cover: gave up (${lastError}); the post ships without one`)
  } catch (error) {
    console.warn(`cover: ${error.message}; the post ships without one`)
  }
  return undefined
}

// --- checks ----------------------------------------------------------------

function clean(markdown) {
  return markdown
    .replace(/^﻿?\s*---\n[\s\S]*?\n---\s*/, '')
    .replace(/^\s*#\s+.*\n/, '')
    .replace(
      /\n#{1,6}\s*(sources|references|further reading|citations|faqs?|frequently asked questions|المصادر|المراجع|الأسئلة الشائعة)\s*\n[\s\S]*$/i,
      '',
    )
    .trim()
    .concat('\n')
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

// --- the run ---------------------------------------------------------------

const backlog = readBacklog()
const ready = backlog.topics.filter(
  (t) => t.status === 'ready' && !SKIP.has(t.id) && (!ONLY || t.id === ONLY),
)
const topic = ready.find((t) => !PROOF_REQUIRED.has(t.archetype) || t.expertNote?.trim())

if (!topic) {
  const blocked = ready.filter((t) => PROOF_REQUIRED.has(t.archetype)).map((t) => t.id)
  const reason = ready.length
    ? `no ready topic cleared the proof gate (${blocked.join(', ')} need an expertNote)`
    : 'no ready topics left in topics.json'
  console.log(`blog: ${reason}; nothing to draft`)
  output({ drafted: 'false', reason })
  process.exit(0)
}

console.log(`blog: drafting "${topic.title}" (${topic.archetype})`)
const known = knownPaths()
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
- 900-1500 words. Tables and lists where they help a reader scan.`,
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
    user: `THE ARTICLE:\n\nTitle: ${copy.title}\n\n${copy.markdown}\n\nWrite its FAQ in the article's language: ${MIN_FAQS}-4 real questions a reader would search, each answered in 1-3 sentences from what the article says. Return them in "faqs".`,
  }).then((reply) => reply.faqs)

en = await ensureFaqs('en', en, askForFaqs(VOICE))

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
for (let n = 2; existsSync(join(CONTENT, slug)); n++) slug = `${slugify(en.slug || en.title)}-${n}`

const pick = (c) => ({
  title: String(c.title).trim(),
  excerpt: String(c.excerpt).trim(),
  metaDescription: String(c.metaDescription).trim(),
  focusKeyword: String(c.focusKeyword).trim(),
  faqs: usableFaqs(c),
})
const enLinks = unlinkMissing(clean(en.markdown), known)
const arLinks = unlinkMissing(arabicTwins(clean(ar.markdown), known), known)
const enBody = enLinks.markdown
const arBody = arLinks.markdown
const unlinked = [...new Set([...enLinks.removed, ...arLinks.removed])]
if (unlinked.length) console.warn(`unlinked, no such page: ${unlinked.join(', ')}`)
// After the unlinking, so this can only fail on a bug in it.
checkLinks(enBody, 'en', known)
checkLinks(arBody, 'ar', known)

const coverPath = await cover(slug, en.imagePrompt || `A visual metaphor for "${en.title}"`)

const meta = {
  slug,
  publishedAt: new Date().toISOString().slice(0, 10),
  author: 'CargoSharks',
  tags: (en.tags ?? []).map(String).slice(0, 4),
  ...(coverPath ? { cover: coverPath } : {}),
  source: 'ai',
  en: pick(en),
  ar: pick(ar),
}

if (DRY) {
  console.log(JSON.stringify(meta, null, 2), `\n--- en.md ---\n${enBody}\n--- ar.md ---\n${arBody}`)
  process.exit(0)
}

mkdirSync(join(CONTENT, slug), { recursive: true })
writeFileSync(join(CONTENT, slug, 'post.json'), `${JSON.stringify(meta, null, 2)}\n`)
writeFileSync(join(CONTENT, slug, 'en.md'), enBody)
writeFileSync(join(CONTENT, slug, 'ar.md'), arBody)

Object.assign(topic, { status: 'written', post: slug })
writeBacklog(backlog)

console.log(`blog: wrote content/blog/${slug}/ (${coverPath ? 'with' : 'without'} cover)`)
output({
  drafted: 'true',
  topic: topic.id,
  slug,
  title: meta.en.title,
  cover: coverPath ? 'yes' : 'no',
  unlinked: unlinked.join(' '),
})
