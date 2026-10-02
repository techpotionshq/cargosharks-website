/**
 * The intake agent's judgement — when an inbound conversation has said enough,
 * and whether answering it would add anything.
 *
 * The product owner's brief was one sentence: *"smart enough to not reply to
 * every message and only take what's needed and when the whole inquiry is
 * completed."* A WhatsApp customer types "Hi", then "2x40HC", then "Shanghai to
 * Shuwaikh", then "thanks" — four webhooks inside a minute — and the intake
 * used to treat each as an event: an acknowledgement on the first, a model call
 * per enquiry, nothing that ever said *what is still missing*. A coordinator
 * then wrote the same three questions by hand that the customer could have been
 * asked while they were still holding the phone.
 *
 * Everything here is the pure half of the answer, tested in milliseconds
 * against no infrastructure (`test/intake.test.ts`):
 *
 *   - **completeness** — which facts a quotable enquiry needs, per mode, read
 *     from configuration rows (`intake_requirements`, FR-AD-03) and decided
 *     against what the enquiry and its open proposals already hold;
 *   - **chit-chat and auto-replies** — the messages that cost neither a model
 *     call nor a reply, because there is nothing in them to understand;
 *   - **language** — the customer's, from their own script, so a clarification
 *     reaches an Arabic speaker in Arabic;
 *   - **the decision** — confirm, clarify, hand to a person, or stay silent,
 *     with the reason recorded either way so an operator can read *why*;
 *   - **the debounce arithmetic** — when the next turn may run.
 *
 * The worker (`apps/service/src/workers/intake-turn.ts`) owns every effect: the
 * claim, the model call, the send, the rows. Nothing in this file knows a
 * message was ever sent.
 */

/* -------------------------------------------------------------------------
 * The facts a customer can be asked for
 * ---------------------------------------------------------------------- */

/**
 * The enquiry facts a requirement may name — a subset of `ENQUIRY_FIELDS`.
 *
 * Only the ones a customer can sensibly be asked in a chat. `tradeDirection`
 * is ours to infer from the lane, and `isDangerous` is a question a
 * coordinator asks with the context to explain why — asking a stranger "is it
 * dangerous?" by bot reads as an accusation.
 */
export const INTAKE_FIELDS = [
  'mode',
  'origin',
  'destination',
  'commodity',
  'containerCount',
  'containerType',
  'grossWeightKg',
  'volumeCbm',
  'pieces',
  'readyOn',
  'incoterm',
  'dimensions',
] as const

export type IntakeField = (typeof INTAKE_FIELDS)[number]

/** The transport modes a requirement can be scoped to — the `transport_mode` enum. */
export const INTAKE_MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const
export type IntakeMode = (typeof INTAKE_MODES)[number]

/**
 * How each fact is asked for, in the customer's language.
 *
 * Code rather than rows, and the line is deliberate: which facts are *required*
 * is configuration an administrator changes per branch (`intake_requirements`);
 * what "origin" is called in a sentence to a customer is vocabulary, fixed by
 * the field list it describes, and a row per field per language would be a
 * second place for the field list to drift. The *sentence* around these — the
 * greeting, the sign-off, the tone — is a template row an administrator edits.
 *
 * Phrased as noun phrases that read inside "we still need …", and the Arabic is
 * written, not translated: a Kuwaiti importer is asked for "مكان التحميل", not
 * a literal "place of origin".
 */
export const INTAKE_FIELD_PHRASES: Readonly<Record<IntakeField, { en: string; ar: string }>> = {
  mode: {
    en: 'how it should travel (sea full container, sea shared container, or air)',
    ar: 'طريقة الشحن (بحري حاوية كاملة، بحري شحنة مجمّعة، أو جوي)',
  },
  origin: { en: 'where it ships from', ar: 'مكان التحميل' },
  destination: { en: 'where it is going', ar: 'وجهة الشحنة' },
  commodity: { en: 'what the cargo is', ar: 'نوع البضاعة' },
  containerCount: { en: 'how many containers', ar: 'عدد الحاويات' },
  containerType: {
    en: "the container type (20', 40' or 40' high cube)",
    ar: 'نوع الحاوية (20 قدم، 40 قدم، أو 40 قدم عالية)',
  },
  grossWeightKg: { en: 'the total weight', ar: 'الوزن الإجمالي' },
  volumeCbm: { en: 'the volume in cubic metres', ar: 'الحجم بالمتر المكعب' },
  pieces: { en: 'the number of packages', ar: 'عدد الطرود' },
  readyOn: { en: 'when the cargo will be ready', ar: 'موعد جاهزية البضاعة' },
  incoterm: { en: 'the delivery terms (e.g. FOB or EXW)', ar: 'شروط التسليم (مثل FOB أو EXW)' },
  dimensions: { en: 'the package dimensions', ar: 'أبعاد الطرود' },
}

