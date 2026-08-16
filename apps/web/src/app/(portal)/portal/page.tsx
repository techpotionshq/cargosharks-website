/**
 * The customer portal — FR-CP.
 *
 * The same tables, the same queries, a different principal. A customer contact
 * sees their own jobs because the `customer_contact` arm of the RLS policy
 * matches their `app.customer_id`, not because this route filters anything.
 */

import { requireSession } from '@/lib/session'

export default async function PortalHome() {
  const session = await requireSession()
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">{session.principal.nameEn}</h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">Shipments, documents and invoices.</p>
    </main>
  )
}
