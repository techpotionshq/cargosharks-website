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
import { unknownMergeFields } from '@qabandi/core'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  branches,
  chargeTypes,
  commodities,
  documentTypes,
  exceptionCodes,
  notificationTemplates,
  principalBranchRoles,
  principals,
  roles,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
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
        /*
          The id is asked for *before* the insert, not returned by it.

          `returning` makes PostgreSQL apply the SELECT policy to the new row,
          and a principal is only visible through a `principal_branch_roles`
          row joining them to a branch the reader works in (§5.3). That grant
          is written three statements below and cannot be written first — it
          references the principal. So `insert … returning` asked to read back
          a row that is not yet visible to anybody, and every invitation failed
          on the read rather than on the write.

          `uuidv7()` from the database rather than a uuid generated here, so
          the key keeps the time-ordering every other primary key in the schema
          has (§6.4).
        */
        const generated = await tx.execute(sql`select uuidv7() as id`)
        principalId = (generated.rows[0] as { id: string }).id

        await tx.insert(principals).values({
          id: principalId,
          type: 'internal',
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          email: data.email,
          phone: data.phone,
          locale: data.locale,
          isActive: data.isActive,
        })
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

  revalidatePath('/settings/users')
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

  revalidatePath('/settings/users')
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
  /**
   * Who notifications from this entity come from — FR-NT-01.
   *
   * Optional: a branch that has not been given its own address sends from the
   * deployment's, which is the state every branch starts in. A display name is
   * understood, and only the bare address goes in the SMTP envelope.
   */
  mailFrom: optional(200),
  /*
    Quiet hours — FR-NT-07, in this branch's local time.

    Refused when the two hours are equal, because that has two defensible
    readings — no quiet hours, or nothing but — and storing a value whose
    meaning is a coin toss is worse than refusing it. The switch is how an
    administrator turns the window off. The database says the same thing in
    `branches_quiet_hours_window`; this says it where somebody can read it.
  */
  quietHoursEnabled: z.boolean(),
  quietHoursFromHour: z.coerce.number().int().min(0).max(23),
  quietHoursToHour: z.coerce.number().int().min(0).max(23),
  /** The prefix on this branch's invoice numbers. Defaults to the code. */
  invoiceSeries: z
    .string()
    .trim()
    .max(12)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  taxRegistration: optional(60),
  /**
   * The house-bill series, and the chart of accounts this entity posts to.
   *
   * All optional, and checked at the point of use rather than here: a branch
   * that issues no house bills should not be made to invent a prefix, and a
   * branch that has not been mapped to a chart of accounts should be able to
   * exist. The accounting export names what is missing when somebody tries to
   * close a period, which is a better error than a required field on a form
   * they filled in six months earlier.
   */
  houseBillSeries: z
    .string()
    .trim()
    .max(12)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  arAccountCode: optional(30),
  apAccountCode: optional(30),
  taxAccountCode: optional(30),
  bankAccountCode: optional(30),
  fxVarianceAccountCode: optional(30),
  roundingAccountCode: optional(30),
  /**
   * Standard trading conditions, as they print on this entity's quotations —
   * FR-EQ-08.
   *
   * Long, and optional in both languages. A branch that has not supplied them
   * issues a quotation without the footer rather than being unable to issue
   * one, which matches how the chart of accounts above is treated: the missing
   * piece is named at the point it matters, not demanded on a form somebody
   * filled in months earlier.
   */
  tradingConditionsEn: optional(8000),
  tradingConditionsAr: optional(8000),
  /** One exclusion per line — see the column comment. */
  defaultExclusionsEn: optional(4000),
  defaultExclusionsAr: optional(4000),
  isActive: z.coerce.boolean(),
})

