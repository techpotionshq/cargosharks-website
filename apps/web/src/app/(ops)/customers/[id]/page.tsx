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
import { recordId } from '@/lib/ids'
import { can, canIn } from '@/lib/permissions'
import { getCustomer, loadFormReference } from '@/features/customers/queries'
import { updateCustomer } from '@/features/customers/actions'
import { CustomerForm } from '@/features/customers/ui/customer-form'
import { RetireCustomerDialog } from '@/features/customers/ui/dialogs'
import { CustomerContactsCard } from '@/features/customers/ui/contacts-card'
import { creditView } from '@/features/credit/queries'
import { CreditStandingCard } from '@/features/credit/ui/panels'
import { customerFormLabels } from '@/features/customers/ui/labels'
import { PortalContactsCard } from '@/features/admin/ui/portal-contacts'
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
  const id = recordId((await params).id)
  const customer = await getCustomer(session.actor, id)
  if (!customer) return { title: (await getTranslations('nav'))('customers') }
  // The tab says what the heading says (F27).
  const resolved = await getLocale()
  const name =
    resolved === 'ar' && customer.legalNameAr ? customer.legalNameAr : customer.legalNameEn
  return { title: `${customer.code} · ${name}` }
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ terms?: string }>
}) {
  const session = await requireSession()
  const id = recordId((await params).id)
  const { terms: requestedTermsBranch } = await searchParams

  const customer = await getCustomer(session.actor, id)
  if (!customer) notFound()

  const t = await getTranslations('customers')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const mayWrite = can(session, 'customer.write')

  const [reference, labels] = await Promise.all([
    loadFormReference(session.actor, locale),
    customerFormLabels(),
  ])

  /*
    Whose terms the form edits (D2). Terms are per branch, so the choice is any
    branch this person may act in, not only the customer's own: a Kuwait desk
    pricing for a Dubai customer needs Kuwait's house margin. The customer's
    own branch first when that is one of them, else the first that is.
  */
  const termsBranches = reference.branches.filter((branch) =>
    canIn(session, 'customer.write', branch.id),
  )
  const termsBranch =
    termsBranches.find((branch) => branch.id === requestedTermsBranch) ??
    termsBranches.find((branch) => branch.id === customer.primaryBranchId) ??
    termsBranches[0]
  const shownTerms = customer.terms.find(
    (term) => term.branchId === (termsBranch?.id ?? customer.primaryBranchId),
  )
  const ownBranch = reference.branches.find((branch) => branch.id === customer.primaryBranchId)
  const identityNote =
    ownBranch && !canIn(session, 'customer.write', ownBranch.id)
      ? t('identityLocked', { branch: ownBranch.code })
      : undefined

  /*
    Credit is read for the primary branch, not for all of them.

    A limit is per branch (`customer_branch_terms`), so a customer trading in
    Kuwait and Doha has two, and summing them would invent a group limit nobody
    agreed. The card shows the branch this customer belongs to; the terms table
    above already lists what each branch allows.
  */
  const credit = customer.primaryBranchId
    ? await creditView(session.actor, id, customer.primaryBranchId, locale)
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
        eyebrow={<span className="ref">{customer.code}</span>}
        title={displayName}
        description={t('detailSubtitle')}
        status={
          <Badge tone={customer.isActive ? 'positive' : 'muted'}>
            {customer.isActive ? tc('active') : tc('inactive')}
          </Badge>
        }
        actions={
          <RetireCustomerDialog customerId={id} name={displayName} isActive={customer.isActive} />
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
          <TableShell className="border-t border-line">
            <THead>
              <TR>
                <TH>{t('branch')}</TH>
                {/* Branch, credit limit and hold status on a phone — the
                    three a credit question needs; the rest wait. */}
                <TH priority="low" align="end">
                  {t('paymentTermsDays')}
                </TH>
                <TH align="end">{t('creditLimit')}</TH>
                <TH priority="low" align="end">
                  {t('freeTimeDays')}
                </TH>
                <TH priority="low">{t('defaultIncoterm')}</TH>
                <TH priority="low">{t('marginKind')}</TH>
                <TH>{tc('status')}</TH>
              </TR>
            </THead>
            <TBody>
              {customer.terms.map((term) => (
                <TR key={term.branchId}>
                  <TD className="ref whitespace-nowrap">{term.branchCode}</TD>
                  <TD priority="low" align="end" numeric>
                    {term.paymentTermsDays}
                  </TD>
                  <TD align="end" numeric>
                    {term.creditLimit
                      ? `${trimDecimal(term.creditLimit)} ${term.creditCurrency ?? ''}`.trim()
                      : '—'}
                  </TD>
                  <TD priority="low" align="end" numeric>
                    {term.freeTimeDays ?? '—'}
                  </TD>
                  <TD priority="low" className="ref">
                    {term.defaultIncoterm ?? '—'}
                  </TD>
                  <TD priority="low">
                    {term.defaultMarginKind && term.defaultMarginValue
                      ? `${t(`marginKinds.${term.defaultMarginKind}` as 'marginKinds.percent')} · ${trimDecimal(term.defaultMarginValue)}`
                      : '—'}
                  </TD>
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

      {/* Who speaks for the customer, and the phone number WhatsApp matching
          keys on (D3). */}
      <CustomerContactsCard
        customerId={id}
        primaryBranchId={customer.primaryBranchId}
        className="mb-4"
      />

      {/* Who at this customer can sign in to the portal (A7). Renders only
          for somebody who may grant a login. */}
      <PortalContactsCard customerId={id} className="mb-4" />

      {mayWrite ? (
        <CustomerForm
          // Remounted per branch, so the uncontrolled inputs take that branch's terms.
          key={termsBranch?.id ?? 'primary'}
          action={updateCustomer}
          branches={reference.branches}
          countries={reference.countries}
          labels={labels}
          termsBranches={termsBranch ? termsBranches : undefined}
          termsBranchId={termsBranch?.id}
          identityNote={identityNote}
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
            paymentTermsDays: shownTerms?.paymentTermsDays ?? 30,
            creditLimit: trimDecimal(shownTerms?.creditLimit),
            creditCurrency: shownTerms?.creditCurrency ?? null,
            freeTimeDays: shownTerms?.freeTimeDays ?? null,
            defaultIncoterm: shownTerms?.defaultIncoterm ?? null,
            defaultMarginKind: shownTerms?.defaultMarginKind ?? null,
            defaultMarginValue: trimDecimal(shownTerms?.defaultMarginValue),
          }}
        />
      ) : (
        <Card>
          <CardHeader icon="customers" eyebrow={t('eyebrow')} title={t('identity')} />
          <dl className="mt-5 grid grid-cols-2 gap-4 @xl:grid-cols-3">
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
