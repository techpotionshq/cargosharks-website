/**
 * Loading a job's documents — the half between the database and the templates.
 *
 * The same split `documents.ts` established for the invoice, and the same
 * reason: the templates stay pure functions of a view so they can be rendered
 * in a test with no database, the renderer stays a pure function of HTML so it
 * never learns what a bill of lading is, and this is the only piece that knows
 * both.
 *
 * Everything runs under `withActor`, so a document is subject to exactly the
 * row-level security of the screen it was requested from. A job a principal
 * cannot see is a document they cannot render, decided by the database rather
 * than by a check here that somebody could forget.
 *
 * ## One view, six documents
 *
 * `loadJobDocumentView` is read once and handed to whichever template was
 * asked for. Four queries that each assemble their own idea of the shipment
 * can disagree — house eleven's weight totalled at a different instant from
 * house twelve's — and a bill of lading that disagrees with the packing list
 * attached to it is a discrepancy at the port.
 */

import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  SEED_CURRENCIES,
  customsValue as computeCustomsValue,
  estimateDuty,
  type CurrencySpec,
  type DutiableLine,
  type TariffLine,
} from '@qabandi/core'
import {
  branches,
  chargeLines,
  consolidations,
  customers,
  customsStages,
  dutyRates,
  equipment,
  jobCargo,
  jobParties,
  jobs,
  locations,
  partners,
  withActor,
  type Actor,
} from '@qabandi/db'
import { createRenderer } from './renderer'
import { DocumentNotFoundError } from './documents'
import {
  type CargoView,
  type DocumentLocale,
  type EquipmentView,
  type JobDocumentView,
  type PartyView,
} from './document-kit'
import { renderBillOfLadingHtml } from './bill-of-lading'
import { renderDeliveryOrderHtml } from './delivery-order'
import { renderPackingListHtml } from './packing-list'
import { renderCustomsPackHtml, type CustomsPackLineView, type CustomsPackView } from './customs-pack'
import { renderManifestHtml, type ConsolidationDocumentView } from './manifest'

/**
 * What can be produced for a job.
 *
 * The keys are stable and are written to `documents.generated_from`, so a
 * stored file can say which template made it and whether regenerating is
 * offered. Renaming one is a migration, not a refactor.
 */
export const JOB_DOCUMENT_KINDS = [
  'house_bill',
  'delivery_order',
  'packing_list',
  'customs_pack',
] as const

export type JobDocumentKind = (typeof JOB_DOCUMENT_KINDS)[number]

/** The document-type keys these map to in `document_types`. */
export const DOCUMENT_TYPE_KEYS: Record<JobDocumentKind, string> = {
  house_bill: 'hbl',
  delivery_order: 'do',
  packing_list: 'packing_list',
  customs_pack: 'customs_pack',
}

/**
 * Two minor units for anything unseeded — and never for KWD, which is seeded
 * with three. A currency the deployment added by hand and forgot to describe
 * gets the common case rather than an exception the operator cannot act on.
 */
const currencySpec = (code: string): CurrencySpec =>
  SEED_CURRENCIES.find((c) => c.code === code) ?? { code, minorUnits: 2 }

