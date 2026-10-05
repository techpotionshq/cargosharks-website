/**
 * Vessel position — where the ship carrying this job was last heard on AIS.
 *
 * Drawn on the staff job file and on the customer's own shipment page, from
 * the same `JobVessel`. Its one rule is the one in `core/vessel-positions.ts`:
 * a fix is called current only while it is fresh. Older than six hours, or
 * absent, the card says when and where the ship was last heard and that it
 * may be outside receiver coverage. aisstream hears nothing in the Gulf, so on
 * the arrival leg into Kuwait or Dubai that sentence is the usual state, not
 * an error.
 *
 * The destination and ETA here are what the crew typed into the transponder.
 * They are labelled as reported by the vessel every time, because a customer
 * who reads "ETA 14 Oct" on this card beside our own ETA above will take the
 * wrong one as a promise.
 */

import { getTranslations } from 'next-intl/server'
import {
  vesselNamesDisagree,
  vesselNavStatusKey,
  vesselPositionFreshness,
  type VesselPositionFreshness,
} from '@qabandi/core'
import type { JobVessel } from '@qabandi/db'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { pickName } from '@/lib/named'
import { Card, CardHeader } from '@/ui/card'
import { Field } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { LaneMap } from '@/ui/lane-map'
import { VesselIdentityDialog, VesselSuggestionConfirm } from './vessel-dialogs'