/* -------------------------------------------------------------------------
 * Requirements — configuration rows, and the defaults they are seeded from
 * ---------------------------------------------------------------------- */

/**
 * One thing a complete enquiry must state.
 *
 * `fields` is an *any-of*: "weight or volume" is one requirement satisfied by
 * either, because an LCL or air rate is priced on whichever is chargeable and
 * a customer who gave the volume has not left a gap. `mode` null applies to
 * every mode — the lane and the cargo are needed however it travels.
 */
export interface IntakeRequirement {
  readonly key: string
  readonly mode: IntakeMode | null
  readonly fields: readonly IntakeField[]
}

/**
 * What a quotable enquiry needs when an administrator has said nothing else.
 *
 * The seed writes these as the default rows (`branch_id` null); a branch that
 * writes its own rows replaces the set for that branch. Ready date and incoterm
 * are deliberately absent: both are worth having and neither stops a forwarder
 * pricing, and asking for them would turn a two-question clarification into a
 * form.
 */
export const DEFAULT_INTAKE_REQUIREMENTS: readonly IntakeRequirement[] = [
  { key: 'mode', mode: null, fields: ['mode'] },
  { key: 'origin', mode: null, fields: ['origin'] },
  { key: 'destination', mode: null, fields: ['destination'] },
  { key: 'commodity', mode: null, fields: ['commodity'] },
  // FCL is priced per container, so both the count and the box are the price.
  { key: 'containerCount', mode: 'sea_fcl', fields: ['containerCount'] },
  { key: 'containerType', mode: 'sea_fcl', fields: ['containerType'] },
  // Shared-space modes are priced on chargeable weight — either figure will do.
  { key: 'weightOrVolume', mode: 'sea_lcl', fields: ['grossWeightKg', 'volumeCbm'] },
  { key: 'weightOrVolume', mode: 'air', fields: ['grossWeightKg', 'volumeCbm'] },
  { key: 'weightOrVolume', mode: 'land', fields: ['grossWeightKg', 'volumeCbm'] },
  { key: 'weight', mode: 'courier', fields: ['grossWeightKg'] },
]

/**
 * The timing and patience settings, with the values a fresh deployment gets.
 *
 * Seeded as the default `intake_settings` row; these constants are what the
 * seed writes and what the worker falls back to if that row was never written,
 * so the two cannot disagree. `enabled` ships false like every other
 * automation that talks to a customer — the first conversation it holds should
 * be one somebody switched it on for.
 */
export interface IntakeSettings {
  readonly enabled: boolean
  /** Quiet time after a customer's last WhatsApp message before the turn runs. */
  readonly whatsappQuietSeconds: number
  /** The longest a WhatsApp turn waits from the first unanswered message. */
  readonly whatsappMaxWaitSeconds: number
  /** The same pair for email, where a customer sends one considered mail more often. */
  readonly emailQuietSeconds: number
  readonly emailMaxWaitSeconds: number
  /** Hours before a second clarification may follow the first. */
  readonly clarifyCooldownHours: number
  /** Clarifications per enquiry before a person takes over. */
  readonly clarifyCap: number
  /** A staff reply inside this many hours silences the agent on that conversation. */
  readonly humanTakeoverHours: number
}

