/**
 * Branches — `FR-ID-02`, NFR-03.
 *
 * Each branch carries its own base currency, invoice series and **working
 * calendar**, and the last of those is the one that bites: Kuwait, Qatar and
 * the UAE share neither a weekend nor a holiday list, so an SLA computed
 * against the wrong calendar is wrong by days rather than minutes. The
 * calendar column exists to make a misconfiguration visible before it silently
 * breaches every enquiry in a branch.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listBranches } from '@/features/admin/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('branches')
  return { title: t('title') }
}

export default async function BranchesPage() {
  const session = await requireSession()
  const t = await getTranslations('branches')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const rows = await listBranches(session.actor)
  const active = rows.filter((row) => row.isActive).length

  return (
    <Register
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('total'), value: rows.length },
        { label: tc('active'), value: active },
      ]}
      isEmpty={rows.length === 0}
      empty={{ icon: 'branches', title: t('noneYet'), description: t('noneYetHint') }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('code')}</TH>
            <TH>{t('name')}</TH>
            <TH>{t('country')}</TH>
            <TH>{t('currency')}</TH>
            <TH>{t('calendar')}</TH>
            <TH>{t('invoiceSeries')}</TH>
            <TH align="end">{t('people')}</TH>
            <TH align="end">{t('openJobs')}</TH>
            <TH>{tc('status')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id} flag={row.calendarName ? undefined : 'caution'}>
              <TD className="ref whitespace-nowrap text-brand">{row.code}</TD>
              <TD className="font-medium text-ink">
                {locale === 'ar' && row.legalNameAr ? row.legalNameAr : row.legalNameEn}
              </TD>
              <TD className="whitespace-nowrap text-ink-muted">{row.country}</TD>
              <TD className="ref whitespace-nowrap text-ink">{row.baseCurrency}</TD>
              <TD className="whitespace-nowrap">
                {row.calendarName ? (
                  <span className="text-ink-muted">
                    {row.calendarName}
                    <span className="ms-1.5 text-[0.75rem] text-ink-subtle">{row.timeZone}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium text-caution">
                    <Icon name="alert" size={14} />
                    {t('noCalendar')}
                  </span>
                )}
              </TD>
              <TD className="ref whitespace-nowrap text-ink-muted">
                {row.invoiceSeries ?? '—'}
                <span className="ms-1 text-ink-subtle">#{row.invoiceSeriesNext}</span>
              </TD>
              <TD align="end" numeric>
                {row.people}
              </TD>
              <TD align="end" numeric>
                {row.openJobs}
              </TD>
              <TD>
                <Badge tone={row.isActive ? 'positive' : 'muted'}>
                  {row.isActive ? tc('active') : tc('inactive')}
                </Badge>
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>
    </Register>
  )
}
