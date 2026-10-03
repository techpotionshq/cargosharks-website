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
 *
 * The record is the group's and its terms are each branch's (FR-MD-01), so the
 * two are permitted separately on edit: the record by the customer's own
 * branch, a terms row by the branch it belongs to. A Kuwait desk pricing for a
 * Dubai customer sets Kuwait's house margin without owning the customer (D2).
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { customerBranchTerms, customers, withActor, type Tx } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn, canIn } from '@/lib/permissions'
import { isUniqueViolation } from '@/lib/form-state'
import { localeParse } from '@/lib/validate'
import { customerFormData, customerFormSchema, updateCustomerSchema } from './schema'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'

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

export const createCustomer = refuseForbidden(async function createCustomer(
  _previous: CustomerFormState,
  form: FormData,
): Promise<CustomerFormState> {
  const session = await requireSession()
  assertCan(session, 'customer.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('customersValidation')

  const parsed = await localeParse(customerFormSchema(tv), customerFormData(form))
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), values: echo(form) }
  }

  const data = parsed.data
  assertCanIn(session, 'customer.write', data.primaryBranchId)

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
        defaultMarginKind: data.defaultMarginKind ?? null,
        defaultMarginValue: data.defaultMarginValue,
      })

      return customerId
    })
  } catch (error) {
    // `customers.code` is unique. Surfacing it on the field beats a stack
    // trace, and it is the one collision an operator will actually hit.
    if (isUniqueViolation(error)) {
      return {
        errors: { code: tv('codeInUse') },
        values: echo(form),
      }
    }
    throw error
  }

  revalidatePath('/customers')
  redirect(`/customers/${createdId}`)
})

export const updateCustomer = refuseForbidden(async function updateCustomer(
  _previous: CustomerFormState,
  form: FormData,
): Promise<CustomerFormState> {
  const session = await requireSession()
  assertCan(session, 'customer.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('customersValidation')

  const parsed = await localeParse(updateCustomerSchema(tv), {
    ...customerFormData(form),
    customerId: form.get('customerId'),
  })
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), values: echo(form) }
  }

  const data = parsed.data

  /*
    Which branch's terms the card is editing. Absent (the create page, an older
    tab) it is the primary branch, as it always was.
  */
  const termsBranch = String(form.get('termsBranchId') ?? '').trim() || data.primaryBranchId
  if (!z.uuid().safeParse(termsBranch).success) {
    return { errors: { termsBranchId: tv('chooseBranch') }, values: echo(form) }
  }
  assertCanIn(session, 'customer.write', termsBranch)

  const [existing] = await withActor(session.actor, (tx) =>
    tx
      .select({
        code: customers.code,
        legalNameEn: customers.legalNameEn,
        legalNameAr: customers.legalNameAr,
        registration: customers.registration,
        taxRegistration: customers.taxRegistration,
        countryCode: customers.countryCode,
        primaryBranchId: customers.primaryBranchId,
        isActive: customers.isActive,
      })
      .from(customers)
      .where(eq(customers.id, data.customerId))
      .limit(1),
  )
  if (!existing) throw new Error('not_found')

  /*
    The record is written only when it changed, and then only by somebody who
    may act in the customer's branch, before and after the change. A desk that
    only came to set its own terms submits the record untouched and is not
    asked to own it; one that did change it is told so, with nothing saved,
    rather than having half the form quietly dropped.
  */
  const identity = {
    code: data.code,
    legalNameEn: data.legalNameEn,
    legalNameAr: data.legalNameAr,
    registration: data.registration,
    taxRegistration: data.taxRegistration,
    countryCode: data.countryCode ?? null,
    primaryBranchId: data.primaryBranchId,
    isActive: data.isActive,
  }
  const identityChanged = (Object.keys(identity) as (keyof typeof identity)[]).some(
    (key) => (identity[key] ?? null) !== (existing[key] ?? null),
  )
  if (identityChanged) {
    const owns = [existing.primaryBranchId, data.primaryBranchId].every(
      (branch) => !branch || canIn(session, 'customer.write', branch),
    )
    if (!owns) return { message: tv('identityElsewhere'), values: echo(form) }
  }

  try {
    await withActor(session.actor, async (tx) => {
      if (!identityChanged) return writeTerms(tx)
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
      await writeTerms(tx)
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { errors: { code: tv('codeInUse') }, values: echo(form) }
    }
    throw error
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${data.customerId}`)
  return { message: 'saved' }

  // Upsert rather than update: the branch may have no terms row yet (a
  // primary branch that moved, or a second branch setting its own).
  async function writeTerms(tx: Tx) {
    await tx
      .insert(customerBranchTerms)
      .values({
        customerId: data.customerId,
        branchId: termsBranch,
        paymentTermsDays: data.paymentTermsDays,
        creditLimit: data.creditLimit,
        creditCurrency: data.creditCurrency ?? null,
        freeTimeDays: data.freeTimeDays ?? null,
        defaultIncoterm: data.defaultIncoterm,
        defaultMarginKind: data.defaultMarginKind ?? null,
        defaultMarginValue: data.defaultMarginValue,
      })
      .onConflictDoUpdate({
        target: [customerBranchTerms.customerId, customerBranchTerms.branchId],
        set: {
          paymentTermsDays: data.paymentTermsDays,
          creditLimit: data.creditLimit,
          creditCurrency: data.creditCurrency ?? null,
          freeTimeDays: data.freeTimeDays ?? null,
          defaultIncoterm: data.defaultIncoterm,
          // Cleared when both fields are blank: "no house margin" is a
          // choice an operator makes on this form, not only a default.
          defaultMarginKind: data.defaultMarginKind ?? null,
          defaultMarginValue: data.defaultMarginValue,
          updatedAt: new Date(),
        },
      })
  }
})

/**
 * Deactivate rather than delete — FR-ID-09, §5.5.
 *
 * A customer with shipment history cannot be removed without taking the
 * history with it, so the record stays and stops being selectable.
 */
export const setCustomerActive = refuseForbidden(async function setCustomerActive(
  _previous: CustomerFormState,
  form: FormData,
): Promise<CustomerFormState> {
  const session = await requireSession()
  assertCan(session, 'customer.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo

  /*
    A form action like every other one here, rather than the two positional
    arguments it used to take.

    That signature is why it went unused: no form could post to it, so the
    only path to it was `.bind()`, and the deactivation this file's own
    docstring describes had no control anywhere in the interface. The shape
    below is the one `RecordDialog` drives, which is what every other mutation
    in this slice already is.
  */
  const customerId = String(form.get('customerId') ?? '')
  const tv = await getTranslations('customersValidation')
  if (!customerId) return { message: tv('nothingToUpdate') }

  // Presence is the signal, matching the checkbox convention of every form in
  // the application: reactivating sends the field, deactivating omits it.
  const isActive = form.get('isActive') !== null

  await withActor(session.actor, async (tx) => {
    await tx
      .update(customers)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(customers.id, customerId))
  })

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
  return { message: 'saved' }
})
