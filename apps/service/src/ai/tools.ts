/**
 * What the assistant's tools actually do — one query each.
 *
 * `core/assistant.ts` declares the tools as data; this runs them. The split is
 * the usual one and it earns itself here: the declarations are what the model
 * sees and what a test can reason about with no database, and these are the
 * queries, which cannot be reasoned about without one.
 *
 * ## Every one of these runs inside the asker's own transaction
 *
 * Not `systemActor`, ever. `withActor` stamps the principal into
 * transaction-local settings and the RLS policies read them, so a Doha
 * coordinator asking which shipments are in clearance gets Doha's shipments
 * because the policy says so — not because the prompt was careful, and not
 * because a `branchId` parameter was passed correctly.
 *
 * That is also why no tool takes a branch. A tool that accepts one is a tool a
 * model can be argued into pointing somewhere else, and the argument would
 * arrive inside a customer's email.
 *
 * ## They return prose-shaped rows, not database rows
 *
 * Each query selects the handful of columns that answer the question and
 * renames them to what a person would call them. Two reasons, and the second
 * matters more: a model handed `superseded_by_id` and `fx_rate_at` spends
 * tokens on them and occasionally explains them to a coordinator, and every
 * column included is a column a summariser might repeat to somebody who should
 * not see it. The narrow projection is a second fence behind RLS.
 */

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  branches,
  chargeLines,
  creditStanding,
  customerBranchTerms,
  customers,
  customsStages,
  enquiries,
  exceptionCodes,
  exceptions,
  freeTimeClocks,
  inSeries,
  invoices,
  jobCargo,
  jobMilestones,
  equipment,
  jobs,
  locations,
  partners,
  quotes,
  supplierInvoiceLines,
  supplierInvoices,
  withActor,
  type Actor,
  type Tx,
} from '@qabandi/db'
import {
  ASSISTANT_LIMITS,
  MODE_FILTERS,
  NULLISH_WORDS,
  assessCredit,
  clusterShipments,
  emptyLedgerMargin,
  isNearLimit,
  jobMargin,
  modesFor,
  toScale,
  type GroupableShipment,
  type ModeFilter,
} from '@qabandi/core'
import { dayIn, shiftDay, todayIn } from '@qabandi/core'

const candidateOrigin = alias(locations, 'candidate_origin')
const candidateDestination = alias(locations, 'candidate_destination')

/** The arguments a model produced, already parsed from its JSON. */
export type ToolArgs = Record<string, unknown>

/**
 * Words a model writes when it means `null` — `NULLISH_WORDS` in core.
 *
 * Found in a live call, not imagined: asked which invoices were overdue,
 * `minimax/minimax-m3` correctly chose `list_overdue_invoices` and filled the
 * optional customer filter with the string `"None"`. Taken literally that is a
 * search for a customer called None, which matches nothing — so the assistant
 * would have reported *"no invoices are overdue"* with total confidence, on a
 * day when several were.
 *
 * That is the worst shape a bug can take here: not an error, not an empty
 * screen, but a plausible wrong answer to a question about money. A schema
 * cannot prevent it — the field is legitimately a string — so it is caught
 * where the string becomes a filter. The closed parameters (status, mode,
 * severity) are held to their enums earlier, by `normaliseToolArgs`, before a
 * call reaches this file.
 *
 * Case-insensitive, and it costs us nothing real: a customer named "none" or
 * "n/a" does not exist, and one that did would be findable by its code.
 */
const NULLISH = NULLISH_WORDS

/**
 * The three readers, bound to one call's arguments.
 *
 * Exported as a unit so the reading can be tested without a database — it is
 * the half of this file where a mistake is silent, and the queries below are
 * the half where a mistake is a type error.
 */
export function readFilters(args: ToolArgs) {
  return {
    text(key: string): string | undefined {
      const value = args[key]
      if (typeof value !== 'string') return undefined
      const trimmed = value.trim()
      if (trimmed === '' || NULLISH.has(trimmed.toLowerCase())) return undefined
      return trimmed
    },

    /** Clamped, never refused — see the note in the test. */
    count(key: string, fallback: number): number {
      const value = Number(args[key])
      if (args[key] === null || args[key] === undefined || !Number.isFinite(value)) return fallback
      return Math.min(ASSISTANT_LIMITS.maxRows, Math.max(1, Math.floor(value)))
    },

    /**
     * True only for a real boolean.
     *
     * A model that writes `"true"` has produced a string where the schema said
     * boolean, and coercing it would mean `"false"` is also true. Anything that
     * is not exactly `true` leaves the filter off, which is the safe direction:
     * an unfiltered list is over-inclusive, a wrongly filtered one is silently
     * wrong.
     */
    flag(key: string): boolean {
      return args[key] === true
    },
  }
}

const text = (args: ToolArgs, key: string): string | undefined => readFilters(args).text(key)
const count = (args: ToolArgs, key: string, fallback: number): number =>
  readFilters(args).count(key, fallback)
const flag = (args: ToolArgs, key: string): boolean => readFilters(args).flag(key)

