/**
 * The rate-card register.
 *
 * This screen used to render only from the pilot fixtures — against a real
 * database it showed a hardcoded "1", an empty table and a lane name that was
 * a placeholder string. It is now a register over `rate_cards`.
 *
 * The number the page leads with is **uncovered lanes**: lanes with live
 * shipments and no buying rate. That is the one figure here that changes what
 * somebody does, because every quotation on an uncovered lane is priced by
 * someone guessing, and nobody finds out until the margin is reconciled at
 * month end.
 *
 * Buy and sell are separate cards, and pairing them is the second panel's job.
 * A lane with a buy card and no sell card shows its margin as unknown rather
 * than as zero — the distinction matters, because zero looks like a decision
 * and unknown is a gap.
 */

import type { Metadata } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import {
  laneMargins,
  listExpiringRateCards,
  listRateCards,
  rateCardSummary,
} from '@/features/rates/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatNumber } from '@/lib/format'
import { Icon, modeIcon } from '@/ui/icon'
import { Lane } from '@/ui/layout'
import { Metric } from '@/ui/metric'
import { Panel } from '@/ui/panel'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Money } from '@/ui/money'
import { RenewalsPanel } from '@/features/rates/ui/renewals-panel'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('rates')
  return { title: t('title') }
}

export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const { direction } = await searchParams

  const [rows, summary, margins, expiring] = await Promise.all([
    listRateCards(
      session.actor,
      direction === 'buy' || direction === 'sell' ? direction : undefined,
      locale,
    ),
    rateCardSummary(session.actor),
    laneMargins(session.actor, locale),
    listExpiringRateCards(session.actor),
  ])

  const t = await getTranslations('rates')
  const tc = await getTranslations('common')
  const tMode = await getTranslations('mode')
  const tEnq = await getTranslations('enquiry')
  const tDash = await getTranslations('dashboard')

  const buyCount = rows.filter((row) => row.direction === 'buy').length
  const sellCount = rows.filter((row) => row.direction === 'sell').length

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <Metric
          label={t('liveCards')}
          value={formatNumber(summary.live, locale)}
          icon="rates"
          tone="brand"
          hint={t('liveCardsHint')}
        />
        <Metric
          label={t('lanesCovered')}
          value={formatNumber(summary.lanesCovered, locale)}
          icon="locations"
          tone="info"
          hint={t('lanesCoveredHint')}
        />
        <Metric
          label={t('uncovered')}
          value={formatNumber(summary.uncoveredLanes, locale)}
          icon="alert"
          tone={summary.uncoveredLanes > 0 ? 'critical' : 'positive'}
          hint={t('uncoveredHint')}
          href="/jobs"
        />
        <Metric
          label={t('expiring')}
          value={formatNumber(summary.expiring, locale)}
          icon="clock"
          tone={summary.expiring > 0 ? 'caution' : 'neutral'}
          hint={t('expiringHint')}
        />
      </div>

      {/* ---- renewals the sweep opened, acting on the lapses below (FR-RT-11) */}
      <RenewalsPanel />

      {/* ---- coverage about to lapse (FR-RT-11) --------------------------- */}
      {expiring.length > 0 ? (
        <Panel
          className="mb-4"
          padding="none"
          icon="clock"
          title={t('expiringSoonTitle')}
          explain={t('expiringSoonExplain')}
        >
          <TableShell>
            <THead>
              <TR>
                <TH>{t('lane')}</TH>
                <TH priority="low">{tEnq('mode')}</TH>
                <TH>{t('direction')}</TH>
                <TH priority="low">{t('counterparty')}</TH>
                <TH>{t('validity')}</TH>
                <TH align="end">{t('daysLeft')}</TH>
              </TR>
            </THead>
            <TBody>
              {expiring.map((card) => (
                <TR key={card.id}>
                  {/* The Arabic lane is not a translation of the English one:
                      the arrow points the other way, because the line reads
                      the other way. */}
                  <TD className="font-medium text-ink">
                    {locale === 'ar' ? card.laneAr : card.lane}
                  </TD>
                  <TD priority="low">
                    <span className="inline-flex items-center gap-1.5 text-ink-muted">
                      <Icon name={modeIcon(card.mode)} size={14} />
                      {tMode(card.mode as 'air')}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={card.direction === 'buy' ? 'info' : 'brand'}>
                      {card.direction === 'buy' ? t('buy') : t('sell')}
                    </Badge>
                  </TD>
                  <TD priority="low" className="text-ink-muted">
                    {locale === 'ar' ? card.counterpartyAr : card.counterparty}
                  </TD>
                  <TD className="text-ink-muted">{formatDate(card.validTo, locale, timeZone)}</TD>
                  {/*
                    Zero days left is today, and it still reads as a number
                    rather than as "expired" — the card is valid until the end
                    of the day it names, and a quotation priced on it this
                    morning is a correct quotation.
                  */}
                  <TD align="end" numeric>
                    <span
                      className={
                        card.daysRemaining <= 7
                          ? 'font-semibold text-critical'
                          : card.daysRemaining <= 14
                            ? 'text-caution'
                            : 'text-ink-muted'
                      }
                    >
                      {formatNumber(card.daysRemaining, locale)}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        </Panel>
      ) : null}

      {/* ---- what each lane earns ---------------------------------------- */}
      {margins.length > 0 ? (
        <Panel
          className="mb-4"
          padding="none"
          icon="trend"
          title={t('marginByLane')}
          explain={t('marginByLaneExplain')}
        >
          <TableShell>
            <THead>
              <TR>
                <TH>{t('lane')}</TH>
                <TH priority="low">{tEnq('mode')}</TH>
                <TH priority="low" align="end">
                  {t('buyTotal')}
                </TH>
                <TH align="end">{t('sellTotal')}</TH>
                <TH align="end">{tEnq('margin')}</TH>
              </TR>
            </THead>
            <TBody>
              {margins.map((row, index) => (
                <TR key={`${row.lane}-${row.mode}-${index}`}>
                  <TD className="font-medium text-ink">{row.lane}</TD>
                  <TD priority="low">
                    <span className="inline-flex items-center gap-1.5 text-ink-muted">
                      <Icon name={modeIcon(row.mode)} size={14} />
                      {tMode(row.mode as 'air')}
                    </span>
                  </TD>
                  {/* `numeric` arrives as a six-decimal string; rendering it
                      raw put "USD 1690.000000" in a money column. */}
                  <TD priority="low" align="end" numeric className="text-ink-muted">
                    <Money
                      value={
                        row.buyTotal
                          ? { amount: row.buyTotal, currency: row.currency ?? 'USD' }
                          : null
                      }
                      locale={locale}
                    />
                  </TD>
                  <TD align="end" numeric>
                    <Money
                      value={
                        row.sellTotal
                          ? { amount: row.sellTotal, currency: row.currency ?? 'USD' }
                          : null
                      }
                      locale={locale}
                    />
                  </TD>
                  <TD align="end" numeric>
                    {row.marginPct === null ? (
                      // Unknown, not zero. A missing sell card is a gap in the
                      // rate book, and showing it as 0% hides that.
                      <span className="text-caption text-ink-subtle">{t('noSellCard')}</span>
                    ) : (
                      <span
                        className={
                          row.marginPct < 8
                            ? 'font-semibold text-critical'
                            : row.marginPct < 15
                              ? 'text-caution'
                              : 'text-positive'
                        }
                      >
                        {row.marginPct.toFixed(1)}%
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        </Panel>
      ) : null}

      {/* ---- the cards themselves ---------------------------------------- */}
      <Register
        eyebrow={tDash('quotesEyebrow')}
        title={t('title')}
        description={t('subtitle')}
        filters={[
          { label: tc('all'), href: '/rates', count: rows.length, active: !direction },
          {
            label: t('buy'),
            href: '/rates?direction=buy',
            count: buyCount,
            active: direction === 'buy',
          },
          {
            label: t('sell'),
            href: '/rates?direction=sell',
            count: sellCount,
            active: direction === 'sell',
          },
        ]}
        isEmpty={rows.length === 0}
        empty={{
          icon: 'rates',
          title: direction ? t('noneMatching') : t('noneYet'),
          description: direction ? undefined : t('noneYetHint'),
        }}
      >
        <TableShell>
          <THead>
            <TR>
              <TH>{t('direction')}</TH>
              <TH>{t('lane')}</TH>
              <TH priority="low">{tEnq('mode')}</TH>
              <TH priority="low">{t('counterparty')}</TH>
              <TH priority="low" align="end">
                {t('lines')}
              </TH>
              {/* Live / expiring already answers "can I price on it" on a
                  phone; the exact dates wait for a wider screen. */}
              <TH priority="low">{t('validity')}</TH>
              <TH>{tc('status')}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>
                  <Badge tone={row.direction === 'buy' ? 'info' : 'brand'}>
                    {t(row.direction)}
                  </Badge>
                </TD>
                <TD className="font-medium text-ink">
                  {row.originName && row.destinationName ? (
                    <Lane origin={row.originName} destination={row.destinationName} />
                  ) : (
                    t('anyLane')
                  )}
                </TD>
                <TD priority="low">
                  <span className="inline-flex items-center gap-1.5 text-ink-muted">
                    <Icon name={modeIcon(row.mode)} size={14} />
                    {tMode(row.mode as 'air')}
                  </span>
                </TD>
                <TD priority="low" className="text-ink-muted">
                  {row.partnerName ?? row.customerName ?? t('anyone')}
                </TD>
                <TD priority="low" align="end" numeric>
                  {row.lineCount === 0 ? (
                    // A card with no lines prices nothing. It is the most
                    // common half-finished state and worth flagging.
                    <span className="font-medium text-caution">{row.lineCount}</span>
                  ) : (
                    row.lineCount
                  )}
                </TD>
                <TD priority="low" className="whitespace-nowrap text-ink-muted">
                  {formatDate(new Date(row.validFrom), locale, timeZone)}
                  {row.validTo
                    ? ` — ${formatDate(new Date(row.validTo), locale, timeZone)}`
                    : ` — ${t('openEnded')}`}
                </TD>
                <TD>
                  {row.isLive ? (
                    row.isExpiring ? (
                      <Badge tone="caution" dot>
                        {t('expiringSoon')}
                      </Badge>
                    ) : (
                      <Badge tone="positive" dot>
                        {t('live')}
                      </Badge>
                    )
                  ) : (
                    <Badge tone="muted">{t('notLive')}</Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      </Register>
    </>
  )
}
