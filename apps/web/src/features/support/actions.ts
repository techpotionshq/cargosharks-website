'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { revokeSupportGrant } from './queries'

/**
 * Withdraw support access.
 *
 * Deliberately a one-click action on the banner rather than a page in
 * settings. The whole claim being made to a customer is that they are in
 * control of vendor access to their data, and a control that takes four clicks
 * to find is one they will not reach for while something feels wrong.
 *
 * The permission is checked here *and* in the policy — `support_grants_write`
 * requires `admin.users.write` — because this is the backstop pattern §5 is
 * built on, not because either check is redundant.
 */
export async function revokeSupportAccess(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('No session')

  assertCan(session, 'admin.users.write')

  const grantId = String(formData.get('grantId') ?? '')
  if (!grantId) throw new Error('No grant given')

  await revokeSupportGrant(session.actor, grantId)

  // The banner renders in the ops layout, so every internal path shows it.
  revalidatePath('/', 'layout')
}