/**
 * Run one tool.
 *
 * Returns whatever the tool found, as plain data. A tool that finds nothing
 * returns an empty array rather than throwing — "no shipments are in
 * clearance" is an answer, and a model handed an error instead reports that
 * something went wrong.
 */
export async function runTool(actor: Actor, name: string, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case 'search':
      return search(actor, args)
    case 'get_job':
      return getJob(actor, args)
    case 'list_jobs':
      return listJobs(actor, args)
    case 'list_enquiries':
      return listEnquiries(actor, args)
    case 'list_exceptions':
      return listExceptions(actor, args)
    case 'list_free_time':
      return listFreeTime(actor, args)
    case 'list_overdue_invoices':
      return listOverdueInvoices(actor, args)
    case 'get_invoice':
      return getInvoice(actor, args)
    case 'list_unbilled':
      return listUnbilled(actor, args)
    case 'list_quotes_expiring':
      return listQuotesExpiring(actor, args)
    case 'get_supplier_variance':
      return supplierVariance(actor, args)
    case 'get_margin':
      return margin(actor, args)
    case 'get_customer_credit':
      return customerCredit(actor, args)
    case 'list_consolidation_candidates':
      return consolidationCandidates(actor, args)
    default:
      throw new Error(`There is no tool called ${name}.`)
  }
}

/* -------------------------------------------------------------------------
 * search
 * ---------------------------------------------------------------------- */

/**
 * One query per record type, unioned in memory.
 *
 * A single SQL union across five tables with different shapes would need a
 * common projection none of them naturally has, and would be re-planned every
 * time one of them gains a column. Five small indexed lookups against a
 * forwarder's volumes is microseconds, and each one stays readable.
 *
 * `ilike` rather than full-text: the things people search for here are
 * references, container numbers and company names — none of which stem or
 * tokenise usefully, and all of which are typed as prefixes.
 */
async function search(actor: Actor, args: ToolArgs): Promise<unknown> {
  const query = text(args, 'query')
  if (!query) return []
  const limit = count(args, 'limit', 10)
  const like = `%${query}%`

  return withActor(actor, async (tx: Tx) => {
    const [jobRows, enquiryRows, customerRows, invoiceRows, containerRows] = await inSeries([
      () =>
        tx
          .select({ reference: jobs.reference, status: jobs.status, mode: jobs.mode })
          .from(jobs)
          .where(ilike(jobs.reference, like))
          .limit(limit),
      () =>
        tx
          .select({ reference: enquiries.reference, status: enquiries.status })
          .from(enquiries)
          .where(or(ilike(enquiries.reference, like), ilike(enquiries.contactEmail, like)))
          .limit(limit),
      () =>
        tx
          .select({ code: customers.code, name: customers.legalNameEn })
          .from(customers)
          .where(or(ilike(customers.code, like), ilike(customers.legalNameEn, like)))
          .limit(limit),
      () =>
        tx
          .select({ number: invoices.seriesNo, status: invoices.status, total: invoices.total })
          .from(invoices)
          .where(ilike(invoices.seriesNo, like))
          .limit(limit),
      /*
        Containers hang off `equipment`, not `job_cargo`.

        `job_cargo` is what is *in* the box — packages, description, HS code —
        and `equipment` is the box. Searching the wrong one finds nothing and
        looks exactly like a container we are not handling.
      */
      () =>
        tx
          .select({ container: equipment.containerNo, reference: jobs.reference })
          .from(equipment)
          .innerJoin(jobs, eq(jobs.id, equipment.jobId))
          .where(ilike(equipment.containerNo, like))
          .limit(limit),
    ])

    return {
      shipments: jobRows,
      enquiries: enquiryRows,
      customers: customerRows,
      invoices: invoiceRows,
      containers: containerRows,
    }
  })
}

/* -------------------------------------------------------------------------
 * one shipment, in full
 * ---------------------------------------------------------------------- */

