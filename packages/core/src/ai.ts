/**
 * The rules a model is held to — `docs/Qabandi_AI_Surface.md`.
 *
 * Everything in this file is pure: no model call, no key, no network. That is
 * not a stylistic preference. The decisions here are the ones that decide
 * whether an extraction is safe to apply, and they are also the ones that are
 * impossible to exercise if reaching them requires an API call — so they live
 * where `pnpm test:core` can run every one of them in a millisecond against
 * nothing at all.
 *
 * The division of labour, stated once:
 *
 *   this file          what a proposal means, and whether it may be applied
 *   adapters/model.ts  how to ask a provider, and what it cost
 *   core/import.ts     whether a proposed *value* is valid for its column
 *
 * The third is the one worth noticing. A model is another producer of
 * untrusted rows, and `import.ts` has been validating untrusted rows since
 * FR-MD-11 — typed cell parsers, Arabic-Indic digits, reference lookups, an
 * all-or-nothing report. Nothing in this file re-implements any of that. A
 * proposal carries **text**, exactly as a spreadsheet cell does, and it
 * becomes a typed value only by passing through the same parsers a CSV does.
 */

import { D, dec, money } from './money'
import type { CurrencyCode, Money, Numeric } from './money'
import { DomainError } from './errors'
import type { Decimal } from 'decimal.js'

export class AiError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message)
  }
}

/** Price per million tokens, as the provider publishes it. */
export interface ModelPricing {
  readonly inputPerMillionUsd: Numeric
  readonly outputPerMillionUsd: Numeric
}

/* -------------------------------------------------------------------------
 * The model
 * ---------------------------------------------------------------------- */

/**
 * What this product reads documents with, unless a deployment says otherwise.
 *
 * There is one model, not one per surface. An earlier revision had three —
 * a default, a vision model and an assistant model — and the split does not
 * survive the constraint that actually applies here: **every surface in this
 * product reads a scan.** A supplier invoice is a photographed PDF, a customs
 * declaration is an Arabic scan, and an emailed enquiry arrives with both
 * attached. A model that cannot see is not useful for any of them, so
 * "which model for the ones with pictures" is a question with one answer and
 * three knobs to get wrong.
 *
 * Verified against OpenRouter's own catalogue rather than remembered: this
 * slug reports `['text', 'image', 'video']`, which the three-way split existed
 * to guarantee and now simply is the requirement. Anything a deployment
 * substitutes must accept images too — a text-only model answers the invoice
 * prompt confidently and about nothing, since it never saw the invoice.
 *
 * Chosen for what this workload actually is: a forwarder reads hundreds of
 * scans a month and almost never needs an argument constructed. At $0.30 per
 * million input tokens it is roughly a seventeenth of a frontier model's input
 * rate, and a supplier invoice is nearly all input — which is what decides
 * whether reading every bill is worth doing at all. The million-token context
 * is the other half: a customs file arrives as forty pages, not one.
 */
export const DEFAULT_MODEL = 'minimax/minimax-m3'

/**
 * The default model's published rate, per million tokens, in USD.
 *
 * A fallback for `costOf`, never the primary. OpenRouter reports what each
 * call actually cost and that figure is believed; this exists so a provider
 * that stops reporting degrades to an estimate rather than to zero — and zero
 * is what an absent cost looks like when a month is summed.
 *
 * It will go stale. That is acceptable for an estimate and would not be for a
 * bill, which is exactly why it is only ever reached when the real number is
 * missing.
 */
export const DEFAULT_MODEL_PRICING: ModelPricing = {
  inputPerMillionUsd: '0.3',
  outputPerMillionUsd: '1.2',
}

/* -------------------------------------------------------------------------
 * Surfaces
 * ---------------------------------------------------------------------- */

/**
 * Every place in the product that may ask a model something.
 *
 * An enum rather than a row, by the line `enums.ts` draws: a surface is only
 * extensible by writing the code that calls from it, so a database enum makes
 * an unknown surface unrepresentable rather than merely unexpected. What *is*
 * configuration is which model each surface uses and what it is allowed to
 * decide — those are environment and rows respectively.
 *
 * The list is also the cost dimension. "What is the AI costing us" is a
 * question the client asks in month two, and the only answer worth giving is
 * per surface: an assistant that answers forty questions a day and an
 * extraction that reads four hundred invoices a month fail economically in
 * completely different ways.
 */
