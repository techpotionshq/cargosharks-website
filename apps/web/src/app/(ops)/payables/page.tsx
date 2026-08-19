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
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import {
  listSupplierInvoices,
  payablesAgeing,
  payablesSummary,
} from '@/features/payables/queries'
import {
  SupplierInvoiceDialog,
  SupplierPaymentDialog,
} from '@/features/payables/ui/dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { Card } from '@/ui/card'
import { EmptyState, Grid, PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge, type Tone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'

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
  const session = await requireSession()
  const filters = await searchParams

  const [rows, summary, ageing, t, tc] = await Promise.all([
    listSupplierInvoices(session.actor, {
      status: filters.status,
      partnerId: filters.partner,
    }),
    payablesSummary(session.actor),
    payablesAgeing(session.actor),
    getTranslations('payables'),
    getTranslations('common'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const money = (amount: string, currency: string) =>
    formatMoney({ amount: Number(amount), currency }, locale)

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <SupplierPaymentDialog variant="secondary" />
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
          value={money(ageing.ageing.total.amount.toString(), ageing.currency)}
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
                  <TH>{t('supplier')}</TH>
                  <TH align="end">{t('total')}</TH>
                  <TH align="end">{t('variance')}</TH>
                  <TH align="end">{t('due')}</TH>
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
                          className="ref numeric font-medium hover:text-brand"
                        >
                          {row.reference}
                        </Link>
                        <span className="mt-0.5 block text-[0.6875rem] text-ink-subtle">
                          {formatDate(row.invoiceDate, locale)}
                        </span>
                      </TD>
                      <TD className="text-ink-muted">{row.partnerName}</TD>
                      <TD align="end" numeric>
                        {money(row.total, row.currency)}
                      </TD>
                      {/*
                        The variance is in base currency and the total is in
                        theirs, and the columns sit side by side saying so. The
                        alternative — converting one to the other for tidiness —
                        is how an exchange movement gets read as an overcharge.
                      */}
                      <TD
                        align="end"
                        numeric
                        className={variance > 0 ? 'font-semibold text-critical' : 'text-ink-muted'}
                      >
                        {money(row.varianceBase, row.baseCurrency)}
                      </TD>
                      <TD align="end" numeric className="text-ink-muted">
                        {row.dueOn ? formatDate(row.dueOn, locale) : '—'}
                      </TD>
                      <TD align="end">
                        <span className="inline-flex items-center gap-1.5">
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
    </>
  )
}
