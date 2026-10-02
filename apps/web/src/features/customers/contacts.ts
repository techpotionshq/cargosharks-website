'use server'

/**
 * A customer's people, and the phone numbers WhatsApp matching keys on (D3).
 *
 * Inbound WhatsApp is filed under a customer by `customer_contacts.phone`
 * (`matchCustomerByPhone` in the service), and the only way to write that
 * column was a CSV import. These are the hand-written add, edit and
 * deactivate, from the customer's own page.
 *
 * ## Who may
 *
 * `customer.write`, held in the customer's primary branch (`assertCanIn`): the
 * branch that owns the relationship decides who speaks for the customer. A
 * customer with no primary branch is group-shared with nobody to narrow by, so
 * the permission anywhere is the check, as for the record itself.
 *
 * ## The number is stored the way the matcher reads it
 *
 * `normalisePhone` settles Arabic-Indic digits and the seven-digit floor at the
 * door, and a number that one sender could match at two customers is refused
 * here, because the matcher refuses that sender and their messages would land
 * under nobody.
 *
 * ## Never deleted
 *
 * A contact is deactivated (`is_active`), which takes them out of matching and
 * notifications and keeps them on the card to bring back.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { normalisePhone, phoneMatchKey, phonesCollide } from '@qabandi/core/import'
import { customerContacts, customers, withActor, type Tx } from '@qabandi/db'
import { requireSession, type Session } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import {
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

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null)

const contactSchema = (tv: Translate<'customerContacts'>) =>
  z
    .object({
      customerId: z.uuid(),
      contactId: z.uuid().optional(),
      nameEn: z.string().trim().min(2, tv('nameRequired')).max(160),
      nameAr: optional(160),
      email: z
        .email(tv('validEmail'))
        .transform((value) => value.toLowerCase())
        .optional(),
      phone: optional(40),
      role: optional(80),
    })
    .transform((data, ctx) => {
      const phone = data.phone ? normalisePhone(data.phone) : null
      if (data.phone && !phone) {
        ctx.addIssue({ code: 'custom', path: ['phone'], message: tv('validPhone') })
        return z.NEVER
      }
      return { ...data, phone }
    })

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * The customer, if this person may change who speaks for it — in its primary
 * branch, or anywhere for a customer that has none.
 */
async function writableCustomer(
  session: Session,
  customerId: string,
): Promise<{ id: string; isActive: boolean } | null> {
  const [customer] = await withActor(session.actor, (tx) =>
    tx
      .select({
        id: customers.id,
        isActive: customers.isActive,
        primaryBranchId: customers.primaryBranchId,
      })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1),
  )
  if (!customer) return null
  if (customer.primaryBranchId) assertCanIn(session, 'customer.write', customer.primaryBranchId)
  return customer
}

/**
 * Whether an active contact at another customer holds a number one sender
 * would match together with `phone` (`phonesCollide`, the matcher's rule).
 *
 * Narrowed in SQL on the last seven digits, which any colliding pair shares,
 * so the comparison in code runs over a handful of rows rather than every
 * contact on file.
 */
async function phoneClaimedElsewhere(tx: Tx, customerId: string, phone: string): Promise<boolean> {
  const tail = phoneMatchKey(phone).slice(-7)
  const candidates = await tx
    .select({ phone: customerContacts.phone })
    .from(customerContacts)
    .where(
      and(
        ne(customerContacts.customerId, customerId),
        eq(customerContacts.isActive, true),
        sql`right(regexp_replace(coalesce(${customerContacts.phone}, ''), '[^0-9]', '', 'g'), 7) = ${tail}`,
      ),
    )
  return candidates.some((row) => row.phone !== null && phonesCollide(row.phone, phone))
}

/** Add a contact, or edit one when `contactId` is present. */
export const saveCustomerContact = refuseForbidden(async function saveCustomerContact(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'customer.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('customerContacts')

  const parsed = await localeParse(contactSchema(tv), {
    customerId: read(form, 'customerId') ?? '',
    contactId: read(form, 'contactId'),
    nameEn: read(form, 'nameEn') ?? '',
    nameAr: read(form, 'nameAr'),
    email: read(form, 'email'),
    phone: read(form, 'phone'),
    role: read(form, 'role'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))
  const data = parsed.data

  const customer = await writableCustomer(session, data.customerId)
  if (!customer) return failWith(tv('notFound'))
  if (!customer.isActive && !data.contactId) return failWith(tv('customerInactive'), echo(form))

  const outcome = await withActor(session.actor, async (tx) => {
    const existing = data.contactId
      ? (
          await tx
            .select({
              id: customerContacts.id,
              email: customerContacts.email,
              principalId: customerContacts.principalId,
            })
            .from(customerContacts)
            .where(
              and(
                eq(customerContacts.id, data.contactId),
                eq(customerContacts.customerId, data.customerId),
              ),
            )
            .limit(1)
        )[0]
      : undefined
    if (data.contactId && !existing) return 'not_found' as const

    /*
      A portal contact signs in with this address. Changing it here would
      leave the login on the old one and the notifications on the new, so the
      address is changed on the login, and here it stays as it is.
    */
    if (existing?.principalId && (data.email ?? null) !== (existing.email ?? null)) {
      return 'login_email' as const
    }

    if (data.phone && (await phoneClaimedElsewhere(tx, data.customerId, data.phone))) {
      return 'phone_taken' as const
    }

    const values = {
      nameEn: data.nameEn,
      nameAr: data.nameAr,
      email: data.email ?? null,
      phone: data.phone,
      role: data.role,
    }
    if (existing) {
      await tx
        .update(customerContacts)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(customerContacts.id, existing.id))
    } else {
      await tx.insert(customerContacts).values({ customerId: data.customerId, ...values })
    }
    return 'saved' as const
  })

  if (outcome === 'not_found') return failWith(tv('notFound'))
  if (outcome === 'login_email') return fail({ email: tv('emailOnLogin') }, echo(form))
  if (outcome === 'phone_taken') return fail({ phone: tv('phoneTaken') }, echo(form))

  revalidatePath(`/customers/${data.customerId}`)
  return succeed(data.contactId ?? data.customerId)
})

/**
 * Deactivate a contact, or bring one back. Presence of `isActive` is the
 * signal, as for `setCustomerActive`.
 */
export const setCustomerContactActive = refuseForbidden(async function setCustomerContactActive(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'customer.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('customerContacts')

  const customerId = read(form, 'customerId')
  const contactId = read(form, 'contactId')
  if (!customerId || !contactId) return failWith(tv('notFound'))
  const isActive = form.get('isActive') !== null

  const customer = await writableCustomer(session, customerId)
  if (!customer) return failWith(tv('notFound'))

  const updated = await withActor(session.actor, async (tx) => {
    // Bringing a number back is a new claim on it, checked like a new one.
    if (isActive) {
      const [contact] = await tx
        .select({ phone: customerContacts.phone })
        .from(customerContacts)
        .where(eq(customerContacts.id, contactId))
        .limit(1)
      if (contact?.phone && (await phoneClaimedElsewhere(tx, customerId, contact.phone))) {
        return 'phone_taken' as const
      }
    }
    const rows = await tx
      .update(customerContacts)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(customerContacts.id, contactId), eq(customerContacts.customerId, customerId)))
      .returning({ id: customerContacts.id })
    return rows.length > 0 ? ('saved' as const) : ('not_found' as const)
  })
  if (updated === 'not_found') return failWith(tv('notFound'))
  if (updated === 'phone_taken') return failWith(tv('phoneTaken'))

  revalidatePath(`/customers/${customerId}`)
  return succeed(contactId)
})
