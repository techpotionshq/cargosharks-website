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
import { pickName } from '@/lib/named'
import { recordId } from '@/lib/ids'
import { getInvoiceDetail } from '@/features/ledger/queries'
import {
  CreditNoteDialog,
  InvoiceLineDialog,
  InvoiceStatusActions,
} from '@/features/ledger/ui/invoice-actions'
import { PaymentDialog } from '@/features/ledger/ui/dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { currencyLabel, formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { Icon } from '@/ui/icon'
import { EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Notice } from '@/ui/notice'
import { Metric } from '@/ui/metric'
import { Panel } from '@/ui/panel'
import { Badge, invoiceTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { MoreMenu } from '@/ui/menu'
import { dec } from '@qabandi/core'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const session = await requireSession()
  const id = recordId((await params).id)
  const invoice = await getInvoiceDetail(session.actor, id)
  // A draft has no number yet; it is titled as the page calls it.
  const t = await getTranslations('invoiceDetail')
  return { title: invoice?.seriesNo ?? t('unnumbered') }
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
    formatMoney({ amount: amount, currency: invoice.currency }, locale)
  /*
    The tiles carry the figure alone and the currency as the tile's unit,
    which wraps beneath it. With the Arabic currency name inside the figure
    the amounts ran past the tile edge at 1280px.
  */
  const figure = (amount: string | number) =>
    formatMoney({ amount: amount, currency: invoice.currency }, locale, {
      showCurrency: false,
    })

  // Decimal, then a string for display: money minus money is never a float.
  // A partial credit note (F9) is off the balance as surely as a receipt.
  const credited = dec(invoice.amountCredited ?? 0)
  const owed = dec(invoice.total ?? 0)
    .minus(dec(invoice.amountPaid ?? 0))
    .minus(credited)
  const balance = owed.toFixed()
  const owing = owed.gt(0)
  const isDraft = invoice.status === 'draft'
  // Owed by somebody: a credited or voided invoice keeps a balance on paper
  // and is overdue for nobody.
  const payable = invoice.status === 'issued' || invoice.status === 'part_paid'
  const overdue =
    payable && owing && invoice.dueOn !== null && new Date(invoice.dueOn).getTime() < Date.now()

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
        status={
          <Badge tone={invoiceTone(invoice.status)} dot>
            {ti(`statuses.${invoice.status}` as 'statuses.issued')}
          </Badge>
        }
        /*
          The next state is the one primary button — approve a draft, issue an
          approved one — and the rest (add a line, record a receipt, void,
          credit) sit behind More. An issued invoice has no forward move left,
          so recording the receipt that pays it takes the primary slot.
        */
        actions={
          <>
            <InvoiceStatusActions invoiceId={invoice.id} status={invoice.status} part="forward" />
            {owing && payable ? (
              <PaymentDialog
                customerId={invoice.customerId}
                invoiceId={invoice.id}
                branchId={invoice.branchId}
                currency={invoice.currency}
                variant="primary"
              />
            ) : null}
            <MoreMenu label={tc('more')}>
              {isDraft ? <InvoiceLineDialog invoiceId={invoice.id} /> : null}
              {/* Only where a receipt can land: issued and still owed. A draft,
                an approved-but-unnumbered, a credited or a voided invoice was
                offered "Record a receipt" and every one failed with a 500. */}
              <InvoiceStatusActions invoiceId={invoice.id} status={invoice.status} part="other" />
              <CreditNoteDialog
                invoiceId={invoice.id}
                branchId={invoice.branchId}
                status={invoice.status}
                isCreditNote={invoice.isCreditNote}
                currency={invoice.currency}
                creditable={owing ? balance : '0'}
              />
            </MoreMenu>
          </>
        }
      />

      {overdue ? (
        <Notice tone="critical" className="mb-4">
          {t('overdueSince', { on: formatDate(new Date(invoice.dueOn!), locale, timeZone) })}
        </Notice>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <Metric
          label={t('total')}
          value={figure(invoice.total)}
          unit={currencyLabel(invoice.currency, locale)}
          icon="invoices"
          tone="brand"
        />
        <Metric
          label={t('paid')}
          value={figure(invoice.amountPaid)}
          unit={currencyLabel(invoice.currency, locale)}
          icon="payments"
          tone={Number(invoice.amountPaid) > 0 ? 'positive' : 'neutral'}
        />
        <Metric
          label={t('balance')}
          value={figure(balance)}
          unit={currencyLabel(invoice.currency, locale)}
          icon={owing ? 'alert' : 'check'}
          tone={!owing ? 'positive' : overdue ? 'critical' : 'caution'}
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
          className="@4xl:col-span-8"
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
              <TableShell>
                <THead>
                  <TR>
                    <TH>{t('description')}</TH>
                    {/* A line and its amount on a phone; the invoice PDF
                        and a wider screen carry the working. */}
                    <TH priority="low" align="end">
                      {t('quantity')}
                    </TH>
                    <TH priority="low" align="end">
                      {t('unitPrice')}
                    </TH>
                    <TH priority="low" align="end">
                      {t('tax')}
                    </TH>
                    <TH align="end">{t('amount')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoice.lines.map((line) => (
                    <TR key={line.id}>
                      <TD className="font-medium text-ink">
                        {pickName(locale, line.descriptionEn, line.descriptionAr)}
                      </TD>
                      <TD priority="low" align="end" numeric className="text-ink-muted">
                        {Number(line.quantity)}
                      </TD>
                      <TD priority="low" align="end" numeric className="text-ink-muted">
                        {money(line.unitPrice)}
                      </TD>
                      <TD priority="low" align="end" numeric className="text-ink-muted">
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
                <div className="flex justify-between text-body">
                  <dt className="text-ink-muted">{t('subtotal')}</dt>
                  <dd className="numeric text-ink">{money(invoice.subtotal)}</dd>
                </div>
                <div className="flex justify-between text-body">
                  <dt className="text-ink-muted">
                    {t('taxAt', { rate: Number(invoice.taxRatePercent) })}
                  </dt>
                  <dd className="numeric text-ink">{money(invoice.taxAmount)}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-title font-semibold">
                  <dt className="text-ink">{t('total')}</dt>
                  <dd className="numeric text-ink">{money(invoice.total)}</dd>
                </div>
                {credited.gt(0) ? (
                  <div className="flex justify-between text-body">
                    <dt className="text-ink-muted">{t('credited')}</dt>
                    <dd className="numeric text-ink">{money(credited.toFixed())}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          )}
        </Panel>

        <div className="flex flex-col gap-4 @4xl:col-span-4">
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
              // Free text, in whatever language it was typed: its own direction.
              <p dir="auto" className="mt-4 border-t border-line pt-4 text-body-sm text-ink-muted">
                {invoice.notes}
              </p>
            ) : null}
            {invoice.isCreditNote && invoice.creditsInvoiceId ? (
              <p className="mt-4 border-t border-line pt-4 text-body-sm">
                <Link
                  href={`/invoices/${invoice.creditsInvoiceId}`}
                  className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {t('creditsInvoice')}
                </Link>
              </p>
            ) : null}
          </Panel>

          {/*
            The notes raised against it (F9). Listed only where there are
            any: most invoices are never credited, and an empty panel would
            say "nothing here" about a thing nobody was looking for.
          */}
          {invoice.creditNotes.length > 0 ? (
            <Panel
              padding="none"
              icon="invoices"
              title={t('creditNotes')}
              explain={t('creditNotesExplain')}
            >
              <ul className="divide-y divide-line">
                {invoice.creditNotes.map((note) => (
                  <li key={note.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/invoices/${note.id}`}
                        className="ref numeric truncate text-body-sm text-ink hover:underline"
                      >
                        {note.seriesNo ?? t('unnumbered')}
                      </Link>
                      {note.issuedAt ? (
                        <p className="text-caption text-ink-subtle">
                          {formatDate(new Date(note.issuedAt), locale, timeZone)}
                        </p>
                      ) : null}
                    </div>
                    <span className="numeric shrink-0 text-body font-semibold">
                      {money(note.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

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
                      <p className="ref numeric truncate text-body-sm text-ink">
                        {allocation.reference ?? t('noReference')}
                      </p>
                      <p className="text-caption text-ink-subtle">
                        {formatDate(new Date(allocation.receivedOn), locale, timeZone)} ·{' '}
                        {tp(`methods.${allocation.method}` as 'methods.cash')}
                      </p>
                    </div>
                    <span className="numeric shrink-0 text-body font-semibold text-positive">
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