export async function VesselPositionCard({
  vessel,
  locale,
  timeZone,
  canEdit = false,
  audience = 'external',
  now = Date.now(),
}: {
  readonly vessel: JobVessel
  readonly locale: 'en' | 'ar'
  readonly timeZone: string
  /** Staff with `job.update`: the identity dialog and the suggestion. */
  readonly canEdit?: boolean
  /**
   * Who is reading. Staff are told what is wrong and how to fix it; a
   * customer or an agent is never given a staff instruction or a doubtful
   * position (live run 6, N3 and N5). Defaults to the cautious side.
   */
  readonly audience?: 'staff' | 'external'
  readonly now?: number
}) {
  const t = await getTranslations('vesselPosition')
  const staff = audience === 'staff'
  /*
    The transponder names the ship its MMSI belongs to. When that name is
    plainly not the job's vessel, the MMSI was mistyped and the fix is another
    ship's: a customer was shown WILSON HIRTSHALS off Rotterdam as "Current"
    for a job on MAERSK SALALAH (live run 6). Outside staff it is not drawn at
    all; staff see it, marked, with the two names to compare.
  */
  const mismatch =
    vessel.mmsi !== null &&
    vessel.position !== null &&
    vesselNamesDisagree(vessel.vesselName, vessel.position.name)
  const withheld = mismatch && !staff
  const position = withheld ? null : vessel.position
  const freshness: VesselPositionFreshness = vesselPositionFreshness(
    position?.receivedAt ?? null,
    new Date(now),
  )
  const hasFix =
    position !== null &&
    position.latitude !== null &&
    position.longitude !== null &&
    position.receivedAt !== null
  const name = position?.name ?? vessel.vesselName ?? t('thisVessel')
  const place = position ? pickName(locale, position.nearNameEn, position.nearNameAr) : null
  const age = position?.receivedAt ? formatRelative(position.receivedAt, locale, now) : null
  const navKey = vesselNavStatusKey(position?.navStatus)

  return (
    // The attribute is for the e2e suite and the screenshots: it names the state drawn.
    <div data-vessel-position={freshness}>
      <Card>
        <CardHeader
          icon="ship"
          eyebrow={t('eyebrow')}
          title={t('title')}
          description={
            vessel.vesselName
              ? `${vessel.vesselName}${vessel.voyageNumber ? ` ${vessel.voyageNumber}` : ''}`
              : undefined
          }
          actions={
            canEdit ? (
              <VesselIdentityDialog jobId={vessel.jobId} imo={vessel.imo} mmsi={vessel.mmsi} />
            ) : undefined
          }
        />

        {hasFix && position ? (
          <div className="mt-4">
            <LaneMap
              compact
              lanes={[]}
              ports={[]}
              vessels={[
                {
                  id: position.mmsi,
                  name,
                  latitude: position.latitude!,
                  longitude: position.longitude!,
                  current: freshness === 'current' && !mismatch,
                  track: position.track.map((point) => [point.lon, point.lat] as const),
                },
              ]}
              label={t('mapLabel', { vessel: name })}
            />
          </div>
        ) : null}

        {/* --- when, and where -------------------------------------------- */}
        {hasFix && position?.receivedAt ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {mismatch ? (
              <Badge tone="critical" icon="alert">
                {t('nameMismatchBadge')}
              </Badge>
            ) : (
              <Badge tone={freshness === 'current' ? 'positive' : 'muted'} dot>
                {freshness === 'current' ? t('current') : t('lastKnown')}
              </Badge>
            )}
            <span className="text-body-sm text-ink">
              {place
                ? t('lastSeenNear', { age: age ?? '', place })
                : t('lastSeenAtSea', { age: age ?? '' })}
            </span>
            <span className="numeric text-caption text-ink-muted">
              {formatDateTime(position.receivedAt, locale, timeZone)}
            </span>
          </div>
        ) : null}

        {mismatch && staff && vessel.position ? (
          <p className="mt-3 flex items-start gap-2 rounded-sm bg-critical-soft px-3 py-2 text-body-sm text-critical">
            <Icon name="alert" size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              {t('nameMismatch', {
                mmsi: vessel.mmsi ?? '',
                ais: vessel.position.name ?? '',
                job: vessel.vesselName ?? '',
              })}
            </span>
          </p>
        ) : null}

        {withheld ? (
          <p className="mt-3 text-body-sm text-ink-muted">{t('noPositionShown')}</p>
        ) : null}

        {freshness !== 'current' && vessel.mmsi && !withheld ? (
          <p className="mt-3 flex items-start gap-2 rounded-sm bg-caution-soft px-3 py-2 text-body-sm text-caution">
            <Icon name="alert" size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              {t('noRecent')}
              {!hasFix ? <span className="mt-0.5 block text-ink">{t('noneYet')}</span> : null}
            </span>
          </p>
        ) : null}

        {/*
          "Add the vessel's MMSI" is an instruction only staff can follow; a
          customer was shown it in Arabic on the portal (live run 6, N5).
        */}
        {!vessel.mmsi ? (
          <p className="mt-3 text-body-sm text-ink-muted">
            {staff ? t('noIdentity') : t('noPositionShown')}
          </p>
        ) : null}

        {canEdit && vessel.suggestion ? (
          <div className="mt-3 rounded-sm border border-line bg-surface-sunken p-3">
            <p className="text-body-sm font-medium text-ink">{t('suggestionTitle')}</p>
            <p className="mt-1 text-body-sm text-ink">
              {t('suggestionBody', {
                name: vessel.suggestion.name ?? '—',
                mmsi: vessel.suggestion.mmsi,
              })}
            </p>
            <p
              className={[
                'mt-1 text-caption',
                vessel.suggestion.basis === 'name' ? 'text-caution' : 'text-ink-muted',
              ].join(' ')}
            >
              {vessel.suggestion.basis === 'imo' ? t('suggestionByImo') : t('suggestionByName')}
            </p>
            <div className="mt-2">
              <VesselSuggestionConfirm
                jobId={vessel.jobId}
                mmsi={vessel.suggestion.mmsi}
                imo={vessel.suggestion.imo ?? vessel.imo}
              />
            </div>
          </div>
        ) : null}

        {/* --- what the ship says ----------------------------------------- */}
        {hasFix && position ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 @xl:grid-cols-3">
            <Field label={t('speed')}>
              {position.speedKnots === null ? (
                '—'
              ) : (
                <bdi>{t('speedValue', { speed: formatNumber(position.speedKnots, locale) })}</bdi>
              )}
            </Field>
            <Field label={t('course')}>
              {position.courseDegrees === null ? (
                '—'
              ) : (
                <bdi>
                  {t('courseValue', {
                    course: formatNumber(Math.round(position.courseDegrees), locale),
                  })}
                </bdi>
              )}
            </Field>
            <Field label={t('status')}>
              {navKey ? t(`navStatus.${navKey}` as 'navStatus.moored') : '—'}
            </Field>
            <Field label={t('reportedDestination')} mono>
              {/* Free text from the transponder, in Latin capitals either way. */}
              <bdi>{position.reportedDestination ?? '—'}</bdi>
            </Field>
            <Field label={t('reportedEta')}>
              {position.reportedEta ? formatDateTime(position.reportedEta, locale, timeZone) : '—'}
            </Field>
          </dl>
        ) : null}
        {hasFix && position?.reportedEta ? (
          <p className="mt-2 text-caption text-ink-muted">{t('reportedHint')}</p>
        ) : null}

        {/* --- which ship, and who said so -------------------------------- */}
        {vessel.mmsi && !withheld ? (
          <p className="numeric mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-caption text-ink-muted">
            <bdi>{t('identity', { mmsi: vessel.mmsi })}</bdi>
            {(vessel.imo ?? position?.imo) ? (
              <bdi>{t('imoValue', { imo: (vessel.imo ?? position?.imo)! })}</bdi>
            ) : null}
            {position ? <bdi>{t('source', { source: position.source })}</bdi> : null}
          </p>
        ) : null}
      </Card>
    </div>
  )
}
