/**
 * Check the English draft's specific claims against the web before the Arabic
 * is written from it.
 *
 * The first drafts stated that Kuwait charges 5% VAT (it has none), that
 * zakat is a Saudi import levy (it is not) and quoted a flat excise rate the
 * UAE and Saudi Arabia replaced in January 2026. The voice already forbids
 * inventing figures; a model does it anyway when nothing contradicts it. So:
 *
 *   1. The model lists every checkable claim (a rate, fee, deadline, law or
 *      statistic) verbatim, each with a search query.
 *   2. Each query goes to SearXNG.
 *   3. A second call judges each claim against those results and GULF_FACTS,
 *      and writes a replacement for anything contradicted or unverified that
 *      keeps the point and drops or qualifies the number.
 *   4. Replacements are applied only where the quoted text is found verbatim,
 *      so a paraphrased quote changes nothing rather than the wrong sentence.
 *
 * Without `SEARXNG_URL` it still runs, judged on GULF_FACTS alone, which is
 * what catches the errors above. Never throws: a failed check leaves the
 * draft as it was, which a person reviews before publishing anyway.
 */

import { complete, searxng } from './lib.mjs'

/**
 * Settled facts the model gets wrong. Short on purpose: anything here is
 * stated as true in every post, so each line must stay true. Last checked
 * October 2026.
 */
export const GULF_FACTS = `- VAT: UAE 5% (since 2018), Saudi Arabia 15% (since July 2020), Bahrain 10% (since 2022), Oman 5% (since April 2021). Kuwait and Qatar have NO VAT in force; Kuwait's 2026-2030 fiscal plan does not include it.
- Kuwait has no excise tax in force.
- UAE and Saudi Arabia moved excise on sweetened drinks to a tiered, sugar-content model in January 2026; do not quote a flat percentage for sweetened or carbonated drinks.
- Zakat in Saudi Arabia is levied on the zakat base of Saudi and GCC-owned businesses. It is not an import duty or a fee charged on shipments.
- GCC states apply the GCC Common Customs Law; the general customs duty rate is 5% of CIF value, with exemptions and higher rates by tariff line. Duty for a specific product depends on its HS code.`

const CLAIMS_SCHEMA = {
  name: 'claims',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['claims'],
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['quote', 'query'],
          properties: {
            quote: {
              type: 'string',
              description: 'The sentence or list item, copied exactly as it appears in the article',
            },
            query: { type: 'string', description: 'A web search that would confirm or refute it' },
          },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  name: 'verdicts',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdicts'],
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['quote', 'verdict', 'reason', 'replacement'],
          properties: {
            quote: { type: 'string' },
            verdict: { type: 'string', enum: ['supported', 'contradicted', 'unverified'] },
            reason: { type: 'string' },
            replacement: {
              type: 'string',
              description:
                'For contradicted or unverified: the same sentence or list item, corrected or with the unsupported specific removed or qualified, in the same Markdown form. Empty for supported.',
            },
          },
        },
      },
    },
  },
}

/** A replacement written about the check rather than for the reader. */
const META = /\b(search results?|sources?|evidence|not supported|unverified|fact[- ]?check)/i

/** At most this many claims are searched: each is a request. */
const MAX_CLAIMS = 10

/**
 * @param {{ markdown: string, faqs?: { question: string, answer: string }[] }} copy
 * @param {{ model: string, system: string }} opts
 * @returns {Promise<{ copy: typeof copy, fixed: Claim[], flagged: Claim[] }>}
 *   `fixed` were rewritten; `flagged` could not be, and go to Slack for review.
 * @typedef {{ quote: string, verdict: string, reason: string }} Claim
 */
export async function factCheck(copy, { model, system }) {
  try {
    const text = [copy.markdown, ...(copy.faqs ?? []).map((f) => f.answer)].join('\n\n')
    const { claims = [] } = await complete({
      model,
      schema: CLAIMS_SCHEMA,
      system,
      user: `THE ARTICLE:\n\n${text}\n\nList every checkable factual claim in it: a tax or duty rate, a fee or amount, a deadline or date, what a law or authority requires, a statistic, and any statement that something has NOT been announced, published or decided (those go stale fastest). Not advice, not general practice. Copy each exactly as written. At most ${MAX_CLAIMS}, the most specific first. Return [] if there are none.`,
    })
    if (!claims.length) return { copy, fixed: [] }

    const evidence = []
    for (const [i, claim] of claims.slice(0, MAX_CLAIMS).entries()) {
      const results = await searxng(claim.query, 5)
      evidence.push(
        `CLAIM ${i + 1}: ${claim.quote}\n` +
          (results.length
            ? results
                .map((r) => `  - ${r.title} (${r.url}): ${(r.content ?? '').slice(0, 300)}`)
                .join('\n')
            : '  (no search results)'),
      )
    }

    const { verdicts = [] } = await complete({
      model,
      schema: VERDICT_SCHEMA,
      system: `You fact-check a freight trade publication. Judge each claim only on the search results given and these settled facts:\n${GULF_FACTS}\n\n"supported" needs a result or fact that states it. A result from a vendor blog is weaker than one from an authority, a Big Four firm or a law firm; when sources disagree on a date, the claim is unverified. A claim that something is not yet announced is contradicted by any credible result that announces it.\nA replacement is article prose for the reader: correct the claim from the results, or drop or qualify the unsupported specific. Never mention search results, sources, evidence or checking in it. Keep the article's voice, no em dashes.`,
      user: evidence.join('\n\n'),
    })

    let { markdown } = copy
    let faqs = copy.faqs
    const fixed = []
    const flagged = []
    for (const v of verdicts) {
      if (v.verdict === 'supported' || !v.quote) continue
      // A replacement that talks about the checking ("no search result
      // supports…") once went into a post verbatim. Those, and empty ones,
      // are left for the person reviewing the draft instead.
      if (!v.replacement?.trim() || META.test(v.replacement)) {
        flagged.push({ quote: v.quote, verdict: v.verdict, reason: v.reason })
        continue
      }
      if (markdown.includes(v.quote)) markdown = markdown.replace(v.quote, v.replacement.trim())
      else if (faqs?.some((f) => f.answer.includes(v.quote)))
        faqs = faqs.map((f) => ({ ...f, answer: f.answer.replace(v.quote, v.replacement.trim()) }))
      else continue
      fixed.push({ quote: v.quote, verdict: v.verdict, reason: v.reason })
    }
    for (const f of fixed)
      console.warn(`factcheck: ${f.verdict}, rewritten: ${f.quote.slice(0, 100)} (${f.reason})`)
    for (const f of flagged)
      console.warn(`factcheck: ${f.verdict}, for review: ${f.quote.slice(0, 100)} (${f.reason})`)
    return { copy: { ...copy, markdown, faqs }, fixed, flagged }
  } catch (error) {
    console.warn(`factcheck: ${error.message}; the draft is unchecked`)
    return { copy, fixed: [], flagged: [] }
  }
}