async function getJob(actor: Actor, args: ToolArgs): Promise<unknown> {
  const reference = text(args, 'reference')
  if (!reference) return { found: false }

  return withActor(actor, async (tx: Tx) => {
    const [job] = await tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        status: jobs.status,
        mode: jobs.mode,
        tradeDirection: jobs.tradeDirection,
        etd: jobs.etd,
        eta: jobs.eta,
        customer: customers.legalNameEn,
      })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .where(eq(jobs.reference, reference))
      .limit(1)

    /*
      Not found and not permitted are the same answer here, deliberately.

      RLS returns no row for a shipment in another branch, and distinguishing
      "there is no such job" from "there is one you may not see" would leak the
      existence of every reference in the fleet to anyone who can guess the
      numbering — which is sequential and printed on every document.
    */
    if (!job) return { found: false, reference }

    const [milestones, cargo, containers, openExceptions, customs, charges] = await inSeries([
      () =>
        tx
          .select({
            code: jobMilestones.code,
            name: jobMilestones.nameEn,
            plannedAt: jobMilestones.plannedAt,
            actualAt: jobMilestones.actualAt,
          })
          .from(jobMilestones)
          .where(eq(jobMilestones.jobId, job.id))
          .orderBy(jobMilestones.seq)
          .limit(ASSISTANT_LIMITS.maxRows),
      () =>
        tx
          .select({
            description: jobCargo.descriptionEn,
            packages: jobCargo.packageCount,
            packageType: jobCargo.packageType,
            grossWeightKg: jobCargo.grossWeightKg,
            volumeCbm: jobCargo.volumeCbm,
            hsCode: jobCargo.hsCode,
          })
          .from(jobCargo)
          .where(eq(jobCargo.jobId, job.id))
          .limit(ASSISTANT_LIMITS.maxRows),
      () =>
        tx
          .select({
            container: equipment.containerNo,
            containerType: equipment.containerType,
            sealNo: equipment.sealNo,
            grossWeightKg: equipment.grossWeightKg,
          })
          .from(equipment)
          .where(eq(equipment.jobId, job.id))
          .limit(ASSISTANT_LIMITS.maxRows),
      () =>
        tx
          .select({
            code: exceptionCodes.code,
            severity: exceptions.severity,
            openedAt: exceptions.openedAt,
            dueAt: exceptions.dueAt,
            description: exceptions.description,
          })
          .from(exceptions)
          .innerJoin(exceptionCodes, eq(exceptionCodes.id, exceptions.exceptionCodeId))
          .where(and(eq(exceptions.jobId, job.id), isNull(exceptions.closedAt)))
          .limit(ASSISTANT_LIMITS.maxRows),
      () =>
        tx
          .select({
            status: customsStages.status,
            declarationNo: customsStages.declarationNo,
            dutyAmount: customsStages.dutyAmount,
            dutyCurrency: customsStages.dutyCurrency,
          })
          .from(customsStages)
          .where(eq(customsStages.jobId, job.id))
          .limit(5),
      () =>
        tx
          .select({
            description: chargeLines.description,
            direction: chargeLines.direction,
            amount: chargeLines.amount,
            currency: chargeLines.currency,
          })
          .from(chargeLines)
          .where(eq(chargeLines.jobId, job.id))
          .limit(ASSISTANT_LIMITS.maxRows),
    ])

    return {
      found: true,
      shipment: { ...job, id: undefined },
      milestones,
      cargo,
      containers,
      openExceptions,
      customs,
      charges,
    }
  })
}

/* -------------------------------------------------------------------------
 * the lists
 * ---------------------------------------------------------------------- */

/**
 * How many rows matched, carried beside the rows shown (ai-15).
 *
 * Asked how many enquiries were open, the assistant counted the rows a list
 * returned and said 12 when the board said 13 — the list was capped, or the
 * model miscounted, and either way the person was given a number nobody had
 * computed. Every list now returns `total`, from `count(*) over ()` in the same
 * statement (so the count and the rows cannot disagree about the filter), and
 * the prompt tells the model to report counts from it.
 *
 * `_matches` rather than `total` on the row because two of these lists already
 * carry a money column called `total`.
 */
const MATCHES = sql<number>`(count(*) over ())::int`

export interface Counted<T> {
  /** Every row that matched, not only those shown. */
  readonly total: number
  readonly shown: number
  readonly rows: T[]
}

export function counted<T extends { _matches: number }>(rows: T[]): Counted<Omit<T, '_matches'>> {
  return {
    total: rows[0]?._matches ?? 0,
    shown: rows.length,
    rows: rows.map(({ _matches: _, ...row }) => row),
  }
}

async function listJobs(actor: Actor, args: ToolArgs): Promise<unknown> {
  const status = text(args, 'status')
  const mode = text(args, 'mode')
  const direction = text(args, 'direction')
  const limit = count(args, 'limit', 20)
  const within =
    args.arrivingWithinDays === null || args.arrivingWithinDays === undefined
      ? undefined
      : Number(args.arrivingWithinDays)
  const arriving = within !== undefined && Number.isFinite(within)

  return withActor(actor, async (tx: Tx) => {
    const now = new Date()
    const horizon = new Date(now.getTime() + Math.max(0, Math.min(60, within ?? 0)) * 86_400_000)

    const filters = [
      status ? eq(sql`${jobs.status}::text`, status) : undefined,
      /*
        A family, not an equality (ai-1). The column holds `sea_fcl` and
        `sea_lcl`; "sea" compared exactly matched neither and answered "no sea
        shipments" on a board full of them. `modesFor` expands the family, and
        an unknown mode never gets this far — `normaliseToolArgs` refused it.
      */
      mode && (MODE_FILTERS as readonly string[]).includes(mode)
        ? inArray(jobs.mode, modesFor(mode as ModeFilter))
        : undefined,
      direction ? eq(sql`${jobs.tradeDirection}::text`, direction) : undefined,
      /*
        "Arriving" is an ETA ahead of us on a shipment that has not arrived:
        no actual arrival recorded, and not cancelled. Without this the
        description promised "what is arriving this week" and the tool could
        only list the newest shipments, leaving the model to guess from ETAs
        it was shown twenty of.
      */
      arriving ? gte(jobs.eta, now) : undefined,
      arriving ? lte(jobs.eta, horizon) : undefined,
      arriving ? isNull(jobs.ata) : undefined,
      arriving ? ne(jobs.status, 'cancelled') : undefined,
    ].filter(Boolean)

    const rows = await tx
      .select({
        reference: jobs.reference,
        status: jobs.status,
        mode: jobs.mode,
        direction: jobs.tradeDirection,
        etd: jobs.etd,
        eta: jobs.eta,
        customer: customers.legalNameEn,
        _matches: MATCHES,
      })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(arriving ? asc(jobs.eta) : desc(jobs.createdAt))
      .limit(limit)

    return counted(rows)
  })
}

