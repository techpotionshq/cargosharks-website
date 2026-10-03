/**
 * One shipment, as a customer sees it — public tracking and the portal.
 *
 * Lifted out of the tracking page so the portal's signed-in view (QA P2-12)
 * draws exactly what public tracking draws: the same projection from
 * `trackShipment` / `trackOwnShipment`, the same timeline, the same
 * released-documents-only rule. Two copies of this would drift, and the place
 * they would drift first is which documents a customer is shown.
 */

import { getTranslations } from 'next-intl/server'
import type { TrackingResult } from '@/lib/pilot/types'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { pickName } from '@/lib/named'
import { Card, CardHeader } from '@/ui/card'
import { Field } from '@/ui/layout'
import { Badge, jobTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { MilestoneTimeline } from '@/ui/timeline'
import { Meter } from '@/ui/chart'
import { journey } from '../journey'

export async function ShipmentView({
  result,
  locale,
  timeZone,
  documentHref,
  documentsNote,
}: {
  readonly result: TrackingResult
  readonly locale: 'en' | 'ar'
  readonly timeZone: string
  /** Where a released document downloads from — only for a signed-in reader. */
  readonly documentHref?: (id: string) => string
  /** The line under the documents, e.g. "sign in to the portal to download". */
  readonly documentsNote?: string
}) {
  const [t, tJob, tMode] = await Promise.all([
    getTranslations('track'),
    getTranslations('job'),
    getTranslations('mode'),
  ])
  // An empty Arabic name falls back to English rather than rendering blank (F52).
  const nameOf = (en: string, ar: string | null) => pickName(locale, en, ar)
  const done = result.milestones.filter((m) => m.actualAt !== null).length
  const total = result.milestones.length
  // "Departed"/"Arrived" only on an actual date; a planned one says so (NEW-7).
  const { departure, arrival } = journey(result)

  return (
    <>
      {/* --- the answer, above everything else -------------------- */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow mb-1.5">{result.reference}</p>
            <h1 className="font-display text-headline font-semibold tracking-tight text-ink sm:text-display">
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
            <span className="text-body-sm font-medium text-ink">
              {t('progress', { done, total })}
            </span>
            <span className="numeric text-body-sm text-ink-muted">
              {arrival.actual ? t('arrived') : t('eta')}{' '}
              <span className="font-semibold text-ink">
                {formatDate(arrival.at, locale, timeZone)}
              </span>
            </span>
          </div>
          <Meter
            value={done}
            max={total}
            tone={arrival.actual ? 'var(--qb-positive)' : 'var(--qb-accent)'}
            label={t('progress', { done, total })}
          />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 @2xl:grid-cols-4">
          <Field label={tJob('status')}>
            <span className="inline-flex items-center gap-1.5">
              <Icon name={modeIcon(result.mode)} size={15} className="text-ink-muted" />
              {tMode(result.mode)}
            </span>
          </Field>
          <Field label={t('vessel')}>{result.vesselOrFlight ?? '—'}</Field>
          <Field label={departure.actual ? t('departed') : t('departureEstimated')}>
            {formatDate(departure.at, locale, timeZone)}
          </Field>
          <Field label={arrival.actual ? t('arrived') : t('eta')}>
            {formatDate(arrival.at, locale, timeZone)}
          </Field>
        </dl>

        {/* Customer-visible notices only — an internal exception is not
            something a consignee should read about here. */}
        {result.notices.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {result.notices.map((notice) => (
              <li
                key={notice.code}
                className="flex items-center gap-2 rounded-sm bg-caution-soft px-3 py-2 text-body-sm text-caution"
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

      <div className="mb-4 grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        {result.containers.length > 0 ? (
          <Card>
            <CardHeader icon="container" title={t('containers')} />
            <ul className="mt-4 flex flex-col gap-2">
              {result.containers.map((container) => (
                <li
                  key={container.containerNo}
                  className="flex items-center justify-between gap-3 rounded-sm bg-surface-sunken px-3 py-2"
                >
                  <span className="ref numeric text-body-sm font-medium text-ink">
                    {container.containerNo}
                  </span>
                  <span className="text-caption text-ink-muted">{container.type}</span>
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
            <p className="mt-4 text-body-sm text-ink-muted">{t('noDocuments')}</p>
          ) : (
            <>
              {/*
                Listed, and linked only where the reader is signed in.

                The public page is authenticated by a reference and a verifier rather
                than by a session, and the download route needs a session to decide what
                the caller may have. Carrying the verifier into a download URL would put
                the proof in a query string and into every log between here and storage —
                so public tracking says which documents are ready and sends the customer
                to the portal, where `documentHref` is given.
              */}
              <ul className="mt-4 flex flex-col gap-1">
                {result.documents.map((document) => {
                  const row = (
                    <>
                      <Icon name="document" size={16} className="shrink-0 text-ink-subtle" />
                      <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                        {nameOf(document.nameEn, document.nameAr)}
                      </span>
                      {document.sizeKb === null ? null : (
                        <span className="numeric shrink-0 text-micro text-ink-subtle">
                          {formatNumber(document.sizeKb, locale)} KB
                        </span>
                      )}
                      <Icon
                        name={documentHref ? 'download' : 'check'}
                        size={15}
                        className={`shrink-0 ${documentHref ? 'text-accent' : 'text-positive'}`}
                      />
                    </>
                  )
                  return (
                    <li key={document.id}>
                      {documentHref ? (
                        <a
                          href={documentHref(document.id)}
                          className="flex items-center gap-3 rounded-sm px-2 py-2 hover:bg-surface-sunken"
                        >
                          {row}
                        </a>
                      ) : (
                        <span className="flex items-center gap-3 rounded-sm px-2 py-2">{row}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
              {documentsNote ? (
                <p className="mt-3 border-t border-line pt-3 text-caption text-ink-subtle">
                  {documentsNote}
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </>
  )
}
