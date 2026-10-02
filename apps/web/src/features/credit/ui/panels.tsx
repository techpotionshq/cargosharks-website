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

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { EmptyState, Field } from '@/ui/layout'
import { Badge, type Tone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { Money } from '@/ui/money'
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
  const timeZone = await getTimeZone()

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

      {/*
        The outcome sits with the figures it is a verdict on, not on a line of
        its own above them. "No limit set" alone in a band of whitespace reads
        as a heading for the row beneath it; at the end of that row it reads as
        what it is — the conclusion drawn from the numbers to its inline start.
        `items-end` lands the badge on the same line as the values, since a
        `Field` carries its label above them.
      */}
      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field label={t('outstanding')} mono>
          {amount(view.outstanding)}
        </Field>
        {/*
          Mono is applied to the value, not to the field.

          `.ref` is the face for machine identifiers and `.numeric` for
          figures; neither is for words. "None agreed" is a sentence, and set
          in the monospace it looked like a code the operator was meant to
          recognise.
        */}
        <Field label={t('limit')} mono={Boolean(view.limit)}>
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
        <div className="flex flex-wrap items-center gap-2 pb-0.5">
          <Badge tone={TONES[view.outcome]}>
            {t(`outcome.${view.outcome}` as 'outcome.on_hold')}
          </Badge>
          {view.nearLimit ? <Badge tone="caution">{t('nearLimit')}</Badge> : null}
        </div>
      </div>

      {/*
        The honest failure. An invoice we could not convert is not silently
        dropped from the exposure — the figure above is a floor, and saying so
        is the difference between a credit check that is believed and one that
        should not be.
      */}
      {view.unconvertible.length > 0 ? (
        <p className="mt-3 text-caption text-critical">
          {t('unconvertible', {
            list: view.unconvertible.map((u) => `${u.amount} ${u.currency}`).join(', '),
          })}
        </p>
      ) : null}

      <h3 className="mt-6 text-body-sm font-medium text-ink">{t('overridesTitle')}</h3>

      {view.overrides.length === 0 ? (
        <EmptyState className="mt-1.5" variant="inline" icon="check" title={t('noOverrides')} />
      ) : (
        <TableShell className="mt-2">
          <THead>
            <TR>
              <TH>{t('approvedAt')}</TH>
              {/* When, its scope and the exposure it let through stay across
                  a phone; who approved it and why follow the date there
                  (below) rather than leaving the record. */}
              <TH priority="low">{t('approvedBy')}</TH>
              <TH>{t('scope')}</TH>
              <TH align="end">{t('exposureThen')}</TH>
              <TH priority="low">{t('reason')}</TH>
            </TR>
          </THead>
          <TBody>
            {view.overrides.map((o) => (
              <TR key={o.id}>
                <TD>
                  {/* Held to one line from md only: this table sits inside a
                      padded card, 40px narrower than a register on a phone. */}
                  <span className="md:whitespace-nowrap">
                    {formatDate(o.approvedAt, lang, timeZone)}
                  </span>
                  <span className="block text-caption text-ink-muted md:hidden">
                    {lang === 'ar' ? (o.approvedByAr ?? o.approvedByEn) : o.approvedByEn}
                  </span>
                  <span className="mt-0.5 block text-caption break-words text-ink-subtle md:hidden">
                    {o.reason}
                  </span>
                </TD>
                <TD priority="low">
                  {lang === 'ar' ? (o.approvedByAr ?? o.approvedByEn) : o.approvedByEn}
                </TD>
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
                {/*
                  At the currency's precision — the raw columns printed
                  "20550.000000 / 120000.000000 KWD". The limit takes its own
                  line on a phone, where the pair on one line was the table's
                  whole overflow.
                */}
                <TD align="end" numeric>
                  <span className="block md:inline">
                    <Money value={{ amount: o.exposure, currency: o.currency }} locale={lang} />
                  </span>
                  <span className="block text-ink-muted md:inline">
                    <span className="hidden md:inline"> </span>/{' '}
                    <Money value={{ amount: o.creditLimit, currency: o.currency }} locale={lang} />
                  </span>
                </TD>
                <TD priority="low" className="max-w-[22rem] whitespace-normal text-ink-muted">
                  {o.reason}
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </Card>
  )
}
