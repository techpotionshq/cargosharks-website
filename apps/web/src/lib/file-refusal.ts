import 'server-only'

/**
 * What a file route says when it has no file to give — U3.
 *
 * The PDF and download links are ordinary links: a person clicks one and the
 * browser navigates to it. So when the service was not configured, or a
 * document did not exist, the person was shown the raw body of the refusal —
 * `{"error":"not_configured"}` on a blank page, in English, with no way back.
 *
 * A browser asking for HTML now gets a short page in the reader's language,
 * in the operator's colours, that says what happened, offers to try again
 * where that can help (or to sign in when the session has lapsed), and links
 * back. Anything else (a script, a test,
 * `fetch` from the client) still gets the JSON it always got, with the same
 * status, so nothing that reads the code changes.
 *
 * The page is built by hand rather than rendered through React: it has to
 * work from a route handler, outside every layout, and it is six elements.
 * Every interpolated string is escaped.
 */

import { NextResponse } from 'next/server'
import { getLocale, getTranslations } from 'next-intl/server'
import { brandCss } from '@qabandi/brand'
import { DEFAULT_LOCALE, directionOf, isLocale } from '@/i18n/request'
import { getBrand } from '@/lib/brand'

export type FileRefusal =
  | 'not_found'
  | 'not_configured'
  | 'not_available'
  | 'render_failed'
  | 'storage_unavailable'
  | 'unauthenticated'
  | 'unknown_kind'

const STATUS: Record<FileRefusal, number> = {
  not_found: 404,
  not_configured: 503,
  not_available: 501,
  render_failed: 502,
  storage_unavailable: 502,
  unauthenticated: 401,
  unknown_kind: 400,
}

/*
  Where trying again can help. A missing document or an unknown kind will be
  missing next time too, and a signed-out reader needs to sign in, not retry.
*/
const RETRYABLE: ReadonlySet<FileRefusal> = new Set([
  'not_configured',
  'not_available',
  'render_failed',
  'storage_unavailable',
])

/** The same file again: this route's own path and query, nothing from outside. */
export function retryHref(request: Request): string {
  const url = new URL(request.url)
  return `/${url.pathname.replace(/^\/+/, '')}${url.search}`
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * Where "back" goes: the page the link was on, when it was one of ours.
 *
 * A real link rather than `history.back()`, because the content-security
 * policy in `proxy.ts` refuses inline script — and a referrer from another
 * origin is not followed, so this page cannot be used to bounce somebody off
 * our domain to one of an attacker's choosing.
 */
export function backHref(request: Request): string {
  const referer = request.headers.get('referer')
  if (!referer) return '/'
  try {
    const from = new URL(referer)
    if (from.origin !== new URL(request.url).origin) return '/'
    // A path starting "//" is another site to a browser (`//evil.example/x`),
    // even when it arrived on our own origin; collapse the leading slashes.
    return `/${from.pathname.replace(/^\/+/, '')}${from.search}`
  } catch {
    return '/'
  }
}

export async function fileRefusal(
  request: Request,
  reason: FileRefusal,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const status = STATUS[reason]
  const wantsPage = (request.headers.get('accept') ?? '').includes('text/html')
  if (!wantsPage) return NextResponse.json({ error: reason, ...extra }, { status })

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const t = await getTranslations('fileRefusal')
  const title = t(`${reason}.title` as 'not_found.title')
  const body = t(`${reason}.body` as 'not_found.body')

  /*
    The actions: try again where that can work, sign in where the session is
    the problem, and always a way back to the page the link was on.
  */
  const actions = [
    reason === 'unauthenticated'
      ? `<a class="primary" href="/sign-in">${escape(t('signIn'))}</a>`
      : RETRYABLE.has(reason)
        ? `<a class="primary" href="${escape(retryHref(request))}">${escape(t('retry'))}</a>`
        : '',
    `<a class="secondary" href="${escape(backHref(request))}">${escape(t('back'))}</a>`,
  ].join('')

  const html = `<!doctype html>
<html lang="${locale}" dir="${directionOf(locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  /* The operator's own tokens, the ones every screen is drawn with, so the
     error looks like the product it came from. No literal colours. */
  ${brandCss(getBrand())}
  body { font-family: system-ui, sans-serif; margin: 0; padding: 48px 16px; background: var(--qb-canvas); color: var(--qb-ink); }
  main { max-width: 32rem; margin: 0 auto; background: var(--qb-surface); border: 1px solid var(--qb-line); border-radius: var(--qb-radius-lg); padding: 24px; }
  h1 { font-size: 1.125rem; margin: 0 0 8px; }
  p { font-size: 0.9375rem; line-height: 1.5; margin: 0 0 20px; color: var(--qb-ink-muted); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  a { display: inline-flex; align-items: center; height: 40px; padding-inline: 16px; border-radius: var(--qb-radius-sm); font-weight: 600; text-decoration: none; font-size: 0.9375rem; }
  a.primary { background: var(--qb-brand); color: var(--qb-on-brand); }
  a.secondary { border: 1px solid var(--qb-line); color: var(--qb-ink); }
</style></head>
<body><main><h1>${escape(title)}</h1><p>${escape(body)}</p>
<div class="actions">${actions}</div></main></body></html>`

  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

/**
 * `fetch` to the service, with an unreachable service as `null`, not a throw.
 *
 * Every file route checked `response.ok` and answered a failed render with
 * the `render_failed` page, but a service that was down, refused the
 * connection or ran past the 45-second timeout made `fetch` throw before that
 * check ran. The route then died as a bare 500 with an empty body (live run
 * 6), the one failure the refusal page was written for. A `null` here is the
 * caller's cue to give the same page a failed render gets.
 */
export async function reachService(url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init)
  } catch (error) {
    // Kept in the server log: the page says "try again", the log says why.
    console.error('[file-route] service unreachable', url, error)
    return null
  }
}
