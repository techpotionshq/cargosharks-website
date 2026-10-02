/**
 * Finance — the receivables position.
 *
 * This screen used to say "not in the 15-day pilot" and list a roadmap. That
 * was the right answer for a pilot and the wrong one for a product: an
 * operator who clicks Finance and is told to come back in sixteen weeks stops
 * clicking Finance.
 *
 * The question it answers is the only one a forwarder's finance function asks
 * first thing: **how much are we owed, and how late is it?** So the page is an
 * ageing report with the two actions that follow from it — raise an invoice,
 * record a receipt — and the list of who to ring.
 *
 * Ageing buckets are the conventional 30/60/90 rather than anything invented
 * here, because that is what a credit controller already reads and what their
 * bank's facility is written against.
 */

import type { Metadata } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import {
  invoiceSummary,
  listAccountingExports,
  paymentSummary,
  receivablesAgeing,
  topDebtors,
  type AgeingBucket,
} from '@/features/ledger/queries'
import { InvoiceDialog, PaymentDialog } from '@/features/ledger/ui/dialogs'
import { AccountingExportDialog, VoidExportDialog } from '@/features/ledger/ui/export-panel'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney, formatNumber } from '@/lib/format'
import { formatByCurrency } from '@/lib/by-currency'
import { BarList } from '@/ui/chart'
import { Icon } from '@/ui/icon'
import { EmptyState, Grid, PageHeader } from '@/ui/layout'
import { Metric } from '@/ui/metric'
import { Panel, Readout } from '@/ui/panel'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Term } from '@/ui/term'
import { UnbilledPanel } from '@/features/ledger/ui/unbilled-panel'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('finance')
  return { title: t('title') }
}

/*
  A sequential ramp, not a set of categories.

  The buckets are one quantity — how late — cut into five, and they were drawn
  in teal, amber, violet and red as if they were five unrelated things. The
  eye then reads violet (61–90 days) as calmer than amber (31–60). The ramp
  runs from the positive "current" through caution into critical, each step
  mixed from the two status colours it sits between, so lateness reads as
  getting worse left to right without a legend.
*/
const BUCKET_COLOR: Record<AgeingBucket['key'], string> = {
  current: 'var(--qb-positive)',
  d1_30: 'color-mix(in oklab, var(--qb-caution) 55%, var(--qb-positive))',
  d31_60: 'var(--qb-caution)',
  d61_90: 'color-mix(in oklab, var(--qb-caution) 45%, var(--qb-critical))',
  d90_plus: 'var(--qb-critical)',
}

