/**
 * A supplier's PDF, read into `supplier_invoice_lines` — FR-FN-09.
 *
 * This is the surface with the largest return in `docs/Qabandi_AI_Surface.md`,
 * and the reason is not that extraction is clever here. It is that
 * `core/matching.ts` is already written, already tested, and already knows how
 * to find the agent who billed 460 for something quoted at 400 — and it runs
 * on rows that somebody types in by hand today. This worker does not add a
 * capability. It switches on one the project has already paid for.
 *
 * ## What it produces, and what it refuses to produce
 *
 * A `supplier_invoices` row in `received` with its lines, or nothing at all.
 *
 * `received` is not a concession — it is the draft gate this table already
 * had. A bill is payable only once `approved_at` is stamped, and that has been
 * a separate act by finance since the table existed: *"anyone in operations
 * can enter what arrived; releasing it for payment is finance's."* A model is
 * simply another thing that can enter what arrived. It cannot approve, and
 * nothing here gives it a way to.
 *
 * ## The arithmetic decides, not the confidence
 *
 * `isSelfConsistent` in `core/extraction.ts` refuses an extraction that does
 * not add up however sure the model said it was, and accepts a hesitant one
 * that balances. An invoice states its quantities twice — every line carries
 * quantity, unit price and amount, and the header says what they sum to — so a
 * misread digit produces a document that does not reconcile rather than a
 * plausible lie. That is a far better signal than a self-reported score, and
 * it is the only reason this surface writes anything without a person.
 *
 * An extraction that does not reconcile is still recorded: the invocation row
 * carries the response, and the findings come back to the caller so a
 * coordinator sees *"line 3 says 450.000, the figures give 451.500"* rather
 * than an empty form and no explanation.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  assets,
  branches,
  chargeLines,
  chargeTypes,
  currencies,
  inSeries,
  jobs,
  latestFxRate,
  notificationOutbox,
  partners,
  supplierInvoiceLines,
  supplierInvoices,
  withActor,
  type Actor,
  type Tx,
} from '@qabandi/db'
import {
  describeFinding,
  isSelfConsistent,
  parseModelJson,
  readExtractedInvoice,
  invoiceTotal,
  money,
  reconcileInvoice,
  resolveTolerance,
  round,
  seedCurrencyLookup,
  summariseInvoice,
  sum,
  toDb,
  tolerance,
  varianceAlert,
  type ArithmeticFinding,
  type CurrencySpec,
  type ExtractedInvoice,
  type SupplierLineInput,
} from '@qabandi/core'
import { INVOICE_EXTRACTION_SCHEMA } from '@qabandi/core'
import type { ImportLookups } from '@qabandi/core/import'
import { fileStore } from '../adapters/index'
import { invoke } from '../ai/ledger'
import { INVOICE_PROMPT_VERSION, INVOICE_USER_PROMPT, invoiceSystemPrompt } from '../ai/prompts'
import type { ModelContent } from '../ports/index'

/**
 * How sure the model must be before an extraction is written unattended.
 *
 * A floor, not the decision — the arithmetic in `isSelfConsistent` is what
 * actually decides. This exists to stop a model that has told us it was
 * guessing from being believed merely because the guess happened to balance,
 * which is possible on a single-line invoice where there is nothing to
 * reconcile against.
 */
export const CONFIDENCE_FLOOR = 0.7

/** Scans this large are refused rather than sent. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

export interface ExtractInvoiceInput {
  readonly actor: Actor
  readonly branchId: string
  /** The stored scan — `assets.id`. */
  readonly assetId: string
  /** Whose bill this is. Never inferred from the document (see below). */
  readonly partnerId: string
  /** Attach every line to this job, where the caller knows it. */
  readonly jobId?: string | null
  /**
   * Write the invoice, or only report what was read.
   *
   * False is the attended path: a coordinator has the capture form open and
   * the extraction pre-fills it, so the review *is* the form and writing a row
   * behind them would leave two. True is the unattended path — a bill that
   * arrived by email with nobody looking.
   */
  readonly write?: boolean
}

export interface ExtractInvoiceResult {
  readonly invocationId: string
  readonly extracted: ExtractedInvoice
  readonly findings: readonly ArithmeticFinding[]
  /** Whether the document reconciles and cleared the floor. */
  readonly consistent: boolean
  /** Set only where `write` was asked for and the extraction was consistent. */
  readonly supplierInvoiceId?: string
  /** Why nothing was written, in one line, where nothing was. */
  readonly refusal?: string
  /**
   * The same reason as a code, for a screen to say in the reader's language.
   * `refusal` stays English because the worker log reads it and has no locale.
   */
  readonly refusalCode?: InvoiceRefusal
  /** What the sentence names — the sizes, or how many findings or issues. */
  readonly refusalValues?: Readonly<Record<string, string>>
}

