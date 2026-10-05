import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getBrand } from '@/lib/brand'
import { getSession, homeFor } from '@/lib/session'
import { Logo } from '@/ui/logo'
import { getLocale } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'

/**
 * The 404 — FR-ID-04's public face.
 *
 * `notFound()` is called on every detail route in the system, and until now
 * every one of them rendered Next's unbranded English default. That matters
 * more here than on most products, because **not found is also what
 * unauthorised looks like**: row-level security makes another branch's job
 * invisible rather than forbidden, so a coordinator following a colleague's
 * link to a Dubai shipment lands exactly here.
 *
 * So the copy has to cover both without saying which. "The record may have
 * been closed, or it may belong to a branch you cannot see" is true in both
 * cases and leaks nothing — telling someone *which* would rebuild the
 * enumeration signal the policy design removes.
 */
export default async function NotFound() {
  const [t, tNav, session] = await Promise.all([
    getTranslations('notFound'),
    getTranslations('nav'),
    getSession(),
  ])
  /*
    The way back is to the reader's own start page, named the way the menu
    names it, and to sign-in for somebody who is not signed in. "Back to
    dashboard" for everyone sent a signed-out visitor to a page that bounced
    them to sign-in, and a customer to a screen they cannot open.
  */
  const home = session ? homeFor(session) : null
  const homeName =
    home === '/portal' ? tNav('portal') : home === '/agent' ? tNav('agent') : tNav('dashboard')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 py-16">
      <div className="w-full max-w-lg">
        <Logo brand={brand} locale={locale} size="sm" />

        <p className="eyebrow mt-10 text-ink-subtle">{t('eyebrow')}</p>
        <h1 className="font-display mt-2 text-display font-semibold tracking-tight text-ink sm:text-display-lg">
          {t('title')}
        </h1>
        <p className="mt-3 text-title leading-relaxed text-ink-muted">{t('description')}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          {/*
            Two ways out, and the second one matters.

            A customer following a stale tracking link is not signed in and has
            no board to go back to — sending them to `/dashboard` would bounce
            them to sign-in, which reads as "you are locked out" rather than
            "that link is old".
          */}
          <Link
            href={home ?? '/sign-in'}
            className="inline-flex h-10 items-center rounded-sm bg-brand px-4 text-title font-semibold text-on-brand transition-colors hover:bg-brand-hover"
          >
            {home ? t('backTo', { place: homeName }) : t('signIn')}
          </Link>
          <Link
            href="/track"
            className="inline-flex h-10 items-center rounded-sm border border-line px-4 text-title font-medium text-ink transition-colors hover:bg-surface-sunken"
          >
            {t('backToTracking')}
          </Link>
        </div>

        {/* No footer line: it said "Not found" again under the eyebrow that
            already says it. */}
      </div>
    </main>
  )
}