export async function loadJobDocumentView(
  actor: Actor,
  jobId: string,
): Promise<JobDocumentView> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        reference: jobs.reference,
        houseBillNumber: jobs.houseBillNumber,
        masterBillNumber: jobs.masterBillNumber,
        bookingNumber: jobs.bookingNumber,
        customerReference: jobs.customerReference,
        mode: jobs.mode,
        tradeDirection: jobs.tradeDirection,
        incoterm: jobs.incoterm,
        vesselName: jobs.vesselName,
        voyageNumber: jobs.voyageNumber,
        flightNumber: jobs.flightNumber,
        etd: jobs.etd,
        eta: jobs.eta,
        originId: jobs.originId,
        destinationId: jobs.destinationId,
        consolidationId: jobs.consolidationId,
        customerEn: customers.legalNameEn,
        customerAr: customers.legalNameAr,
        branchEn: branches.legalNameEn,
        branchAr: branches.legalNameAr,
        branchCountry: branches.country,
        branchCode: branches.code,
        taxRegistration: branches.taxRegistration,
      })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      .where(eq(jobs.id, jobId))
      .limit(1)

    /*
      Not found rather than forbidden — FR-ID-04, as on the invoice route. RLS
      makes a job outside the principal's scope invisible rather than refused,
      so this is genuinely "no such row" from where the query stands.
    */
    if (!row) throw new DocumentNotFoundError(jobId)

    const [parties, cargo, containers, places] = await Promise.all([
      tx
        .select()
        .from(jobParties)
        .where(eq(jobParties.jobId, jobId))
        .orderBy(asc(jobParties.role), asc(jobParties.sortOrder)),
      tx.select().from(jobCargo).where(eq(jobCargo.jobId, jobId)).orderBy(asc(jobCargo.lineNo)),
      tx.select().from(equipment).where(eq(equipment.jobId, jobId)),
      tx
        .select({
          id: locations.id,
          nameEn: locations.nameEn,
          nameAr: locations.nameAr,
          unlocode: locations.unlocode,
        })
        .from(locations)
        .where(
          inArray(
            locations.id,
            [row.originId, row.destinationId].filter((id): id is string => id !== null),
          ),
        ),
    ])

    const place = (id: string | null) => {
      if (!id) return null
      const found = places.find((p) => p.id === id)
      return found
        ? { nameEn: found.nameEn, nameAr: found.nameAr, unlocode: found.unlocode }
        : null
    }

    const equipmentById = new Map(containers.map((c) => [c.id, c]))

    /*
      Freight term from the charge lines, not from a column.

      Whether the freight is prepaid or collect is the same fact as whether we
      raised a revenue line for it on this job — an import handled for an
      overseas agent carries the cost and no freight revenue, which is exactly
      what "collect" means. Storing it as a flag would be a second copy of that
      truth, free to drift the moment somebody adds the line.
    */
    const freightRevenue = await tx
      .select({ id: chargeLines.id })
      .from(chargeLines)
      .where(and(eq(chargeLines.jobId, jobId), eq(chargeLines.direction, 'revenue')))
      .limit(1)

    return {
      reference: row.reference,
      houseBillNumber: row.houseBillNumber,
      masterBillNumber: row.masterBillNumber,
      bookingNumber: row.bookingNumber,
      customerReference: row.customerReference,
      mode: row.mode,
      tradeDirection: row.tradeDirection,
      incoterm: row.incoterm,
      vesselName: row.vesselName,
      voyageNumber: row.voyageNumber,
      flightNumber: row.flightNumber,
      etd: row.etd,
      eta: row.eta,
      origin: place(row.originId),
      destination: place(row.destinationId),
      branch: {
        legalNameEn: row.branchEn,
        legalNameAr: row.branchAr,
        taxRegistration: row.taxRegistration,
        country: row.branchCountry,
      },
      customer: { nameEn: row.customerEn, nameAr: row.customerAr },
      parties: parties.map(
        (p): PartyView => ({
          role: p.role,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          address: p.address,
          city: p.city,
          country: p.country,
          contactName: p.contactName,
          phone: p.phone,
          email: p.email,
          taxId: p.taxId,
        }),
      ),
      cargo: cargo.map(
        (c): CargoView => ({
          lineNo: c.lineNo,
          marksAndNumbers: c.marksAndNumbers,
          packageCount: c.packageCount,
          packageType: c.packageType,
          descriptionEn: c.descriptionEn,
          descriptionAr: c.descriptionAr,
          hsCode: c.hsCode,
          grossWeightKg: c.grossWeightKg,
          netWeightKg: c.netWeightKg,
          volumeCbm: c.volumeCbm,
          containerNo: c.equipmentId
            ? (equipmentById.get(c.equipmentId)?.containerNo ?? null)
            : null,
        }),
      ),
      equipment: containers.map(
        (e): EquipmentView => ({
          containerNo: e.containerNo,
          containerType: e.containerType,
          sealNo: e.sealNo,
          grossWeightKg: e.grossWeightKg,
        }),
      ),
      issuedAt: new Date(),
      placeOfIssue: row.branchCode,
      freightTerm: freightRevenue.length > 0 ? 'prepaid' : 'collect',
    }
  })
}

