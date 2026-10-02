/**
 * Public tracking — `FR-CP-05`. **Moment 1.**
 *
 * *"Open it on a phone. Type a real job reference. A live shipment appears.
 * Switch to Arabic. Hand the phone to the person across the table."*
 *
 * This is the only screen in the product that requires zero explanation, and
 * the design brief follows from that: one input group, one button, and then a
 * status and a timeline that answer "where is my container" before anyone has
 * to read a label. It kills `PP-02` — today there is no tracking at all, and
 * every status update is a phone call answered by someone who first has to go
 * and find out.
 *
 * The form is a GET, so a result is a URL: a customer can bookmark it, and an
 * operator can send it. That also means no JavaScript is involved in the most
 * important twenty seconds of the demo.
 *
 * A wrong pair returns the same "not found" as a non-existent reference. The
 * page must not confirm that a reference exists to someone who cannot also
 * name something on the shipment.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { trackShipment } from '@/features/tracking/queries'
import { ShipmentView } from '@/features/tracking/ui/shipment-view'
import { clientAddressFrom } from '@/lib/client-address'
import { recordTrackingLookup, recordTrackingMiss } from '@/lib/throttle'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { getBrand } from '@/lib/brand'
import { Card } from '@/ui/card'
import { Button, EmptyState } from '@/ui/layout'
import { Icon } from '@/ui/icon'
import { FOCUS_RING } from '@/ui/control'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('track')
  return { title: t('title') }
}

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; verifier?: string }>
}) {
  const timeZone = await getTimeZone()

  const params = await searchParams
  const reference = params.reference?.trim() ?? ''
  const verifier = params.verifier?.trim() ?? ''
  const submitted = reference !== '' && verifier !== ''

  /*
    The rate limit the query's docstring promised — A10, `lib/throttle.ts`.

    Spent before the lookup, so a refused walk costs us nothing. Keys are
    normalised the way the query normalises them, or `abc 123` and `ABC123`
    would be two budgets for one container. A refusal says so plainly: it
    describes the caller's rate, not whether any reference exists.
  */
  const key = (value: string) => value.toUpperCase().replace(/\s+/g, '')
  const verdict = submitted
    ? recordTrackingLookup(clientAddressFrom(await headers()), key(reference), key(verifier))
    : null
  const throttled = verdict !== null && !verdict.allowed

  const result = submitted && !throttled ? await trackShipment(reference, verifier) : undefined
  if (submitted && !throttled && !result) recordTrackingMiss(key(reference), key(verifier))

  const t = await getTranslations('track')
  const tc = await getTranslations('common')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      {!result ? (
        <header className="mb-8 text-center">
          <span className="mb-4 inline-flex size-12 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="tracking" size={24} />
          </span>
          <h1 className="font-display text-display font-semibold tracking-tight text-ink sm:text-display-lg">
            {t('title')}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-title text-ink-muted">{t('subtitle')}</p>
        </header>
      ) : null}

      {/* --- the lookup ------------------------------------------------- */}
      <Card className="mb-6">
        <form method="get" action="/track" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('reference')}</span>
              <input
                name="reference"
                required
                defaultValue={reference}
                placeholder={t('referencePlaceholder')}
                autoComplete="off"
                // References are Latin identifiers in both languages; forcing
                // LTR stops the caret jumping around in an Arabic interface.
                dir="ltr"
                className={`ref numeric h-11 rounded-sm border border-line-strong bg-surface-sunken px-3 text-title text-ink placeholder:text-ink-subtle focus:bg-surface ${FOCUS_RING}`}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('verifier')}</span>
              <input
                name="verifier"
                required
                defaultValue={verifier}
                placeholder={t('verifierPlaceholder')}
                autoComplete="off"
                dir="ltr"
                className={`ref numeric h-11 rounded-sm border border-line-strong bg-surface-sunken px-3 text-title text-ink placeholder:text-ink-subtle focus:bg-surface ${FOCUS_RING}`}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-caption text-ink-subtle">{t('verifierHint')}</p>
            <Button type="submit" variant="primary" size="lg" iconEnd="arrow-end">
              {t('submit')}
            </Button>
          </div>
        </form>
      </Card>

      {throttled ? (
        <Card>
          <EmptyState
            icon="clock"
            title={t('throttled')}
            description={t('throttledHint', { minutes: verdict.minutesRemaining })}
          />
        </Card>
      ) : submitted && !result ? (
        <Card>
          <EmptyState icon="search" title={t('notFound')} description={t('notFoundHint')} />
        </Card>
      ) : null}

      {result ? (
        <>
          <ShipmentView
            result={result}
            locale={locale}
            timeZone={timeZone}
            documentsNote={t('documentsPortalHint')}
          />

          <Card tone="brand">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-title font-semibold text-ink">{t('helpTitle')}</p>
                <p className="mt-1 text-body-sm text-ink-muted">
                  {t.rich('helpBody', {
                    phone: () => (
                      <a
                        href={`tel:${brand.contact.supportPhone.replace(/\s/g, '')}`}
                        className="numeric font-medium text-accent hover:underline"
                        dir="ltr"
                      >
                        {brand.contact.supportPhone}
                      </a>
                    ),
                    email: () => (
                      <a
                        href={`mailto:${brand.contact.supportEmail}`}
                        className="font-medium text-accent hover:underline"
                      >
                        <bdi>{brand.contact.supportEmail}</bdi>
                      </a>
                    ),
                  })}
                </p>
              </div>
              <Button href="/track" icon="search">
                {t('another')}
              </Button>
            </div>
          </Card>
        </>
      ) : null}

      {!submitted ? (
        <p className="mt-6 text-center text-caption text-ink-subtle">
          {tc('search')} · {brand.contact.trackingUrl.replace('https://', '')}
        </p>
      ) : null}
    </div>
  )
}
