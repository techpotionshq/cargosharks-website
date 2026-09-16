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

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { getQuoteComparison } from '@/features/quotes/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney, formatNumber } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Field } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { Meter } from '@/ui/chart'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { EnquiryActions } from '@/features/enquiries/ui/enquiry-actions'
import { ProposalsPanel } from '@/features/enquiries/ui/proposals-panel'
import { RateRequestsPanel } from '@/features/rates/ui/rate-requests-panel'
import { QuoteDialog } from '@/features/ledger/ui/dialogs'
import { EnquiryPricingHeader } from '@/features/ledger/ui/price-button'

export default async function EnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const timeZone = await getTimeZone()

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

  /*
    An absent value says so in words.

    A bare em-dash in a field is indistinguishable from a rendering fault, and
    this is the screen the product is demonstrated on. Carrier, service and
    lane are all genuinely unknown on quotations priced straight off a rate
    card — the card knows the lane's price, not who sails it.
  */
  const orNotRecorded = (value: string | null) => value ?? tc('notRecorded')

  // "Priced in 0 ms" is not a fast quotation, it is a missing measurement.
  const timing = (comparison.pricingMs ?? 0) > 0

  /*
    The layout follows the count, because the count is the whole argument.

    Three carriers side by side is a comparison. One card in a three-column
    grid is a comparison with two empty seats: a narrow column at the inline
    start and two-thirds of the screen saying nothing, which reads as a
    rendering fault rather than as a single covered lane. So a lone option
    stops pretending — it takes the full width and turns on its side, the
    carrier and the price on one half, the numbers on the other. Two split the
    row; three keep the thirds they were designed for.
  */
  const solo = comparison.options.length === 1
  const optionColumns = solo
    ? ''
    : comparison.options.length === 2
      ? 'sm:grid-cols-2'
      : 'sm:grid-cols-2 lg:grid-cols-3'

  return (
    <>
      {/*
        The header is rendered *by* the pricing component rather than beside
        it, so that a refusal lands full-width underneath the title instead of
        inside the action row. Everything below still resolves on the server
        and crosses as rendered nodes — see the note in `price-button.tsx`.

        Instant pricing first, the manual form second: the order they are
        reached for. A covered lane never needs the dialog, which is why the
        dialog is `secondary` here — two filled brand buttons side by side
        make neither of them the answer.
      */}
      <EnquiryPricingHeader
        enquiryId={id}
        canPrice={!comparison.isClosed}
        labels={{ price: t('priceIt'), pricing: t('pricing') }}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/enquiries" className="hover:text-ink">
              {tEnq('title')}
            </Link>
            <Icon name="chevron-end" size={12} />
            <span className="ref">{comparison.enquiryReference}</span>
          </span>
        }
        title={t('title')}
        description={t('subtitle')}
        actionsBefore={
          <EnquiryActions
            enquiryId={id}
            hasResponded={comparison.hasResponded}
            isClosed={comparison.isClosed}
            status={comparison.status}
          />
        }
        actionsAfter={<QuoteDialog enquiryId={id} variant="secondary" />}
      />

      {/*
        What a model read off the mail, above the pricing comparison.

        Placed here because it is the one thing on this page that is *waiting
        on the reader*: the cargo facts are what everything below prices, and a
        coordinator who scrolls past them to the rate comparison is pricing a
        shipment whose weight is still null. It renders nothing when nothing is
        pending, so it costs a settled enquiry no vertical space.
      */}
      <ProposalsPanel enquiryId={id} />

      {/*
        Rate procurement — the manual rate-card upload, retired for a live lane.
        Sits above the quote comparison because it feeds it: an uncovered lane is
        an RFQ to agents, and the buy card an accepted reply becomes is what the
        pricing engine finds the next time this enquiry is priced.
      */}
      <RateRequestsPanel enquiryId={id} />

      {/*
        Moment 2's punchline, stated as a comparison rather than a boast: the
        engine's time next to the manual time, with the manual one in the
        client's own words.
      */}
      <Card className="mb-4" tone="brand">
        {/*
          Two groups, kept adjacent rather than pushed to opposite edges.

          `justify-between` looked right at 1280 and fell apart above it: on a
          wide monitor it opened a hand's width of nothing down the middle and
          the timing and the consignment read as two unrelated things sharing a
          box. The metadata instead takes the remaining width as an even
          four-column grid, so it spreads without drifting, and drops under a
          rule when the row can no longer hold both.
        */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          {timing ? (
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-brand text-on-brand">
                <Icon name="clock" size={18} />
              </span>
              <div>
                <p className="text-[0.9375rem] font-semibold text-ink">
                  {t('pricedIn', { ms: formatNumber(comparison.pricingMs ?? 0, locale) })}
                </p>
                {comparison.manualTurnaroundHours ? (
                  <p className="text-[0.8125rem] text-ink-muted">
                    {t('manualComparison', { hours: comparison.manualTurnaroundHours })}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <dl
            className={`grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 ${
              timing ? 'border-line/60 lg:border-s lg:ps-6' : ''
            }`}
          >
            <Field label={tEnq('customer')}>{comparison.customerName}</Field>
            <Field label={tEnq('lane')}>{orNotRecorded(comparison.lane)}</Field>
            <Field label={tEnq('mode')}>
              <span className="inline-flex items-center gap-1.5">
                <Icon name={modeIcon(comparison.mode)} size={15} />
                {tMode(comparison.mode)}
                {comparison.containerType ? ` · ${comparison.containerType}` : ''}
              </span>
            </Field>
            <Field label={tEnq('incoterm')}>{orNotRecorded(comparison.incoterm)}</Field>
          </dl>
        </div>
      </Card>

      {/* --- the options, side by side where there is a side by side ----- */}
      <div className={`mb-4 grid grid-cols-1 gap-4 ${optionColumns}`}>
        {comparison.options.map((option) => (
          <Card
            key={option.id}
            className={option.isRecommended ? 'ring-2 ring-brand/30' : undefined}
          >
            <div className={solo ? 'md:grid md:grid-cols-2 md:items-center md:gap-8' : ''}>
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* Wraps rather than clips: a carrier name is the first thing
                        compared across the three cards. */}
                    <p className="text-[0.9375rem] font-semibold text-balance text-ink">
                      {orNotRecorded(option.carrier)}
                    </p>
                    {option.service ? (
                      <p className="mt-0.5 text-[0.75rem] text-ink-muted">{option.service}</p>
                    ) : null}
                  </div>
                  {/* Nothing to recommend it over when it is the only one. */}
                  {option.isRecommended && !solo ? (
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
              </div>

              <div className="min-w-0">
                {/*
                  The three numbers together. Splitting them across screens is
                  exactly what the current spreadsheet process does, and why
                  margin is only ever known afterwards.

                  Stacked under the price in a column of three; beside it when
                  this option is the only one, where the rule that separates
                  them runs down rather than across.
                */}
                <dl
                  className={`mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 ${
                    solo ? 'md:mt-0 md:border-t-0 md:border-s md:pt-0 md:ps-8' : ''
                  }`}
                >
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
                  {option.transitDays ? (
                    <div>
                      <dt className="eyebrow mb-1">{t('transit')}</dt>
                      <dd className="numeric text-[0.875rem] font-medium text-ink">
                        {option.transitDays}
                        <span className="text-ink-subtle"> {tc('days')}</span>
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <Meter
                  className={`mt-3 ${solo ? 'md:ms-8' : ''}`}
                  value={option.marginPct}
                  max={maxMargin}
                  tone={option.id === best.id ? 'var(--qb-positive)' : 'var(--qb-chart-1)'}
                  label={`${t('margin')} ${option.marginPct}%`}
                />

                <p className={`mt-3 text-[0.6875rem] text-ink-subtle ${solo ? 'md:ms-8' : ''}`}>
                  {t('validUntil')} {formatDate(option.validUntil, locale, timeZone)}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* --- the breakdown, buy and sell in the same row ---------------- */}
      <Card padding="none">
        <div className="p-5 pb-3">
          {/*
            The carrier only when there is one. "Charge breakdown · —" is a
            heading that reads as a bug; a separator has to travel with the
            thing it separates.
          */}
          <CardHeader
            icon="rates"
            eyebrow={t('option')}
            title={
              comparison.options[0]?.carrier
                ? `${t('breakdown')} · ${comparison.options[0].carrier}`
                : t('breakdown')
            }
            description={t('internalOnly')}
          />
        </div>

        <TableShell>
          <THead>
            <TR>
              <TH>{t('charge')}</TH>
              <TH>{t('basis')}</TH>
              <TH align="end">{t('quantity')}</TH>
              <TH align="end">{t('buy')}</TH>
              <TH align="end">{t('sell')}</TH>
              <TH align="end">{t('margin')}</TH>
              <TH align="end">{t('amount')}</TH>
            </TR>
          </THead>
          <TBody>
            {(comparison.options[0]?.lines ?? []).map((line) => {
              const margin =
                line.sellRate === 0 ? 0 : ((line.sellRate - line.buyRate) / line.sellRate) * 100
              return (
                <TR key={line.chargeCode}>
                  <TD className="font-medium">{locale === 'ar' ? line.nameAr : line.nameEn}</TD>
                  <TD className="text-ink-muted">{t(`bases.${line.basis}` as 'bases.flat')}</TD>
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
