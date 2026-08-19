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
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { locations, partners, withActor } from '@qabandi/db'
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
