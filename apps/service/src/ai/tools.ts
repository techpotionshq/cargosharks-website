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

import { and, desc, eq, ilike, isNull, lte, or, sql } from 'drizzle-orm'
import {
  chargeLines,
  customers,
  customsStages,
  enquiries,
  exceptionCodes,
  exceptions,
  freeTimeClocks,
  invoices,
  jobCargo,
  jobMilestones,
  equipment,
  jobs,
  partners,
  quotes,
  supplierInvoiceLines,
  supplierInvoices,
  withActor,
  type Actor,
  type Tx,
} from '@qabandi/db'
import { ASSISTANT_LIMITS } from '@qabandi/core'

/** The arguments a model produced, already parsed from its JSON. */
export type ToolArgs = Record<string, unknown>

/**
 * Words a model writes when it means `null`.
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
 * where the string becomes a filter.
 *
 * Case-insensitive, and it costs us nothing real: a customer named "none" or
 * "n/a" does not exist, and one that did would be findable by its code.
 */
const NULLISH = new Set(['none', 'null', 'nil', 'undefined', 'n/a', 'na', 'any', 'all', '-'])

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
    case 'get_supplier_variance':
      return supplierVariance(actor, args)
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
    const [jobRows, enquiryRows, customerRows, invoiceRows, containerRows] = await Promise.all([
      tx
        .select({ reference: jobs.reference, status: jobs.status, mode: jobs.mode })
        .from(jobs)
        .where(ilike(jobs.reference, like))
        .limit(limit),
      tx
        .select({ reference: enquiries.reference, status: enquiries.status })
        .from(enquiries)
        .where(or(ilike(enquiries.reference, like), ilike(enquiries.contactEmail, like)))
        .limit(limit),
      tx
        .select({ code: customers.code, name: customers.legalNameEn })
        .from(customers)
        .where(or(ilike(customers.code, like), ilike(customers.legalNameEn, like)))
        .limit(limit),
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

    const [milestones, cargo, containers, openExceptions, customs, charges] = await Promise.all([
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

async function listJobs(actor: Actor, args: ToolArgs): Promise<unknown> {
  const status = text(args, 'status')
  const mode = text(args, 'mode')
  const limit = count(args, 'limit', 20)

  return withActor(actor, (tx: Tx) => {
    const filters = [
      status ? eq(sql`${jobs.status}::text`, status) : undefined,
      mode ? eq(sql`${jobs.mode}::text`, mode) : undefined,
    ].filter(Boolean)

    return tx
      .select({
        reference: jobs.reference,
        status: jobs.status,
        mode: jobs.mode,
        eta: jobs.eta,
        customer: customers.legalNameEn,
      })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(jobs.createdAt))
      .limit(limit)
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

  return withActor(actor, (tx: Tx) => {
    const filters = [
      status ? eq(sql`${enquiries.status}::text`, status) : undefined,
      overdueOnly ? lte(enquiries.slaDueAt, new Date()) : undefined,
      overdueOnly ? isNull(enquiries.firstRespondedAt) : undefined,
      isNull(enquiries.closedAt),
    ].filter(Boolean)

    return tx
      .select({
        reference: enquiries.reference,
        status: enquiries.status,
        customer: customers.legalNameEn,
        contactEmail: enquiries.contactEmail,
        slaDueAt: enquiries.slaDueAt,
        firstRespondedAt: enquiries.firstRespondedAt,
        notes: enquiries.notes,
      })
      .from(enquiries)
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .where(and(...filters))
      .orderBy(enquiries.slaDueAt)
      .limit(limit)
  })
}

async function listExceptions(actor: Actor, args: ToolArgs): Promise<unknown> {
  const severity = text(args, 'severity')
  const limit = count(args, 'limit', 20)

  return withActor(actor, (tx: Tx) => {
    const filters = [
      isNull(exceptions.closedAt),
      severity ? eq(sql`${exceptions.severity}::text`, severity) : undefined,
    ].filter(Boolean)

    return tx
      .select({
        shipment: jobs.reference,
        code: exceptionCodes.code,
        severity: exceptions.severity,
        openedAt: exceptions.openedAt,
        dueAt: exceptions.dueAt,
        description: exceptions.description,
      })
      .from(exceptions)
      .innerJoin(jobs, eq(jobs.id, exceptions.jobId))
      .innerJoin(exceptionCodes, eq(exceptionCodes.id, exceptions.exceptionCodeId))
      .where(and(...filters))
      .orderBy(exceptions.dueAt, exceptions.openedAt)
      .limit(limit)
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

  return withActor(actor, (tx: Tx) => {
    const horizon = new Date()
    horizon.setUTCDate(horizon.getUTCDate() + Math.max(0, Math.min(60, withinDays)))

    return (
      tx
        .select({
          shipment: jobs.reference,
          container: equipment.containerNo,
          kind: freeTimeClocks.kind,
          startsOn: freeTimeClocks.startsOn,
          endsOn: freeTimeClocks.endsOn,
          accruedDays: freeTimeClocks.accruedDays,
          accruedAmount: freeTimeClocks.accruedAmount,
          currency: freeTimeClocks.currency,
        })
        .from(freeTimeClocks)
        .innerJoin(jobs, eq(jobs.id, freeTimeClocks.jobId))
        .leftJoin(equipment, eq(equipment.id, freeTimeClocks.equipmentId))
        /*
        No `closed_at` on this table: a clock stops when the box is returned,
        which `equipment.empty_returned_at` records. Filtering on that rather
        than inventing a column keeps the assistant's answer identical to the
        board's.
      */
        .where(
          and(
            isNull(equipment.emptyReturnedAt),
            lte(freeTimeClocks.endsOn, horizon.toISOString().slice(0, 10)),
          ),
        )
        .orderBy(freeTimeClocks.endsOn)
        .limit(limit)
    )
  })
}

async function listOverdueInvoices(actor: Actor, args: ToolArgs): Promise<unknown> {
  const customer = text(args, 'customer')
  const limit = count(args, 'limit', 20)
  const today = new Date().toISOString().slice(0, 10)

  return withActor(actor, (tx: Tx) => {
    const filters = [
      lte(invoices.dueOn, today),
      sql`${invoices.status}::text in ('issued', 'part_paid')`,
      customer
        ? or(ilike(customers.legalNameEn, `%${customer}%`), ilike(customers.code, `%${customer}%`))
        : undefined,
    ].filter(Boolean)

    return tx
      .select({
        number: invoices.seriesNo,
        customer: customers.legalNameEn,
        currency: invoices.currency,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        dueOn: invoices.dueOn,
        daysOverdue: sql<number>`(current_date - ${invoices.dueOn})::int`,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(and(...filters))
      .orderBy(invoices.dueOn)
      .limit(limit)
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

    const [billed, accrued] = await Promise.all([
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
