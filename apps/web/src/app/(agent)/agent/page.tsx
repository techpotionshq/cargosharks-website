/**
 * The agent and partner view — `FR-AG`.
 *
 * An agent contact sees a job only where their partner appears in
 * `job_partners`. That is one arm of one policy (§5.3), not a separate
 * application.
 *
 * It used to read nothing at all — every agent, including one whose agency
 * was named on live shipments, was told "Nothing assigned to you" — and
 * carried a hard-coded English "Release One" badge and the person's English
 * name on the Arabic page (A9, U1). It now lists the shipments the policy
 * admits, in the reader's language, and each card opens that shipment's
 * read-only page (`agent/shipments/[id]`). Responding to rate requests from
 * here is still out of the pilot (Pilot §3.2): those arrive and are answered
 * by email.
 */

import type { Metadata, Route } from 'next'
import Link from 'next/link'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listAgentShipments } from '@/features/network/queries'
import { Pager } from '@/ui/pager'
import { pageRequest } from '@/lib/paging'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { pickName } from '@/lib/named'
import { formatDay, formatRelative } from '@/lib/format'
import { Card } from '@/ui/card'
import { EmptyState, Lane, PageHeader } from '@/ui/layout'
import { Badge, jobTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { Meter } from '@/ui/chart'

/** The tab says which screen this is, as the sidebar does, in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('agent') }
}

export default async function AgentHome({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const session = await requireSession()
  const timeZone = await getTimeZone()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const { page } = await searchParams
  const [shipmentsPage, t, tJob, tMode, tPortal] = await Promise.all([
    listAgentShipments(session.actor, locale, pageRequest(page)),
    getTranslations('agent'),
    getTranslations('job'),
    getTranslations('mode'),
    getTranslations('portal'),
  ])
  const now = Date.now()
  const shipments = shipmentsPage.rows

  return (
    /* The shell owns the page frame now — `(agent)/layout.tsx`. */
    <>
      <PageHeader
        eyebrow={pickName(locale, session.principal.nameEn, session.principal.nameAr)}
        title={t('title')}
        description={t('subtitle')}
      />

      {shipmentsPage.total === 0 ? (
        <Card>
          <EmptyState icon="partners" title={t('empty')} description={t('emptyHint')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {shipments.map((shipment) => (
            <li key={shipment.id}>
              {/*
                The whole card opens the shipment. The reference is the link,
                so a screen reader hears one named link per card rather than a
                card-sized one reading out every figure; its `after` box
                stretches over the card so a tap anywhere lands on it.
              */}
              <Card className="relative transition-colors focus-within:border-accent/50 hover:border-accent/40">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/agent/shipments/${shipment.id}` as Route}
                        className="ref numeric text-title font-semibold text-ink outline-none after:absolute after:inset-0 after:rounded-card hover:text-accent focus-visible:after:outline-2 focus-visible:after:outline-focus"
                      >
                        {shipment.reference}
                      </Link>
                      <Badge tone={jobTone(shipment.status)} dot>
                        {tJob(`statuses.${shipment.status}` as 'statuses.booked')}
                      </Badge>
                    </div>
                    <p className="mt-1.5 flex items-center gap-2 text-body text-ink-muted">
                      <Icon name={modeIcon(shipment.mode)} size={16} className="text-ink-subtle" />
                      <Lane origin={shipment.originName} destination={shipment.destinationName} />
                      <span className="text-ink-subtle">· {tMode(shipment.mode)}</span>
                    </p>
                  </div>

                  <div className="text-end">
                    <p className="eyebrow mb-1">{tJob('eta')}</p>
                    <p className="numeric text-title font-semibold text-ink">
                      {formatDay(shipment.eta, locale, timeZone)}
                    </p>
                    <p className="numeric text-micro text-ink-subtle">
                      {formatRelative(shipment.eta, locale, now)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 border-t border-line pt-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-caption text-ink-muted">
                      {shipment.nextMilestone ? (
                        <>
                          <span className="text-ink-subtle">{tPortal('nextStep')}: </span>
                          <span className="font-medium text-ink">{shipment.nextMilestone}</span>
                        </>
                      ) : (
                        tJob('statuses.completed')
                      )}
                    </span>
                    <span className="numeric text-caption text-ink-subtle">
                      {shipment.milestonesDone}/{shipment.milestonesTotal}
                    </span>
                  </div>
                  <Meter
                    value={shipment.milestonesDone}
                    max={shipment.milestonesTotal}
                    tone="var(--qb-accent)"
                    label={`${shipment.milestonesDone} / ${shipment.milestonesTotal}`}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pager
        page={shipmentsPage}
        path="/agent"
        className="mt-3 rounded-card border border-line bg-surface"
      />
    </>
  )
}