/**
 * Why a bill was not written, as a stable code.
 *
 *   `scan_too_large`     refused before the model was called
 *   `not_reconciled`     the figures do not add up — the findings say where
 *   `unreadable_fields`  a header field or a line did not parse
 *   `low_confidence`     nothing wrong with the reading; the model was unsure
 *   `no_exchange_rate`   a foreign-currency bill, and no rate to the base on file
 *
 * The web app translates these, and its switch has a `never` default, so a
 * code added here without a sentence there fails its typecheck.
 */
export type InvoiceRefusal =
  'scan_too_large' | 'not_reconciled' | 'unreadable_fields' | 'low_confidence' | 'no_exchange_rate'

/**
 * Read one supplier invoice.
 *
 * Note what is *not* extracted: the partner. The document says who sent it and
 * we do not ask the model, because attribution decides whose money moves —
 * `inbound-routing.ts` makes the same refusal for the same reason, and its
 * comment applies here word for word: two candidates means none. The caller
 * knows the partner from the mailbox the bill arrived in or from the screen
 * the coordinator is standing on, and both are better evidence than a
 * letterhead a model read.
 */
export async function extractSupplierInvoice(
  input: ExtractInvoiceInput,
): Promise<ExtractInvoiceResult> {
  const { actor, branchId, assetId } = input

  const asset = await loadAsset(actor, assetId)
  const reference = await loadReference(actor)

  const bytes = await (await fileStore()).get(asset.storageKey)
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    /*
      Refused before the call rather than after it.

      An 80MB scan of a whole customs file is a real thing that arrives —
      `INBOUND_MAIL_MAX_ATTACHMENT_MB` exists because of it — and sending one
      costs real money to be told it was too large. The same reasoning the mail
      worker uses: note the fact, keep the row, let a person act.
    */
    const sizeMb = String(Math.round(bytes.byteLength / 1024 / 1024))
    const limitMb = String(MAX_DOCUMENT_BYTES / 1024 / 1024)
    return refuse(
      `The scan is ${sizeMb}MB, above the ${limitMb}MB limit for extraction.`,
      'scan_too_large',
      { sizeMb, limitMb },
    )
  }

  const { response, invocationId } = await invoke(
    {
      actor,
      branchId,
      surface: 'invoice_extract',
      promptVersion: INVOICE_PROMPT_VERSION,
      jobId: input.jobId ?? null,
    },
    {
      surface: 'invoice_extract',
      messages: [
        { role: 'system', content: invoiceSystemPrompt(reference.chargeTypeKeys) },
        {
          role: 'user',
          content: [
            { type: 'text', text: INVOICE_USER_PROMPT },
            documentPart(bytes, asset.contentType, asset.fileName),
          ],
        },
      ],
      schema: INVOICE_EXTRACTION_SCHEMA,
    },
    /*
      The same scan read twice — attached to a second job, or retried after
      the first reading scrolled away — is answered from the ledger rather
      than billed again. A revised prompt changes the hash and misses.
    */
    { reuse: true },
  )

  const extracted = readExtractedInvoice(parseModelJson(response.text), reference.lookups)
  const spec = specFor(extracted.header.currency)
  const findings = spec ? reconcileInvoice(extracted, spec) : []
  const consistent = spec ? isSelfConsistent(extracted, spec, CONFIDENCE_FLOOR) : false

  const base = { invocationId, extracted, findings, consistent }

  if (!input.write) return base
  if (!consistent) {
    const code = refusalCodeFor(extracted, findings)
    return {
      ...base,
      refusal: refusalFor(extracted, findings),
      refusalCode: code,
      refusalValues: refusalValuesFor(code, extracted, findings),
    }
  }

  const written = await write(input, extracted, spec!, asset.id, reference)
  if ('noRateTo' in written) {
    const values = { currency: spec!.code, base: written.noRateTo }
    return {
      ...base,
      refusal: `No exchange rate from ${values.currency} to ${values.base} is on file, so the bill was not written.`,
      refusalCode: 'no_exchange_rate',
      refusalValues: values,
    }
  }
  return { ...base, supplierInvoiceId: written.id }

  function refuse(
    reason: string,
    code: InvoiceRefusal,
    values: Readonly<Record<string, string>>,
  ): ExtractInvoiceResult {
    return {
      invocationId: '',
      extracted: emptyExtraction(),
      findings: [],
      consistent: false,
      refusal: reason,
      refusalCode: code,
      refusalValues: values,
    }
  }
}

