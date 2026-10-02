/**
 * The operations board.
 *
 * Written for someone on their first week in freight, which changes almost
 * every decision on the page:
 *
 *   - **The headline is a sentence, not a number.** "Three things need you
 *     today" tells a newcomer what to do; a grid of twelve figures tells them
 *     to go and ask someone.
 *   - **Every panel says what it means.** One line under each title, in words
 *     that assume nothing. It is the cheapest usability win available and the
 *     reference boards all do it.
 *   - **Jargon carries its definition.** Demurrage, free time and SLA are
 *     wrapped in `<Term>`, so the word explains itself where it is read
 *     instead of in a training document.
 *   - **Charts are paired with a readout.** Beside every plot is a short list
 *     of the facts you would otherwise have to read off it.
 *
 * The order is still the order an operations manager asks in — what is on
 * fire, what is coming, what is it worth, what has nobody looked at — because
 * that ordering is right for the expert too. What changed is that a beginner
 * can now follow it.
 *
 * Everything is a server component reading through the slice's `queries.ts`
 * under the caller's own actor, so the page carries no branch filter of its
 * own: RLS applies it (§5.3).
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { getMapData, getOpsOverview } from '@/features/dashboard/queries'
import { getSetupState, type SetupStepKey } from '@/features/onboarding/queries'
import { SetupChecklist } from '@/features/onboarding/ui/setup-checklist'
import { NewEnquiryButton } from '@/features/enquiries/ui/new-enquiry-dialog'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDay, formatMoney, formatNumber, formatRelative, formatTime } from '@/lib/format'
import { formatByCurrency } from '@/lib/by-currency'
import { BarList, CompositionBar, TrendColumns } from '@/ui/chart'
import { Icon, modeIcon } from '@/ui/icon'
import { Button, EmptyState, Grid, Lane } from '@/ui/layout'
import { Delta, Metric, Spark, TickMeter } from '@/ui/metric'
import { LaneMap, LaneMapLegend } from '@/ui/lane-map'
import { EventRow, Panel, Readout } from '@/ui/panel'
import { Badge, ToneDot, jobTone, severityTone, slaTone } from '@/ui/status'
import { Term } from '@/ui/term'
import { pickName } from '@/lib/named'

/**
 * Morning, afternoon or evening — in Kuwait, not in the server's zone.
 *
 * A board greeting an operator with "Good evening" at 10am because the
 * container it runs in is set to UTC is a small thing that makes the whole
 * product feel like it was not built for them.
 */
function partOfDay(now: Date, timeZone: string): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone }).format(now),
  )
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

