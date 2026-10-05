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

import type { Metadata } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listPortalShipments, portalShipmentCounts } from '@/features/portal/queries'
import { Pager } from '@/ui/pager'
import { pageRequest } from '@/lib/paging'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDay, formatNumber, formatRelative } from '@/lib/format'
import { Card } from '@/ui/card'
import { Button, EmptyState, Lane, PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge, jobTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { Meter } from '@/ui/chart'

/** The tab says which screen this is, as the sidebar does, in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('portal') }
}

export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const { page } = await searchParams
  const [shipmentsPage, counts] = await Promise.all([
    listPortalShipments(session.actor, locale, pageRequest(page)),
    portalShipmentCounts(session.actor),
  ])
  const shipments = shipmentsPage.rows

  const t = await getTranslations('portal')
  const tJob = await getTranslations('job')
  const tMode = await getTranslations('mode')
  const now = Date.now()

  // Counted over every shipment the customer may see, not over this page of them.
  const { active, arriving, documents } = counts

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="mb-5 grid grid-cols-1 gap-4 @xl:grid-cols-3">
        <StatTile label={t('active')} value={formatNumber(active, locale)} icon="jobs" />
        <StatTile label={t('arriving')} value={formatNumber(arriving, locale)} icon="calendar" />
        <StatTile label={t('documents')} value={formatNumber(documents, locale)} icon="document" />
      </div>

      {shipmentsPage.total === 0 ? (
        <Card>
          <EmptyState icon="ship" title={t('empty')} description={t('emptyHint')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {shipments.map((shipment) => {
            /*
              A late shipment says so. The ETA used to render the same way
              whether it was next week or last Tuesday, and a customer reading
              "3 days ago" under "ETA" had to work out for themselves that
              something had slipped.
            */
            const late =
              shipment.eta !== null &&
              shipment.eta.getTime() < now &&
              !['delivered', 'completed', 'closed', 'cancelled'].includes(shipment.status)
            /*
              Every card opens the shipment, signed in (QA P2-12). It used to
              open public `/track` with the customer reference as the second
              identifier, so a job without one had no link, and each click
              spent the anonymous lookup budget until the portal throttled its
              own customer.
            */
            const track = `/portal/shipments/${shipment.id}`
            return (
              <li key={shipment.id}>
                <Card className="transition-shadow hover:shadow-raised">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="ref numeric text-title font-semibold text-ink">
                          {shipment.reference}
                        </span>
                        <Badge tone={jobTone(shipment.status)} dot>
                          {tJob(`statuses.${shipment.status}` as 'statuses.booked')}
                        </Badge>
                      </div>
                      {/* `flex-wrap` and a shrinkable lane: on one unwrapping line a
                          long port name held the lane at its full width and
                          pushed the mode past the card's edge on a phone. */}
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-ink-muted">
                        <Icon
                          name={modeIcon(shipment.mode)}
                          size={16}
                          className="text-ink-subtle"
                        />
                        <Lane
                          className="min-w-0"
                          origin={shipment.originName}
                          destination={shipment.destinationName}
                        />
                        <span className="text-ink-subtle">· {tMode(shipment.mode)}</span>
                      </p>
                      {shipment.customerReference ? (
                        <p className="mt-1 text-caption text-ink-subtle">
                          {tJob('customerReference')}:{' '}
                          <span className="ref numeric">{shipment.customerReference}</span>
                        </p>
                      ) : null}
                    </div>

                    <div className="text-end">
                      <p className="eyebrow mb-1">{tJob('eta')}</p>
                      <p className="numeric text-title font-semibold text-ink">
                        {formatDay(shipment.eta, locale, timeZone)}
                      </p>
                      {late ? (
                        <Badge tone="caution" icon="clock" className="mt-1">
                          {t('etaPassed')}
                        </Badge>
                      ) : (
                        <p className="numeric text-micro text-ink-subtle">
                          {formatRelative(shipment.eta, locale, now)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 border-t border-line pt-3">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-caption text-ink-muted">
                        {shipment.nextMilestone ? (
                          <>
                            <span className="text-ink-subtle">{t('nextStep')}: </span>
                            <span className="font-medium text-ink">{shipment.nextMilestone}</span>
                          </>
                        ) : (
                          tJob('statuses.completed')
                        )}
                      </span>
                      {/* Words, not "4/7 · 5": the second number had no unit at all. */}
                      <span className="text-caption text-ink-subtle">
                        {t('progress', {
                          done: shipment.milestonesDone,
                          total: shipment.milestonesTotal,
                        })}
                        {shipment.documentsReleased > 0 ? (
                          <>
                            {' · '}
                            <Icon
                              name="document"
                              size={12}
                              className="inline align-[-1px] text-ink-subtle"
                            />{' '}
                            {t('documentCount', { count: shipment.documentsReleased })}
                          </>
                        ) : null}
                      </span>
                    </div>
                    <Meter
                      value={shipment.milestonesDone}
                      max={shipment.milestonesTotal}
                      tone="var(--qb-accent)"
                      label={t('progress', {
                        done: shipment.milestonesDone,
                        total: shipment.milestonesTotal,
                      })}
                    />
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button href={track} variant="ghost" size="sm" iconEnd="chevron-end">
                      {t('viewShipment')}
                    </Button>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      <Pager
        page={shipmentsPage}
        path="/portal"
        className="mt-3 rounded-card border border-line bg-surface"
      />
    </>
  )
}
