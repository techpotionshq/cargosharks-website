/**
 * The invoice.
 *
 * Linked from the register, which pointed at a route that did not exist.
 *
 * The screen is built around the one question a finance function asks of an
 * individual invoice — **what is still outstanding on it** — and the two
 * things that answer it: the lines that make up the total, and the receipts
 * allocated against it. Everything else is supporting detail.
 *
 * Two rules the page has to respect rather than merely display:
 *
 *   1. **A draft has no number.** The series is allocated at issue, so a draft
 *      that is abandoned leaves no gap in a statutory sequence. The page shows
 *      "not yet numbered" rather than inventing a placeholder that looks like
 *      one.
 *   2. **An issued invoice is not editable.** Lines can be added to a draft;
 *      after that a correction is a credit note, which is a different document
 *      with its own number.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { recordId } from '@/lib/ids'
import { getInvoiceDetail } from '@/features/ledger/queries'
import { InvoiceLineDialog, InvoiceStatusActions } from '@/features/ledger/ui/invoice-actions'
import { PaymentDialog } from '@/features/ledger/ui/dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { Icon } from '@/ui/icon'
import { EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Notice } from '@/ui/notice'
import { Metric } from '@/ui/metric'
import { Panel } from '@/ui/panel'
import { Badge, invoiceTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const session = await requireSession()
  const id = recordId((await params).id)
  const invoice = await getInvoiceDetail(session.actor, id)
  return { title: invoice?.seriesNo ?? 'Invoice' }
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const id = recordId((await params).id)
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const invoice = await getInvoiceDetail(session.actor, id, locale)
  if (!invoice) notFound()

  const t = await getTranslations('invoiceDetail')
  const tc = await getTranslations('common')
  const ti = await getTranslations('invoices')
  const tp = await getTranslations('paymentForm')

  const money = (amount: string | number) =>
    formatMoney({ amount: Number(amount), currency: invoice.currency }, locale)

  const balance = Number(invoice.total) - Number(invoice.amountPaid)
  const overdue =
    balance > 0 && invoice.dueOn !== null && new Date(invoice.dueOn).getTime() < Date.now()
  const isDraft = invoice.status === 'draft'

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/invoices" className="hover:text-ink">
              {ti('title')}
            </Link>
            <Icon name="chevron-end" size={12} />
            <span>{invoice.customerName ?? tc('none')}</span>
          </span>
        }
        title={
          invoice.seriesNo ? (
            <span className="ref numeric">{invoice.seriesNo}</span>
          ) : (
            // A draft has no number yet, and saying so is more useful than a
            // dash — it explains why, and it is the state you can still edit.
            <span className="text-ink-subtle">{t('unnumbered')}</span>
          )
        }
        description={t('issuedTo', { customer: invoice.customerName ?? '—' })}
        actions={
          <>
            <Badge tone={invoiceTone(invoice.status)} dot>
              {ti(`statuses.${invoice.status}` as 'statuses.issued')}
            </Badge>
            {isDraft ? <InvoiceLineDialog invoiceId={invoice.id} /> : null}
            {balance > 0 && !isDraft ? (
              <PaymentDialog
                customerId={invoice.customerId}
                invoiceId={invoice.id}
                variant="secondary"
              />
            ) : null}
            <InvoiceStatusActions invoiceId={invoice.id} status={invoice.status} />
          </>
        }
      />

      {overdue ? (
        <Notice tone="critical" className="mb-4">
          {t('overdueSince', { on: formatDate(new Date(invoice.dueOn!), locale, timeZone) })}
        </Notice>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label={t('total')} value={money(invoice.total)} icon="invoices" tone="brand" />
        <Metric
          label={t('paid')}
          value={money(invoice.amountPaid)}
          icon="payments"
          tone={Number(invoice.amountPaid) > 0 ? 'positive' : 'neutral'}
        />
        <Metric
          label={t('balance')}
          value={money(balance)}
          icon={balance > 0 ? 'alert' : 'check'}
          tone={balance <= 0 ? 'positive' : overdue ? 'critical' : 'caution'}
          hint={t('balanceHint')}
        />
        <Metric
          label={t('dueOn')}
          value={invoice.dueOn ? formatDate(new Date(invoice.dueOn), locale, timeZone) : '—'}
          icon="calendar"
          tone={overdue ? 'critical' : 'neutral'}
        />
      </div>

      <Grid className="mb-4">
        <Panel
          className="lg:col-span-8"
          padding="none"
          icon="finance"
          title={t('lines')}
          explain={isDraft ? t('linesExplainDraft') : t('linesExplain')}
        >
          {invoice.lines.length === 0 ? (
            <EmptyState
              icon="finance"
              title={t('noLines')}
              description={isDraft ? t('noLinesHintDraft') : t('noLinesHint')}
            />
          ) : (
            <>
              <TableShell minWidth="none">
                <THead>
                  <TR>
                    <TH>{t('description')}</TH>
                    <TH align="end">{t('quantity')}</TH>
                    <TH align="end">{t('unitPrice')}</TH>
                    <TH align="end">{t('tax')}</TH>
                    <TH align="end">{t('amount')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoice.lines.map((line) => (
                    <TR key={line.id}>
                      <TD className="font-medium text-ink">{line.descriptionEn}</TD>
                      <TD align="end" numeric className="text-ink-muted">
                        {Number(line.quantity)}
                      </TD>
                      <TD align="end" numeric className="text-ink-muted">
                        {money(line.unitPrice)}
                      </TD>
                      <TD align="end" numeric className="text-ink-muted">
                        {Number(line.taxAmount) === 0 ? '—' : money(line.taxAmount)}
                      </TD>
                      <TD align="end" numeric className="font-semibold">
                        {money(line.amount)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </TableShell>

              {/* The totals, derived from the lines rather than stored beside
                  them — so the header cannot drift from what it sums. */}
              <dl className="flex flex-col gap-2 border-t border-line px-5 py-4">
                <div className="flex justify-between text-[0.875rem]">
                  <dt className="text-ink-muted">{t('subtotal')}</dt>
                  <dd className="numeric text-ink">{money(invoice.subtotal)}</dd>
                </div>
                <div className="flex justify-between text-[0.875rem]">
                  <dt className="text-ink-muted">
                    {t('taxAt', { rate: Number(invoice.taxRatePercent) })}
                  </dt>
                  <dd className="numeric text-ink">{money(invoice.taxAmount)}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-[0.9375rem] font-semibold">
                  <dt className="text-ink">{t('total')}</dt>
                  <dd className="numeric text-ink">{money(invoice.total)}</dd>
                </div>
              </dl>
            </>
          )}
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <Panel icon="invoices" title={t('about')}>
            <dl className="grid grid-cols-2 gap-4">
              <Field label={t('branch')}>{invoice.branchCode ?? '—'}</Field>
              <Field label={t('taxTreatment')}>
                {t(`treatments.${invoice.taxTreatment}` as 'treatments.standard')}
              </Field>
              <Field label={t('language')}>
                {invoice.language === 'ar' ? t('languages.ar') : t('languages.en')}
              </Field>
              <Field label={t('issuedAt')}>
                {invoice.issuedAt
                  ? formatDateTime(invoice.issuedAt, locale, timeZone)
                  : t('notIssued')}
              </Field>
              <Field label={t('issuedBy')}>{invoice.issuedBy ?? '—'}</Field>
            </dl>
            {invoice.notes ? (
              <p className="mt-4 border-t border-line pt-4 text-[0.8125rem] text-ink-muted">
                {invoice.notes}
              </p>
            ) : null}
          </Panel>

          <Panel
            padding="none"
            icon="payments"
            title={t('receipts')}
            explain={t('receiptsExplain')}
            footerHref="/payments"
            footerLabel={tp('open')}
          >
            {invoice.allocations.length === 0 ? (
              <EmptyState icon="payments" title={t('noReceipts')} />
            ) : (
              <ul className="divide-y divide-line">
                {invoice.allocations.map((allocation) => (
                  <li
                    key={allocation.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="ref numeric truncate text-[0.8125rem] text-ink">
                        {allocation.reference ?? t('noReference')}
                      </p>
                      <p className="text-[0.75rem] text-ink-subtle">
                        {formatDate(new Date(allocation.receivedOn), locale, timeZone)} ·{' '}
                        {tp(`methods.${allocation.method}` as 'methods.cash')}
                      </p>
                    </div>
                    <span className="numeric shrink-0 text-[0.875rem] font-semibold text-positive">
                      {money(allocation.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </Grid>
    </>
  )
}
