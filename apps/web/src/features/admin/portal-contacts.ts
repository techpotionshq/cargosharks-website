'use server'

/**
 * Customer-portal logins — FR-MD-03, A7.
 *
 * Nothing in the product could create a `customer_contact` principal: the
 * portal existed, its RLS arm existed, and the only way in was a database
 * client. This is that way in, from the customer's own page, using the same
 * mechanism as inviting a colleague — a principal, an `auth_user` with no
 * credential, and the reset flow's link to set a password (`sign-in-link.ts`).
 *
 * ## Who may
 *
 * `admin.users.write`, in any branch. Granting somebody outside the company a
 * login is the authority that permission names; a customer record is
 * group-shared (§5.3), so there is no branch on it to narrow the check by.
 * What the login can see is not the inviter's choice: RLS scopes a
 * `customer_contact` to its own `customer_id`, and nothing else.
 */

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { authUser, customerContacts, customers, principals, withActor } from '@qabandi/db'
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
  type Translate,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'
import { sendSignInLink } from './sign-in-link'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'

const contactSchema = (tv: Translate) =>
  z.object({
    customerId: z.uuid(),
    nameEn: z.string().trim().min(2, tv('required')).max(160),
    nameAr: z
      .string()
      .trim()
      .max(160)
      .optional()
      .transform((v) => v || null),
    email: z.email(tv('validEmail')).transform((v) => v.toLowerCase()),
    locale: z.enum(['en', 'ar']),
  })

/**
 * Give one of the customer's people a portal login, and mail them the link.
 *
 * Also records them as a `customer_contacts` row joined to the login, so the
 * notification dispatcher — which reads contacts — and the portal agree on
 * who this person is.
 */
export const inviteCustomerContact = refuseForbidden(async function inviteCustomerContact(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('adminValidation')

  const read = (key: string) => {
    const value = form.get(key)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  const parsed = await localeParse(contactSchema(tv), {
    customerId: read('customerId') ?? '',
    nameEn: read('nameEn') ?? '',
    nameAr: read('nameAr'),
    email: read('email') ?? '',
    locale: read('locale') ?? 'en',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))
  const data = parsed.data

  try {
    const created = await withActor(session.actor, async (tx) => {
      const [customer] = await tx
        .select({ id: customers.id, isActive: customers.isActive })
        .from(customers)
        .where(eq(customers.id, data.customerId))
        .limit(1)
      if (!customer?.isActive) return false

      const [existing] = await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, data.email))
        .limit(1)
      let authUserId = existing?.id
      if (!authUserId) {
        authUserId = randomUUID()
        const now = new Date()
        await tx.insert(authUser).values({
          id: authUserId,
          name: data.nameEn,
          email: data.email,
          // The emailed link is the verification — see `loginFor` in
          // `form-actions.ts`.
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })
      }

      // Asked for before the insert, for the reason `saveUser` gives: the new
      // row is not yet visible to `insert … returning`.
      const generated = await tx.execute(sql`select uuidv7() as id`)
      const principalId = (generated.rows[0] as { id: string }).id

      await tx.insert(principals).values({
        id: principalId,
        type: 'customer_contact',
        customerId: data.customerId,
        authUserId,
        email: data.email,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        locale: data.locale,
        isActive: true,
      })

      await tx.insert(customerContacts).values({
        customerId: data.customerId,
        principalId,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        email: data.email,
      })
      return true
    })
    if (!created) return failWith(tv('portalCustomerInactive'), echo(form))
  } catch (error) {
    if (isUniqueViolation(error)) return fail({ email: tv('emailTaken') }, echo(form))
    throw error
  }

  // After the commit — see `saveUser`. The card lists the login with its
  // state and a button that reports what became of the mail.
  await sendSignInLink(data.email, 'invitation')

  revalidatePath(`/customers/${data.customerId}`)
  return succeed(data.email)
})