/**
 * The enquiry board, with the clock.
 *
 * `slaDueAt` is on the row already — `inbound-mail.ts` stamps it against the
 * branch's working calendar when the enquiry is created — so "overdue" is a
 * comparison rather than a calculation, and the assistant cannot disagree with
 * the board about who is late.
 */
async function listEnquiries(actor: Actor, args: ToolArgs): Promise<unknown> {
  const status = text(args, 'status')
  const limit = count(args, 'limit', 20)
  const overdueOnly = flag(args, 'overdueOnly')

  return withActor(actor, async (tx: Tx) => {
    const filters = [
      status ? eq(sql`${enquiries.status}::text`, status) : undefined,
      overdueOnly ? lte(enquiries.slaDueAt, new Date()) : undefined,
      overdueOnly ? isNull(enquiries.firstRespondedAt) : undefined,
      isNull(enquiries.closedAt),
    ].filter(Boolean)

    const rows = await tx
      .select({
        reference: enquiries.reference,
        status: enquiries.status,
        customer: customers.legalNameEn,
        contactEmail: enquiries.contactEmail,
        slaDueAt: enquiries.slaDueAt,
        firstRespondedAt: enquiries.firstRespondedAt,
        notes: enquiries.notes,
        _matches: MATCHES,
      })
      .from(enquiries)
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .where(and(...filters))
      .orderBy(enquiries.slaDueAt)
      .limit(limit)

    return counted(rows)
  })
}

async function listExceptions(actor: Actor, args: ToolArgs): Promise<unknown> {
  const severity = text(args, 'severity')
  const limit = count(args, 'limit', 20)

  return withActor(actor, async (tx: Tx) => {
    const filters = [
      isNull(exceptions.closedAt),
      severity ? eq(sql`${exceptions.severity}::text`, severity) : undefined,
    ].filter(Boolean)

    const rows = await tx
      .select({
        shipment: jobs.reference,
        code: exceptionCodes.code,
        severity: exceptions.severity,
        openedAt: exceptions.openedAt,
        dueAt: exceptions.dueAt,
        description: exceptions.description,
        _matches: MATCHES,
      })
      .from(exceptions)
      .innerJoin(jobs, eq(jobs.id, exceptions.jobId))
      .innerJoin(exceptionCodes, eq(exceptionCodes.id, exceptions.exceptionCodeId))
      .where(and(...filters))
      .orderBy(exceptions.dueAt, exceptions.openedAt)
      .limit(limit)

    return counted(rows)
  })
}

/**
 * Free time running out — the question that costs money to answer late.
 *
 * Ordered by when the clock stops rather than by when it started, because the
 * useful answer is *what will be charged next*, not what has been sitting
 * longest. A container that went on demurrage yesterday is already a cost; one
 * that goes tomorrow is still a decision.
 */
async function listFreeTime(actor: Actor, args: ToolArgs): Promise<unknown> {
  const limit = count(args, 'limit', 20)
  const withinDays = Number.isFinite(Number(args.withinDays)) ? Number(args.withinDays) : 7

  return withActor(actor, async (tx: Tx) => {
    const horizon = shiftDay(todayIn(), Math.max(0, Math.min(60, withinDays)))
    /*
      The last free day, which is what "running out" means (O20).

      This filtered and sorted on `ends_on` — the day the box came back — so it
      matched only clocks that had already stopped, and with nothing setting
      that column it answered every question with nothing. The free time ends
      `free_days - 1` after the start (the start day is day one). Counted in
      calendar days; on a working-day clock that names a day at or before the
      real one, which errs towards warning early.
    */
    const freeUntil = sql<string>`(${freeTimeClocks.startsOn} + greatest(${freeTimeClocks.freeDays} - 1, 0))`

    const rows = await tx
      .select({
        shipment: jobs.reference,
        container: equipment.containerNo,
        kind: freeTimeClocks.kind,
        startsOn: freeTimeClocks.startsOn,
        freeUntil: sql<string>`${freeUntil}::text`,
        accruedDays: freeTimeClocks.accruedDays,
        accruedAmount: freeTimeClocks.accruedAmount,
        currency: freeTimeClocks.currency,
        _matches: MATCHES,
      })
      .from(freeTimeClocks)
      .innerJoin(jobs, eq(jobs.id, freeTimeClocks.jobId))
      .leftJoin(equipment, eq(equipment.id, freeTimeClocks.equipmentId))
      /*
          Only clocks still running: no end date, and the box not back. Both,
          because an operator records either — the clock's own end date, or
          the container's empty return.
        */
      .where(
        and(
          isNull(freeTimeClocks.endsOn),
          isNull(equipment.emptyReturnedAt),
          sql`${freeUntil} <= ${horizon}::date`,
        ),
      )
      .orderBy(freeUntil)
      .limit(limit)

    return { ...counted(rows), withinDays, horizon }
  })
}

