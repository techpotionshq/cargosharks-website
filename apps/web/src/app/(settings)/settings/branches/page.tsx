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
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { listCalendarOptions, listBranches } from '@/features/admin/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { BranchDialog } from '@/features/admin/ui/dialogs'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('branches')
  return { title: t('title') }
}

export default async function BranchesPage() {
  const session = await requireSession()
  /*
    A branch row carries the invoice series and the base currency, so this is
    not a directory — it is the configuration behind every number the company
    issues. Guarded on its own key rather than on the layout's admission.
  */
  if (!can(session, 'admin.branches.write')) notFound()

  const t = await getTranslations('branches')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const [rows, calendars] = await Promise.all([
    listBranches(session.actor),
    listCalendarOptions(session.actor, locale),
  ])
  const active = rows.filter((row) => row.isActive).length

  return (
    <Register
      actions={<BranchDialog calendars={calendars} />}
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
            {/*
              Eleven columns of configuration. A phone keeps code, name, status
              and the edit button; of the rest, the two states that stop a
              branch working — no calendar, accounts unmapped — follow the name
              and the status there (below), and the others wait.
            */}
            <TH priority="low">{t('country')}</TH>
            <TH priority="low">{t('currency')}</TH>
            <TH priority="low">{t('calendar')}</TH>
            <TH priority="low">{t('invoiceSeries')}</TH>
            <TH priority="low" align="end">
              {t('people')}
            </TH>
            <TH priority="low" align="end">
              {t('openJobs')}
            </TH>
            <TH priority="low">{t('accounts')}</TH>
            <TH>{tc('status')}</TH>
            <TH align="end">{tc('actions')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id} flag={row.calendarName ? undefined : 'caution'}>
              <TD className="ref whitespace-nowrap font-medium text-ink">{row.code}</TD>
              <TD className="font-medium text-ink">
                {locale === 'ar' && row.legalNameAr ? row.legalNameAr : row.legalNameEn}
                {row.calendarName ? null : (
                  <span className="mt-0.5 flex items-center gap-1 text-caption text-caution @3xl:hidden">
                    <Icon name="alert" size={13} className="shrink-0" />
                    {t('noCalendar')}
                  </span>
                )}
              </TD>
              <TD priority="low" className="whitespace-nowrap text-ink-muted">
                {row.country}
              </TD>
              <TD priority="low" className="ref whitespace-nowrap text-ink">
                {row.baseCurrency}
              </TD>
              {/* The zone sits under the calendar's name: on one line the
                  pair was 222px, and eleven columns at 1280 have 966px. */}
              <TD priority="low" className="whitespace-nowrap">
                {row.calendarName ? (
                  <span className="text-ink-muted">
                    {(locale === 'ar' && row.calendarNameAr) || row.calendarName}
                    <span className="ref block text-caption text-ink-subtle">{row.timeZone}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium text-caution">
                    <Icon name="alert" size={14} />
                    {t('noCalendar')}
                  </span>
                )}
              </TD>
              <TD priority="low" className="ref whitespace-nowrap text-ink-muted">
                {row.invoiceSeries ?? '—'}
                <span className="ms-1 text-ink-subtle">#{row.invoiceSeriesNext}</span>
              </TD>
              <TD priority="low" align="end" numeric>
                {row.people}
              </TD>
              <TD priority="low" align="end" numeric>
                {row.openJobs}
              </TD>
              {/*
                Whether this entity can post a period at all.

                An unmapped branch is not broken — it simply cannot close a
                month, and the difference is worth showing here rather than
                only in the export's refusal, because this is the screen where
                somebody fixes it.
              */}
              <TD priority="low" className="whitespace-nowrap">
                {row.arAccountCode && row.apAccountCode && row.bankAccountCode ? (
                  <Badge tone="positive">{t('accountsSet')}</Badge>
                ) : (
                  <Badge tone="caution">{t('accountsMissing')}</Badge>
                )}
              </TD>
              <TD>
                <Badge tone={row.isActive ? 'positive' : 'muted'}>
                  {row.isActive ? tc('active') : tc('inactive')}
                </Badge>
                {row.arAccountCode && row.apAccountCode && row.bankAccountCode ? null : (
                  <span className="mt-1 block @3xl:hidden">
                    <Badge tone="caution">{t('accountsMissing')}</Badge>
                  </span>
                )}
              </TD>
              <TD align="end">
                <BranchDialog
                  calendars={calendars}
                  variant="ghost"
                  iconOnly
                  defaults={{
                    id: row.id,
                    code: row.code,
                    legalNameEn: row.legalNameEn,
                    legalNameAr: row.legalNameAr ?? '',
                    country: row.country,
                    baseCurrency: row.baseCurrency,
                    calendarId: row.calendarId,
                    timeZone: row.timeZone,
                    mailFrom: row.mailFrom,
                    quietHoursEnabled: row.quietHoursEnabled,
                    quietHoursFromHour: row.quietHoursFromHour,
                    quietHoursToHour: row.quietHoursToHour,
                    taxRegistration: row.taxRegistration,
                    houseBillSeries: row.houseBillSeries,
                    arAccountCode: row.arAccountCode,
                    apAccountCode: row.apAccountCode,
                    taxAccountCode: row.taxAccountCode,
                    bankAccountCode: row.bankAccountCode,
                    fxVarianceAccountCode: row.fxVarianceAccountCode,
                    roundingAccountCode: row.roundingAccountCode,
                    tradingConditionsEn: row.tradingConditionsEn,
                    tradingConditionsAr: row.tradingConditionsAr,
                    billOfLadingTermsEn: row.billOfLadingTermsEn,
                    billOfLadingTermsAr: row.billOfLadingTermsAr,
                    defaultExclusionsEn: row.defaultExclusionsEn,
                    defaultExclusionsAr: row.defaultExclusionsAr,
                    isActive: row.isActive,
                  }}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>
    </Register>
  )
}
