'use server'

/**
 * Credit control mutations — one act, recorded properly.
 *
 * There is exactly one thing to do here: decide that a customer may trade past
 * their limit, and leave a record of who decided it and why.
 *
 * ## Why an override rather than raising the limit
 *
 * Raising the limit is what happens when there is no override. A shipment is
 * urgent, the check blocks it, somebody edits 40,000 to 60,000 to get the
 * container moving, and nobody ever lowers it again. Six months later the
 * limit is a number that has been ratcheted upwards by every emergency the
 * customer has had, which is the opposite of a credit control.
 *
 * So the limit stays where the credit decision put it, and the exception is a
 * dated row with a name and a reason on it. `expires_on` is what makes that
 * bearable in practice — a manager can say "until the end of the month"
 * without anybody editing anything.
 *
 * ## Why the figures are copied onto the row
 *
 * The exposure and the limit as they stood are stamped at approval, not
 * recomputed when somebody reviews it. Six weeks later the customer has paid
 * two invoices and raised three, and a recomputation would show a manager
 * approving an amount nobody ever saw. Same reasoning as
 * `quotes.priced_snapshot`.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { toDb } from '@qabandi/core'
import { checkCredit, creditOverrides, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import {
  echo,
  fail,
  fieldErrors,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'
import { todayIn } from '@/lib/time'
import { refuseForbidden } from '@/lib/refuse-forbidden'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const overrideSchema = (tv: Translate) =>
  z.object({
    customerId: z.uuid(tv('chooseCustomer')),
    branchId: z.uuid(tv('chooseBranch')),
    jobId: z.uuid().optional(),
    invoiceId: z.uuid().optional(),
    /*
      Twenty characters, and the floor is deliberate.

      "ok", "approved" and "per MD" are all things that get typed into a required
      field, and all three are useless to the person reviewing this in a year.
      The column is `not null` and non-empty at the database; this is the layer
      that asks for a sentence.
    */
    reason: z.string().trim().min(20, tv('reasonSentence')).max(500),
    /**
     * Blank is a one-shot tied to the job or invoice named above. A date makes
     * it standing until then — which is the only thing that can release a
     * *booking*, since a job has no id before it exists.
     */
    expiresOn: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, tv('dateFormat'))
      .optional()
      .transform((v) => v || null),
  })

export const recordCreditOverride = refuseForbidden(async function recordCreditOverride(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'credit.override')
  const tv = await getTranslations('creditValidation')

  const parsed = await localeParse(overrideSchema(tv), {
    customerId: read(form, 'customerId'),
    branchId: read(form, 'branchId'),
    jobId: read(form, 'jobId'),
    invoiceId: read(form, 'invoiceId'),
    reason: read(form, 'reason'),
    expiresOn: read(form, 'expiresOn'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertCanIn(session, 'credit.override', data.branchId)

  if (data.expiresOn && data.expiresOn < todayIn()) {
    return fail({ expiresOn: tv('datePassed') }, echo(form))
  }

  /*
    The standing is read now, at approval, and stamped onto the row.

    Deliberately the *unproposed* position — what the customer owes today,
    without whatever is about to be booked. A manager approving an override is
    answering "how far in is this customer", and folding in a shipment that may
    never happen would put a number on the record that was never true.
  */
  const { standing } = await checkCredit(session.actor, {
    customerId: data.customerId,
    branchId: data.branchId,
  })

  /*
    An override on a customer with no limit is refused rather than stored.

    It would be a permanent, unreviewable row authorising an exception to a
    rule that is not being applied — and the moment somebody later sets a
    limit, it silently becomes an exemption from it that nobody chose.
  */
  if (!standing.limit) {
    return fail({ _: tv('noCreditLimit') }, echo(form))
  }

  await withActor(session.actor, (tx) =>
    tx.insert(creditOverrides).values({
      branchId: data.branchId,
      customerId: data.customerId,
      jobId: data.jobId ?? null,
      invoiceId: data.invoiceId ?? null,
      exposure: toDb(standing.outstanding),
      creditLimit: toDb(standing.limit!),
      currency: standing.currency,
      reason: data.reason,
      approvedById: session.principal.id,
      expiresOn: data.expiresOn,
    }),
  )

  revalidatePath(`/customers/${data.customerId}`)
  if (data.jobId) revalidatePath(`/jobs/${data.jobId}`)
  if (data.invoiceId) revalidatePath(`/invoices/${data.invoiceId}`)
  return succeed(data.customerId)
})
