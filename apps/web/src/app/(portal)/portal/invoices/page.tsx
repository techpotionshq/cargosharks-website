/**
 * The customer's invoices — `FR-CP-09`, D12.
 *
 * What we billed, what they paid, and what is still owed, for issued
 * documents only: `invoices_customer_reads` keeps drafts, approved-but-unissued
 * and voided invoices out of the result, as it keeps other companies' out.
 *
 * The balance is per currency and never summed across them. A customer billed
 * in dinars by Kuwait and in dirhams by Dubai owes two amounts, and a single
 * figure labelled with whichever currency came first would be a number neither
 * entity could reconcile (F45).
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { D, todayIn } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { listPortalInvoices } from '@/features/portal/queries'
import { isOverdue } from '@/features/portal/status'
import { sumByCurrency } from '@/lib/by-currency'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatNumber } from '@/lib/format'
import { Card } from '@/ui/card'
import { Button, EmptyState, PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge, invoiceTone } from '@/ui/status'
import { Money } from '@/ui/money'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portalInvoices')
  return { title: t('title') }
}

export default async function PortalInvoicesPage() {
  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const invoices = await listPortalInvoices(session.actor, locale)

  const t = await getTranslations('portalInvoices')
  const today = todayIn()

  const statusLabel: Record<string, string> = {
    issued: t('statusIssued'),
    part_paid: t('statusPartPaid'),
    paid: t('statusPaid'),
    credited: t('statusCredited'),
  }
  const owing = sumByCurrency(
    invoices
      .filter((invoice) => !invoice.isCreditNote)
      .map((invoice) => ({ currency: invoice.currency, amount: invoice.balance })),
  ).filter((entry) => new D(entry.amount).greaterThan(0))
  const overdue = invoices.filter((invoice) => isOverdue(invoice, today)).length

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="mb-5 grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <StatTile
          label={t('outstanding')}
          icon="finance"
          hint={owing.length > 1 ? t('outstandingHint') : undefined}
          value={
            owing.length === 0 ? (
              t('nothingDue')
            ) : (
              <span className="flex flex-col">
                {owing.map((entry) => (
                  <Money key={entry.currency} value={entry} locale={locale} />
                ))}
              </span>
            )
          }
        />
        <StatTile
          label={t('overdueCount')}
          value={formatNumber(overdue, locale)}
          icon="clock"
          tone={overdue > 0 ? 'caution' : 'muted'}
        />
      </div>

      {invoices.length === 0 ? (
        <Card>
          <EmptyState icon="invoices" title={t('empty')} description={t('emptyHint')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices.map((invoice) => {
            const late = isOverdue(invoice, today)
            const href = `/portal/invoices/${invoice.id}`
            return (
              <li key={invoice.id}>
                <Card className="transition-shadow hover:shadow-raised">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="ref numeric text-title font-semibold text-ink">
                          {invoice.seriesNo ?? '—'}
                        </span>
                        {invoice.isCreditNote ? (
                          <Badge tone="info">{t('creditNote')}</Badge>
                        ) : (
                          <Badge tone={invoiceTone(invoice.status)} dot>
                            {statusLabel[invoice.status] ?? invoice.status}
                          </Badge>
                        )}
                        {late ? (
                          <Badge tone="caution" icon="clock">
                            {t('overdue')}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-body-sm text-ink-muted">
                        {t('issued')}: {formatDate(invoice.issuedAt, locale)}
                        {invoice.dueOn && !invoice.isCreditNote ? (
                          <>
                            {' · '}
                            {t('due')}: {formatDate(invoice.dueOn, locale)}
                          </>
                        ) : null}
                      </p>
                      {invoice.isCreditNote && invoice.creditsSeriesNo ? (
                        <p className="mt-1 text-caption text-ink-subtle">
                          {t('creditsInvoice', { number: invoice.creditsSeriesNo })}
                        </p>
                      ) : null}
                    </div>

                    <div className="text-end">
                      <p className="eyebrow mb-1">
                        {invoice.isCreditNote ? t('total') : t('balance')}
                      </p>
                      <p className="text-title font-semibold text-ink">
                        <Money
                          value={{
                            amount: invoice.isCreditNote ? invoice.total : invoice.balance,
                            currency: invoice.currency,
                          }}
                          locale={locale}
                        />
                      </p>
                      {invoice.isCreditNote ? null : (
                        <p className="text-micro text-ink-subtle">
                          {t('total')}:{' '}
                          <Money
                            value={{ amount: invoice.total, currency: invoice.currency }}
                            locale={locale}
                            showCurrency={false}
                          />
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end border-t border-line pt-3">
                    <Button href={href} variant="ghost" size="sm" iconEnd="chevron-end">
                      {t('viewInvoice')}
                    </Button>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
