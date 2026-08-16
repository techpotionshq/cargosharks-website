/**
 * The agent and partner view — FR-AG.
 *
 * An agent contact sees a job only where their partner appears in
 * `job_partners`. That is one arm of one policy, not a separate application.
 */

import { requireSession } from '@/lib/session'

export default async function AgentHome() {
  const session = await requireSession()
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">{session.principal.nameEn}</h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">Assigned shipments and rate requests.</p>
    </main>
  )
}