/**
 * Which of the three post-reading refusals applies — the order `refusalFor`
 * words them in, and the one place that order is decided, so the code a screen
 * translates and the sentence a log prints can never name different reasons.
 */
export function refusalCodeFor(
  extracted: ExtractedInvoice,
  findings: readonly ArithmeticFinding[],
): InvoiceRefusal {
  if (findings.length > 0) return 'not_reconciled'
  if (readingIssues(extracted).length > 0) return 'unreadable_fields'
  return 'low_confidence'
}

/**
 * Counts only, never the English details.
 *
 * The findings travel on their own in the response, with both figures, so the
 * screen can word each one itself. The parse issues travel the same way, coded
 * (`invoiceReadingIssues`, sent as `readingIssues` by the route); the count
 * here is what the screen falls back to when it cannot word one of them.
 */
function refusalValuesFor(
  code: InvoiceRefusal,
  extracted: ExtractedInvoice,
  findings: readonly ArithmeticFinding[],
): Readonly<Record<string, string>> {
  switch (code) {
    case 'not_reconciled':
      return { count: String(findings.length) }
    case 'unreadable_fields':
      return { count: String(readingIssues(extracted).length) }
    default:
      return {}
  }
}

/** The header's issues and the lines', in the one form both callers print. */
function readingIssues(extracted: ExtractedInvoice): string[] {
  return [
    ...extracted.headerIssues,
    ...extracted.lines.issues.map((issue) => `line ${issue.line}: ${issue.message}`),
  ]
}

/**
 * Why nothing was written, in one line a coordinator can act on.
 *
 * Exported and pure, because it is the sentence that decides whether a person
 * fixes the bill in ten seconds or retypes it in four minutes — and because
 * everything it depends on is already in hand by the time it is called, so
 * there is no reason for it to need a database to be exercised.
 *
 * Arithmetic first, deliberately. A document that does not reconcile has one
 * useful thing to say and it is the figures: *"line 3 says 450.000, the
 * figures give 451.500"* sends somebody straight to line 3. Reporting a
 * parsing complaint ahead of that would bury the number under a description of
 * our own machinery.
 */
export function refusalFor(
  extracted: ExtractedInvoice,
  findings: readonly ArithmeticFinding[],
): string {
  switch (refusalCodeFor(extracted, findings)) {
    case 'not_reconciled':
      return `The invoice does not reconcile: ${findings.map(describeFinding).join('; ')}`
    case 'unreadable_fields':
      return readingIssues(extracted).join('; ')
    default:
      /*
        Nothing wrong with the reading, so the model simply was not sure
        enough. Said plainly rather than as "validation failed", because there
        is nothing for the coordinator to correct — the answer is to read the
        PDF.
      */
      return 'The model was not confident enough to write this without review.'
  }
}

/* -------------------------------------------------------------------------
 * The write
 * ---------------------------------------------------------------------- */

/**
 * One transaction, under the *asking* principal.
 *
 * Not the system actor. A supplier invoice is a business record and RLS must
 * decide whether this principal may write one in this branch — the ledger row
 * is the only thing in this feature written as `system`, because it is an
 * accounting fact about the company rather than about a shipment.
 *
 * `reference` is unique per partner, and a duplicate is the most common error
 * on this screen: two people open the same email. Nothing is invented to work
 * around it — the insert is allowed to fail, and the caller reports that the
 * bill is already captured, which is the true and useful answer.
 */
