'use server'

/**
 * Network mutations — the parties and the places.
 *
 * Both are reference-shaped: created rarely, edited rarely, read constantly.
 * That shape drives two decisions here that differ from the transactional
 * slices:
 *
 *   1. **Neither is ever deleted.** A partner named on a two-year-old job file
 *      cannot be removed without taking the job's history with it, so
 *      `isActive` is the only retirement there is (§5.5, FR-ID-09). The
 *      dialog says "stop using", not "delete", because that is what happens.
 *   2. **The code is the human key**, and it is uppercased and constrained
 *      rather than free text — it is read down a phone, typed into a search
 *      box and printed on a quotation.
 */

import { revalidatePath } from 'next/cache'
import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  locations,
  partnerCompliance,
  partnerContacts,
  partnerCoverage,
  partners,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import {
  echo,
  fail,
  fieldErrors,
  isUniqueViolation,
  succeed,
  type ActionState,
} from '@/lib/form-state'

/** Uppercase, URL-safe, and never containing a space that breaks a search. */
const entityCode = z
  .string()
  .trim()
  .min(2, 'At least two characters')
  .max(16, 'At most sixteen characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Letters, numbers and hyphens only')
  .transform((value) => value.toUpperCase())

const optional = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null))

const optionalCode = (length: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value.toUpperCase() : null))
    .refine((value) => value === null || value.length === length, {
      message: `Must be ${length} characters`,
    })

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

// --- partners --------------------------------------------------------------

const partnerSchema = z.object({
  partnerId: z.uuid().optional(),
  code: entityCode,
  type: z.enum(['agent', 'haulier', 'carrier', 'broker', 'terminal']),
  legalNameEn: z.string().trim().min(2, 'Required').max(200),
  legalNameAr: optional(),
  countryCode: optionalCode(2),
  currency: optionalCode(3),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  /*
    Four letters, and the reason the carrier feed can find this partner.

    `optionalCode` uppercases before it measures, because an operator types
    `maeu` and the carrier gateways answer only to `MAEU` — normalising here
    rather than at every read is what keeps the poll worker's lookup a plain
    equality.
  */
  scac: optionalCode(4),
  isActive: z.coerce.boolean(),
})

export async function savePartner(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'partner.write')

  const parsed = partnerSchema.safeParse({
    partnerId: read(form, 'partnerId'),
    code: read(form, 'code') ?? '',
    type: read(form, 'type') ?? 'agent',
    legalNameEn: read(form, 'legalNameEn') ?? '',
    legalNameAr: read(form, 'legalNameAr'),
    countryCode: read(form, 'countryCode'),
    currency: read(form, 'currency'),
    paymentTermsDays: read(form, 'paymentTermsDays'),
    scac: read(form, 'scac'),
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  const values = {
    code: data.code,
    type: data.type,
    legalNameEn: data.legalNameEn,
    legalNameAr: data.legalNameAr,
    countryCode: data.countryCode,
    currency: data.currency,
    paymentTermsDays: data.paymentTermsDays ?? null,
    scac: data.scac,
    isActive: data.isActive,
  }

  try {
    await withActor(session.actor, async (tx) => {
      if (data.partnerId) {
        await tx
          .update(partners)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(partners.id, data.partnerId))
      } else {
        await tx.insert(partners).values(values)
      }
    })
  } catch (error) {
    // `partners.code` is unique, and a duplicate code is the one collision an
    // operator actually hits. Caught rather than pre-checked: a select before
    // an insert is a race the database is already handling correctly.
    if (isUniqueViolation(error)) {
      return fail({ code: 'That code is already in use by another partner.' }, echo(form))
    }
    throw error
  }

  revalidatePath('/partners')
  return succeed(data.code)
}

// --- places ----------------------------------------------------------------

const locationSchema = z.object({
  locationId: z.uuid().optional(),
  /**
   * The UN/LOCODE, five characters — `KWSWK`, `AEJEA`.
   *
   * Optional because an inland depot or a customer's own yard has no code, and
   * refusing to record one until somebody invents a code is how a place ends
   * up typed as free text into a notes field.
   */
  unlocode: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value.toUpperCase() : null))
    .refine((value) => value === null || /^[A-Z]{2}[A-Z0-9]{3}$/.test(value), {
      message: 'Five characters: two-letter country then three for the place, e.g. KWSWK',
    }),
  nameEn: z.string().trim().min(2, 'Required').max(160),
  nameAr: optional(160),
  countryCode: z
    .string()
    .trim()
    .length(2, 'Choose a country')
    .transform((value) => value.toUpperCase()),
  kind: z.enum(['seaport', 'airport', 'inland', 'border', 'depot', 'warehouse']),
  isActive: z.coerce.boolean(),
})

