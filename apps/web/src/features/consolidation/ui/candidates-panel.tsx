/**
 * Shipments that should have shared a container — the suggestion, before the
 * consolidation exists.
 *
 * The rest of this screen is about masters that have been created. This is
 * about the ones that were not: loose LCL and air bookings sharing a lane and
 * a sailing window, which somebody would have grouped if they had happened to
 * notice.
 *
 * ## Each row leads with the container, because that is the saving
 *
 * *"Three shipments, 34 CBM — a 20GP at 92%"* is a decision. The same three
 * shipments listed with their volumes is a research task. The fit is computed
 * in `core/grouping.ts` against usable capacity rather than internal volume,
 * so a row saying 92% means something a loading crew would recognise.
 *
 * ## What limits the fit is named, not left to be inferred
 *
 * Weight binds before volume on anything dense — three pallets of tiles fill a
 * 20' by payload at a third of its cubic capacity. A screen that showed only
 * "92%" would let a coordinator add a fourth shipment to a container that is
 * already at its road limit.
 *
 * ## The customers are counted
 *
 * A cluster of one customer's three bookings is a different conversation from
 * three customers': the first is a routing change nobody needs to be asked
 * about, the second commits three parties to each other's timing.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatNumber } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Badge } from '@/ui/status'
import { consolidationCandidates } from '../candidates'
import { FormClusterButton } from './form-cluster-button'
import { Lane } from '@/ui/layout'

export async function CandidatesPanel() {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const locale = await getLocale()
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE
  const [clusters, t] = await Promise.all([
    consolidationCandidates(session.actor, undefined, lang),
    getTranslations('grouping'),
  ])

  // Nothing to group is the ordinary state of a tidy week. No empty card.
  if (clusters.length === 0) return null
  const mayForm = can(session, 'consol.write')

  return (
    <Card className="mb-4" padding="none">
      <CardHeader
        className="p-4 pb-3"
        title={t('title')}
        description={t('description', { count: clusters.length })}
      />
      <ul className="divide-y divide-line">
        {clusters.map((cluster) => (
          <li key={cluster.key} className="flex flex-wrap items-start gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.9375rem] font-semibold text-ink">
                  {/* The drawn arrow mirrors; a typed U+2192 points back at the
                      origin in Arabic. */}
                  <Lane
                    origin={cluster.originName ?? '—'}
                    destination={cluster.destinationName ?? '—'}
                  />
                </span>
                <Badge tone="muted">{t(`modes.${cluster.mode}`)}</Badge>
                {cluster.fit ? (
                  <Badge tone={cluster.fit.volumePercent >= 70 ? 'positive' : 'muted'}>
                    {t('fit', {
                      code: cluster.fit.code,
                      percent: Math.max(cluster.fit.volumePercent, cluster.fit.weightPercent),
                    })}
                  </Badge>
                ) : (
                  <Badge tone="caution">{t('overflows')}</Badge>
                )}
                {cluster.fit ? (
                  <span className="text-[0.75rem] text-ink-subtle">
                    {t(`limitedBy.${cluster.fit.limitedBy}`)}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-[0.8125rem] text-ink-muted">
                {t('summary', {
                  shipments: cluster.shipments.length,
                  customers: cluster.customerCount,
                  cbm: formatNumber(cluster.totalCbm, lang),
                  kg: formatNumber(cluster.totalKg, lang),
                })}
                {cluster.earliest ? (
                  <>
                    {' · '}
                    {formatDate(cluster.earliest, lang, timeZone)}
                    {cluster.latest && cluster.latest.getTime() !== cluster.earliest.getTime()
                      ? ` – ${formatDate(cluster.latest, lang, timeZone)}`
                      : ''}
                  </>
                ) : (
                  <>
                    {' · '}
                    {t('undated')}
                  </>
                )}
              </p>

              <p className="mt-1 text-[0.75rem] text-ink-subtle" dir="auto">
                {cluster.shipments
                  .map((s) => `${s.reference}${s.customerName ? ` (${s.customerName})` : ''}`)
                  .join(' · ')}
              </p>
            </div>

            {mayForm ? (
              <FormClusterButton
                branchId={cluster.branchId}
                mode={cluster.mode}
                originId={cluster.originId}
                destinationId={cluster.destinationId}
                jobIds={cluster.shipments.map((s) => s.jobId)}
                label={t('form')}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}