async function write(
  input: ExtractInvoiceInput,
  extracted: ExtractedInvoice,
  spec: CurrencySpec,
  assetId: string,
  reference: Reference,
): Promise<{ id: string } | { noRateTo: string }> {
  const { header } = extracted
  const code = spec.code

  return withActor(input.actor, async (tx: Tx) => {
    /*
      The rate to the branch's base, taken now and written on the bill
      (FR-RT-06). It was never set, so every bill the extractor wrote carried
      the column default of 1 — a USD 2,900 bill approved and paid as 2,900
      dinars. Where no rate is on file nothing is written, rather than a bill
      that looks right and posts at face value; the coordinator captures it by
      hand with the rate the agent agreed.
    */
    const [branch] = await tx
      .select({ base: branches.baseCurrency })
      .from(branches)
      .where(eq(branches.id, input.branchId))
      .limit(1)
    const base = branch?.base ?? code
    const fxRate = base === code ? '1' : await latestFxRate(tx, code, base)
    if (!fxRate) return { noRateTo: base }

    /*
      Decimal throughout, never a JS number (§11). KWD carries three decimals
      and a supplier invoice is exactly where the difference shows.
    */
    const net = round(
      sum(
        extracted.lines.rows.map((row) => money(row.values.amount, code)),
        code,
      ),
      spec,
    )
    const tax = header.taxAmount ?? '0'

    const [invoice] = await tx
      .insert(supplierInvoices)
      .values({
        branchId: input.branchId,
        partnerId: input.partnerId,
        reference: header.invoiceNumber,
        /*
          `received`, always. The draft gate this table already had: a bill is
          payable only once finance stamps `approved_at`, and a model has no
          path to that column.
        */
        status: 'received' as const,
        currency: code,
        fxRate,
        subtotal: header.subtotal ?? toDb(net),
        taxAmount: tax,
        /*
          `invoiceTotal` rather than an addition written here: a single-line
          agent debit note routinely prints nothing but the amount, every
          caller wants a total, and each one inventing its own fallback is how
          two screens end up disagreeing about what a bill is worth.
        */
        total: header.total ?? toDb(invoiceTotal(extracted, spec)),
        invoiceDate: header.invoiceDate,
        dueOn: header.dueOn ?? null,
        assetId,
      })
      .returning({ id: supplierInvoices.id })

    const invoiceId = invoice!.id

    await tx.insert(supplierInvoiceLines).values(
      extracted.lines.rows.map((row, index) => ({
        supplierInvoiceId: invoiceId,
        // Carried, not derived — as everywhere else, so RLS does not recurse.
        branchId: input.branchId,
        jobId: input.jobId ?? null,
        /*
          Resolved inline rather than in a second pass. An unrecognised code is
          simply an unset column — a line a coordinator classifies in two
          seconds — and never a refused capture they retype entirely.
        */
        chargeTypeId: row.values.chargeType
          ? (reference.chargeTypeIds.get(row.values.chargeType) ?? null)
          : null,
        description: row.values.description,
        quantity: row.values.quantity,
        /*
          A flat charge prints no unit price, and the column is not nullable.
          The amount is the unit price of a quantity of one, which is what the
          document means — and `reconcileInvoice` skipped the check for exactly
          this row rather than inventing a figure to check against.
        */
        unitPrice: row.values.unitPrice ?? row.values.amount,
        amount: row.values.amount,
        taxAmount: row.values.taxAmount,
        sortOrder: index,
      })),
    )

    /*
      The whole reason this surface earns its return (see the header): the same
      transaction that captured the bill also decides whether it should be
      queried before finance approves it. Inside the tx, so a rolled-back
      capture never leaves a variance alert behind — the transactional-outbox
      pattern `comms.ts` describes.
    */
    await flagVariance(tx, input, extracted, spec, code, reference)

    return { id: invoiceId }
  })
}

/* -------------------------------------------------------------------------
 * The variance flag — FR-FN-09's alert half
 * ---------------------------------------------------------------------- */

/**
 * Raise a variance alert to finance when a supplier billed over the accrual.
 *
 * `core/matching.ts` already knows how to find the agent who billed 460 for a
 * cost accrued at 400; this is the worker end that feeds it rows and, where a
 * line is over tolerance, drops a `notification_outbox` row for the internal
 * audience `supplier_invoice.variance_flagged` names.
 *
 * ## Three deliberate narrowings, each keeping the alert honest
 *
 *   - **A job must be attached.** The accrual is keyed on the job, so a bill
 *     that arrived by mail with nobody having matched it to a shipment yet has
 *     nothing to compare against — it surfaces on the payables review screen
 *     once matched, not here.
 *   - **The invoice's own currency, never converted.** `charge_lines.amount` is
 *     summed in the currency the bill states, and a cost accrued in a different
 *     currency is left out. Extraction does not stamp an FX rate, and inventing
 *     one here is exactly what `matching.ts` warns turns a variance into an FX
 *     movement in disguise — `compareToAccrual` throws on a currency mismatch
 *     rather than let it happen.
 *   - **Per charge type, and only where an accrual exists.** Billed lines are
 *     summed by charge type against the cost the job accrued for that partner
 *     and that charge type. A charge type the job never accrued (accrual zero)
 *     is skipped rather than read as a full-value over — most legitimate costs
 *     (a customs inspection, a demurrage day) were never pre-accrued, and
 *     flagging every one of them is how an alert learns to be ignored.
 *
 * Exported for the write-path test, which drives it under a real actor against
 * seeded rows — the query and the RLS insert are exactly what a pure test
 * cannot reach, and `varianceAlert` already covers the decision that can.
 */
