/**
 * One of the customer's invoices or credit notes, `FR-CP-09`, D12.
 *
 * The lines, the totals and what is left to pay, in the invoice's own
 * currency. A credit note says so in its header and names the invoice it
 * reduces; an invoice lists the credit notes raised against it. The receipts
 * behind "paid" stay with finance: the customer sees the figure, not our
 * allocation of their bank transfers.
 *
 * The PDF goes through the same route the branch uses, under the customer's
 * actor, so `invoices_customer_reads` decides whether a document exists at
 * all. A draft or a void invoice has no PDF for a customer because it has no
 * row for one.
 */

import type { Metadata, Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { todayIn } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { recordId } from '@/lib/ids'
import { getPortalInvoice } from '@/features/portal/queries'
import { isOverdue } from '@/features/portal/status'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, trimDecimal } from '@/lib/format'
import { Icon } from '@/ui/icon'
import { Button, EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Panel } from '@/ui/panel'
import { Badge, PAST_DUE_TONE, invoiceTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Money } from '@/ui/money'
import { Notice } from '@/ui/notice'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portalInvoices')
  return { title: t('title') }
}

export default async function PortalInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const id = recordId((await params).id)

  const invoice = await getPortalInvoice(session.actor, id, locale)
  if (!invoice) notFound()

  const t = await getTranslations('portalInvoices')
  const statusLabel: Record<string, string> = {
    issued: t('statusIssued'),
    part_paid: t('statusPartPaid'),
    paid: t('statusPaid'),
    credited: t('statusCredited'),
  }
  const late = isOverdue(invoice, todayIn())
  const money = (amount: string) => ({ amount, currency: invoice.currency })
  const pdf = `/api/invoices/${invoice.id}/pdf`

  return (
    <>
      <Link
        href="/portal/invoices"
        className="mb-4 inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
      >
        <Icon name="chevron-end" size={14} className="rotate-180" />
        {t('backToInvoices')}
      </Link>

      <PageHeader
        title={<span className="ref numeric">{invoice.seriesNo ?? '—'}</span>}
        status={
          invoice.isCreditNote ? (
            <Badge tone="info">{t('creditNote')}</Badge>
          ) : (
            <>
              <Badge tone={invoiceTone(invoice.status)} dot>
                {statusLabel[invoice.status] ?? invoice.status}
              </Badge>
              {late ? (
                <Badge tone={PAST_DUE_TONE} icon="clock">
                  {t('overdue')}
                </Badge>
              ) : null}
            </>
          )
        }
        actions={
          <>
            <Button href={`${pdf}?locale=en`} variant="ghost" icon="download" download>
              {t('pdf')}
            </Button>
            <Button href={`${pdf}?locale=ar`} variant="ghost" icon="download" download>
              {t('pdfAr')}
            </Button>
          </>
        }
      />

      {late && invoice.dueOn ? (
        <Notice tone={PAST_DUE_TONE} icon="clock" className="mb-4">
          {t('overdueSince', { on: formatDate(invoice.dueOn, locale) })}
        </Notice>
      ) : null}
      {invoice.isCreditNote && invoice.creditsInvoiceId && invoice.creditsSeriesNo ? (
        <Notice tone="info" icon="document" className="mb-4">
          <Link
            href={`/portal/invoices/${invoice.creditsInvoiceId}` as Route}
            className="ref font-medium underline"
          >
            {t('creditsInvoice', { number: invoice.creditsSeriesNo })}
          </Link>
        </Notice>
      ) : null}

      <Grid className="mb-4">
        <Panel className="@4xl:col-span-8" padding="none" icon="invoices" title={t('lines')}>
          {invoice.lines.length === 0 ? (
            <EmptyState icon="invoices" title={t('noLines')} />
          ) : (
            <TableShell>
              <THead>
                <TR>
                  <TH>{t('description')}</TH>
                  <TH priority="low" align="end">
                    {t('quantity')}
                  </TH>
                  <TH priority="low" align="end">
                    {t('unitPrice')}
                  </TH>
                  <TH align="end">{t('amount')}</TH>
                </TR>
              </THead>
              <TBody>
                {invoice.lines.map((line) => (
                  <TR key={line.id}>
                    <TD className="font-medium text-ink">
                      <span dir="auto">{line.description}</span>
                    </TD>
                    <TD priority="low" align="end" numeric className="text-ink-muted">
                      <span dir="ltr">{trimDecimal(line.quantity)}</span>
                    </TD>
                    <TD priority="low" align="end" numeric className="text-ink-muted">
                      <Money value={money(line.unitPrice)} locale={locale} showCurrency={false} />
                    </TD>
                    <TD align="end" numeric className="font-semibold">
                      <Money value={money(line.amount)} locale={locale} showCurrency={false} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Panel>

        <div className="flex flex-col gap-4 @4xl:col-span-4">
          {/*
            The arithmetic of what is owed, top to bottom, each figure as the
            database holds it. Nothing is added up here: the balance is
            PostgreSQL's `total - amount_paid - amount_credited`.
          */}
          <Panel icon="finance" title={t('about')}>
            <dl className="grid grid-cols-2 gap-4">
              <Field label={t('issued')}>{formatDate(invoice.issuedAt, locale)}</Field>
              {invoice.isCreditNote ? null : (
                <Field label={t('due')}>{formatDate(invoice.dueOn, locale)}</Field>
              )}
              <Field label={t('subtotal')}>
                <Money value={money(invoice.subtotal)} locale={locale} />
              </Field>
              <Field label={t('tax')}>
                <Money value={money(invoice.taxAmount)} locale={locale} />
              </Field>
              <Field label={t('total')}>
                <Money value={money(invoice.total)} locale={locale} className="font-semibold" />
              </Field>
              {invoice.isCreditNote ? null : (
                <>
                  <Field label={t('paid')}>
                    <Money value={money(invoice.amountPaid)} locale={locale} />
                  </Field>
                  <Field label={t('credited')}>
                    <Money value={money(invoice.amountCredited)} locale={locale} />
                  </Field>
                  <Field label={t('balance')}>
                    <Money
                      value={money(invoice.balance)}
                      locale={locale}
                      className="font-semibold"
                    />
                  </Field>
                </>
              )}
              {invoice.branchName ? (
                <Field label={t('issuedBy')}>{invoice.branchName}</Field>
              ) : null}
            </dl>
          </Panel>

          {invoice.creditNotes.length > 0 ? (
            <Panel padding="none" icon="document" title={t('creditNotes')}>
              <ul className="divide-y divide-line">
                {invoice.creditNotes.map((note) => (
                  <li key={note.id}>
                    <Link
                      href={`/portal/invoices/${note.id}` as Route}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                    >
                      <span className="ref numeric text-body-sm text-accent">
                        {note.seriesNo ?? '—'}
                      </span>
                      <span className="flex items-center gap-2 text-caption text-ink-subtle">
                        {formatDate(note.issuedAt, locale)}
                        <Money value={money(note.total)} locale={locale} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </Grid>
    </>
  )
}
