/**
 * Revenue earned and never asked for — the register that makes the leak loud.
 *
 * Every other number on the finance page is about money we *have* asked for:
 * ageing, overdue, top debtors. Those are loud by construction — an invoice
 * ages, appears in a bucket, and gets chased. This card is the opposite case
 * and the reason it is worth its own space: an unbilled charge line never ages,
 * because nothing was ever raised. The shipment closed at a margin nobody
 * questioned, and there was no missing document to notice.
 *
 * ## Ordered by amount, and the age is shown beside it
 *
 * "What is worth doing first" is the question a finance person opens this with,
 * and it is answered by size — a ninety-day-old 12 KWD line is not the answer.
 * The age is shown because it is the argument for *why this exists*: a row that
 * has been sitting for five weeks is the one that would have been lost.
 *
 * ## The button is one act, and its refusals are visible before the click
 *
 * A shipment billing in two currencies cannot become one invoice, and the row
 * says so instead of letting somebody find out at the click. Everything else
 * is a single button that drafts the invoice from the lines already on the
 * job — the draft still has to be approved and issued exactly as before.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate } from '@/lib/format'
import { formatByCurrency } from '@/lib/by-currency'
import { Card, CardHeader } from '@/ui/card'
import { Badge } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { Money } from '@/ui/money'
import { unbilledRevenue } from '../unbilled'
import { BillJobButton } from './bill-job-button'
import { Button } from '@/ui/layout'

/** Rows shown before "Show all": enough to act on, short enough to scan. */
const PREVIEW_ROWS = 5

export async function UnbilledPanel({ showAll = false }: { readonly showAll?: boolean }) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const locale = await getLocale()
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE
  const [summary, t] = await Promise.all([
    unbilledRevenue(session.actor, undefined, lang),
    getTranslations('unbilled'),
  ])
  const shown = showAll ? summary.jobs : summary.jobs.slice(0, PREVIEW_ROWS)
  const hidden = summary.jobs.length - shown.length

  // Nothing to chase is worth saying once, not worth a table with no rows in it.
  if (summary.jobCount === 0) return null

  const billable = can(session, 'invoice.approve')

  return (
    <Card className="mb-4" padding="none">
      <CardHeader
        className="px-5 pt-4 pb-3"
        icon="invoices"
        title={t('title')}
        description={t('description', {
          count: summary.jobCount,
          // One figure per base currency — dinars and dirhams do not add.
          total: formatByCurrency(summary.totals, lang),
        })}
      />
      <TableShell>
        <THead>
          <TR>
            <TH>{t('shipment')}</TH>
            <TH priority="low">{t('customer')}</TH>
            <TH priority="low" align="end">
              {t('lines')}
            </TH>
            <TH align="end">{t('amount')}</TH>
            {/* Under the shipment on a phone (below). */}
            <TH priority="low">{t('oldest')}</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {shown.map((row) => {
            const mixed = row.currencies.length > 1

            return (
              <TR key={row.jobId}>
                <TD className="ref">
                  {row.reference}
                  <span className="block text-micro text-ink-subtle md:hidden">
                    {formatDate(row.oldestAt, lang, timeZone)}
                  </span>
                </TD>
                <TD priority="low">
                  {row.customerName ?? <span className="text-ink-subtle">—</span>}
                </TD>
                <TD priority="low" numeric align="end">
                  {row.lines}
                </TD>
                <TD numeric align="end">
                  <Money
                    value={{ amount: row.amountBase, currency: row.baseCurrency }}
                    locale={lang}
                  />
                  {mixed ? (
                    <Badge tone="caution" className="ms-2">
                      {row.currencies.join(' / ')}
                    </Badge>
                  ) : null}
                </TD>
                <TD priority="low">{formatDate(row.oldestAt, lang, timeZone)}</TD>
                <TD>
                  {billable && !mixed ? (
                    <BillJobButton jobId={row.jobId} label={t('bill')} />
                  ) : mixed ? (
                    <span className="text-caption text-ink-subtle">{t('mixedCurrency')}</span>
                  ) : null}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </TableShell>
      {/*
        A preview, not the whole list. Thirty unbilled jobs at the top of the
        finance page pushed every other figure below the fold; five say "this
        needs doing" and the link says how much.
      */}
      {hidden > 0 ? (
        <div className="border-t border-line px-5 py-2.5">
          <Button href="/finance?unbilled=all" variant="ghost" size="sm" iconEnd="chevron-end">
            {t('showAll', { count: summary.jobs.length })}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