/**
 * The customs pack, with the estimate computed at render time.
 *
 * Computed rather than read back from `customs_stages`, because the pack is a
 * working document produced now from the cargo as it now stands. What is
 * *stored* on the stage is the estimate that was quoted, which is a different
 * fact with a different purpose — the two are kept apart on purpose (0013).
 */
export async function loadCustomsPackView(
  actor: Actor,
  jobId: string,
  options: { readonly goodsValue?: string; readonly currency?: string } = {},
): Promise<CustomsPackView> {
  const job = await loadJobDocumentView(actor, jobId)

  return withActor(actor, async (tx) => {
    const [stage] = await tx
      .select({
        declarationType: customsStages.declarationType,
        declarationNo: customsStages.declarationNo,
        customsValue: customsStages.customsValue,
        customsValueCurrency: customsStages.customsValueCurrency,
        brokerPartnerId: customsStages.brokerPartnerId,
      })
      .from(customsStages)
      .where(eq(customsStages.jobId, jobId))
      .limit(1)

    const broker = stage?.brokerPartnerId
      ? await tx
          .select({ nameEn: partners.legalNameEn })
          .from(partners)
          .where(eq(partners.id, stage.brokerPartnerId))
          .limit(1)
      : []

    const currency = options.currency ?? stage?.customsValueCurrency ?? 'KWD'
    const spec = currencySpec(currency)

    const tariff = (await tx
      .select()
      .from(dutyRates)
      .where(eq(dutyRates.country, job.branch.country))) as unknown as TariffLine[]

    const goods = options.goodsValue ?? stage?.customsValue ?? null

    /*
      The declared value is apportioned across the cargo lines by weight where
      only a shipment total is known.

      Not because that is accurate — it is not — but because a per-line duty
      column with one value on the first row and blanks below is a document the
      broker cannot use, and because the *total* is right either way. Where the
      lines carry their own values this is skipped entirely.
    */
    const totalGross = job.cargo.reduce((acc, c) => acc + Number(c.grossWeightKg ?? 0), 0)
    const dutiable: DutiableLine[] = job.cargo.map((line) => ({
      hsCode: line.hsCode,
      description: line.descriptionEn,
      value:
        goods === null
          ? '0'
          : totalGross > 0
            ? ((Number(goods) * Number(line.grossWeightKg ?? 0)) / totalGross).toFixed(6)
            : (Number(goods) / Math.max(1, job.cargo.length)).toFixed(6),
    }))

    const estimate = estimateDuty(dutiable, tariff, {
      country: job.branch.country,
      currency,
      on: new Date(),
      spec,
    })

    const byDescription = new Map(estimate.lines.map((l) => [l.description, l]))

    const lines: CustomsPackLineView[] = job.cargo.map((c) => {
      const estimated = byDescription.get(c.descriptionEn)
      return {
        lineNo: c.lineNo,
        description: c.descriptionEn,
        hsCode: c.hsCode,
        matchedPrefix: estimated?.matchedPrefix ?? null,
        ratePercent: estimated?.ratePercent ?? null,
        packageCount: c.packageCount,
        grossWeightKg: c.grossWeightKg,
        netWeightKg: c.netWeightKg,
        value: estimated?.value.amount.toString() ?? null,
        duty: estimated?.duty.amount.toString() ?? null,
        countryOfOrigin: null,
      }
    })

    const value =
      goods === null
        ? null
        : computeCustomsValue({ goods }, currency, spec).amount.toString()

    return {
      job,
      declarationType: stage?.declarationType ?? null,
      declarationNo: stage?.declarationNo ?? null,
      brokerName: broker[0]?.nameEn ?? null,
      currency,
      goodsValue: goods,
      freightValue: null,
      insuranceValue: null,
      customsValue: value,
      estimatedDuty: estimate.duty.amount.toString(),
      estimatedAt: new Date(),
      lines,
      unmatched: estimate.unmatched
        .map((u) => u.hsCode ?? '(no code)')
        .filter((v, i, all) => all.indexOf(v) === i),
    }
  })
}

