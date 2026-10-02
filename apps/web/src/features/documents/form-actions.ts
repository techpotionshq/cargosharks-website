'use server'

/**
 * The documents a shipment produces — its parties, its cargo, and issuing.
 *
 * Two of these write rows nobody had a screen for until now. A bill of lading
 * needs a shipper printed as they wish to appear and a consignee that is
 * frequently the words "TO ORDER", and `jobs.customer_id` answers neither; a
 * packing list needs marks and numbers as they are stencilled on the carton,
 * and `commodities` classifies cargo rather than describing it. Both are
 * per-job text, entered here (0010).
 *
 * The third calls the service, because Chromium and the storage credentials
 * both live there (§3) — the same boundary the invoice already crosses.
 *
 * ## Preview and issue are different verbs
 *
 * Previewing streams a PDF and changes nothing. Issuing stores the bytes,
 * versions any previous copy and writes a `documents` row, and needs
 * `document.generate`. A bill of lading that can be regenerated differently
 * tomorrow is not a document, so the copy is taken at the moment it is handed
 * over.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { jobCargo, jobParties, jobs, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import {
  databaseMessage,
  echo,
  fail,
  failWith,
  fieldErrors,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

const optionalQuantity = (tv: Translate) =>
  z
    .string()
    .trim()
    .regex(/^\d*\.?\d*$/, tv('numbersOnly'))
    .optional()
    .transform((v) => (v && v !== '' ? v : null))

// --- parties ---------------------------------------------------------------

const partySchema = (tv: Translate) =>
  z.object({
    jobId: z.uuid(tv('chooseShipment')),
    role: z.enum([
      'shipper',
      'consignee',
      'notify',
      'second_notify',
      'delivery_agent',
      'forwarding_agent',
    ]),
    nameEn: z.string().trim().min(1, tv('partyNameRequired')).max(200),
    nameAr: optionalText(),
    /** Newlines preserved: an address is laid out, not written. */
    address: optionalText(500),
    city: optionalText(120),
    country: optionalText(2),
    contactName: optionalText(120),
    phone: optionalText(60),
    email: z
      .email(tv('notEmail'))
      .optional()
      .or(z.literal('').transform(() => undefined)),
    taxId: optionalText(60),
    customerId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    partnerId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })

export const saveJobParty = refuseForbidden(async function saveJobParty(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('documentsValidation')

  const partyId = read(form, 'partyId')
  const parsed = await localeParse(partySchema(tv), {
    jobId: read(form, 'jobId'),
    role: read(form, 'role'),
    nameEn: read(form, 'nameEn'),
    nameAr: read(form, 'nameAr'),
    address: form.get('address')?.toString(),
    city: read(form, 'city'),
    country: read(form, 'country'),
    contactName: read(form, 'contactName'),
    phone: read(form, 'phone'),
    email: read(form, 'email') ?? '',
    taxId: read(form, 'taxId'),
    customerId: read(form, 'customerId') ?? '',
    partnerId: read(form, 'partnerId') ?? '',
  })

  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))
  const data = parsed.data

  try {
    await withActor(session.actor, async (tx) => {
      const values = {
        jobId: data.jobId,
        role: data.role,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        address: data.address,
        city: data.city,
        country: data.country ? data.country.toUpperCase() : null,
        contactName: data.contactName,
        phone: data.phone,
        email: data.email ?? null,
        taxId: data.taxId,
        customerId: data.customerId ?? null,
        partnerId: data.partnerId ?? null,
      }

      if (partyId) {
        await tx
          .update(jobParties)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(jobParties.id, partyId))
        return
      }

      await tx.insert(jobParties).values(values)
    })
  } catch (error) {
    /*
      One shipper and one consignee — enforced by a partial unique index, so
      this is the database refusing rather than a check here that could be
      forgotten. Two consignees is not a variation to tolerate; it is a bill
      that cannot be issued.
    */
    if (databaseMessage(error).includes('job_parties_single_principal')) {
      return failWith(tv('partyRoleTaken'))
    }
    throw error
  }

  revalidatePath(`/jobs/${data.jobId}`)
  return succeed(data.nameEn)
})

