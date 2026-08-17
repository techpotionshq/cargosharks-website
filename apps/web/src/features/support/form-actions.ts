'use server'

/**
 * Granting support access — the operator's side of `0008_support_access.sql`.
 *
 * The database already refuses everything that matters: a grant that names no
 * principal, one that has expired, one presented by an engineer it does not
 * name. This is the screen that makes the mechanism usable without an INSERT,
 * and it adds the three constraints that belong to *policy* rather than to
 * enforcement.
 *
 *   - **A maximum duration.** Nothing here can be granted for a month. The
 *     database enforces that a grant expires; how soon is a decision, and
 *     "until someone remembers to revoke it" is the decision people make when
 *     the form lets them.
 *   - **Write access is typed for, not picked from a list.** A radio button
 *     labelled `write` next to one labelled `read` gets clicked. Escalation
 *     should feel like a different act, because it is one.
 *   - **Support principals cannot reach this action at all.** The policy would
 *     refuse them anyway — they hold no role in this deployment, so
 *     `app.has_permission` finds nothing — but failing here is clearer than
 *     failing at the policy, and it means the rule is stated in the place
 *     someone reads.
 */

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { principals, supportGrants, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { echo, fail, fieldErrors, succeed, type ActionState } from '@/lib/form-state'

/**
 * The longest a grant may run.
 *
 * Eight hours is a working day: long enough that nobody re-authorises in the
 * middle of an investigation, short enough that a forgotten grant is gone by
 * the morning. A support engagement that genuinely needs longer needs a second
 * grant and a second decision, which is the point.
 */
const MAX_HOURS = 8
const DEFAULT_HOURS = 2

const grantSchema = z.object({
  principalId: z.uuid('Choose a support engineer'),
  branchIds: z.array(z.uuid()),
  hours: z.coerce
    .number()
    .int()
    .min(1, 'At least an hour')
    .max(MAX_HOURS, `At most ${MAX_HOURS} hours — grant again if the work runs long`),
  reason: z.string().trim().min(6, 'Give the ticket or the request this is for').max(300),
  /*
    Typed, not toggled.

    The confirmation phrase is the whole mechanism: read access is one click,
    write access requires the person granting it to have read the sentence
    saying what it means. Everything else about the escalation is enforced in
    the policy; this is the part that has to happen in a human's head.
  */
  escalate: z
    .string()
    .trim()
    .optional()
    .transform((v) => v ?? ''),
})

export async function grantSupportAccess(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.users.write')

  // Belt and braces against the one path the policy cannot express as neatly:
  // a support principal must never be the one handing out support access.
  if (session.actor.type === 'support') {
    return fail({ principalId: 'A support session cannot grant support access' }, echo(form))
  }

  const parsed = grantSchema.safeParse({
    principalId: form.get('principalId'),
    branchIds: form
      .getAll('branchIds')
      .filter((v): v is string => typeof v === 'string' && v !== ''),
    hours: form.get('hours') ?? DEFAULT_HOURS,
    reason: form.get('reason') ?? '',
    escalate: form.get('escalate'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const { principalId, branchIds, hours, reason, escalate } = parsed.data

  const wantsWrite = form.get('scope') === 'write'
  if (wantsWrite && escalate.toUpperCase() !== 'GRANT WRITE') {
    return fail({ escalate: 'Type GRANT WRITE to confirm write access' }, echo(form))
  }

  /**
   * The grant must name a `support` principal.
   *
   * Without this check, the form is a way to hand a *staff* principal a second
   * route to the data that bypasses their branch roles — the support policies
   * are conditioned on the principal type, so it would in fact grant nothing,
   * but a control that silently does nothing is worse than one that refuses.
   */
  const target = await withActor(session.actor, async (tx) => {
    const [row] = await tx
      .select({ id: principals.id, type: principals.type, isActive: principals.isActive })
      .from(principals)
      .where(eq(principals.id, principalId))
      .limit(1)
    return row
  })

  if (!target || target.type !== 'support') {
    return fail({ principalId: 'Not a support engineer' }, echo(form))
  }
  if (!target.isActive) {
    return fail({ principalId: 'That engineer is deactivated' }, echo(form))
  }

  /**
   * An administrator may only open the branches they themselves hold.
   *
   * The same rule `saveUser` applies, for the same reason: otherwise
   * `admin.users.write` in one branch is a route to every branch in the system
   * — grant a support session across the group, then read the trail.
   */
  const holds = [...session.branchRoles.keys()]
  const outside = branchIds.filter((id) => !holds.includes(id))
  if (outside.length > 0) {
    return fail({ branchIds: 'You can only open branches you hold yourself' }, echo(form))
  }

  /*
    An empty selection means the branches the granting administrator holds —
    never "the whole deployment".

    The database reads an empty array as every branch, which is the right
    default for a schema-level primitive and the wrong one for a form: a blank
    multi-select is what someone submits when they have not thought about it,
    and it must not be the widest possible grant.
  */
  const scopeBranches = branchIds.length > 0 ? branchIds : holds

  await withActor(session.actor, async (tx) => {
    await tx.insert(supportGrants).values({
      principalId,
      grantedById: session.actor.principalId,
      branchIds: scopeBranches,
      scope: wantsWrite ? 'write' : 'read',
      reason,
      expiresAt: sql`now() + make_interval(hours => ${hours})`,
    })
  })

  // The banner lives in the ops layout, so every internal path shows it.
  revalidatePath('/', 'layout')
  return succeed()
}
