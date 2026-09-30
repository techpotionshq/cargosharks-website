'use server'

/**
 * The mailboxes this deployment reads — FR-EQ-02, FR-AD-03.
 *
 * Al-Qabandi's front door is five mailboxes, one per office. This is the
 * screen behind them: an administrator adds Doha, and the poll picks it up on
 * the next tick. No environment variable, no deployment — which is the whole
 * of FR-AD-03's argument, and the reason an office previously waited on a
 * release to start receiving its own enquiries.
 *
 * ## The password goes in and never comes back
 *
 * `sealSecret` encrypts it under `MAILBOX_ENCRYPTION_KEY`, which lives in the
 * environment and never in the database. Nothing here ever selects
 * `password_sealed`, and there is no route that returns it: the poll worker
 * opens it in `apps/service`, and this screen only ever writes it.
 *
 * That is why editing a mailbox leaves the password field blank and means
 * "unchanged" rather than "clear it". A form that pre-filled the credential —
 * even masked — would put it in the HTML of a settings page, which is the one
 * place it has no reason to be.
 *
 * ## Nothing is deleted
 *
 * `is_active`, like everything else (§5.5). "Were we reading that mailbox in
 * March, and under whose credential" is a question asked after an incident,
 * and a deleted row cannot answer it.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { branches, hasSecretKey, mailboxes, sealSecret, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotMailboxes } from '@/lib/pilot/fixtures'
import {
  databaseMessage,
  echo,
  fail,
  fieldErrors,
  succeed,
  type ActionState,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'

export interface MailboxRow {
  readonly id: string
  readonly branchId: string
  readonly branchCode: string
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly username: string
  readonly folder: string
  readonly archiveFolder: string | null
  readonly isActive: boolean
  readonly lastPolledAt: Date | null
  readonly lastMessageAt: Date | null
  readonly lastError: string | null
}

/**
 * Every mailbox this administrator's branches own.
 *
 * Deactivated ones stay on the list — they are the answer to "why did that
 * office stop receiving enquiries", and hiding them makes that question
 * unanswerable from the screen that caused it.
 */
export async function listMailboxes(): Promise<MailboxRow[]> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')

  if (usePilotFixtures()) return pilotMailboxes()

  return withActor(session.actor, (tx) =>
    tx
      .select({
        id: mailboxes.id,
        branchId: mailboxes.branchId,
        branchCode: branches.code,
        host: mailboxes.host,
        port: mailboxes.port,
        secure: mailboxes.secure,
        username: mailboxes.username,
        folder: mailboxes.folder,
        archiveFolder: mailboxes.archiveFolder,
        isActive: mailboxes.isActive,
        lastPolledAt: mailboxes.lastPolledAt,
        lastMessageAt: mailboxes.lastMessageAt,
        lastError: mailboxes.lastError,
        // `password_sealed` is deliberately absent. Nothing on this side of
        // the system has a reason to read it.
      })
      .from(mailboxes)
      .innerJoin(branches, eq(branches.id, mailboxes.branchId))
      .orderBy(asc(branches.code), asc(mailboxes.username)),
  )
}

/** Whether a password can be sealed at all — the screen says so if not. */
export async function mailboxKeyConfigured(): Promise<boolean> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')
  return hasSecretKey()
}

const mailboxSchema = z.object({
  branchId: z.string().uuid(),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320),
  folder: z.string().trim().min(1).max(255),
  archiveFolder: z.string().trim().max(255).nullable(),
})

/**
 * Create or update. A blank password on an edit means "leave it alone".
 *
 * The distinction is load-bearing and it is the reason this is not two
 * actions: an administrator correcting a typo in the folder name must not have
 * to re-type a credential they may not have, and the alternative — a blank
 * field clearing the password — turns a small edit into a silently broken
 * mailbox that reports itself as configured.
 */