export const DEFAULT_INTAKE_SETTINGS: IntakeSettings = {
  enabled: false,
  whatsappQuietSeconds: 120,
  whatsappMaxWaitSeconds: 600,
  emailQuietSeconds: 60,
  emailMaxWaitSeconds: 600,
  clarifyCooldownHours: 6,
  clarifyCap: 2,
  humanTakeoverHours: 12,
}

/**
 * The bounds a setting may take, shared by the settings form and the worker.
 *
 * The worker clamps as well as the form validating, because a row written by
 * psql at 2am is as real as one saved from the screen, and a quiet window of
 * zero seconds is the per-message behaviour this whole module replaces.
 */
export const INTAKE_SETTING_BOUNDS: Readonly<
  Record<Exclude<keyof IntakeSettings, 'enabled'>, { min: number; max: number }>
> = {
  whatsappQuietSeconds: { min: 15, max: 3600 },
  whatsappMaxWaitSeconds: { min: 60, max: 6 * 3600 },
  emailQuietSeconds: { min: 0, max: 3600 },
  emailMaxWaitSeconds: { min: 60, max: 6 * 3600 },
  clarifyCooldownHours: { min: 1, max: 168 },
  clarifyCap: { min: 0, max: 5 },
  humanTakeoverHours: { min: 1, max: 168 },
}

/** A settings row, clamped into its bounds — never trusted as stored. */
export function clampIntakeSettings(raw: Partial<IntakeSettings>): IntakeSettings {
  const out: Record<string, number | boolean> = {
    enabled: raw.enabled ?? DEFAULT_INTAKE_SETTINGS.enabled,
  }
  for (const [key, bounds] of Object.entries(INTAKE_SETTING_BOUNDS)) {
    const value = (raw as Record<string, unknown>)[key]
    const fallback = (DEFAULT_INTAKE_SETTINGS as unknown as Record<string, number>)[key]!
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
    out[key] = Math.min(Math.max(n, bounds.min), bounds.max)
  }
  return out as unknown as IntakeSettings
}

/* -------------------------------------------------------------------------
 * Completeness
 * ---------------------------------------------------------------------- */

/**
 * What the enquiry already knows, per field: a value, or nothing.
 *
 * "Known" is the customer having *said* it, not a coordinator having accepted
 * it — the caller folds open proposals in beside the columns. An enquiry whose
 * origin a model read as "Shanghai" and nobody has yet confirmed is not missing
 * its origin from the customer's side, and asking them again would be the bot
 * not listening.
 */
export type KnownFacts = Readonly<Partial<Record<IntakeField, string | null>>>

export interface Completeness {
  readonly complete: boolean
  /** The unmet requirements, in configuration order — what a clarification asks for. */
  readonly missing: readonly IntakeRequirement[]
  /** The mode the decision was made under, or null when that is itself missing. */
  readonly mode: IntakeMode | null
}

const isKnown = (value: string | null | undefined): boolean =>
  value !== null && value !== undefined && value.trim() !== ''

/**
 * Complete, or the requirements still unmet.
 *
 * Mode-scoped requirements apply only once the mode is known. Asking an
 * enquiry with no mode for "the container type" presumes FCL, and asking it for
 * "weight or volume" presumes it is not — so with no mode, the generic
 * requirements are asked and the mode with them, and the mode-specific ones
 * wait for the answer.
 *
 * A mode that is not one of ours (a model's "sea" that never resolved) counts
 * as unknown for the same reason.
 */
export function evaluateCompleteness(
  known: KnownFacts,
  requirements: readonly IntakeRequirement[],
): Completeness {
  const rawMode = known.mode?.trim() ?? ''
  const mode = (INTAKE_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as IntakeMode)
    : null

  const missing: IntakeRequirement[] = []
  const seen = new Set<string>()
  for (const requirement of requirements) {
    if (requirement.mode !== null && requirement.mode !== mode) continue
    const satisfied = requirement.fields.some((field) =>
      field === 'mode' ? mode !== null : isKnown(known[field]),
    )
    // One line per key, so an administrator who scoped "weight or volume" to
    // three modes never sees it asked twice.
    if (!satisfied && !seen.has(requirement.key)) {
      missing.push(requirement)
      seen.add(requirement.key)
    }
  }

  return { complete: missing.length === 0, missing, mode }
}