/** The tab says which screen this is, as the sidebar does, in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('dashboard') }
}

export default async function DashboardPage() {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const resolvedLocale = await getLocale()
  const overview = await getOpsOverview(
    session.actor,
    isLocale(resolvedLocale) ? resolvedLocale : DEFAULT_LOCALE,
  )
  const setup = await getSetupState(session.actor)
  const map = await getMapData(session.actor)

  const t = await getTranslations('dashboard')
  const tSetup = await getTranslations('setup')
  const tc = await getTranslations('common')
  const tJob = await getTranslations('job')
  const tEnq = await getTranslations('enquiry')
  const tMode = await getTranslations('mode')
  const tNav = await getTranslations('nav')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const nowDate = new Date()
  const now = nowDate.getTime()

  // An empty Arabic name falls back to English rather than rendering blank (F52).
  const nameOf = (en: string, ar: string | null) => pickName(locale, en, ar)
  const firstName = (
    locale === 'ar' && session.principal.nameAr
      ? session.principal.nameAr
      : session.principal.nameEn
  ).split(' ')[0]!

  /**
   * The headline count.
   *
   * Deliberately *not* the sum of every number on the page. It is the count of
   * things that require a person to do something today — an overdue reply and
   * an open exception qualify; forty shipments running to plan do not. A
   * headline that inflates itself with healthy figures teaches people to
   * ignore it within a week.
   */
  const needsAction = overview.enquiries.breached + overview.exceptions.length
  const trend = overview.enquiries.trend.map((point) => point.value)

  // Week-over-week on intake, from the two halves of the fortnight the trend
  // already covers — no second query for a number that is already on the page.
  const half = Math.floor(trend.length / 2)
  const previous = trend.slice(0, half).reduce((sum, value) => sum + value, 0)
  const current = trend.slice(half).reduce((sum, value) => sum + value, 0)
  const intakeDelta = previous > 0 ? ((current - previous) / previous) * 100 : null

  const busiestLane = overview.topLanes[0]
  const biggestMode = [...overview.jobs.byMode].sort((a, b) => b.count - a.count)[0]
  const nextArrival = overview.arrivals[0]

  return (
    <>
      {/* ---- the greeting ------------------------------------------------
          A named greeting and a plain sentence, in place of the eyebrow and
          title the rest of the product uses. This is the one screen someone
          opens first thing in the morning, and it should answer "is anything
          wrong?" before they have read a single figure. */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-display leading-tight font-semibold tracking-tight text-ink">
            {t(`greeting.${partOfDay(nowDate, 'Asia/Kuwait')}`, { name: firstName })}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-title text-ink-muted">
            {needsAction > 0 ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-critical-soft px-2.5 py-1 text-body-sm font-semibold text-critical">
                  <Icon name="alert" size={13} weight="fill" />
                  {t('needsYou', { count: needsAction })}
                </span>
                <span>{t('needsYouRest')}</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="check" size={15} className="text-positive" weight="bold" />
                {t('allClear')}
              </span>
            )}
          </p>
        </div>

        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
          <Button href="/jobs" icon="jobs">
            {tNav('jobs')}
          </Button>
          <NewEnquiryButton />
        </div>
      </header>

      {/*
        Shown only until the last step is done, and it sits above the board
        rather than on a separate page: on an empty install the board is all
        zeroes, and that is exactly the moment the operator needs telling why.
      */}
      <SetupChecklist
        state={setup}
        labels={{
          title: tSetup('title'),
          subtitle: tSetup('subtitle'),
          progress: tSetup('progress', { done: setup.doneCount, total: setup.steps.length }),
          start: tSetup('start'),
          steps: Object.fromEntries(
            setup.steps.map((step) => [
              step.key,
              {
                title: tSetup(`steps.${step.key}.title`),
                description: tSetup(`steps.${step.key}.description`),
                action: tSetup(`steps.${step.key}.action`),
              },
            ]),
          ) as Record<SetupStepKey, { title: string; description: string; action: string }>,
        }}
      />

      {/* ---- the four numbers -------------------------------------------
          Only the two that represent a live cost carry a tone. A row where
          everything is coloured says nothing at a glance. */}
      <div className="mb-4 grid grid-cols-1 gap-4 @xl:grid-cols-2 @3xl:grid-cols-4">
        <Metric
          label={t('overdueReplies')}
          value={formatNumber(overview.enquiries.breached, locale)}
          icon="alert"
          tone={overview.enquiries.breached > 0 ? 'critical' : 'positive'}
          href="/enquiries?filter=overdue"
          hint={
            <>
              {t('overdueRepliesHint')} <Term name="sla">{t('slaWord')}</Term>.
            </>
          }
        >
          <p className="text-body-sm text-ink-muted">
            <span className="numeric font-semibold text-ink">{overview.enquiries.dueToday}</span>{' '}
            {t('dueTodayCaption')}
          </p>
        </Metric>

        <Metric
          label={<Term name="demurrage">{t('accruing')}</Term>}
          // One figure per currency: a USD per-diem summed into dinars was
          // printed as dinars.
          value={formatByCurrency(overview.clocks.accruing, locale)}
          icon="clock"
          tone={overview.clocks.accruing.length > 0 ? 'caution' : 'neutral'}
          // The one number on the page that is genuinely still moving.
          live={overview.clocks.accruing.length > 0}
          href="/jobs?filter=exceptions"
        >
          <TickMeter
            value={overview.clocks.containersAtRisk}
            max={Math.max(overview.clocks.running, overview.clocks.containersAtRisk, 1)}
            tone="caution"
            /*
              The denominator is the meter's own maximum. Containers at risk
              are counted per box and running clocks per clock, so a job with
              three boxes on one clock read "3 of 1 container past their free
              days" — a fraction over one, and the wrong plural.
            */
            label={t('containersLabel', {
              atRisk: overview.clocks.containersAtRisk,
              running: Math.max(overview.clocks.running, overview.clocks.containersAtRisk),
            })}
          />
        </Metric>

        <Metric
          label={t('openEnquiries')}
          value={formatNumber(overview.enquiries.open, locale)}
          icon="enquiries"
          tone="info"
          href="/enquiries"
          hint={t('openEnquiriesHint', { unassigned: overview.enquiries.unassigned })}
        >
          <Spark points={trend} tone="info" />
        </Metric>

        <Metric
          label={t('liveJobs')}
          value={formatNumber(overview.jobs.live, locale)}
          icon="ship"
          tone="brand"
          href="/jobs"
        >
          <TickMeter
            value={overview.jobs.arrivingThisWeek}
            max={Math.max(overview.jobs.live, 1)}
            tone="info"
            label={t('arrivingLabel', { count: overview.jobs.arrivingThisWeek })}
          />
        </Metric>
      </div>

      {/* ---- where the cargo is --------------------------------------
          The one graphic anybody understands without being told: this is
          where our cargo comes from and where it goes. Every line is a live
          shipment and every dot is a port we are currently using. */}
      <Panel className="mb-4" icon="globe" title={t('map')} explain={t('mapExplain')}>
        {/* In the body rather than the header's actions slot, which does not
            shrink: at 390px the Arabic legend pushed the page 58px sideways.
            Here it wraps under the title instead. */}
        <LaneMapLegend
          className="mb-3"
          modes={overview.jobs.byMode.map((row) => ({
            mode: row.mode,
            label: tMode(row.mode),
            count: row.count,
          }))}
        />
        {map.lanes.length === 0 ? (
          <EmptyState icon="globe" title={t('noLanes')} description={t('mapEmptyHint')} />
        ) : (
          <LaneMap
            lanes={map.lanes.map((lane) => ({ ...lane, href: '/jobs' }))}
            ports={map.ports.map((port) => ({ ...port, href: '/locations' }))}
          />
        )}
      </Panel>

      <Grid className="mb-4">
        {/* ---- what is broken ------------------------------------------
            The widest panel on the board, because it is the only one that
            changes what somebody does next. */}
        <Panel
          className="@4xl:col-span-8"
          padding="none"
          icon="alert"
          title={t('attention')}
          explain={t('attentionExplain')}
          actions={
            <Button href="/exceptions" size="sm" variant="ghost" iconEnd="chevron-end">
              {tc('viewAll')}
            </Button>
          }
        >
          {overview.exceptions.length === 0 ? (
            <EmptyState
              icon="check"
              title={t('noExceptions')}
              description={t('noExceptionsHint')}
            />
          ) : (
            <ul className="divide-y divide-line">
              {overview.exceptions.slice(0, 5).map((exception) => {
                const overdue = exception.dueAt !== null && exception.dueAt.getTime() < now
                return (
                  <li key={exception.id}>
                    <Link
                      href={`/jobs/${exception.jobId}`}
                      className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                    >
                      <span className="mt-1">
                        <ToneDot tone={severityTone(exception.severity)} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-body font-medium text-ink">
                            {nameOf(exception.nameEn, exception.nameAr)}
                          </span>
                          <span className="ref numeric text-caption font-medium text-ink">
                            {exception.jobReference}
                          </span>
                        </div>
                        {/* The description is the human sentence — "container
                            held for inspection, broker notified". Falling back
                            to the customer name keeps the row informative when
                            nobody has written one. `dir="auto"` because it
                            is free text: an English sentence in the Arabic
                            board truncated from its start ("…hamber
                            attestation before release"). */}
                        <p dir="auto" className="mt-0.5 truncate text-body-sm text-ink-muted">
                          {exception.description ??
                            nameOf(exception.customerName, exception.customerNameAr)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={severityTone(exception.severity)}>
                          {tJob(`severities.${exception.severity}` as 'severities.high')}
                        </Badge>
                        <span
                          className={`numeric text-micro ${
                            overdue ? 'font-medium text-critical' : 'text-ink-subtle'
                          }`}
                        >
                          {t('openFor', { since: formatRelative(exception.openedAt, locale, now) })}
                        </span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        {/* ---- what is arriving ----------------------------------------
            The reference boards' "delivery in progress" rail: one shipment,
            in detail, as an event feed. One rather than ten, because the
            value here is showing a newcomer what a shipment's life looks
            like — a list of ten teaches nothing. */}
        <Panel
          className="@4xl:col-span-4"
          icon="ship"
          title={t('nextArrival')}
          explain={t('nextArrivalExplain')}
          footerHref={nextArrival ? `/jobs/${nextArrival.id}` : undefined}
          footerLabel={t('openShipment')}
        >
          {!nextArrival ? (
            <EmptyState icon="ship" title={tJob('empty')} description={tJob('emptyHint')} />
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-sm bg-surface-sunken p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted">
                  <Icon name={modeIcon(nextArrival.mode)} size={18} />
                </span>
                <div className="min-w-0">
                  <p className="ref numeric truncate text-body font-semibold text-ink">
                    {nextArrival.reference}
                  </p>
                  <p className="truncate text-caption text-ink-muted">
                    {nameOf(nextArrival.customerName, nextArrival.customerNameAr)}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-body-sm text-ink-muted">
                <Lane
                  origin={nameOf(nextArrival.originName, nextArrival.originNameAr)}
                  destination={nameOf(nextArrival.destinationName, nextArrival.destinationNameAr)}
                />
              </p>

              <ul className="mt-4">
                <EventRow
                  time={nextArrival.etd ? formatTime(nextArrival.etd, locale, timeZone) : '—'}
                  date={nextArrival.etd ? formatDay(nextArrival.etd, locale, timeZone) : undefined}
                  title={t('events.departed')}
                  detail={t('events.departedDetail', {
                    place: nameOf(nextArrival.originName, nextArrival.originNameAr),
                  })}
                  tone="positive"
                />
                <EventRow
                  time={nextArrival.eta ? formatTime(nextArrival.eta, locale, timeZone) : '—'}
                  date={nextArrival.eta ? formatDay(nextArrival.eta, locale, timeZone) : undefined}
                  title={t('events.arriving')}
                  detail={
                    nextArrival.vesselOrFlight
                      ? t('events.arrivingOn', { carrier: nextArrival.vesselOrFlight })
                      : t('events.arrivingDetail', {
                          place: nameOf(nextArrival.destinationName, nextArrival.destinationNameAr),
                        })
                  }
                  tone="brand"
                />
                <EventRow
                  time="—"
                  title={t('events.clearance')}
                  detail={<Term name="clearance">{t('events.clearanceDetail')}</Term>}
                  tone="muted"
                  last
                />
              </ul>
            </>
          )}
        </Panel>
      </Grid>

      <Grid className="mb-4">
        {/* ---- intake, with the facts written out ---------------------- */}
        <Panel
          className="@4xl:col-span-8"
          icon="trend"
          title={t('enquiryTrend')}
          explain={t('enquiryTrendExplain')}
          bodyClassName="flex"
        >
          {/* 17rem for the readout: at 15 its labels clipped to "Received this …". */}
          <div className="grid flex-1 gap-6 @4xl:grid-cols-[1fr_17rem]">
            <TrendColumns
              className="flex flex-1 flex-col justify-end"
              height={190}
              points={overview.enquiries.trend.map((point, index) => ({
                ...point,
                // The query hands over the day; it is worded here so the axis
                // reads in Arabic on the Arabic page.
                label: formatDay(`${point.label}T00:00:00Z`, locale, 'UTC'),
                emphasis: index === overview.enquiries.trend.length - 1,
              }))}
              label={t('enquiryTrend')}
            />

            {/* The readout: what the chart says, in words. Reading a
                superlative off a bar chart is a skill; stating it is free. */}
            <div className="lg:border-s lg:border-line lg:ps-6">
              {intakeDelta === null ? (
                <p className="text-body-sm text-ink-subtle">{t('noBaseline')}</p>
              ) : (
                <Delta value={intakeDelta} goodWhen="up" caption={t('vsLastWeek')} />
              )}
              <Readout
                className="mt-4"
                facts={[
                  {
                    icon: 'enquiries',
                    label: t('readout.received'),
                    value: formatNumber(current, locale),
                  },
                  {
                    icon: 'clock',
                    label: t('readout.median'),
                    value: t('minutes', { count: overview.quotes.medianResponseMinutes }),
                  },
                  {
                    icon: 'quotes',
                    label: t('readout.quoted'),
                    value: formatNumber(overview.quotes.sentThisMonth, locale),
                    href: '/quotes',
                  },
                  {
                    icon: 'check',
                    label: t('readout.won'),
                    value: `${overview.quotes.winRatePct}%`,
                  },
                  ...(busiestLane
                    ? [
                        {
                          icon: 'locations' as const,
                          label: t('readout.busiestLane'),
                          value: nameOf(busiestLane.lane, busiestLane.laneAr),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </div>
        </Panel>

        {/* ---- who is still waiting ------------------------------------ */}
        <Panel
          className="@4xl:col-span-4"
          padding="none"
          icon="clock"
          title={t('slaWatch')}
          explain={t('slaWatchExplain')}
          footerHref="/enquiries"
          footerLabel={tEnq('title')}
        >
          {overview.slaWatch.length === 0 ? (
            <EmptyState icon="check" title={t('allAnswered')} />
          ) : (
            <ul className="divide-y divide-line">
              {overview.slaWatch.slice(0, 5).map((enquiry) => {
                const tone = slaTone(enquiry.slaDueAt, enquiry.firstRespondedAt, now)
                return (
                  <li key={enquiry.id}>
                    <Link
                      href={`/enquiries/${enquiry.id}`}
                      className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-sunken"
                    >
                      <ToneDot tone={tone} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm font-medium text-ink">
                          {nameOf(enquiry.customerName, enquiry.customerNameAr)}
                        </p>
                        <p className="truncate text-micro text-ink-subtle">
                          {enquiry.owner ?? tc('unassigned')}
                        </p>
                      </div>
                      <span
                        className={`numeric shrink-0 text-caption font-medium ${
                          tone === 'critical' ? 'text-critical' : 'text-ink-muted'
                        }`}
                      >
                        {formatRelative(enquiry.slaDueAt, locale, now)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </Grid>

      <Grid>
        {/* ---- what it is worth ---------------------------------------- */}
        <Panel
          className="@4xl:col-span-4"
          icon="finance"
          title={t('avgMargin')}
          explain={t('avgMarginExplain')}
        >
          <p className="numeric font-display text-hero leading-none font-semibold tracking-tight text-ink">
            {overview.quotes.averageMarginPct.toFixed(1)}
            <span className="text-headline leading-none text-ink-subtle">%</span>
          </p>
          <Readout
            className="mt-4 border-t border-line pt-4"
            facts={[
              { label: t('winRate'), value: `${overview.quotes.winRatePct}%` },
              {
                label: t('winRateHint', { quoted: overview.quotes.sentThisMonth }),
                value: formatByCurrency(overview.quotes.quotedValue, locale, { compact: true }),
              },
              {
                label: t('medianResponse'),
                value: t('minutes', { count: overview.quotes.medianResponseMinutes }),
              },
            ]}
          />
        </Panel>

        {/* ---- how it moves -------------------------------------------- */}
        <Panel
          className="@4xl:col-span-4"
          icon="container"
          title={t('jobsByMode')}
          explain={t('jobsByModeExplain')}
        >
          <CompositionBar
            segments={overview.jobs.byMode.map((row) => ({
              label: tMode(row.mode),
              value: row.count,
            }))}
          />
          {biggestMode ? (
            <p className="mt-4 text-body-sm text-ink-muted">
              {t('modeReadout', {
                mode: tMode(biggestMode.mode),
                share: Math.round((biggestMode.count / Math.max(overview.jobs.live, 1)) * 100),
              })}
            </p>
          ) : null}
          <div className="mt-4 border-t border-line pt-4">
            <BarList
              data={overview.jobs.byStatus
                .slice()
                .sort((a, b) => b.count - a.count)
                .slice(0, 5)
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
        </Panel>

        {/* ---- where it goes ------------------------------------------- */}
        <Panel
          className="@4xl:col-span-4"
          icon="locations"
          title={t('topLanes')}
          explain={t('topLanesExplain')}
          footerHref="/locations"
          footerLabel={t('allPlaces')}
        >
          {overview.topLanes.length === 0 ? (
            <EmptyState icon="locations" title={t('noLanes')} />
          ) : (
            <BarList
              data={overview.topLanes.slice(0, 6).map((lane) => ({
                label: nameOf(lane.lane, lane.laneAr),
                value: lane.count,
                hint: formatMoney(lane.value, locale, { compact: true }),
              }))}
            />
          )}
        </Panel>
      </Grid>
    </>
  )
}
