/**
 * Refill the topic backlog from what people actually search for.
 *
 *   pnpm --filter @qabandi/landing blog:ideate               # add topics to topics.json
 *   pnpm --filter @qabandi/landing blog:ideate -- --signals  # print the inputs, call nothing
 *   pnpm --filter @qabandi/landing blog:ideate -- --dry      # run the model, write nothing
 *   pnpm --filter @qabandi/landing blog:ideate -- --count 7
 *
 * The signals are chosen for this audience. Developer forums say nothing about
 * a Kuwaiti customs desk, so the signal here is Google autocomplete — in English and in Arabic,
 * localised to the Gulf — plus SearXNG for what already ranks when it is set.
 * Every source is best-effort; if all come back empty, nothing is written.
 *
 * Only the non-commercial archetypes are proposed. Comparison, alternatives
 * and use-case posts need a human `expertNote`, which a model must not invent,
 * so those stay hand-seeded — the same gate `generate.mjs` enforces.
 *
 * Needs `OPENROUTER_API_KEY`. Optional: `OPENROUTER_IDEATE_MODEL`, `SEARXNG_URL`.
 */

import {
  complete,
  existingTitles,
  formatSources,
  knownPaths,
  output,
  readBacklog,
  searxng,
  writeBacklog,
} from './lib.mjs'

const args = process.argv.slice(2)
const SIGNALS_ONLY = args.includes('--signals')
const DRY = args.includes('--dry')
const COUNT = Number(args.includes('--count') ? args[args.indexOf('--count') + 1] : 7) || 7
const MODEL = process.env.OPENROUTER_IDEATE_MODEL || 'deepseek/deepseek-v4.1-flash'

/**
 * Seeds for autocomplete. Each run takes a rotating handful so the backlog does
 * not circle the same queries; they are the trade's own vocabulary, grouped by
 * the jobs the product's landing pages cover.
 */
const SEEDS = {
  en: [
    'customs clearance kuwait',
    'shipping to kuwait',
    'freight forwarder kuwait',
    'shuwaikh port',
    'demurrage charges',
    'detention charges container',
    'free time container',
    'bill of lading',
    'incoterms',
    'air freight chargeable weight',
    'freight quotation',
    'freight forwarding software',
    'uae e-invoicing',
    'zatca e-invoicing',
    'customs broker uae',
    'jebel ali port clearance',
    'saudi customs clearance',
    'certificate of origin kuwait',
    'commercial invoice arabic',
    'lcl vs fcl',
  ],
  ar: [
    'تخليص جمركي',
    'شحن إلى الكويت',
    'شركات الشحن في الكويت',
    'ميناء الشويخ',
    'الأرضيات',
    'بوليصة الشحن',
    'شهادة المنشأ',
    'الفاتورة الإلكترونية الإمارات',
    'شحن جوي',
    'شحن بحري',
    'وكيل شحن',
    'الجمارك السعودية',
  ],
}

function pick(list, n) {
  const copy = [...list]
  const out = []
  while (out.length < n && copy.length)
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0])
  return out
}

