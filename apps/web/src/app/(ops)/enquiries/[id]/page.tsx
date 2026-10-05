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

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { recordId } from '@/lib/ids'
import { getQuoteComparison } from '@/features/quotes/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { currencyLabel, formatDate, formatMoney, formatNumber } from '@/lib/format'
import { fxRateLabel, type FxTranslate } from '@/lib/fx-label'
import { Card, CardHeader } from '@/ui/card'
import { Field } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { Meter } from '@/ui/chart'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { Money } from '@/ui/money'
import { EnquiryActions } from '@/features/enquiries/ui/enquiry-actions'
import { ProposalsPanel } from '@/features/enquiries/ui/proposals-panel'
import { EnquiryAutomationStrip } from '@/features/enquiries/ui/enquiry-automation-strip'
import { IntakeAgentPanel } from '@/features/enquiries/ui/intake-agent-panel'
import { RateRequestsPanel } from '@/features/rates/ui/rate-requests-panel'
import { QuoteDialog } from '@/features/ledger/ui/dialogs'
import { EnquiryPricingHeader } from '@/features/ledger/ui/price-button'
import { MoreMenu } from '@/ui/menu'
import { ContainerCountForm } from '@/features/enquiries/ui/container-count-form'
import { EditEnquiryDialog } from '@/features/enquiries/ui/edit-enquiry-dialog'
import { ConversationPanel } from '@/features/enquiries/ui/conversation-panel'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const session = await requireSession()
  const comparison = await getQuoteComparison(session.actor, recordId((await params).id))
  const t = await getTranslations('enquiry')
  return { title: comparison?.enquiryReference ?? t('title') }
}

