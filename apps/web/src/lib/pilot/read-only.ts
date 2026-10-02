/**
 * The one answer every write gives in fixture mode.
 *
 * The pilot has nothing to write into. A server action that reached
 * `withActor` there threw "DATABASE_URL is not set", Next rendered its error
 * page, and the visitor lost the form they had just filled in — on the demo,
 * the one deployment whose whole job is to make a good first impression.
 *
 * So each action asks here first, before it reads its form, and in fixture
 * mode returns a sentence the form renders inline with what was typed echoed
 * back. Asked *after* the session and permission checks, so the demo still
 * refuses what the persona could not do on a real instance: "you may not"
 * stays truer than "this would have saved".
 *
 * `scripts/check-fixtures.mjs` fails the lint on an exported action in a
 * `'use server'` file that names neither this nor `usePilotFixtures`, which is
 * what keeps the next action from reintroducing the 500.
 */

import 'server-only'
import { getTranslations } from 'next-intl/server'
import { echo } from '@/lib/form-state'
import { usePilotFixtures } from './source'

interface ReadOnlyRefusal {
  readonly message: string
  readonly values?: Record<string, string>
}

/**
 * `null` on a real instance; otherwise the refusal, shaped to satisfy every
 * form-state type in the product (`ActionState`, `CustomerFormState`, …) —
 * they all carry an optional `message` and `values`.
 */
export async function demoReadOnly(form?: FormData): Promise<ReadOnlyRefusal | null> {
  if (!usePilotFixtures()) return null
  const t = await getTranslations('app')
  return { message: t('demoReadOnly'), values: form ? echo(form) : undefined }
}

/** The same refusal as a bare sentence, for states that carry `error`. */
export async function demoReadOnlyMessage(): Promise<string | null> {
  return (await demoReadOnly())?.message ?? null
}