/* -------------------------------------------------------------------------
 * Language
 * ---------------------------------------------------------------------- */

export type IntakeLocale = 'en' | 'ar'

const ARABIC_LETTER = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/gu
const LATIN_LETTER = /[A-Za-z]/g

/**
 * The language a customer is writing in, from the script they use.
 *
 * Counted over every message they have sent, not the last one: a Kuwaiti
 * customer who writes three Arabic messages and then pastes "40HC" is still
 * writing Arabic. Letters, not characters — digits, port codes and container
 * sizes are the same in both and decide nothing.
 *
 * Arabizi ("salam, 3ndi 2 containers") is Latin script and reads as English.
 * That is the right answer rather than a gap: someone typing Arabic in Latin
 * letters is on a keyboard that writes English, and is answered in what their
 * own messages are written in. `previous` breaks a tie and covers a
 * conversation of stickers and numbers that names no script at all.
 */
export function detectLanguage(
  texts: readonly string[],
  previous: IntakeLocale | null = null,
): IntakeLocale {
  let arabic = 0
  let latin = 0
  for (const text of texts) {
    arabic += text.match(ARABIC_LETTER)?.length ?? 0
    latin += text.match(LATIN_LETTER)?.length ?? 0
  }
  if (arabic === 0 && latin === 0) return previous ?? 'en'
  if (arabic === latin) return previous ?? 'ar'
  return arabic > latin ? 'ar' : 'en'
}

/* -------------------------------------------------------------------------
 * Chit-chat — the messages with nothing in them to understand
 * ---------------------------------------------------------------------- */

/**
 * Greetings, thanks and acknowledgements, as token sequences.
 *
 * A list rather than a model, because this runs on every turn *before* the
 * model is asked and its whole value is that it costs nothing. Conservative by
 * construction: a message is chit-chat only if *every* word in it is on this
 * list, so "ok, 3 containers" is not, and the worst a missing phrase can do is
 * spend one model call that finds nothing — never drop a fact.
 *
 * "yes" and "no" are deliberately absent. They answer questions, and a
 * customer's "no" to "is any of it dangerous?" from a coordinator is a fact.
 */
const CHIT_CHAT_PHRASES: readonly string[] = [
  // English and the Gulf's chat English
  'ok',
  'okay',
  'okey',
  'okk',
  'k',
  'kk',
  'thanks',
  'thank you',
  'thank u',
  'thankyou',
  'thx',
  'thnx',
  'tnx',
  'ty',
  'many thanks',
  'thanks a lot',
  'noted',
  'well noted',
  'great',
  'perfect',
  'sure',
  'fine',
  'good',
  'cool',
  'nice',
  'alright',
  'all right',
  'got it',
  'understood',
  'received',
  'hi',
  'hii',
  'hello',
  'hey',
  'dear',
  'sir',
  'madam',
  'team',
  'good morning',
  'good afternoon',
  'good evening',
  'morning',
  'regards',
  'best regards',
  'so much',
  'very much',
  'much',
  'a lot',
  'again',
  'bro',
  'brother',
  'habibi',
  // Arabic in Latin letters
  'salam',
  'salaam',
  'slm',
  'salam alaikum',
  'salam alaykum',
  'assalamu alaikum',
  'assalam alaikum',
  'asalamualaikum',
  'assalamualaikum',
  'as salam alaikum',
  'wa alaikum salam',
  'walaikum salam',
  'marhaba',
  'ahlan',
  'shukran',
  'shukran jazeelan',
  'tamam',
  'yalla',
  'inshallah',
  'insha allah',
  'jazak allah',
  'jazakallah',
  'jazakallah khair',
  'mashallah',
  // Arabic
  'السلام عليكم',
  'السلام عليكم ورحمة الله',
  'السلام عليكم ورحمة الله وبركاته',
  'وعليكم السلام',
  'سلام',
  'مرحبا',
  'مرحبا بك',
  'هلا',
  'هلا والله',
  'اهلا',
  'اهلا وسهلا',
  'شكرا',
  'شكرا لك',
  'شكرا لكم',
  'شكرا جزيلا',
  'مشكور',
  'مشكورين',
  'تسلم',
  'تسلمون',
  'يعطيك العافيه',
  'الله يعطيك العافيه',
  'تمام',
  'طيب',
  'اوكي',
  'اوك',
  'حسنا',
  'ممتاز',
  'صباح الخير',
  'مساء الخير',
  'صباح النور',
  'ان شاء الله',
  'جزاك الله خير',
  'ما شاء الله',
  'وصل',
  'تم',
  'عزيزي',
  'اخي',
]