/** What is still owed on an invoice: total less receipts less credit notes (F9). */
const BALANCE = sql`(${invoices.total} - ${invoices.amountPaid} - ${invoices.amountCredited})`

async function listOverdueInvoices(actor: Actor, args: ToolArgs): Promise<unknown> {
  const customer = text(args, 'customer')
  const limit = count(args, 'limit', 20)
  const today = todayIn()

  return withActor(actor, async (tx: Tx) => {
    const filters = and(
      ...[
        lte(invoices.dueOn, today),
        sql`${invoices.status}::text in ('issued', 'part_paid')`,
        customer
          ? or(
              ilike(customers.legalNameEn, `%${customer}%`),
              ilike(customers.code, `%${customer}%`),
            )
          : undefined,
      ].filter(Boolean),
    )

    const [rows, sums] = await inSeries([
      () =>
        tx
          .select({
            number: invoices.seriesNo,
            customer: customers.legalNameEn,
            currency: invoices.currency,
            total: invoices.total,
            amountPaid: invoices.amountPaid,
            // Named apart from receipts so an answer can say which (F9).
            amountCredited: invoices.amountCredited,
            // What is owed — the definition `settled.ts` keeps — computed here
            // in numeric rather than left for a model to subtract.
            balance: sql<string>`(${BALANCE})::text`,
            dueOn: invoices.dueOn,
            daysOverdue: sql<number>`(current_date - ${invoices.dueOn})::int`,
            _matches: MATCHES,
          })
          .from(invoices)
          .innerJoin(customers, eq(customers.id, invoices.customerId))
          .where(filters)
          .orderBy(invoices.dueOn)
          .limit(limit),
      /*
        The sum across every match, per currency — never across currencies,
        which is rule 4 of the prompt and would be wrong in any case. A model
        asked "how much is overdue" otherwise adds up the rows it was shown.
      */
      () =>
        tx
          .select({
            currency: invoices.currency,
            invoices: sql<number>`count(*)::int`,
            outstanding: sql<string>`sum(${BALANCE})::text`,
          })
          .from(invoices)
          .innerJoin(customers, eq(customers.id, invoices.customerId))
          .where(filters)
          .groupBy(invoices.currency)
          .orderBy(invoices.currency),
    ])

    return { ...counted(rows), outstandingByCurrency: sums }
  })
}

/**
 * One invoice, with its balance (ai-15).
 *
 * Asked for the balance on a named invoice, the assistant had only the overdue
 * list — which an invoice not yet due is not on — and answered from nothing.
 * Exact number first; failing that a fragment, but only when it names one
 * invoice, because "INV-2026" matches a year of them and picking the first
 * would be answering about the wrong one with confidence.
 */
async function getInvoice(actor: Actor, args: ToolArgs): Promise<unknown> {
  const number = text(args, 'number')
  if (!number) return { found: false }

  return withActor(actor, async (tx: Tx) => {
    const select = () =>
      tx
        .select({
          number: invoices.seriesNo,
          customer: customers.legalNameEn,
          status: invoices.status,
          isCreditNote: invoices.isCreditNote,
          currency: invoices.currency,
          subtotal: invoices.subtotal,
          tax: invoices.taxAmount,
          total: invoices.total,
          amountPaid: invoices.amountPaid,
          amountCredited: invoices.amountCredited,
          balance: sql<string>`(${BALANCE})::text`,
          issuedAt: invoices.issuedAt,
          dueOn: invoices.dueOn,
          daysOverdue: sql<
            number | null
          >`case when ${invoices.dueOn} < current_date and ${invoices.status}::text in ('issued', 'part_paid') then (current_date - ${invoices.dueOn})::int end`,
          shipments: sql<
            string[]
          >`coalesce((select array_agg(distinct j.reference) from charge_lines cl join jobs j on j.id = cl.job_id where cl.invoice_id = ${invoices.id}), '{}')`,
        })
        .from(invoices)
        .innerJoin(customers, eq(customers.id, invoices.customerId))

    const [exact] = await select().where(ilike(invoices.seriesNo, number)).limit(1)
    if (exact) return { found: true, invoice: exact }

    const partial = await select()
      .where(ilike(invoices.seriesNo, `%${number}%`))
      .limit(6)
    if (partial.length === 1) return { found: true, invoice: partial[0] }
    if (partial.length > 1) {
      return {
        found: false,
        ambiguous: true,
        candidates: partial.map((row) => row.number),
        note: 'Several invoices match; ask which one, or call again with the full number.',
      }
    }
    // As everywhere: not found and not permitted are one answer (see getJob).
    return { found: false, number }
  })
}

