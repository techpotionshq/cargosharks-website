/**
 * What the machine did on this enquiry, on one line — the "visible what's
 * happening" strip.
 *
 * The enquiry already carries three automation panels (proposals, rate requests,
 * the quote comparison). This is the glance above them: acknowledged the
 * customer · read N fields · asked N agents. It is not a fourth place to act —
 * every segment's real controls live in its own panel — it is the line that
 * tells a coordinator the platform is working on this file so they look for what
 * it did rather than wonder whether anything happened.
 *
 * Renders nothing when nothing has happened: a manual enquiry with no email
 * behind it grows no empty strip.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Icon } from '@/ui/icon'
import { enquiryAutomation } from '../automation'

export async function EnquiryAutomationStrip({ enquiryId }: { readonly enquiryId: string }) {
  const session = await requireSession()
  const [a, t, resolved, timeZone] = await Promise.all([
    enquiryAutomation(session.actor, enquiryId),
    getTranslations('enquiryAutomation'),
    getLocale(),
    getTimeZone(),
  ])
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const segments: string[] = []
  if (a.acknowledgedAt) {
    segments.push(`${t('acknowledged')} · ${formatDateTime(a.acknowledgedAt, locale, timeZone)}`)
  }
  if (a.fieldsRead > 0) {
    segments.push(
      a.fieldsPending > 0
        ? t('fieldsWithPending', { read: a.fieldsRead, pending: a.fieldsPending })
        : t('fieldsRead', { count: a.fieldsRead }),
    )
  }
  if (a.rateRequestsSent > 0) {
    segments.push(t('rateRequests', { sent: a.rateRequestsSent, replied: a.rateRepliesIn }))
  }

  if (segments.length === 0) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-line bg-surface-sunken px-3 py-2 text-body-sm text-ink-muted">
      <span className="inline-flex items-center gap-1.5 font-medium text-ink">
        <Icon name="assistant" size={15} />
        {t('label')}
      </span>
      {segments.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 ? <span className="text-ink-subtle">·</span> : null}
          <span dir="auto">{s}</span>
        </span>
      ))}
    </div>
  )
}
