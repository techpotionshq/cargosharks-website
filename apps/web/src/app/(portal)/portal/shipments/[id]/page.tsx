/**
 * One of the customer's own shipments, signed in — QA P2-12.
 *
 * The portal's cards linked to public `/track`, carrying the customer
 * reference as the second identifier. A job with no customer reference had no
 * link at all, and every click spent the per-address budget public tracking
 * keeps against enumeration, so a customer working through their own list was
 * throttled out of it. Here the session is the proof: the job is read by id
 * under the contact's own actor, and the `customer_contact` arm of the jobs
 * policy is what keeps it to their company (`trackOwnShipment`). The layout
 * already admits only customer contacts.
 *
 * Documents link to the download route, which the public page cannot do — it
 * has no session for that route to authorise.
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
  const t = await getTranslations('portal')
  return { title: t('title') }
}

export default async function PortalShipmentPage({ params }: { params: Promise<{ id: string }> }) {
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

  const t = await getTranslations('portal')

  return (
    <>
      <Link
        href="/portal"
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
