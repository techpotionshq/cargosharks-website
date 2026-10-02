'use server'

/**
 * The intake agent's settings, per branch — FR-AD-03, FR-EQ-02.
 *
 * How long the agent waits for a customer to finish typing, how patient it is
 * before handing an enquiry to a person, and what a complete enquiry has to
 * state. Each is a row an administrator changes on a screen and the next turn
 * reads — no environment variable, no release.
 *
 * ## Whose authority
 *
 * `admin.mailboxes.write`, held *in the branch being changed* (`assertCanIn`,
 * A2). It is the authority that already decides which mailboxes and WhatsApp
 * numbers feed a branch's board; deciding what the bot on those channels says
 * to that branch's customers is the same decision one step on. The database
 * enforces the same rule (`intake_settings_write` in 0057), so this check is
 * the friendly refusal and the policy the real one.
 *
 * ## The default row is not edited here
 *
 * A branch with no row of its own inherits the default, and its first save
 * writes its own row. The default itself is the seed's, like the notification
 * template defaults: changing what *every* office inherits is not one branch
 * administrator's call.
 *
 * ## Requirements are replaced, never merged, and never deleted
 *
 * Saving a branch's required details retires its previous rows (`is_active`
 * false) and writes the new set, so the audit trail keeps "what did Kuwait
 * require in March". `loadIntakeRequirements` reads a branch's own set in
 * place of the default the moment it has one.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  branches,
  intakeRequirements,
  intakeSettings,
  loadIntakeRequirements,
  loadIntakeSettings,
  withActor,
} from '@qabandi/db'
import {
  INTAKE_FIELDS,
  INTAKE_MODES,
  INTAKE_SETTING_BOUNDS,
  type IntakeField,
  type IntakeMode,
} from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn, branchesWhere } from '@/lib/permissions'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotIntakeSettings } from '@/lib/pilot/fixtures'
import type { IntakeSettingsRowLike } from '@/lib/pilot/types'
import { echo, fail, succeed, type ActionState } from '@/lib/form-state'
import { refuseForbidden } from '@/lib/refuse-forbidden'

/**
 * The requirement choices the form offers, per mode — `all` meaning every mode.
 *
 * A fixed menu rather than free rows, because a requirement is only as good as
 * the agent's ability to ask for it in a sentence: every key here has a phrase
 * in both languages in `core/intake.ts`. `weightOrVolume` is the one any-of
 * choice, because "either figure" is how a shared-space rate is priced.
 */
const FIELD_CHOICES: Readonly<Record<'all' | IntakeMode, readonly string[]>> = {
  all: ['mode', 'origin', 'destination', 'commodity', 'readyOn', 'incoterm'],
  sea_fcl: ['containerCount', 'containerType', 'pieces'],
  sea_lcl: ['weightOrVolume', 'grossWeightKg', 'volumeCbm', 'pieces', 'dimensions'],
  air: ['weightOrVolume', 'grossWeightKg', 'volumeCbm', 'pieces', 'dimensions'],
  land: ['weightOrVolume', 'grossWeightKg', 'volumeCbm', 'pieces', 'dimensions'],
  courier: ['weightOrVolume', 'grossWeightKg', 'pieces', 'dimensions'],
}

export async function intakeFieldChoices(): Promise<Record<string, readonly string[]>> {
  return FIELD_CHOICES
}

/** The fields a requirement key stands for. */
function fieldsFor(key: string): IntakeField[] {
  if (key === 'weightOrVolume') return ['grossWeightKg', 'volumeCbm']
  return (INTAKE_FIELDS as readonly string[]).includes(key) ? [key as IntakeField] : []
}

