'use server'

/**
 * Bulk import — `FR-MD-11`, `FR-RT-09`.
 *
 * Two intents through one action, because they must not disagree:
 *
 *   `check`   parse, validate, report. Writes nothing.
 *   `commit`  parse, validate **again**, and write only if the second pass is
 *             as clean as the first.
 *
 * The second validation is not redundant. The report the browser holds is a
 * claim by the client, and the reference data it was checked against may have
 * moved since — a currency deactivated, a customer code taken by someone else
 * in the thirty seconds the operator spent reading the preview. Trusting the
 * first pass would make "imports nothing" conditional on the client being
 * honest and the world being still.
 *
 * Everything is written inside one `withActor` transaction, so the acceptance
 * criterion holds at the only level that matters: a file with errors imports
 * nothing because the transaction never commits, not because the loop stopped
 * early.
 */

import { revalidatePath } from 'next/cache'
import {
  groupRateCards,
  readImport,
  type ImportReport,
  type Mapping,
  type RateRowValues,
} from '@qabandi/core/import'
import {
  customerBranchTerms,
  customerContacts,
  customers,
  invoices,
  jobs,
  locations,
  partners,
  rateCardLines,
  rateCards,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import {
  importKind,
  importNeedsBranch,
  isImportKind,
  type ChargeBasis,
  type CustomerContactRowValues,
  type CustomerRowValues,
  type ImportCheckCode,
  type ImportKind,
  type LocationRowValues,
  type OpenJobRowValues,
  type OpenReceivableRowValues,
  type PartnerRowValues,
  type TransportMode,
} from './descriptors'
import {
  loadReference,
  resolveCustomerCodes,
  resolveJobReferences,
  resolveRateReferences,
} from './queries'
import { usePilotFixtures } from '@/lib/pilot/source'
import { CONFLICT_STATES, REFERENCE_STATES, sqlState } from './sql-state'
import type { ImportIssue } from './issue-messages'

type Report = ImportReport<Record<string, unknown>, ImportCheckCode>

/**
 * What the browser is given back.
 *
 * Deliberately *not* the parsed rows. A clean two-thousand-row tariff would
 * ship a megabyte of duplicated data to the client for no purpose — the rows
 * are re-derived on commit from the file the operator still holds.
 */
export interface ImportState {
  readonly kind?: ImportKind
  readonly fileName?: string
  readonly ok?: boolean
  readonly totalRows?: number
  readonly acceptedRows?: number
  /**
   * Codes and values, not sentences — the console words them in the
   * operator's language (`issue-messages.ts`). Validation problems and the
   * ones only the write can find arrive here in the same shape.
   */
  readonly issues?: readonly ImportIssue[]
  readonly issueCount?: number
  readonly headers?: readonly string[]
  readonly mapping?: Mapping
  readonly ignoredColumns?: readonly string[]
  /** Set once a commit has succeeded. */
  readonly committed?: { readonly records: number; readonly cards?: number }
  /** A failure that is not a row problem — no file, no permission, no branch. */
  readonly error?: string
}

/** Excel writes UTF-8; a Windows-1256 Arabic export is not supported yet. */
const MAX_BYTES = 8 * 1024 * 1024

export async function runImport(_previous: ImportState, form: FormData): Promise<ImportState> {
  const session = await requireSession()

  const kindKey = String(form.get('kind') ?? '')
  if (!isImportKind(kindKey)) return { error: 'unknown_kind' }

  const entry = importKind(kindKey)!
  assertCan(session, entry.permission)

  const intent = form.get('intent') === 'commit' ? 'commit' : 'check'
  const file = form.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { kind: kindKey, error: 'no_file' }
  }
  if (file.size > MAX_BYTES) {
    return { kind: kindKey, fileName: file.name, error: 'too_large' }
  }

  const branchId = String(form.get('branchId') ?? '')
  const needsBranch = importNeedsBranch(kindKey)
  if (needsBranch) {
    if (!branchId) return { kind: kindKey, fileName: file.name, error: 'no_branch' }
    assertCanIn(session, entry.permission, branchId)
  }

  const text = await file.text()
  const mapping = readMapping(form.get('mapping'))
  const reference = await loadReference(session.actor, kindKey)

  const report = readImport(text, entry.descriptor, {
    lookups: reference.lookups,
    existing: reference.existing,
    mapping,
  })

  const base: ImportState = {
    kind: kindKey,
    fileName: file.name,
    ok: report.ok,
    totalRows: report.totalRows,
    acceptedRows: report.rows.length,
    // Carried in full up to the engine's own cap, because the CSV download is
    // built from this on the client. The table renders only the first fifty —
    // nobody reads five hundred rows on a screen, but they do open them in
    // Excel next to the file they are fixing.
    issues: report.issues,
    issueCount: report.issues.length,
    headers: report.headers,
    mapping: report.mapping,
    ignoredColumns: report.ignoredColumns,
  }

  if (intent === 'check' || !report.ok) return base

  /*
    The pilot has nothing to write into. The check above is real — read
    against the pilot's own reference data — but a commit would reach the
    writers' `withActor` and fail on the missing connection, so it is
    refused here in words rather than as a 500.
  */
  if (usePilotFixtures()) return { ...base, error: 'needs_database' }

  try {
    const committed = await write(session, kindKey, report, { branchId, form })
    revalidateFor(kindKey)
    return { ...base, committed }
  } catch (error) {
    /*
      The rows the database could not resolve go back as row issues, beside
      the headline error. Returning only the headline was the old behaviour
      and it made the per-row detail the writers collect unreachable: the
      operator read "a row refers to a record that does not exist" over a
      two-thousand-row file and had nothing to tell them which. The report
      now flips to blocked and lists every such line, and the download
      carries them like any other problem.
    */
    if (error instanceof UnknownReferenceError && error.issues.length > 0) {
      const badLines = new Set(error.issues.map((issue) => issue.line)).size
      return {
        ...base,
        ok: false,
        acceptedRows: Math.max(0, report.rows.length - badLines),
        issues: error.issues,
        issueCount: error.issues.length,
        error: 'unknown_reference',
      }
    }
    return { ...base, error: writeError(error) }
  }
}