export async function saveMailbox(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')
  const tv = await getTranslations('adminValidation')

  const read = (key: string): string | undefined => {
    const value = form.get(key)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  const mailboxId = read('mailboxId')
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : ''

  const parsed = await localeParse(mailboxSchema, {
    branchId: read('branchId'),
    host: read('host'),
    port: read('port') ?? 993,
    secure: form.get('secure') !== null,
    username: read('username'),
    folder: read('folder') ?? 'INBOX',
    archiveFolder: read('archiveFolder') ?? null,
  })

  /*
    `echo` never carries the password back.

    `echo(form)` re-renders what was typed so a rejected form does not lose the
    administrator's work — which is right for a host name and wrong for a
    credential, because the echo lands in the HTML of the response. The field
    is stripped here rather than trusted not to be read.
  */
  const safeEcho = (): Record<string, string> => {
    const values = echo(form)
    delete values.password
    return values
  }

  if (!parsed.success) return fail(fieldErrors(parsed.error), safeEcho())

  /*
    F54: the id is a hidden field, so a malformed one is a tampered or broken
    form rather than a typo — and it used to reach the database as a uuid cast
    error. Refused as a form-level sentence, because there is no visible field
    to put a message beside.
  */
  if (mailboxId !== undefined && !z.uuid().safeParse(mailboxId).success) {
    return fail({ _: tv('missingMailbox') }, safeEcho())
  }

  const data = parsed.data
  assertInBranch(session, data.branchId)

  if (!mailboxId && !password) {
    return fail({ password: tv('mailboxPassword') }, safeEcho())
  }

  if (!hasSecretKey()) {
    return fail(
      {
        _: tv('mailboxKeyMissing'),
      },
      safeEcho(),
    )
  }

  let found = true
  try {
    await withActor(session.actor, async (tx) => {
      if (mailboxId) {
        const updated = await tx
          .update(mailboxes)
          .set({
            ...data,
            // Only when one was typed. Blank means unchanged — see above.
            ...(password ? { passwordSealed: sealSecret(password) } : {}),
            /*
              A saved mailbox has its last error cleared.

              The stored error describes a *previous* configuration; leaving it
              on a row somebody has just corrected means the screen reports a
              fault that has been fixed, and the next poll would have cleared
              it anyway. Clearing it here makes the save look like it did
              something, which it did.
            */
            lastError: null,
          })
          .where(eq(mailboxes.id, mailboxId))
          .returning({ id: mailboxes.id })
        /*
          F54: an update that matched nothing used to report success. The id
          is from a page loaded earlier, or names a mailbox in a branch this
          administrator cannot see — RLS makes the two indistinguishable, and
          one sentence for both gives no signal about another branch's rows.
        */
        found = updated.length > 0
        return
      }

      await tx.insert(mailboxes).values({ ...data, passwordSealed: sealSecret(password) })
    })
  } catch (error) {
    /*
      The unique key is the expected failure, and it deserves a sentence.

      Two rows for one address would poll it twice, and the second poll finds
      nothing because the first already flagged everything — an intermittent
      bug with a configuration cause, which is the worst kind to diagnose.
    */
    // Drizzle wraps the driver error: the constraint name is on its `cause`,
    // so reading `error.message` alone never matched and a duplicate was a 500.
    const message = databaseMessage(error)
    if (message.includes('mailboxes_address_unique')) {
      return fail({ username: tv('mailboxConnected') }, safeEcho())
    }
    throw error
  }

  if (!found) return fail({ _: tv('mailboxGone') }, safeEcho())

  revalidatePath('/settings/mailboxes')
  return succeed(data.username)
}

/**
 * Stop reading a mailbox, or start again.
 *
 * Deactivating is how a mailbox is removed: the poll skips inactive rows, and
 * the row stays as the record of what was being read and when.
 */
export async function setMailboxActive(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')

  const mailboxId = String(form.get('mailboxId') ?? '')
  const isActive = form.get('isActive') === 'true'
  const tv = await getTranslations('adminValidation')
  if (!mailboxId) return fail({ _: tv('missingMailbox') })

  await withActor(session.actor, async (tx) => {
    const [current] = await tx
      .select({ branchId: mailboxes.branchId })
      .from(mailboxes)
      .where(eq(mailboxes.id, mailboxId))
      .limit(1)

    // Invisible under RLS means not-found, which is also the right answer to
    // give: no enumeration signal for another branch's configuration.
    if (!current) throw new Error('not_found')

    await tx
      .update(mailboxes)
      .set({ isActive, ...(isActive ? { lastError: null } : {}) })
      .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.branchId, current.branchId)))
  })

  revalidatePath('/settings/mailboxes')
  return succeed(mailboxId)
}