/** Arabic letter forms a person types interchangeably, folded to one. */
function foldArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟـ]/g, '') // harakat, dagger alif, tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
}

/** Lowercased, folded, emoji and punctuation removed, split into words. */
function tokens(text: string): string[] {
  return foldArabic(text.toLowerCase())
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
}

const PHRASES: readonly (readonly string[])[] = CHIT_CHAT_PHRASES.map((phrase) => tokens(phrase))
  // Longest first, so "thank you" is taken whole before "thank" could be tried.
  .sort((a, b) => b.length - a.length)

/**
 * Placeholders `inbound-whatsapp-webhook.ts` writes for a message with no words.
 *
 * A sticker or a reaction is a thumbs-up by other means, and a shared location
 * or contact card answers nothing a quotation needs. An image, a document, a
 * video or a voice note is *not* on this list: a photographed packing list or
 * a PDF booking sheet with no caption is often the whole enquiry, so it counts
 * as content and is read.
 */
const WORDLESS = /^\[whatsapp (sticker|reaction|location|contacts)( message)?(: [^\]]*)?\]$/i

/**
 * Whether a message says nothing an enquiry could use — "ok", "thanks 👍",
 * "السلام عليكم", a sticker.
 *
 * Every word must be on the list; an empty message (emoji only) is chit-chat.
 * Messages longer than a chat line are never chit-chat whatever they contain,
 * because a paragraph of pleasantries usually has the shipment in its last line.
 */
export function isChitChat(text: string): boolean {
  const trimmed = text.trim()
  if (WORDLESS.test(trimmed)) return true
  if (trimmed.length > 160) return false

  const words = tokens(trimmed)
  let i = 0
  while (i < words.length) {
    const match = PHRASES.find((phrase) => phrase.every((word, k) => words[i + k] === word))
    if (!match) return false
    i += match.length
  }
  return true
}

/**
 * The shape of an auto-responder's message — out of office, "thank you for
 * contacting us, we will get back to you".
 *
 * The WhatsApp half of `isAutomaticMail`. An email auto-reply announces itself
 * in headers the adapter reads; a WhatsApp business auto-reply carries nothing
 * but its words, and answering it is how two bots hold a conversation forever
 * (`Operations_Findings §11`, one channel over). This is the cheap textual
 * guard; the worker adds the two behavioural ones only it can see — the same
 * text arriving twice, and a reply landing faster than a person reads.
 */
const AUTO_REPLY = new RegExp(
  [
    'out of (the )?office',
    'auto(matic|mated)?[- ]?(reply|response|responder)',
    'this is an auto(matic|mated)',
    'i am (currently )?(away|out of|on (annual |sick )?leave|travell?ing)',
    '(do not|don.t) reply to this',
    'no-?reply',
    'thank(s| you) for (contacting|messaging|your message|reaching out)[^.!]{0,80}(get back|respond|reply|contact you)',
    'we (will|.ll) (get back|respond|reply) (to you )?(as soon as|shortly|within)',
    'our (business|working|office) hours',
    'رد آلي',
    'رسالة آلية',
    'رد تلقائي',
    'خارج المكتب',
    'في إجازة',
    'شكرا لتواصلك',
    'شكراً لتواصلك',
    'سنقوم بالرد',
    'سيتم الرد',
    'سنرد عليك',
  ].join('|'),
  'iu',
)

export function looksAutoReply(text: string): boolean {
  return AUTO_REPLY.test(text)
}

/**
 * An address no person reads — the daemon, the postmaster, the no-reply box.
 *
 * `isAutomaticMail` catches their mail by its headers before it is filed; this
 * is the second lock, on the way out, so the agent never addresses a reply to
 * one even if something filed it.
 */
