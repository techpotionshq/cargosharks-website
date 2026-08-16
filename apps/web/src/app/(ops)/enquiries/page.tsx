/**
 * The enquiry board — FR-EQ-01.
 *
 * Reads through the slice's `queries.ts` under the caller's own actor, so the
 * page carries no branch filter of its own. RSC streaming plus keyset
 * pagination is what meets the two-second list budget (§12) without a cache.
 */

import { getLocale } from 'next-intl/server'
import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listEnquiries } from '@/features/enquiries/queries'
import { EnquiryTable, type EnquiryRow } from '@/features/enquiries/ui/enquiry-table'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'

export default async function EnquiriesPage() {
  const session = await requireSession()
  const t = await getTranslations('enquiry')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const rows = await listEnquiries(session.actor, { limit: 50 })

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">{t('title')}</h1>
      <EnquiryTable rows={rows as EnquiryRow[]} locale={locale} />
    </section>
  )
}