/**
 * Revenue earned and never invoiced — the quietest leak.
 *
 * The same shape and the same filter as `/finance`'s unbilled register
 * (`features/ledger/unbilled.ts`): revenue lines with no `invoice_id` that are
 * not accruals, grouped per shipment and ranked by base-currency amount. Read
 * against the same definition so the assistant never disagrees with the screen
 * about what is unbilled — a second definition here is a second answer to
 * "what have we not billed", and money questions cannot have two.
 */
async function listUnbilled(actor: Actor, args: ToolArgs): Promise<unknown> {
  const limit = count(args, 'limit', 20)

  return withActor(actor, async (tx: Tx) => {
    const rows = await tx
      .select({
        shipment: jobs.reference,
        status: jobs.status,
        customer: customers.legalNameEn,
        lines: sql<number>`count(*)::int`,
        amountBase: sql<string>`sum(${chargeLines.amountBase})::text`,
        baseCurrency: sql<string>`min(${chargeLines.baseCurrency})`,
        /*
          More than one currency on a shipment means it cannot become a single
          invoice — the register surfaces that rather than letting somebody find
          it at the click, and the assistant should be able to say so too.
        */
        currencies: sql<string[]>`array_agg(distinct ${chargeLines.currency})`,
        // Over the grouped rows: how many shipments carry unbilled revenue.
        _matches: MATCHES,
      })
      .from(chargeLines)
      .innerJoin(jobs, eq(jobs.id, chargeLines.jobId))
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .where(
        and(
          eq(chargeLines.direction, 'revenue'),
          isNull(chargeLines.invoiceId),
          // An accrual is our own estimate of a cost still to come; it has no
          // business on a customer invoice.
          eq(chargeLines.isAccrual, false),
        ),
      )
      .groupBy(jobs.id, jobs.reference, jobs.status, customers.legalNameEn)
      .orderBy(desc(sql`sum(${chargeLines.amountBase})`))
      .limit(limit)

    return counted(rows)
  })
}

/**
 * Sent quotations about to lapse — the follow-up a busy desk forgets.
 *
 * The same window as the `quote.expiring` reminder worker: `sent` only, a
 * validity still in the future, within the horizon. `sent` because a draft was
 * never offered and an accepted, rejected or superseded quote has had its
 * answer. The default seven days is wider than the worker's three so the
 * assistant can answer "what is coming up this week", not only "what fires
 * tonight".
 */
async function listQuotesExpiring(actor: Actor, args: ToolArgs): Promise<unknown> {
  const limit = count(args, 'limit', 20)
  const withinDays = Number.isFinite(Number(args.withinDays)) ? Number(args.withinDays) : 7
  const today = todayIn()
  const horizon = new Date()
  horizon.setUTCDate(horizon.getUTCDate() + Math.max(0, Math.min(60, withinDays)))

  return withActor(actor, async (tx: Tx) => {
    const rows = await tx
      .select({
        reference: quotes.reference,
        status: quotes.status,
        customer: customers.legalNameEn,
        validUntil: quotes.validUntil,
        total: quotes.totalSell,
        currency: quotes.currency,
        _matches: MATCHES,
      })
      .from(quotes)
      .innerJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .where(
        and(
          eq(quotes.status, 'sent'),
          isNotNull(quotes.validUntil),
          lte(quotes.validUntil, dayIn(horizon)),
          // Not already lapsed — an expired quote needs a conversation, not a
          // countdown, exactly as the reminder worker draws the line.
          gt(quotes.validUntil, today),
        ),
      )
      .orderBy(quotes.validUntil)
      .limit(limit)

    return counted(rows)
  })
}

/**
 * What a supplier billed, against what the job accrued.
 *
 * The figures only — the *verdict* is `core/matching.ts`'s and it has a
 * tolerance per charge type that lives in rows. Recomputing "is this
 * acceptable" here would put a second opinion beside the tested one, and the
 * two would disagree the first time somebody edited a tolerance.
 */
async function supplierVariance(actor: Actor, args: ToolArgs): Promise<unknown> {
  const reference = text(args, 'reference')
  if (!reference) return { found: false }

  return withActor(actor, async (tx: Tx) => {
    const [job] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.reference, reference))
      .limit(1)

    if (!job) return { found: false, reference }

    const [billed, accrued] = await inSeries([
      () =>
        tx
          .select({
            supplier: partners.legalNameEn,
            invoice: supplierInvoices.reference,
            description: supplierInvoiceLines.description,
            amount: supplierInvoiceLines.amount,
            currency: supplierInvoices.currency,
            status: supplierInvoices.status,
          })
          .from(supplierInvoiceLines)
          .innerJoin(
            supplierInvoices,
            eq(supplierInvoices.id, supplierInvoiceLines.supplierInvoiceId),
          )
          .innerJoin(partners, eq(partners.id, supplierInvoices.partnerId))
          .where(eq(supplierInvoiceLines.jobId, job.id))
          .limit(ASSISTANT_LIMITS.maxRows),
      () =>
        tx
          .select({
            description: chargeLines.description,
            amount: chargeLines.amount,
            currency: chargeLines.currency,
          })
          .from(chargeLines)
          .where(and(eq(chargeLines.jobId, job.id), eq(chargeLines.direction, 'cost')))
          .limit(ASSISTANT_LIMITS.maxRows),
    ])

    return { found: true, reference, billed, accrued }
  })
}