export function isNoReplyAddress(address: string): boolean {
  const local = address.trim().toLowerCase().split('@')[0] ?? ''
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|donotreply|bounces?|notifications?)([+._-].*)?$/.test(
    local,
  )
}

/* -------------------------------------------------------------------------
 * The decision
 * ---------------------------------------------------------------------- */

/** What the new messages in a turn amount to, before any model is asked. */
export type NewContent = 'none' | 'chit_chat' | 'automatic' | 'substantive'

/**
 * Sort a turn's new messages into one verdict.
 *
 * Substantive if any message is; otherwise automatic if any is (an
 * auto-responder's "thanks for your message" is not a customer being polite);
 * otherwise chit-chat. The model is asked only for `substantive`.
 *
 * `machine` carries what only the worker can see, per message: the same text
 * arriving again, or a reply landing faster than a person reads. A message so
 * marked is automatic whatever its words — an auto-responder that happens to
 * quote "2x40HC" back at us is still an auto-responder.
 */
export function classifyNewContent(
  texts: readonly string[],
  machine: readonly boolean[] = [],
): NewContent {
  if (texts.length === 0) return 'none'
  let automatic = false
  for (const [i, text] of texts.entries()) {
    if (machine[i] || looksAutoReply(text)) automatic = true
    else if (!isChitChat(text)) return 'substantive'
  }
  return automatic ? 'automatic' : 'chit_chat'
}

export type IntakeAction = 'confirm' | 'clarify' | 'handoff' | 'none'

/**
 * Why the agent did what it did — stored on every turn, shown on the enquiry.
 *
 * An operator asking "why did it not answer this customer?" gets a word, not a
 * log search. Each value is a label in both catalogues.
 */
export type IntakeReason =
  | 'confirmed'
  | 'clarified'
  | 'cap_reached'
  | 'agent_off'
  | 'closed'
  | 'no_new_content'
  | 'chit_chat'
  | 'automatic'
  | 'already_complete'
  | 'human_active'
  | 'cooldown'
  | 'handed_off'
  | 'loop_guard'
  | 'model_unavailable'
  | 'model_retry'

export const INTAKE_REASONS: readonly IntakeReason[] = [
  'confirmed',
  'clarified',
  'cap_reached',
  'agent_off',
  'closed',
  'no_new_content',
  'chit_chat',
  'automatic',
  'already_complete',
  'human_active',
  'cooldown',
  'handed_off',
  'loop_guard',
  'model_unavailable',
  'model_retry',
]

export interface IntakeDecisionInput {
  readonly now: Date
  /** The per-enquiry switch an operator flips to take over. */
  readonly agentEnabled: boolean
  /** The enquiry is still pre-quote — `new`, `assigned` or `rating`. */
  readonly enquiryOpen: boolean
  readonly newContent: NewContent
  readonly completeness: Completeness
  /** Already confirmed once — the ready flag is set. */
  readonly alreadyReady: boolean
  /** Already handed to a person after the clarification cap. */
  readonly handedOff: boolean
  readonly clarificationsSent: number
  readonly lastClarifiedAt: Date | null
  /** Most recent sign that a person is talking to this customer, or null. */
  readonly humanActiveAt: Date | null
  /**
   * A sender-level loop breaker that tripped, or null — the per-sender daily
   * cap or the burst rule. Sender-level because a loop does not stay on one
   * enquiry: each turn of the 195-enquiry incident was a fresh one.
   */
  readonly senderGuard: string | null
  readonly settings: Pick<
    IntakeSettings,
    'clarifyCooldownHours' | 'clarifyCap' | 'humanTakeoverHours'
  >
}

export interface IntakeDecision {
  readonly action: IntakeAction
  readonly reason: IntakeReason
  /** Set the ready flag now — downstream automation may act on this enquiry. */
  readonly markReady: boolean
}

const HOUR = 60 * 60 * 1000

