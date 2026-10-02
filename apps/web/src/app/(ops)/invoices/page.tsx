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
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { invoiceSummary, listInvoices } from '@/features/ledger/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { Register, RecordLink } from '@/ui/register'
import { Badge, invoiceTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Money } from '@/ui/money'
import { InvoiceDialog } from '@/features/ledger/ui/dialogs'
import { todayIn } from '@/lib/time'
import { dec } from '@qabandi/core'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invoices')
  return { title: t('title') }
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const { status } = await searchParams
  const t = await getTranslations('invoices')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const today = todayIn()

  /*
    `overdue` is not a status in the enum — it is a status *and* a date — so it
    cannot be asked of the query. It reads every invoice and keeps the ones
    the rule below flags, which is the same rule that draws the red rule on a
    row, so the filter and the flags cannot disagree.
  */
  const overdueView = status === 'overdue'
  const [all, summary] = await Promise.all([
    listInvoices(session.actor, overdueView ? undefined : status, locale),
    invoiceSummary(session.actor),
  ])

  // Decimal: a balance is money minus money (see the money rule in CLAUDE.md).
  const balanceOf = (row: (typeof all)[number]) =>
    dec(row.total ?? 0).minus(dec(row.amountPaid ?? 0))
  const isOverdue = (row: (typeof all)[number]) =>
    row.status === 'issued' && row.dueOn !== null && row.dueOn < today && balanceOf(row).gt(0)
  const rows = overdueView ? all.filter(isOverdue) : all

  return (
    <Register
      actions={<InvoiceDialog />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        {
          label: t('outstanding'),
          /*
            One figure per currency, never one sum. Dinars and dirhams do not
            add, and the single total this replaced was labelled with whichever
            currency the newest invoice happened to be in.
          */
          value:
            summary.outstanding.length > 0
              ? summary.outstanding
                  .map(({ currency, amount }) => formatMoney({ amount: amount, currency }, locale))
                  .join(' · ')
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
        // The summary counts overdue, so the strip offers it.
        {
          label: t('statuses.overdue'),
          href: '/invoices?status=overdue',
          count: summary.overdue,
          active: overdueView,
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
            <TH priority="low">{t('customer')}</TH>
            <TH>{tc('status')}</TH>
            {/*
              On a phone the row is the reference, the state and what is still
              owed: the balance is the figure anyone acts on, and the total and
              due date are one tap away on the invoice itself. Four columns at
              390px pushed the money off the edge of the screen.
            */}
            <TH align="end" priority="low">
              {t('total')}
            </TH>
            <TH align="end">{t('balance')}</TH>
            <TH priority="low">{t('issued')}</TH>
            <TH priority="low">{t('due')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const balance = balanceOf(row)
            const overdue = isOverdue(row)
            return (
              <TR key={row.id} flag={overdue ? 'critical' : undefined}>
                <TD>
                  {/*
                    A draft has no series number, and the link has to say
                    something anyway.

                    `series_no` is allocated at approval, so every draft
                    rendered `<a></a>` — a row whose only way into the record
                    was an empty, unclickable link. It survived because the
                    detail routes were never opened offline and the demo
                    dataset happens not to sort a draft to the top.
                    `loadOutstandingInvoices` already coalesces to the same
                    word in SQL.
                  */}
                  <RecordLink href={`/invoices/${row.id}`}>
                    {row.seriesNo ?? t('statuses.draft')}
                  </RecordLink>
                  {row.isCreditNote ? (
                    <Badge tone="caution" className="ms-2">
                      {t('creditNote')}
                    </Badge>
                  ) : null}
                </TD>
                <TD priority="low" className="font-medium text-ink">
                  {row.customerName ?? '—'}
                </TD>
                <TD>
                  <Badge tone={overdue ? 'critical' : invoiceTone(row.status)} dot>
                    {overdue ? t('statuses.overdue') : t(`statuses.${row.status}`)}
                  </Badge>
                </TD>
                <TD align="end" numeric priority="low">
                  <Money
                    value={row.total ? { amount: row.total, currency: row.currency } : null}
                    locale={locale}
                  />
                </TD>
                <TD
                  align="end"
                  numeric
                  className={balance.gt(0) ? 'font-semibold text-ink' : 'text-ink-subtle'}
                >
                  <Money
                    value={{ amount: balance.toFixed(), currency: row.currency }}
                    locale={locale}
                  />
                </TD>
                <TD priority="low" className="whitespace-nowrap text-ink-muted">
                  {row.issuedAt ? formatDate(row.issuedAt, locale, timeZone) : '—'}
                </TD>
                <TD
                  priority="low"
                  className={`whitespace-nowrap ${overdue ? 'font-semibold text-critical' : 'text-ink-muted'}`}
                >
                  {row.dueOn ? formatDate(new Date(row.dueOn), locale, timeZone) : '—'}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </TableShell>
    </Register>
  )
}
