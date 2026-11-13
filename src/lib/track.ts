/**
 * The site's measurement events, pushed onto Google Tag Manager's `dataLayer`.
 *
 * The site names the events and GTM only forwards them. The alternative, GTM
 * click and form triggers keyed on CSS selectors, breaks silently the first
 * time someone restyles a button, and the quote form can't be watched that way
 * at all: it posts with `fetch` behind `preventDefault`, so a GTM "form submit"
 * trigger fires on every attempt, including the ones the server turned away.
 * Here `generate_lead` fires only after `/contact/` answered 2xx, which is the
 * number an ad campaign has to optimise for.
 *
 * GTM forwards every event in `SiteEvent` to GA4 under the same name, with the
 * parameters as event parameters: one Custom Event trigger ("CE - site
 * events", which matches the names below by regex) and one GA4 event tag. A
 * new event name has to be added to that trigger's regex as well.
 *
 * **Never put personal data in a parameter.** No name, email, phone or company,
 * not even hashed: the privacy policy (section 03) says Google is not told who
 * you are, and GA4's terms forbid it anyway.
 */

export type SiteEvent =
  /** Someone touched the quote form for the first time this page view. */
  | 'form_start'
  /** The quote form was accepted by the server. The conversion. */
  | 'generate_lead'
  /** The quote form was refused or failed; `error` says which. */
  | 'form_error'
  /** A call to action was clicked: `cta` is get_quote, try_demo, book_call, email, whatsapp or phone. */
  | 'cta_click'

/**
 * Every parameter any event sends. Each is a GA4 custom dimension of the same
 * name and a `DLV - <name>` variable in GTM; a new one needs both before it
 * shows up in a report.
 */
const PARAMS = [
  'cta',
  'cta_location',
  'cta_text',
  'lead_country',
  'lead_branches',
  'lead_users',
  'lead_einvoicing',
  'lead_timeline',
  'form_error',
  'page_lang',
] as const

type Params = Partial<Record<(typeof PARAMS)[number], string>>

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
    clarity?: (...args: unknown[]) => void
  }
}

/**
 * `then`, when given, runs once GTM has fired the tags for this event, or
 * after `timeoutMs` if it never does (blocked, slow, or not loaded): the
 * caller must never wait on a tracker an ad blocker removed.
 */
export function track(
  event: SiteEvent,
  params: Params = {},
  then?: { callback: () => void; timeoutMs: number },
) {
  if (typeof window === 'undefined') return
  // Created here if GTM has not loaded yet (or was blocked): GTM replays
  // whatever is already on the array when it arrives, and when it never does,
  // pushing onto a plain array costs nothing.
  window.dataLayer = window.dataLayer || []
  // `page_lang` on every event, from the document rather than a prop: the
  // Arabic and English sites are separate root layouts, and the question an
  // ad budget asks first is which language converts.
  //
  // Every known parameter is reset to `undefined` first. GTM's data layer is a
  // merged model, not a queue of messages: without the reset, a `generate_lead`
  // after a `cta_click` would inherit that click's `cta` and report it as the
  // lead's.
  const reset = Object.fromEntries(PARAMS.map((key) => [key, undefined]))
  window.dataLayer.push({
    ...reset,
    event,
    page_lang: document.documentElement.lang,
    ...params,
    ...(then && { eventCallback: then.callback, eventTimeout: then.timeoutMs }),
  })
  // GTM's own `eventTimeout` only counts once GTM is running; this one covers
  // the page where it never loaded.
  if (then) window.setTimeout(then.callback, then.timeoutMs)
  // The same name as a Clarity custom event, so recordings can be filtered to
  // the sessions that sent a lead or clicked through to the demo.
  window.clarity?.('event', event)
}

/**
 * Which call to action a link is, from where it points. Classified by href
 * rather than tagged at each call site because there are a dozen "Get a
 * quote" links across the header, bands and solution pages, and a new one
 * would otherwise go uncounted until someone noticed.
 */
export function ctaFor(href: string): string | null {
  if (href.includes('#quote')) return 'get_quote'
  if (href.startsWith('https://demo.cargosharks.com')) return 'try_demo'
  if (href.includes('cal.com/')) return 'book_call'
  if (href.startsWith('mailto:')) return 'email'
  if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(href)) return 'whatsapp'
  if (href.startsWith('tel:')) return 'phone'
  return null
}