/** A zero in the lead currency — the "nothing owed" figure, with its code. */
function formatZero(currency: string, locale: 'en' | 'ar'): string {
  return formatMoney({ amount: 0, currency }, locale)
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ unbilled?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const [ageing, invoices, payments, debtors, exports] = await Promise.all([
    receivablesAgeing(session.actor),
    invoiceSummary(session.actor),
    paymentSummary(session.actor),
    topDebtors(session.actor, undefined, locale),
    listAccountingExports(session.actor),
  ])

  const t = await getTranslations('finance')
  const tc = await getTranslations('common')

  /*
    Every total on this page is one figure per currency.

    They used to be single sums labelled with one currency, so a KWD branch
    and an AED branch printed dinars plus dirhams as dinars. Each figure is
    now a list — summed per currency in SQL — and shown side by side, and the
    ageing is drawn once per currency so each bar is a proportion of money
    that actually adds. The lead currency (largest book) is only a fallback
    label for a zero.
  */
  const lead = ageing.byCurrency[0]?.currency ?? invoices.outstanding[0]?.currency ?? 'KWD'
  const money = (amount: string, currency: string) =>
    formatMoney({ amount: amount, currency }, locale, { showCurrency: false })

  const owed = ageing.byCurrency.map(({ currency, total }) => ({ currency, amount: total }))
  // A currency with nothing late is left out rather than printed as a zero.
  const overdue = ageing.byCurrency
    .filter((entry) => Number(entry.overdue) > 0)
    .map(({ currency, overdue: amount }) => ({ currency, amount }))

  // The worst bucket anything is in, in any currency.
  const order: AgeingBucket['key'][] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']
  const worstIndex = Math.max(
    -1,
    ...ageing.byCurrency.flatMap((entry) =>
      entry.buckets
        .filter((bucket) => bucket.key !== 'current' && bucket.count > 0)
        .map((bucket) => order.indexOf(bucket.key)),
    ),
  )
  const worst = worstIndex > 0 ? order[worstIndex] : undefined

  const nothingOwed = ageing.byCurrency.length === 0

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            {/* Preview first, post second — the order they are used in. */}
            <AccountingExportDialog variant="ghost" />
            <AccountingExportDialog post variant="secondary" />
            <PaymentDialog variant="secondary" />
            <InvoiceDialog variant="primary" />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={t('owed')}
          value={owed.length > 0 ? formatByCurrency(owed, locale) : formatZero(lead, locale)}
          icon="finance"
          tone="neutral"
          hint={t('owedHint', { count: invoices.issued })}
          href="/invoices"
        />
        <Metric
          label={t('overdue')}
          value={overdue.length > 0 ? formatByCurrency(overdue, locale) : formatZero(lead, locale)}
          icon="alert"
          tone={overdue.length > 0 ? 'critical' : 'positive'}
          hint={t('overdueHint', { count: invoices.overdue })}
          href="/invoices?status=overdue"
        />
        <Metric
          label={t('received')}
          value={
            payments.received.length > 0
              ? formatByCurrency(payments.received, locale)
              : formatZero(lead, locale)
          }
          icon="payments"
          tone="positive"
          hint={t('receivedHint', { count: payments.count })}
          href="/payments"
        />
        <Metric
          label={t('unallocated')}
          value={formatNumber(payments.unallocated, locale)}
          icon="clock"
          tone={payments.unallocated > 0 ? 'caution' : 'neutral'}
          hint={<Term name="allocation">{t('unallocatedHint')}</Term>}
          href="/payments"
        />
      </div>

      {/*
        Below the four figures and above the ageing, deliberately.

        Below the figures because they are the page's headline and a long
        table pushed them off a laptop screen; above the ageing because
        everything below it is money we have asked for and are waiting on,
        and this is money we have not asked for at all. It is the only figure
        on the page that nothing else will surface — an overdue invoice chases
        itself into a bucket, and an unbilled charge line ages silently because
        no document was ever raised. It renders nothing when there is nothing
        to chase, so a clean ledger keeps its usual page.
      */}
      <UnbilledPanel showAll={(await searchParams).unbilled === 'all'} />

      <Grid className="mb-4">
        {/* ---- the ageing report ------------------------------------- */}
        <Panel
          className="lg:col-span-7"
          icon="chart"
          title={t('ageing')}
          explain={t('ageingExplain')}
        >
          {nothingOwed ? (
            <EmptyState icon="check" title={t('nothingOwed')} description={t('nothingOwedHint')} />
          ) : (
            <>
              {/*
                A single stacked bar rather than five columns: the question is
                "what share of what we are owed is late", and a proportion is
                read off one bar far faster than off five.

                One bar and one list per currency. A share of dinars plus
                dirhams is not a proportion of anything, so a book in two
                currencies is two ageings, largest first — each headed by its
                code once there is more than one.
              */}
              {ageing.byCurrency.map((entry, index) => (
                <section key={entry.currency} className={index > 0 ? 'mt-6' : undefined}>
                  {ageing.byCurrency.length > 1 ? (
                    <p className="ref mb-2 text-[0.75rem] text-ink-subtle">
                      {entry.currency} · {money(entry.total, entry.currency)}
                    </p>
                  ) : null}
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken">
                    {entry.buckets.map((bucket) => {
                      const share = (Number(bucket.amount) / Number(entry.total)) * 100
                      if (share <= 0) return null
                      return (
                        <span
                          key={bucket.key}
                          className="h-full first:rounded-s-full last:rounded-e-full"
                          style={{
                            width: `${share}%`,
                            backgroundColor: BUCKET_COLOR[bucket.key],
                            // A 2px surface gap so adjacent segments stay distinct
                            // for a reader who cannot separate them by hue.
                            boxShadow: 'inset -2px 0 0 0 var(--qb-surface)',
                          }}
                          title={`${t(`buckets.${bucket.key}`)}: ${money(bucket.amount, entry.currency)}`}
                        />
                      )
                    })}
                  </div>

                  <BarList
                    className="mt-5"
                    max={Number(entry.total)}
                    data={entry.buckets.map((bucket) => ({
                      label: (
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: BUCKET_COLOR[bucket.key] }}
                          />
                          {t(`buckets.${bucket.key}`)}
                        </span>
                      ),
                      value: Number(bucket.amount),
                      display: money(bucket.amount, entry.currency),
                      color: BUCKET_COLOR[bucket.key],
                      hint: t('invoiceCount', { count: bucket.count }),
                    }))}
                  />
                </section>
              ))}

              <Readout
                className="mt-5 border-t border-line pt-4"
                facts={[
                  {
                    icon: 'invoices',
                    label: t('readout.issued'),
                    value: formatNumber(invoices.issued, locale),
                  },
                  {
                    icon: 'check',
                    label: t('readout.settled'),
                    value: formatNumber(invoices.paid, locale),
                  },
                  {
                    icon: 'alert',
                    label: t('readout.worst'),
                    value: worst ? t(`buckets.${worst}`) : t('readout.none'),
                  },
                ]}
              />
            </>
          )}
        </Panel>

        {/* ---- who to ring ------------------------------------------- */}
        <Panel
          className="lg:col-span-5"
          padding="none"
          icon="customers"
          title={t('debtors')}
          explain={t('debtorsExplain')}
          footerHref="/invoices"
          footerLabel={tc('viewAll')}
        >
          {debtors.length === 0 ? (
            <EmptyState icon="check" title={t('noDebtors')} />
          ) : (
            <TableShell minWidth="none">
              <THead>
                <TR>
                  <TH>{t('customer')}</TH>
                  <TH align="end">{t('balance')}</TH>
                  <TH align="end">{t('age')}</TH>
                </TR>
              </THead>
              <TBody>
                {debtors.map((debtor) => (
                  // One row per customer and currency — a customer owing in two is two rows.
                  <TR key={`${debtor.customerId}-${debtor.currency}`}>
                    <TD className="font-medium text-ink">
                      {debtor.customerName}
                      <span className="ms-2 text-[0.6875rem] font-normal text-ink-subtle">
                        {t('invoiceCount', { count: debtor.invoiceCount })}
                      </span>
                    </TD>
                    <TD align="end" numeric className="font-semibold">
                      {/* With its code: two rows may be two currencies. */}
                      {formatMoney({ amount: debtor.balance, currency: debtor.currency }, locale)}
                    </TD>
                    <TD align="end">
                      {debtor.daysOverdue > 0 ? (
                        <Badge tone={debtor.daysOverdue > 60 ? 'critical' : 'caution'}>
                          {t('daysLate', { days: debtor.daysOverdue })}
                        </Badge>
                      ) : (
                        <span
                          className="text-[0.75rem] whitespace-nowrap text-ink-subtle"
                          title={debtor.oldestDueOn ?? undefined}
                        >
                          {debtor.oldestDueOn
                            ? formatDate(new Date(debtor.oldestDueOn), locale, timeZone)
                            : '—'}
                        </span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Panel>
      </Grid>

      {/*
        The two registers this page summarises, reachable from it. A summary
        screen that cannot be drilled into is a poster.
      */}
      <Grid>
        <Panel
          className="lg:col-span-6"
          icon="invoices"
          title={t('invoicesTitle')}
          explain={t('invoicesExplain')}
          footerHref="/invoices"
          footerLabel={t('openInvoices')}
        >
          <Readout
            facts={[
              { label: t('readout.issued'), value: formatNumber(invoices.issued, locale) },
              { label: t('readout.settled'), value: formatNumber(invoices.paid, locale) },
              { label: t('overdue'), value: formatNumber(invoices.overdue, locale) },
            ]}
          />
        </Panel>

        <Panel
          className="lg:col-span-6"
          icon="payments"
          title={t('paymentsTitle')}
          explain={t('paymentsExplain')}
          footerHref="/payments"
          footerLabel={t('openPayments')}
        >
          <Readout
            facts={[
              { label: t('readout.receipts'), value: formatNumber(payments.count, locale) },
              {
                label: t('readout.total'),
                value: formatByCurrency(payments.received, locale),
              },
              { label: t('unallocated'), value: formatNumber(payments.unallocated, locale) },
            ]}
          />
          {payments.unallocated > 0 ? (
            <p className="mt-4 flex items-start gap-2 rounded-sm bg-caution-soft/60 px-3 py-2 text-[0.8125rem] text-caution">
              <Icon name="alert" size={14} className="mt-px shrink-0" />
              {t('unallocatedWarning', { count: payments.unallocated })}
            </p>
          ) : null}
        </Panel>
      </Grid>

      {/*
        What has been handed to the accountant, and the way back.

        The panel exists because the void did: `voidAccountingExportAction` was
        written and reachable from nowhere, so a period posted against the wrong
        dates was consumed permanently and the only remedy was a developer with
        a database connection. A destructive act needs its list.

        Voided rows stay, marked, with their reason. That is what makes this a
        void and not a delete (§5.5) — and "why was March posted twice" is a
        question somebody eventually asks.
      */}
      <Panel
        className="mt-4"
        padding="none"
        icon="sealed"
        title={t('exports')}
        explain={t('exportsExplain')}
      >
        {exports.length === 0 ? (
          <EmptyState icon="finance" title={t('noExports')} description={t('noExportsHint')} />
        ) : (
          <TableShell minWidth="none">
            <THead>
              <TR>
                <TH>{t('exportPeriod')}</TH>
                <TH>{t('exportBranch')}</TH>
                <TH align="end">{t('exportRows')}</TH>
                <TH>{t('exportStatus')}</TH>
                <TH align="end" />
              </TR>
            </THead>
            <TBody>
              {exports.map((row) => {
                const period = `${formatDate(new Date(row.periodFrom), locale, timeZone)} — ${formatDate(new Date(row.periodTo), locale, timeZone)}`
                return (
                  <TR key={row.id}>
                    <TD className="font-medium whitespace-nowrap text-ink">{period}</TD>
                    <TD className="ref">{row.branchCode ?? '—'}</TD>
                    <TD align="end" numeric>
                      {formatNumber(row.rowCount, locale)}
                    </TD>
                    <TD>
                      <Badge
                        tone={
                          row.status === 'void'
                            ? 'muted'
                            : row.status === 'posted'
                              ? 'positive'
                              : 'info'
                        }
                        dot
                      >
                        {t(`exportStatuses.${row.status}` as 'exportStatuses.posted')}
                      </Badge>
                      {row.voidReason ? (
                        <span className="ms-2 text-[0.6875rem] text-ink-subtle">
                          {row.voidReason}
                        </span>
                      ) : null}
                    </TD>
                    <TD align="end">
                      {/*
                        Only a posted export can be unwound. A draft consumed
                        nothing, so there is nothing to give back, and a void
                        that has already happened is not repeatable.
                      */}
                      {row.status === 'posted' ? (
                        <VoidExportDialog exportId={row.id} period={period} />
                      ) : null}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </TableShell>
        )}
      </Panel>
    </>
  )
}
