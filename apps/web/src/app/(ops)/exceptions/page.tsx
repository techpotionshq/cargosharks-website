/**
 * The exceptions register — `FR-JB-09`.
 *
 * Oldest first, across every live shipment. The dashboard shows the top eight;
 * this is the whole list, and it is the screen an operations manager works
 * down on a Monday morning.
 *
 * Rows past their resolution window carry an inline-start rule rather than a
 * red background: forty red rows is the same as no red rows.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { exceptionCounts, listExceptions } from '@/features/operations/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatRelative, trimDecimal } from '@/lib/format'
import { Register, RecordLink } from '@/ui/register'
import { Badge, severityTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Money } from '@/ui/money'
import { RaiseExceptionDialog } from '@/features/operations/ui/dialogs'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('exceptions')
  return { title: t('title') }
}

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>
}) {
  const session = await requireSession()
  const { scope } = await searchParams
  const view = scope === 'closed' ? 'closed' : scope === 'all' ? 'all' : 'open'

  const t = await getTranslations('exceptions')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  const [rows, counts] = await Promise.all([
    listExceptions(session.actor, view, locale),
    exceptionCounts(session.actor),
  ])

  return (
    <Register
      actions={<RaiseExceptionDialog />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('open'), value: counts.open },
        { label: t('overdue'), value: counts.overdue },
        { label: t('closed'), value: counts.closed },
      ]}
      filters={[
        { label: t('open'), href: '/exceptions', count: counts.open, active: view === 'open' },
        {
          label: t('closed'),
          href: '/exceptions?scope=closed',
          count: counts.closed,
          active: view === 'closed',
        },
        { label: tc('all'), href: '/exceptions?scope=all', active: view === 'all' },
      ]}
      isEmpty={rows.length === 0}
      empty={{
        icon: 'check',
        title: view === 'open' ? t('noneOpen') : t('noneMatching'),
        description: view === 'open' ? t('noneOpenHint') : undefined,
      }}
    >
      <TableShell>
        <THead>
          <TR>
            {/* On a phone the shipment reference moves under the problem
                (below), so the row is problem, severity and due — what a
                person paged about an exception needs first. */}
            <TH priority="low">{t('shipment')}</TH>
            <TH>{t('problem')}</TH>
            <TH priority="low">{t('customer')}</TH>
            <TH>{t('severity')}</TH>
            <TH priority="low">{t('opened')}</TH>
            <TH>{t('due')}</TH>
            <TH priority="low">{t('owner')}</TH>
            <TH priority="low" align="end">
              {t('cost')}
            </TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const overdue = !row.closedAt && row.dueAt !== null && row.dueAt.getTime() < now
            return (
              <TR key={row.id} flag={overdue ? 'critical' : undefined}>
                <TD priority="low">
                  <RecordLink href={`/jobs/${row.jobId}`}>{row.jobReference}</RecordLink>
                </TD>
                <TD>
                  <span className="block md:hidden">
                    <RecordLink href={`/jobs/${row.jobId}`}>{row.jobReference}</RecordLink>
                  </span>
                  <span className="font-medium text-ink">
                    {locale === 'ar' ? row.nameAr : row.nameEn}
                  </span>
                  {row.description ? (
                    <span
                      dir="auto"
                      // Two wrapped lines at every width. A one-line
                      // truncation shows four words on a phone, and on a
                      // desktop it held the column at 374px — a truncated
                      // cell still asks the table for its unbroken width —
                      // which is what made the register scroll at 1280. The
                      // title keeps the whole description a hover away.
                      title={row.description}
                      className="mt-0.5 line-clamp-2 max-w-md text-caption break-words text-ink-muted"
                    >
                      {row.description}
                    </span>
                  ) : null}
                </TD>
                <TD priority="low" className="text-ink-muted">
                  {(locale === 'ar' && row.customerNameAr) || row.customerName || '—'}
                </TD>
                <TD>
                  <Badge tone={severityTone(row.severity)} dot>
                    {t(`severities.${row.severity}`)}
                  </Badge>
                </TD>
                <TD priority="low" className="whitespace-nowrap text-ink-muted">
                  {formatRelative(row.openedAt, locale, now)}
                </TD>
                <TD
                  className={`whitespace-nowrap ${overdue ? 'font-semibold text-critical' : 'text-ink-muted'}`}
                >
                  {row.dueAt ? formatRelative(row.dueAt, locale, now) : '—'}
                </TD>
                <TD priority="low" className="text-ink-muted">
                  {row.owner ?? t('unassigned')}
                </TD>
                <TD priority="low" align="end" numeric>
                  {/* At the currency's own places, through the column's money
                      cell: trimmed, a dinar impact of 450.500 read "450.5 KWD"
                      beside "1,420.500"-style figures everywhere else. */}
                  {row.costImpact && !row.costCurrency ? (
                    trimDecimal(row.costImpact)
                  ) : (
                    <Money
                      value={
                        row.costImpact && row.costCurrency
                          ? { amount: row.costImpact, currency: row.costCurrency }
                          : null
                      }
                      locale={locale}
                    />
                  )}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </TableShell>
    </Register>
  )
}
