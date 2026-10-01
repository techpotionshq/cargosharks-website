import 'server-only'

/**
 * What a file route says when it has no file to give — U3.
 *
 * The PDF and download links are ordinary links: a person clicks one and the
 * browser navigates to it. So when the service was not configured, or a
 * document did not exist, the person was shown the raw body of the refusal —
 * `{"error":"not_configured"}` on a blank page, in English, with no way back.
 *
 * A browser asking for HTML now gets a short page in the reader's language
 * that says what happened and links back. Anything else (a script, a test,
 * `fetch` from the client) still gets the JSON it always got, with the same
 * status, so nothing that reads the code changes.
 *
 * The page is built by hand rather than rendered through React: it has to
 * work from a route handler, outside every layout, and it is six elements.
 * Every interpolated string is escaped.
 */

import { NextResponse } from 'next/server'
import { getLocale, getTranslations } from 'next-intl/server'
import { DEFAULT_LOCALE, directionOf, isLocale } from '@/i18n/request'

export type FileRefusal =
  'not_found' | 'not_configured' | 'not_available' | 'render_failed' | 'storage_unavailable'

const STATUS: Record<FileRefusal, number> = {
  not_found: 404,
  not_configured: 503,
  not_available: 501,
  render_failed: 502,
  storage_unavailable: 502,
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
function backHref(request: Request): string {
  const referer = request.headers.get('referer')
  if (!referer) return '/'
  try {
    const from = new URL(referer)
    return from.origin === new URL(request.url).origin ? `${from.pathname}${from.search}` : '/'
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
  const back = t('back')

  const html = `<!doctype html>
<html lang="${locale}" dir="${directionOf(locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  /* System colours only: this page renders outside every layout, so the
     brand's tokens are not on it, and a hard-coded palette would be one more
     operator's colours in someone else's deployment. */
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 48px 16px; background: Canvas; color: CanvasText; }
  main { max-width: 32rem; margin: 0 auto; border: 1px solid GrayText; border-radius: 12px; padding: 24px; }
  h1 { font-size: 1.125rem; margin: 0 0 8px; }
  p { font-size: 0.9375rem; line-height: 1.5; margin: 0 0 16px; }
  a { color: LinkText; font-weight: 600; text-decoration: none; }
</style></head>
<body><main><h1>${escape(title)}</h1><p>${escape(body)}</p>
<a href="${escape(backHref(request))}">${escape(back)}</a></main></body></html>`

  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}