/**
 * Confirm, clarify, hand off, or stay silent — and why.
 *
 * The order is the policy, so it is written as a sequence rather than a table:
 *
 *  1. A switched-off agent, a closed enquiry, or a turn with nothing new to
 *     read says nothing. The last is what makes "do not ask again until the
 *     customer has written again" structural: a turn only exists because they
 *     wrote, and one with nothing substantive in it never reaches a reply.
 *  2. Complete for the first time: the ready flag goes up *whatever happens to
 *     the reply* — completeness is a fact about the enquiry, and a person
 *     talking to the customer, or a loop breaker, silences the message, not
 *     the pipeline. Then one confirmation, unless something says be quiet.
 *     Complete again: nothing. The customer adding "and it's urgent" after we
 *     said we have everything is proposed to the coordinator, not answered.
 *  3. Incomplete: a person in the conversation wins; past the cap the enquiry
 *     goes to a person once; inside the cooldown, silence; otherwise one
 *     consolidated clarification.
 *
 * `clarifyCap` zero is a legitimate setting — "never ask, just tell a person"
 * — and falls out of rule 3 with no special case.
 */
export function decideIntakeReply(input: IntakeDecisionInput): IntakeDecision {
  const silent = (reason: IntakeReason, markReady = false): IntakeDecision => ({
    action: 'none',
    reason,
    markReady,
  })

  if (!input.agentEnabled) return silent('agent_off')
  if (!input.enquiryOpen) return silent('closed')
  if (input.newContent === 'none') return silent('no_new_content')
  if (input.newContent === 'automatic') return silent('automatic')
  if (input.newContent === 'chit_chat') return silent('chit_chat')

  const humanActive = isHumanActive(input)

  if (input.completeness.complete) {
    if (input.alreadyReady) return silent('already_complete')
    if (humanActive) return silent('human_active', true)
    if (input.senderGuard) return silent('loop_guard', true)
    return { action: 'confirm', reason: 'confirmed', markReady: true }
  }

  if (input.handedOff) return silent('handed_off')
  if (humanActive) return silent('human_active')
  if (input.clarificationsSent >= input.settings.clarifyCap) {
    return { action: 'handoff', reason: 'cap_reached', markReady: false }
  }
  if (
    input.lastClarifiedAt !== null &&
    input.now.getTime() - input.lastClarifiedAt.getTime() <
      input.settings.clarifyCooldownHours * HOUR
  ) {
    return silent('cooldown')
  }
  if (input.senderGuard) return silent('loop_guard')
  return { action: 'clarify', reason: 'clarified', markReady: false }
}

/** A person has been on this conversation inside the takeover window. */
function isHumanActive(
  input: Pick<IntakeDecisionInput, 'now' | 'humanActiveAt' | 'settings'>,
): boolean {
  return (
    input.humanActiveAt !== null &&
    input.now.getTime() - input.humanActiveAt.getTime() < input.settings.humanTakeoverHours * HOUR
  )
}

/**
 * Why reading this turn is worthless or abuse, or null when the model should
 * read it.
 *
 * Run before the model call, so a turn that can neither change the enquiry nor
 * deserves the spend does not pay for one: a switched-off agent, whose turns
 * never read (a branch with the agent off must not pay per message), a closed
 * enquiry, a message with
 * nothing substantive in it (chit-chat, an auto-responder, an instant machine
 * reply), and a sender tripping the daily cap or the burst rule, where a model
 * call per message *is* the incident.
 *
 * A person on the conversation is deliberately not here. The reply stays
 * silent, `decideIntakeReply`
 * sees to that, but the read still happens: the coordinator who took over fills
 * the enquiry from the proposals it leaves, and a completing read still raises
 * the ready flag. That read is cheap and it is the useful part of the turn.
 */
export function silencedBeforeReading(
  input: Pick<IntakeDecisionInput, 'agentEnabled' | 'enquiryOpen' | 'newContent' | 'senderGuard'>,
): IntakeReason | null {
  if (!input.agentEnabled) return 'agent_off'
  if (!input.enquiryOpen) return 'closed'
  if (input.newContent === 'none') return 'no_new_content'
  if (input.newContent === 'automatic') return 'automatic'
  if (input.newContent === 'chit_chat') return 'chit_chat'
  if (input.senderGuard) return 'loop_guard'
  return null
}

