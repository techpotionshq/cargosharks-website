'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

/**
 * The error boundary — what an operator sees when a page throws.
 *
 * A client component by requirement: React needs a component that can re-run
 * the failed render, which is what `reset()` does.
 *
 * ## The digest is the point of this screen
 *
 * Next assigns every server error a `digest` and logs the real stack under the
 * same value. Showing it turns an unactionable "something went wrong" into a
 * reference an operator can quote and support can grep for — which is the
 * difference between a support conversation that starts with "when?" and one
 * that starts with the exact stack.
 *
 * The message itself is never shown. In production Next redacts it anyway, and
 * for good reason: the current outage is a `BETTER_AUTH_SECRET` failure whose
 * message names an environment variable and a security property. That belongs
 * in the logs, not on a page a customer's staff can read.
 *
 * ## What it promises, and why that is safe to promise
 *
 * "Nothing you were working on has been lost." That is true by construction
 * rather than by hope: every write runs inside one `withActor` transaction
 * (§5.2), so a render that throws has committed nothing.
 */
export default function Error({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}) {
  const t = useTranslations('errorPage')

  useEffect(() => {
    /*
      Reported from the browser as well as the server.

      `instrumentation.ts` catches what the server throws, but a failure during
      hydration never reaches it — the server rendered fine and the browser
      then disagreed. Those are exactly the errors that are hardest to
      reproduce, so they are worth the console line.
    */
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'error-boundary',
        digest: error.digest ?? null,
        message: error.message,
      }),
    )
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 py-16">
      <div className="w-full max-w-lg">
        <p className="eyebrow text-critical">{t('eyebrow')}</p>
        <h1 className="font-display mt-2 text-display font-semibold tracking-tight text-ink sm:text-display-lg">
          {t('title')}
        </h1>
        <p className="mt-3 text-title leading-relaxed text-ink-muted">{t('description')}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center rounded-sm bg-brand px-4 text-title font-semibold text-on-brand transition-colors hover:bg-brand-hover"
          >
            {t('retry')}
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-sm border border-line px-4 text-title font-medium text-ink transition-colors hover:bg-surface-sunken"
          >
            {t('backToBoard')}
          </Link>
        </div>

        {error.digest ? (
          <div className="mt-10 rounded-sm border border-line bg-surface-sunken px-4 py-3">
            <p className="eyebrow text-ink-subtle">{t('reference')}</p>
            {/* `dir=ltr` and monospace: a digest is an identifier, not prose, and
                must not be reordered by the bidirectional algorithm in Arabic. */}
            <p dir="ltr" className="mt-1 font-mono text-body-sm text-ink">
              {error.digest}
            </p>
            <p className="mt-2 text-body-sm text-ink-subtle">{t('referenceHint')}</p>
          </div>
        ) : null}
      </div>
    </main>
  )
}