export async function loadConsolidationDocumentView(
  actor: Actor,
  consolidationId: string,
): Promise<ConsolidationDocumentView> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        reference: consolidations.reference,
        masterBillNumber: consolidations.masterBillNumber,
        bookingNumber: consolidations.bookingNumber,
        mode: consolidations.mode,
        vesselName: consolidations.vesselName,
        voyageNumber: consolidations.voyageNumber,
        flightNumber: consolidations.flightNumber,
        originId: consolidations.originId,
        destinationId: consolidations.destinationId,
        etd: consolidations.etd,
        eta: consolidations.eta,
        carrierPartnerId: consolidations.carrierPartnerId,
        coloadPartnerId: consolidations.coloadPartnerId,
        branchEn: branches.legalNameEn,
        branchAr: branches.legalNameAr,
        branchCode: branches.code,
        taxRegistration: branches.taxRegistration,
      })
      .from(consolidations)
      .innerJoin(branches, eq(branches.id, consolidations.branchId))
      .where(eq(consolidations.id, consolidationId))
      .limit(1)

    if (!row) throw new DocumentNotFoundError(consolidationId)

    const houseRows = await tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        houseBillNumber: jobs.houseBillNumber,
        customerEn: customers.legalNameEn,
      })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(eq(jobs.consolidationId, consolidationId))
      .orderBy(asc(jobs.reference))

    const jobIds = houseRows.map((h) => h.id)

    const [allParties, allCargo, allEquipment, places, partnerRows] = await Promise.all([
      jobIds.length > 0
        ? tx.select().from(jobParties).where(inArray(jobParties.jobId, jobIds))
        : [],
      jobIds.length > 0 ? tx.select().from(jobCargo).where(inArray(jobCargo.jobId, jobIds)) : [],
      jobIds.length > 0 ? tx.select().from(equipment).where(inArray(equipment.jobId, jobIds)) : [],
      tx
        .select({
          id: locations.id,
          nameEn: locations.nameEn,
          nameAr: locations.nameAr,
          unlocode: locations.unlocode,
        })
        .from(locations)
        .where(
          inArray(
            locations.id,
            [row.originId, row.destinationId].filter((id): id is string => id !== null),
          ),
        ),
      tx
        .select({ id: partners.id, nameEn: partners.legalNameEn })
        .from(partners)
        .where(
          inArray(
            partners.id,
            [row.carrierPartnerId, row.coloadPartnerId].filter((id): id is string => id !== null),
          ),
        ),
    ])

    const place = (id: string | null) => {
      if (!id) return null
      const found = places.find((p) => p.id === id)
      return found ? { nameEn: found.nameEn, nameAr: found.nameAr, unlocode: found.unlocode } : null
    }
    const partnerName = (id: string | null) =>
      id ? (partnerRows.find((p) => p.id === id)?.nameEn ?? null) : null

    const equipmentById = new Map(allEquipment.map((e) => [e.id, e]))

    const houses = houseRows.map((house) => {
      const parties = allParties.filter((p) => p.jobId === house.id)
      const cargo = allCargo.filter((c) => c.jobId === house.id)
      const first = cargo[0]

      /*
        One line per house, summed — a manifest is a list of bills, not of
        cargo lines. The description is the first line's, which is the
        convention: a bill covering eleven descriptions manifests under the
        first with the rest on the bill itself.
      */
      return {
        houseBillNumber: house.houseBillNumber,
        jobReference: house.reference,
        shipperName: parties.find((p) => p.role === 'shipper')?.nameEn ?? house.customerEn,
        consigneeName: parties.find((p) => p.role === 'consignee')?.nameEn ?? '—',
        notifyName: parties.find((p) => p.role === 'notify')?.nameEn ?? null,
        descriptionEn: first?.descriptionEn ?? '—',
        descriptionAr: first?.descriptionAr ?? null,
        marksAndNumbers: first?.marksAndNumbers ?? null,
        packageCount: cargo.reduce((acc, c) => acc + (c.packageCount ?? 0), 0) || null,
        packageType: first?.packageType ?? null,
        grossWeightKg: cargo
          .reduce((acc, c) => acc + Number(c.grossWeightKg ?? 0), 0)
          .toFixed(3),
        volumeCbm: cargo.reduce((acc, c) => acc + Number(c.volumeCbm ?? 0), 0).toFixed(3),
        containerNo: first?.equipmentId
          ? (equipmentById.get(first.equipmentId)?.containerNo ?? null)
          : null,
        origin: null,
        destination: null,
        freightTerm: 'prepaid' as const,
      }
    })

    return {
      reference: row.reference,
      masterBillNumber: row.masterBillNumber,
      bookingNumber: row.bookingNumber,
      mode: row.mode,
      carrierName: partnerName(row.carrierPartnerId),
      coloadPartnerName: partnerName(row.coloadPartnerId),
      vesselName: row.vesselName,
      voyageNumber: row.voyageNumber,
      flightNumber: row.flightNumber,
      origin: place(row.originId),
      destination: place(row.destinationId),
      etd: row.etd,
      eta: row.eta,
      branch: {
        legalNameEn: row.branchEn,
        legalNameAr: row.branchAr,
        taxRegistration: row.taxRegistration,
      },
      houses,
      issuedAt: new Date(),
      placeOfIssue: row.branchCode,
    }
  })
}

