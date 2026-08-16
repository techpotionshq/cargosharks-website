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
import { LaneMap } from '@/ui/lane-map'

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


/**
 * The corridors the business advertises, with real coordinates.
 *
 * Static on purpose — see the note at the call site. `count` here is a
 * *relative prominence*, not a shipment count: it decides line weight so the
 * headline corridors read as headline corridors, and it is not a figure anyone
 * could mistake for a volume, because none is shown.
 */
const PUBLISHED_LANES = [
  { id: 'cnsha-kwswk', originName: 'Shanghai', originLon: 121.47, originLat: 31.23,
    destinationName: 'Shuwaikh', destinationLon: 47.93, destinationLat: 29.35,
    count: 6, mode: 'sea_fcl' },
  { id: 'cnngb-kwswk', originName: 'Ningbo', originLon: 121.55, originLat: 29.87,
    destinationName: 'Shuwaikh', destinationLon: 47.93, destinationLat: 29.35,
    count: 4, mode: 'sea_fcl' },
  { id: 'sgsin-aejea', originName: 'Singapore', originLon: 103.85, originLat: 1.29,
    destinationName: 'Jebel Ali', destinationLon: 55.06, destinationLat: 25.01,
    count: 4, mode: 'sea_lcl' },
  { id: 'nlrtm-kwswk', originName: 'Rotterdam', originLon: 4.48, originLat: 51.92,
    destinationName: 'Shuwaikh', destinationLon: 47.93, destinationLat: 29.35,
    count: 5, mode: 'sea_fcl' },
  { id: 'deham-kwsaa', originName: 'Hamburg', originLon: 9.99, originLat: 53.55,
    destinationName: 'Shuaiba', destinationLon: 48.15, destinationLat: 29.03,
    count: 3, mode: 'sea_fcl' },
  { id: 'innsa-kwswk', originName: 'Nhava Sheva', originLon: 72.95, originLat: 18.95,
    destinationName: 'Shuwaikh', destinationLon: 47.93, destinationLat: 29.35,
    count: 4, mode: 'sea_lcl' },
  { id: 'trmer-aejea', originName: 'Mersin', originLon: 34.63, originLat: 36.8,
    destinationName: 'Jebel Ali', destinationLon: 55.06, destinationLat: 25.01,
    count: 2, mode: 'sea_fcl' },
  { id: 'kwkwi-cnszx', originName: 'Kuwait', originLon: 47.97, originLat: 29.23,
    destinationName: 'Shenzhen', destinationLon: 114.06, destinationLat: 22.54,
    count: 3, mode: 'air' },
  { id: 'aedxb-gbfxt', originName: 'Dubai', originLon: 55.36, originLat: 25.25,
    destinationName: 'Felixstowe', destinationLon: 1.31, destinationLat: 51.95,
    count: 2, mode: 'air' },
  { id: 'sadmm-kwswk', originName: 'Dammam', originLon: 50.2, originLat: 26.5,
    destinationName: 'Shuwaikh', destinationLon: 47.93, destinationLat: 29.35,
    count: 3, mode: 'land' },
] as const

const PUBLISHED_PORTS = [
  { id: 'kwswk', name: 'Shuwaikh', longitude: 47.93, latitude: 29.35, count: 9 },
  { id: 'aejea', name: 'Jebel Ali', longitude: 55.06, latitude: 25.01, count: 6 },
  { id: 'cnsha', name: 'Shanghai', longitude: 121.47, latitude: 31.23, count: 6 },
  { id: 'nlrtm', name: 'Rotterdam', longitude: 4.48, latitude: 51.92, count: 5 },
  { id: 'innsa', name: 'Nhava Sheva', longitude: 72.95, latitude: 18.95, count: 4 },
  { id: 'sgsin', name: 'Singapore', longitude: 103.85, latitude: 1.29, count: 4 },
  { id: 'cnngb', name: 'Ningbo', longitude: 121.55, latitude: 29.87, count: 4 },
  { id: 'deham', name: 'Hamburg', longitude: 9.99, latitude: 53.55, count: 3 },
  { id: 'kwsaa', name: 'Shuaiba', longitude: 48.15, latitude: 29.03, count: 3 },
  { id: 'trmer', name: 'Mersin', longitude: 34.63, latitude: 36.8, count: 2 },
  { id: 'gbfxt', name: 'Felixstowe', longitude: 1.31, latitude: 51.95, count: 2 },
  { id: 'sadmm', name: 'Dammam', longitude: 50.2, latitude: 26.5, count: 3 },
  { id: 'cnszx', name: 'Shenzhen', longitude: 114.06, latitude: 22.54, count: 3 },
] as const

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
        The hero.

        It used to be cut from `chrome`, on the assumption that chrome is dark
        — which it no longer is in the light theme, so the band rendered as a
        near-white slab with a pink smear where a brand glow used to read as
        depth. Rebuilt against the surface tokens directly: a very pale wash of
        the brand and the accent, and ink that is legible on it in both themes.

        The whitelabel seam still holds — every colour below is a token, so a
        new operator's palette moves this band and nothing about the legibility
        of what follows.
      */}
      <section className="relative overflow-hidden border-b border-line bg-surface">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(46rem 26rem at 88% -12%, color-mix(in oklab, var(--qb-brand) 13%, transparent), transparent 68%),' +
              'radial-gradient(38rem 22rem at 6% 108%, color-mix(in oklab, var(--qb-accent) 11%, transparent), transparent 66%)',
          }}
        />

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="eyebrow mb-3 text-brand">{t('heroEyebrow')}</p>
              <h1 className="font-display text-3xl leading-[1.1] font-semibold tracking-tight text-balance text-ink sm:text-4xl lg:text-[3rem]">
                {t('heroTitle')}
              </h1>
              <p className="mt-4 max-w-lg text-[1.0625rem] leading-relaxed text-ink-muted">
                {t('heroBody')}
              </p>

              {/*
                One primary action, in the brand colour. The two CTAs used to
                be an indigo fill and an outline, which read as two primaries
                in two different palettes.
              */}
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href="/track"
                  className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 text-[0.9375rem] font-semibold text-on-brand shadow-card transition-colors hover:bg-brand-hover"
                >
                  <Icon name="tracking" size={17} />
                  {t('trackCta')}
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex h-11 items-center gap-2 rounded-sm border border-line-strong bg-surface px-5 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-surface-sunken"
                >
                  {t('portalCta')}
                  <Icon name="arrow-end" size={16} />
                </Link>
              </div>

              {established ? (
                <p className="numeric mt-8 text-[0.75rem] text-ink-subtle">
                  {locale === 'ar' ? brand.identity.legalNameAr : brand.identity.legalNameEn} ·{' '}
                  {established}
                </p>
              ) : null}
            </div>

            {/* The tracking box, on the hero, because it is why people came. */}
            <Card className="shadow-raised lg:ms-auto lg:max-w-md">
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

      {/*
        The trade lanes, as a map.

        Deliberately **not** live data. This page is public, and plotting the
        lanes actually running would publish which customers ship what, from
        where, to a competitor with a browser. These are the corridors the
        business publishes on its own website — the same information as the
        "what we move" list below it, drawn instead of listed.
      */}
      <section className="border-b border-line bg-canvas">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="eyebrow mb-2">{t('lanesEyebrow')}</p>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
            {t('lanesTitle')}
          </h2>
          <p className="mt-2 max-w-2xl text-[0.9375rem] text-ink-muted">{t('lanesBody')}</p>

          <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface p-2">
            <LaneMap lanes={PUBLISHED_LANES} ports={PUBLISHED_PORTS} labelTop={6} />
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
