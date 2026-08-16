/**
 * Rate cards — `FR-RT-01…04`.
 *
 * The pilot imports one real card: sea FCL on the busiest lane, plus air on
 * one corridor (Pilot §3.1 item 4). One card is enough, because the engine
 * does not care how many — what it cares about is that a lane resolves, and
 * that is what this screen shows.
 *
 * Rate versioning and the full accessorial catalogue are Release One
 * (Pilot §3.2), so this page reads rather than edits.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Button, PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
import { Badge } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { pilotQuote } from '@/lib/pilot/fixtures'
import { usePilotFixtures } from '@/lib/pilot/source'

export default async function RatesPage() {
  await requireSession()
  const t = await getTranslations('rates')
  const tQuote = await getTranslations('quote')
  const tMode = await getTranslations('mode')
  const tDash = await getTranslations('dashboard')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  /**
   * The imported card is shown through the same priced options the comparison
   * uses, so the screen cannot drift from what the engine actually returns.
   */
  const comparison = usePilotFixtures() ? pilotQuote() : undefined
  const options = comparison?.options ?? []

  return (
    <>
      <PageHeader
        eyebrow={tDash('quotesEyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button icon="download" variant="secondary">
            {t('imported')}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t('card')} value="1" hint="Sea FCL · Far East → Kuwait" icon="rates" />
        <StatTile label={t('lines')} value={String(options[0]?.lines.length ?? 0)} icon="finance" />
        <StatTile label={t('carrier')} value={String(options.length)} icon="ship" />
        <StatTile
          label={tDash('avgMargin')}
          value={`${(
            options.reduce((sum, o) => sum + o.marginPct, 0) / Math.max(options.length, 1)
          ).toFixed(1)}%`}
          icon="trend"
        />
      </div>

      <Card padding="none">
        <div className="p-5 pb-3">
          <CardHeader
            icon="rates"
            eyebrow={t('card')}
            title={comparison?.lane ?? t('lane')}
            description={t('coverage')}
            actions={
              comparison ? (
                <Badge tone="brand">
                  <Icon name={modeIcon(comparison.mode)} size={13} />
                  {tMode(comparison.mode)}
                </Badge>
              ) : null
            }
          />
        </div>

        <TableShell className="border-t border-line">
          <THead>
            <TR>
              <TH>{t('carrier')}</TH>
              <TH>{tQuote('service')}</TH>
              <TH align="end">{tQuote('transit')}</TH>
              <TH align="end">{tQuote('buy')}</TH>
              <TH align="end">{tQuote('sell')}</TH>
              <TH align="end">{tQuote('margin')}</TH>
              <TH align="end">{t('validity')}</TH>
            </TR>
          </THead>
          <TBody>
            {options.map((option) => (
              <TR key={option.id}>
                <TD className="font-medium">
                  {option.carrier}
                  {option.isRecommended ? (
                    <Badge tone="brand" className="ms-2">
                      {tQuote('recommended')}
                    </Badge>
                  ) : null}
                </TD>
                <TD className="text-ink-muted">{option.service}</TD>
                <TD align="end" numeric>
                  {tQuote('transitDays', { days: option.transitDays })}
                </TD>
                <TD align="end" numeric className="text-ink-muted">
                  {formatMoney(option.buy, locale, { showCurrency: false })}
                </TD>
                <TD align="end" numeric className="font-semibold">
                  {formatMoney(option.sell, locale, { showCurrency: false })}
                </TD>
                <TD align="end" numeric>
                  <span className={option.marginPct < 12 ? 'text-caution' : 'text-positive'}>
                    {option.marginPct.toFixed(1)}%
                  </span>
                </TD>
                <TD align="end" numeric className="text-ink-muted">
                  {formatDate(option.validUntil, locale)}
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      </Card>
    </>
  )
}