// --- cargo -----------------------------------------------------------------

const cargoSchema = (tv: Translate) =>
  z.object({
    jobId: z.uuid(tv('chooseShipment')),
    marksAndNumbers: optionalText(2000),
    packageCount: z.coerce.number().int().positive().optional(),
    packageType: optionalText(60),
    descriptionEn: z.string().trim().min(1, tv('goodsDescriptionRequired')).max(2000),
    descriptionAr: optionalText(2000),
    hsCode: z
      .string()
      .trim()
      .max(20)
      .optional()
      .transform((v) => v || null),
    grossWeightKg: optionalQuantity(tv),
    netWeightKg: optionalQuantity(tv),
    volumeCbm: optionalQuantity(tv),
    equipmentId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })

export const saveCargoLine = refuseForbidden(async function saveCargoLine(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('documentsValidation')

  const cargoId = read(form, 'cargoId')
  const parsed = await localeParse(cargoSchema(tv), {
    jobId: read(form, 'jobId'),
    marksAndNumbers: form.get('marksAndNumbers')?.toString(),
    packageCount: read(form, 'packageCount'),
    packageType: read(form, 'packageType'),
    descriptionEn: read(form, 'descriptionEn'),
    descriptionAr: read(form, 'descriptionAr'),
    hsCode: read(form, 'hsCode'),
    grossWeightKg: read(form, 'grossWeightKg'),
    netWeightKg: read(form, 'netWeightKg'),
    volumeCbm: read(form, 'volumeCbm'),
    equipmentId: read(form, 'equipmentId') ?? '',
  })

  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))
  const data = parsed.data

  await withActor(session.actor, async (tx) => {
    const values = {
      jobId: data.jobId,
      marksAndNumbers: data.marksAndNumbers,
      packageCount: data.packageCount ?? null,
      packageType: data.packageType,
      descriptionEn: data.descriptionEn,
      descriptionAr: data.descriptionAr,
      hsCode: data.hsCode,
      grossWeightKg: data.grossWeightKg,
      netWeightKg: data.netWeightKg,
      volumeCbm: data.volumeCbm,
      equipmentId: data.equipmentId ?? null,
    }

    if (cargoId) {
      await tx
        .update(jobCargo)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(jobCargo.id, cargoId))
      return
    }

    /*
      The next line number, allocated inside the transaction.

      `max + 1` rather than a count, because a line that was edited away leaves
      a gap and reusing its number would silently renumber a packing list the
      customs officer is holding.
    */
    const [last] = await tx
      .select({ lineNo: jobCargo.lineNo })
      .from(jobCargo)
      .where(eq(jobCargo.jobId, data.jobId))
      .orderBy(desc(jobCargo.lineNo))
      .limit(1)

    await tx.insert(jobCargo).values({ ...values, lineNo: (last?.lineNo ?? 0) + 1 })
  })

  revalidatePath(`/jobs/${data.jobId}`)
  return succeed(data.descriptionEn)
})

// --- issuing ---------------------------------------------------------------

const KINDS = ['house_bill', 'delivery_order', 'packing_list', 'customs_pack'] as const
type DocumentKind = (typeof KINDS)[number]

/**
 * Allocate the house bill number, if the branch numbers its own.
 *
 * The same `update … returning` as the invoice series and for the same reason:
 * atomic, so two coordinators issuing in one branch at the same instant queue
 * on the row's lock rather than both reading the same number. A branch with no
 * series configured keeps whatever was typed by hand.
 */