export type AiSurface =
  /** An inbound email's cargo facts — FR-EQ-02's unfilled columns. */
  | 'enquiry_extract'
  /** Which `document_types` row an uploaded file is. */
  | 'document_classify'
  /** Fields off a bill of lading, air waybill or delivery order. */
  | 'document_extract'
  /** Supplier invoice lines, which `core/matching.ts` then runs on. */
  | 'invoice_extract'
  /** An agent's tariff columns mapped onto ours — FR-RT-09. */
  | 'rate_mapping'
  /** A tariff that never was a spreadsheet — PDF or prose. */
  | 'rate_extract'
  /** The operator assistant, reading and proposing. */
  | 'assistant'
  /** A grounded reply drafted for a human to send — never sent. */
  | 'draft_reply'
  /** A quotation's customer-facing covering note, drafted for a coordinator to edit — never sent. */
  | 'quote_cover_note'

export const AI_SURFACES: readonly AiSurface[] = [
  'enquiry_extract',
  'document_classify',
  'document_extract',
  'invoice_extract',
  'rate_mapping',
  'rate_extract',
  'assistant',
  'draft_reply',
  'quote_cover_note',
]

/**
 * Whether a surface may propose a write at all.
 *
 * Read surfaces answer questions and produce text a person reads. Write
 * surfaces produce proposals against real rows. The distinction is enforced
 * rather than documented because it is the one an eager caller erodes first:
 * the assistant is a read surface, and the day it starts writing directly is
 * the day the review queue stops being the only way in.
 */
export function isWriteSurface(surface: AiSurface): boolean {
  return surface !== 'assistant' && surface !== 'draft_reply' && surface !== 'quote_cover_note'
}

/* -------------------------------------------------------------------------
 * Confidence
 * ---------------------------------------------------------------------- */

/**
 * A model's own estimate, between zero and one.
 *
 * Held at arm's length deliberately. A self-reported confidence is not a
 * probability and should never be treated as one — it is an ordering hint,
 * useful for deciding what a coordinator sees first and useless for deciding
 * what happens without one. Every threshold that consumes it is a row an
 * administrator can move (§9), because the right value is a property of the
 * deployment's paperwork and not of this code.
 */
export type Confidence = number

export function confidence(raw: unknown): Confidence {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) {
    throw new AiError('ai.confidence_invalid', `Confidence is not a number: ${String(raw)}`)
  }
  /*
    Clamped rather than refused.

    A model that answers 1.2 has said "very sure" in a malformed way, and
    throwing away the whole extraction over the formatting of one number would
    lose the eleven fields it got right. Out-of-range is recorded by the value
    landing exactly on a bound, which is visible in the ledger if anyone looks.
  */
  return Math.min(1, Math.max(0, value))
}

/* -------------------------------------------------------------------------
 * Proposals
 * ---------------------------------------------------------------------- */

/**
 * One field a model thinks should hold one value.
 *
 * `value` is text, always — see the header. `evidence` is the span of source
 * the model says it read the value from, and it is not decoration: a
 * coordinator confirming *"2 × 20'GP, from line 4"* is doing a different and
 * much faster job than one confirming *"2 × 20'GP"* against a screen of email.
 * A proposal without evidence is a proposal that has to be re-derived by hand
 * to be checked, which costs more than typing it.
 */
export interface FieldProposal {
  readonly field: string
  readonly value: string
  readonly confidence: Confidence
  /** The quoted source span. Absent where the model would not name one. */
  readonly evidence?: string
}

/**
 * What may be done with a proposal, given what the row already holds.
 *
 * Three outcomes, and the middle one is the point of the type:
 *
 *   `apply`    the column is empty and the proposal clears the threshold
 *   `review`   worth showing a person, not worth doing unattended
 *   `discard`  the column already holds something, or the value is nonsense
 */
export type ProposalVerdict = 'apply' | 'review' | 'discard'

