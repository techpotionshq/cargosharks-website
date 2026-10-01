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

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { NOTIFICATION_EVENTS, unknownMergeFields } from '@qabandi/core'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  authUser,
  branches,
  chargeTypes,
  commodities,
  documentTypes,
  exceptionCodes,
  notificationChannelSettings,
  notificationTemplates,
  principalBranchRoles,
  principals,
  roles,
  systemActor,
  withActor,
  type Tx,
} from '@qabandi/db'
import { requireSession, type Session } from '@/lib/session'
import { assertCan, assertCanIn, branchesWhere } from '@/lib/permissions'
import { sendSignInLink, type SignInLinkOutcome } from './sign-in-link'
import {
  echo,
  fail,
  failWith,
  fieldErrors,
  isUniqueViolation,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'

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

const userSchema = (tv: Translate) =>
  z.object({
    principalId: z.uuid().optional(),
    nameEn: z.string().trim().min(2, tv('required')).max(160),
    nameAr: optional(160),
    email: z.email(tv('validEmail')).transform((v) => v.toLowerCase()),
    phone: optional(40),
    locale: z.enum(['en', 'ar']),
    roleId: z.uuid(tv('chooseRole')),
    branchIds: z.array(z.uuid()).min(1, tv('atLeastOneBranch')),
    isActive: z.coerce.boolean(),
  })

export async function saveUser(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(userSchema(tv), {
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
   * An administrator grants only in branches they *administer* — FR-ID-02, A2.
   *
   * This used to check that the administrator held *some* role in each
   * branch, against a permission set pooled across all of them. So somebody
   * who was administrator in Dubai and read-only in Kuwait passed both halves
   * and could make themselves administrator in Kuwait. The question is per
   * branch: does this person hold `admin.users.write` *there*. The database
   * asks the same thing (`app.has_permission_in`, A3) and refuses the row if
   * this is ever skipped.
   */
  const administered = new Set(branchesWhere(session, 'admin.users.write'))
  if (data.branchIds.some((id) => !administered.has(id))) {
    return fail({ branchIds: tv('grantOwnBranchesOnly') }, echo(form))
  }

  /*
    Editing somebody who also works in a branch this administrator does not
    administer. Their grants there are left exactly as they are (below), and
    the person-level fields — name, address, language, whether they can sign
    in at all — are refused, because those change the person in *every*
    branch. Suspending a Kuwait administrator is a decision for somebody who
    administers Kuwait.
  */
  if (data.principalId) {
    const elsewhere = await grantsOutside(data.principalId, administered)
    if (elsewhere.length && (await personChanged(session, data))) {
      return failWith(tv('personSpansOtherBranches'), echo(form))
    }
  }

  let invitedEmail: string | null = null

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
          authUserId: await loginFor(tx, data.email, data.nameEn),
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          email: data.email,
          phone: data.phone,
          locale: data.locale,
          isActive: data.isActive,
        })
        invitedEmail = data.email
      }

      /**
       * Grants are replaced, not merged — within the branches this
       * administrator administers.
       *
       * The form shows the complete set of *those* branches, so what it
       * submits is the intended state there; merging would make removing a
       * branch impossible through the only interface that offers it. A grant
       * in a branch the form never showed is not the form's to remove, and
       * used to be: editing a colleague's phone number from Kuwait silently
       * revoked their Dubai role. `app_user` holds no DELETE (§5.5), so
       * revocation is a deactivation of the grant row.
       */
      if (administered.size) {
        await tx
          .update(principalBranchRoles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(principalBranchRoles.principalId, principalId),
              inArray(principalBranchRoles.branchId, [...administered]),
            ),
          )
      }

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
      return fail({ email: tv('emailTaken') }, echo(form))
    }
    throw error
  }

  /*
    The first password, through the reset flow — A7, `sign-in-link.ts`.

    After the commit, never inside it: the link names an `auth_user` that has
    to exist when the person clicks it, and a mail sent from a transaction that
    then rolled back is an invitation to an account that never was. What
    became of the mail is shown on the people list, where the administrator
    can send it again.
  */
  if (invitedEmail) await sendSignInLink(invitedEmail)

  revalidatePath('/settings/users')
  return succeed(data.email)
}