async function autocomplete(query, lang) {
  const params = new URLSearchParams({ client: 'firefox', hl: lang, gl: 'kw', q: query })
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?${params}`)
    if (!res.ok) return []
    const [, suggestions] = await res.json()
    return Array.isArray(suggestions) ? suggestions.filter((s) => s !== query) : []
  } catch {
    return []
  }
}

async function gatherSignals() {
  const en = pick(SEEDS.en, 8)
  const ar = pick(SEEDS.ar, 5)
  const [enSuggest, arSuggest, ranking] = await Promise.all([
    Promise.all(en.map((q) => autocomplete(q, 'en'))),
    Promise.all(ar.map((q) => autocomplete(q, 'ar'))),
    Promise.all(pick(en, 3).map((q) => searxng(q, 4))),
  ])
  return {
    searches: [...new Set([...enSuggest.flat(), ...arSuggest.flat()])],
    ranking: ranking.flat(),
  }
}

const SCHEMA = {
  name: 'blog_topics',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['topics'],
    properties: {
      topics: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'title',
            'targetQuery',
            'archetype',
            'audience',
            'angle',
            'keywords',
            'internalLinks',
          ],
          properties: {
            id: { type: 'string', description: 'kebab-case, English, short, unique' },
            title: {
              type: 'string',
              description: 'Working title in English, at most 60 characters',
            },
            targetQuery: {
              type: 'string',
              description:
                'The English search phrase this post should rank for, taken from or close to the signals',
            },
            archetype: { type: 'string', enum: ['explainer', 'guide', 'checklist', 'regulation'] },
            audience: { type: 'string' },
            angle: {
              type: 'string',
              description: 'One sentence: what this post says that the ranking pages do not',
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: '2-4 secondary phrases, English or Arabic, from the signals',
            },
            internalLinks: {
              type: 'array',
              items: { type: 'string' },
              description: '1-2 site paths from the allowed list',
            },
          },
        },
      },
    },
  },
}

const backlog = readBacklog()
const signals = await gatherSignals()

if (SIGNALS_ONLY) {
  console.log(JSON.stringify(signals, null, 2))
  process.exit(0)
}
if (!signals.searches.length && !signals.ranking.length) {
  console.log('ideate: every signal source came back empty; nothing to propose')
  output({ ideated: '0' })
  process.exit(0)
}

const known = knownPaths()
const linkable = [...known].filter((p) => !p.startsWith('/ar/') && !p.startsWith('/blog/'))
const taken = existingTitles(backlog)

const { topics = [] } = await complete({
  model: MODEL,
  schema: SCHEMA,
  system: `You plan the blog for CargoSharks, freight forwarding and customs brokerage software for Kuwait and the Gulf.
Readers are owners, operations, pricing, customs and finance staff at forwarders and customs brokers in Kuwait, the UAE and Saudi Arabia.
Propose exactly ${COUNT} topics. Each must:
- target a search phrase that is visibly in, or a close variant of, the SEARCH SIGNALS (Arabic signals count: translate the intent to an English targetQuery; every post is also published in Arabic);
- be useful to a working forwarder, not a shipper buying freight and not a job seeker (skip "jobs", "salary", "near me", car imports and parcel tracking);
- not repeat or closely overlap an EXISTING topic;
- use only these internal links: ${linkable.join(', ')}.
Prefer evergreen questions over news. Regulation topics only where an official source exists.`,
  user: `SEARCH SIGNALS (Google autocomplete, Gulf):\n${signals.searches.join('\n')}\n\nWHAT ALREADY RANKS:\n${formatSources(signals.ranking) || '(none)'}\n\nEXISTING TOPICS AND POSTS:\n${taken.join('\n')}`,
})

const ids = new Set(backlog.topics.map((t) => t.id))
const normal = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const seen = new Set(taken.map(normal))
const fresh = topics
  .filter((t) => t?.id && t.title && t.targetQuery)
  // The id becomes a branch name (`blog/draft-<id>`), so it is held to kebab-case.
  .map((t) => ({
    ...t,
    id: String(t.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60),
  }))
  // Each accepted topic is added to `ids` and `seen` as it passes, so two
  // proposals in one response that normalise to the same id or query are not
  // both kept. The id is a branch name and the key for `--topic` and `--skip`;
  // a duplicate would be hidden behind the first one's draft.
  .filter((t) => {
    if (!t.id || ids.has(t.id)) return false
    if (seen.has(normal(t.title)) || seen.has(normal(t.targetQuery))) return false
    ids.add(t.id)
    seen.add(normal(t.title))
    seen.add(normal(t.targetQuery))
    return true
  })
  .map((t) => ({
    ...t,
    status: 'ready',
    source: 'ideate',
    internalLinks: (t.internalLinks ?? []).filter((p) => known.has(p)),
  }))
  .slice(0, COUNT)

if (DRY) {
  console.log(JSON.stringify(fresh, null, 2))
  process.exit(0)
}

backlog.topics.push(...fresh)
writeBacklog(backlog)
console.log(`ideate: added ${fresh.length} topics to topics.json`)
output({ ideated: String(fresh.length), titles: fresh.map((t) => t.title).join(' · ') })
