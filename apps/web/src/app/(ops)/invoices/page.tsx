/**
 * The invoice register — `FR-FI-01…07`.
 *
 * Sorted newest first, with the receivables position above the table. The
 * column a finance manager scans is not the total, it is total-minus-paid on a
 * row that is past its due date, so overdue rows carry a rule.
 *
 * Credit notes sit in the same list rather than a separate one: they are the
 * reason a balance does not tie, and hiding them is how a reconciliation takes
 * an afternoon.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { invoiceSummary, listInvoices } from '@/features/ledger/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { Register, RecordLink } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { InvoiceDialog } from '@/features/ledger/ui/dialogs'

const STATUS_TONE = {
  draft: 'muted',
  issued: 'info',
  paid: 'positive',
  part_paid: 'caution',
  void: 'muted',
  overdue: 'critical',
} as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invoices')
  return { title: t('title') }
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await requireSession()
  const { status } = await searchParams
  const t = await getTranslations('invoices')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const today = new Date().toISOString().slice(0, 10)

  const [rows, summary] = await Promise.all([
    listInvoices(session.actor, status),
    invoiceSummary(session.actor),
  ])

  return (
    <Register
      actions={<InvoiceDialog />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        {
          label: t('outstanding'),
          value: summary.currency
            ? formatMoney(
                { amount: Number(summary.outstanding), currency: summary.currency },
                locale,
              )
            : '—',
        },
        { label: t('issued'), value: summary.issued },
        { label: t('overdue'), value: summary.overdue },
        { label: t('paid'), value: summary.paid },
      ]}
      filters={[
        { label: tc('all'), href: '/invoices', active: !status },
        {
          label: t('statuses.issued'),
          href: '/invoices?status=issued',
          count: summary.issued,
          active: status === 'issued',
        },
        {
          label: t('statuses.paid'),
          href: '/invoices?status=paid',
          count: summary.paid,
          active: status === 'paid',
        },
      ]}
      isEmpty={rows.length === 0}
      empty={{
        icon: 'invoices',
        title: status ? t('noneMatching') : t('noneYet'),
        description: status ? undefined : t('noneYetHint'),
      }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('number')}</TH>
            <TH>{t('customer')}</TH>
            <TH>{tc('status')}</TH>
            <TH align="end">{t('total')}</TH>
            <TH align="end">{t('balance')}</TH>
            <TH>{t('issued')}</TH>
            <TH>{t('due')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const balance = Number(row.total ?? 0) - Number(row.amountPaid ?? 0)
            const overdue =
              row.status === 'issued' && row.dueOn !== null && row.dueOn < today && balance > 0
            return (
              <TR key={row.id} flag={overdue ? 'critical' : undefined}>
                <TD>
                  <RecordLink href={`/invoices/${row.id}`}>{row.seriesNo}</RecordLink>
                  {row.isCreditNote ? (
                    <Badge tone="caution" className="ms-2">
                      {t('creditNote')}
                    </Badge>
                  ) : null}
                </TD>
                <TD className="font-medium text-ink">{row.customerName ?? '—'}</TD>
                <TD>
                  <Badge
                    tone={
                      overdue
                        ? 'critical'
                        : (STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? 'muted')
                    }
                    dot
                  >
                    {overdue ? t('statuses.overdue') : t(`statuses.${row.status}`)}
                  </Badge>
                </TD>
                <TD align="end" numeric>
                  {row.total
                    ? formatMoney({ amount: Number(row.total), currency: row.currency }, locale)
                    : '—'}
                </TD>
                <TD
                  align="end"
                  numeric
                  className={balance > 0 ? 'font-semibold text-ink' : 'text-ink-subtle'}
                >
                  {formatMoney({ amount: balance, currency: row.currency }, locale)}
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">
                  {row.issuedAt ? formatDate(row.issuedAt, locale) : '—'}
                </TD>
                <TD
                  className={`whitespace-nowrap ${overdue ? 'font-semibold text-critical' : 'text-ink-muted'}`}
                >
                  {row.dueOn ? formatDate(new Date(row.dueOn), locale) : '—'}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </TableShell>
    </Register>
  )
}
