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
import { formatDateTime, formatRelative } from '@/lib/format'
import { Badge, enquiryTone, slaTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { Money } from '@/ui/money'
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
          <TH priority="low">{t('customer')}</TH>
          <TH priority="low">{t('lane')}</TH>
          <TH priority="low">{t('mode')}</TH>
          <TH priority="low">{t('owner')}</TH>
          <TH>{t('status')}</TH>
          {showMargin ? (
            <TH priority="low" align="end">
              {t('value')}
            </TH>
          ) : null}
          {/* The queue is worked by its clock: on a phone the SLA column is
              the figure that stays, and margin waits for a wider screen. */}
          {showMargin ? (
            <TH priority="low" align="end">
              {t('margin')}
            </TH>
          ) : null}
          <TH align="end">{t('slaDue')}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const tone = slaTone(row.slaDueAt, row.firstRespondedAt, now)
          const breached = tone === 'critical'

          return (
            <TR key={row.id} flag={breached ? 'critical' : undefined}>
              {/* A reference is an identifier and never breaks. An owner's
                  name may: the row is two lines tall already. */}
              <TD className="whitespace-nowrap">
                <Link
                  href={`/enquiries/${row.id}`}
                  className="ref numeric font-medium text-ink hover:text-accent hover:underline"
                >
                  {row.reference}
                </Link>
                <span className="mt-0.5 block text-micro text-ink-subtle">
                  {t(`channels.${row.channel}` as 'channels.email')}
                </span>
              </TD>

              {/*
                Both name columns exist on every entity a document renders
                (§11); the Arabic one is preferred when the user reads Arabic.
              */}
              {/* Wraps rather than truncates: the reference cell is already
                  two lines tall, so a two-line name costs no height, and a
                  truncated one held the column at its full one-line width
                  anyway — the table sizes a cell to its unbroken text. */}
              <TD priority="low" className="min-w-28">
                {locale === 'ar' ? row.customerNameAr : row.customerName}
              </TD>

              <TD priority="low" className="text-ink-muted">
                <Lane origin={row.originName} destination={row.destinationName} />
              </TD>

              <TD priority="low">
                {row.mode ? (
                  // The name joins the icon only at 2xl. Between lg and 2xl
                  // "Sea FCL" was 50px the queue could not spare; the icon
                  // says the mode, and the title and screen-reader text keep
                  // the word reachable.
                  <span
                    className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-muted"
                    title={tMode(row.mode)}
                  >
                    <Icon name={modeIcon(row.mode)} size={15} />
                    <span className="sr-only 2xl:not-sr-only">{tMode(row.mode)}</span>
                  </span>
                ) : (
                  '—'
                )}
              </TD>

              <TD priority="low" className={row.owner ? 'text-ink' : 'text-ink-subtle italic'}>
                {row.owner ?? tc('unassigned')}
              </TD>

              <TD>
                <Badge tone={enquiryTone(row.status)} dot>
                  {t(`statuses.${row.status}` as 'statuses.new')}
                </Badge>
              </TD>

              {showMargin ? (
                <TD priority="low" align="end" numeric className="text-ink-muted">
                  {/* With its currency (QA P3): one queue carries AED and KWD
                      quotes, and a bare 1,250 read the same in both. */}
                  <Money value={row.quotedSell} locale={locale} />
                </TD>
              ) : null}

              {showMargin ? (
                <TD priority="low" align="end" numeric>
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
                    {/* Its own line below 2xl, where "6 hours ago · Overdue"
                        on one line was wider than the column could be — on a
                        phone, and again at 1280 with every column showing. */}
                    {breached ? (
                      <>
                        <span className="hidden 2xl:inline"> · </span>
                        <span className="block 2xl:inline">{t('overdue')}</span>
                      </>
                    ) : null}
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
