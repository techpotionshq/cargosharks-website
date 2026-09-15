'use client'

/**
 * The two password-reset forms.
 *
 * Client components for the same reason `SignInForm` is one: a server-side
 * failure has to render without losing what was typed, and a slow submit must
 * not be clicked twice. `useActionState` does both.
 *
 * They share a file because they share a visual language and are never used
 * apart — splitting them would produce two files of styling constants and one
 * more import for every reader.
 */

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  requestPasswordReset,
  resetPassword,
  type ResetRequestState,
  type ResetState,
} from '../actions'

const FIELD =
  'h-10 rounded-sm border border-line bg-surface-sunken px-3 text-[0.9375rem] text-ink focus:border-brand focus:bg-surface focus:outline-none'

function Submit({
  label,
  pendingLabel,
}: {
  readonly label: string
  readonly pendingLabel: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-sm bg-brand px-4 text-[0.9375rem] font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

function Alert({ children, tone }: { readonly children: string; readonly tone: 'error' | 'ok' }) {
  const classes =
    tone === 'error'
      ? 'bg-critical-soft text-critical ring-critical/25'
      : 'bg-positive-soft text-positive ring-positive/25'

  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-sm px-3 py-2.5 text-[0.8125rem] leading-snug font-medium ring-1 ring-inset ${classes}`}
    >
      {children}
    </p>
  )
}

export interface RequestLabels {
  readonly email: string
  readonly submit: string
  readonly submitting: string
  readonly sent: string
}

/**
 * Ask for a link.
 *
 * On success the form is *replaced* by the confirmation rather than sitting
 * underneath it. Leaving it in place invites a second submission, which sends
 * a second link and invalidates the first — and the person then follows
 * whichever email they opened first and is told their token is dead.
 */
export function ForgotPasswordForm({ labels }: { readonly labels: RequestLabels }) {
  const [state, action] = useActionState<ResetRequestState, FormData>(requestPasswordReset, {})

  if (state.done) return <Alert tone="ok">{labels.sent}</Alert>

  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{labels.email}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          defaultValue={state.email ?? ''}
          dir="ltr"
          className={FIELD}
        />
      </label>

      <Submit label={labels.submit} pendingLabel={labels.submitting} />
    </form>
  )
}

export interface ResetLabels {
  readonly password: string
  readonly confirm: string
  readonly hint: string
  readonly submit: string
  readonly submitting: string
}

/**
 * Set the new password.
 *
 * The token rides in a hidden field rather than being read from the URL by the
 * action, because a server action does not receive the page's query string —
 * it is posted to its own endpoint. Reading it in the page and passing it here
 * is the only place it can come from.
 */
export function ResetPasswordForm({
  token,
  labels,
}: {
  readonly token: string
  readonly labels: ResetLabels
}) {
  const [state, action] = useActionState<ResetState, FormData>(resetPassword, {})

  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <input type="hidden" name="token" value={token} />

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{labels.password}</span>
        <input
          type="password"
          name="password"
          required
          // `new-password` rather than `current-password`, so a password
          // manager offers to generate one instead of filling the old one in.
          autoComplete="new-password"
          dir="ltr"
          className={FIELD}
        />
        <span className="text-[0.75rem] text-ink-subtle">{labels.hint}</span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{labels.confirm}</span>
        <input
          type="password"
          name="confirm"
          required
          autoComplete="new-password"
          dir="ltr"
          className={FIELD}
        />
      </label>

      <Submit label={labels.submit} pendingLabel={labels.submitting} />
    </form>
  )
}