export interface ProposalContext {
  /**
   * What the column holds now. `null` and `''` both mean empty.
   *
   * Taken as a parameter rather than read, because `core` reads nothing — and
   * because the caller is the only thing that knows whether it is looking at
   * the row as it was when the model was asked or as it is now.
   */
  readonly current: string | null | undefined
  /**
   * Whether a person put the current value there.
   *
   * The distinguishing question, and it deserves a parameter rather than an
   * inference from emptiness. A column filled by an earlier extraction may be
   * replaced by a better one; a column a coordinator typed may not, ever, by
   * anything. `documents.generated_from` draws the same line for files and
   * for the same reason: knowing *who* produced a value decides what may be
   * done to it.
   */
  readonly humanAuthored: boolean
  /** Below this, a proposal is never applied unattended. From a row (§9). */
  readonly applyThreshold: Confidence
  /** Below this, a proposal is not worth a coordinator's attention either. */
  readonly reviewThreshold: Confidence
}

/**
 * The never-overwrite rule, in one function.
 *
 * This is the single most consequential decision in the AI surface and it is
 * eight lines, which is the right size for it. Everything about applying
 * extraction safely reduces to: a model fills blanks, and a person's answer
 * wins. Spreading that across four call sites is how the twelfth one forgets.
 */
export function decideProposal(proposal: FieldProposal, context: ProposalContext): ProposalVerdict {
  const occupied =
    context.current !== null && context.current !== undefined && context.current !== ''

  /*
    A human value is not merely preferred — it ends the conversation.

    Not `review`, which would put a coordinator's own typing back in front of
    them to be re-confirmed against a machine's guess. That is worse than
    useless: it trains people to click accept on a queue that is mostly noise,
    which is exactly how the one proposal that mattered gets waved through.
  */
  if (occupied && context.humanAuthored) return 'discard'

  if (proposal.value.trim() === '') return 'discard'
  if (proposal.confidence < context.reviewThreshold) return 'discard'

  /*
    An occupied column that no human authored still goes to review rather than
    being overwritten. Two extractions disagreeing is a fact about the source
    document, and the second one silently winning would hide it.
  */
  if (occupied) return 'review'

  return proposal.confidence >= context.applyThreshold ? 'apply' : 'review'
}

/* -------------------------------------------------------------------------
 * Reading what a model actually said
 * ---------------------------------------------------------------------- */

/**
 * JSON out of a response that was asked for JSON.
 *
 * Structured-output modes make this unnecessary right up until the request
 * that falls back, the provider that routes to a model without the feature,
 * or the refusal that arrives as prose. All three produce a response that is
 * *nearly* JSON, and a caller that trusts `JSON.parse` throws on the third
 * one in a hundred — during an overnight batch, with the reason lost.
 *
 * So: try the whole string, then the first fenced block, then the widest
 * brace-balanced span. Anything else is an error with the text attached,
 * because a parse failure whose message does not include what failed to parse
 * cannot be diagnosed from a log.
 */
export function parseModelJson<T = unknown>(text: string): T {
  const trimmed = text.trim()
  if (trimmed === '') throw new AiError('ai.empty_response', 'The model returned nothing.')

  const attempt = (candidate: string): T | undefined => {
    try {
      return JSON.parse(candidate) as T
    } catch {
      return undefined
    }
  }

  const direct = attempt(trimmed)
  if (direct !== undefined) return direct

  // ```json … ``` or a bare ``` … ``` — the most common wrapper by far.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced?.[1]) {
    const parsed = attempt(fenced[1].trim())
    if (parsed !== undefined) return parsed
  }

  /*
    The widest balanced span, quote-aware.

    A naive `indexOf('{')` to `lastIndexOf('}')` is wrong the moment prose
    after the JSON contains a brace, and a naive brace count is wrong the
    moment a *string value* does — `"note": "size 20{ft}"` is legal JSON and
    unbalanced text. Both cases are ordinary in freight paperwork, so the scan
    tracks strings and escapes rather than assuming they are absent.
  */
  const span = balancedSpan(trimmed)
  if (span) {
    const parsed = attempt(span)
    if (parsed !== undefined) return parsed
  }

  throw new AiError(
    'ai.unparseable_response',
    `The model did not return JSON. Response began: ${trimmed.slice(0, 200)}`,
  )
}