/**
 * The P&L on one shipment — revenue, cost and gross, in base currency.
 *
 * `core/margin.ts`'s `jobMargin` is the one definition of the number, the same
 * one the costing card computes; recomputing it here would be a second opinion
 * on the figure a commercial conversation turns on. Every amount is already in
 * the branch base currency (`amount_base`, fixed at the rate it was taken at),
 * so there is nothing to convert and no rate to invent.
 */
async function margin(actor: Actor, args: ToolArgs): Promise<unknown> {
  const reference = text(args, 'reference')
  if (!reference) return { found: false }

  return withActor(actor, async (tx: Tx) => {
    const [job] = await tx
      .select({ id: jobs.id, baseCurrency: branches.baseCurrency })
      .from(jobs)
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      .where(eq(jobs.reference, reference))
      .limit(1)

    // Not found and not permitted are one answer here, as everywhere — see
    // `getJob`. RLS returns no row for another branch's shipment.
    if (!job) return { found: false, reference }

    const lines = await tx
      .select({
        direction: chargeLines.direction,
        amountBase: chargeLines.amountBase,
        isAccrual: chargeLines.isAccrual,
      })
      .from(chargeLines)
      .where(eq(chargeLines.jobId, job.id))

    const result =
      lines.length === 0 ? emptyLedgerMargin(job.baseCurrency) : jobMargin(lines, job.baseCurrency)

    return {
      found: true,
      reference,
      currency: job.baseCurrency,
      revenue: toScale(result.revenue),
      cost: toScale(result.cost),
      gross: toScale(result.gross),
      grossPercent: result.grossPercent ? result.grossPercent.toFixed(1) : null,
      // How much of the cost is still an estimate rather than a supplier's bill.
      accruedCost: toScale(result.accruedCost),
      billedCost: toScale(result.billedCost),
    }
  })
}

/**
 * A customer's credit standing, at every branch the asker can see.
 *
 * Per branch and not one figure, because a credit limit is agreed per legal
 * entity — a customer can be inside their limit in Kuwait and on hold in Dubai.
 * The tool takes no branch (RLS decides what is visible), so it reads the
 * customer's `customer_branch_terms` rows, which the policy has already narrowed
 * to the branches this principal may see, and answers for each.
 *
 * The position and the decision both come from the shared engine —
 * `creditStanding` in `@qabandi/db`, `assessCredit` in `core` — the same pair
 * the customer screen uses, so the assistant cannot give a different answer
 * about whether a customer may book. One transaction resolves the customer and
 * lists the branches; `creditStanding` opens its own per branch, which is a
 * handful of reads on a question asked rarely.
 */
async function customerCredit(actor: Actor, args: ToolArgs): Promise<unknown> {
  const query = text(args, 'customer')
  if (!query) return { found: false }

  const resolved = await withActor(actor, async (tx: Tx) => {
    const [customer] = await tx
      .select({ id: customers.id, name: customers.legalNameEn })
      .from(customers)
      .where(or(ilike(customers.code, query), ilike(customers.legalNameEn, `%${query}%`)))
      // Prefer an exact code match over a name that merely contains the text.
      .orderBy(sql`case when lower(${customers.code}) = lower(${query}) then 0 else 1 end`)
      .limit(1)

    if (!customer) return null

    // The branches this customer trades at — RLS has already dropped any the
    // asker may not see, which is exactly the "each branch you can see" scope.
    const terms = await tx
      .select({ branchId: customerBranchTerms.branchId, branch: branches.legalNameEn })
      .from(customerBranchTerms)
      .innerJoin(branches, eq(branches.id, customerBranchTerms.branchId))
      .where(eq(customerBranchTerms.customerId, customer.id))
      .orderBy(branches.legalNameEn)

    return { customer, terms }
  })

  if (!resolved) return { found: false, customer: query }

  const branchStandings = []
  for (const term of resolved.terms) {
    const standing = await creditStanding(actor, resolved.customer.id, term.branchId)
    const assessment = assessCredit(standing)
    branchStandings.push({
      branch: term.branch,
      currency: standing.currency,
      outstanding: toScale(standing.outstanding),
      limit: standing.limit ? toScale(standing.limit) : null,
      headroom: assessment.headroom ? toScale(assessment.headroom) : null,
      outcome: assessment.outcome,
      blocked: assessment.blocked,
      nearLimit: isNearLimit(assessment),
      onHold: standing.onHold,
      // Non-empty means the figure above is a floor: a foreign invoice could
      // not be converted, so the real exposure is at least this.
      unconvertible: standing.unconvertible,
    })
  }

  return { found: true, customer: resolved.customer.name, branches: branchStandings }
}

/**
 * Loose shipments that should have shared a container.
 *
 * The same query and the same engine as `/consolidations`'s candidates screen
 * (`features/consolidation/candidates.ts` → `core/grouping.ts`): the filters
 * are each a reason a shipment *cannot* be grouped — already consolidated,
 * closed, cancelled, a full container, or a mode not bought by the box — and
 * `clusterShipments` does the grouping in memory, deterministically. Read
 * through the shared engine so the assistant's suggestion is the same one the
 * screen would make.
 */