function readMapping(raw: FormDataEntryValue | null): Mapping | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    // `Array.isArray` because `typeof [] === 'object'`: a JSON array would
    // otherwise become a mapping keyed `0`, `1`, `2`, which names no column and
    // so silently unmaps every field — the sheet then reports its required
    // columns as missing rather than falling back to its own headings.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const mapping: Record<string, number | null> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      mapping[key] =
        typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
    }
    return mapping
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------ writing */

type Session = Awaited<ReturnType<typeof requireSession>>

async function write(
  session: Session,
  kind: ImportKind,
  report: Report,
  context: { branchId: string; form: FormData },
): Promise<{ records: number; cards?: number }> {
  switch (kind) {
    case 'customers':
      return writeCustomers(session, report, context.branchId)
    case 'customer-contacts':
      return writeContacts(session, report)
    case 'partners':
      return writePartners(session, report)
    case 'locations':
      return writeLocations(session, report)
    case 'rate-cards':
      return writeRateCards(session, report, context)
    case 'open-jobs':
      return writeOpenJobs(session, report, context.branchId)
    case 'open-receivables':
      return writeOpenReceivables(session, report, context.branchId)
  }
}

/**
 * Shipments in flight at cutover.
 *
 * Two decisions worth stating, because both look like omissions:
 *
 * **The reference is kept, not renumbered.** Operations, the customer and the
 * carrier all have the old file number written down, and a migration that
 * renumbers every open shipment guarantees a fortnight of "which job is
 * that?". The new series starts at the next job raised in this system.
 *
 * **No milestones are generated.** A job imported mid-passage has already
 * passed most of a template's steps, and writing them all as incomplete would
 * put forty shipments on the exceptions board on the morning of go-live —
 * exactly the impression a cutover cannot afford. The status carries where the
 * shipment is; the milestone trail begins here.
 */