function balancedSpan(text: string): string | null {
  const open = text.search(/[{[]/)
  if (open < 0) return null

  const closerFor = { '{': '}', '[': ']' } as const
  const stack: string[] = []
  let quoted = false
  let escaped = false

  for (let i = open; i < text.length; i++) {
    const char = text[i]!

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) continue

    if (char === '{' || char === '[') {
      stack.push(closerFor[char])
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return null
      if (stack.length === 0) return text.slice(open, i + 1)
    }
  }

  return null
}

/* -------------------------------------------------------------------------
 * What it cost
 * ---------------------------------------------------------------------- */

/**
 * Token counts as a provider reports them.
 *
 * `costUsd` is optional and stays a string the whole way, because it is money
 * and money is never a JS number in this system (§11). A provider that
 * reports its own cost is believed; one that does not is priced from the
 * table below.
 */
export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd?: string
}

/**
 * What one call cost, in USD, as a `Money`.
 *
 * Six decimal places, which is `numeric(19,6)` and is also the only scale that
 * survives the arithmetic: a single cheap call is a fraction of a cent, and
 * rounding each one to two decimals before summing a month of them reports
 * zero. The ledger stores the unrounded figure per call and the report sums
 * before it rounds — the same rule as everywhere else money is added up.
 *
 * USD rather than KWD deliberately. Providers bill in dollars, and converting
 * per call would stamp an FX rate onto a cost that has not been invoiced yet;
 * the conversion belongs in the report, at the rate of the day it is read.
 */
export function costOf(usage: TokenUsage, pricing: ModelPricing): Money {
  const usd: CurrencyCode = 'USD'

  if (usage.costUsd !== undefined && usage.costUsd !== '') {
    return money(usage.costUsd, usd)
  }

  const perMillion = (tokens: number, price: Numeric): Decimal =>
    dec(price).times(new D(tokens)).dividedBy(new D(1_000_000))

  const total = perMillion(usage.inputTokens, pricing.inputPerMillionUsd).plus(
    perMillion(usage.outputTokens, pricing.outputPerMillionUsd),
  )

  /*
    Not rounded to the currency's minor units, and that is the whole point.

    `round` would take USD to two decimals, which is the exact failure the
    comment above describes: a cheap call becomes 0.00 and a month of them
    reports that the model is free. The column is `numeric(19,6)`, the figure
    is stored as struck, and rounding happens once — in the report, after the
    sum.
  */
  return money(total, usd)
}

/* -------------------------------------------------------------------------
 * Prompt injection
 * ---------------------------------------------------------------------- */

/**
 * Fields a model is *ever* allowed to have an opinion about, per surface.
 *
 * `inbound-mail.ts` says it in its own header: nothing there trusts the
 * sender. Display names, subjects and attachment filenames are all
 * attacker-controlled, and today none of them is interpreted — they are
 * stored as data. A model reading that body is the first component in this
 * system that *interprets* hostile text, so the boundary is drawn here, as
 * data, and checked on every proposal rather than argued about per feature.
 *
 * The list is what an email may describe about its own cargo. It is not who
 * the sender is, which customer they belong to, what they may see, or what
 * should be sent to them: an allowlist beats a denylist because the failure
 * mode of a forgotten entry is a refused proposal rather than a granted one.
 */
export const EXTRACTABLE_FIELDS: Readonly<Record<AiSurface, readonly string[]>> = {
  enquiry_extract: [
    'mode',
    'tradeDirection',
    'origin',
    'destination',
    'commodity',
    'incoterm',
    'readyOn',
    'grossWeightKg',
    'volumeCbm',
    'pieces',
    'containerCount',
    'containerType',
    'dimensions',
    'isDangerous',
  ],
  document_classify: ['documentType'],
  document_extract: [
    'containerNumber',
    'containerType',
    'vessel',
    'voyage',
    'billOfLadingNumber',
    'grossWeightKg',
    'chargeableWeightKg',
    'volumeCbm',
    'pieces',
    'portOfLoading',
    'portOfDischarge',
    'shippedOn',
  ],
  invoice_extract: [
    'invoiceNumber',
    'invoiceDate',
    'currency',
    'chargeType',
    'description',
    'quantity',
    'unitRate',
    'lineTotal',
    'invoiceTotal',
  ],
  rate_mapping: ['mapping'],
  rate_extract: [
    'chargeType',
    'description',
    'basis',
    'rate',
    'currency',
    'minimum',
    'maximum',
    'containerType',
    'validFrom',
    'validTo',
    'statedTotal',
    'origin',
    'destination',
    'mode',
  ],
  /*
    Read surfaces propose nothing, and the empty list is what enforces it
    rather than a comment saying so. `isWriteSurface` and this table have to
    agree, and `ai.test.ts` asserts that they do — two places that must not
    drift are two places worth a test.
  */
  assistant: [],
  draft_reply: [],
  quote_cover_note: [],
}

