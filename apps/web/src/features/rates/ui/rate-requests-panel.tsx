/**
 * Rate procurement on the enquiry — ask agents, read the replies, pick one.
 *
 * The panel that replaces the manual rate-card upload for a live lane: a
 * coordinator asks the covering agents, the service mails them and reads their
 * replies, and this ranks what came back so the cheapest is one click from a
 * buy card. Cheapest is computed on the branch's base currency (FR-RT-06), so a
 * USD reply and a KWD reply sort honestly; a reply with no FX rate on file is
 * shown with its own figure and left out of the ranking rather than mis-placed.
 *
 * Like `ProposalsPanel`, it renders nothing when there is nothing to show and
 * the reader cannot act — an enquiry whose lane is already covered never grows
 * a permanently empty card.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { getLocale } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatMoney } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Badge } from '@/ui/status'
import { getEnquiryRateRequests, listCoveringAgents } from '../rate-requests'
import { RequestRatesDialog } from './request-rates-dialog'
import { AcceptRateButton } from './accept-rate-button'
import type { RateRequestView } from '@/lib/pilot/types'

export async function RateRequestsPanel({ enquiryId }: { readonly enquiryId: string }) {
  const session = await requireSession()
  const canRequest = can(session, 'rate.card.write')

  const [view, agents, t, resolved] = await Promise.all([
    getEnquiryRateRequests(session.actor, enquiryId),
    canRequest ? listCoveringAgents(session.actor, enquiryId) : Promise.resolve([]),
    getTranslations('rateRequests'),
    getLocale(),
  ])
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  if (!view) return null
  const requests = view.requests
  if (requests.length === 0 && !canRequest) return null

  return (
    <Card className="mb-4" padding="none">
      {/* The card is unpadded so its rows run edge to edge; the header is not. */}
      <div className="px-4 pt-4 pb-2">
        <CardHeader
          title={t('title')}
          description={
            requests.length === 0
              ? t('emptyDescription')
              : t('description', { awaiting: view.awaiting, answered: view.answered })
          }
          actions={
            canRequest ? (
              <RequestRatesDialog
                enquiryId={enquiryId}
                agents={agents}
                labels={{
                  trigger: t('request'),
                  title: t('pickTitle'),
                  description: t('pickDescription'),
                  send: t('send'),
                  empty: t('noAgents'),
                  noEmail: t('noEmail'),
                  alreadyAsked: t('alreadyAsked'),
                  transit: t('transit'),
                }}
              />
            ) : null
          }
        />
      </div>

      {requests.length === 0 ? (
        <p className="px-4 py-3 text-[0.875rem] text-ink-muted">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {requests.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[0.9375rem] font-medium text-ink" dir="auto">
                    {row.partnerName}
                  </span>
                  <StatusBadge row={row} t={t} />
                  {row.isCheapest ? (
                    <Badge tone="brand" icon="check">
                      {t('cheapest')}
                    </Badge>
                  ) : null}
                </div>
                {row.declinedReason ? (
                  <p className="mt-1 text-[0.8125rem] text-ink-muted" dir="auto">
                    {row.declinedReason}
                  </p>
                ) : null}
                {row.laneMismatch ? (
                  <p className="mt-1 text-[0.75rem] text-caution" dir="auto">
                    {t('laneMismatch')}: {row.laneMismatch}
                  </p>
                ) : null}
              </div>

              <div className="text-end">
                {row.quotedTotal && row.quotedCurrency ? (
                  <>
                    <div className="text-[0.9375rem] font-semibold text-ink">
                      {formatMoney(
                        { amount: Number(row.quotedTotal), currency: row.quotedCurrency },
                        locale,
                      )}
                    </div>
                    {!row.comparable ? (
                      <div className="text-[0.6875rem] text-caution">{t('noFx')}</div>
                    ) : row.quotedCurrency !== view.baseCurrency && row.normalizedTotal ? (
                      <div className="text-[0.6875rem] text-ink-subtle">
                        ≈{' '}
                        {formatMoney(
                          { amount: Number(row.normalizedTotal), currency: view.baseCurrency },
                          locale,
                        )}
                      </div>
                    ) : null}
                    <div className="text-[0.6875rem] text-ink-subtle">
                      {t('lines', { count: row.lineCount })}
                    </div>
                  </>
                ) : (
                  <span className="text-[0.8125rem] text-ink-subtle">{t('awaiting')}</span>
                )}
              </div>

              {row.canPromote && canRequest ? (
                <AcceptRateButton
                  rateRequestId={row.id}
                  enquiryId={enquiryId}
                  label={t('accept')}
                />
              ) : row.rateCardId ? (
                <Badge tone="positive" icon="check">
                  {t('promoted')}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function StatusBadge({
  row,
  t,
}: {
  readonly row: RateRequestView
  readonly t: (key: string) => string
}) {
  const tone =
    row.status === 'accepted'
      ? 'positive'
      : row.status === 'declined'
        ? 'muted'
        : row.status === 'parsed' || row.status === 'responded'
          ? 'info'
          : 'muted'
  return <Badge tone={tone}>{t(`status.${row.status}`)}</Badge>
}
