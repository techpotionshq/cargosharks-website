/**
 * Proof of delivery, as it appears on the job file and in the portal.
 *
 * The card is deliberately evidential rather than decorative. What a claim
 * turns on is the name, the instant, and whether an exception was noted — so
 * those are the three things above the fold, and the photographs are below
 * them.
 *
 * A superseded record is shown, greyed, with the correction linked. Hiding it
 * would make a corrected delivery indistinguishable from one that was right
 * the first time, which is precisely the distinction somebody will be asking
 * about.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { EmptyState, Field } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { PodCaptureDialog } from './dialogs'
import type { PodRow } from '../queries'

export async function ProofOfDeliveryCard({
  jobId,
  records,
  equipment,
  className,
}: {
  readonly jobId: string
  readonly records: readonly PodRow[]
  readonly equipment: readonly { value: string; label: string }[]
  readonly className?: string
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const [t, locale] = await Promise.all([getTranslations('pod'), getLocale()])
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE
  const mayCapture = can(session, 'job.update')

  return (
    <Card className={className}>
      <CardHeader
        icon="check"
        eyebrow={t('eyebrow')}
        title={t('title')}
        actions={
          mayCapture ? (
            <PodCaptureDialog jobId={jobId} equipment={equipment} variant="secondary" />
          ) : undefined
        }
      />

      {records.length === 0 ? (
        /*
          Inline, not centred, and the reason is the span this card is given.

          It runs the full twelve columns, and the centred empty state is sized
          for a page with nothing on it: a glyph, a heading and a paragraph
          floating in a band of air the width of the board, a long way from the
          title it answers. One quiet line under the header says the same thing
          and leaves the card the height of what it actually contains.
        */
        <EmptyState
          className="mt-3"
          variant="inline"
          icon="truck"
          title={t('none')}
          description={t('noneHint')}
        />
      ) : (
        <ul className="mt-4 space-y-4">
          {records.map((pod) => {
            const superseded = pod.supersededById !== null
            return (
              <li
                key={pod.id}
                className={['rounded-sm border border-line p-4', superseded ? 'opacity-60' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={pod.hasException ? 'critical' : 'positive'}>
                    {t(pod.hasException ? 'withException' : 'clean')}
                  </Badge>
                  {superseded ? <Badge tone="muted">{t('superseded')}</Badge> : null}
                  {pod.containerNo ? (
                    <span className="ref text-[0.75rem] text-ink-muted">{pod.containerNo}</span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-6">
                  <Field label={t('receivedByName')}>{pod.receivedByName}</Field>
                  {pod.receivedByIdNumber ? (
                    <Field label={t('receivedByIdNumber')} mono>
                      {pod.receivedByIdNumber}
                    </Field>
                  ) : null}
                  <Field label={t('deliveredAt')}>
                    {formatDateTime(pod.deliveredAt, lang, timeZone)}
                  </Field>
                  {pod.capturedByEn ? (
                    <Field label={t('capturedBy')}>
                      {lang === 'ar' ? (pod.capturedByAr ?? pod.capturedByEn) : pod.capturedByEn}
                    </Field>
                  ) : null}
                </div>

                {pod.hasException && pod.exceptionNotes ? (
                  <p className="mt-3 rounded-sm border border-critical/40 bg-critical/5 p-2.5 text-[0.8125rem] text-critical">
                    {pod.exceptionNotes}
                  </p>
                ) : null}

                {pod.notes ? (
                  <p className="mt-2 text-[0.8125rem] text-ink-muted">{pod.notes}</p>
                ) : null}

                {/*
                  The coordinates are text and a map link, not an embedded map.
                  An iframe to a tile provider on a page that renders customer
                  data is a third party watching the operations board, and the
                  question here is only ever "was this near the consignee".
                */}
                {pod.latitude && pod.longitude ? (
                  <p className="mt-2 text-[0.75rem] text-ink-subtle">
                    <a
                      className="underline underline-offset-2 hover:text-ink"
                      href={`https://www.openstreetmap.org/?mlat=${pod.latitude}&mlon=${pod.longitude}#map=17/${pod.latitude}/${pod.longitude}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {pod.latitude}, {pod.longitude}
                    </a>
                    {pod.accuracyMetres ? ` · ±${Math.round(Number(pod.accuracyMetres))} m` : ''}
                  </p>
                ) : null}

                {(pod.signatureAssetId || pod.photos.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pod.signatureAssetId ? (
                      <Attachment
                        assetId={pod.signatureAssetId}
                        label={t('signature')}
                        tone="signature"
                      />
                    ) : null}
                    {pod.photos.map((photo, index) => (
                      <Attachment
                        key={photo.id}
                        assetId={photo.assetId}
                        label={photo.caption ?? t('photoN', { n: index + 1 })}
                      />
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/**
 * A link to a stored file, never an inline `<img>`.
 *
 * The bytes live behind a signed URL that expires, so an image tag would go
 * blank on a page left open — and rendering a dozen phone photographs inline
 * on the job screen is megabytes nobody asked for. The link goes through
 * `/api/documents/[id]`, which resolves the asset under the viewer's own actor
 * and signs a short-lived URL.
 */
function Attachment({
  assetId,
  label,
  tone = 'photo',
}: {
  readonly assetId: string
  readonly label: string
  readonly tone?: 'photo' | 'signature'
}) {
  return (
    <a
      href={`/api/assets/${assetId}`}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[0.75rem] font-medium text-ink transition-colors hover:bg-surface-sunken"
    >
      <span aria-hidden>{tone === 'signature' ? '✎' : '▣'}</span>
      {label}
    </a>
  )
}
