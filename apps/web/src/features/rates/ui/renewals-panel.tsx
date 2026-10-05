/**
 * Rate-card renewals in flight — FR-RT-11, the sweep's work made visible.
 *
 * The expiry panel beside this one warns that lanes are lapsing; this shows what
 * the system is doing about it. Each row is an RFQ the nightly sweep opened to a
 * card's incumbent agent — awaiting a reply, read and waiting for an accept, or
 * declined. A parsed reply is one click from a successor card that starts the day
 * the old one ends.
 *
 * Renders nothing when there is nothing in flight: an office whose rates are all
 * current should not carry an empty panel it learns to skim past.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { getLocale } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Badge } from '@/ui/status'
import { StandIn, TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { getRenewals } from '../rate-requests'
import { AcceptRateButton } from './accept-rate-button'
import type { RenewalView } from '@/lib/pilot/types'

export async function RenewalsPanel() {
  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const [renewals, t, tShared] = await Promise.all([
    getRenewals(session.actor, locale),
    getTranslations('renewals'),
    getTranslations('rateRequests'),
  ])

  if (renewals.length === 0) return null
  const canAccept = can(session, 'rate.card.write')
  const action = (row: RenewalView) =>
    row.canPromote && canAccept ? (
      <AcceptRateButton rateRequestId={row.id} enquiryId="" label={t('renew')} />
    ) : null

  return (
    <Card className="mb-4" padding="none">
      {/* The card is unpadded so its rows run edge to edge; the header is not. */}
      <div className="px-4 pt-4 pb-2">
        <CardHeader title={t('title')} description={t('description')} />
      </div>
      {/*
        A table with a header row, for the reason the rate requests on the
        enquiry are one: a list of flex rows gave a price and a button with
        nothing saying what either was. The action column folds under the
        price in a narrow table, by the same container query as there.
      */}
      <TableShell>
        <THead>
          <TR>
            <TH>{t('columns.lane')}</TH>
            <TH align="end">{tShared('columns.quoted')}</TH>
            <TH align="end" priority="low">
              {tShared('columns.rateCard')}
            </TH>
          </TR>
        </THead>
        <TBody>
          {renewals.map((row) => (
            <TR key={row.id}>
              <TD>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-title font-medium text-ink" dir="auto">
                    {row.lane}
                  </span>
                  <StatusBadge row={row} t={tShared} />
                </div>
                <p className="mt-0.5 text-body-sm text-ink-muted" dir="auto">
                  {row.partnerName}
                  {row.oldValidTo ? (
                    <span className="ms-2 text-ink-subtle">
                      {/* A calendar day, so read in UTC — the zone it is stored in. */}
                      {t('lapses', {
                        date: formatDate(row.oldValidTo, locale, 'UTC'),
                      })}
                    </span>
                  ) : null}
                </p>
                {row.declinedReason ? (
                  <p className="mt-1 text-body-sm text-ink-muted" dir="auto">
                    {row.declinedReason}
                  </p>
                ) : null}
              </TD>

              <TD align="end">
                {row.quotedTotal && row.quotedCurrency ? (
                  <div className="text-title font-semibold whitespace-nowrap text-ink">
                    {formatMoney({ amount: row.quotedTotal, currency: row.quotedCurrency }, locale)}
                  </div>
                ) : (
                  <span className="text-body-sm whitespace-nowrap text-ink-subtle">
                    {tShared('awaiting')}
                  </span>
                )}
                {row.lineCount > 0 ? (
                  <div className="text-micro text-ink-subtle">
                    {tShared('lines', { count: row.lineCount })}
                  </div>
                ) : null}
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
    </Card>
  )
}

function StatusBadge({
  row,
  t,
}: {
  readonly row: RenewalView
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
