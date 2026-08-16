'use server'

/**
 * Customer mutations.
 *
 * The same shape every server action in the application follows:
 *
 *   1. resolve the session          -> who is acting
 *   2. check the permission         -> what the interface offers (FR-ID-03)
 *   3. validate with the schema     -> generated from the column definition
 *   4. write inside withActor       -> RLS scopes it, the trigger audits it
 *
 * The customer and its per-branch terms are written in one transaction. A
 * customer that exists with no payment terms is a customer nobody can invoice,
 * and splitting the two writes is how that row gets created.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { customerBranchTerms, customers, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { customerFormData, customerFormSchema, updateCustomerSchema } from './schema'

export interface CustomerFormState {
  /** Field-keyed messages, so each input can render its own error. */
  readonly errors?: Record<string, string>
  readonly message?: string
  /** Echoed back so a rejected form does not lose what was typed. */
  readonly values?: Record<string, string>
}

/** Zod's flattened issues, keyed by the field the form actually renders. */
function fieldErrors(error: {
  issues: { path: PropertyKey[]; message: string }[]
}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_')
    out[key] ??= issue.message
  }
  return out
}

function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export async function createCustomer(
  _previous: CustomerFormState,
  form: FormData,
): Promise<CustomerFormState> {
  const session = await requireSession()
  assertCan(session, 'customer.write')

  const parsed = customerFormSchema.safeParse(customerFormData(form))
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), values: echo(form) }
  }

  const data = parsed.data
  assertInBranch(session, data.primaryBranchId)

  let createdId: string
  try {
    createdId = await withActor(session.actor, async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({
          code: data.code,
          legalNameEn: data.legalNameEn,
          legalNameAr: data.legalNameAr,
          registration: data.registration,
          taxRegistration: data.taxRegistration,
          countryCode: data.countryCode ?? null,
          primaryBranchId: data.primaryBranchId,
          isActive: data.isActive,
        })
        .returning({ id: customers.id })

      const customerId = row!.id

      await tx.insert(customerBranchTerms).values({
        customerId,
        branchId: data.primaryBranchId,
        paymentTermsDays: data.paymentTermsDays,
        creditLimit: data.creditLimit,
        creditCurrency: data.creditCurrency ?? null,
        freeTimeDays: data.freeTimeDays ?? null,
        defaultIncoterm: data.defaultIncoterm,
      })

      return customerId
    })
  } catch (error) {
    // `customers.code` is unique. Surfacing it on the field beats a stack
    // trace, and it is the one collision an operator will actually hit.
    if (isUniqueViolation(error)) {
      return {
        errors: { code: 'That customer code is already in use.' },
        values: echo(form),
      }
    }
    throw error
  }

  revalidatePath('/customers')
  redirect(`/customers/${createdId}`)
}

export async function updateCustomer(
  _previous: CustomerFormState,
  form: FormData,
): Promise<CustomerFormState> {
  const session = await requireSession()
  assertCan(session, 'customer.write')

  const parsed = updateCustomerSchema.safeParse({
    ...customerFormData(form),
    customerId: form.get('customerId'),
  })
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), values: echo(form) }
  }

  const data = parsed.data
  assertInBranch(session, data.primaryBranchId)

  try {
    await withActor(session.actor, async (tx) => {
      const [existing] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, data.customerId))
        .limit(1)
      if (!existing) throw new Error('not_found')

      await tx
        .update(customers)
        .set({
          code: data.code,
          legalNameEn: data.legalNameEn,
          legalNameAr: data.legalNameAr,
          registration: data.registration,
          taxRegistration: data.taxRegistration,
          countryCode: data.countryCode ?? null,
          primaryBranchId: data.primaryBranchId,
          isActive: data.isActive,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, data.customerId))

      // Upsert rather than update: the primary branch may have moved to one
      // that has no terms row yet.
      await tx
        .insert(customerBranchTerms)
        .values({
          customerId: data.customerId,
          branchId: data.primaryBranchId,
          paymentTermsDays: data.paymentTermsDays,
          creditLimit: data.creditLimit,
          creditCurrency: data.creditCurrency ?? null,
          freeTimeDays: data.freeTimeDays ?? null,
          defaultIncoterm: data.defaultIncoterm,
        })
        .onConflictDoUpdate({
          target: [customerBranchTerms.customerId, customerBranchTerms.branchId],
          set: {
            paymentTermsDays: data.paymentTermsDays,
            creditLimit: data.creditLimit,
            creditCurrency: data.creditCurrency ?? null,
            freeTimeDays: data.freeTimeDays ?? null,
            defaultIncoterm: data.defaultIncoterm,
            updatedAt: new Date(),
          },
        })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { errors: { code: 'That customer code is already in use.' }, values: echo(form) }
    }
    throw error
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${data.customerId}`)
  return { message: 'saved' }
}

/**
 * Deactivate rather than delete — FR-ID-09, §5.5.
 *
 * A customer with shipment history cannot be removed without taking the
 * history with it, so the record stays and stops being selectable.
 */
export async function setCustomerActive(customerId: string, isActive: boolean): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'customer.write')

  await withActor(session.actor, async (tx) => {
    await tx
      .update(customers)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(customers.id, customerId))
  })

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}
