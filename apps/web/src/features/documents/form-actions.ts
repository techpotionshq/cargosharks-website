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
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { jobCargo, jobParties, jobs, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { echo, fail, failWith, fieldErrors, succeed, type ActionState } from '@/lib/form-state'

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

const optionalQuantity = z
  .string()
  .trim()
  .regex(/^\d*\.?\d*$/, 'Numbers only')
  .optional()
  .transform((v) => (v && v !== '' ? v : null))

// --- parties ---------------------------------------------------------------

const partySchema = z.object({
  jobId: z.uuid('Choose a shipment'),
  role: z.enum([
    'shipper',
    'consignee',
    'notify',
    'second_notify',
    'delivery_agent',
    'forwarding_agent',
  ]),
  nameEn: z.string().trim().min(1, 'A party needs a name').max(200),
  nameAr: optionalText(),
  /** Newlines preserved: an address is laid out, not written. */
  address: optionalText(500),
  city: optionalText(120),
  country: optionalText(2),
  contactName: optionalText(120),
  phone: optionalText(60),
  email: z
    .email('Not an email address')
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

export async function saveJobParty(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')

  const partyId = read(form, 'partyId')
  const parsed = partySchema.safeParse({
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
    if (error instanceof Error && error.message.includes('job_parties_single_principal')) {
      return failWith('That shipment already has one of those. Edit the existing party instead.')
    }
    throw error
  }

  revalidatePath(`/jobs/${data.jobId}`)
  return succeed(data.nameEn)
}

// --- cargo -----------------------------------------------------------------

const cargoSchema = z.object({
  jobId: z.uuid('Choose a shipment'),
  marksAndNumbers: optionalText(2000),
  packageCount: z.coerce.number().int().positive().optional(),
  packageType: optionalText(60),
  descriptionEn: z.string().trim().min(1, 'The goods need a description').max(2000),
  descriptionAr: optionalText(2000),
  hsCode: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => v || null),
  grossWeightKg: optionalQuantity,
  netWeightKg: optionalQuantity,
  volumeCbm: optionalQuantity,
  equipmentId: z
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export async function saveCargoLine(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')

  const cargoId = read(form, 'cargoId')
  const parsed = cargoSchema.safeParse({
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
}

// --- issuing ---------------------------------------------------------------

const KINDS = ['house_bill', 'delivery_order', 'packing_list', 'customs_pack'] as const
export type DocumentKind = (typeof KINDS)[number]

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

    const allocated = await tx.execute(sql`
      update branches
         set house_bill_series_next = house_bill_series_next + 1,
             updated_at = now()
       where id = ${job.branchId}
         and house_bill_series is not null
      returning house_bill_series
                || '-' || extract(year from now())::int
                || '-' || lpad(house_bill_series_next::text, 5, '0') as next
    `)

    const numbered = allocated.rows[0] as { next: string } | undefined
    if (!numbered) return

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
 */
export async function issueDocument(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'document.generate')

  const jobId = read(form, 'jobId')
  const kind = read(form, 'kind') as DocumentKind | undefined
  const locale = read(form, 'locale') === 'ar' ? 'ar' : 'en'

  if (!jobId || !kind || !KINDS.includes(kind)) throw new Error('Nothing to issue')

  if (kind === 'house_bill') await allocateHouseBillNumber(session, jobId)

  const serviceUrl = process.env.SERVICE_URL ?? 'http://localhost:3001'
  const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/internal/documents/job/${jobId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
    },
    body: JSON.stringify({ actor: session.actor, locale, kind, store: true }),
    cache: 'no-store',
  })

  if (!response.ok) {
    /*
      The service's own words, where it had any.

      "Document type customs_pack — run pnpm db:seed" is an actionable
      sentence; "Could not issue the document" sends the operator to support
      for something they could have fixed themselves.
    */
    const detail = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(detail?.message ?? `The document service refused (${response.status})`)
  }

  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/documents')
}
