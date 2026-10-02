import 'server-only'

/**
 * A refused permission, answered as a sentence on the form — never as a 500.
 *
 * Every form action asserts its permission (`assertCan`, `assertCanIn`,
 * `assertInBranch`), and those throw `ForbiddenError`, which is right for the
 * domain: an action that is not allowed must stop where it stands, before the
 * write. But thrown out of a server action it reaches the error boundary as an
 * HTTP 500, production redacts the message, and the operator sees the whole
 * form fail with no reason (QA P2-4: choosing a branch they could see but not
 * write in, on "Capture bill" and "New invoice"). The pickers no longer offer
 * those branches, but a stale tab, a record in a branch held read-only, or a
 * role changed mid-session still reach the assertion.
 *
 * So every exported form action is wrapped: a `ForbiddenError` becomes the
 * `common.forbiddenAction` sentence in the dialog, and anything else is
 * rethrown untouched — a real fault should still be loud. The assertion stays
 * the boundary; this only decides how its refusal is spoken.
 */

import { getTranslations } from 'next-intl/server'
import type { ActionState } from '@/lib/form-state'
import { ForbiddenError } from '@/lib/permissions'

export function refuseForbidden<Args extends unknown[], State extends ActionState>(
  action: (...args: Args) => Promise<State>,
): (...args: Args) => Promise<State> {
  return async (...args: Args) => {
    try {
      return await action(...args)
    } catch (error) {
      if (!(error instanceof ForbiddenError)) throw error
      const t = await getTranslations('common')
      // Every field of a form state is optional, so a message alone is one.
      return { message: t('forbiddenAction') } as State
    }
  }
}
