/**
 * Management reporting — the screen the person who signs the cheque opens.
 *
 * Everything else in this product is built for the people doing the work: the
 * ops board for the coordinator, the ageing for the credit controller, the job
 * P&L for whoever is arguing with an agent. None of them answer the question a
 * general manager asks, which is not "what is happening today" but **"which of
 * this is worth doing"** — by lane, by customer, by salesperson, over a period
 * they choose.
 *
 * ## Why the dimension and the period are in the URL
 *
 * A report somebody can send to a colleague is a report that gets used. Both
 * controls are `searchParams` rather than client state, so `/reports?dimension=
 * lane&from=2026-01-01&to=2026-06-30` is a link, a bookmark, and the thing that
 * makes the CSV route below trivially consistent with what is on screen — it
 * reads the same three values.
 *
 * ## Why the margin percentage comes from `core`
 *
 * The sums are done in PostgreSQL (see `features/reports/queries.ts` for why),
 * but what a margin percentage *means* — particularly on a group with cost and
 * no revenue — is a domain decision, and it must give the same answer here as
 * on every job screen. So `summariseMargin` runs over the two totals rather
 * than this page dividing them.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { money, summariseMargin } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { can } from '@/lib/permissions'
import {
  REPORT_DIMENSIONS,
  marginByDimension,
  yearToDate,
  type ReportDimension,
} from '@/features/reports/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney, formatNumber } from '@/lib/format'
import { formatByCurrency } from '@/lib/by-currency'
import { Button, EmptyState, Grid, PageHeader } from '@/ui/layout'
import { DateInput } from '@/ui/date-input'
import { Metric } from '@/ui/metric'
import { Card } from '@/ui/card'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Money } from '@/ui/money'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reports')
  return { title: t('title') }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function readDimension(value: string | undefined): ReportDimension {
  return REPORT_DIMENSIONS.includes(value as ReportDimension)
    ? (value as ReportDimension)
    : 'customer'
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ dimension?: string; from?: string; to?: string }>
}) {
  const session = await requireSession()
  /*
    Gated, and not by `job.read`.

    Aggregate margin across every customer is the most commercially sensitive
    view in the product — it is the whole book, not one file — so it sits
    behind `report.read`, which finance and management hold and a coordinator
    does not. RLS still narrows it to the principal's branches on top of that.

    A redirect rather than `assertCan`'s throw (A16): the throw reached the
    error boundary, so a coordinator who typed `/reports` read "Something went
    wrong" — a fault, for what is simply a page that is not theirs. The
    settings shell answers the same case the same way.
  */
  if (!can(session, 'report.read')) redirect('/dashboard')

  const params = await searchParams
  const t = await getTranslations('reports')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const dimension = readDimension(params.dimension)
  const fallback = yearToDate()
  const period = {
    from: params.from && ISO_DATE.test(params.from) ? params.from : fallback.from,
    to: params.to && ISO_DATE.test(params.to) ? params.to : fallback.to,
  }

  const rows = await marginByDimension(session.actor, dimension, period)

  /*
    A row's name in the reader's language. The mode cut's label is the enum
    value and the unowned bucket's is the literal "Unassigned" — both from
    SQL, so both read as English on an Arabic screen until named here.
  */
  const tMode = await getTranslations('mode')
  const tc = await getTranslations('common')
  const labelOf = (row: (typeof rows)[number]): string => {
    if (dimension === 'mode' && tMode.has(row.key as 'air')) return tMode(row.key as 'air')
    if (dimension === 'owner' && row.key === 'unassigned') return tc('unassigned')
    return locale === 'ar' ? row.labelAr || row.labelEn : row.labelEn
  }

  /*
    The totals per base currency. Branches book in different ones, and these
    were one `summariseMargin` over every row, labelled with the first row's
    currency — dirhams added into dinars.
  */
  const currencies = [...new Set(rows.map((row) => row.currency))]
  const totalsByCurrency = currencies.map((currency) => ({
    currency,
    totals: summariseMargin(
      rows
        .filter((row) => row.currency === currency)
        .flatMap((row) => [
          { direction: 'revenue' as const, amountInBase: money(row.revenue, row.currency) },
          { direction: 'cost' as const, amountInBase: money(row.cost, row.currency) },
        ]),
      currency,
    ),
  }))
  const totalOf = (pick: 'revenue' | 'cost' | 'gross') =>
    formatByCurrency(
      totalsByCurrency.map(({ currency, totals }) => ({
        currency,
        amount: totals[pick].amount.toString(),
      })),
      locale,
    )
  const jobCount = rows.reduce((acc, row) => acc + row.jobCount, 0)

  const href = (next: Partial<{ dimension: string; from: string; to: string }>) => {
    const query = new URLSearchParams({ dimension, from: period.from, to: period.to, ...next })
    return `/reports?${query.toString()}`
  }

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        // Days as the reader writes them, not "2026-09-01" (a calendar day, so UTC).
        description={t('subtitle', {
          from: formatDate(period.from, locale, 'UTC'),
          to: formatDate(period.to, locale, 'UTC'),
        })}
        actions={
          <Button
            href={`/api/reports/margin.csv?${new URLSearchParams({ dimension, from: period.from, to: period.to })}`}
            variant="secondary"
            icon="download"
            download
          >
            {t('exportCsv')}
          </Button>
        }
      />

      {/*
        Plain links, not a client-side control. The page is a server component
        and the state is the URL, so a form would be three moving parts where a
        row of anchors is none — and each one is independently shareable.
      */}
      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label={t('cutBy')}>
        {REPORT_DIMENSIONS.map((option) => (
          <a
            key={option}
            href={href({ dimension: option })}
            aria-current={option === dimension ? 'page' : undefined}
            className={[
              'inline-flex h-8 items-center rounded-sm px-3 text-body-sm font-medium transition-colors',
              option === dimension
                ? 'bg-brand text-on-brand'
                : 'border border-line bg-surface text-ink hover:bg-surface-sunken',
            ].join(' ')}
          >
            {t(`dimension.${option}` as 'dimension.customer')}
          </a>
        ))}
      </nav>

      {/* `DateInput`: "10/05/2026" in the browser's format was a different
          day to different readers. */}
      <form method="get" action="/reports" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="dimension" value={dimension} />
        <label className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
          {t('from')}
          <DateInput
            name="from"
            defaultValue={period.from}
            className="mt-1.5 block h-9 rounded-sm border border-line bg-surface px-3 text-body text-ink"
          />
        </label>
        <label className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
          {t('to')}
          <DateInput
            name="to"
            defaultValue={period.to}
            className="mt-1.5 block h-9 rounded-sm border border-line bg-surface px-3 text-body text-ink"
          />
        </label>
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-sm border border-line bg-surface px-3.5 text-body font-medium text-ink hover:bg-surface-sunken"
        >
          {t('apply')}
        </button>
      </form>

      <Grid className="mb-4">
        <Metric className="@4xl:col-span-3" label={t('revenue')} value={totalOf('revenue')} />
        <Metric className="@4xl:col-span-3" label={t('cost')} value={totalOf('cost')} />
        <Metric className="@4xl:col-span-3" label={t('grossProfit')} value={totalOf('gross')} />
        <Metric
          className="@4xl:col-span-3"
          label={t('jobs')}
          value={formatNumber(jobCount, locale)}
        />
      </Grid>

      {rows.length === 0 ? (
        <EmptyState icon="chart" title={t('empty')} description={t('emptyHint')} />
      ) : (
        // In a card, like every other register: bare on the canvas the table
        // had no edge, and its header row floated with nothing above it.
        <Card padding="none" className="overflow-hidden">
          <TableShell>
            <THead>
              <TR>
                <TH>{t(`dimension.${dimension}` as 'dimension.customer')}</TH>
                {/* Profit and margin are the report's answer; volume, revenue
                  and cost are how it got there, and wait for a wider screen. */}
                <TH priority="low" align="end">
                  {t('jobs')}
                </TH>
                <TH priority="low" align="end">
                  {t('revenue')}
                </TH>
                <TH priority="low" align="end">
                  {t('cost')}
                </TH>
                <TH align="end">{t('grossProfit')}</TH>
                <TH align="end">{t('marginPercent')}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const summary = summariseMargin(
                  [
                    { direction: 'revenue', amountInBase: money(row.revenue, row.currency) },
                    { direction: 'cost', amountInBase: money(row.cost, row.currency) },
                  ],
                  row.currency,
                )
                const negative = Number(row.grossProfit) < 0

                return (
                  <TR key={`${row.key}:${row.currency}`}>
                    <TD>{labelOf(row)}</TD>
                    <TD priority="low" align="end" numeric>
                      {formatNumber(row.jobCount, locale)}
                    </TD>
                    <TD priority="low" align="end" numeric>
                      <Money
                        value={{ amount: row.revenue, currency: row.currency }}
                        locale={locale}
                      />
                    </TD>
                    <TD priority="low" align="end" numeric>
                      <Money value={{ amount: row.cost, currency: row.currency }} locale={locale} />
                    </TD>
                    <TD align="end" numeric>
                      {/*
                      A loss is badged, not merely coloured. Colour alone fails
                      for the eight per cent of men who cannot distinguish it,
                      and a negative margin is the single most consequential
                      thing on this page.
                    */}
                      {negative ? (
                        <Badge tone="critical">
                          {formatMoney({ amount: row.grossProfit, currency: row.currency }, locale)}
                        </Badge>
                      ) : (
                        <Money
                          value={{ amount: row.grossProfit, currency: row.currency }}
                          locale={locale}
                        />
                      )}
                    </TD>
                    <TD align="end" numeric>
                      {summary.grossPercent === null
                        ? '—'
                        : `${Number(summary.grossPercent).toFixed(1)}%`}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </TableShell>
        </Card>
      )}
    </>
  )
}
