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
import { Button } from '@/ui/layout'
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
        <p className="px-4 py-3 text-body text-ink-muted">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {requests.map((row) => (
            /*
              The name has a floor. It was `min-w-0 flex-1`, free to shrink to
              nothing, so on a phone the price kept its place and the agent's
              name was squeezed under it a few letters a line. With a 12rem
              basis the price and the action drop to the next line instead.
            */
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-[1_1_12rem]">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-title font-medium text-ink" dir="auto">
                    {row.partnerName}
                  </span>
                  <StatusBadge row={row} t={t} />
                  {row.isCheapest ? (
                    <Badge tone="brand" icon="check">
                      {t('cheapest')}
                    </Badge>
                  ) : row.review && !row.review.ranked ? (
                    /*
                      Where "Cheapest" would have sat, had the figure been
                      checked (live run 6): a flagged reply's amount is shown
                      as it stands, but it is not in the comparison.
                    */
                    <Badge tone="caution" icon="alert">
                      {t('notRanked')}
                    </Badge>
                  ) : null}
                </div>
                {row.declinedReason ? (
                  <p className="mt-1 text-body-sm text-ink-muted" dir="auto">
                    {row.declinedReason}
                  </p>
                ) : null}
                {row.laneMismatch ? (
                  <p className="mt-1 text-caption text-caution" dir="auto">
                    {t('laneMismatch')}: {row.laneMismatch}
                  </p>
                ) : null}
                {/*
                  Said on the row, by line, because the figure beside it looks
                  as finished as any other (R1): an EK reply ranked Cheapest at
                  USD 1,577 with its USD 40 screening fee silently gone.
                */}
                {row.review ? (
                  <div className="mt-1 text-caption text-caution" dir="auto">
                    <p className="font-medium">{t('reviewTitle')}</p>
                    <ul className="list-disc ps-5">
                      {row.review.unclassified.map((u) => (
                        <li key={`u-${u.line}`}>
                          {t('reviewUnclassified', {
                            line: u.description || t('reviewLineNumber', { number: u.line }),
                          })}
                        </li>
                      ))}
                      {row.review.rejected > 0 ? (
                        <li>{t('reviewRejected', { count: row.review.rejected })}</li>
                      ) : null}
                      {row.review.totalMismatch ? (
                        <li>
                          {t('reviewTotalMismatch', {
                            stated: formatMoney(
                              {
                                amount: row.review.totalMismatch.stated,
                                currency: row.review.totalMismatch.currency,
                              },
                              locale,
                            ),
                            computed: formatMoney(
                              {
                                amount: row.review.totalMismatch.computed,
                                currency: row.review.totalMismatch.currency,
                              },
                              locale,
                            ),
                          })}
                        </li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="ms-auto text-end">
                {row.quotedTotal && row.quotedCurrency ? (
                  <>
                    <div className="text-title font-semibold whitespace-nowrap text-ink">
                      {formatMoney(
                        { amount: row.quotedTotal, currency: row.quotedCurrency },
                        locale,
                      )}
                    </div>
                    {row.unpricedLines > 0 ? (
                      <div className="text-micro text-caution">
                        {t('partialTotal', { count: row.unpricedLines })}
                      </div>
                    ) : null}
                    {!row.comparable ? (
                      <div className="text-micro text-caution">{t('noFx')}</div>
                    ) : row.quotedCurrency !== view.baseCurrency && row.normalizedTotal ? (
                      <div className="text-micro text-ink-subtle">
                        ≈{' '}
                        {formatMoney(
                          { amount: row.normalizedTotal, currency: view.baseCurrency },
                          locale,
                        )}
                      </div>
                    ) : null}
                    <div className="text-micro text-ink-subtle">
                      {t('lines', { count: row.lineCount })}
                    </div>
                  </>
                ) : (
                  <span className="text-body-sm text-ink-subtle">{t('awaiting')}</span>
                )}
              </div>

              {row.canPromote && canRequest ? (
                <AcceptRateButton
                  rateRequestId={row.id}
                  enquiryId={enquiryId}
                  label={t('accept')}
                  supersedeLabel={t('supersede')}
                />
              ) : row.rateCardId ? (
                <Badge tone="positive" icon="check">
                  {t('promoted')}
                </Badge>
              ) : canRequest && row.status === 'parsed' && row.review?.unclassified.length ? (
                /*
                  Disabled rather than missing, with the reason under it: a
                  button that vanished reads as a bug, and the server refuses
                  the card anyway until the charge has a name (live run 6).
                */
                <div className="flex flex-col items-end gap-1">
                  <Button type="button" variant="secondary" size="sm" icon="check" disabled>
                    {t('accept')}
                  </Button>
                  <span className="max-w-xs text-end text-micro text-caution">
                    {t('acceptNeedsName')}
                  </span>
                </div>
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
