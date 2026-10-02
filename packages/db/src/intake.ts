/**
 * The intake agent's configuration, read the way every caller must read it.
 *
 * Three callers — the service's turn worker, the ingest that schedules turns,
 * and the settings screen — and one rule they must not disagree on: a branch's
 * own row wins, the default row (`branch_id` null) answers otherwise, and the
 * constants in `core/intake.ts` answer if the seed never ran. Written once here
 * so "which settings apply to Kuwait" has one answer.
 *
 * Also the downstream gate, `intakeNotReady`, which rate fan-out and quote
 * auto-draft add to their candidate queries: an inbound enquiry the agent is
 * still collecting is not one an agent should be emailed about.
 */

import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  clampIntakeSettings,
  DEFAULT_INTAKE_REQUIREMENTS,
  DEFAULT_INTAKE_SETTINGS,
  INTAKE_FIELDS,
  INTAKE_MODES,
  type IntakeField,
  type IntakeMode,
  type IntakeRequirement,
  type IntakeSettings,
} from '@qabandi/core'
import { intakeConversations, intakeRequirements, intakeSettings } from './schema/index'
import type { Tx } from './actor'

/** The settings that apply to a branch, clamped — never `null`. */
export async function loadIntakeSettings(tx: Tx, branchId: string): Promise<IntakeSettings> {
  const rows = await tx
    .select()
    .from(intakeSettings)
    .where(or(eq(intakeSettings.branchId, branchId), isNull(intakeSettings.branchId)))
  // The branch row wins, chosen here rather than by an `order by` on a nullable
  // column — "nulls sort last" is true and unreadable as "a branch's own wins".
  const row = rows.find((r) => r.branchId === branchId) ?? rows.find((r) => r.branchId === null)
  if (!row) return DEFAULT_INTAKE_SETTINGS
  return clampIntakeSettings({
    enabled: row.enabled,
    whatsappQuietSeconds: row.whatsappQuietSeconds,
    whatsappMaxWaitSeconds: row.whatsappMaxWaitSeconds,
    emailQuietSeconds: row.emailQuietSeconds,
    emailMaxWaitSeconds: row.emailMaxWaitSeconds,
    clarifyCooldownHours: row.clarifyCooldownHours,
    clarifyCap: row.clarifyCap,
    humanTakeoverHours: row.humanTakeoverHours,
  })
}

/** Whether a branch has rows of its own, rather than inheriting the default. */
export async function hasBranchIntakeSettings(tx: Tx, branchId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: intakeSettings.id })
    .from(intakeSettings)
    .where(eq(intakeSettings.branchId, branchId))
    .limit(1)
  return Boolean(row)
}

/**
 * The requirements that apply to a branch.
 *
 * A branch with *any* active row of its own uses its own set entirely —
 * replacement, not a merge. A merge would make "Kuwait does not need the
 * commodity" impossible to say: there is no row a branch could add that
 * removes a default. Fields a row names that are not intake fields, and modes
 * that are not ours, are dropped rather than trusted: the column is JSON and
 * somebody may have typed it.
 */
export async function loadIntakeRequirements(
  tx: Tx,
  branchId: string,
): Promise<IntakeRequirement[]> {
  const rows = await tx
    .select({
      branchId: intakeRequirements.branchId,
      mode: intakeRequirements.mode,
      key: intakeRequirements.key,
      fields: intakeRequirements.fields,
    })
    .from(intakeRequirements)
    .where(
      and(
        eq(intakeRequirements.isActive, true),
        or(eq(intakeRequirements.branchId, branchId), isNull(intakeRequirements.branchId)),
      ),
    )
    .orderBy(asc(intakeRequirements.position), asc(intakeRequirements.createdAt))

  const own = rows.filter((r) => r.branchId === branchId)
  const defaults = rows.filter((r) => r.branchId === null)
  const chosen = own.length > 0 ? own : defaults
  if (chosen.length === 0) return [...DEFAULT_INTAKE_REQUIREMENTS]

  const known = new Set<string>(INTAKE_FIELDS)
  const modes = new Set<string>(INTAKE_MODES)
  return chosen
    .map((r) => ({
      key: r.key,
      mode: r.mode && modes.has(r.mode) ? (r.mode as IntakeMode) : null,
      fields: (Array.isArray(r.fields) ? r.fields : []).filter((f): f is IntakeField =>
        known.has(f),
      ),
    }))
    .filter((r) => r.fields.length > 0)
}

/**
 * True for an enquiry downstream automation must leave alone — an inbound
 * enquiry whose conversation the agent is still holding.
 *
 * Phrased as *not ready* so the caller writes `not (…)`-free SQL: an enquiry
 * with no conversation (typed by a coordinator, or from a branch with the agent
 * off) is never held, which is exactly how the pipeline behaved before the
 * agent existed. An enquiry an operator took over is released too — a person
 * is making the calls now, and the automation they switched on is theirs to
 * use.
 */
export function intakeNotReady(enquiryId: AnyPgColumn | SQL): SQL {
  return sql`exists (
    select 1 from ${intakeConversations} ic
     where ic.enquiry_id = ${enquiryId}
       and ic.ready_at is null
       and ic.agent_enabled
  )`
}
