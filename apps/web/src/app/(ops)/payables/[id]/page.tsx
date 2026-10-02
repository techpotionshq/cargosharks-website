/**
 * One supplier bill, and the argument about it — FR-FN-09.
 *
 * The page is arranged in the order the work happens: what arrived, what it
 * should have been, what to do about it. The decision buttons sit in the
 * header rather than at the foot of the table, because the person approving a
 * bill has read the table and then has to scroll back up in every layout that
 * puts them anywhere else.
 *
 * Approve is a dialog rather than a button for one reason: where a line is
 * outside tolerance the action refuses without an explicit acceptance and a
 * reason, and a bare button cannot collect either.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { recordId } from '@/lib/ids'
import { can } from '@/lib/permissions'
import { getSupplierInvoice } from '@/features/payables/queries'
import { listMatchCandidates } from '@/features/costing/queries'
import { SupplierInvoiceLinesCard } from '@/features/payables/ui/panels'
import {
  BillDecisionDialog,
  SupplierInvoiceDialog,
  type MatchCandidateOption,
} from '@/features/payables/ui/dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney, trimDecimal } from '@/lib/format'
import { Card } from '@/ui/card'
import { Field, Grid, PageHeader } from '@/ui/layout'
import { Badge, type Tone } from '@/ui/status'
import { MoreMenu } from '@/ui/menu'

const STATUS_TONE: Record<string, Tone> = {
  received: 'info',
  approved: 'brand',
  part_paid: 'caution',
  paid: 'positive',
  disputed: 'critical',
  void: 'muted',
}

export default async function SupplierInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const id = recordId((await params).id)

  const bill = await getSupplierInvoice(session.actor, id, locale)
  if (!bill) notFound()

  const [candidateRows, t, tc] = await Promise.all([
    /*
      Narrowed to this supplier's costs where we know them.

      An agent's monthly invoice covers thirty shipments and every cost line on
      them names that agent, so this turns a two-hundred-row picker into
      twelve. Costs with no counterparty recorded stay in the list — those are
      exactly the ones most in need of matching.
    */
    listMatchCandidates(session.actor, { partnerId: bill.partnerId }, locale),
    getTranslations('payables'),
    getTranslations('common'),
  ])

  const money = (amount: string, currency: string) =>
    formatMoney({ amount: amount, currency }, locale)

  const candidates: MatchCandidateOption[] = candidateRows.map((c) => ({
    id: c.id,
    group: c.jobReference,
    label: `${c.chargeTypeName} — ${money(c.amount, c.currency)}${
      Number(c.matchedAmount) > 0 ? ` (${t('alreadyMatched')})` : ''
    }`,
  }))

  const editable = ['received', 'disputed'].includes(bill.status)
  const varianceValue = Number(bill.summary.variance.amount.toString())

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/payables" className="hover:text-ink">
              {t('title')}
            </Link>
            <span aria-hidden>·</span>
            <Link href={`/partners/${bill.partnerId}`} className="hover:text-ink">
              {bill.partnerName}
            </Link>
          </span>
        }
        title={bill.reference}
        /*
          Approve is the one primary; editing and disputing the bill sit
          behind More, disputing as the destructive row it is.
        */
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {editable ? (
              <BillDecisionDialog
                billId={bill.id}
                action="approve"
                needsReview={!bill.summary.clean}
              />
            ) : null}
            <MoreMenu label={tc('more')}>
              {editable && can(session, 'payable.record') ? (
                <SupplierInvoiceDialog
                  variant="secondary"
                  defaults={{
                    id: bill.id,
                    branchId: bill.branchId,
                    partnerId: bill.partnerId,
                    reference: bill.reference,
                    currency: bill.currency,
                    fxRate: trimDecimal(bill.fxRate),
                    invoiceDate: bill.invoiceDate,
                    dueOn: bill.dueOn,
                    taxAmount: trimDecimal(bill.taxAmount),
                    notes: bill.notes,
                  }}
                />
              ) : null}
              {editable ? <BillDecisionDialog billId={bill.id} action="dispute" /> : null}
            </MoreMenu>
          </span>
        }
      />

      <Grid>
        <Card className="lg:col-span-12">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Field label={tc('status')}>
              <Badge tone={STATUS_TONE[bill.status] ?? 'muted'}>
                {t(`statuses.${bill.status}` as 'statuses.received')}
              </Badge>
            </Field>
            <Field label={t('invoiceDate')}>{formatDate(bill.invoiceDate, locale, timeZone)}</Field>
            <Field label={t('due')}>
              {bill.dueOn ? formatDate(bill.dueOn, locale, timeZone) : '—'}
            </Field>
            <Field label={t('total')}>{money(bill.total, bill.currency)}</Field>
            <Field label={t('paid')}>{money(bill.amountPaid, bill.currency)}</Field>
            {/*
              The headline figure, in base currency and named as such. It is the
              sum of the line variances, not a difference of totals — two lines
              200 over and 200 under net to zero and have two things wrong with
              them, and this column would hide both if it were a subtraction.
            */}
            <Field label={t('varianceBase', { currency: bill.baseCurrency })}>
              <span className={varianceValue > 0 ? 'font-semibold text-critical' : 'text-ink'}>
                {money(bill.summary.variance.amount.toString(), bill.baseCurrency)}
              </span>
            </Field>
          </dl>

          {bill.varianceAcceptedReason ? (
            <p className="mt-4 border-t border-line pt-3 text-body-sm text-ink-muted">
              <span className="font-medium text-ink">{t('varianceAccepted')}</span>{' '}
              {bill.varianceAcceptedReason}
            </p>
          ) : null}
          {bill.disputeReason ? (
            <p className="mt-4 border-t border-line pt-3 text-body-sm text-critical">
              <span className="font-medium">{t('disputed')}</span> {bill.disputeReason}
            </p>
          ) : null}
        </Card>

        <SupplierInvoiceLinesCard className="lg:col-span-12" bill={bill} candidates={candidates} />
      </Grid>
    </>
  )
}