export async function flagVariance(
  tx: Tx,
  input: ExtractInvoiceInput,
  extracted: ExtractedInvoice,
  spec: CurrencySpec,
  code: string,
  reference: Reference,
): Promise<void> {
  if (!input.jobId) return

  // Billed, summed per resolved charge type — the same resolution the line
  // insert above made, so the two never disagree about which code a line is.
  const billedByType = new Map<string, string[]>()
  for (const row of extracted.lines.rows) {
    const chargeTypeId = row.values.chargeType
      ? reference.chargeTypeIds.get(row.values.chargeType)
      : undefined
    if (!chargeTypeId) continue
    const amounts = billedByType.get(chargeTypeId) ?? []
    amounts.push(row.values.amount)
    billedByType.set(chargeTypeId, amounts)
  }

  const chargeTypeIds = [...billedByType.keys()]
  if (chargeTypeIds.length === 0) return

  const [[job], [partner], typeRows, accrualRows] = await inSeries([
    () => tx.select({ reference: jobs.reference }).from(jobs).where(eq(jobs.id, input.jobId!)),
    () =>
      tx
        .select({
          name: partners.legalNameEn,
          percent: partners.varianceTolerancePercent,
          absolute: partners.varianceToleranceAbsolute,
        })
        .from(partners)
        .where(eq(partners.id, input.partnerId)),
    () =>
      tx
        .select({
          id: chargeTypes.id,
          name: chargeTypes.nameEn,
          percent: chargeTypes.varianceTolerancePercent,
          absolute: chargeTypes.varianceToleranceAbsolute,
        })
        .from(chargeTypes)
        .where(inArray(chargeTypes.id, chargeTypeIds)),
    /*
      The provisional accrual: the cost the job booked to this partner for this
      charge type, in the bill's own currency. `is_accrual` is not required —
      an already-posted cost line is as valid a comparison as an accrued one,
      and a bill against a job with no cost line at all simply finds nothing.
    */
    () =>
      tx
        .select({
          chargeTypeId: chargeLines.chargeTypeId,
          accrued: sql<string>`coalesce(sum(${chargeLines.amount}), '0')`,
        })
        .from(chargeLines)
        .where(
          and(
            eq(chargeLines.jobId, input.jobId!),
            eq(chargeLines.counterpartyPartnerId, input.partnerId),
            eq(chargeLines.direction, 'cost'),
            eq(chargeLines.currency, code),
            inArray(chargeLines.chargeTypeId, chargeTypeIds),
          ),
        )
        .groupBy(chargeLines.chargeTypeId),
  ])

  if (!partner) return

  const partnerTol = tolerance(partner.percent, partner.absolute)
  const typeById = new Map(typeRows.map((row) => [row.id, row]))
  const accruedById = new Map(accrualRows.map((row) => [row.chargeTypeId, row.accrued]))

  const lines: SupplierLineInput[] = []
  for (const [chargeTypeId, amounts] of billedByType) {
    const accrued = accruedById.get(chargeTypeId)
    // Nothing accrued for this code — see the header's third narrowing.
    if (accrued === undefined) continue
    const type = typeById.get(chargeTypeId)
    lines.push({
      id: chargeTypeId,
      description: type?.name ?? chargeTypeId,
      billed: sum(
        amounts.map((amount) => money(amount, code)),
        code,
      ).amount,
      accrued,
      matchCount: 1,
      tolerance: resolveTolerance(tolerance(type?.percent, type?.absolute), partnerTol),
    })
  }

  if (lines.length === 0) return

  const alert = varianceAlert(summariseInvoice(lines, code, spec))
  if (!alert.flagged) return

  await tx.insert(notificationOutbox).values({
    branchId: input.branchId,
    eventKey: 'supplier_invoice.variance_flagged',
    jobId: input.jobId,
    payload: {
      reference: extracted.header.invoiceNumber,
      partnerName: partner.name,
      jobReference: job?.reference ?? '—',
      flaggedCount: alert.overCount,
      worstDescription: alert.worst?.description ?? '—',
      worstVariance: alert.worst ? toDb(alert.worst.variance) : '0',
      totalVariance: toDb(alert.totalOverVariance),
      currency: code,
    },
  })
}

