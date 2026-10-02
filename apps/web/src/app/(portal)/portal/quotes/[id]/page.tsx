/**
 * One of the customer's quotations — `FR-CP-07`, D12.
 *
 * What they were offered, line by line, in the quotation's own currency, and
 * the two answers they can give while it stands. The cost, the margin and the
 * preparer that the operations page shows beside the same figures are not
 * here because `getPortalQuote` never selects them.
 *
 * The PDF is the same document the branch sends, through the same route. The
 * route resolves the session and hands the customer's actor to the renderer,
 * so `quotes_customer_reads` decides whether there is a document at all: a
 * draft or a replaced version is not found, for the PDF as for this page.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { todayIn } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { recordId } from '@/lib/ids'
import { getPortalQuote } from '@/features/portal/queries'
import { QUOTE_STATE_TONE, portalQuoteState } from '@/features/portal/status'
import { PortalQuoteAnswer } from '@/features/portal/ui/quote-answer'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatDateTime, trimDecimal } from '@/lib/format'
import { Icon, modeIcon } from '@/ui/icon'
import { Button, EmptyState, Field, Grid, Lane, PageHeader } from '@/ui/layout'
import { Panel } from '@/ui/panel'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Money } from '@/ui/money'
import { Notice } from '@/ui/notice'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portalQuotes')
  return { title: t('title') }
}

export default async function PortalQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const timeZone = await getTimeZone()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const id = recordId((await params).id)

  // Another company's quotation, a draft and a replaced version all land
  // here as not found — no enumeration signal (FR-ID-04).
  const quote = await getPortalQuote(session.actor, id, locale)
  if (!quote) notFound()

  const t = await getTranslations('portalQuotes')
  const tMode = await getTranslations('mode')
  const tBasis = await getTranslations('quoteForm')

  const state = portalQuoteState(quote, todayIn())
  const label = {
    sent: t('statusSent'),
    expired: t('statusExpired'),
    accepted: t('statusAccepted'),
    rejected: t('statusRejected'),
  }
  const pdf = `/api/quotes/${quote.id}/pdf`
  // A date column at midnight UTC is still that day in Kuwait, so the day
  // printed is the day the offer stands until.
  const validUntil = quote.validUntil ? formatDate(quote.validUntil, locale) : null

  return (
    <>
      <Link
        href="/portal/quotes"
        className="mb-4 inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
      >
        {/* The end chevron mirrors in Arabic; turned, it points back either way. */}
        <Icon name="chevron-end" size={14} className="rotate-180" />
        {t('backToQuotes')}
      </Link>

      <PageHeader
        title={<span className="ref numeric">{quote.reference}</span>}
        description={
          quote.originName && quote.destinationName ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {quote.mode ? <Icon name={modeIcon(quote.mode)} size={14} /> : null}
              <Lane origin={quote.originName} destination={quote.destinationName} />
              {quote.mode ? ` · ${tMode(quote.mode)}` : ''}
            </span>
          ) : undefined
        }
        status={
          <>
            <Badge tone={QUOTE_STATE_TONE[state]} dot>
              {label[state]}
            </Badge>
            {quote.version > 1 ? (
              <Badge tone="muted">{t('version', { version: quote.version })}</Badge>
            ) : null}
          </>
        }
        actions={
          <>
            <Button href={pdf} variant="ghost" icon="download" download>
              {t('pdf')}
            </Button>
            <Button href={`${pdf}?locale=ar`} variant="ghost" icon="download" download>
              {t('pdfAr')}
            </Button>
            {state === 'sent' ? (
              <PortalQuoteAnswer quoteId={quote.id} reference={quote.reference} />
            ) : null}
          </>
        }
      />

      {state === 'sent' && validUntil ? (
        <Notice tone="info" icon="clock" className="mb-4">
          {t('validNotice', { on: validUntil })}
        </Notice>
      ) : null}
      {state === 'expired' && validUntil ? (
        <Notice tone="caution" icon="clock" className="mb-4">
          {t('expiredOn', { on: validUntil })}
        </Notice>
      ) : null}

      <Grid className="mb-4">
        <Panel className="@4xl:col-span-8" padding="none" icon="finance" title={t('lines')}>
          {quote.lines.length === 0 ? (
            <EmptyState icon="finance" title={t('noLines')} />
          ) : (
            <TableShell>
              <THead>
                <TR>
                  <TH>{t('charge')}</TH>
                  <TH priority="low">{t('basis')}</TH>
                  <TH priority="low" align="end">
                    {t('quantity')}
                  </TH>
                  <TH priority="low" align="end">
                    {t('rate')}
                  </TH>
                  <TH align="end">{t('amount')}</TH>
                </TR>
              </THead>
              <TBody>
                {quote.lines.map((line) => (
                  <TR key={line.id}>
                    <TD className="font-medium text-ink">
                      {line.chargeName}
                      {line.description ? (
                        <span dir="auto" className="block text-caption font-normal text-ink-subtle">
                          {line.description}
                        </span>
                      ) : null}
                    </TD>
                    <TD priority="low" className="text-ink-muted">
                      {tBasis(`bases.${line.basis}` as 'bases.flat')}
                    </TD>
                    {/* Exact, as typed: a quantity is a decimal string, never a float. */}
                    <TD priority="low" align="end" numeric className="text-ink-muted">
                      <span dir="ltr">{trimDecimal(line.quantity)}</span>
                    </TD>
                    <TD priority="low" align="end" numeric className="text-ink-muted">
                      <Money
                        value={{ amount: line.rate, currency: line.currency }}
                        locale={locale}
                        showCurrency={false}
                      />
                    </TD>
                    <TD align="end" numeric className="font-semibold">
                      <Money
                        value={{ amount: line.amount, currency: line.currency }}
                        locale={locale}
                        showCurrency={false}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-line px-5 py-3">
            <span className="text-body font-semibold text-ink">{t('total')}</span>
            <span className="text-title font-semibold text-ink">
              <Money
                value={quote.total ? { amount: quote.total, currency: quote.currency } : null}
                locale={locale}
              />
            </span>
          </div>
        </Panel>

        <div className="flex flex-col gap-4 @4xl:col-span-4">
          <Panel icon="quotes" title={t('about')}>
            <dl className="grid grid-cols-2 gap-4">
              <Field label={t('enquiry')}>
                <span className="ref">{quote.enquiryReference}</span>
              </Field>
              <Field label={t('validUntil')}>{validUntil ?? '—'}</Field>
              <Field label={t('sentAt')}>
                {quote.sentAt ? formatDateTime(quote.sentAt, locale, timeZone) : '—'}
              </Field>
              <Field label={t('decidedAt')}>
                {quote.decidedAt ? formatDateTime(quote.decidedAt, locale, timeZone) : '—'}
              </Field>
              {quote.incoterm ? (
                <Field label={t('incoterm')}>
                  <span className="ref">{quote.incoterm}</span>
                </Field>
              ) : null}
              {quote.branchName ? <Field label={t('issuedBy')}>{quote.branchName}</Field> : null}
            </dl>
          </Panel>

          {quote.coverNote ? (
            <Panel icon="document" title={t('coverNote')}>
              <p dir="auto" className="text-body-sm whitespace-pre-line text-ink-muted">
                {quote.coverNote}
              </p>
            </Panel>
          ) : null}

          {quote.decisionNote ? (
            <Panel icon="audit" title={t('yourReason')}>
              <p dir="auto" className="text-body-sm whitespace-pre-line text-ink-muted">
                {quote.decisionNote}
              </p>
            </Panel>
          ) : null}
        </div>
      </Grid>
    </>
  )
}