export default async function EnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const id = recordId((await params).id)
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  // The locale names the customer and the lane in the reader's language (F27).
  const comparison = await getQuoteComparison(session.actor, id, locale)
  if (!comparison) notFound()

  const t = await getTranslations('quote')
  const tEnq = await getTranslations('enquiry')
  const tFx = await getTranslations('fxFeed')
  const tForm = await getTranslations('enquiryForm')
  const tMode = await getTranslations('mode')
  const tc = await getTranslations('common')

  // A new enquiry has no quote yet; the panels above the options still apply.
  const hasOptions = comparison.options.length > 0
  const best = hasOptions
    ? comparison.options.reduce((a, b) => (a.marginPct > b.marginPct ? a : b))
    : undefined
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
      ? '@2xl:grid-cols-2'
      : '@2xl:grid-cols-2 @5xl:grid-cols-3'

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
        // An accepted quotation is never superseded, so neither re-pricing nor
        // a new version is offered once the customer has said yes (S2).
        canPrice={!comparison.isClosed && !comparison.hasAccepted}
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
        title={hasOptions ? t('title') : t('awaitingTitle')}
        description={
          !hasOptions
            ? t('awaitingSubtitle')
            : comparison.pricedFrom === 'manual'
              ? t('subtitleManual')
              : comparison.pricedFrom === 'mixed'
                ? t('subtitleMixed')
                : t('subtitle')
        }
        /*
          One primary action — Price it — and everything else behind More.

          This header used to carry six equal buttons: Mark replied, Assign,
          Cancel it, Close, Price it, New quotation. The one that moves an
          enquiry on was the fifth and no louder than the one that ends it.
          The menu keeps every move one click away in the same order, with
          cancelling drawn as the destructive row it is.
        */
        actionsAfter={
          comparison.isClosed ? null : (
            <MoreMenu label={tc('more')}>
              {/*
                First in the menu: correcting what the customer asked for comes
                before moving the enquiry on, and it is where the proposals
                panel sends a coordinator whose suggestion matched nothing (D4).
              */}
              <EditEnquiryDialog enquiryId={id} />
              <EnquiryActions
                enquiryId={id}
                hasResponded={comparison.hasResponded}
                isClosed={comparison.isClosed}
                status={comparison.status}
              />
              {comparison.hasAccepted ? null : (
                /*
                  Defaults from the enquiry and its current quotation (S7): the
                  enquiry's branch and base currency, and the figures already
                  priced, so a revision starts from the offer it revises rather
                  than from DXB, USD and two empty boxes.
                */
                <QuoteDialog
                  enquiryId={id}
                  branchId={comparison.branchId}
                  currency={comparison.options[0]?.sell.currency ?? comparison.baseCurrency}
                  totalSell={
                    comparison.options[0] ? String(comparison.options[0].sell.amount) : undefined
                  }
                  totalCost={
                    comparison.options[0] ? String(comparison.options[0].buy.amount) : undefined
                  }
                  variant="secondary"
                />
              )}
            </MoreMenu>
          )
        }
      />

      {/*
        Moment 2's punchline, stated as a comparison rather than a boast: the
        engine's time next to the manual time, with the manual one in the
        client's own words.
      */}
      <Card className="mb-4" tone="brand">
        {/*
          Rows, not one wrapping line.

          The timing, the four facts and the container form used to share a
          `flex-wrap` row, with the facts as a `sm:grid-cols-4` grid squeezed
          into whatever width the other two left. At 768 the sidebar leaves the
          card ~440px, the grid still went four-up, and the labels overlapped
          values cut to single letters ("Sea FCL · 1 × 40HC" broke per word at
          every width). Each group now takes its own row, and the facts lay
          out against the card's width (`@container`), not the window's: two
          columns with customer and lane given the whole line until there is
          room for four, the timing beside them only on a wide card.
        */}
        <div className="@container">
          <div className="flex flex-col gap-4 @4xl:flex-row @4xl:items-start @4xl:gap-6">
            {timing ? (
              <div className="flex shrink-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-accent text-on-brand">
                  <Icon name="clock" size={18} />
                </span>
                <div>
                  <p className="text-title font-semibold text-ink">
                    {t('pricedIn', { ms: formatNumber(comparison.pricingMs ?? 0, locale) })}
                  </p>
                  {comparison.manualTurnaroundHours ? (
                    <p className="text-body-sm text-ink-muted">
                      {t('manualComparison', { hours: comparison.manualTurnaroundHours })}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <dl
              className={`grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 @3xl:grid-cols-4 ${
                timing ? 'border-line/60 @4xl:border-s @4xl:ps-6' : ''
              }`}
            >
              <Field label={tEnq('customer')} className="col-span-2 @3xl:col-span-1">
                {orNotRecorded(comparison.customerName)}
              </Field>
              <Field label={tEnq('lane')} className="col-span-2 @3xl:col-span-1">
                {orNotRecorded(comparison.lane)}
              </Field>
              <Field label={tEnq('mode')}>
                {comparison.mode ? (
                  // Two unbreakable halves: the mode and the equipment wrap as
                  // units, never "Sea / FCL / · / 1 / × / 40HC".
                  <span className="inline-flex flex-wrap items-center gap-x-1.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Icon name={modeIcon(comparison.mode)} size={15} />
                      {tMode(comparison.mode)}
                    </span>
                    {comparison.containerType ? (
                      <span className="whitespace-nowrap" dir="ltr">
                        · {comparison.containerType}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  tc('notRecorded')
                )}
              </Field>
              <Field label={tEnq('incoterm')}>{orNotRecorded(comparison.incoterm)}</Field>
            </dl>
          </div>
          {/*
            Sea FCL is priced per container and refuses without a count; an
            enquiry that arrived by email or WhatsApp has no other way to get
            one. Under the facts, ruled off, rather than as a third item in
            their row.
          */}
          {comparison.mode === 'sea_fcl' && !comparison.isClosed ? (
            <div className="mt-4 border-t border-line/60 pt-4">
              <ContainerCountForm
                enquiryId={id}
                current={comparison.containerCount}
                labels={{
                  field: tForm('containers'),
                  save: tc('save'),
                  hint: tForm('containersHint'),
                }}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {/*
        What a model read off the mail, above the pricing comparison.

        Placed here because it is the one thing on this page that is *waiting
        on the reader*: the cargo facts are what everything below prices, and a
        coordinator who scrolls past them to the rate comparison is pricing a
        shipment whose weight is still null. It renders nothing when nothing is
        pending, so it costs a settled enquiry no vertical space.
      */}
      {/*
        The glance above the panels: what the automations did on this enquiry —
        acknowledged the customer, read N fields, asked N agents — so the machine
        working on the file is visible, not inferred from three separate panels.
      */}
      <EnquiryAutomationStrip enquiryId={id} />

      {/*
        The intake agent's conversation with the customer — its state, what it
        is still waiting for, and the reason behind every reply and every
        silence. Above the proposals, because it is what produced them.
      */}
      <IntakeAgentPanel enquiryId={id} />

      {/*
        What the customer actually wrote, and what we wrote back, in order —
        and the box to answer them in (D5). Under the agent's panel, which
        explains its own replies on this thread, and above the proposals read
        from it.
      */}
      <ConversationPanel enquiryId={id} />

      <ProposalsPanel enquiryId={id} />

      {/*
        Rate procurement — the manual rate-card upload, retired for a live lane.
        Sits above the quote comparison because it feeds it: an uncovered lane is
        an RFQ to agents, and the buy card an accepted reply becomes is what the
        pricing engine finds the next time this enquiry is priced.
      */}
      <RateRequestsPanel enquiryId={id} />

      {hasOptions ? (
        <div className="@container">
          {/* --- the options, side by side where there is a side by side ----- */}
          {/* Columns by the width the page has, not the window — see the facts card. */}
          <div className={`mb-4 grid grid-cols-1 gap-4 ${optionColumns}`}>
            {comparison.options.map((option) => (
              <Card
                key={option.id}
                className={option.isRecommended ? 'ring-2 ring-accent/30' : undefined}
              >
                <div
                  className={solo ? '@2xl:grid @2xl:grid-cols-2 @2xl:items-center @2xl:gap-8' : ''}
                >
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {/* Wraps rather than clips: a carrier name is the first thing
                        compared across the three cards. */}
                        <p className="text-title font-semibold text-balance text-ink">
                          {orNotRecorded(option.carrier)}
                        </p>
                        {option.service ? (
                          <p className="mt-0.5 text-caption text-ink-muted">{option.service}</p>
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
                      <span className="numeric font-display text-display-lg leading-none font-semibold tracking-tight text-ink">
                        {formatMoney(option.sell, locale, { showCurrency: false })}
                      </span>
                      <span className="text-body-sm font-medium text-ink-subtle">
                        {currencyLabel(option.sell.currency, locale)}
                      </span>
                    </div>
                    <p className="mt-1 text-caption text-ink-subtle">{t('sell')}</p>
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
                        solo ? '@2xl:mt-0 @2xl:border-t-0 @2xl:border-s @2xl:pt-0 @2xl:ps-8' : ''
                      }`}
                    >
                      <div>
                        <dt className="eyebrow mb-1">{t('buy')}</dt>
                        <dd className="numeric text-body font-medium text-ink-muted">
                          {formatMoney(option.buy, locale, { showCurrency: false })}
                        </dd>
                      </div>
                      <div>
                        <dt className="eyebrow mb-1">{t('margin')}</dt>
                        <dd
                          className={`numeric text-body font-semibold ${
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
                          <dd className="numeric text-body font-medium text-ink">
                            {option.transitDays}
                            <span className="text-ink-subtle"> {tc('days')}</span>
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <Meter
                      className={`mt-3 ${solo ? '@2xl:ms-8' : ''}`}
                      value={option.marginPct}
                      max={maxMargin}
                      tone={option.id === best?.id ? 'var(--qb-positive)' : 'var(--qb-chart-1)'}
                      label={`${t('margin')} ${option.marginPct}%`}
                    />

                    <p className={`mt-3 text-micro text-ink-subtle ${solo ? '@2xl:ms-8' : ''}`}>
                      {t('validUntil')} {formatDate(option.validUntil, locale, timeZone)}
                    </p>

                    {/*
                      The rate each converted line was priced at, whose rate it
                      was and when it was taken — visible before the quotation
                      is sent, because a feed rate is indicative and the person
                      sending it is the one who has to check it. In UTC, the
                      providers' own day, so it matches what they publish.
                    */}
                    {option.fx && option.fx.length > 0 ? (
                      <ul
                        className={`mt-2 space-y-0.5 text-micro text-ink-muted ${solo ? '@2xl:ms-8' : ''}`}
                        data-testid="quote-fx"
                      >
                        {option.fx.map((rate) => (
                          <li key={`${rate.from}-${rate.to}`}>
                            {tFx('convertedAt')}{' '}
                            <bdi dir="ltr" className="numeric">
                              {fxRateLabel(rate, tFx as unknown as FxTranslate, locale)}
                            </bdi>
                          </li>
                        ))}
                      </ul>
                    ) : null}
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
                  {/* On a phone a line is its charge, its margin and its
                      amount; the arithmetic behind them waits for a wider
                      screen, and the totals row below follows suit. */}
                  <TH priority="low">{t('basis')}</TH>
                  <TH priority="low" align="end">
                    {t('quantity')}
                  </TH>
                  <TH priority="low" align="end">
                    {t('buy')}
                  </TH>
                  <TH priority="low" align="end">
                    {t('sell')}
                  </TH>
                  <TH align="end">{t('margin')}</TH>
                  <TH align="end">{t('amount')}</TH>
                </TR>
              </THead>
              <TBody>
                {(comparison.options[0]?.lines ?? []).map((line) => {
                  /*
                    A line's buy rate is known only where something recorded it —
                    the pilot fixtures do, and a quotation priced from a card does
                    since `priced_snapshot.lineCosts`; older ones do not. It used
                    to render as 0.00 with a 100% margin on every line, on the one
                    screen whose job is to show buy beside sell. Unknown now says
                    so; the totals row, which is known, is unaffected.

                    Rates format in the line's currency, not `toFixed(2)`: a KWD
                    rate has three decimals, and two rounded 250.125 to 250.13.
                  */
                  const currency = line.amount.currency
                  const margin =
                    line.buyRate === null || line.sellRate === 0
                      ? null
                      : ((line.sellRate - line.buyRate) / line.sellRate) * 100
                  return (
                    <TR key={line.chargeCode}>
                      <TD className="font-medium">{locale === 'ar' ? line.nameAr : line.nameEn}</TD>
                      <TD priority="low" className="text-ink-muted">
                        {t(`bases.${line.basis}` as 'bases.flat')}
                      </TD>
                      <TD priority="low" align="end" numeric>
                        {line.quantity}
                      </TD>
                      <TD priority="low" align="end" numeric className="text-ink-muted">
                        {line.buyRate === null ? (
                          tc('notRecorded')
                        ) : (
                          <Money
                            value={{ amount: line.buyRate, currency }}
                            locale={locale}
                            showCurrency={false}
                          />
                        )}
                      </TD>
                      <TD priority="low" align="end" numeric>
                        <Money
                          value={{ amount: line.sellRate, currency }}
                          locale={locale}
                          showCurrency={false}
                        />
                      </TD>
                      <TD align="end" numeric>
                        {margin === null ? (
                          <span className="text-ink-subtle">{tc('notRecorded')}</span>
                        ) : (
                          <span className={margin < 12 ? 'text-caution' : 'text-ink-muted'}>
                            {margin.toFixed(1)}%
                          </span>
                        )}
                      </TD>
                      <TD align="end" numeric className="font-semibold">
                        <Money value={line.amount} locale={locale} showCurrency={false} />
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-surface-sunken">
                  <TD className="font-semibold">{t('total')}</TD>
                  <TD priority="low" />
                  <TD priority="low" />
                  <TD priority="low" align="end" numeric className="font-medium text-ink-muted">
                    <Money
                      value={comparison.options[0]?.buy}
                      locale={locale}
                      showCurrency={false}
                    />
                  </TD>
                  <TD priority="low" align="end" numeric className="font-semibold">
                    <Money
                      value={comparison.options[0]?.sell}
                      locale={locale}
                      showCurrency={false}
                    />
                  </TD>
                  <TD align="end" numeric className="font-semibold text-positive">
                    {comparison.options[0]?.marginPct.toFixed(1)}%
                  </TD>
                  <TD align="end" numeric className="font-semibold">
                    <Money value={comparison.options[0]?.sell} locale={locale} />
                  </TD>
                </tr>
              </tfoot>
            </TableShell>
          </Card>
        </div>
      ) : null}
    </>
  )
}