/**
 * The login behind a new principal — A7.
 *
 * An `auth_user` with no credential row: nobody can sign in as it until the
 * owner of the mailbox follows the link and sets a password, which is when
 * Better Auth writes the credential. Reused if one already exists for the
 * address — an earlier invitation that was rolled back, or `db:create-user` —
 * so an invitation can never fork one person into two logins.
 *
 * `email_verified` is true for the reason `create-user.ts` gives: the
 * invitation *is* the verification, and following the emailed link proves the
 * mailbox before any password exists.
 */
async function loginFor(tx: Tx, email: string, name: string): Promise<string> {
  const [existing] = await tx
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1)
  if (existing) return existing.id

  const id = randomUUID()
  const now = new Date()
  await tx
    .insert(authUser)
    .values({ id, name, email, emailVerified: true, createdAt: now, updatedAt: now })
  return id
}

/**
 * Branches the person holds an active role in that `administered` does not
 * cover.
 *
 * Read as the system principal, because the point is to find grants the
 * administrator *cannot* see: `principal_branch_roles` shows them only their
 * own branches, so their own read would always answer "none". It reads branch
 * ids for one named principal and returns nothing to the caller but whether
 * there are any — the same narrow widening the session lookup argues for.
 */
async function grantsOutside(principalId: string, administered: Set<string>): Promise<string[]> {
  const rows = await withActor(systemActor(), (tx) =>
    tx
      .select({ branchId: principalBranchRoles.branchId })
      .from(principalBranchRoles)
      .where(
        and(
          eq(principalBranchRoles.principalId, principalId),
          eq(principalBranchRoles.isActive, true),
        ),
      ),
  )
  return rows.map((row) => row.branchId).filter((id) => !administered.has(id))
}

/** Would saving this change the person rather than only their grants? */
async function personChanged(
  session: Session,
  data: {
    principalId?: string
    nameEn: string
    nameAr: string | null
    email: string
    phone: string | null
    locale: string
    isActive: boolean
  },
): Promise<boolean> {
  const [row] = await withActor(session.actor, (tx) =>
    tx
      .select({
        nameEn: principals.nameEn,
        nameAr: principals.nameAr,
        email: principals.email,
        phone: principals.phone,
        locale: principals.locale,
        isActive: principals.isActive,
      })
      .from(principals)
      .where(eq(principals.id, data.principalId!))
      .limit(1),
  )
  if (!row) return true
  return (
    row.nameEn !== data.nameEn ||
    (row.nameAr ?? null) !== data.nameAr ||
    row.email !== data.email ||
    (row.phone ?? null) !== data.phone ||
    row.locale !== data.locale ||
    row.isActive !== data.isActive
  )
}

/**
 * Suspend someone — FR-ID-08.
 *
 * Takes effect on their **next request**, not at their next sign-in, because
 * the session lookup re-reads `is_active` every time rather than trusting a
 * claim baked into a token. That is the difference between revocation and a
 * note in a table.
 *
 * Suspension is of the person, in every branch at once, so it needs
 * `admin.users.write` in every branch they hold a role in (A2). An
 * administrator of one branch can still take away the grant in theirs.
 */
