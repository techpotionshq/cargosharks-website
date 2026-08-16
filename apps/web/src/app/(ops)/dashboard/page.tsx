/**
 * The operations dashboard — Moment 3, "five mailboxes become one board".
 *
 * The layout answers four questions in the order an operations manager asks
 * them, and the order is the design:
 *
 *   1. **What is on fire?** SLA breaches and the demurrage that is accruing
 *      right now — the two numbers that cost money while you read them.
 *   2. **What is coming?** Live shipments and arrivals this week.
 *   3. **What is it worth?** Win rate and margin, for whoever signs cheques.
 *   4. **What has nobody looked at?** The exceptions register, oldest first
 *      (`FR-JB-09`) — because the exception that has been open longest is by
 *      definition the one the current process missed.
 *
 * Everything is a server component reading through the slice's `queries.ts`
 * under the caller's own actor, so the page carries no branch filter of its
 * own: RLS applies it (§5.3).
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { getOpsOverview } from '@/features/dashboard/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import {
  formatDateTime,
  formatDay,
  formatMoney,
  formatNumber,
  formatRelative,
} from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { BarList, CompositionBar, TrendColumns } from '@/ui/chart'
import { Grid, PageHeader, EmptyState, Button, Lane } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge, ToneDot, jobTone, severityTone, slaTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { MilestoneDots } from '@/ui/timeline'

export default async function DashboardPage() {
  const session = await requireSession()
  const overview = await getOpsOverview(session.actor)

  const t = await getTranslations('dashboard')
  const tc = await getTranslations('common')
  const tJob = await getTranslations('job')
  const tEnq = await getTranslations('enquiry')
  const tMode = await getTranslations('mode')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  const nameOf = (en: string, ar: string) => (locale === 'ar' ? ar : en)

  return (
    <>
      <PageHeader
        eyebrow={t('operationsEyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button href="/enquiries" icon="enquiries">
              {tEnq('title')}
            </Button>
            <Button href="/jobs" variant="primary" icon="jobs">
              {tJob('title')}
            </Button>
          </>
        }
      />

      {/*
        Four tiles, and only the two that represent a live cost carry a tone.
        A row where everything is coloured says nothing at a glance.
      */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('slaBreached')}
          value={formatNumber(overview.enquiries.breached, locale)}
          hint={t('slaBreachedHint')}
          icon="alert"
          tone={overview.enquiries.breached > 0 ? 'critical' : 'positive'}
          href="/enquiries?filter=overdue"
        />
        <StatTile
          label={t('accruing')}
          value={formatMoney(overview.clocks.accruing, locale, { showCurrency: false })}
          unit={overview.clocks.accruing.currency}
          hint={t('accruingHint', { containers: overview.clocks.containersAtRisk })}
          icon="clock"
          tone={overview.clocks.accruing.amount > 0 ? 'caution' : 'muted'}
          // The one number on the page that is genuinely still moving.
          live={overview.clocks.accruing.amount > 0}
          href="/jobs?filter=exceptions"
        />
        <StatTile
          label={t('openEnquiries')}
          value={formatNumber(overview.enquiries.open, locale)}
          hint={t('openEnquiriesHint', { unassigned: overview.enquiries.unassigned })}
          icon="enquiries"
          trend={overview.enquiries.trend.map((p) => p.value)}
          href="/enquiries"
        />
        <StatTile
          label={t('liveJobs')}
          value={formatNumber(overview.jobs.live, locale)}
          hint={t('liveJobsHint', { arriving: overview.jobs.arrivingThisWeek })}
          icon="jobs"
          href="/jobs"
        />
      </div>

      <Grid className="mb-4">
        {/* --- the exceptions register: the widest panel, because it is the
            one that changes what someone does next. --------------------- */}
        <Card className="lg:col-span-8" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="alert"
              eyebrow={t('operationsEyebrow')}
              title={t('exceptions')}
              description={t('exceptionsHint')}
              actions={
                <Button href="/jobs?filter=exceptions" size="sm" variant="ghost" iconEnd="chevron-end">
                  {tc('viewAll')}
                </Button>
              }
            />
          </div>

          {overview.exceptions.length === 0 ? (
            <EmptyState
              icon="check"
              title={t('noExceptions')}
              description={t('noExceptionsHint')}
            />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {overview.exceptions.slice(0, 5).map((exception) => {
                const overdue = exception.dueAt !== null && exception.dueAt.getTime() < now
                return (
                  <li key={exception.id}>
                    <a
                      href={`/jobs/${exception.jobId}`}
                      className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                    >
                      <span className="mt-0.5">
                        <ToneDot tone={severityTone(exception.severity)} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[0.875rem] font-medium text-ink">
                            {nameOf(exception.nameEn, exception.nameAr)}
                          </span>
                          <span className="ref numeric text-[0.75rem] text-brand">
                            {exception.jobReference}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[0.75rem] text-ink-muted">
                          {exception.description ?? exception.customerName}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={severityTone(exception.severity)}>
                          {tJob(`severities.${exception.severity}` as 'severities.high')}
                        </Badge>
                        <span
                          className={`numeric text-[0.6875rem] ${
                            overdue ? 'font-medium text-critical' : 'text-ink-subtle'
                          }`}
                        >
                          {formatRelative(exception.openedAt, locale, now)}
                        </span>
                      </div>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* --- the SLA watch: unanswered, closest to breach first -------- */}
        <Card className="lg:col-span-4" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="clock"
              eyebrow={t('quotesEyebrow')}
              title={t('slaWatch')}
              description={t('slaWatchHint')}
            />
          </div>

          {overview.slaWatch.length === 0 ? (
            <EmptyState icon="check" title={t('noExceptions')} />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {overview.slaWatch.slice(0, 5).map((enquiry) => {
                const tone = slaTone(enquiry.slaDueAt, enquiry.firstRespondedAt, now)
                return (
                  <li key={enquiry.id}>
                    <a
                      href={`/enquiries/${enquiry.id}`}
                      className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-sunken"
                    >
                      <ToneDot tone={tone} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.8125rem] font-medium text-ink">
                          {nameOf(enquiry.customerName, enquiry.customerNameAr)}
                        </p>
                        <p className="truncate text-[0.6875rem] text-ink-subtle">
                          {enquiry.owner ?? tc('unassigned')}
                        </p>
                      </div>
                      <span
                        className={`numeric shrink-0 text-[0.75rem] font-medium ${
                          tone === 'critical' ? 'text-critical' : 'text-ink-muted'
                        }`}
                      >
                        {formatRelative(enquiry.slaDueAt, locale, now)}
                      </span>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </Grid>

      <Grid className="mb-4">
        {/* --- intake over a fortnight ---------------------------------- */}
        {/* `flex-col` with a growing chart: the card matches the height of
            its row neighbours, and the plot takes the slack rather than
            leaving a pool of empty white under it. */}
        <Card className="flex flex-col lg:col-span-5">
          <CardHeader
            icon="trend"
            eyebrow={t('quotesEyebrow')}
            title={t('enquiryTrend')}
            description={t('enquiryTrendHint')}
          />
          <TrendColumns
            className="mt-5 flex flex-1 flex-col justify-end"
            height={150}
            points={overview.enquiries.trend.map((point, index) => ({
              ...point,
              emphasis: index === overview.enquiries.trend.length - 1,
            }))}
            label={t('enquiryTrend')}
          />
        </Card>

        {/* --- the commercial half: three numbers, no chart ------------- */}
        <Card className="lg:col-span-3">
          <CardHeader
            icon="rates"
            eyebrow={t('quotesEyebrow')}
            title={t('avgMargin')}
            description={t('avgMarginHint')}
          />
          <p className="numeric mt-4 font-display text-[2.5rem] leading-none font-semibold tracking-tight text-ink">
            {overview.quotes.averageMarginPct.toFixed(1)}
            <span className="text-[1.25rem] text-ink-subtle">%</span>
          </p>
          <dl className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[0.8125rem] text-ink-muted">{t('winRate')}</dt>
              <dd className="numeric text-[0.875rem] font-semibold text-ink">
                {overview.quotes.winRatePct}%
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[0.8125rem] text-ink-muted">{t('medianResponse')}</dt>
              <dd className="numeric text-[0.875rem] font-semibold text-ink">
                {overview.quotes.medianResponseMinutes} min
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-[0.8125rem] text-ink-muted">{t('winRateHint', { quoted: overview.quotes.sentThisMonth })}</dt>
              <dd className="numeric text-[0.875rem] font-semibold text-ink">
                {formatMoney(overview.quotes.quotedValue, locale, { compact: true })}
              </dd>
            </div>
          </dl>
        </Card>

        {/* --- composition, not a donut: see `CompositionBar` ----------- */}
        <Card className="lg:col-span-4">
          <CardHeader
            icon="ship"
            eyebrow={t('operationsEyebrow')}
            title={t('liveJobs')}
            description={t('jobsByMode')}
          />
          <div className="mt-5">
            <CompositionBar
              segments={overview.jobs.byMode.map((row) => ({
                label: tMode(row.mode),
                value: row.count,
              }))}
            />
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow mb-3">{t('jobsByStatus')}</p>
            <BarList
              data={overview.jobs.byStatus
                .slice()
                .sort((a, b) => b.count - a.count)
                .map((row) => ({
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <ToneDot tone={jobTone(row.status)} />
                      {tJob(`statuses.${row.status}` as 'statuses.booked')}
                    </span>
                  ),
                  value: row.count,
                  href: `/jobs?status=${row.status}`,
                }))}
            />
          </div>
        </Card>
      </Grid>

      <Grid>
        {/* --- arrivals: the week ahead, as a board ---------------------- */}
        <Card className="lg:col-span-8" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="calendar"
              eyebrow={t('operationsEyebrow')}
              title={t('arrivals')}
              actions={
                <Button href="/jobs" size="sm" variant="ghost" iconEnd="chevron-end">
                  {tc('viewAll')}
                </Button>
              }
            />
          </div>

          {overview.arrivals.length === 0 ? (
            <EmptyState icon="ship" title={tJob('empty')} description={tJob('emptyHint')} />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {overview.arrivals.map((job) => (
                <li key={job.id}>
                  <a
                    href={`/jobs/${job.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-muted">
                      <Icon name={modeIcon(job.mode)} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="ref numeric text-[0.8125rem] font-medium text-brand">
                          {job.reference}
                        </span>
                        <span className="truncate text-[0.75rem] text-ink-muted">
                          {nameOf(job.customerName, job.customerNameAr)}
                        </span>
                      </div>
                      <p className="truncate text-[0.75rem] text-ink-subtle">
                        <Lane
                          origin={nameOf(job.originName, job.originNameAr)}
                          destination={nameOf(job.destinationName, job.destinationNameAr)}
                        />
                        {job.vesselOrFlight ? ` · ${job.vesselOrFlight}` : ''}
                      </p>
                    </div>
                    <div className="hidden shrink-0 sm:block">
                      <MilestoneDots
                        total={job.milestonesTotal}
                        completed={job.milestonesDone}
                        label={`${job.milestonesDone} / ${job.milestonesTotal}`}
                      />
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={jobTone(job.status)} dot>
                        {tJob(`statuses.${job.status}` as 'statuses.booked')}
                      </Badge>
                      <span className="numeric text-[0.6875rem] text-ink-subtle">
                        {tJob('eta')} {formatDay(job.eta, locale)}
                      </span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- lanes: nominal categories, so one hue, ranked ------------- */}
        <Card className="lg:col-span-4">
          <CardHeader
            icon="tracking"
            eyebrow={t('operationsEyebrow')}
            title={t('topLanes')}
            description={t('topLanesHint')}
          />
          <div className="mt-5">
            <BarList
              data={overview.topLanes.map((lane) => ({
                label: lane.lane,
                value: lane.count,
                hint: `${lane.count} shipments`,
              }))}
              emptyLabel={tJob('empty')}
            />
          </div>
          <p className="mt-5 border-t border-line pt-3 text-[0.6875rem] text-ink-subtle">
            {tc('updated', { time: formatDateTime(new Date(now), locale) })}
          </p>
        </Card>
      </Grid>
    </>
  )
}
