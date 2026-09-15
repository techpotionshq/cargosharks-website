'use client'

import { useEffect, useState } from 'react'

/**
 * The last boundary — when the root layout itself fails.
 *
 * This is the screen the current outage produces. `BETTER_AUTH_SECRET` is read
 * at module evaluation, so the failure happens while the layout is being
 * built: `error.tsx` never renders, because `error.tsx` lives *inside* the
 * layout that just threw.
 *
 * ## Everything here is self-contained, and it has to be
 *
 * This component replaces the entire document — it renders its own `<html>`
 * and `<body>`. That means:
 *
 *   - **No stylesheet, and no brand.** See the note below — this is the one
 *     file in the repository that may hold a colour literal, and
 *     `scripts/check-brand.mjs` allows it by name on that basis.
 *   - **No `NextIntlClientProvider`.** The locale is read from the cookie the
 *     language switch sets, and the strings are inline. Two languages, twelve
 *     words each — a translation catalogue this screen cannot load anyway.
 *   - **No session, no database, no assumptions.** If the layout could not
 *     build, nothing it provides can be relied on here.
 *
 * ## Why the digest is shown
 *
 * It is the only actionable thing on the page. Next logs the real stack under
 * the same value, so quoting it turns "the site is down" into a line an
 * engineer can find. The message itself is deliberately not shown: the current
 * one names an environment variable and explains a signing-key weakness, which
 * is precisely what should not be readable by whoever hits the page.
 *
 * ## Why the colours are literals, and why they are all grey
 *
 * Three separate doors are shut, and it is worth writing them down because
 * each looks openable from a distance:
 *
 *   1. **The tokens are not in the document.** `<style id="qb-brand">` belongs
 *      to the root layout, and the root layout is the thing that just threw —
 *      it is not merely unstyled here, it is *not rendered*. `var(--qb-brand)`
 *      resolves to nothing, and a `background` that resolves to nothing is a
 *      transparent button.
 *   2. **`getBrand()` cannot be called.** Next requires the root error
 *      boundary to be a Client Component, and `@/lib/brand` is `server-only`
 *      by construction.
 *   3. **Importing `resolveBrand()` here would be worse than the bug.** It
 *      would put the brand into the *client* bundle, frozen at build time —
 *      and "nothing brand-related is bundled into client JavaScript" is the
 *      property that makes a re-skin an environment variable rather than a
 *      deployment. Trading that away to colour one button is not a trade.
 *
 * So a literal it is. What it may **not** be is a *company's* colour. This
 * button was `#8c1d18`, Al-Qabandi's maroon, left behind when the default
 * brand became CargoSharks — so the one screen that renders when everything
 * else has failed greeted every operator with a competitor's red. The palette
 * is now warm neutrals only, and the primary action takes the same near-black
 * as the body text: it belongs to nobody, it reads as a button in either
 * language, and it is right for whichever operator is running.
 */

const STRINGS = {
  en: {
    title: 'The application could not start',
    body: 'This is a configuration problem on the server, not something you did. It has been recorded, and it needs an administrator rather than a retry.',
    retry: 'Try again',
    reference: 'Reference',
    hint: 'Quote this to your administrator. It matches the entry in the server log.',
  },
  ar: {
    title: 'تعذّر تشغيل التطبيق',
    body: 'هذه مشكلة في إعدادات الخادم وليست ناتجة عن تصرّفك. تم تسجيلها، وتحتاج إلى تدخّل المسؤول لا إلى إعادة المحاولة.',
    retry: 'إعادة المحاولة',
    reference: 'المرجع',
    hint: 'اذكر هذا الرقم للمسؤول. فهو يطابق السجل على الخادم.',
  },
} as const

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}) {
  /*
    Read after mount, not during render.

    `document.cookie` does not exist on the server, and this component is still
    server-rendered once before it hydrates. Defaulting to English and
    correcting on the client avoids a hydration mismatch — which would throw
    inside the boundary that exists to catch throwing.
  */
  const [locale, setLocale] = useState<'en' | 'ar'>('en')

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)qabandi_locale=(ar|en)/)
    if (match?.[1] === 'ar') setLocale('ar')

    console.error(
      JSON.stringify({
        level: 'error',
        source: 'global-error-boundary',
        digest: error.digest ?? null,
        message: error.message,
      }),
    )
  }, [error])

  const t = STRINGS[locale]

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#fbfaf9',
          color: '#1c1917',
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', 'Noto Sans', 'Noto Sans Arabic', sans-serif",
          lineHeight: 1.6,
        }}
      >
        <main style={{ maxWidth: '32rem', width: '100%' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 0.75rem' }}>{t.title}</h1>
          <p style={{ margin: '0 0 1.5rem', color: '#57534e' }}>{t.body}</p>

          <button
            type="button"
            onClick={reset}
            style={{
              height: '2.5rem',
              padding: '0 1rem',
              border: 'none',
              borderRadius: '2px',
              // The body ink, not a brand colour — see the header.
              background: '#1c1917',
              color: '#fbfaf9',
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.retry}
          </button>

          {error.digest ? (
            <div
              style={{
                marginTop: '2.5rem',
                border: '1px solid #e7e5e4',
                borderRadius: '2px',
                padding: '0.75rem 1rem',
                background: '#f5f5f4',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.6875rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#78716c',
                }}
              >
                {t.reference}
              </p>
              {/* An identifier, not prose — `dir=ltr` so the bidirectional
                  algorithm does not reorder it in the Arabic document. */}
              <p
                dir="ltr"
                style={{
                  margin: '0.25rem 0 0',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.8125rem',
                }}
              >
                {error.digest}
              </p>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: '#78716c' }}>
                {t.hint}
              </p>
            </div>
          ) : null}
        </main>
      </body>
    </html>
  )
}