/** Every branch this administrator may configure the agent for, with what applies there now. */
export async function listIntakeSettings(): Promise<IntakeSettingsRowLike[]> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')
  if (usePilotFixtures()) return pilotIntakeSettings()

  const administered = branchesWhere(session, 'admin.mailboxes.write')
  if (administered.length === 0) return []

  return withActor(session.actor, async (tx) => {
    const rows = await tx
      .select({ id: branches.id, code: branches.code })
      .from(branches)
      .where(inArray(branches.id, administered))
      .orderBy(asc(branches.code))

    const own = await tx
      .select({ branchId: intakeSettings.branchId })
      .from(intakeSettings)
      .where(inArray(intakeSettings.branchId, administered))
    const ownRequirementRows = await tx
      .select({ branchId: intakeRequirements.branchId })
      .from(intakeRequirements)
      .where(
        and(
          inArray(intakeRequirements.branchId, administered),
          eq(intakeRequirements.isActive, true),
        ),
      )
    const withOwn = new Set(own.map((r) => r.branchId))
    const withOwnRequirements = new Set(ownRequirementRows.map((r) => r.branchId))

    const out: IntakeSettingsRowLike[] = []
    for (const branch of rows) {
      const settings = await loadIntakeSettings(tx, branch.id)
      const requirements = await loadIntakeRequirements(tx, branch.id)
      out.push({
        branchId: branch.id,
        branchCode: branch.code,
        inherited: !withOwn.has(branch.id),
        ...settings,
        ownRequirements: withOwnRequirements.has(branch.id),
        requirements: requirements.map((r) => ({ mode: r.mode, key: r.key, fields: r.fields })),
      })
    }
    return out
  })
}

const NUMBER_FIELDS = Object.keys(INTAKE_SETTING_BOUNDS) as (keyof typeof INTAKE_SETTING_BOUNDS)[]

/** Save one branch's settings and required details. */
export const saveIntakeSettings = refuseForbidden(async function saveIntakeSettings(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.mailboxes.write')
  const t = await getTranslations('intakeSettings')

  const branchId = String(form.get('branchId') ?? '')
  if (!branchId) return fail({ _: t('noBranch') })
  // In that branch, not anywhere — FR-ID-02, A2.
  assertCanIn(session, 'admin.mailboxes.write', branchId)

  const errors: Record<string, string> = {}
  const numbers: Record<string, number> = {}
  for (const name of NUMBER_FIELDS) {
    const raw = String(form.get(name) ?? '').trim()
    const value = Number(raw)
    const { min, max } = INTAKE_SETTING_BOUNDS[name]
    if (raw === '' || !Number.isInteger(value) || value < min || value > max) {
      errors[name] = t('outOfRange', { min, max })
    } else {
      numbers[name] = value
    }
  }
  if (
    numbers.whatsappMaxWaitSeconds !== undefined &&
    numbers.whatsappQuietSeconds !== undefined &&
    numbers.whatsappMaxWaitSeconds < numbers.whatsappQuietSeconds
  ) {
    errors.whatsappMaxWaitSeconds = t('waitShorterThanQuiet')
  }
  if (
    numbers.emailMaxWaitSeconds !== undefined &&
    numbers.emailQuietSeconds !== undefined &&
    numbers.emailMaxWaitSeconds < numbers.emailQuietSeconds
  ) {
    errors.emailMaxWaitSeconds = t('waitShorterThanQuiet')
  }

  const chosen: { mode: IntakeMode | null; key: string; fields: IntakeField[] }[] = []
  for (const [scope, keys] of Object.entries(FIELD_CHOICES)) {
    for (const key of keys) {
      if (form.get(`req.${scope}.${key}`) !== 'on') continue
      chosen.push({
        mode:
          scope === 'all'
            ? null
            : (INTAKE_MODES as readonly string[]).includes(scope)
              ? (scope as IntakeMode)
              : null,
        key,
        fields: fieldsFor(key),
      })
    }
  }
  if (chosen.length === 0) errors._ = t('noRequirements')
  if (Object.keys(errors).length > 0) return fail(errors, echo(form))

  const enabled = form.get('enabled') === 'on'
  await withActor(session.actor, async (tx) => {
    await tx
      .insert(intakeSettings)
      .values({ branchId, enabled, ...numbers })
      .onConflictDoUpdate({
        target: intakeSettings.branchId,
        set: { enabled, ...numbers, updatedAt: new Date() },
      })

    // Retired, not deleted — the trail keeps what this branch required before.
    await tx
      .update(intakeRequirements)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(intakeRequirements.branchId, branchId), eq(intakeRequirements.isActive, true)))
    await tx.insert(intakeRequirements).values(
      chosen.map((r, position) => ({
        branchId,
        mode: r.mode,
        key: r.key,
        fields: r.fields,
        position,
      })),
    )
  })

  revalidatePath('/settings/intake-agent')
  return succeed(branchId)
})