async function allocateHouseBillNumber(
  session: Awaited<ReturnType<typeof requireSession>>,
  jobId: string,
): Promise<void> {
  await withActor(session.actor, async (tx) => {
    const [job] = await tx
      .select({ houseBillNumber: jobs.houseBillNumber, branchId: jobs.branchId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job || job.houseBillNumber) return

    /*
      Through `app.allocate_series_number`, not an inline update.

      `branches` is configuration and its write policy requires
      `admin.branches.write`, which no coordinator holds. Written inline, this
      update matched no rows for exactly the people who release house bills —
      and because the miss is indistinguishable from "no series configured",
      the bill went out with no number and nothing said so. Migration 0016 has
      the whole account.
    */
    const allocated = await tx.execute(
      sql`select app.allocate_series_number(${job.branchId}::uuid, 'house_bill') as next`,
    )

    const numbered = allocated.rows[0] as { next: string | null } | undefined
    if (!numbered?.next) return

    await tx
      .update(jobs)
      .set({ houseBillNumber: numbered.next, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), sql`${jobs.houseBillNumber} is null`))
  })
}

/**
 * Issue a document: render it, store it, version it, record it.
 *
 * The service does all four — it holds Chromium and the storage credentials —
 * and this decides whether the principal may ask. The house bill number is
 * allocated *first*, because a bill rendered before its number exists is
 * watermarked DRAFT on its face and storing that as the issued original is
 * exactly the mistake the watermark is there to prevent.
 *
 * Returns an `ActionState` for the two refusals the operator meets by
 * clicking — no service configured, and the service saying no. Thrown, they
 * reached the error boundary, which production redacts, so the one sentence
 * that said what to fix was the one sentence nobody saw. The job and the kind
 * are hidden fields the panel wrote; missing or unknown, they are a tampered
 * form and still throw.
 */
export const issueDocument = refuseForbidden(async function issueDocument(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'document.generate')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('documentsValidation')

  const jobId = read(form, 'jobId')
  const kind = read(form, 'kind') as DocumentKind | undefined
  const locale = read(form, 'locale') === 'ar' ? 'ar' : 'en'

  if (!jobId || !kind || !KINDS.includes(kind)) throw new Error('Nothing to issue')

  if (kind === 'house_bill') await allocateHouseBillNumber(session, jobId)

  /*
    Named rather than defaulted.

    This used to fall back to `http://localhost:3001`, which is right on one
    developer's machine and silently wrong everywhere else: a deployment
    missing the variable would report a connection refused against localhost,
    which reads as "the service is down" rather than "nobody set SERVICE_URL".
    Every other caller of the service — the document routes, the export —
    refuses by name, and this now matches them.
  */
  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) return failWith(tv('issueNeedsService'))

  const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/internal/documents/job/${jobId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ actor: session.actor, locale, kind, store: true }),
    cache: 'no-store',
  })

  if (!response.ok) {
    /*
      The service's reason, worded here from its code — never its `message`,
      which is English for its own log.

      "The customs pack is not set up in this deployment" is an actionable
      sentence; "Could not issue the document" sends the operator to support
      for something they could have fixed themselves. So each code the route
      sends has its own sentence, and only a code this file does not know (or
      a render fault, which is a bare 500) falls back to the status.
    */
    const detail = (await response.json().catch(() => null)) as IssueRefusalBody | null
    return failWith(issueRefusal(tv, detail) ?? tv('issueRefused', { status: response.status }))
  }

  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/documents')
  return succeed(kind)
})

/** What the service's refusal carries. `message`, where sent, is English and never shown. */
interface IssueRefusalBody {
  readonly error?: string
  readonly values?: Readonly<Record<string, string>>
}

/**
 * Every refusal code `/internal/documents/job/:id` answers with. Mirrored
 * rather than imported, because `apps/web` does not import the service.
 * `no_actor` is absent on purpose: it is this action's bug, not the operator's
 * problem, and the status fallback says as much as anything would.
 */
