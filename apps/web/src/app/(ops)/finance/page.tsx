/**
 * Finance — deliberately out of scope for the pilot.
 *
 * Pilot §3.2 excludes invoicing, credit notes and receivables: the whole
 * finance module needs three jurisdictions and their accounting package, and
 * it is demoed as a roadmap slide rather than as software.
 *
 * Naming that in the room is a credibility move, not a weakness — *"it proves
 * we know the difference between a pilot and a product"* — so the exclusion is
 * stated on the screen an operations manager will inevitably click, rather
 * than being a dead link or, worse, a half-built ledger.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { Card } from '@/ui/card'
import { Button, PageHeader } from '@/ui/layout'
import { Icon, type IconName } from '@/ui/icon'
import { Badge } from '@/ui/status'

/** What the module contains when it is built — Release One, `FR-FN`. */
const ROADMAP: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'finance',
    title: 'Invoicing and credit notes',
    body: 'Per-entity numbering series, tax treatment across three jurisdictions, and a credit note that cannot silently rewrite an issued invoice.',
  },
  {
    icon: 'rates',
    title: 'Job profitability',
    body: 'Charge lines accrue against the job as it runs — including the demurrage line the clock writes by itself — so margin at close is a read, not a reconstruction.',
  },
  {
    icon: 'partners',
    title: 'Receivables and statements',
    body: 'Ageing, allocations and a customer statement in the portal, in the customer’s own currency.',
  },
  {
    icon: 'external',
    title: 'Accounting export',
    body: 'A reconciled export to their existing package rather than a second set of books.',
  },
]

export default async function FinancePage() {
  await requireSession()
  const t = await getTranslations('finance')

  return (
    <>
      <PageHeader
        eyebrow={t('title')}
        title={t('notInPilot')}
        description={t('notInPilotBody')}
        actions={
          <Button href="/dashboard" icon="dashboard">
            {t('roadmap')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ROADMAP.map((item) => (
          <Card key={item.title}>
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-subtle">
                <Icon name={item.icon} size={18} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[0.9375rem] font-semibold text-ink">{item.title}</h2>
                  <Badge tone="muted">Release One</Badge>
                </div>
                <p className="mt-1.5 text-[0.875rem] text-ink-muted">{item.body}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