export async function setUserActive(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')
  const tv = await getTranslations('adminValidation')

  const principalId = read(form, 'principalId')
  if (!principalId) return fail({ _: tv('nothingToUpdate') })

  // Suspending yourself locks you out with no way back in through the
  // interface — the recovery is shell access, so refuse it here.
  if (principalId === session.principal.id) {
    return failWith(tv('cannotSuspendSelf'))
  }

  const administered = new Set(branchesWhere(session, 'admin.users.write'))
  if ((await grantsOutside(principalId, administered)).length) {
    return failWith(tv('personSpansOtherBranches'))
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

/**
 * Send a person the link that sets their password — A7.
 *
 * For an invitation whose mail did not go (the service was down, or not yet
 * configured), for a link that expired after its hour, and for the accounts
 * invited before invitations created a login at all: those get their
 * `auth_user` here. The message says what actually happened to the mail.
 */
export async function sendUserSignInLink(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')
  const tv = await getTranslations('adminValidation')

  const principalId = read(form, 'principalId')
  if (!principalId) return fail({ _: tv('nothingToUpdate') })

  const target = await withActor(session.actor, async (tx) => {
    const [row] = await tx
      .select({
        email: principals.email,
        nameEn: principals.nameEn,
        authUserId: principals.authUserId,
        isActive: principals.isActive,
        type: principals.type,
      })
      .from(principals)
      .where(eq(principals.id, principalId))
      .limit(1)
    return row
  })
  // Not visible is not found — an administrator cannot mail somebody outside
  // their own branches into an account.
  if (!target) return failWith(tv('nothingToUpdate'))
  if (!target.isActive) return failWith(tv('signInLinkSuspended'))

  if (target.type === 'internal') {
    const administered = new Set(branchesWhere(session, 'admin.users.write'))
    const reachable = await withActor(session.actor, (tx) =>
      tx
        .select({ branchId: principalBranchRoles.branchId })
        .from(principalBranchRoles)
        .where(
          and(
            eq(principalBranchRoles.principalId, principalId),
            eq(principalBranchRoles.isActive, true),
          ),
        ),
    )
    if (!reachable.some((row) => administered.has(row.branchId))) {
      return failWith(tv('grantOwnBranchesOnly'))
    }
  }

  if (!target.authUserId) {
    await withActor(session.actor, async (tx) => {
      const authUserId = await loginFor(tx, target.email, target.nameEn)
      await tx
        .update(principals)
        .set({ authUserId, updatedAt: new Date() })
        .where(eq(principals.id, principalId))
    })
  }

  return signInLinkState(tv, await sendSignInLink(target.email), target.email)
}

/** The sentence for what became of a link, as an `ActionState`. */
function signInLinkState(tv: Translate, outcome: SignInLinkOutcome, email: string): ActionState {
  if (outcome === 'sent') return { ...succeed(email), message: tv('signInLinkSent', { email }) }
  return failWith(tv(`signInLink.${outcome}` as 'signInLink.refused'))
}

// --- branches --------------------------------------------------------------

const branchSchema = (tv: Translate) =>
  z.object({
    branchId: z.uuid().optional(),
    code: z
      .string()
      .trim()
      .min(2, tv('minTwoChars'))
      .max(8, tv('maxEightChars'))
      .regex(/^[A-Za-z0-9]+$/, tv('lettersDigits'))
      .transform((v) => v.toUpperCase()),
    legalNameEn: z.string().trim().min(2, tv('required')).max(200),
    /**
     * Required, not optional.
     *
     * Every invoice and quotation this branch issues can be rendered in Arabic,
     * and the entity's legal name is the one string on those documents that
     * cannot be machine-translated at render time. A branch with no Arabic name
     * is a branch that cannot issue an Arabic invoice.
     */
    legalNameAr: z.string().trim().min(2, tv('requiredArInvoices')).max(200),
    baseCurrency: z
      .string()
      .trim()
      .length(3, tv('threeLetterCode'))
      .transform((v) => v.toUpperCase()),
    country: z
      .string()
      .trim()
      .length(2, tv('chooseCountry'))
      .transform((v) => v.toUpperCase()),
    calendarId: z.uuid(tv('branchNeedsCalendar')),
    timeZone: z.string().trim().min(3, tv('chooseTimeZone')).max(64),
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
    /*
    Large, because the back of a bill is large: a full set of conditions of
    carriage runs to thirty clauses and twenty thousand characters, and a cap
    that fits a quotation footer would cut a clause in half.
  */
    billOfLadingTermsEn: optional(60000),
    billOfLadingTermsAr: optional(60000),
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
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(branchSchema(tv), {
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
    billOfLadingTermsEn: read(form, 'billOfLadingTermsEn'),
    billOfLadingTermsAr: read(form, 'billOfLadingTermsAr'),
    defaultExclusionsEn: read(form, 'defaultExclusionsEn'),
    defaultExclusionsAr: read(form, 'defaultExclusionsAr'),
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  if (data.quietHoursEnabled && data.quietHoursFromHour === data.quietHoursToHour) {
    return fail(
      {
        quietHoursToHour: tv('quietHoursDiffer'),
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
            billOfLadingTermsEn: data.billOfLadingTermsEn,
            billOfLadingTermsAr: data.billOfLadingTermsAr,
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
          billOfLadingTermsEn: data.billOfLadingTermsEn,
          billOfLadingTermsAr: data.billOfLadingTermsAr,
          defaultExclusionsEn: data.defaultExclusionsEn,
          defaultExclusionsAr: data.defaultExclusionsAr,
          isActive: data.isActive,
        })
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ code: tv('branchCodeInUse') }, echo(form))
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

const referenceSchema = (tv: Translate) =>
  z.object({
    table: z.enum(['commodity', 'charge_type', 'document_type', 'exception_code']),
    recordId: z.uuid().optional(),
    code: z
      .string()
      .trim()
      .min(2, tv('minTwoChars'))
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, tv('lettersDigitsHyphens')),
    nameEn: z.string().trim().min(2, tv('required')).max(160),
    nameAr: z.string().trim().min(1, tv('requiredArDocuments')).max(160),
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
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(referenceSchema(tv), {
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
      return fail({ code: tv('codeInUseInTable') }, echo(form))
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

const templateSchema = (tv: Translate) =>
  z.object({
    templateId: z.uuid().optional(),
    eventKey: z.string().trim().min(3),
    locale: z.enum(['en', 'ar']),
    branchId: z.union([z.uuid(), z.literal('')]).optional(),
    subject: optional(200),
    body: z.string().trim().min(5, tv('templateBody')).max(8000),
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
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(templateSchema(tv), {
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
  if (branchId) assertCanIn(session, 'admin.reference.write', branchId)

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
        body: tv('unknownMergeFields', { fields: unknown.map((f) => `{{${f}}}`).join(', ') }),
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

// --- which notifications send at all ---------------------------------------

/**
 * Save the send switches — FR-NT-03.
 *
 * One form and one action for the master switch and all thirteen events,
 * rather than a toggle that saves on click. Two reasons, and the second is the
 * one that decided it:
 *
 * 1. It submits without JavaScript, like every other form on this screen.
 * 2. Turning notifications off is a decision somebody should make deliberately
 *    and see the whole of before it takes effect. A switch that saved on click
 *    would let an administrator silence `invoice.overdue` with a stray tap on
 *    a phone and get no chance to notice.
 *
 * ## Absent means on, so "on" writes a row anyway
 *
 * `channelDecision` treats a missing row as enabled, which is what keeps a
 * fresh deployment sending. That makes it tempting to delete rows that are
 * switched on and store only the offs — and it would be wrong twice over:
 * nothing in this product deletes (§5.5), and `app_user` holds no DELETE on
 * this table to do it with. So every switch writes its row, and turning
 * something back on is an `is_enabled = true` row rather than an absence. The
 * audit trail then reads as a sequence of decisions instead of a gap.
 *
 * ## A plain action, not an `ActionState` one
 *
 * Every neighbour in this file returns `ActionState` because it has something
 * to say when a field is wrong. A checkbox cannot be wrong — there is nothing
 * to validate and nothing to echo back — so this takes the plain
 * `(FormData) => void` shape and the screen posts it with no client JavaScript
 * at all, the way `ui/preferences.tsx` does. Permission is enforced by
 * `assertCan` throwing, which is the same guard the page renders behind.
 */
export async function saveNotificationSwitches(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')

  /*
    An unchecked checkbox posts nothing, so the switches are read as
    "present means on" against the declared event list rather than by walking
    the form. Walking the form would make a silenced event indistinguishable
    from a field the browser never sent — which is the same thing on the wire
    and very much not the same thing in a customer's inbox.
  */
  const channel = 'email' as const
  const rows = [
    { eventKey: null, channel, isEnabled: form.get('master') !== null },
    ...NOTIFICATION_EVENTS.map((event) => ({
      eventKey: event.key,
      channel,
      isEnabled: form.get(`event:${event.key}`) !== null,
    })),
  ]

  await withActor(session.actor, async (tx) => {
    await tx
      .insert(notificationChannelSettings)
      .values(rows)
      .onConflictDoUpdate({
        // `(event_key, channel) nulls not distinct` — the null row is the
        // master switch and must collide with itself, not multiply.
        target: [notificationChannelSettings.eventKey, notificationChannelSettings.channel],
        set: { isEnabled: sql`excluded.is_enabled`, updatedAt: new Date() },
      })
  })

  revalidatePath('/settings/notifications')
}
