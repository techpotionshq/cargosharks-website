/**
 * The rate comparison — Moment 2 and Moment 2b.
 *
 * Two audiences, one screen, and the order matters. The operations manager
 * sees that a real lane priced instantly off the imported rate card. The
 * owner, two lines lower, sees **buy, sell and margin on the same row**
 * (`FR-EQ-07`) — margin known at the moment of quoting rather than
 * reconstructed at month-end. Pilot §2 is blunt about which of those closes:
 * *"for whoever signs the cheque, this is usually the moment."*
 *
 * The punchline is the strip at the top: the same enquiry, answered by hand
 * last month, took a day and a half. That number comes from the client
 * (Pilot §5 item 7), not from us, which is what makes it land.
 *
 * Everything on this page is internal. Buy rates and margin never appear on
 * the customer portal, the tracking page or the quotation PDF — not by being
 * filtered out downstream, but by living only in this slice.
 */

import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { getQuoteComparison } from '@/features/quotes/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney, formatNumber } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Button, Field, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { Meter } from '@/ui/chart'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'

export default async function EnquiryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireSession()
  const { id } = await params
  const comparison = await getQuoteComparison(session.actor, id)
  if (!comparison) notFound()

  const t = await getTranslations('quote')
  const tEnq = await getTranslations('enquiry')
  const tMode = await getTranslations('mode')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const best = comparison.options.reduce((a, b) => (a.marginPct > b.marginPct ? a : b))
  const maxMargin = Math.max(...comparison.options.map((o) => o.marginPct), 1)

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <a href="/enquiries" className="hover:text-ink">
              {tEnq('title')}
            </a>
            <Icon name="chevron-end" size={12} />
            <span className="ref">{comparison.enquiryReference}</span>
          </span>
        }
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button icon="document">{t('downloadPdf')}</Button>
            <Button variant="primary" icon="arrow-end">
              {t('sendQuotation')}
            </Button>
          </>
        }
      />

      {/*
        Moment 2's punchline, stated as a comparison rather than a boast: the
        engine's time next to the manual time, with the manual one in the
        client's own words.
      */}
      <Card className="mb-4" tone="brand">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-brand text-on-brand">
              <Icon name="clock" size={18} />
            </span>
            <div>
              <p className="text-[0.9375rem] font-semibold text-ink">
                {t('pricedIn', { ms: formatNumber(comparison.pricingMs, locale) })}
              </p>
              <p className="text-[0.8125rem] text-ink-muted">
                {t('manualComparison', { hours: comparison.manualTurnaroundHours })}
              </p>
            </div>
          </div>
          <dl className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <Field label={tEnq('customer')}>{comparison.customerName}</Field>
            <Field label={tEnq('lane')}>{comparison.lane}</Field>
            <Field label={tEnq('mode')}>
              <span className="inline-flex items-center gap-1.5">
                <Icon name={modeIcon(comparison.mode)} size={15} />
                {tMode(comparison.mode)}
                {comparison.containerType ? ` · ${comparison.containerType}` : ''}
              </span>
            </Field>
            <Field label="Incoterm">{comparison.incoterm}</Field>
          </dl>
        </div>
      </Card>

      {/* --- the three options, side by side ---------------------------- */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {comparison.options.map((option) => (
          <Card
            key={option.id}
            className={option.isRecommended ? 'ring-2 ring-brand/30' : undefined}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* Wraps rather than clips: a carrier name is the first thing
                    compared across the three cards. */}
                <p className="text-[0.9375rem] font-semibold text-balance text-ink">
                  {option.carrier}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-ink-muted">{option.service}</p>
              </div>
              {option.isRecommended ? (
                <Badge tone="brand" icon="check">
                  {t('recommended')}
                </Badge>
              ) : null}
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="numeric font-display text-[1.75rem] leading-none font-semibold tracking-tight text-ink">
                {formatMoney(option.sell, locale, { showCurrency: false })}
              </span>
              <span className="text-[0.8125rem] font-medium text-ink-subtle">
                {option.sell.currency}
              </span>
            </div>
            <p className="mt-1 text-[0.75rem] text-ink-subtle">{t('sell')}</p>

            {/*
              The three numbers together. Splitting them across screens is
              exactly what the current spreadsheet process does, and why margin
              is only ever known afterwards.
            */}
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
              <div>
                <dt className="eyebrow mb-1">{t('buy')}</dt>
                <dd className="numeric text-[0.875rem] font-medium text-ink-muted">
                  {formatMoney(option.buy, locale, { showCurrency: false })}
                </dd>
              </div>
              <div>
                <dt className="eyebrow mb-1">{t('margin')}</dt>
                <dd
                  className={`numeric text-[0.875rem] font-semibold ${
                    option.marginPct >= 18
                      ? 'text-positive'
                      : option.marginPct < 12
                        ? 'text-caution'
                        : 'text-ink'
                  }`}
                >
                  {option.marginPct.toFixed(1)}%
                </dd>
              </div>
              <div>
                <dt className="eyebrow mb-1">{t('transit')}</dt>
                <dd className="numeric text-[0.875rem] font-medium text-ink">
                  {option.transitDays}
                  <span className="text-ink-subtle"> {tc('days')}</span>
                </dd>
              </div>
            </dl>

            <Meter
              className="mt-3"
              value={option.marginPct}
              max={maxMargin}
              tone={option.id === best.id ? 'var(--qb-positive)' : 'var(--qb-chart-1)'}
              label={`${t('margin')} ${option.marginPct}%`}
            />

            <p className="mt-3 text-[0.6875rem] text-ink-subtle">
              {t('validUntil')} {formatDate(option.validUntil, locale)}
            </p>
          </Card>
        ))}
      </div>

      {/* --- the breakdown, buy and sell in the same row ---------------- */}
      <Card padding="none">
        <div className="p-5 pb-3">
          <CardHeader
            icon="rates"
            eyebrow={t('option')}
            title={`${t('breakdown')} · ${comparison.options[0]?.carrier ?? ''}`}
            description={t('internalOnly')}
          />
        </div>

        <TableShell>
          <THead>
            <TH>{t('charge')}</TH>
            <TH>{t('basis')}</TH>
            <TH align="end">{t('quantity')}</TH>
            <TH align="end">{t('buy')}</TH>
            <TH align="end">{t('sell')}</TH>
            <TH align="end">{t('margin')}</TH>
            <TH align="end">{t('amount')}</TH>
          </THead>
          <TBody>
            {(comparison.options[0]?.lines ?? []).map((line) => {
              const margin =
                line.sellRate === 0 ? 0 : ((line.sellRate - line.buyRate) / line.sellRate) * 100
              return (
                <TR key={line.chargeCode}>
                  <TD className="font-medium">
                    {locale === 'ar' ? line.nameAr : line.nameEn}
                  </TD>
                  <TD className="text-ink-muted">
                    {t(`bases.${line.basis}` as 'bases.flat')}
                  </TD>
                  <TD align="end" numeric>
                    {line.quantity}
                  </TD>
                  <TD align="end" numeric className="text-ink-muted">
                    {line.buyRate.toFixed(2)}
                  </TD>
                  <TD align="end" numeric>
                    {line.sellRate.toFixed(2)}
                  </TD>
                  <TD align="end" numeric>
                    <span className={margin < 12 ? 'text-caution' : 'text-ink-muted'}>
                      {margin.toFixed(1)}%
                    </span>
                  </TD>
                  <TD align="end" numeric className="font-semibold">
                    {formatMoney(line.amount, locale, { showCurrency: false })}
                  </TD>
                </TR>
              )
            })}
          </TBody>
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-surface-sunken">
              <TD className="font-semibold">{t('total')}</TD>
              <TD />
              <TD />
              <TD align="end" numeric className="font-medium text-ink-muted">
                {formatMoney(comparison.options[0]?.buy, locale, { showCurrency: false })}
              </TD>
              <TD align="end" numeric className="font-semibold">
                {formatMoney(comparison.options[0]?.sell, locale, { showCurrency: false })}
              </TD>
              <TD align="end" numeric className="font-semibold text-positive">
                {comparison.options[0]?.marginPct.toFixed(1)}%
              </TD>
              <TD align="end" numeric className="font-semibold">
                {formatMoney(comparison.options[0]?.sell, locale)}
              </TD>
            </tr>
          </tfoot>
        </TableShell>
      </Card>
    </>
  )
}