export async function saveBranch(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  /*
    Not `admin.reference.write`, which is what this used to be.

    An operations manager holds that key — deliberately, so adding a port does
    not need an administrator — and a branch record carries the base currency,
    the invoice series and the working calendar. Sharing one permission between
    "add a port" and "renumber the invoice sequence" is the kind of thing an
    auditor finds rather than the kind a developer notices.
  */
  assertCan(session, 'admin.branches.write')

  const parsed = branchSchema.safeParse({
    branchId: read(form, 'branchId'),
    code: read(form, 'code') ?? '',
    legalNameEn: read(form, 'legalNameEn') ?? '',
    legalNameAr: read(form, 'legalNameAr') ?? '',
    baseCurrency: read(form, 'baseCurrency') ?? '',
    country: read(form, 'country') ?? '',
    calendarId: read(form, 'calendarId'),
    timeZone: read(form, 'timeZone') ?? 'Asia/Kuwait',
    mailFrom: read(form, 'mailFrom'),
    quietHoursEnabled: form.get('quietHoursEnabled') !== null,
    quietHoursFromHour: read(form, 'quietHoursFromHour') ?? 21,
    quietHoursToHour: read(form, 'quietHoursToHour') ?? 7,
    invoiceSeries: read(form, 'invoiceSeries'),
    taxRegistration: read(form, 'taxRegistration'),
    houseBillSeries: read(form, 'houseBillSeries'),
    arAccountCode: read(form, 'arAccountCode'),
    apAccountCode: read(form, 'apAccountCode'),
    taxAccountCode: read(form, 'taxAccountCode'),
    bankAccountCode: read(form, 'bankAccountCode'),
    fxVarianceAccountCode: read(form, 'fxVarianceAccountCode'),
    roundingAccountCode: read(form, 'roundingAccountCode'),
    tradingConditionsEn: read(form, 'tradingConditionsEn'),
    tradingConditionsAr: read(form, 'tradingConditionsAr'),
    defaultExclusionsEn: read(form, 'defaultExclusionsEn'),
    defaultExclusionsAr: read(form, 'defaultExclusionsAr'),
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  if (data.quietHoursEnabled && data.quietHoursFromHour === data.quietHoursToHour) {
    return fail(
      {
        quietHoursToHour:
          'Quiet hours have to start and end at different times. Turn the switch ' +
          'off to send at any hour.',
      },
      echo(form),
    )
  }

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
            mailFrom: data.mailFrom,
            quietHoursEnabled: data.quietHoursEnabled,
            quietHoursFromHour: data.quietHoursFromHour,
            quietHoursToHour: data.quietHoursToHour,
            taxRegistration: data.taxRegistration,
            houseBillSeries: data.houseBillSeries,
            arAccountCode: data.arAccountCode,
            apAccountCode: data.apAccountCode,
            taxAccountCode: data.taxAccountCode,
            bankAccountCode: data.bankAccountCode,
            fxVarianceAccountCode: data.fxVarianceAccountCode,
            roundingAccountCode: data.roundingAccountCode,
            tradingConditionsEn: data.tradingConditionsEn,
            tradingConditionsAr: data.tradingConditionsAr,
            defaultExclusionsEn: data.defaultExclusionsEn,
            defaultExclusionsAr: data.defaultExclusionsAr,
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
          mailFrom: data.mailFrom,
          quietHoursEnabled: data.quietHoursEnabled,
          quietHoursFromHour: data.quietHoursFromHour,
          quietHoursToHour: data.quietHoursToHour,
          invoiceSeries: data.invoiceSeries ?? data.code,
          taxRegistration: data.taxRegistration,
          houseBillSeries: data.houseBillSeries,
          arAccountCode: data.arAccountCode,
          apAccountCode: data.apAccountCode,
          taxAccountCode: data.taxAccountCode,
          bankAccountCode: data.bankAccountCode,
          fxVarianceAccountCode: data.fxVarianceAccountCode,
          roundingAccountCode: data.roundingAccountCode,
          tradingConditionsEn: data.tradingConditionsEn,
          tradingConditionsAr: data.tradingConditionsAr,
          defaultExclusionsEn: data.defaultExclusionsEn,
          defaultExclusionsAr: data.defaultExclusionsAr,
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

  revalidatePath('/settings/branches')
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
  revenueAccountCode: optional(30),
  costAccountCode: optional(30),
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
    revenueAccountCode: read(form, 'revenueAccountCode'),
    costAccountCode: read(form, 'costAccountCode'),
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
    /*
      Where this charge posts in the customer's ledger (0011).

      Reference data rather than code because every accounting package in the
      Gulf numbers its accounts differently, and an unmapped charge type is
      what the accounting export refuses on — by name, so the operator knows
      which row to open.
    */
    values.revenueAccountCode = data.revenueAccountCode
    values.costAccountCode = data.costAccountCode
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

  revalidatePath('/reference')
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

/* ---------------------------------------------------- notification wording */

const templateSchema = z.object({
  templateId: z.uuid().optional(),
  eventKey: z.string().trim().min(3),
  locale: z.enum(['en', 'ar']),
  branchId: z.union([z.uuid(), z.literal('')]).optional(),
  subject: optional(200),
  body: z.string().trim().min(5, 'A template needs something to say').max(8000),
  isActive: z.coerce.boolean(),
})

/**
 * Edit the wording a notification goes out in — FR-NT-03.
 *
 * The requirement is that an administrator changes it without a developer, and
 * until this existed the only way was a database client. `notification_templates`
 * was seeded with every event in both languages and read by the dispatcher and
 * by nothing else.
 *
 * ## A branch row overrides the default; both are edited here
 *
 * `branch_id` null is the fallback (§7.4). Saving with a branch creates or
 * updates that branch's own copy and leaves the default alone, which is what
 * makes "Dubai says it differently" a row rather than a release.
 */
export async function saveNotificationTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')

  const parsed = templateSchema.safeParse({
    templateId: read(form, 'templateId'),
    eventKey: read(form, 'eventKey') ?? '',
    locale: read(form, 'locale') ?? 'en',
    branchId: read(form, 'branchId') ?? '',
    subject: read(form, 'subject'),
    body: read(form, 'body') ?? '',
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  const branchId = data.branchId ? data.branchId : null
  if (branchId) assertInBranch(session, branchId)

  /*
    Merge fields, checked before the row is written.

    `renderTemplate` substitutes an unknown field with an empty string, which
    is right for a dispatcher — it is delivering mail, not proof-reading it —
    and catastrophic as the only line of defence: a typo'd `{{referenceNo}}`
    sends "Your shipment  has arrived" to every customer, successfully, until
    somebody reads one. This is the moment a person is looking at the text, so
    it is the moment to say so.
  */
  const unknown = [
    ...new Set([
      ...unknownMergeFields(data.eventKey, data.body),
      ...unknownMergeFields(data.eventKey, data.subject ?? ''),
    ]),
  ]
  if (unknown.length > 0) {
    return fail(
      {
        body: `This event does not supply ${unknown.map((f) => `{{${f}}}`).join(', ')}. It would send as blank.`,
      },
      echo(form),
    )
  }

  await withActor(session.actor, async (tx) => {
    const values = {
      eventKey: data.eventKey,
      channel: 'email' as const,
      locale: data.locale,
      branchId,
      subject: data.subject,
      body: data.body,
      isActive: data.isActive,
    }

    if (data.templateId) {
      await tx
        .update(notificationTemplates)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(notificationTemplates.id, data.templateId))
    } else {
      /*
        Upsert on the natural key rather than insert.

        `(event_key, channel, locale, branch_id) nulls not distinct` is unique,
        and an administrator adding an override for a branch that already has
        one means "change it" — an error saying the row exists would send them
        looking for a row the screen had not shown them.
      */
      await tx
        .insert(notificationTemplates)
        .values(values)
        .onConflictDoUpdate({
          target: [
            notificationTemplates.eventKey,
            notificationTemplates.channel,
            notificationTemplates.locale,
            notificationTemplates.branchId,
          ],
          set: { subject: values.subject, body: values.body, isActive: values.isActive },
        })
    }
  })

  revalidatePath('/settings/notifications')
  return succeed(`${data.eventKey}:${data.locale}`)
}
