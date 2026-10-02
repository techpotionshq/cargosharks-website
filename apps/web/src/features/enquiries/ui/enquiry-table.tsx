/**
 * The enquiry queue — Moment 3a, "five mailboxes become one board".
 *
 * A server component: it renders from data the page already has and ships no
 * JavaScript for the table itself. There is no client-side state manager in
 * this application and none is planned (§1) — the server holds the state, and
 * a Server Action mutation revalidates the path.
 *
 * The column that carries the whole point is the last one. Their own company
 * profile publishes five separate operational mailboxes, and nothing today
 * gives an enquiry an owner, a clock, or a trace if it is never answered
 * (`PP-03`, `PP-06`, `PP-07`). So the clock is not a timestamp — it is
 * "in 3 hours" or "18 hours ago", coloured, with the breached rows flagged
 * down the inline-start edge where the eye lands first.
 */

import Link from 'next/link'
import { getTimeZone, getTranslations } from 'next-intl/server'
import type { EnquirySummary } from '@/lib/pilot/types'
import { formatDateTime, formatMoney, formatRelative } from '@/lib/format'
import { Badge, enquiryTone, slaTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { EmptyState, Lane } from '@/ui/layout'

export async function EnquiryTable({
  rows,
  locale,
  showMargin = true,
}: {
  readonly rows: readonly EnquirySummary[]
  readonly locale: 'en' | 'ar'
  /**
   * Buy-side numbers are internal (`FR-EQ-07`). The flag exists so the same
   * table can serve a screen that must not show them, rather than a second
   * table being written that forgets a column later.
   */
  readonly showMargin?: boolean
}) {
  const timeZone = await getTimeZone()

  const t = await getTranslations('enquiry')
  const tc = await getTranslations('common')
  const tMode = await getTranslations('mode')
  const now = Date.now()

  if (rows.length === 0) {
    return <EmptyState icon="enquiries" title={t('empty')} description={t('emptyHint')} />
  }

  return (
    <TableShell>
      <THead>
        <TR>
          <TH>{t('reference')}</TH>
          <TH>{t('customer')}</TH>
          <TH>{t('lane')}</TH>
          <TH>{t('mode')}</TH>
          <TH>{t('owner')}</TH>
          <TH>{t('status')}</TH>
          {showMargin ? <TH align="end">{t('value')}</TH> : null}
          {showMargin ? <TH align="end">{t('margin')}</TH> : null}
          <TH align="end">{t('slaDue')}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const tone = slaTone(row.slaDueAt, row.firstRespondedAt, now)
          const breached = tone === 'critical'

          return (
            <TR key={row.id} flag={breached ? 'critical' : undefined}>
              {/* A reference and an owner name are identifiers: wrapping them
                  across two lines costs a row of height on every row. */}
              <TD className="whitespace-nowrap">
                <Link
                  href={`/enquiries/${row.id}`}
                  className="ref numeric font-medium text-ink hover:text-accent hover:underline"
                >
                  {row.reference}
                </Link>
                <span className="mt-0.5 block text-[0.6875rem] text-ink-subtle">
                  {t(`channels.${row.channel}` as 'channels.email')}
                </span>
              </TD>

              {/*
                Both name columns exist on every entity a document renders
                (§11); the Arabic one is preferred when the user reads Arabic.
              */}
              <TD className="max-w-56 truncate">
                {locale === 'ar' ? row.customerNameAr : row.customerName}
              </TD>

              <TD className="text-ink-muted">
                <Lane origin={row.originName} destination={row.destinationName} />
              </TD>

              <TD>
                {row.mode ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-muted">
                    <Icon name={modeIcon(row.mode)} size={15} />
                    <span className="hidden lg:inline">{tMode(row.mode)}</span>
                  </span>
                ) : (
                  '—'
                )}
              </TD>

              <TD
                className={`whitespace-nowrap ${row.owner ? 'text-ink' : 'text-ink-subtle italic'}`}
              >
                {row.owner ?? tc('unassigned')}
              </TD>

              <TD>
                <Badge tone={enquiryTone(row.status)} dot>
                  {t(`statuses.${row.status}` as 'statuses.new')}
                </Badge>
              </TD>

              {showMargin ? (
                <TD align="end" numeric className="text-ink-muted">
                  {formatMoney(row.quotedSell, locale, { showCurrency: false })}
                </TD>
              ) : null}

              {showMargin ? (
                <TD align="end" numeric>
                  {row.quotedMargin === null ? (
                    <span className="text-ink-subtle">—</span>
                  ) : (
                    <span
                      className={
                        // A thin margin is a commercial exception, and the ops
                        // board is where it should first be visible.
                        row.quotedMargin < 12 ? 'font-medium text-caution' : 'text-ink'
                      }
                    >
                      {row.quotedMargin.toFixed(1)}%
                    </span>
                  )}
                </TD>
              ) : null}

              <TD align="end" numeric className="whitespace-nowrap">
                {row.firstRespondedAt ? (
                  <span
                    className="text-positive"
                    title={formatDateTime(row.firstRespondedAt, locale, timeZone)}
                  >
                    <Icon name="check" size={13} className="inline align-[-2px]" />{' '}
                    {formatRelative(row.firstRespondedAt, locale, now)}
                  </span>
                ) : row.slaDueAt ? (
                  <span
                    className={
                      breached
                        ? 'font-semibold text-critical'
                        : tone === 'caution'
                          ? 'font-medium text-caution'
                          : 'text-ink-muted'
                    }
                    title={formatDateTime(row.slaDueAt, locale, timeZone)}
                  >
                    {formatRelative(row.slaDueAt, locale, now)}
                    {breached ? ` · ${t('overdue')}` : ''}
                  </span>
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </TD>
            </TR>
          )
        })}
      </TBody>
    </TableShell>
  )
}