const ISSUE_REFUSALS = [
  'not_found',
  'document_type_missing',
  'storage_failed',
  'unknown_kind',
] as const

type IssueRefusal = (typeof ISSUE_REFUSALS)[number]

function isIssueRefusal(code: unknown): code is IssueRefusal {
  return typeof code === 'string' && (ISSUE_REFUSALS as readonly string[]).includes(code)
}

/**
 * Why the document was not issued, in the reader's language — or null for the
 * caller's status fallback. The `never` default keeps the switch exhaustive.
 */
function issueRefusal(
  tv: Translate<'documentsValidation'>,
  body: IssueRefusalBody | null,
): string | null {
  const code = body?.error
  if (!isIssueRefusal(code)) return null

  switch (code) {
    case 'not_found':
      return tv('issueShipmentNotFound')
    case 'document_type_missing':
      /*
        The kind is worded by a `select` in the sentence, whose `other` branch
        covers one added in the service before this catalogue.
      */
      return tv('issueTypeNotSetUp', { kind: body?.values?.kind ?? '' })
    case 'storage_failed':
      return tv('issueNotStored')
    case 'unknown_kind':
      return tv('issueUnknownKind')
    default: {
      const unhandled: never = code
      return unhandled
    }
  }
}

// --- telex release ---------------------------------------------------------

/**
 * Surrender the house bill — a telex release.
 *
 * The shipper hands the originals back at origin and the destination agent
 * releases the cargo without them. Once recorded, the bill prints no original
 * sheets and every copy carries the SURRENDERED stamp with this date, and the
 * delivery order stops asking the terminal for an original nobody holds.
 *
 * Behind `document.release` rather than `job.update`: releasing cargo against
 * nothing but our word is the same class of act as releasing a document to
 * the customer — one click, consequential, and not something every
 * coordinator should be able to do on the way past.
 *
 * Set once. `where surrendered_at is null` makes a double submit a no-op
 * rather than a later date overwriting the one the agent was told, and there
 * is no un-surrender: the originals cannot be un-collected. A bill that was
 * surrendered by mistake is re-issued, which is a new version in `documents`
 * and the audit trail that goes with it.
 *
 * The panel offers the button only on a numbered sea bill, so the refusals
 * below are reached from a stale screen — somebody changed the mode or the
 * number since it was drawn. That is an ordinary thing to happen, so they come
 * back as sentences under the button rather than as an error page. The job id
 * is a hidden field; missing, it is a tampered form and still throws.
 */
export const surrenderHouseBill = refuseForbidden(async function surrenderHouseBill(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'document.release')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('documentsValidation')

  const jobId = read(form, 'jobId')
  if (!jobId) throw new Error('Nothing to surrender')

  const refusal = await withActor(session.actor, async (tx) => {
    const [job] = await tx
      .select({ houseBillNumber: jobs.houseBillNumber, mode: jobs.mode })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) return 'not_found' as const
    /*
      Only a numbered sea bill can be surrendered. An unnumbered one was never
      issued, and an air waybill is not a document of title — there are no
      originals to hand back, so "surrendered" would be a stamp with no
      meaning on it.
    */
    if (!job.houseBillNumber) return 'not_issued' as const
    if (job.mode === 'air') return 'air' as const

    await tx
      .update(jobs)
      .set({
        houseBillSurrenderedAt: new Date(),
        houseBillSurrenderedById: session.actor.principalId,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), sql`${jobs.houseBillSurrenderedAt} is null`))
    return null
  })

  switch (refusal) {
    case 'not_found':
      return failWith(tv('surrenderShipmentGone'))
    case 'not_issued':
      return failWith(tv('surrenderNotIssued'))
    case 'air':
      return failWith(tv('surrenderAirWaybill'))
    case null:
      break
    default: {
      const unhandled: never = refusal
      return unhandled
    }
  }

  revalidatePath(`/jobs/${jobId}`)
  return succeed(jobId)
})
