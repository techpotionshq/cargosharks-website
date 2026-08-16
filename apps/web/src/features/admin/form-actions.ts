'use server'

/**
 * Administration mutations — people, branches, and the reference tables.
 *
 * Everything here is behind `admin.*` permissions, and two of the actions do
 * something the rest of the product never does, so they are worth calling out:
 *
 *   - **Inviting a user creates an identity with no credential.** The row goes
 *     into `principals` and the role grants go into `principal_branch_roles`,
 *     but no password is set and none is chosen by an administrator. Passwords
 *     are set by the person who owns them, through `pnpm db:create-user` on
 *     day one or a reset link after that. An administrator who can type a
 *     colleague's password can sign in as them, and the audit log would say it
 *     was the colleague.
 *   - **Roles are granted per branch** (FR-ID-02). The same person is finance
 *     in Kuwait and read-only in Dubai, and the grant is a row per branch
 *     rather than a column on the user.
 */

import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  branches,
  chargeTypes,
  commodities,
  documentTypes,
  exceptionCodes,
  principalBranchRoles,
  principals,
  roles,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import {
  echo,
  fail,
  failWith,
  fieldErrors,
  isUniqueViolation,
  succeed,
  type ActionState,
} from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readAll(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === 'string' && v !== '')
}

const optional = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

// --- people ----------------------------------------------------------------

const userSchema = z.object({
  principalId: z.uuid().optional(),
  nameEn: z.string().trim().min(2, 'Required').max(160),
  nameAr: optional(160),
  email: z.email('A valid email address').transform((v) => v.toLowerCase()),
  phone: optional(40),
  locale: z.enum(['en', 'ar']),
  roleId: z.uuid('Choose a role'),
  branchIds: z.array(z.uuid()).min(1, 'Give them access to at least one branch'),
  isActive: z.coerce.boolean(),
})

export async function saveUser(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')

  const parsed = userSchema.safeParse({
    principalId: read(form, 'principalId'),
    nameEn: read(form, 'nameEn') ?? '',
    nameAr: read(form, 'nameAr'),
    email: read(form, 'email') ?? '',
    phone: read(form, 'phone'),
    locale: read(form, 'locale') ?? 'en',
    roleId: read(form, 'roleId'),
    branchIds: readAll(form, 'branchIds'),
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  /**
   * An administrator cannot grant access to a branch they do not hold.
   *
   * Without this, `admin.users.write` in one branch is a route to every branch
   * in the system — grant yourself a colleague, sign in, done. The permission
   * is about managing *people*, not about widening your own reach.
   */
  const ownBranches = new Set(session.branchRoles.keys())
  const reaching = data.branchIds.filter((id) => !ownBranches.has(id))
  if (reaching.length) {
    return fail(
      { branchIds: 'You can only grant access to branches you work in yourself.' },
      echo(form),
    )
  }

  try {
    await withActor(session.actor, async (tx) => {
      let principalId = data.principalId

      if (principalId) {
        await tx
          .update(principals)
          .set({
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            email: data.email,
            phone: data.phone,
            locale: data.locale,
            isActive: data.isActive,
            updatedAt: new Date(),
          })
          .where(eq(principals.id, principalId))
      } else {
        const [row] = await tx
          .insert(principals)
          .values({
            type: 'internal',
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            email: data.email,
            phone: data.phone,
            locale: data.locale,
            isActive: data.isActive,
          })
          .returning({ id: principals.id })
        principalId = row!.id
      }

      /**
       * Grants are replaced, not merged.
       *
       * The form shows the complete set of branches, so what it submits *is*
       * the intended state — merging would make removing a branch impossible
       * through the only interface that offers it. `app_user` holds no
       * DELETE (§5.5), so revocation is a deactivation of the grant row.
       */
      await tx
        .update(principalBranchRoles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(principalBranchRoles.principalId, principalId))

      for (const branchId of data.branchIds) {
        await tx
          .insert(principalBranchRoles)
          .values({ principalId, branchId, roleId: data.roleId, isActive: true })
          .onConflictDoUpdate({
            target: [principalBranchRoles.principalId, principalBranchRoles.branchId],
            set: { roleId: data.roleId, isActive: true, updatedAt: new Date() },
          })
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ email: 'Someone already has that email address.' }, echo(form))
    }
    throw error
  }

  revalidatePath('/admin/users')
  return succeed(data.email)
}

/**
 * Suspend someone — FR-ID-08.
 *
 * Takes effect on their **next request**, not at their next sign-in, because
 * the session lookup re-reads `is_active` every time rather than trusting a
 * claim baked into a token. That is the difference between revocation and a
 * note in a table.
 */
export async function setUserActive(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')

  const principalId = read(form, 'principalId')
  if (!principalId) return fail({ _: 'Nothing to update.' })

  // Suspending yourself locks you out with no way back in through the
  // interface — the recovery is shell access, so refuse it here.
  if (principalId === session.principal.id) {
    return failWith('You cannot suspend your own account.')
  }

  const isActive = form.get('isActive') !== null
  await withActor(session.actor, async (tx) => {
    await tx
      .update(principals)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(principals.id, principalId))
  })

  revalidatePath('/admin/users')
  return succeed(principalId)
}

// --- branches --------------------------------------------------------------

const branchSchema = z.object({
  branchId: z.uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2, 'At least two characters')
    .max(8, 'At most eight characters')
    .regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only')
    .transform((v) => v.toUpperCase()),
  legalNameEn: z.string().trim().min(2, 'Required').max(200),
  /**
   * Required, not optional.
   *
   * Every invoice and quotation this branch issues can be rendered in Arabic,
   * and the entity's legal name is the one string on those documents that
   * cannot be machine-translated at render time. A branch with no Arabic name
   * is a branch that cannot issue an Arabic invoice.
   */
  legalNameAr: z.string().trim().min(2, 'Required — it appears on Arabic invoices').max(200),
  baseCurrency: z
    .string()
    .trim()
    .length(3, 'A three-letter code')
    .transform((v) => v.toUpperCase()),
  country: z
    .string()
    .trim()
    .length(2, 'Choose a country')
    .transform((v) => v.toUpperCase()),
  calendarId: z.uuid('Every branch needs a working calendar'),
  timeZone: z.string().trim().min(3, 'Choose a time zone').max(64),
  /** The prefix on this branch's invoice numbers. Defaults to the code. */
  invoiceSeries: z
    .string()
    .trim()
    .max(12)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  taxRegistration: optional(60),
  isActive: z.coerce.boolean(),
})

