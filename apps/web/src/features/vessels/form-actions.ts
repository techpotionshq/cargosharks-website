'use server'

/**
 * Vessel identity on a job — typed by a person, or a suggestion they confirm.
 *
 * Both actions write `jobs.vessel_imo` and `jobs.vessel_mmsi` and nothing
 * else. The position follows from the feed within a few minutes, when the
 * service next refreshes the set of MMSIs it follows; no action here talks to
 * a provider.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { normaliseImo, normaliseMmsi } from '@qabandi/core'
import { setJobVesselIdentity, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { echo, fail, succeed, type ActionState } from '@/lib/form-state'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

async function save(form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const t = await getTranslations('vesselPosition')

  const jobId = read(form, 'jobId')
  const rawImo = read(form, 'imo')
  const rawMmsi = read(form, 'mmsi')
  if (!jobId) return fail({ _: t('notFound') })

  // Blank clears; anything typed must be valid, never silently dropped.
  const imo = rawImo ? normaliseImo(rawImo) : null
  const mmsi = rawMmsi ? normaliseMmsi(rawMmsi) : null
  const errors: Record<string, string> = {}
  if (rawImo && !imo) errors.imo = t('imoInvalid')
  if (rawMmsi && !mmsi) errors.mmsi = t('mmsiInvalid')
  if (Object.keys(errors).length > 0) return fail(errors, echo(form))

  const found = await withActor(session.actor, (tx) =>
    setJobVesselIdentity(tx, jobId, { imo, mmsi }),
  )
  if (!found) return fail({ _: t('notFound') })

  revalidatePath(`/jobs/${jobId}`)
  return succeed(jobId)
}

/** The identity dialog on the job's vessel card. */
export const saveVesselIdentity = refuseForbidden(async function saveVesselIdentity(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  // The demo is read-only; checked here, in the action, where the fixture
  // invariant looks for it.
  const demo = await demoReadOnly(form)
  if (demo) return demo
  return save(form)
})

/**
 * A suggestion, confirmed by the person looking at it.
 *
 * The form carries the suggested MMSI and IMO as hidden fields; they are
 * validated exactly as typed ones are, so a tampered form gets the same
 * refusal as a mistyped one.
 */
export const confirmVesselSuggestion = refuseForbidden(async function confirmVesselSuggestion(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  // The demo is read-only; checked here, in the action, where the fixture
  // invariant looks for it.
  const demo = await demoReadOnly(form)
  if (demo) return demo
  return save(form)
})
