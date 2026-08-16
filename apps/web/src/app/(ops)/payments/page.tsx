/**
 * The payments register — `FR-FI-08`.
 *
 * Receipts, newest first, with what has been matched against invoices. The
 * column worth having is the unallocated balance: a payment sitting in the
 * bank that nobody has matched is money you have but cannot close a ledger
 * with, and it is invisible on every other screen.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listPayments, paymentSummary } from '@/features/ledger/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('payments')
  return { title: t('title') }
}

export default async function PaymentsPage() {
  const session = await requireSession()
  const t = await getTranslations('payments')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const [rows, summary] = await Promise.all([
    listPayments(session.actor),
    paymentSummary(session.actor),
  ])

  return (
    <Register
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        {
          label: t('received'),
          value: summary.currency
            ? formatMoney({ amount: Number(summary.received), currency: summary.currency }, locale)
            : '—',
        },
        { label: t('count'), value: summary.count },
        { label: t('unallocated'), value: summary.unallocated },
      ]}
      isEmpty={rows.length === 0}
      empty={{ icon: 'payments', title: t('noneYet'), description: t('noneYetHint') }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('receivedOn')}</TH>
            <TH>{t('customer')}</TH>
            <TH>{t('reference')}</TH>
            <TH>{t('method')}</TH>
            <TH align="end">{t('amount')}</TH>
            <TH align="end">{t('allocated')}</TH>
            <TH>{t('recordedBy')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const unallocated = Number(row.amount) - Number(row.allocated)
            return (
              <TR key={row.id} flag={unallocated > 0 ? 'caution' : undefined}>
                <TD className="whitespace-nowrap text-ink">
                  {formatDate(new Date(row.receivedOn), locale)}
                </TD>
                <TD className="font-medium text-ink">{row.customerName ?? '—'}</TD>
                <TD className="ref text-ink-muted">{row.reference ?? '—'}</TD>
                <TD>
                  {row.method ? (
                    <Badge tone="info">{t(`methods.${row.method}`)}</Badge>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </TD>
                <TD align="end" numeric>
                  {formatMoney({ amount: Number(row.amount), currency: row.currency }, locale)}
                </TD>
                <TD
                  align="end"
                  numeric
                  className={unallocated > 0 ? 'text-caution' : 'text-ink-subtle'}
                >
                  {unallocated > 0
                    ? t('unallocatedAmount', {
                        amount: formatMoney(
                          { amount: unallocated, currency: row.currency },
                          locale,
                        ),
                      })
                    : t('fullyAllocated')}
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">{row.recordedBy ?? '—'}</TD>
              </TR>
            )
          })}
        </TBody>
      </TableShell>
    </Register>
  )
}
