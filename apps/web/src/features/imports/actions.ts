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
  type RowIssue,
} from '@qabandi/core/import'
import {
  customerBranchTerms,
  customerContacts,
  customers,
  locations,
  partners,
  rateCardLines,
  rateCards,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import {
  importKind,
  isImportKind,
  type ChargeBasis,
  type CustomerContactRowValues,
  type CustomerRowValues,
  type ImportKind,
  type LocationRowValues,
  type PartnerRowValues,
  type TransportMode,
} from './descriptors'
import { loadReference, resolveCustomerCodes, resolveRateReferences } from './queries'
import { CONFLICT_STATES, REFERENCE_STATES, sqlState } from './sql-state'

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
  readonly issues?: readonly RowIssue[]
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
  const needsBranch = kindKey === 'customers' || kindKey === 'rate-cards'
  if (needsBranch) {
    if (!branchId) return { kind: kindKey, fileName: file.name, error: 'no_branch' }
    assertInBranch(session, branchId)
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

  try {
    const committed = await write(session, kindKey, report, { branchId, form })
    revalidateFor(kindKey)
    return { ...base, committed }
  } catch (error) {
    return { ...base, error: writeError(error) }
  }
}

function readMapping(raw: FormDataEntryValue | null): Mapping | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return undefined
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
  report: ImportReport,
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
  }
}

async function writeCustomers(
  session: Session,
  report: ImportReport,
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

async function writeContacts(session: Session, report: ImportReport): Promise<{ records: number }> {
  const rows = report.rows.map((row) => ({
    line: row.line,
    values: row.values as unknown as CustomerContactRowValues,
  }))

  const codes = rows.map((row) => row.values.customerCode)
  const byCode = await resolveCustomerCodes(session.actor, codes)

  // A contact whose customer does not exist is a row error, not a crash — and
  // it is caught here rather than in the descriptor because only the database
  // knows which codes exist.
  const orphans = rows.filter((row) => !byCode.has(row.values.customerCode))
  if (orphans.length > 0) {
    throw new UnknownReferenceError(
      orphans.map((row) => ({
        line: row.line,
        field: 'customerCode',
        message: `Customer code: "${row.values.customerCode}" does not exist.`,
      })),
    )
  }

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

async function writePartners(session: Session, report: ImportReport): Promise<{ records: number }> {
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

async function writeLocations(
  session: Session,
  report: ImportReport,
): Promise<{ records: number }> {
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
 * The lane, currency and validity identify the card; everything else is a line
 * beneath it. `validity` is written explicitly as a `daterange` literal rather
 * than left to the trigger: the trigger would set the same value, but the
 * column is `not null` and an explicit literal means the insert is correct
 * whether or not the trigger fires first.
 */
async function writeRateCards(
  session: Session,
  report: ImportReport,
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
          currency: card.currency,
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

/* ------------------------------------------------------------------- errors */

class UnknownReferenceError extends Error {
  constructor(readonly issues: readonly RowIssue[]) {
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
  }
  for (const path of paths[kind]) revalidatePath(path)
}
