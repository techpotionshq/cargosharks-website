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
import { clientAddressFrom } from '@/lib/client-address'
import { recordTrackingLookup, recordTrackingMiss } from '@/lib/throttle'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { getBrand } from '@/lib/brand'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Button, EmptyState, Field } from '@/ui/layout'
import { Badge, jobTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { MilestoneTimeline } from '@/ui/timeline'
import { Meter } from '@/ui/chart'
import { pickName } from '@/lib/named'
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
  const tJob = await getTranslations('job')
  const tMode = await getTranslations('mode')
  const tc = await getTranslations('common')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  // An empty Arabic name falls back to English rather than rendering blank (F52).
  const nameOf = (en: string, ar: string | null) => pickName(locale, en, ar)

  const done = result?.milestones.filter((m) => m.actualAt !== null).length ?? 0
  const total = result?.milestones.length ?? 0

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      {!result ? (
        <header className="mb-8 text-center">
          <span className="mb-4 inline-flex size-12 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="tracking" size={24} />
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {t('title')}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-[0.9375rem] text-ink-muted">{t('subtitle')}</p>
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
                className={`ref numeric h-11 rounded-sm border border-line-strong bg-surface-sunken px-3 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:bg-surface ${FOCUS_RING}`}
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
                className={`ref numeric h-11 rounded-sm border border-line-strong bg-surface-sunken px-3 text-[0.9375rem] text-ink placeholder:text-ink-subtle focus:bg-surface ${FOCUS_RING}`}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.75rem] text-ink-subtle">{t('verifierHint')}</p>
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
          {/* --- the answer, above everything else -------------------- */}
          <Card className="mb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="eyebrow mb-1.5">{result.reference}</p>
                <h1 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                  {nameOf(result.originName, result.originNameAr)}
                  <Icon
                    name="arrow-end"
                    size={20}
                    className="mx-2 inline align-[-3px] text-ink-subtle"
                  />
                  {nameOf(result.destinationName, result.destinationNameAr)}
                </h1>
              </div>
              <Badge tone={jobTone(result.status)} dot className="shrink-0">
                {tJob(`statuses.${result.status}` as 'statuses.booked')}
              </Badge>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-[0.8125rem] font-medium text-ink">
                  {t('progress', { done, total })}
                </span>
                <span className="numeric text-[0.8125rem] text-ink-muted">
                  {result.ata ? t('arrived') : t('eta')}{' '}
                  <span className="font-semibold text-ink">
                    {formatDate(result.ata ?? result.eta, locale, timeZone)}
                  </span>
                </span>
              </div>
              <Meter
                value={done}
                max={total}
                tone={result.ata ? 'var(--qb-positive)' : 'var(--qb-accent)'}
                label={t('progress', { done, total })}
              />
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
              <Field label={tJob('status')}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name={modeIcon(result.mode)} size={15} className="text-ink-muted" />
                  {tMode(result.mode)}
                </span>
              </Field>
              <Field label={t('vessel')}>{result.vesselOrFlight ?? '—'}</Field>
              <Field label={t('departed')}>{formatDate(result.etd, locale, timeZone)}</Field>
              <Field label={result.ata ? t('arrived') : t('eta')}>
                {formatDate(result.ata ?? result.eta, locale, timeZone)}
              </Field>
            </dl>

            {/* Customer-visible notices only — an internal exception is not
                something a consignee should read about here. */}
            {result.notices.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-2">
                {result.notices.map((notice) => (
                  <li
                    key={notice.code}
                    className="flex items-center gap-2 rounded-sm bg-caution-soft px-3 py-2 text-[0.8125rem] text-caution"
                  >
                    <Icon name="alert" size={15} strokeWidth={2} />
                    <span className="font-medium">{nameOf(notice.nameEn, notice.nameAr)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          {/* --- the journey ------------------------------------------ */}
          <Card className="mb-4">
            <CardHeader icon="tracking" title={tJob('milestones')} />
            <div className="mt-5">
              <MilestoneTimeline
                milestones={result.milestones.map((m) => ({
                  code: m.code,
                  name: nameOf(m.nameEn, m.nameAr),
                  plannedAt: m.plannedAt,
                  revisedAt: m.revisedAt,
                  actualAt: m.actualAt,
                }))}
                formatDate={(date) => formatDateTime(date, locale, timeZone)}
                labels={{
                  planned: t('milestoneStates.planned'),
                  revised: t('milestoneStates.revised'),
                  completed: t('milestoneStates.completed'),
                  next: t('milestoneStates.next'),
                  pending: t('milestoneStates.pending'),
                }}
              />
            </div>
          </Card>

          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {result.containers.length > 0 ? (
              <Card>
                <CardHeader icon="container" title={t('containers')} />
                <ul className="mt-4 flex flex-col gap-2">
                  {result.containers.map((container) => (
                    <li
                      key={container.containerNo}
                      className="flex items-center justify-between gap-3 rounded-sm bg-surface-sunken px-3 py-2"
                    >
                      <span className="ref numeric text-[0.8125rem] font-medium text-ink">
                        {container.containerNo}
                      </span>
                      <span className="text-[0.75rem] text-ink-muted">{container.type}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {/* Released documents only — this is what makes the page feel
                like a system of record rather than a status widget. */}
            <Card>
              <CardHeader icon="document" title={t('documents')} />
              {result.documents.length === 0 ? (
                <p className="mt-4 text-[0.8125rem] text-ink-muted">{t('noDocuments')}</p>
              ) : (
                <>
                  {/*
                    Listed, not linked.

                    This page is authenticated by a reference and a verifier
                    rather than by a session, and the download route needs a
                    session to decide what the caller may have. Carrying the
                    verifier into a download URL would put the proof in a query
                    string and into every log between here and storage — so the
                    page says which documents are ready and sends the customer
                    to the portal, where they are signed in.
                  */}
                  <ul className="mt-4 flex flex-col gap-1">
                    {result.documents.map((document) => (
                      <li
                        key={document.id}
                        className="flex items-center gap-3 rounded-sm px-2 py-2"
                      >
                        <Icon name="document" size={16} className="shrink-0 text-ink-subtle" />
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">
                          {nameOf(document.nameEn, document.nameAr)}
                        </span>
                        <span className="numeric shrink-0 text-[0.6875rem] text-ink-subtle">
                          {formatNumber(document.sizeKb, locale)} KB
                        </span>
                        <Icon name="check" size={15} className="shrink-0 text-positive" />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 border-t border-line pt-3 text-[0.75rem] text-ink-subtle">
                    {t('documentsPortalHint')}
                  </p>
                </>
              )}
            </Card>
          </div>

          <Card tone="brand">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[0.9375rem] font-semibold text-ink">{t('helpTitle')}</p>
                <p className="mt-1 text-[0.8125rem] text-ink-muted">
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
                        {brand.contact.supportEmail}
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
        <p className="mt-6 text-center text-[0.75rem] text-ink-subtle">
          {tc('search')} · {brand.contact.trackingUrl.replace('https://', '')}
        </p>
      ) : null}
    </div>
  )
}
