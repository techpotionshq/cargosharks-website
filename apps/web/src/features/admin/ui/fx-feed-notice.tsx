/**
 * What every screen that shows exchange rates says about where they came from.
 *
 * Two lines, each shown only when it is true:
 *
 *   - **Attribution**, whenever a feed rate is on screen or a feed is on.
 *     ExchangeRate-API's terms require it, and it is also the sentence that
 *     stops a free indicative rate being read as a bank's: the person pricing
 *     a quotation should know what kind of number they are about to send.
 *   - **Staleness**, when a feed is on and its newest rate for a tracked pair
 *     is more than three days old. A stopped feed looks exactly like a working
 *     one until a quotation goes out at last week's rate; this is the only
 *     place it shows before then. Three days rather than one because the
 *     providers do not publish at the weekend.
 *
 * Calm, not alarming: an old rate is a reason to check, not an outage.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { FX_FEED_SOURCES } from '@qabandi/core'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { zoneName } from '@/lib/fx-label'
import type { FxFeedPanel } from '@/lib/pilot/types'
import { Notice } from '@/ui/notice'

/** Whether any of these rows came from a feed rather than a person. */
export function hasFeedRows(rows: readonly { source: string }[]): boolean {
  return rows.some((row) => (FX_FEED_SOURCES as readonly string[]).includes(row.source))
}

export async function FxFeedNotice({
  panel,
  feedRowsShown,
  className,
}: {
  readonly panel: FxFeedPanel
  /** Whether the surrounding table shows a feed rate, whatever the driver now is. */
  readonly feedRowsShown: boolean
  readonly className?: string
}) {
  const t = await getTranslations('fxFeed')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const timeZone = await getTimeZone()

  const showAttribution = panel.driver !== 'manual' || feedRowsShown
  if (!showAttribution && !panel.stale) return null

  /*
    In the reader's own zone, and named: the quotation's rate label names its
    zone too, so one fetch reads the same on both (live run 6, N7).
  */
  const at = panel.lastFetchedAt
    ? `${formatDateTime(panel.lastFetchedAt, locale, timeZone)} ${zoneName(timeZone)}`
    : null

  return (
    <div className={['space-y-2', className ?? ''].join(' ')} data-testid="fx-feed-notice">
      {panel.stale ? (
        <Notice tone="caution" icon="clock">
          {panel.stale.ageDays === null
            ? t('staleNever', { pairs: panel.stale.pairs.join(', ') })
            : t('stale', { days: panel.stale.ageDays })}
        </Notice>
      ) : null}
      {showAttribution ? (
        <Notice tone="info" icon="finance">
          {at ? t('attribution', { at }) : t('attributionNever')}
        </Notice>
      ) : null}
    </div>
  )
}
