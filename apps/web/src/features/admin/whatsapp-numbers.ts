'use server'

/**
 * The WhatsApp business numbers this deployment answers on — FR-EQ-02, FR-AD-03.
 *
 * The counterpart of `mailboxes.ts`, one channel over. A mailbox maps an email
 * address to a branch; a row here maps a Kapso/Meta `phone_number_id` to a
 * branch, so a WhatsApp message to that number becomes an enquiry for the right
 * office. An administrator adds a number, and the next inbound message is filed
 * against it — no environment variable, no deployment, which is the whole of
 * FR-AD-03.
 *
 * ## No credential on the row
 *
 * Unlike a mailbox, there is nothing to seal here: Kapso holds the number and
 * the session, and the one secret that opens the account — the Kapso API key —
 * is the `whatsapp` integration secret, set once at Settings › Integrations.
 * This screen only ever writes the mapping.
 *
 * ## Nothing is deleted
 *
 * `is_active`, like everything else (§5.5). "Were we answering on that number in
 * March, and for which office" is a post-incident question a deleted row cannot
 * answer.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { branches, whatsappNumbers, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotWhatsappNumbers } from '@/lib/pilot/fixtures'
import {
  databaseMessage,
  echo,
  fail,
  fieldErrors,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'
import { demoReadOnly } from '@/lib/pilot/read-only'

export interface WhatsappNumberRow {
  readonly id: string
  readonly branchId: string
  readonly branchCode: string
  readonly phoneNumberId: string
  readonly displayNumber: string | null
  readonly label: string | null
  readonly isActive: boolean
  readonly lastMessageAt: Date | null
}

/**
 * Every WhatsApp number this administrator's branches answer on.
 *
 * Deactivated ones stay on the list, for the same reason mailboxes' do: they are
 * the answer to "why did that office stop receiving WhatsApp enquiries".
 */
export async function listWhatsappNumbers(): Promise<WhatsappNumberRow[]> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')

  if (usePilotFixtures()) return pilotWhatsappNumbers()

  return withActor(session.actor, (tx) =>
    tx
      .select({
        id: whatsappNumbers.id,
        branchId: whatsappNumbers.branchId,
        branchCode: branches.code,
        phoneNumberId: whatsappNumbers.phoneNumberId,
        displayNumber: whatsappNumbers.displayNumber,
        label: whatsappNumbers.label,
        isActive: whatsappNumbers.isActive,
        lastMessageAt: whatsappNumbers.lastMessageAt,
      })
      .from(whatsappNumbers)
      .innerJoin(branches, eq(branches.id, whatsappNumbers.branchId))
      .orderBy(asc(branches.code), asc(whatsappNumbers.phoneNumberId)),
  )
}

const numberSchema = (tv: Translate) =>
  z.object({
    branchId: z.string().uuid(),
    /*
    Digits only. The id is what Kapso stamps on every delivery and what a send
    is addressed to; the dialable number looks just as plausible in this field
    and was saved here once — after which every message to the number was
    skipped as "no active WhatsApp number", with nothing on this screen wrong
    to the eye. The hint says so; this makes it true.
  */
    phoneNumberId: z.string().trim().min(1).max(64).regex(/^\d+$/, tv('phoneNumberIdDigits')),
    displayNumber: z.string().trim().max(32).nullable(),
    label: z.string().trim().max(120).nullable(),
  })

/** Create or update a number → branch mapping. */
export async function saveWhatsappNumber(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('adminValidation')

  const read = (key: string): string | undefined => {
    const value = form.get(key)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  const numberId = read('numberId')

  const parsed = await localeParse(numberSchema(tv), {
    branchId: read('branchId'),
    phoneNumberId: read('phoneNumberId'),
    displayNumber: read('displayNumber') ?? null,
    label: read('label') ?? null,
  })

  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  // In that branch, not anywhere — FR-ID-02, A2.
  assertCanIn(session, 'admin.mailboxes.write', data.branchId)

  try {
    await withActor(session.actor, async (tx) => {
      if (numberId) {
        // The branch it is in now, as well as the one it is going to (A2).
        const [current] = await tx
          .select({ branchId: whatsappNumbers.branchId })
          .from(whatsappNumbers)
          .where(eq(whatsappNumbers.id, numberId))
          .limit(1)
        if (current) assertCanIn(session, 'admin.mailboxes.write', current.branchId)
        await tx.update(whatsappNumbers).set(data).where(eq(whatsappNumbers.id, numberId))
        return
      }
      await tx.insert(whatsappNumbers).values(data)
    })
  } catch (error) {
    /*
      The unique key is the expected failure, and it deserves a sentence. Two
      rows for one number would make branch resolution ambiguous — the same
      shape of bug the mailboxes address-unique guards against.
    */
    // Drizzle wraps the driver error: the constraint name is on its `cause`,
    // so reading `error.message` alone never matched and a duplicate was a 500.
    const message = databaseMessage(error)
    if (message.includes('whatsapp_numbers_phone_number_id_unique')) {
      return fail({ phoneNumberId: tv('numberMapped') }, echo(form))
    }
    throw error
  }

  revalidatePath('/settings/whatsapp-numbers')
  return succeed(data.label ?? data.phoneNumberId)
}

/**
 * Stop answering on a number, or start again.
 *
 * Deactivating is how a number is removed: the inbound worker skips inactive
 * rows, and the row stays as the record of what was being answered and when.
 */
export async function setWhatsappNumberActive(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo

  const numberId = String(form.get('numberId') ?? '')
  const isActive = form.get('isActive') === 'true'
  const tv = await getTranslations('adminValidation')
  if (!numberId) return fail({ _: tv('missingNumber') })

  await withActor(session.actor, async (tx) => {
    const [current] = await tx
      .select({ branchId: whatsappNumbers.branchId })
      .from(whatsappNumbers)
      .where(eq(whatsappNumbers.id, numberId))
      .limit(1)

    // Invisible under RLS means not-found, which is the right answer to give:
    // no enumeration signal for another branch's configuration.
    if (!current) throw new Error('not_found')
    // The row's own branch decides, not the pooled permission set (A2).
    assertCanIn(session, 'admin.mailboxes.write', current.branchId)

    await tx
      .update(whatsappNumbers)
      .set({ isActive })
      .where(and(eq(whatsappNumbers.id, numberId), eq(whatsappNumbers.branchId, current.branchId)))
  })

  revalidatePath('/settings/whatsapp-numbers')
  return succeed(numberId)
}
