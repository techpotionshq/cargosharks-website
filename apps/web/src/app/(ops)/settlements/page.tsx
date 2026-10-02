/**
 * Set-offs with agents — the monthly reconciliation, as documents.
 *
 * The column that carries this list is the residual, because it is the only
 * figure that becomes a bank transfer. Gross receivable and gross payable are
 * beside it for the same reason a statement shows both: the residual on its
 * own is unarguable and unverifiable.
 */

import Link from 'next/link'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listSettlements, listSettleablePartners } from '@/features/payables/queries'
import { SettlementDialog } from '@/features/payables/ui/dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate } from '@/lib/format'
import { Card } from '@/ui/card'
import { EmptyState, PageHeader } from '@/ui/layout'
import { Badge, type Tone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { Money } from '@/ui/money'

const STATUS_TONE: Record<string, Tone> = {
  draft: 'info',
  agreed: 'brand',
  settled: 'positive',
  void: 'muted',
}

const DIRECTION_TONE: Record<string, Tone> = {
  they_owe_us: 'positive',
  we_owe_them: 'caution',
  square: 'muted',
}

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ partner?: string; status?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const filters = await searchParams

  const [rows, settleable, t, tc] = await Promise.all([
    listSettlements(session.actor, { partnerId: filters.partner, status: filters.status }, locale),
    listSettleablePartners(session.actor, locale),
    getTranslations('settlements'),
    getTranslations('common'),
  ])

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<SettlementDialog partners={settleable} />}
      />

      <Card padding="none">
        {rows.length === 0 ? (
          <EmptyState
            icon="finance"
            title={t('none')}
            description={settleable.length === 0 ? t('noPartners') : t('noneHint')}
          />
        ) : (
          <TableShell>
            <THead>
              <TR>
                <TH>{t('reference')}</TH>
                {/* A netting statement's answer is the residual — who owes
                    whom, and how much. The two gross sides it nets wait for a
                    wider screen; the agent follows the reference on a phone. */}
                <TH priority="low">{t('agent')}</TH>
                <TH priority="low">{t('period')}</TH>
                <TH priority="low" align="end">
                  {t('theyOweUsShort')}
                </TH>
                <TH priority="low" align="end">
                  {t('weOweThemShort')}
                </TH>
                <TH align="end">{t('residual')}</TH>
                <TH align="end">{tc('status')}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <Link
                      href={`/settlements/${row.id}`}
                      className="ref numeric font-medium hover:text-accent"
                    >
                      {row.reference}
                    </Link>
                    <span className="block text-[0.75rem] text-ink-muted md:hidden">
                      {row.partnerName}
                    </span>
                  </TD>
                  <TD priority="low" className="text-ink-muted">
                    {row.partnerName}
                  </TD>
                  <TD priority="low" className="text-ink-muted">
                    {formatDate(row.periodFrom, locale, timeZone)} —{' '}
                    {formatDate(row.periodTo, locale, timeZone)}
                  </TD>
                  <TD priority="low" align="end" numeric>
                    <Money
                      value={{ amount: row.receivableTotal, currency: row.currency }}
                      locale={locale}
                    />
                  </TD>
                  <TD priority="low" align="end" numeric>
                    <Money
                      value={{ amount: row.payableTotal, currency: row.currency }}
                      locale={locale}
                    />
                  </TD>
                  <TD align="end" numeric>
                    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <Money
                        value={{ amount: row.residualAmount, currency: row.currency }}
                        locale={locale}
                      />
                      <Badge tone={DIRECTION_TONE[row.residualDirection] ?? 'muted'}>
                        {t(`directions.${row.residualDirection}` as 'directions.square')}
                      </Badge>
                    </span>
                  </TD>
                  <TD align="end">
                    <Badge tone={STATUS_TONE[row.status] ?? 'muted'}>
                      {t(`statuses.${row.status}` as 'statuses.draft')}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        )}
      </Card>
    </>
  )
}
