/**
 * The customs board — `FR-CU-01…06`.
 *
 * Ordered by the clearance SLA rather than by shipment, because that is the
 * order a broker works: the declaration closest to its window is the next
 * phone call. A held entry is the single most expensive state in the product —
 * demurrage accrues against it daily — so it is flagged, not merely coloured.
 */

import type { Metadata } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { customsCounts, listCustoms } from '@/features/operations/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime, formatMoney, formatRelative, trimDecimal } from '@/lib/format'
import { Register, RecordLink } from '@/ui/register'
import { Badge, customsTone } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('customs')
  return { title: t('title') }
}

export default async function CustomsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const { scope } = await searchParams
  const view =
    scope === 'released' ? 'released' : scope === 'all' ? 'all' : scope === 'held' ? 'held' : 'live'

  const t = await getTranslations('customs')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  // Held is a subset of live, so it reads the live list and keeps the holds —
  // the summary has always counted them, and now the strip can show them.
  const [live, counts] = await Promise.all([
    listCustoms(session.actor, view === 'held' ? 'live' : view),
    customsCounts(session.actor),
  ])
  const rows = view === 'held' ? live.filter((row) => row.status === 'held') : live

  return (
    <Register
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('inClearance'), value: counts.live },
        { label: t('held'), value: counts.held },
        { label: t('released'), value: counts.released },
      ]}
      filters={[
        { label: t('inClearance'), href: '/customs', count: counts.live, active: view === 'live' },
        {
          label: t('held'),
          href: '/customs?scope=held',
          count: counts.held,
          active: view === 'held',
        },
        {
          label: t('released'),
          href: '/customs?scope=released',
          count: counts.released,
          active: view === 'released',
        },
        { label: tc('all'), href: '/customs?scope=all', active: view === 'all' },
      ]}
      isEmpty={rows.length === 0}
      empty={{
        icon: 'customs',
        title: view === 'live' ? t('noneLive') : t('noneMatching'),
        description: view === 'live' ? t('noneLiveHint') : undefined,
      }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('shipment')}</TH>
            <TH priority="low">{t('customer')}</TH>
            <TH>{tc('status')}</TH>
            <TH priority="low">{t('declaration')}</TH>
            <TH priority="low">{t('filed')}</TH>
            <TH>{t('slaDue')}</TH>
            <TH priority="lowest">{t('broker')}</TH>
            {/* The broker's question on a phone is "when is it due", not "how
                much duty" — the duty is on the job. */}
            <TH priority="low" align="end">
              {t('duty')}
            </TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const breached =
              !row.releasedAt && row.slaDueAt !== null && row.slaDueAt.getTime() < now
            return (
              <TR
                key={row.id}
                flag={row.status === 'held' ? 'critical' : breached ? 'caution' : undefined}
              >
                <TD>
                  <RecordLink href={`/jobs/${row.jobId}`}>{row.jobReference}</RecordLink>
                </TD>
                <TD priority="low" className="text-ink-muted">
                  {(locale === 'ar' && row.customerNameAr) || row.customerName || '—'}
                </TD>
                <TD>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge tone={customsTone(row.status)} dot>
                      {t(`statuses.${row.status}`)}
                    </Badge>
                    {row.inspectionRequired ? (
                      <Icon
                        name="alert"
                        size={14}
                        className="text-caution"
                        aria-label={t('inspection')}
                      />
                    ) : null}
                  </span>
                </TD>
                <TD priority="low" className="ref whitespace-nowrap text-ink">
                  {row.declarationNo ?? '—'}
                </TD>
                {/* May break between date and time: on one line "27 Sept,
                    13:40" was the 25px by which this register scrolled at
                    1280. */}
                <TD priority="low" className="text-ink-muted">
                  {row.filedAt ? formatDateTime(row.filedAt, locale, timeZone) : '—'}
                </TD>
                <TD
                  className={`whitespace-nowrap ${breached ? 'font-semibold text-critical' : 'text-ink-muted'}`}
                >
                  {row.slaDueAt ? formatRelative(row.slaDueAt, locale, now) : '—'}
                </TD>
                <TD priority="lowest" className="text-ink-muted">
                  {(locale === 'ar' && row.brokerNameAr) || row.brokerName || '—'}
                </TD>
                <TD priority="low" align="end" numeric>
                  {/* At the currency's own precision: trimmed, a KWD duty of
                      1840.500 read "1840.5 KWD". */}
                  {row.dutyAmount
                    ? row.dutyCurrency
                      ? formatMoney({ amount: row.dutyAmount, currency: row.dutyCurrency }, locale)
                      : trimDecimal(row.dutyAmount)
                    : '—'}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </TableShell>
    </Register>
  )
}
