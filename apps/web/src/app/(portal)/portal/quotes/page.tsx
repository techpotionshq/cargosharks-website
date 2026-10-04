/**
 * The customer's quotations, `FR-CP-07`, D12.
 *
 * Every offer we sent them and what became of it. The same cards as the
 * shipments list beside it, so the portal reads as one place: reference and
 * state, the lane, then the figure and how long it stands.
 *
 * Nothing here filters by customer. The read runs as the contact, and
 * `quotes_customer_reads` is what keeps it to their company's sent, current
 * quotations, a draft or a superseded version is not hidden by this page,
 * it is not in the result.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { todayIn } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { listPortalQuotes } from '@/features/portal/queries'
import { QUOTE_STATE_TONE, portalQuoteState } from '@/features/portal/status'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatNumber } from '@/lib/format'
import { Card } from '@/ui/card'
import { Button, EmptyState, Lane, PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { Money } from '@/ui/money'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portalQuotes')
  return { title: t('title') }
}

export default async function PortalQuotesPage() {
  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const quotes = await listPortalQuotes(session.actor, locale)

  const t = await getTranslations('portalQuotes')
  const tMode = await getTranslations('mode')
  // Validity is a day in Kuwait, where the offer was made, whatever zone the
  // reader's browser is in, the rule the server refuses an answer by.
  const today = todayIn()

  const label = {
    sent: t('statusSent'),
    expired: t('statusExpired'),
    accepted: t('statusAccepted'),
    rejected: t('statusRejected'),
  }
  const states = quotes.map((quote) => portalQuoteState(quote, today))
  const awaiting = states.filter((state) => state === 'sent').length
  const accepted = states.filter((state) => state === 'accepted').length

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="mb-5 grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <StatTile
          label={t('awaiting')}
          value={formatNumber(awaiting, locale)}
          icon="quotes"
          tone={awaiting > 0 ? 'info' : 'muted'}
        />
        <StatTile label={t('accepted')} value={formatNumber(accepted, locale)} icon="check" />
      </div>

      {quotes.length === 0 ? (
        <Card>
          <EmptyState icon="quotes" title={t('empty')} description={t('emptyHint')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {quotes.map((quote, index) => {
            const state = states[index]!
            const href = `/portal/quotes/${quote.id}`
            return (
              <li key={quote.id}>
                <Card className="transition-shadow hover:shadow-raised">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="ref numeric text-title font-semibold text-ink">
                          {quote.reference}
                        </span>
                        <Badge tone={QUOTE_STATE_TONE[state]} dot>
                          {label[state]}
                        </Badge>
                      </div>
                      {quote.originName && quote.destinationName ? (
                        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-ink-muted">
                          {quote.mode ? (
                            <Icon
                              name={modeIcon(quote.mode)}
                              size={16}
                              className="text-ink-subtle"
                            />
                          ) : null}
                          <Lane
                            className="min-w-0"
                            origin={quote.originName}
                            destination={quote.destinationName}
                          />
                          {quote.mode ? (
                            <span className="text-ink-subtle">· {tMode(quote.mode)}</span>
                          ) : null}
                        </p>
                      ) : null}
                    </div>

                    <div className="text-end">
                      <p className="eyebrow mb-1">{t('total')}</p>
                      <p className="text-title font-semibold text-ink">
                        <Money
                          value={
                            quote.total ? { amount: quote.total, currency: quote.currency } : null
                          }
                          locale={locale}
                        />
                      </p>
                      {quote.validUntil ? (
                        <p className="numeric text-micro text-ink-subtle">
                          {t('validUntil')}: {formatDate(quote.validUntil, locale)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end border-t border-line pt-3">
                    <Button href={href} variant="ghost" size="sm" iconEnd="chevron-end">
                      {t('viewQuote')}
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