/* -------------------------------------------------------------------------
 * The clarification's list, and the debounce
 * ---------------------------------------------------------------------- */

/**
 * "a, b and c" — or "أ، وب، وج" — the way a person lists things.
 *
 * Arabic joins every item after the first with و, attached to the word, and
 * separates with the Arabic comma; a literal "a, b and c" pattern reads as
 * translated.
 */
export function listNaturally(items: readonly string[], locale: IntakeLocale): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]!
  if (locale === 'ar')
    return (
      items[0]! +
      items
        .slice(1)
        .map((item) => `، و${item}`)
        .join('')
    )
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The missing requirements as the phrase a template's `{{missing}}` becomes.
 *
 * An any-of requirement reads as its alternatives: "the total weight or the
 * volume in cubic metres". Exactly the unmet requirements, in configuration
 * order, so the clarification asks for what is missing and nothing the
 * customer already said.
 */
export function missingPhrase(missing: readonly IntakeRequirement[], locale: IntakeLocale): string {
  const or = locale === 'ar' ? ' أو ' : ' or '
  return listNaturally(
    missing.map((requirement) =>
      requirement.fields.map((field) => INTAKE_FIELD_PHRASES[field][locale]).join(or),
    ),
    locale,
  )
}

/**
 * When the next turn may run: a quiet window after the latest message, but
 * never later than the maximum wait after the first unanswered one.
 *
 * The cap is what stops a customer who keeps typing — or an auto-responder
 * that keeps answering — from postponing the turn forever.
 */
export function turnDueAt(
  pendingSince: Date,
  latest: Date,
  quietSeconds: number,
  maxWaitSeconds: number,
): Date {
  const quiet = latest.getTime() + quietSeconds * 1000
  const cap = pendingSince.getTime() + maxWaitSeconds * 1000
  return new Date(Math.max(Math.min(quiet, cap), latest.getTime()))
}

/**
 * A container type as written by a person, folded to the code we hold — or null.
 *
 * "40HC", "40' HC", "40ft high cube", "40 HQ", "20 dry", "20GP" and "٤٠ قدم
 * عالية" all name rows in `container_types`; this reduces them to `40HC`,
 * `20GP` and the like, and the accept path checks the code exists. A bare "40"
 * is *not* guessed into 40GP: a forty-foot box is general purpose or high cube
 * and the price differs, so the question stays open for a person.
 */
export function containerTypeCode(raw: string): string | null {
  const text = foldArabic(raw.toUpperCase())
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/(FEET|FOOT|FT|['’"]|قدم)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const size = /\b(20|40|45)\b|^(20|40|45)/.exec(text)?.[0]?.trim()
  if (!size) return null
  const rest = text.replace(size, ' ')

  const kind = /\b(HC|HQ|HIGH ?CUBE)\b|عالي/.test(rest)
    ? 'HC'
    : /\b(RF|REEFER|RH)\b|مبرد/.test(rest)
      ? 'RF'
      : /\b(OT|OPEN ?TOP)\b/.test(rest)
        ? 'OT'
        : /\b(FR|FLAT ?RACK)\b/.test(rest)
          ? 'FR'
          : /\b(GP|DV|DC|DRY|STANDARD|ST|GENERAL)\b|عادي/.test(rest)
            ? 'GP'
            : null
  if (!kind) return null
  return `${size}${kind}`
}

/**
 * Whether text names a container *kind* — high cube, reefer, general purpose —
 * as opposed to a size alone. "40ft" does not; "40HC", "dry", "عادية" do.
 */
export function statesContainerKind(text: string): boolean {
  const folded = foldArabic(text.toUpperCase())
  return (
    /\d\s*['’]?\s*(HC|HQ|GP|DV|DC|RF|RH|OT|FR)\b/.test(folded) ||
    /\b(HC|HQ|HIGH ?CUBE|REEFER|DRY|STANDARD|GENERAL PURPOSE|OPEN ?TOP|FLAT ?RACK)\b/.test(
      folded,
    ) ||
    /عالي|مبرد|عادي|هاي ?كيوب/.test(folded)
  )
}