export async function saveBranch(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')

  const parsed = branchSchema.safeParse({
    branchId: read(form, 'branchId'),
    code: read(form, 'code') ?? '',
    legalNameEn: read(form, 'legalNameEn') ?? '',
    legalNameAr: read(form, 'legalNameAr') ?? '',
    baseCurrency: read(form, 'baseCurrency') ?? '',
    country: read(form, 'country') ?? '',
    calendarId: read(form, 'calendarId'),
    timeZone: read(form, 'timeZone') ?? 'Asia/Kuwait',
    invoiceSeries: read(form, 'invoiceSeries'),
    taxRegistration: read(form, 'taxRegistration'),
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  try {
    await withActor(session.actor, async (tx) => {
      if (data.branchId) {
        /*
          `invoice_series` is deliberately not updatable here.
          Changing the prefix on a branch that has already issued invoices
          breaks the continuity of a statutory series — the numbers before and
          after the change no longer read as one sequence. Setting it is a
          decision made once, when the branch is created.
        */
        await tx
          .update(branches)
          .set({
            code: data.code,
            legalNameEn: data.legalNameEn,
            legalNameAr: data.legalNameAr,
            baseCurrency: data.baseCurrency,
            country: data.country,
            calendarId: data.calendarId,
            timeZone: data.timeZone,
            taxRegistration: data.taxRegistration,
            isActive: data.isActive,
            updatedAt: new Date(),
          })
          .where(eq(branches.id, data.branchId))
      } else {
        await tx.insert(branches).values({
          code: data.code,
          legalNameEn: data.legalNameEn,
          legalNameAr: data.legalNameAr,
          baseCurrency: data.baseCurrency,
          country: data.country,
          calendarId: data.calendarId,
          timeZone: data.timeZone,
          invoiceSeries: data.invoiceSeries ?? data.code,
          taxRegistration: data.taxRegistration,
          isActive: data.isActive,
        })
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ code: 'That branch code is already in use.' }, echo(form))
    }
    throw error
  }

  revalidatePath('/admin/branches')
  return succeed(data.code)
}

// --- reference tables ------------------------------------------------------

/**
 * One action for the four small catalogues an operator maintains.
 *
 * Commodities, charge types, document types and exception codes are the same
 * shape — a code, two names, a couple of flags — and they are the tables a new
 * operator has to fill in to make the product theirs. Four near-identical
 * actions would be four places to fix the same bug, so the table is a
 * parameter and it is validated against a closed list rather than trusted.
 */
const REFERENCE_TABLES = {
  commodity: commodities,
  charge_type: chargeTypes,
  document_type: documentTypes,
  exception_code: exceptionCodes,
} as const

type ReferenceTable = keyof typeof REFERENCE_TABLES

const referenceSchema = z.object({
  table: z.enum(['commodity', 'charge_type', 'document_type', 'exception_code']),
  recordId: z.uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2, 'At least two characters')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, hyphens and underscores'),
  nameEn: z.string().trim().min(2, 'Required').max(160),
  nameAr: z.string().trim().min(1, 'Required — this appears on Arabic documents').max(160),
  category: optional(60),
  defaultBasis: z
    .enum(['flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent'])
    .optional(),
  defaultSeverity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  hsCode: optional(20),
  isActive: z.coerce.boolean(),
})

export async function saveReferenceRecord(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')

  const parsed = referenceSchema.safeParse({
    table: read(form, 'table'),
    recordId: read(form, 'recordId'),
    code: read(form, 'code') ?? '',
    nameEn: read(form, 'nameEn') ?? '',
    nameAr: read(form, 'nameAr') ?? '',
    category: read(form, 'category'),
    defaultBasis: read(form, 'defaultBasis'),
    defaultSeverity: read(form, 'defaultSeverity'),
    hsCode: read(form, 'hsCode'),
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  const table: ReferenceTable = data.table

  // The per-table columns. Only what each table actually has — passing a
  // `category` to `commodities` would be a runtime error, not a type one,
  // because the table is chosen at run time.
  const values: Record<string, unknown> = {
    nameEn: data.nameEn,
    nameAr: data.nameAr,
    isActive: data.isActive,
  }

  if (table === 'charge_type') {
    values.key = data.code
    values.category = data.category ?? 'other'
    values.defaultBasis = data.defaultBasis ?? 'flat'
  } else {
    values.code = data.code
  }
  if (table === 'document_type') values.category = data.category ?? 'other'
  if (table === 'exception_code') values.defaultSeverity = data.defaultSeverity ?? 'medium'
  if (table === 'commodity') values.hsCode = data.hsCode

  try {
    await withActor(session.actor, async (tx) => {
      const target = REFERENCE_TABLES[table]
      if (data.recordId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx
          .update(target as any)
          .set({ ...values, updatedAt: new Date() })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(eq((target as any).id, data.recordId))
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.insert(target as any).values(values)
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ code: 'That code is already used in this table.' }, echo(form))
    }
    throw error
  }

  revalidatePath('/admin/reference')
  return succeed(data.code)
}

/** The roles a user can be given, for the invite form's select. */
export async function listAssignableRoles(): Promise<{ id: string; key: string; name: string }[]> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')

  return withActor(session.actor, async (tx) => {
    const rows = await tx
      .select({ id: roles.id, key: roles.key, name: roles.nameEn })
      .from(roles)
      .where(
        inArray(roles.key, [
          'administrator',
          'finance',
          'operations_manager',
          'coordinator',
          'sales',
          'customs_broker',
          'read_only',
        ]),
      )
    return rows
  })
}

/** The branch roles a person currently holds, for pre-filling the edit form. */
export async function getUserGrants(principalId: string): Promise<{
  roleId: string | null
  branchIds: string[]
}> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')

  return withActor(session.actor, async (tx) => {
    const rows = await tx
      .select({ roleId: principalBranchRoles.roleId, branchId: principalBranchRoles.branchId })
      .from(principalBranchRoles)
      .where(
        and(
          eq(principalBranchRoles.principalId, principalId),
          eq(principalBranchRoles.isActive, true),
        ),
      )
    return {
      roleId: rows[0]?.roleId ?? null,
      branchIds: rows.map((row) => row.branchId),
    }
  })
}