export async function saveLocation(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  // Places are reference data, so they sit behind the reference permission
  // rather than a places-specific one — the same gate as commodities and
  // charge types, which are the same kind of thing.
  assertCan(session, 'admin.reference.write')

  const parsed = locationSchema.safeParse({
    locationId: read(form, 'locationId'),
    unlocode: read(form, 'unlocode'),
    nameEn: read(form, 'nameEn') ?? '',
    nameAr: read(form, 'nameAr'),
    countryCode: read(form, 'countryCode') ?? '',
    kind: read(form, 'kind') ?? 'seaport',
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  const values = {
    unlocode: data.unlocode,
    nameEn: data.nameEn,
    nameAr: data.nameAr,
    countryCode: data.countryCode,
    kind: data.kind,
    isActive: data.isActive,
  }

  try {
    await withActor(session.actor, async (tx) => {
      if (data.locationId) {
        await tx
          .update(locations)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(locations.id, data.locationId))
      } else {
        await tx.insert(locations).values(values)
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ unlocode: 'That UN/LOCODE is already recorded.' }, echo(form))
    }
    throw error
  }

  revalidatePath('/locations')
  return succeed(data.nameEn)
}

/**
 * Retire a record rather than delete it — §5.5, FR-ID-09.
 *
 * Exposed as one action for both tables because the semantics are identical
 * and the alternative is two functions that differ by a table name.
 */
export async function setNetworkActive(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()

  const kind = read(form, 'kind')
  const id = read(form, 'id')
  const isActive = form.get('isActive') !== null
  if (!id || (kind !== 'partner' && kind !== 'location')) {
    return fail({ _: 'Nothing to update.' })
  }

  assertCan(session, kind === 'partner' ? 'partner.write' : 'admin.reference.write')

  await withActor(session.actor, async (tx) => {
    if (kind === 'partner') {
      await tx.update(partners).set({ isActive, updatedAt: new Date() }).where(eq(partners.id, id))
    } else {
      await tx
        .update(locations)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(locations.id, id))
    }
  })

  revalidatePath(kind === 'partner' ? '/partners' : '/locations')
  return succeed(id)
}

/* ------------------------------------------------ what a partner is made of */

const contactSchema = z.object({
  contactId: z.uuid().optional(),
  partnerId: z.uuid(),
  nameEn: z.string().trim().min(2, 'Required').max(200),
  nameAr: optional(200),
  email: z.union([z.email('Not an email address'), z.literal('')]).optional(),
  phone: optional(40),
  role: optional(80),
  isPrimary: z.coerce.boolean(),
  isActive: z.coerce.boolean(),
})

/**
 * A person at the agent — FR-MD-04.
 *
 * The partner screen has shown these since it was written and never had a way
 * to add one: `partner_contacts` was written by `db:create-user` when an agent
 * was given a login, and by nothing else. So the only contact a partner could
 * have was one who had been issued portal access, which is the wrong way round
 * — you know the operations manager's mobile long before you invite them to
 * anything.
 */
export async function savePartnerContact(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'partner.write')

  const parsed = contactSchema.safeParse({
    contactId: read(form, 'contactId'),
    partnerId: read(form, 'partnerId'),
    nameEn: read(form, 'nameEn') ?? '',
    nameAr: read(form, 'nameAr'),
    email: read(form, 'email') ?? '',
    phone: read(form, 'phone'),
    role: read(form, 'role'),
    isPrimary: form.get('isPrimary') !== null,
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  await withActor(session.actor, async (tx) => {
    const values = {
      partnerId: data.partnerId,
      nameEn: data.nameEn,
      nameAr: data.nameAr,
      email: data.email || null,
      phone: data.phone,
      role: data.role,
      isPrimary: data.isPrimary,
      isActive: data.isActive,
    }

    if (data.contactId) {
      await tx
        .update(partnerContacts)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(partnerContacts.id, data.contactId))
    } else {
      await tx.insert(partnerContacts).values(values)
    }

    /*
      One primary per partner, demoted rather than refused.

      "Primary" is who gets rung, and two of them is the same as none — the
      caller picks whichever the list happens to order first. Refusing the save
      would make the operator go and unset the old one, which is a step they
      would take anyway.
    */
    if (data.isPrimary) {
      await tx
        .update(partnerContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(partnerContacts.partnerId, data.partnerId),
            data.contactId ? ne(partnerContacts.id, data.contactId) : sql`true`,
            eq(partnerContacts.isPrimary, true),
          ),
        )
    }
  })

  revalidatePath(`/partners/${data.partnerId}`)
  return succeed(data.nameEn)
}

