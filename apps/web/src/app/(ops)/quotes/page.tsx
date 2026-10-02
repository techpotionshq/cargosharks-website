/**
 * The quotation register — `FR-EQ-05…09`.
 *
 * Margin is a column, not a detail-page figure. The pilot's second moment is
 * "a quote in ninety seconds, with the margin visible at the point of
 * decision" — a register that shows the sell price and hides what it cost puts
 * the salesperson back in the spreadsheet they were meant to leave.
 *
 * The margin shown is the one frozen into `priced_snapshot` at quoting time,
 * never recomputed against today's rate card (§6.3).
 */

import type { Metadata } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listQuotes, quoteStatusCounts } from '@/features/ledger/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate } from '@/lib/format'
import { Register, RecordLink } from '@/ui/register'
import { Badge, quoteTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Money } from '@/ui/money'
import { QuoteDialog } from '@/features/ledger/ui/dialogs'

/** Margin from the two frozen totals. Null where either is missing. */
function marginPercent(sell: string | null, cost: string | null): number | null {
  if (!sell || !cost) return null
  const sellValue = Number(sell)
  const costValue = Number(cost)
  if (!Number.isFinite(sellValue) || !Number.isFinite(costValue) || sellValue === 0) return null
  return ((sellValue - costValue) / sellValue) * 100
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('quotes')
  return { title: t('title') }
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const { status } = await searchParams
  const t = await getTranslations('quotes')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const [rows, counts] = await Promise.all([
    listQuotes(session.actor, status, locale),
    quoteStatusCounts(session.actor),
  ])

  const total = counts.reduce((sum, row) => sum + row.count, 0)
  const won = counts.find((row) => row.status === 'accepted')?.count ?? 0
  const decided = won + (counts.find((row) => row.status === 'rejected')?.count ?? 0)

  return (
    <Register
      actions={<QuoteDialog />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('total'), value: total },
        { label: t('won'), value: won },
        {
          label: t('winRate'),
          value: decided ? `${Math.round((won / decided) * 100)}%` : '—',
        },
      ]}
      filters={[
        { label: tc('all'), href: '/quotes', count: total, active: !status },
        ...counts.map((row) => ({
          label: t(`statuses.${row.status}`),
          href: `/quotes?status=${row.status}`,
          count: row.count,
          active: status === row.status,
        })),
      ]}
      isEmpty={rows.length === 0}
      empty={{
        icon: 'quotes',
        title: status ? t('noneMatching') : t('noneYet'),
        description: status ? undefined : t('noneYetHint'),
      }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('reference')}</TH>
            <TH priority="low">{t('customer')}</TH>
            <TH>{tc('status')}</TH>
            <TH align="end">{t('sell')}</TH>
            {/* Margin rides under the sell figure on a phone (below). */}
            <TH priority="low" align="end">
              {t('margin')}
            </TH>
            <TH priority="low">{t('validUntil')}</TH>
            <TH priority="low">{t('preparedBy')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const margin = marginPercent(row.totalSell, row.totalCost)
            const marginClass =
              margin === null
                ? 'text-ink-subtle'
                : margin < 8
                  ? 'font-semibold text-critical'
                  : margin < 15
                    ? 'text-caution'
                    : 'text-ink'
            const marginText = margin === null ? '—' : `${margin.toFixed(1)}%`
            return (
              <TR key={row.id}>
                <TD>
                  <RecordLink href={`/quotes/${row.id}`}>{row.reference}</RecordLink>
                  {row.version > 1 ? (
                    // Under the reference on a phone: beside it, the pair
                    // could not break and set the column's floor.
                    <span className="numeric block text-[0.75rem] text-ink-subtle md:ms-1.5 md:inline">
                      v{row.version}
                    </span>
                  ) : null}
                </TD>
                <TD priority="low" className="font-medium text-ink">
                  {row.customerName ?? '—'}
                </TD>
                <TD>
                  <Badge tone={quoteTone(row.status)} dot>
                    {t(`statuses.${row.status}`)}
                  </Badge>
                </TD>
                <TD align="end" numeric>
                  <Money
                    value={row.totalSell ? { amount: row.totalSell, currency: row.currency } : null}
                    locale={locale}
                  />
                  {/* A quote's sell figure without its margin is half the
                      answer, so a phone gets the margin as a second line
                      rather than a column it would have to scroll to. */}
                  <span className={`block text-[0.6875rem] md:hidden ${marginClass}`}>
                    {marginText}
                  </span>
                </TD>
                <TD priority="low" align="end" numeric className={marginClass}>
                  {marginText}
                </TD>
                <TD priority="low" className="whitespace-nowrap text-ink-muted">
                  {row.validUntil ? formatDate(new Date(row.validUntil), locale, timeZone) : '—'}
                </TD>
                <TD priority="low" className="whitespace-nowrap text-ink-muted">
                  {row.preparedBy ?? '—'}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </TableShell>
    </Register>
  )
}
