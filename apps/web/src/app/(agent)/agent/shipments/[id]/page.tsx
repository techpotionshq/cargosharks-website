/**
 * One of an agent's assigned shipments, read-only.
 *
 * The agent home listed cards that opened nothing, so an agent who wanted the
 * containers or the released bill of lading on a job had to email for them.
 * This is the customer portal's shipment page with the agent's session behind
 * it, not a new read: `trackOwnShipment` runs under the caller's own actor, and
 * the `agent_contact` arm of the jobs policy keeps it to the jobs their partner
 * is named on — the same arm the list on `/agent` is drawn from. A job outside
 * it is not found rather than forbidden, so an id in the URL is no oracle.
 *
 * The layout already admits only agent contacts. Documents link to the
 * download route, which authorises under the same actor and the same three
 * release conditions the portal relies on.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { recordId } from '@/lib/ids'
import { trackOwnShipment } from '@/features/tracking/queries'
import { ShipmentView } from '@/features/tracking/ui/shipment-view'
import { getJobVessel } from '@/features/vessels/queries'
import { VesselPositionCard } from '@/features/vessels/ui/vessel-position-card'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Icon } from '@/ui/icon'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agent')
  return { title: t('title') }
}

export default async function AgentShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const timeZone = await getTimeZone()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const id = recordId((await params).id)

  const result = await trackOwnShipment(session.actor, id)
  if (!result) notFound()
  // Under the same actor: `vessel_positions_read` shows the ship only when
  // this contact can see a job sailing on it, which the line above has proved.
  const vessel = await getJobVessel(session.actor, id)

  const t = await getTranslations('agent')

  return (
    <>
      <Link
        href="/agent"
        className="mb-4 inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
      >
        {/* The end chevron mirrors in Arabic; turned, it points back either way. */}
        <Icon name="chevron-end" size={14} className="rotate-180" />
        {t('backToShipments')}
      </Link>
      <ShipmentView
        result={result}
        locale={locale}
        timeZone={timeZone}
        documentHref={(documentId) => `/api/documents/${documentId}`}
        vesselCard={
          vessel ? (
            <VesselPositionCard vessel={vessel} locale={locale} timeZone={timeZone} />
          ) : undefined
        }
      />
    </>
  )
}
