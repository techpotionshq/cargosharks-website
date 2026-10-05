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
import { StandIn, TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
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

  /** What can be done with a reply: make the card, see it made, or why not yet. */
  const action = (row: RateRequestView) =>
    row.canPromote && canRequest ? (
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
        Disabled rather than missing, with the reason under it: a button that
        vanished reads as a bug, and the server refuses the card anyway until
        the charge has a name (live run 6).
      */
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="secondary" size="sm" icon="check" disabled>
          {t('accept')}
        </Button>
        <span className="max-w-xs text-end text-micro text-caution">{t('acceptNeedsName')}</span>
      </div>
    ) : null

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
        /*
          A table, with a header row. It was a list of flex rows, and with
          three replies on screen it read as three unlabelled figures and three
          buttons: nothing said the number was the agent's own price for the
          whole lane, or that the last column is where a rate card is made. The
          columns are the ones the eye compares down, which a list cannot
          line up.

          The agent cell wraps and the other two never do, so on a phone the
          name takes the lines and the price and the action keep their place.
        */
        <TableShell>
          <THead>
            <TR>
              <TH>{t('columns.agent')}</TH>
              <TH align="end">{t('columns.quoted')}</TH>
              <TH align="end" priority="low">
                {t('columns.rateCard')}
              </TH>
            </TR>
          </THead>
          <TBody>
            {requests.map((row) => (
              <TR key={row.id}>
                <TD>
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
                </TD>

                <TD align="end">
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
                    <span className="text-body-sm whitespace-nowrap text-ink-subtle">
                      {t('awaiting')}
                    </span>
                  )}
                  {/*
                    Under a 48rem table the action column goes (a phone has
                    room for the name and the price, not a third column with
                    a button in it) and the action comes here, under the
                    price. One container query drives both, so exactly one
                    of the two is ever displayed.
                  */}
                  {action(row) ? (
                    <StandIn className="mt-2 flex justify-end">{action(row)}</StandIn>
                  ) : null}
                </TD>

                <TD align="end" priority="low">
                  {action(row)}
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
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
