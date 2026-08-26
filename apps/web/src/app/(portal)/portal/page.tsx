/**
 * The customer portal — `FR-CP-03`, `FR-CP-04`, `FR-CP-08`.
 *
 * The same tables, the same queries, a different principal. A customer contact
 * sees their own jobs because the `customer_contact` arm of the RLS policy
 * matches their `app.customer_id`, not because this route filters anything.
 *
 * In the demo this follows the public tracking page and answers the obvious
 * question — *"same data, more of it, because they have an account"* (Pilot
 * §6). Which is why the layout is recognisably the tracking page with a list
 * in front of it, rather than a different design.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listPortalShipments } from '@/features/portal/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDay, formatNumber, formatRelative } from '@/lib/format'
import { Card } from '@/ui/card'
import { EmptyState, Lane, PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge, jobTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { Meter } from '@/ui/chart'

export default async function PortalHome() {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const shipments = await listPortalShipments(session.actor)

  const t = await getTranslations('portal')
  const tJob = await getTranslations('job')
  const tMode = await getTranslations('mode')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  const active = shipments.filter((s) => !['completed', 'closed', 'cancelled'].includes(s.status))
  const arriving = shipments.filter(
    (s) => s.eta !== null && s.eta.getTime() > now && s.eta.getTime() < now + 7 * 86_400_000,
  )
  const documents = shipments.reduce((sum, s) => sum + s.documentsReleased, 0)

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label={t('active')} value={formatNumber(active.length, locale)} icon="jobs" />
        <StatTile
          label={t('arriving')}
          value={formatNumber(arriving.length, locale)}
          icon="calendar"
        />
        <StatTile label={t('documents')} value={formatNumber(documents, locale)} icon="document" />
      </div>

      {shipments.length === 0 ? (
        <Card>
          <EmptyState icon="ship" title={t('empty')} description={t('emptyHint')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {shipments.map((shipment) => (
            <li key={shipment.id}>
              <Card className="transition-shadow hover:shadow-raised">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ref numeric text-[0.9375rem] font-semibold text-ink">
                        {shipment.reference}
                      </span>
                      <Badge tone={jobTone(shipment.status)} dot>
                        {tJob(`statuses.${shipment.status}` as 'statuses.booked')}
                      </Badge>
                    </div>
                    <p className="mt-1.5 flex items-center gap-2 text-[0.875rem] text-ink-muted">
                      <Icon name={modeIcon(shipment.mode)} size={16} className="text-ink-subtle" />
                      <Lane origin={shipment.originName} destination={shipment.destinationName} />
                      <span className="text-ink-subtle">· {tMode(shipment.mode)}</span>
                    </p>
                    {shipment.customerReference ? (
                      <p className="mt-1 text-[0.75rem] text-ink-subtle">
                        {tJob('customerReference')}:{' '}
                        <span className="ref numeric">{shipment.customerReference}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="text-end">
                    <p className="eyebrow mb-1">{tJob('eta')}</p>
                    <p className="numeric text-[0.9375rem] font-semibold text-ink">
                      {formatDay(shipment.eta, locale, timeZone)}
                    </p>
                    <p className="numeric text-[0.6875rem] text-ink-subtle">
                      {formatRelative(shipment.eta, locale, now)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 border-t border-line pt-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[0.75rem] text-ink-muted">
                      {shipment.nextMilestone ? (
                        <>
                          <span className="text-ink-subtle">{t('nextStep')}: </span>
                          <span className="font-medium text-ink">{shipment.nextMilestone}</span>
                        </>
                      ) : (
                        tJob('statuses.completed')
                      )}
                    </span>
                    <span className="numeric text-[0.75rem] text-ink-subtle">
                      {shipment.milestonesDone}/{shipment.milestonesTotal}
                      {shipment.documentsReleased > 0 ? (
                        <>
                          {' · '}
                          <Icon
                            name="document"
                            size={12}
                            className="inline align-[-1px] text-ink-subtle"
                          />{' '}
                          {shipment.documentsReleased}
                        </>
                      ) : null}
                    </span>
                  </div>
                  <Meter
                    value={shipment.milestonesDone}
                    max={shipment.milestonesTotal}
                    tone="var(--qb-brand)"
                    label={`${shipment.milestonesDone} / ${shipment.milestonesTotal}`}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