const coverageSchema = z.object({
  coverageId: z.uuid().optional(),
  partnerId: z.uuid(),
  mode: z.enum(['sea_fcl', 'sea_lcl', 'air', 'land', 'courier']),
  originId: z.union([z.uuid(), z.literal('')]).optional(),
  destinationId: z.union([z.uuid(), z.literal('')]).optional(),
  originCountry: optional(2),
  destinationCountry: optional(2),
  transitDays: z
    .union([z.coerce.number().int().min(0).max(365), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  isActive: z.coerce.boolean(),
})

/**
 * A lane this partner covers — FR-RT-10, and what RFQ routing reads.
 *
 * Ports where the partner names them, countries where they do not: an agent
 * who says "anywhere in India" is a country row, and one who quotes Nhava
 * Sheva only is a port row. The index on `(mode, origin_id, destination_id)`
 * exists so the uncovered-lane lookup meets §12's two-second budget, and
 * PostgreSQL 18's skip scan is what lets a query that leaves `mode` open still
 * use it.
 */
export async function savePartnerCoverage(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'partner.write')

  const parsed = coverageSchema.safeParse({
    coverageId: read(form, 'coverageId'),
    partnerId: read(form, 'partnerId'),
    mode: read(form, 'mode') ?? 'sea_fcl',
    originId: read(form, 'originId') ?? '',
    destinationId: read(form, 'destinationId') ?? '',
    originCountry: read(form, 'originCountry'),
    destinationCountry: read(form, 'destinationCountry'),
    transitDays: read(form, 'transitDays') ?? '',
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  /*
    A row naming neither a port nor a country covers every lane on the mode,
    which is almost never what somebody means and is impossible to unpick
    later — the RFQ would go to this agent for every enquiry in the system.
  */
  if (!data.originId && !data.destinationId && !data.originCountry && !data.destinationCountry) {
    return fail({ originId: 'Name at least one end — a port, or a country.' }, echo(form))
  }

  await withActor(session.actor, async (tx) => {
    const values = {
      partnerId: data.partnerId,
      mode: data.mode,
      originId: data.originId || null,
      destinationId: data.destinationId || null,
      originCountry: data.originCountry ? data.originCountry.toUpperCase() : null,
      destinationCountry: data.destinationCountry ? data.destinationCountry.toUpperCase() : null,
      transitDays: data.transitDays,
      isActive: data.isActive,
    }
    if (data.coverageId) {
      await tx
        .update(partnerCoverage)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(partnerCoverage.id, data.coverageId))
    } else {
      await tx.insert(partnerCoverage).values(values)
    }
  })

  revalidatePath(`/partners/${data.partnerId}`)
  return succeed(data.mode)
}

const complianceSchema = z.object({
  partnerId: z.uuid(),
  documentTypeId: z.uuid('Choose a document type'),
  reference: optional(120),
  issuedOn: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'), z.literal('')])
    .optional()
    .transform((v) => v || null),
  expiresOn: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'), z.literal('')])
    .optional()
    .transform((v) => v || null),
  supersedesId: z.union([z.uuid(), z.literal('')]).optional(),
})

/**
 * A licence, an insurance certificate, a trade registration — FR-MD-05.
 *
 * The table the nightly compliance-expiry warning was written against, and it
 * had no rows because nothing could create one. So `JOBS.complianceExpiry` sat
 * in `PENDING` reading a table that would have been empty anyway.
 *
 * A renewal *supersedes* rather than replaces (§5.5). The expired certificate
 * is what proves the agent was covered on the day the shipment moved, which is
 * the only day anybody ever asks about.
 */
export async function savePartnerCompliance(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'partner.write')

  const parsed = complianceSchema.safeParse({
    partnerId: read(form, 'partnerId'),
    documentTypeId: read(form, 'documentTypeId') ?? '',
    reference: read(form, 'reference'),
    issuedOn: read(form, 'issuedOn') ?? '',
    expiresOn: read(form, 'expiresOn') ?? '',
    supersedesId: read(form, 'supersedesId') ?? '',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  if (data.issuedOn && data.expiresOn && data.expiresOn < data.issuedOn) {
    return fail({ expiresOn: 'It cannot expire before it was issued.' }, echo(form))
  }

  await withActor(session.actor, async (tx) => {
    const [row] = await tx
      .insert(partnerCompliance)
      .values({
        partnerId: data.partnerId,
        documentTypeId: data.documentTypeId,
        reference: data.reference,
        issuedOn: data.issuedOn,
        expiresOn: data.expiresOn,
      })
      .returning({ id: partnerCompliance.id })

    // The old certificate points forward to the renewal, and stays.
    if (data.supersedesId) {
      await tx
        .update(partnerCompliance)
        .set({ supersededById: row!.id, updatedAt: new Date() })
        .where(eq(partnerCompliance.id, data.supersedesId))
    }
  })

  revalidatePath(`/partners/${data.partnerId}`)
  return succeed(data.documentTypeId)
}
