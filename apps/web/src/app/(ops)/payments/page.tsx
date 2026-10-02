/**
 * The payments register — `FR-FI-08`.
 *
 * Receipts, newest first, with what has been matched against invoices. The
 * column worth having is the unallocated balance: a payment sitting in the
 * bank that nobody has matched is money you have but cannot close a ledger
 * with, and it is invisible on every other screen.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { listPayments, paymentSummary } from '@/features/ledger/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { formatByCurrency } from '@/lib/by-currency'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Money } from '@/ui/money'
import { dec, fromDb, toScale } from '@qabandi/core'
import { AllocateReceiptDialog, PaymentDialog } from '@/features/ledger/ui/dialogs'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('payments')
  return { title: t('title') }
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  // The ledger's own read key (QA P2-11): a session alone let every internal
  // role, read-only included, open it. Not found rather than forbidden, as
  // with every screen a principal has no business knowing about.
  if (!can(session, 'receivable.read')) notFound()
  const t = await getTranslations('payments')
  const tc = await getTranslations('common')
  const view = (await searchParams).view === 'unallocated' ? 'unallocated' : 'all'
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const [all, summary] = await Promise.all([
    listPayments(session.actor, locale),
    paymentSummary(session.actor),
  ])

  // Decimal, never a float: this is money minus money, and the filter below
  // and the flag on each row must agree to the last fils.
  const remaining = (row: (typeof all)[number]) => dec(row.amount).minus(dec(row.allocated))
  /*
    The filter the summary promised. "Unallocated 3" sat above the table with
    no way to see which three; it is the one figure here a finance clerk acts
    on, so it is now a filter of its own, counted from the same rows.
  */
  const rows = view === 'unallocated' ? all.filter((row) => remaining(row).gt(0)) : all

  return (
    <Register
      actions={<PaymentDialog />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        {
          label: t('received'),
          // One figure per currency, never one sum — as the invoice register's.
          value: formatByCurrency(summary.received, locale),
        },
        { label: t('count'), value: summary.count },
        { label: t('unallocated'), value: summary.unallocated },
      ]}
      filters={[
        { label: tc('all'), href: '/payments', count: all.length, active: view === 'all' },
        {
          label: t('unallocated'),
          href: '/payments?view=unallocated',
          count: summary.unallocated,
          active: view === 'unallocated',
        },
      ]}
      isEmpty={rows.length === 0}
      empty={{ icon: 'payments', title: t('noneYet'), description: t('noneYetHint') }}
    >
      <TableShell>
        <THead>
          <TR>
            {/* On a phone a receipt is who paid, how much, and what is left to
                allocate: the date and the allocation ride as second lines
                under the customer and the amount (below). */}
            <TH priority="low">{t('receivedOn')}</TH>
            <TH>{t('customer')}</TH>
            <TH priority="low">{t('reference')}</TH>
            <TH priority="low">{t('method')}</TH>
            <TH align="end">{t('amount')}</TH>
            <TH priority="low" align="end">
              {t('allocated')}
            </TH>
            <TH priority="lowest">{t('recordedBy')}</TH>
            <TH align="end">{t('allocate')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const unallocated = remaining(row)
            const open = unallocated.gt(0)
            const allocation = open
              ? t('unallocatedAmount', {
                  amount: formatMoney(
                    { amount: unallocated.toFixed(), currency: row.currency },
                    locale,
                  ),
                })
              : t('fullyAllocated')
            return (
              <TR key={row.id} flag={open ? 'caution' : undefined}>
                <TD priority="low" className="whitespace-nowrap text-ink">
                  {formatDate(new Date(row.receivedOn), locale, timeZone)}
                </TD>
                <TD className="font-medium text-ink">
                  {row.customerName ?? '—'}
                  <span className="block text-micro font-normal whitespace-nowrap text-ink-subtle @3xl:hidden">
                    {formatDate(new Date(row.receivedOn), locale, timeZone)}
                  </span>
                </TD>
                <TD priority="low" className="ref text-ink-muted">
                  {row.reference ?? '—'}
                </TD>
                <TD priority="low">
                  {row.method ? (
                    <Badge tone="info">{t(`methods.${row.method}`)}</Badge>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </TD>
                <TD align="end" numeric>
                  <Money value={{ amount: row.amount, currency: row.currency }} locale={locale} />
                  <span
                    // May wrap after the figure: on one line this second line
                    // was wider than the amount it sits under.
                    className={`block text-micro whitespace-normal @3xl:hidden ${open ? 'text-caution' : 'text-ink-subtle'}`}
                  >
                    {allocation}
                  </span>
                </TD>
                <TD
                  priority="low"
                  align="end"
                  numeric
                  className={open ? 'text-caution' : 'text-ink-subtle'}
                >
                  {/* May wrap after the figure, which itself never breaks
                      (Intl joins code and amount with a no-break space):
                      "KWD 1,500.000 unmatched" on one line was 192px, and
                      the reason this register scrolled at 1280. */}
                  <span className="whitespace-normal">{allocation}</span>
                </TD>
                <TD priority="lowest" className="whitespace-nowrap text-ink-muted">
                  {row.recordedBy ?? '—'}
                </TD>
                <TD align="end">
                  {open ? (
                    <AllocateReceiptDialog
                      paymentId={row.id}
                      // Decimal, at the currency's precision: this is typed
                      // straight back into the action as the amount.
                      unallocated={toScale(
                        fromDb(dec(row.amount).minus(dec(row.allocated)).toFixed(), row.currency),
                      )}
                    />
                  ) : null}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </TableShell>
    </Register>
  )
}