async function writeOpenJobs(
  session: Session,
  report: Report,
  branchId: string,
): Promise<{ records: number }> {
  const rows = report.rows.map((row) => ({
    line: row.line,
    values: row.values as unknown as OpenJobRowValues,
  }))

  const byCode = await resolveCustomerCodes(
    session.actor,
    rows.map((row) => row.values.customerCode),
  )

  const { locationIds, incoterms } = await resolveJobReferences(
    session.actor,
    rows.flatMap((row) =>
      [row.values.originCode, row.values.destinationCode].filter((value): value is string =>
        Boolean(value),
      ),
    ),
    rows.map((row) => row.values.incoterm).filter((value): value is string => Boolean(value)),
  )

  // Reported as row issues rather than one error, so an operator gets every
  // bad line at once instead of fixing them one import at a time.
  const missing = unknownCustomers(report, rows, byCode)
  if (missing.length > 0) throw new UnknownReferenceError(missing)

  await withActor(session.actor, async (tx) => {
    for (const { values } of rows) {
      await tx.insert(jobs).values({
        reference: values.reference,
        branchId,
        customerId: byCode.get(values.customerCode.toUpperCase())!,
        status: values.status,
        mode: values.mode,
        tradeDirection: values.tradeDirection,
        originId: values.originCode ? (locationIds.get(values.originCode) ?? null) : null,
        destinationId: values.destinationCode
          ? (locationIds.get(values.destinationCode) ?? null)
          : null,
        incoterm: values.incoterm ? (incoterms.get(values.incoterm) ?? null) : null,
        masterBillNumber: values.masterBillNumber,
        houseBillNumber: values.houseBillNumber,
        bookingNumber: values.bookingNumber,
        vesselName: values.vesselName,
        voyageNumber: values.voyageNumber,
        flightNumber: values.flightNumber,
        etd: values.etd ? new Date(values.etd) : null,
        eta: values.eta ? new Date(values.eta) : null,
        customerReference: values.customerReference,
      })
    }
  })

  return { records: rows.length }
}

/**
 * Unpaid invoices at cutover, as opening balances.
 *
 * Written `issued` or `part_paid` according to what has been received, so the
 * ageing report and the customer statement are both correct on day one
 * without anyone reconstructing a payment history.
 *
 * **No invoice lines and no charge lines.** The line detail of an old invoice
 * cannot be reproduced faithfully — the charge types will not map, and the FX
 * rate each line was struck at is gone, which `numeric(19,6)` and the stored
 * per-line rate exist precisely to preserve. Inventing them would put figures
 * in the margin report that never happened. The total is what is chased, the
 * total is what is imported, and a balance with no lines reads as what it is:
 * an opening position carried over.
 *
 * The series counter is deliberately **not** advanced. These numbers were
 * issued by the system being retired; the branch's own sequence belongs to the
 * invoices this platform will issue, and merging the two would leave gaps that
 * look like deleted documents to an auditor.
 */
async function writeOpenReceivables(
  session: Session,
  report: Report,
  branchId: string,
): Promise<{ records: number }> {
  const rows = report.rows.map((row) => ({
    line: row.line,
    values: row.values as unknown as OpenReceivableRowValues,
  }))

  const byCode = await resolveCustomerCodes(
    session.actor,
    rows.map((row) => row.values.customerCode),
  )

  const missing = unknownCustomers(report, rows, byCode)
  if (missing.length > 0) throw new UnknownReferenceError(missing)

  await withActor(session.actor, async (tx) => {
    for (const { values } of rows) {
      const paid = Number(values.amountPaid)

      await tx.insert(invoices).values({
        branchId,
        customerId: byCode.get(values.customerCode.toUpperCase())!,
        seriesNo: values.seriesNo,
        // `part_paid` where something has been received. The descriptor's own
        // check already refused a fully settled row, so these are the only two
        // states an open receivable can legitimately be in.
        status: paid > 0 ? 'part_paid' : 'issued',
        currency: values.currency,
        subtotal: values.subtotal,
        taxAmount: values.taxAmount,
        total: values.total,
        amountPaid: values.amountPaid,
        // The same figure, kept apart: no receipt stands behind it, and
        // re-deriving `amount_paid` from receipts adds it back (F22).
        amountPaidOpening: values.amountPaid,
        taxTreatment: values.taxTreatment,
        issuedAt: new Date(values.issuedOn),
        dueOn: values.dueOn ?? null,
        notes: 'Opening balance imported at cutover',
      })
    }
  })

  return { records: rows.length }
}

