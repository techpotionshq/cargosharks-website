/**
 * The operations board — `FR-JB-14`, Moment 3b.
 *
 * Live shipments with filters, and exceptions surfaced rather than buried. The
 * board's job is to make the thing that needs attention findable in one glance
 * on a screen carrying forty rows, which is why the exception count and the
 * customs status are columns rather than something you open a job to discover.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listJobs, listRunningClocks } from '@/features/jobs/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDay, formatMoney, formatNumber, formatRelative } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Button, EmptyState, Lane, PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge, customsTone, jobTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { MilestoneDots } from '@/ui/timeline'
import { Meter } from '@/ui/chart'
import { StandIn, TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { JobDialog } from '@/features/jobs/ui/dialogs'
import { pickName } from '@/lib/named'
import { formatByCurrency, sumByCurrency } from '@/lib/by-currency'

type Filter = 'live' | 'exceptions' | 'arriving' | 'all'

const FILTERS: readonly {
  key: Filter
  label: 'filterLive' | 'filterExceptions' | 'filterArriving' | 'filterAll'
}[] = [
  { key: 'live', label: 'filterLive' },
  { key: 'exceptions', label: 'filterExceptions' },
  { key: 'arriving', label: 'filterArriving' },
  { key: 'all', label: 'filterAll' },
]

/** The tab says which screen this is, as the sidebar does, in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('jobs') }
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; status?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const params = await searchParams
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? 'live') as Filter

  const t = await getTranslations('job')
  const tc = await getTranslations('common')
  const tDash = await getTranslations('dashboard')
  const tMode = await getTranslations('mode')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  const [rows, clocks] = await Promise.all([
    listJobs(session.actor, {
      status: params.status ?? (filter === 'all' ? undefined : 'live'),
      exceptionsOnly: filter === 'exceptions',
      limit: 100,
      locale,
    }),
    listRunningClocks(session.actor),
  ])

  const arriving = rows.filter(
    (r) => r.eta !== null && r.eta.getTime() > now && r.eta.getTime() < now + 7 * 86_400_000,
  )
  const visible = filter === 'arriving' ? arriving : rows
  const held = rows.filter((r) => r.customsStatus === 'held' || r.status === 'on_hold').length
  /*
    Per currency, never one sum (O15). The clocks are each in their own
    currency, and adding a USD per-diem to a KWD one and printing "KWD" was
    the same mistake the finance summaries made.
  */
  const accruingByCurrency = sumByCurrency(
    clocks.map((clock) => ({
      currency: clock.accrued.currency,
      amount: String(clock.accrued.amount),
    })),
  )
  const accruing = accruingByCurrency.length > 0

  return (
    <>
      <PageHeader
        eyebrow={tDash('operationsEyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button href="/dashboard" icon="dashboard">
              {tDash('title')}
            </Button>
            <JobDialog />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <StatTile label={t('filterLive')} value={formatNumber(rows.length, locale)} icon="jobs" />
        <StatTile
          label={t('filterArriving')}
          value={formatNumber(arriving.length, locale)}
          icon="calendar"
          href="/jobs?filter=arriving"
        />
        <StatTile
          label={t('customs')}
          value={formatNumber(held, locale)}
          hint={t('customsStatuses.held')}
          icon="hold"
          tone={held > 0 ? 'critical' : 'positive'}
          href="/jobs?filter=exceptions"
        />
        <StatTile
          label={tDash('accruing')}
          value={formatByCurrency(accruingByCurrency, locale)}
          icon="clock"
          tone={accruing ? 'caution' : 'muted'}
          live={accruing}
        />
      </div>

      {/*
        The free-time panel — Pilot §3.1 item 12, "the single most persuasive
        detail in the whole demo". It sits above the board rather than inside a
        job, because the point is that nobody had to go looking for it.
      */}
      {clocks.length > 0 ? (
        <Card className="mb-4" tone="critical">
          <CardHeader
            icon="clock"
            eyebrow={t('clocks')}
            title={t('clocksHint')}
            actions={
              <Badge tone="caution" icon="dot">
                {formatByCurrency(accruingByCurrency, locale)}
              </Badge>
            }
          />
          <ul className="mt-4 flex flex-col gap-3">
            {clocks.map((clock) => (
              <li
                key={clock.id}
                className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-sm bg-surface-sunken p-3"
              >
                {/* A floor for the details, so on a phone the amount wraps
                    beneath them instead of squeezing the reference onto two
                    lines. */}
                <div className="min-w-[min(100%,16rem)] flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`/jobs/${clock.jobId}`}
                      className="ref numeric text-body-sm font-medium text-ink hover:text-accent hover:underline"
                    >
                      {clock.jobReference}
                    </Link>
                    <span className="ref numeric text-caption text-ink-muted">
                      {clock.containerNo}
                    </span>
                    <Badge tone="critical">
                      {t(`clockKinds.${clock.kind}` as 'clockKinds.demurrage')}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-caption text-ink-muted">
                    {t('freeDays', { days: clock.freeDays })} ·{' '}
                    <span className="font-medium text-critical">
                      {t('chargeableDays', { days: clock.chargeableDays })}
                    </span>{' '}
                    · {t('perDiem', { amount: formatMoney(clock.perDiem, locale) })}
                  </p>
                  <Meter
                    className="mt-2 max-w-md"
                    value={clock.elapsedDays}
                    max={Math.max(clock.elapsedDays, clock.freeDays)}
                    tone="var(--qb-critical)"
                    label={`${clock.elapsedDays} / ${clock.freeDays}`}
                  />
                </div>

                <div className="text-end">
                  <p className="numeric accruing font-display text-headline leading-none font-semibold text-critical">
                    {formatMoney(clock.accrued, locale)}
                  </p>
                  {clock.chargeLineWritten ? (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-micro font-medium text-positive">
                      <Icon name="check" size={12} strokeWidth={2.5} />
                      {t('chargeLineWritten')}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card padding="none">
        <div className="flex flex-wrap items-center gap-1 border-b border-line p-3">
          {FILTERS.map((option) => {
            const active = option.key === filter
            return (
              <Link
                key={option.key}
                href={option.key === 'live' ? '/jobs' : `/jobs?filter=${option.key}`}
                aria-current={active ? 'page' : undefined}
                // The register filters' tint (`ui/register.tsx`), 40px on a phone.
                className={`inline-flex h-8 items-center rounded-sm px-3 text-body-sm font-medium transition-colors max-md:h-10 ${
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                {t(option.label)}
              </Link>
            )
          })}
          <span className="ms-auto text-caption text-ink-subtle">
            {tc('showing', { count: visible.length })}
          </span>
        </div>

        {visible.length === 0 ? (
          <EmptyState icon="ship" title={t('empty')} description={t('emptyHint')} />
        ) : (
          <TableShell>
            <THead>
              <TR>
                <TH>{t('reference')}</TH>
                <TH priority="low">{t('customer')}</TH>
                <TH priority="low">{t('route')}</TH>
                <TH priority="lowest">{t('vessel')}</TH>
                <TH priority="low">{t('progress')}</TH>
                <TH>{t('status')}</TH>
                <TH priority="low">{t('customs')}</TH>
                <TH align="end">{t('eta')}</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((job) => {
                const critical = job.customsStatus === 'held' || job.status === 'on_hold'
                return (
                  <TR
                    key={job.id}
                    flag={critical ? 'critical' : job.openExceptions > 0 ? 'caution' : undefined}
                  >
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="ref numeric font-medium text-ink hover:text-accent hover:underline"
                      >
                        {job.reference}
                      </Link>
                      {/* The reference never breaks; the line under it may.
                          "Sea FCL · 3 containers" was the widest thing in the
                          cell, and the last 10px by which the board scrolled
                          at 1280. */}
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-micro whitespace-normal text-ink-subtle">
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <Icon name={modeIcon(job.mode)} size={12} />
                          {tMode(job.mode)}
                        </span>
                        {job.containerCount > 0 ? (
                          <span className="whitespace-nowrap">
                            {`· ${job.containerCount} ${
                              job.containerCount === 1 ? tc('container') : tc('containers')
                            }`}
                          </span>
                        ) : null}
                      </span>
                      {/* The customer and the lane, at the widths where their
                          columns have gone — a 768 tablet as well as a phone. */}
                      <StandIn className="text-ink">
                        {pickName(locale, job.customerName, job.customerNameAr)}
                      </StandIn>
                      <StandIn className="text-micro">
                        <Lane
                          origin={pickName(locale, job.originName, job.originNameAr)}
                          destination={pickName(locale, job.destinationName, job.destinationNameAr)}
                        />
                      </StandIn>
                    </TD>

                    {/* Customer and vessel wrap rather than truncate: the
                        reference beside them is two lines already, and a
                        truncated cell still asks the table for the width of
                        its whole unbroken text. */}
                    <TD priority="low" className="min-w-28">
                      {pickName(locale, job.customerName, job.customerNameAr)}
                    </TD>

                    <TD priority="low" className="text-ink-muted">
                      <Lane
                        origin={pickName(locale, job.originName, job.originNameAr)}
                        destination={pickName(locale, job.destinationName, job.destinationNameAr)}
                      />
                    </TD>

                    <TD priority="lowest" className="min-w-28 text-ink-muted">
                      {job.vesselOrFlight ?? '—'}
                    </TD>

                    <TD priority="low">
                      <MilestoneDots
                        total={job.milestonesTotal}
                        completed={job.milestonesDone}
                        label={`${job.milestonesDone} ${tc('of')} ${job.milestonesTotal}`}
                      />
                    </TD>

                    <TD>
                      <Badge tone={jobTone(job.status)} dot>
                        {t(`statuses.${job.status}` as 'statuses.booked')}
                      </Badge>
                      {/* The customs column leaves a phone, but a hold is the
                          one customs state that changes what someone does
                          next, so it follows the status there. */}
                      {job.customsStatus === 'held' ? (
                        <span className="mt-1 block @3xl:hidden">
                          <Badge tone={customsTone(job.customsStatus)} icon="hold">
                            {t('customsStatuses.held')}
                          </Badge>
                        </span>
                      ) : null}
                    </TD>

                    <TD priority="low">
                      {job.customsStatus ? (
                        <Badge
                          tone={customsTone(job.customsStatus)}
                          icon={job.customsStatus === 'held' ? 'hold' : undefined}
                        >
                          {t(`customsStatuses.${job.customsStatus}` as 'customsStatuses.held')}
                        </Badge>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </TD>

                    <TD align="end" numeric>
                      {job.ata ? (
                        <span className="text-positive">
                          {formatDay(job.ata, locale, timeZone)}
                        </span>
                      ) : (
                        <>
                          <span className="block">{formatDay(job.eta, locale, timeZone)}</span>
                          <span className="block text-micro text-ink-subtle">
                            {formatRelative(job.eta, locale, now)}
                          </span>
                        </>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </TableShell>
        )}
      </Card>
    </>
  )
}
