/**
 * Where a customer stands, and every exception ever made for them.
 *
 * Two things earn their place on this card and neither is the balance.
 *
 * **The headroom, as a number.** "12,400 KWD of 40,000" is a fact; "27,600
 * KWD before this customer is blocked" is the one a salesperson acts on, and
 * it is the one that stops the block being a surprise at the moment of
 * booking.
 *
 * **The overrides, in full, for ever.** Not the live ones — all of them. The
 * question this card exists to answer a year later is "how often do we release
 * this customer, and who keeps doing it", and a list filtered to what is
 * currently active cannot answer it. A pattern of six one-shot overrides in
 * four months is a credit limit that is wrong, and nobody sees that if each
 * one disappears the day after it is used.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { EmptyState, Field } from '@/ui/layout'
import { Badge, type Tone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { CreditOverrideDialog } from './dialogs'
import type { CreditView } from '../queries'

/** The four outcomes, and the colour each earns. */
const TONES: Record<CreditView['outcome'], Tone> = {
  within_limit: 'positive',
  // Not a warning. No limit is a decision nobody has taken, which is a
  // different thing from a customer who is comfortably inside one.
  unlimited: 'muted',
  over_limit: 'critical',
  on_hold: 'critical',
}

export async function CreditStandingCard({
  view,
  customerId,
  branchId,
  className,
}: {
  readonly view: CreditView
  readonly customerId: string
  readonly branchId: string
  readonly className?: string
}) {
  const session = await requireSession()
  const [t, locale] = await Promise.all([getTranslations('credit'), getLocale()])
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE
  const mayOverride = can(session, 'credit.override')

  const amount = (value: string) => `${value} ${view.currency}`

  return (
    <Card className={className}>
      <CardHeader
        icon="finance"
        eyebrow={t('eyebrow')}
        title={t('title')}
        actions={
          mayOverride && view.limit ? (
            <CreditOverrideDialog
              defaults={{
                customerId,
                branchId,
                exposure: view.outstanding,
                limit: view.limit,
                currency: view.currency,
              }}
            />
          ) : undefined
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={TONES[view.outcome]}>{t(`outcome.${view.outcome}` as 'outcome.on_hold')}</Badge>
        {view.nearLimit ? <Badge tone="caution">{t('nearLimit')}</Badge> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <Field label={t('outstanding')} mono>
          {amount(view.outstanding)}
        </Field>
        <Field label={t('limit')} mono>
          {view.limit ? amount(view.limit) : t('noLimit')}
        </Field>
        {view.blocked ? (
          <Field label={t('excess')} mono>
            {amount(view.excess)}
          </Field>
        ) : view.headroom ? (
          <Field label={t('headroom')} mono>
            {amount(view.headroom)}
          </Field>
        ) : null}
      </div>

      {/*
        The honest failure. An invoice we could not convert is not silently
        dropped from the exposure — the figure above is a floor, and saying so
        is the difference between a credit check that is believed and one that
        should not be.
      */}
      {view.unconvertible.length > 0 ? (
        <p className="mt-3 text-[0.75rem] text-critical">
          {t('unconvertible', {
            list: view.unconvertible.map((u) => `${u.amount} ${u.currency}`).join(', '),
          })}
        </p>
      ) : null}

      <h3 className="mt-6 text-[0.8125rem] font-medium text-ink">{t('overridesTitle')}</h3>

      {view.overrides.length === 0 ? (
        <EmptyState className="mt-2" title={t('noOverrides')} />
      ) : (
        <TableShell className="mt-2">
          <THead>
            <TR>
              <TH>{t('approvedAt')}</TH>
              <TH>{t('approvedBy')}</TH>
              <TH>{t('scope')}</TH>
              <TH className="text-end">{t('exposureThen')}</TH>
              <TH>{t('reason')}</TH>
            </TR>
          </THead>
          <TBody>
            {view.overrides.map((o) => (
              <TR key={o.id}>
                <TD>{formatDate(o.approvedAt, lang)}</TD>
                <TD>{lang === 'ar' ? (o.approvedByAr ?? o.approvedByEn) : o.approvedByEn}</TD>
                <TD>
                  {o.expiresOn ? (
                    <Badge tone={o.isLive ? 'caution' : 'muted'}>
                      {t(o.isLive ? 'standingUntil' : 'lapsedOn', { date: o.expiresOn })}
                    </Badge>
                  ) : (
                    <Badge tone="muted">
                      {t(o.jobId ? 'oneShotJob' : o.invoiceId ? 'oneShotInvoice' : 'oneShot')}
                    </Badge>
                  )}
                </TD>
                <TD className="text-end tabular-nums">
                  {o.exposure} / {o.creditLimit} {o.currency}
                </TD>
                <TD className="max-w-[22rem] whitespace-normal text-ink-muted">{o.reason}</TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </Card>
  )
}
