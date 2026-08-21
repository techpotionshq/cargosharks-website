/**
 * One customer — the record and its per-branch terms.
 *
 * Edit in place rather than on a separate screen: a customer record is short
 * enough that a read-only view plus an edit view is two screens where one will
 * do, and the operator who opened it usually came to change something.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { getCustomer, loadFormReference } from '@/features/customers/queries'
import { updateCustomer } from '@/features/customers/actions'
import { CustomerForm } from '@/features/customers/ui/customer-form'
import { RetireCustomerDialog } from '@/features/customers/ui/dialogs'
import { creditView } from '@/features/credit/queries'
import { CreditStandingCard } from '@/features/credit/ui/panels'
import { customerFormLabels } from '@/features/customers/ui/labels'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { trimDecimal } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Field, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const session = await requireSession()
  const { id } = await params
  const customer = await getCustomer(session.actor, id)
  return { title: customer ? `${customer.code} · ${customer.legalNameEn}` : 'Customer' }
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params

  const customer = await getCustomer(session.actor, id)
  if (!customer) notFound()

  const t = await getTranslations('customers')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const mayWrite = can(session, 'customer.write')

  const primaryTerms = customer.terms.find((term) => term.branchId === customer.primaryBranchId)

  const [reference, labels] = await Promise.all([
    loadFormReference(session.actor),
    customerFormLabels(),
  ])

  /*
    Credit is read for the primary branch, not for all of them.

    A limit is per branch (`customer_branch_terms`), so a customer trading in
    Kuwait and Doha has two, and summing them would invent a group limit nobody
    agreed. The card shows the branch this customer belongs to; the terms table
    above already lists what each branch allows.
  */
  const credit = customer.primaryBranchId
    ? await creditView(session.actor, id, customer.primaryBranchId)
    : null

  const displayName =
    locale === 'ar' && customer.legalNameAr ? customer.legalNameAr : customer.legalNameEn

  /*
    Full width, like every other screen in the product.

    This briefly carried a `max-w-5xl` measure, on the reasoning that a single
    column of card, table and form has nowhere to put 2500px. The reasoning was
    sound and the result was still wrong: it made this the one internal screen
    that stops short of the viewport, and an operator moving between the board
    and a customer saw the content change width under them. Consistency across
    the product beats an optimal line length on one page. What the measure was
    actually protecting against — a credit card at full bleed above a form
    capped at 56rem — is fixed by the two agreeing, which they now do.
  */
  return (
    <div className="w-full">
      <PageHeader
        eyebrow={<span className="ref text-brand">{customer.code}</span>}
        title={displayName}
        description={t('detailSubtitle')}
        actions={
          <>
            <Badge tone={customer.isActive ? 'positive' : 'muted'}>
              {customer.isActive ? tc('active') : tc('inactive')}
            </Badge>
            <RetireCustomerDialog customerId={id} name={displayName} isActive={customer.isActive} />
          </>
        }
      />

      {credit && customer.primaryBranchId ? (
        <CreditStandingCard
          view={credit}
          customerId={id}
          branchId={customer.primaryBranchId}
          className="mb-4"
        />
      ) : null}

      {customer.terms.length > 1 ? (
        <Card className="mb-4" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="finance"
              eyebrow={t('terms')}
              title={t('termsPerBranch')}
              description={t('termsPerBranchHint')}
            />
          </div>
          <TableShell minWidth="none" className="border-t border-line">
            <THead>
              <TR>
                <TH>{t('branch')}</TH>
                <TH align="end">{t('paymentTermsDays')}</TH>
                <TH align="end">{t('creditLimit')}</TH>
                <TH align="end">{t('freeTimeDays')}</TH>
                <TH>{t('defaultIncoterm')}</TH>
                <TH>{tc('status')}</TH>
              </TR>
            </THead>
            <TBody>
              {customer.terms.map((term) => (
                <TR key={term.branchId}>
                  <TD className="ref whitespace-nowrap">{term.branchCode}</TD>
                  <TD align="end" numeric>
                    {term.paymentTermsDays}
                  </TD>
                  <TD align="end" numeric>
                    {term.creditLimit
                      ? `${trimDecimal(term.creditLimit)} ${term.creditCurrency ?? ''}`.trim()
                      : '—'}
                  </TD>
                  <TD align="end" numeric>
                    {term.freeTimeDays ?? '—'}
                  </TD>
                  <TD className="ref">{term.defaultIncoterm ?? '—'}</TD>
                  <TD>
                    {term.isOnHold ? (
                      <Badge tone="critical" icon="hold">
                        {t('onHold')}
                      </Badge>
                    ) : (
                      <Badge tone="positive">{tc('active')}</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        </Card>
      ) : null}

      {mayWrite ? (
        <CustomerForm
          action={updateCustomer}
          branches={reference.branches}
          countries={reference.countries}
          labels={labels}
          defaults={{
            customerId: customer.id,
            code: customer.code,
            legalNameEn: customer.legalNameEn,
            legalNameAr: customer.legalNameAr,
            registration: customer.registration,
            taxRegistration: customer.taxRegistration,
            countryCode: customer.countryCode,
            primaryBranchId: customer.primaryBranchId,
            isActive: customer.isActive,
            paymentTermsDays: primaryTerms?.paymentTermsDays ?? 30,
            creditLimit: trimDecimal(primaryTerms?.creditLimit),
            creditCurrency: primaryTerms?.creditCurrency ?? null,
            freeTimeDays: primaryTerms?.freeTimeDays ?? null,
            defaultIncoterm: primaryTerms?.defaultIncoterm ?? null,
          }}
        />
      ) : (
        <Card>
          <CardHeader icon="customers" eyebrow={t('eyebrow')} title={t('identity')} />
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label={t('legalNameEn')}>{customer.legalNameEn}</Field>
            <Field label={t('legalNameAr')}>{customer.legalNameAr ?? '—'}</Field>
            <Field label={t('country')}>{customer.countryCode ?? '—'}</Field>
            <Field label={t('registration')} mono>
              {customer.registration ?? '—'}
            </Field>
            <Field label={t('taxRegistration')} mono>
              {customer.taxRegistration ?? '—'}
            </Field>
            <Field label={t('openJobs')}>{customer.openJobs}</Field>
          </dl>
        </Card>
      )}
    </div>
  )
}
