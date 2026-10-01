'use client'

/**
 * "Send sign-in link" — A7.
 *
 * One form posting to `sendUserSignInLink`, with the outcome beside the
 * button rather than in a toast that fades: "no email was sent, the mail
 * service is not configured" is a sentence an administrator needs to still be
 * reading when they reach for the phone, and "sent" is only ever said when the
 * mail service took the message.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { sendUserSignInLink } from '../form-actions'

export function SignInLinkButton({
  principalId,
  label,
}: {
  readonly principalId: string
  readonly label: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendUserSignInLink, {})

  return (
    <div className="flex flex-col items-start gap-1">
      <form action={action}>
        <input type="hidden" name="principalId" value={principalId} />
        <Button type="submit" variant="secondary" size="sm" icon="enquiries" disabled={pending}>
          {label}
        </Button>
      </form>
      {state.message ? (
        <span
          role="status"
          className={`max-w-xs text-[0.6875rem] ${state.ok ? 'text-positive' : 'text-caution'}`}
        >
          {state.message}
        </span>
      ) : null}
    </div>
  )
}
