/**
 * Create a customer.
 *
 * The permission check here is what decides whether the page renders at all —
 * a coordinator without `customer.write` gets told, rather than being shown a
 * form whose submit will be rejected.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadFormReference } from '@/features/customers/queries'
import { createCustomer } from '@/features/customers/actions'
import { CustomerForm } from '@/features/customers/ui/customer-form'
import { customerFormLabels } from '@/features/customers/ui/labels'
import { EmptyState, PageHeader } from '@/ui/layout'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('customers')
  return { title: t('new') }
}

export default async function NewCustomerPage() {
  const session = await requireSession()
  const t = await getTranslations('customers')

  if (!can(session, 'customer.write')) {
    return (
      <div className="rounded-card border border-line bg-surface">
        <EmptyState icon="hold" title={t('forbidden')} description={t('forbiddenHint')} />
      </div>
    )
  }

  const locale = (await getLocale()) === 'ar' ? 'ar' : 'en'
  const [reference, labels] = await Promise.all([
    loadFormReference(session.actor, locale),
    customerFormLabels(),
  ])

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('new')} description={t('newSubtitle')} />
      {/* The same measure as the record it becomes — see `customers/[id]`. */}
      <div className="w-full">
        <CustomerForm
          action={createCustomer}
          branches={reference.branches}
          countries={reference.countries}
          labels={labels}
        />
      </div>
    </>
  )
}
