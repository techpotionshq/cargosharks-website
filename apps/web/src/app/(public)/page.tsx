/**
 * The public entry point — `FR-CP-05`.
 *
 * Unauthenticated by design, which is exactly why tracking needs a second
 * identifier and a rate limit: an enumeration control, not a session (§8).
 *
 * The page leads with the tracking box rather than with the company, because
 * the person arriving here almost always wants one thing — where is my
 * container — and every additional click before that answer is the phone call
 * this product exists to remove (`PP-02`).
 */

import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Card } from '@/ui/card'
import { Button } from '@/ui/layout'
import { Icon, type IconName } from '@/ui/icon'

const FEATURES: readonly {
  icon: IconName
  title: 'featureTrackTitle' | 'featureQuoteTitle' | 'featureDocsTitle'
  body: 'featureTrackBody' | 'featureQuoteBody' | 'featureDocsBody'
}[] = [
  { icon: 'tracking', title: 'featureTrackTitle', body: 'featureTrackBody' },
  { icon: 'rates', title: 'featureQuoteTitle', body: 'featureQuoteBody' },
  { icon: 'document', title: 'featureDocsTitle', body: 'featureDocsBody' },
]

const SERVICES: readonly { icon: IconName; key: 'sea_fcl' | 'sea_lcl' | 'air' | 'land' }[] = [
  { icon: 'ship', key: 'sea_fcl' },
  { icon: 'container', key: 'sea_lcl' },
  { icon: 'plane', key: 'air' },
  { icon: 'truck', key: 'land' },
]

export default async function PublicHome() {
  const t = await getTranslations('public')
  const tTrack = await getTranslations('track')
  const tMode = await getTranslations('mode')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const established = brand.identity.established

  return (
    <>
      {/*
        The hero is brand-coloured; everything below it is neutral. That
        contrast is the whitelabel seam — a new operator's colour changes this
        band and nothing about the legibility of what follows.
      */}
      <section className="relative overflow-hidden bg-chrome">
        {/* A single soft brand glow, drawn from tokens rather than an image. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(60rem 30rem at 75% -10%, var(--qb-primary-700), transparent 70%)',
          }}
        />

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="eyebrow mb-3 text-accent">{t('heroEyebrow')}</p>
              <h1 className="font-display text-3xl leading-[1.15] font-semibold tracking-tight text-chrome-ink sm:text-4xl lg:text-[2.75rem]">
                {t('heroTitle')}
              </h1>
              <p className="mt-4 max-w-lg text-[1rem] text-chrome-ink-muted">{t('heroBody')}</p>

              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href="/track"
                  className="inline-flex h-11 items-center gap-2 rounded-sm bg-accent px-5 text-[0.9375rem] font-semibold text-brand-950 transition-opacity hover:opacity-90"
                >
                  <Icon name="tracking" size={17} />
                  {t('trackCta')}
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex h-11 items-center gap-2 rounded-sm border border-chrome-line px-5 text-[0.9375rem] font-medium text-chrome-ink transition-colors hover:bg-white/10"
                >
                  {t('portalCta')}
                  <Icon name="arrow-end" size={16} />
                </Link>
              </div>

              {established ? (
                <p className="numeric mt-8 text-[0.75rem] text-chrome-ink-muted/80">
                  {locale === 'ar' ? brand.identity.legalNameAr : brand.identity.legalNameEn} ·{' '}
                  {established}
                </p>
              ) : null}
            </div>

            {/* The tracking box, on the hero, because it is why people came. */}
            <Card className="lg:ms-auto lg:max-w-md">
              <h2 className="text-[0.9375rem] font-semibold text-ink">{tTrack('title')}</h2>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">{tTrack('subtitle')}</p>

              <form method="get" action="/track" className="mt-4 flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="eyebrow">{tTrack('reference')}</span>
                  <input
                    name="reference"
                    required
                    dir="ltr"
                    placeholder={tTrack('referencePlaceholder')}
                    className="ref numeric h-11 rounded-sm border border-line bg-surface-sunken px-3 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:bg-surface focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="eyebrow">{tTrack('verifier')}</span>
                  <input
                    name="verifier"
                    required
                    dir="ltr"
                    placeholder={tTrack('verifierPlaceholder')}
                    className="ref numeric h-11 rounded-sm border border-line bg-surface-sunken px-3 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:bg-surface focus:outline-none"
                  />
                </label>
                <Button type="submit" variant="primary" size="lg" iconEnd="arrow-end">
                  {tTrack('submit')}
                </Button>
              </form>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <span className="mb-3 flex size-9 items-center justify-center rounded-sm bg-brand-soft text-brand-soft-ink">
                <Icon name={feature.icon} size={18} />
              </span>
              <h3 className="text-[0.9375rem] font-semibold text-ink">{t(feature.title)}</h3>
              <p className="mt-1.5 text-[0.875rem] text-ink-muted">{t(feature.body)}</p>
            </Card>
          ))}
        </div>

        <div className="mt-12">
          <p className="eyebrow mb-4">{t('servicesEyebrow')}</p>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {SERVICES.map((service) => (
              <li
                key={service.key}
                className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3"
              >
                <Icon name={service.icon} size={20} className="shrink-0 text-brand" />
                <span className="text-[0.875rem] font-medium text-ink">{tMode(service.key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