async function writeCustomers(
  session: Session,
  report: Report,
  branchId: string,
): Promise<{ records: number }> {
  const rows = report.rows.map((row) => row.values as unknown as CustomerRowValues)

  await withActor(session.actor, async (tx) => {
    for (const values of rows) {
      const [inserted] = await tx
        .insert(customers)
        .values({
          code: values.code,
          legalNameEn: values.legalNameEn,
          legalNameAr: values.legalNameAr,
          registration: values.registration,
          taxRegistration: values.taxRegistration,
          countryCode: values.countryCode,
          primaryBranchId: branchId,
          isActive: values.isActive,
        })
        .returning({ id: customers.id })

      // Terms are written with the customer for the same reason the form
      // captures them together: a customer with no payment terms is one
      // nobody can invoice.
      await tx.insert(customerBranchTerms).values({
        customerId: inserted!.id,
        branchId,
        paymentTermsDays: values.paymentTermsDays,
        creditLimit: values.creditLimit,
        creditCurrency: values.creditCurrency,
        freeTimeDays: values.freeTimeDays,
        defaultIncoterm: values.defaultIncoterm,
      })
    }
  })

  return { records: rows.length }
}

async function writeContacts(session: Session, report: Report): Promise<{ records: number }> {
  const rows = report.rows.map((row) => ({
    line: row.line,
    values: row.values as unknown as CustomerContactRowValues,
  }))

  const codes = rows.map((row) => row.values.customerCode)
  const byCode = await resolveCustomerCodes(session.actor, codes)

  // A contact whose customer does not exist is a row error, not a crash — and
  // it is caught here rather than in the descriptor because only the database
  // knows which codes exist.
  const orphans = unknownCustomers(report, rows, byCode)
  if (orphans.length > 0) throw new UnknownReferenceError(orphans)

  await withActor(session.actor, async (tx) => {
    for (const { values } of rows) {
      await tx.insert(customerContacts).values({
        customerId: byCode.get(values.customerCode)!,
        nameEn: values.nameEn,
        nameAr: values.nameAr,
        email: values.email,
        phone: values.phone,
        role: values.role,
        isPrimary: values.isPrimary,
      })
    }
  })

  return { records: rows.length }
}

async function writePartners(session: Session, report: Report): Promise<{ records: number }> {
  const rows = report.rows.map((row) => row.values as unknown as PartnerRowValues)

  await withActor(session.actor, async (tx) => {
    for (const values of rows) {
      await tx.insert(partners).values({
        code: values.code,
        type: values.type,
        legalNameEn: values.legalNameEn,
        legalNameAr: values.legalNameAr,
        countryCode: values.countryCode,
        currency: values.currency,
        paymentTermsDays: values.paymentTermsDays,
        isActive: values.isActive,
      })
    }
  })

  return { records: rows.length }
}

async function writeLocations(session: Session, report: Report): Promise<{ records: number }> {
  const rows = report.rows.map((row) => row.values as unknown as LocationRowValues)

  await withActor(session.actor, async (tx) => {
    for (const values of rows) {
      await tx.insert(locations).values({
        unlocode: values.unlocode,
        nameEn: values.nameEn,
        nameAr: values.nameAr,
        countryCode: values.countryCode,
        kind: values.kind,
        isActive: values.isActive,
      })
    }
  })

  return { records: rows.length }
}

/**
 * `FR-RT-09` — the flat sheet becomes cards and lines.
 *
 * The lane and validity identify the card; everything else is a line beneath
 * it, currency included — a USD freight line and a KWD handling line on one
 * lane are one card (S4). `validity` is written explicitly as a `daterange` literal rather
 * than left to the trigger: the trigger would set the same value, but the
 * column is `not null` and an explicit literal means the insert is correct
 * whether or not the trigger fires first.
 */
