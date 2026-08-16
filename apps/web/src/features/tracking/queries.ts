/**
 * Public tracking — `FR-CP-05`, Moment 1.
 *
 * The most exposed query in the product: no session, no principal, and a URL
 * the client will hand to their customers. Three controls make that safe, and
 * all three are in this file so they can be reviewed in one place.
 *
 *   1. **Two identifiers.** A reference alone is guessable — `KWI-2026-01041`
 *      implies `…01042`. The caller must also supply a bill of lading,
 *      booking, customer reference or container number that belongs to the
 *      same job. A wrong verifier is indistinguishable from a wrong reference,
 *      so the page is not an enumeration oracle.
 *   2. **A projection, not a row.** Only the columns below ever leave this
 *      function. Buy rates, margins, internal notes and unreleased documents
 *      are not filtered out downstream — they are never selected.
 *   3. **Released and customer-visible only.** A draft bill of lading sitting
 *      on the job is not a customer document, and an internal exception is not
 *      a customer notice.
 *
 * Rate limiting sits in front of this in the service (§8), because a control
 * that lives only in the page is a control that a second caller forgets.
 */

import 'server-only'
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  assets,
  customers,
  documentTypes,
  documents,
  equipment,
  exceptionCodes,
  exceptions,
  jobMilestones,
  jobs,
  locations,
  withoutActor,
} from '@qabandi/db'
import type { Mode, TrackingResult } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotTracking } from '@/lib/pilot/fixtures'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

/** Trim, upper-case and drop spaces: customers type container numbers loosely. */
function normalise(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

export async function trackShipment(
  reference: string,
  verifier: string,
): Promise<TrackingResult | undefined> {
  const ref = normalise(reference)
  const key = normalise(verifier)
  if (ref.length < 4 || key.length < 4) return undefined

  if (usePilotFixtures()) return pilotTracking(ref, key)

  /**
   * Deliberately un-actored: there is no principal on this page. It is one of
   * only two sanctioned uses of `withoutActor` in the web application — the
   * other is session establishment itself — and it is safe because the
   * verifier is required and the projection carries nothing internal.
   */
  return withoutActor(async (tx) => {
    const [row] = await tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        status: jobs.status,
        mode: jobs.mode,
        etd: jobs.etd,
        eta: jobs.eta,
        ata: jobs.ata,
        vesselName: jobs.vesselName,
        voyageNumber: jobs.voyageNumber,
        flightNumber: jobs.flightNumber,
        customerName: customers.legalNameEn,
        originName: origin.nameEn,
        originNameAr: origin.nameAr,
        destinationName: destination.nameEn,
        destinationNameAr: destination.nameAr,
      })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(origin, eq(origin.id, jobs.originId))
      .leftJoin(destination, eq(destination.id, jobs.destinationId))
      .where(
        and(
          eq(sql`upper(${jobs.reference})`, ref),
          or(
            eq(sql`upper(replace(${jobs.masterBillNumber}, ' ', ''))`, key),
            eq(sql`upper(replace(${jobs.houseBillNumber}, ' ', ''))`, key),
            eq(sql`upper(replace(${jobs.bookingNumber}, ' ', ''))`, key),
            eq(sql`upper(replace(${jobs.customerReference}, ' ', ''))`, key),
            // Or any container on the job — what a consignee actually has.
            sql`exists (
              select 1 from ${equipment}
               where ${equipment.jobId} = ${jobs.id}
                 and upper(replace(${equipment.containerNo}, ' ', '')) = ${key}
            )`,
          ),
        ),
      )
      .limit(1)

    if (!row) return undefined

    const [milestoneRows, containerRows, documentRows, noticeRows] = await Promise.all([
      tx
        .select({
          code: jobMilestones.code,
          nameEn: jobMilestones.nameEn,
          nameAr: jobMilestones.nameAr,
          plannedAt: jobMilestones.plannedAt,
          revisedAt: jobMilestones.revisedAt,
          actualAt: jobMilestones.actualAt,
        })
        .from(jobMilestones)
        // The flag is honoured here, not in the component (FR-DC-03).
        .where(and(eq(jobMilestones.jobId, row.id), eq(jobMilestones.customerVisible, true)))
        .orderBy(asc(jobMilestones.seq)),
      tx
        .select({
          containerNo: equipment.containerNo,
          type: equipment.containerType,
          dischargedAt: equipment.dischargedAt,
          gateOutAt: equipment.gateOutAt,
          emptyReturnedAt: equipment.emptyReturnedAt,
        })
        .from(equipment)
        .where(eq(equipment.jobId, row.id)),
      tx
        .select({
          id: documents.id,
          version: documents.version,
          releasedAt: documents.releasedAt,
          code: documentTypes.code,
          nameEn: documentTypes.nameEn,
          nameAr: documentTypes.nameAr,
          byteSize: assets.byteSize,
        })
        .from(documents)
        .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
        .innerJoin(assets, eq(assets.id, documents.assetId))
        .where(
          and(
            eq(documents.jobId, row.id),
            // Released, current, and of a type marked customer-visible.
            sql`${documents.releasedAt} is not null`,
            isNull(documents.supersededById),
            eq(documentTypes.isCustomerVisible, true),
          ),
        ),
      tx
        .select({
          code: exceptionCodes.code,
          nameEn: exceptionCodes.nameEn,
          nameAr: exceptionCodes.nameAr,
        })
        .from(exceptions)
        .innerJoin(exceptionCodes, eq(exceptionCodes.id, exceptions.exceptionCodeId))
        .where(
          and(
            eq(exceptions.jobId, row.id),
            isNull(exceptions.closedAt),
            eq(exceptions.customerVisible, true),
          ),
        ),
    ])

    return {
      reference: row.reference,
      status: row.status,
      mode: row.mode as Mode,
      customerName: row.customerName ?? '',
      originName: row.originName ?? '—',
      originNameAr: row.originNameAr ?? row.originName ?? '—',
      destinationName: row.destinationName ?? '—',
      destinationNameAr: row.destinationNameAr ?? row.destinationName ?? '—',
      vesselOrFlight:
        row.flightNumber ??
        (row.vesselName
          ? `${row.vesselName}${row.voyageNumber ? ` ${row.voyageNumber}` : ''}`
          : null),
      etd: row.etd,
      eta: row.eta,
      ata: row.ata,
      containers: containerRows.map((c) => ({
        containerNo: c.containerNo ?? '—',
        type: c.type ?? '—',
        sealNo: null,
        dischargedAt: c.dischargedAt,
        gateOutAt: c.gateOutAt,
        emptyReturnedAt: c.emptyReturnedAt,
      })),
      milestones: milestoneRows.map((m) => ({
        code: m.code,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        plannedAt: m.plannedAt,
        revisedAt: m.revisedAt,
        actualAt: m.actualAt,
      })),
      documents: documentRows.map((d) => ({
        id: d.id,
        code: d.code,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        version: d.version,
        releasedAt: d.releasedAt,
        sizeKb: Math.round(d.byteSize / 1024),
      })),
      notices: noticeRows,
    }
  })
}