/** Rendered bytes and the filename the operator will file it under. */
export async function renderJobDocumentPdf(
  actor: Actor,
  jobId: string,
  kind: JobDocumentKind,
  locale: DocumentLocale,
): Promise<{ pdf: Buffer; filename: string; html: string }> {
  /*
    The view is loaded once and used for both the document and its filename.

    Loading it a second time to name the file would open a second transaction
    against a shipment that may have changed between them, and produce a bill
    of lading filed under a number it does not carry.
  */
  const pack = kind === 'customs_pack' ? await loadCustomsPackView(actor, jobId) : null
  const view = pack ? pack.job : await loadJobDocumentView(actor, jobId)

  const html = pack
    ? renderCustomsPackHtml(pack, locale)
    : renderJobHtml(view, kind as Exclude<JobDocumentKind, 'customs_pack'>, locale)

  const pdf = await createRenderer().render({ html, locale })

  const identifier =
    kind === 'house_bill' ? (view.houseBillNumber ?? view.reference) : view.reference
  const stem = `${identifier.replace(/[^A-Za-z0-9._-]/g, '-')}-${kind}`

  return { pdf, filename: `${stem}-${locale}.pdf`, html }
}

function renderJobHtml(
  view: JobDocumentView,
  kind: Exclude<JobDocumentKind, 'customs_pack'>,
  locale: DocumentLocale,
): string {
  switch (kind) {
    case 'house_bill':
      return renderBillOfLadingHtml(view, locale)
    case 'delivery_order':
      return renderDeliveryOrderHtml(view, locale)
    case 'packing_list':
      return renderPackingListHtml(view, locale)
  }
}

export async function renderManifestPdf(
  actor: Actor,
  consolidationId: string,
  locale: DocumentLocale,
): Promise<{ pdf: Buffer; filename: string; html: string }> {
  const view = await loadConsolidationDocumentView(actor, consolidationId)
  const html = renderManifestHtml(view, locale)
  const pdf = await createRenderer().render({ html, locale })
  const stem = (view.masterBillNumber ?? view.reference).replace(/[^A-Za-z0-9._-]/g, '-')

  return { pdf, filename: `${stem}-manifest-${locale}.pdf`, html }
}