/* -------------------------------------------------------------------------
 * Loading
 * ---------------------------------------------------------------------- */

interface AssetRow {
  readonly id: string
  readonly storageKey: string
  readonly contentType: string
  readonly fileName: string
}

async function loadAsset(actor: Actor, assetId: string): Promise<AssetRow> {
  const [row] = await withActor(actor, (tx: Tx) =>
    tx
      .select({
        id: assets.id,
        storageKey: assets.storageKey,
        contentType: assets.contentType,
        fileName: assets.fileName,
      })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1),
  )

  if (!row) throw new Error(`No asset ${assetId}, or it is outside this principal's scope.`)
  return row
}

/**
 * The reference sets the parsers check against — the same shape a CSV import
 * takes, because it is the same machinery.
 *
 * Read under the caller's actor, so a model is never shown reference data the
 * asking principal could not see. Charge types and currencies are readable to
 * every internal principal, which makes that a formality here and not one two
 * surfaces from now.
 */
export async function loadReference(actor: Actor): Promise<Reference> {
  return withActor(actor, async (tx: Tx) => {
    const [codes, money] = await inSeries([
      () =>
        tx
          .select({ id: chargeTypes.id, key: chargeTypes.key })
          .from(chargeTypes)
          .where(eq(chargeTypes.isActive, true)),
      () => tx.select({ code: currencies.code }).from(currencies),
    ])

    /*
      Keyed by the upper-cased key, because `lookup()` upper-cases what it is
      given before comparing — so the set it checks against and the map that
      resolves an id have to agree on case or every classified line silently
      becomes an unclassified one.

      The *prompt* is shown the real keys. `ocean_freight` is what an operator
      sees on the charge types screen, and asking a model to answer in a case
      the product never displays is asking it to guess at a convention.
    */
    const byKey = new Map(codes.map((row) => [row.key.toUpperCase(), row.id]))

    return {
      chargeTypeIds: byKey,
      chargeTypeKeys: codes.map((row) => row.key),
      lookups: {
        chargeTypes: new Set(byKey.keys()),
        currencies: new Set(money.map((row) => row.code.toUpperCase())),
      },
    }
  })
}

interface Reference {
  /** Upper-cased charge key to `charge_types.id`. */
  readonly chargeTypeIds: ReadonlyMap<string, string>
  /** The keys as an operator sees them, for the prompt. */
  readonly chargeTypeKeys: readonly string[]
  readonly lookups: ImportLookups
}

/**
 * The currency's minor units, which decide how the reconciliation rounds.
 *
 * From the seed table rather than a query, because `CurrencySpec` is core's
 * shape and the rounding rules live with it. A currency the seed does not know
 * returns undefined and the extraction is reported without a reconciliation
 * rather than reconciled at the wrong scale — comparing KWD at two decimals
 * would flag every invoice in the country.
 */
function specFor(code: string): CurrencySpec | undefined {
  return code ? seedCurrencyLookup(code) : undefined
}

function emptyExtraction(): ExtractedInvoice {
  return {
    header: { invoiceNumber: '', invoiceDate: '', currency: '' },
    lines: {
      ok: false,
      headers: [],
      mapping: {},
      rows: [],
      issues: [],
      totalRows: 0,
      missingRequired: [],
      ignoredColumns: [],
    },
    confidence: 0,
    headerIssues: [],
    headerIssueDetails: [],
  }
}

/**
 * The scan, as a content part.
 *
 * A PDF becomes a `document` part and an image an `image` part, because
 * providers carry the two differently. Anything else is refused rather than
 * relabelled: a `.docx` invoice exists and a model asked to read one as an
 * image returns something confident and wrong.
 */
export function documentPart(bytes: Buffer, contentType: string, fileName: string): ModelContent {
  const dataUri = `data:${contentType};base64,${bytes.toString('base64')}`

  if (contentType === 'application/pdf') {
    return { type: 'document', dataUri, filename: fileName }
  }
  if (contentType.startsWith('image/')) {
    return { type: 'image', dataUri }
  }

  throw new Error(`Cannot read ${contentType}: extraction takes a PDF or an image.`)
}