/**
 * Tidy a drafted covering note before it is stored.
 *
 * Models pad: a leading "Here is the covering note:", trailing spaces, a run of
 * blank lines. This trims those and caps the length so a runaway generation
 * cannot become a page of the quotation. It does not touch the prose itself —
 * the "no figures" rule is the prompt's to keep, and stripping digits here would
 * mangle a legitimate lane name or a date rather than enforce anything.
 */
export function finaliseCoverNote(text: string, maxChars = 1500): string {
  const tidied = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return tidied.length > maxChars ? tidied.slice(0, maxChars).trimEnd() : tidied
}

/**
 * Drops every proposal for a field the surface may not speak to.
 *
 * Returns the survivors and the refusals separately, because a refusal is a
 * security event and not a filter miss: an extraction that tried to set
 * `customerId` is either a prompt-injection attempt or a prompt bug, and both
 * want a row in the ledger and somebody's attention. Silently filtering would
 * lose the only evidence that it happened.
 */
export function admissible(
  surface: AiSurface,
  proposals: readonly FieldProposal[],
): { readonly allowed: FieldProposal[]; readonly refused: FieldProposal[] } {
  const permitted = new Set(EXTRACTABLE_FIELDS[surface])
  const allowed: FieldProposal[] = []
  const refused: FieldProposal[] = []

  for (const proposal of proposals) {
    ;(permitted.has(proposal.field) ? allowed : refused).push(proposal)
  }

  return { allowed, refused }
}

/* -------------------------------------------------------------------------
 * Container numbers, and the general rule they stand for
 * ---------------------------------------------------------------------- */

/**
 * ISO 6346 check digit — four letters, six digits, one check.
 *
 * Here because it is the clearest case of a rule worth stating generally:
 * **wherever a format verifies itself, verify it and throw the model's
 * confidence away.** A hallucinated container number is the most likely
 * single error in bill-of-lading extraction and the cheapest to catch, and no
 * confidence score is evidence next to arithmetic that either balances or
 * does not.
 *
 * The alphabet skips no letters but the values do: A is 10, and every
 * eleventh value is skipped thereafter because 11 is the modulus. That is the
 * standard's own quirk and it is why this cannot be written as `charCode`
 * arithmetic without a table.
 */
export function isValidContainerNumber(raw: string): boolean {
  const value = raw.replace(/[\s-]/g, '').toUpperCase()
  if (!/^[A-Z]{4}\d{7}$/.test(value)) return false

  let sum = 0
  for (let i = 0; i < 10; i++) {
    const char = value[i]!
    // The first four are the owner code, the rest the serial. The regex above
    // has already guaranteed which is which, so the test is a formality that
    // keeps the intent readable rather than a guard.
    const base = i < 4 ? letterValue(char) : Number(char)
    sum += base * 2 ** i
  }

  /*
    `% 11 % 10`, and both are needed.

    A remainder of 10 is written as the check digit 0 — the standard says so
    explicitly, and dropping the second modulus rejects roughly one container
    number in eleven as invalid. Those are real containers, and refusing them
    would send a coordinator back to typing exactly the numbers the extraction
    got right.
  */
  return (sum % 11) % 10 === Number(value[10])
}

/**
 * A is 10, and 11, 22 and 33 are skipped because 11 is the modulus.
 *
 * `ceil(index / 10)` counts the skips passed, which is the whole trick: one
 * skip somewhere in B–K, two by L–U, three by V–Z. Written as a formula
 * rather than a 26-entry table because the table is the kind of thing that
 * gets one entry wrong and passes review — `L = 23` looks exactly as
 * plausible as `L = 22`, and only one of them is a standard.
 */
function letterValue(char: string): number {
  const index = char.charCodeAt(0) - 'A'.charCodeAt(0)
  return 10 + index + Math.ceil(index / 10)
}
