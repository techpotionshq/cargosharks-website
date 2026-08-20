/**
 * The agent and partner view — `FR-AG`.
 *
 * An agent contact sees a job only where their partner appears in
 * `job_partners`. That is one arm of one policy (§5.3), not a separate
 * application.
 *
 * The agent portal proper — RFQ dispatch, agents logging in and responding —
 * is out of the pilot (Pilot §3.2): it *"requires real agents to log in and
 * respond, cannot be faked convincingly, and is not needed for the three
 * moments"*. So this route stands, scoped correctly, and says what it is.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { Card } from '@/ui/card'
import { EmptyState, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'

export default async function AgentHome() {
  const session = await requireSession()
  const t = await getTranslations('agent')

  return (
    /* The shell owns the page frame now — `(agent)/layout.tsx`. */
    <>
      <PageHeader
        eyebrow={session.principal.nameEn}
        title={t('title')}
        description={t('subtitle')}
        actions={<Badge tone="muted">Release One</Badge>}
      />

      <Card>
        <EmptyState icon="partners" title={t('empty')} description={t('rateRequests')} />
      </Card>
    </>
  )
}