async function writeRateCards(
  session: Session,
  report: Report,
  context: { branchId: string; form: FormData },
): Promise<{ records: number; cards: number }> {
  const direction = context.form.get('direction') === 'sell' ? 'sell' : 'buy'
  const partnerId = String(context.form.get('partnerId') ?? '') || null

  if (direction === 'buy' && !partnerId) throw new MissingPartnerError()

  const cards = groupRateCards(
    report.rows as unknown as readonly { line: number; values: RateRowValues }[],
  )

  const { locationIds, chargeTypeIds } = await resolveRateReferences(
    session.actor,
    cards.flatMap((card) => [card.originCode, card.destinationCode]),
    cards.flatMap((card) => card.lines.map((line) => line.chargeCode)),
  )

  let lineCount = 0

  await withActor(session.actor, async (tx) => {
    for (const card of cards) {
      const originId = locationIds.get(card.originCode)
      const destinationId = locationIds.get(card.destinationCode)
      if (!originId || !destinationId) throw new UnknownReferenceError([])

      const [inserted] = await tx
        .insert(rateCards)
        .values({
          direction,
          partnerId: direction === 'buy' ? partnerId : null,
          customerId: null,
          branchId: context.branchId,
          mode: card.mode as TransportMode,
          originId,
          destinationId,
          validity: dateRangeLiteral(card.validFrom, card.validTo),
          validFrom: card.validFrom,
          validTo: card.validTo,
          currency: card.currency,
          notes: card.notes,
          createdById: session.principal.id,
        })
        .returning({ id: rateCards.id })

      for (const line of card.lines) {
        const chargeTypeId = chargeTypeIds.get(line.chargeCode)
        if (!chargeTypeId) throw new UnknownReferenceError([])

        await tx.insert(rateCardLines).values({
          rateCardId: inserted!.id,
          chargeTypeId,
          basis: line.basis as ChargeBasis,
          rate: line.rate,
          currency: line.currency,
          minimum: line.minimum,
          maximum: line.maximum,
          containerType: line.containerType,
          sortOrder: line.sortOrder,
        })
        lineCount++
      }
    }
  })

  return { records: lineCount, cards: cards.length }
}

/** `[from,to)` — half-open, matching the trigger and `FR-RT-01`'s filter. */
function dateRangeLiteral(from: string, to: string | null): string {
  return `[${from},${to ?? ''})`
}

/**
 * The rows naming a customer code the database does not hold.
 *
 * One builder for the three sheets that carry a customer code, because they
 * had drifted into three wordings and two shapes — one set `column`, another
 * `field`, neither set both. The column is the heading the operator's own file
 * used, read back from the mapping, since that is what they will look for in
 * Excel; `code` and `values` are what the screen translates.
 */
function unknownCustomers(
  report: Report,
  rows: readonly { readonly line: number; readonly values: { readonly customerCode: string } }[],
  known: ReadonlyMap<string, string>,
): ImportIssue[] {
  const at = report.mapping.customerCode
  const column = at == null ? undefined : report.headers[at]
  return rows
    .filter((row) => !known.has(row.values.customerCode.toUpperCase()))
    .map((row) => ({
      line: row.line,
      field: 'customerCode',
      ...(column === undefined ? {} : { column }),
      code: 'unknownCustomer' as const,
      values: { value: row.values.customerCode },
      label: 'Customer code',
      message: `Customer code: No such customer "${row.values.customerCode}" — import customers first`,
    }))
}

/* ------------------------------------------------------------------- errors */

class UnknownReferenceError extends Error {
  constructor(readonly issues: readonly ImportIssue[]) {
    super('unknown_reference')
    this.name = 'UnknownReferenceError'
  }
}

class MissingPartnerError extends Error {
  constructor() {
    super('no_partner')
    this.name = 'MissingPartnerError'
  }
}

function writeError(error: unknown): string {
  if (error instanceof MissingPartnerError) return 'no_partner'
  if (error instanceof UnknownReferenceError) return 'unknown_reference'

  const code = sqlState(error)
  if (code !== undefined && CONFLICT_STATES.has(code)) return 'conflict'
  if (code !== undefined && REFERENCE_STATES.has(code)) return 'unknown_reference'

  throw error
}

function revalidateFor(kind: ImportKind): void {
  const paths: Record<ImportKind, string[]> = {
    customers: ['/customers'],
    'customer-contacts': ['/customers'],
    partners: ['/partners'],
    locations: ['/locations'],
    'rate-cards': ['/rates'],
    'open-jobs': ['/jobs', '/dashboard'],
    'open-receivables': ['/invoices', '/finance'],
  }
  for (const path of paths[kind]) revalidatePath(path)
}
