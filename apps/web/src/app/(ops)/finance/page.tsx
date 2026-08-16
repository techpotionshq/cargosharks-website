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
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import {
  invoiceSummary,
  paymentSummary,
  receivablesAgeing,
  topDebtors,
  type AgeingBucket,
} from '@/features/ledger/queries'
import { InvoiceDialog, PaymentDialog } from '@/features/ledger/ui/dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney, formatNumber } from '@/lib/format'
import { BarList } from '@/ui/chart'
import { Icon } from '@/ui/icon'
import { EmptyState, Grid, PageHeader } from '@/ui/layout'
import { Metric } from '@/ui/metric'
import { Panel, Readout } from '@/ui/panel'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Term } from '@/ui/term'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('finance')
  return { title: t('title') }
}

const BUCKET_COLOR: Record<AgeingBucket['key'], string> = {
  current: 'var(--qb-positive)',
  d1_30: 'var(--qb-chart-2)',
  d31_60: 'var(--qb-caution)',
  d61_90: 'var(--qb-chart-4)',
  d90_plus: 'var(--qb-critical)',
}

export default async function FinancePage() {
  const session = await requireSession()

  const [ageing, invoices, payments, debtors] = await Promise.all([
    receivablesAgeing(session.actor),
    invoiceSummary(session.actor),
    paymentSummary(session.actor),
    topDebtors(session.actor),
  ])

  const t = await getTranslations('finance')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const currency = ageing.currency ?? invoices.currency ?? 'KWD'
  const money = (amount: string) =>
    formatMoney({ amount: Number(amount), currency }, locale, { showCurrency: false })

  const overdueTotal = ageing.buckets
    .filter((bucket) => bucket.key !== 'current')
    .reduce((sum, bucket) => sum + Number(bucket.amount), 0)

  const worst = [...ageing.buckets]
    .filter((bucket) => bucket.key !== 'current' && bucket.count > 0)
    .pop()

  const nothingOwed = Number(ageing.total) === 0

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <PaymentDialog variant="secondary" />
            <InvoiceDialog variant="primary" />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={t('owed')}
          value={money(ageing.total)}
          unit={currency}
          icon="finance"
          tone="neutral"
          hint={t('owedHint', { count: invoices.issued })}
          href="/invoices"
        />
        <Metric
          label={t('overdue')}
          value={money(String(overdueTotal))}
          unit={currency}
          icon="alert"
          tone={overdueTotal > 0 ? 'critical' : 'positive'}
          hint={t('overdueHint', { count: invoices.overdue })}
          href="/invoices?status=issued"
        />
        <Metric
          label={t('received')}
          value={money(payments.received)}
          unit={payments.currency ?? currency}
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
          hint={
            <Term name="allocation">{t('unallocatedHint')}</Term>
          }
          href="/payments"
        />
      </div>

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
              */}
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken">
                {ageing.buckets.map((bucket) => {
                  const share = (Number(bucket.amount) / Number(ageing.total)) * 100
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
                      title={`${bucket.key}: ${money(bucket.amount)}`}
                    />
                  )
                })}
              </div>

              <BarList
                className="mt-5"
                max={Number(ageing.total)}
                data={ageing.buckets.map((bucket) => ({
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
                  display: money(bucket.amount),
                  color: BUCKET_COLOR[bucket.key],
                  hint: t('invoiceCount', { count: bucket.count }),
                }))}
              />

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
                    value: worst ? t(`buckets.${worst.key}`) : t('readout.none'),
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
                  <TR key={debtor.customerId}>
                    <TD className="font-medium text-ink">
                      {debtor.customerName}
                      <span className="ms-2 text-[0.6875rem] font-normal text-ink-subtle">
                        {t('invoiceCount', { count: debtor.invoiceCount })}
                      </span>
                    </TD>
                    <TD align="end" numeric className="font-semibold">
                      {formatMoney(
                        { amount: Number(debtor.balance), currency: debtor.currency },
                        locale,
                        { showCurrency: false },
                      )}
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
                            ? formatDate(new Date(debtor.oldestDueOn), locale)
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
                value: `${money(payments.received)} ${payments.currency ?? currency}`,
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
    </>
  )
}
