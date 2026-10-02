/**
 * The job P&L, and the ledger it comes out of — FR-FN-04.
 *
 * Two things on one card because they are one question. A margin figure with
 * no lines under it is a number to be argued with; a list of charge lines with
 * no margin over it is bookkeeping. Together they answer "what is this
 * shipment making, and why".
 *
 * ## Costs and revenue in one table, not two
 *
 * The obvious layout is a cost table beside a revenue table. It reads well and
 * it hides the thing worth seeing: which cost lines have been *verified*
 * against a supplier's bill and which are still our own guess. That column
 * only makes sense on the cost side, and a shared table with a direction
 * column is what makes the asymmetry visible instead of tidy.
 */

import { getTranslations, getLocale } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { belowFloor } from '@qabandi/core'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatMoney, formatPercent, trimDecimal } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { EmptyState } from '@/ui/layout'
import { Badge, type Tone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { Money } from '@/ui/money'
import { ChargeLineDialog } from './dialogs'
import type { ChargeLineRow, JobLedger } from '../queries'

/**
 * `numeric` arrives as a string and must not be parsed to display it.
 *
 * `Intl.NumberFormat` takes a `number` and there is no way round that at the
 * boundary — but the parse happens *here*, at the last possible moment, on a
 * figure that has already been computed in `Decimal` and is never read back.
 * Every arithmetic step upstream of this line stayed exact.
 */
function display(amount: string, currency: string, locale: 'en' | 'ar'): string {
  return formatMoney({ amount: amount, currency }, locale)
}

/**
 * The writers that put lines in this ledger without anyone typing them.
 *
 * A closed list, and unknown values fall through to the raw key rather than to
 * a missing-message crash: a new worker shipping before its label does should
 * degrade to a slightly ugly row, not to a blank screen on the job file.
 */
const SOURCES = ['consol_allocation', 'consol_allocation_reversal', 'free_time_clock'] as const

type KnownSource = (typeof SOURCES)[number]

function isKnownSource(kind: string): kind is KnownSource {
  return (SOURCES as readonly string[]).includes(kind)
}

/** What the verification column says about one cost line. */
function matchTone(line: ChargeLineRow): { tone: Tone; key: string } {
  if (line.direction === 'revenue') return { tone: 'muted', key: 'na' }
  if (line.matchCount === 0) return { tone: 'muted', key: 'unbilled' }

  const accrued = Number(line.amount)
  const matched = Number(line.matchedAmount)
  if (matched > accrued) return { tone: 'critical', key: 'over' }
  if (matched < accrued) return { tone: 'caution', key: 'part' }
  return { tone: 'positive', key: 'agreed' }
}

export async function JobLedgerCard({
  ledger,
  className,
}: {
  readonly ledger: JobLedger
  readonly className?: string
}) {
  const session = await requireSession()
  const [t, tc] = await Promise.all([getTranslations('charges'), getTranslations('common')])
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const { margin, baseCurrency } = ledger
  const mayWrite = can(session, 'job.update')

  const grossValue = Number(margin.gross.amount.toString())
  const under = belowFloor(margin, ledger.marginFloorPercent)
  const marginTone: Tone = under ? 'critical' : grossValue < 0 ? 'critical' : 'positive'

  return (
    <Card className={className} padding="none">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <CardHeader icon="finance" eyebrow={t('eyebrow')} title={t('title')} />
        {mayWrite ? <ChargeLineDialog jobId={ledger.jobId} variant="ghost" /> : null}
      </div>

      {/*
        The four figures, in the order they are argued about: what we sold it
        for, what it cost, what is left, and how much of the cost is still our
        own estimate rather than a bill we have seen.
      */}
      {/*
        Four across only when the panel has the room, measured on the panel:
        it sits in two-thirds of the job file on a desktop and alone on a
        tablet, and `md:grid-cols-4` cut its figures off at 768, where the
        sidebar leaves the whole file narrower than the breakpoint implies.
      */}
      <div className="@container">
        <dl className="grid grid-cols-2 gap-px border-y border-line bg-line @xl:grid-cols-4">
          <Figure label={t('revenue')}>
            {display(margin.revenue.amount.toString(), baseCurrency, locale)}
          </Figure>
          <Figure label={t('cost')}>
            {display(margin.cost.amount.toString(), baseCurrency, locale)}
          </Figure>
          <Figure label={t('gross')} tone={marginTone}>
            {display(margin.gross.amount.toString(), baseCurrency, locale)}
            {/*
            A real space, not only the margin: copied, read aloud or found with
            the browser's search, the two ran together as "KWD 0.000not priced
            yet" (U6).
          */}{' '}
            <span className="ms-1 text-caption font-normal text-ink-subtle">
              {margin.grossPercent === null
                ? t('unpriced')
                : formatPercent(Number(margin.grossPercent.toString()), locale)}
            </span>
          </Figure>
          <Figure label={t('accrued')} hint={t('accruedHint')}>
            {display(margin.accruedCost.amount.toString(), baseCurrency, locale)}
          </Figure>
        </dl>
      </div>

      {under ? (
        <p className="border-b border-line bg-critical-soft px-5 py-2.5 text-body-sm text-critical">
          {t('belowFloor', { floor: trimDecimal(ledger.marginFloorPercent) ?? '0' })}
        </p>
      ) : null}

      {ledger.lines.length === 0 ? (
        <EmptyState icon="finance" title={t('none')} description={t('noneHint')} />
      ) : (
        <TableShell>
          <THead>
            <TR>
              {/*
                A phone keeps the charge, its amount and whether it is verified.
                Revenue or cost rides in front of the charge name there (below);
                the counterparty, the base-currency figure and the edit button
                wait for a wider screen — a charge line is edited in a form with
                eleven fields, which is desk work.
              */}
              <TH priority="low">{t('direction')}</TH>
              <TH>{t('charge')}</TH>
              <TH priority="low">{t('counterparty')}</TH>
              <TH align="end">{t('amount')}</TH>
              <TH priority="low" align="end">
                {t('inBase', { currency: baseCurrency })}
              </TH>
              <TH>{t('verified')}</TH>
              {mayWrite ? (
                <TH priority="low" align="end">
                  {tc('actions')}
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {ledger.lines.map((line) => {
              const verdict = matchTone(line)
              const frozen = line.isBilled || line.matchCount > 0

              return (
                <TR key={line.id}>
                  <TD priority="low">
                    <Badge tone={line.direction === 'revenue' ? 'info' : 'muted'}>
                      {t(line.direction === 'revenue' ? 'revenueShort' : 'costShort')}
                    </Badge>
                  </TD>
                  <TD>
                    <span className="mb-1 block @3xl:hidden">
                      <Badge tone={line.direction === 'revenue' ? 'info' : 'muted'}>
                        {t(line.direction === 'revenue' ? 'revenueShort' : 'costShort')}
                      </Badge>
                    </span>
                    <span className="font-medium">{line.chargeTypeName}</span>
                    {line.description ? (
                      <span dir="auto" className="mt-0.5 block text-micro text-ink-subtle">
                        {line.description}
                      </span>
                    ) : null}
                    {/*
                      A line nobody typed says who typed it. "Why is there a
                      62.400 KWD freight cost on this house" is answered here
                      rather than by a join somebody has to think of.
                    */}
                    {line.sourceKind ? (
                      <span className="mt-0.5 block text-micro text-ink-subtle">
                        {isKnownSource(line.sourceKind)
                          ? t(`source.${line.sourceKind}`)
                          : line.sourceKind}
                      </span>
                    ) : null}
                  </TD>
                  <TD priority="low" className="text-ink-muted">
                    {line.counterpartyName ?? '—'}
                  </TD>
                  <TD align="end" numeric>
                    <Money
                      value={{ amount: line.amount, currency: line.currency }}
                      locale={locale}
                    />
                  </TD>
                  <TD priority="low" align="end" numeric className="text-ink-muted">
                    <Money
                      value={{ amount: line.amountBase, currency: line.baseCurrency }}
                      locale={locale}
                    />
                  </TD>
                  <TD>
                    <Badge tone={verdict.tone}>{t(`match.${verdict.key}` as 'match.agreed')}</Badge>
                    {line.matchCount > 0 ? (
                      <span className="mt-0.5 block text-micro text-ink-subtle tabular-nums">
                        {display(line.matchedAmount, line.currency, locale)}
                      </span>
                    ) : null}
                  </TD>
                  {mayWrite ? (
                    <TD priority="low" align="end">
                      {frozen ? (
                        <span className="text-micro text-ink-subtle">
                          {t(line.isBilled ? 'frozenBilled' : 'frozenMatched')}
                        </span>
                      ) : (
                        <ChargeLineDialog
                          jobId={ledger.jobId}
                          iconOnly
                          defaults={{
                            id: line.id,
                            direction: line.direction,
                            chargeTypeId: line.chargeTypeId,
                            description: line.description,
                            basis: line.basis,
                            quantity: trimDecimal(line.quantity),
                            rate: trimDecimal(line.rate),
                            currency: line.currency,
                            fxRate: trimDecimal(line.fxRate),
                            // Without it the select opened on "none" and the
                            // save wrote null — payables matching and the
                            // partner settlement both lost the line.
                            counterpartyPartnerId: line.counterpartyPartnerId,
                          }}
                        />
                      )}
                    </TD>
                  ) : null}
                </TR>
              )
            })}
          </TBody>
        </TableShell>
      )}
    </Card>
  )
}

function Figure({
  label,
  hint,
  tone = 'muted',
  children,
}: {
  readonly label: string
  readonly hint?: string
  readonly tone?: Tone
  readonly children: React.ReactNode
}) {
  const colour =
    tone === 'critical' ? 'text-critical' : tone === 'positive' ? 'text-positive' : 'text-ink'

  return (
    <div className="bg-surface px-5 py-3.5">
      <dt className="text-caption font-medium text-ink-muted">{label}</dt>
      <dd className={`mt-1 text-heading font-semibold tabular-nums ${colour}`}>{children}</dd>
      {hint ? <p className="mt-0.5 text-micro text-ink-subtle">{hint}</p> : null}
    </div>
  )
}
