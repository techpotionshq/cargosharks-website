'use client'

/**
 * "Send sign-in link" — A7.
 *
 * One form posting to `sendUserSignInLink`, with the outcome beside the
 * button rather than in a toast that fades: "no email was sent, the mail
 * service is not configured" is a sentence an administrator needs to still be
 * reading when they reach for the phone, and "sent" is only ever said when the
 * mail service took the message. On a deployment that logs mail instead of
 * sending it, an invitation's link is shown here to pass on by hand.
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
          className={`max-w-xs text-micro ${state.ok ? 'text-positive' : 'text-caution'}`}
        >
          {state.message}
        </span>
      ) : null}
      {/*
        The link itself, when mail is set to log only and nothing was sent.

        A field to copy from rather than an anchor: it is for the person being
        invited, and following it here would start setting their password in
        the administrator's own browser. Left to right whatever the page
        direction, because it is a URL.
      */}
      {state.link ? (
        <label className="flex w-full max-w-xs flex-col gap-1">
          <span className="text-micro text-ink-muted">{state.link.label}</span>
          <input
            readOnly
            dir="ltr"
            value={state.link.href}
            onFocus={(event) => event.currentTarget.select()}
            className="ref h-8 w-full rounded-sm border border-line bg-surface-sunken px-2 text-micro text-ink"
          />
        </label>
      ) : null}
    </div>
  )
}
