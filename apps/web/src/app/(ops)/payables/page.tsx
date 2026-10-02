/**
 * The payables board — what suppliers have asked for, and what disagrees.
 *
 * The tile that earns its place is "needs review": bills whose lines are
 * outside the configured tolerance, or matched to nothing at all. That is the
 * queue this whole feature produces, and it leads the screen because a
 * variance found on the day the bill arrives is an argument you can win and
 * one found at month end is a loss you have already taken.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import {
  listPayableInvoices,
  listSupplierInvoices,
  listSupplierPayments,
  payablesAgeing,
  payablesSummary,
} from '@/features/payables/queries'
import {
  AllocatePaymentDialog,
  ReadBillDialog,
  SupplierInvoiceDialog,
  SupplierPaymentDialog,
} from '@/features/payables/ui/dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { formatByCurrency } from '@/lib/by-currency'
import { Card } from '@/ui/card'
import { EmptyState, Grid, PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge, type Tone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { Money } from '@/ui/money'

const STATUS_TONE: Record<string, Tone> = {
  received: 'info',
  approved: 'brand',
  part_paid: 'caution',
  paid: 'positive',
  disputed: 'critical',
  void: 'muted',
}

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; partner?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  // The ledger's own read key (QA P2-11): a session alone let every internal
  // role, read-only included, open it. Not found rather than forbidden, as
  // with every screen a principal has no business knowing about.
  if (!can(session, 'payable.read')) notFound()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const filters = await searchParams

  const [rows, summary, ageing, payments, t, tc] = await Promise.all([
    listSupplierInvoices(
      session.actor,
      { status: filters.status, partnerId: filters.partner },
      locale,
    ),
    payablesSummary(session.actor),
    payablesAgeing(session.actor),
    listSupplierPayments(session.actor, locale),
    getTranslations('payables'),
    getTranslations('common'),
  ])

  /*
    What is left on each payment, and the bills it could still go against.

    Loaded per partner rather than once for everybody: `listPayableInvoices`
    is partner-scoped because an allocation across partners is not a thing
    that exists, and offering one on the form would be offering a mistake.
    Only payments with something left to place need the lookup at all, so a
    fully allocated register costs no queries.
  */
  const openPayments = payments.filter(
    (payment) => Number(payment.amount) - Number(payment.allocated) > 0,
  )
  const billsByPartner = new Map(
    await Promise.all(
      [...new Set(openPayments.map((payment) => payment.partnerId))].map(
        async (partnerId) =>
          [partnerId, await listPayableInvoices(session.actor, partnerId)] as const,
      ),
    ),
  )

  const money = (amount: string, currency: string) =>
    formatMoney({ amount: amount, currency }, locale)

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <SupplierPaymentDialog variant="secondary" />
            <ReadBillDialog />
            <SupplierInvoiceDialog />
          </span>
        }
      />

      <Grid>
        <StatTile
          className="lg:col-span-3"
          label={t('needsReview')}
          value={summary.needingReview}
          hint={t('needsReviewHint')}
          icon="alert"
          tone={summary.needingReview > 0 ? 'critical' : 'positive'}
        />
        <StatTile
          className="lg:col-span-3"
          label={t('awaitingApproval')}
          value={summary.awaitingApproval}
          hint={t('awaitingApprovalHint')}
          icon="invoices"
          tone={summary.awaitingApproval > 0 ? 'caution' : 'muted'}
          href="/payables?status=received"
        />
        <StatTile
          className="lg:col-span-3"
          label={t('overdue')}
          value={summary.overdue}
          hint={t('overdueHint')}
          icon="payments"
          tone={summary.overdue > 0 ? 'caution' : 'muted'}
        />
        <StatTile
          className="lg:col-span-3"
          label={t('owed')}
          value={formatByCurrency(
            ageing.byCurrency.map(({ currency, ageing: aged }) => ({
              currency,
              amount: aged.total.amount.toString(),
            })),
            locale,
          )}
          hint={t('owedHint')}
          icon="finance"
          tone="info"
        />

        <Card className="lg:col-span-12" padding="none">
          {rows.length === 0 ? (
            <EmptyState icon="payments" title={t('none')} description={t('noneHint')} />
          ) : (
            <TableShell>
              <THead>
                <TR>
                  <TH>{t('reference')}</TH>
                  {/* Supplier and due date become second lines on a phone
                      (below), leaving reference, total and status across. */}
                  <TH priority="low">{t('supplier')}</TH>
                  <TH align="end">{t('total')}</TH>
                  <TH priority="low" align="end">
                    {t('variance')}
                  </TH>
                  <TH priority="low" align="end">
                    {t('due')}
                  </TH>
                  <TH align="end">{tc('status')}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const variance = Number(row.varianceBase)
                  return (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/payables/${row.id}`}
                          className="ref numeric font-medium hover:text-accent"
                        >
                          {row.reference}
                        </Link>
                        <span className="mt-0.5 block text-micro text-ink-subtle">
                          {formatDate(row.invoiceDate, locale, timeZone)}
                        </span>
                        <span className="block text-caption text-ink-muted md:hidden">
                          {row.partnerName}
                        </span>
                      </TD>
                      <TD priority="low" className="text-ink-muted">
                        {row.partnerName}
                      </TD>
                      <TD align="end" numeric>
                        <Money
                          value={{ amount: row.total, currency: row.currency }}
                          locale={locale}
                        />
                        {row.dueOn ? (
                          <span className="block text-micro text-ink-subtle md:hidden">
                            {t('due')} {formatDate(row.dueOn, locale, timeZone)}
                          </span>
                        ) : null}
                      </TD>
                      {/*
                        The variance is in base currency and the total is in
                        theirs, and the columns sit side by side saying so. The
                        alternative — converting one to the other for tidiness —
                        is how an exchange movement gets read as an overcharge.
                      */}
                      <TD
                        priority="low"
                        align="end"
                        numeric
                        className={variance > 0 ? 'font-semibold text-critical' : 'text-ink-muted'}
                      >
                        <Money
                          value={{ amount: row.varianceBase, currency: row.baseCurrency }}
                          locale={locale}
                        />
                      </TD>
                      <TD priority="low" align="end" numeric className="text-ink-muted">
                        {row.dueOn ? formatDate(row.dueOn, locale, timeZone) : '—'}
                      </TD>
                      <TD align="end">
                        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          {row.unmatchedCount > 0 ? (
                            <Badge tone="caution">
                              {t('unmatched', { n: row.unmatchedCount })}
                            </Badge>
                          ) : null}
                          <Badge tone={STATUS_TONE[row.status] ?? 'muted'}>
                            {t(`statuses.${row.status}` as 'statuses.received')}
                          </Badge>
                        </span>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </TableShell>
          )}
        </Card>
      </Grid>

      {/*
        Money that has left the building and has not been put against a bill.

        `AllocatePaymentDialog` was written, tested and rendered nowhere, so a
        payment recorded before its invoice arrived — which is the ordinary
        case for a deposit or an advance to an agent — stayed unallocated with
        no way to place it. The register is here rather than on a payment
        detail page because that is how the work arrives: somebody asks what is
        still sitting unapplied, and the answer is a list.
      */}
      <Card className="mt-4" padding="none">
        <div className="p-5 pb-3">
          <h2 className="text-title font-semibold text-ink">{t('paymentsTitle')}</h2>
          <p className="mt-1 text-body-sm text-ink-muted">{t('paymentsHint')}</p>
        </div>

        {openPayments.length === 0 ? (
          <EmptyState icon="check" title={t('allAllocated')} description={t('allAllocatedHint')} />
        ) : (
          <TableShell className="border-t border-line">
            <THead>
              <TR>
                <TH>{t('paymentPartner')}</TH>
                {/* What is left to allocate is this table's figure; the paid
                    date follows the partner on a phone (below). */}
                <TH priority="low">{t('paymentPaidOn')}</TH>
                <TH priority="low">{t('paymentReference')}</TH>
                <TH priority="low" align="end">
                  {t('paymentAmount')}
                </TH>
                <TH align="end">{t('paymentUnallocated')}</TH>
                <TH align="end" />
              </TR>
            </THead>
            <TBody>
              {openPayments.map((payment) => {
                const unallocated = (Number(payment.amount) - Number(payment.allocated)).toFixed(3)
                const bills = billsByPartner.get(payment.partnerId) ?? []
                return (
                  <TR key={payment.id}>
                    <TD className="font-medium text-ink">
                      {payment.partnerName}
                      {payment.paidOn ? (
                        <span className="block text-micro font-normal text-ink-subtle md:hidden">
                          {formatDate(new Date(payment.paidOn), locale, timeZone)}
                        </span>
                      ) : null}
                    </TD>
                    <TD priority="low" className="whitespace-nowrap text-ink-muted">
                      {payment.paidOn
                        ? formatDate(new Date(payment.paidOn), locale, timeZone)
                        : '—'}
                    </TD>
                    <TD priority="low" className="ref text-ink-muted">
                      {payment.reference ?? '—'}
                    </TD>
                    <TD priority="low" align="end" numeric>
                      <Money
                        value={{ amount: payment.amount, currency: payment.currency }}
                        locale={locale}
                      />
                    </TD>
                    <TD align="end" numeric className="font-semibold text-caution">
                      <Money
                        value={{ amount: unallocated, currency: payment.currency }}
                        locale={locale}
                      />
                    </TD>
                    <TD align="end">
                      {/*
                        No open bill means nothing to allocate against, and a
                        dialog whose only select is empty is worse than none.
                      */}
                      {bills.length === 0 ? (
                        <span className="text-caption text-ink-subtle">{t('noOpenBills')}</span>
                      ) : (
                        <AllocatePaymentDialog
                          paymentId={payment.id}
                          unallocated={unallocated}
                          bills={bills.map((bill) => ({
                            id: bill.id,
                            label: `${bill.reference} · ${money(bill.outstanding, payment.currency)}`,
                          }))}
                        />
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