async function consolidationCandidates(actor: Actor, args: ToolArgs): Promise<unknown> {
  const limit = count(args, 'limit', 20)

  const rows = await withActor(actor, (tx: Tx) =>
    tx
      .select({
        jobId: jobs.id,
        reference: jobs.reference,
        branchId: jobs.branchId,
        customerId: jobs.customerId,
        customerName: customers.legalNameEn,
        mode: jobs.mode,
        originId: jobs.originId,
        destinationId: jobs.destinationId,
        originName: candidateOrigin.nameEn,
        destinationName: candidateDestination.nameEn,
        readyOn: jobs.etd,
        volumeCbm: jobs.volumeCbm,
        grossWeightKg: jobs.grossWeightKg,
        pieces: jobs.pieces,
      })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(candidateOrigin, eq(candidateOrigin.id, jobs.originId))
      .leftJoin(candidateDestination, eq(candidateDestination.id, jobs.destinationId))
      .where(
        and(
          isNull(jobs.consolidationId),
          isNull(jobs.closedAt),
          isNull(jobs.cancelledAt),
          // Only the two modes bought wholesale and sold retail; a full
          // container is already the whole box, land and courier are not
          // bought by the container.
          or(eq(jobs.mode, 'sea_lcl'), eq(jobs.mode, 'air')),
          ne(jobs.status, 'cancelled'),
          // Something to measure, or a shipment sits in a cluster making it
          // look emptier than it is.
          sql`(${jobs.volumeCbm} is not null or ${jobs.grossWeightKg} is not null)`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(400),
  )

  const shipments: GroupableShipment[] = rows.map((row) => ({
    jobId: row.jobId,
    reference: row.reference,
    branchId: row.branchId,
    customerId: row.customerId,
    customerName: row.customerName,
    mode: row.mode,
    originId: row.originId,
    destinationId: row.destinationId,
    originName: row.originName,
    destinationName: row.destinationName,
    readyOn: row.readyOn ? new Date(row.readyOn) : null,
    volumeCbm: numericOrNull(row.volumeCbm),
    grossWeightKg: numericOrNull(row.grossWeightKg),
    pieces: row.pieces,
  }))

  return clusterShipments(shipments)
    .slice(0, limit)
    .map((cluster) => ({
      lane: `${cluster.originName ?? '—'} → ${cluster.destinationName ?? '—'}`,
      mode: cluster.mode,
      shipments: cluster.shipments.length,
      customers: cluster.customerCount,
      totalCbm: cluster.totalCbm,
      totalKg: cluster.totalKg,
      wouldFill: cluster.fit
        ? `${cluster.fit.code} at ${cluster.fit.volumePercent}% volume / ${cluster.fit.weightPercent}% weight, limited by ${cluster.fit.limitedBy}`
        : null,
      references: cluster.shipments.map((shipment) => shipment.reference),
    }))
}

/** `numeric` as text to a number the grouping engine can add, or null. */
function numericOrNull(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The record a proposal is about, and what it could legally become.
 *
 * Separate from the tools because it runs *after* the model has proposed
 * something rather than because the model asked: the loop needs the record's
 * current state to hand `proposeTransition`, and asking the model what state
 * it thought the record was in would be trusting the thing being checked.
 */
export async function currentState(
  actor: Actor,
  entity: string,
  reference: string,
): Promise<{ id: string; state: string } | undefined> {
  const table = {
    job: { rows: jobs, ref: jobs.reference, id: jobs.id, state: jobs.status },
    enquiry: {
      rows: enquiries,
      ref: enquiries.reference,
      id: enquiries.id,
      state: enquiries.status,
    },
    quote: { rows: quotes, ref: quotes.reference, id: quotes.id, state: quotes.status },
    invoice: { rows: invoices, ref: invoices.seriesNo, id: invoices.id, state: invoices.status },
  }[entity]

  if (!table) return undefined

  const [row] = await withActor(actor, (tx: Tx) =>
    tx
      .select({ id: table.id, state: sql<string>`${table.state}::text` })
      .from(table.rows)
      .where(eq(table.ref, reference))
      .limit(1),
  )

  return row
}

/**
 * Customs hangs off a job rather than carrying its own reference.
 *
 * `id` is the *job's*, not the stage's, and that is deliberate: there is no
 * customs detail screen — `/customs` is a register — so the only place a
 * coordinator can act on a clearance is the shipment it belongs to. Returning
 * the stage id would produce a link to a page that does not exist.
 */
export async function currentCustomsState(
  actor: Actor,
  reference: string,
): Promise<{ id: string; state: string } | undefined> {
  const [row] = await withActor(actor, (tx: Tx) =>
    tx
      .select({ id: jobs.id, state: sql<string>`${customsStages.status}::text` })
      .from(customsStages)
      .innerJoin(jobs, eq(jobs.id, customsStages.jobId))
      .where(eq(jobs.reference, reference))
      .orderBy(desc(customsStages.createdAt))
      .limit(1),
  )

  return row
}
