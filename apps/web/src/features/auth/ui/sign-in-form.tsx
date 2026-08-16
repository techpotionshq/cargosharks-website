'use client'

/**
 * The credential form.
 *
 * One of very few client components in the application, and it earns it: the
 * form has to render a server-side validation failure without losing what the
 * operator typed, and show a pending state so a slow sign-in is not clicked
 * twice. `useActionState` does both against the server action.
 */

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { signIn, type SignInState } from '../actions'

interface Labels {
  readonly email: string
  readonly password: string
  readonly submit: string
  readonly submitting: string
}

const FIELD =
  'h-10 rounded-sm border border-line bg-surface-sunken px-3 text-[0.9375rem] text-ink focus:border-brand focus:bg-surface focus:outline-none'

function Submit({ labels }: { readonly labels: Labels }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-sm bg-brand px-4 text-[0.9375rem] font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-60"
    >
      {pending ? labels.submitting : labels.submit}
    </button>
  )
}

export function SignInForm({ labels }: { readonly labels: Labels }) {
  const [state, action] = useActionState<SignInState, FormData>(signIn, {})

  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? (
        <p
          role="alert"
          className="rounded-sm bg-critical-soft px-3 py-2 text-[0.8125rem] font-medium text-critical ring-1 ring-critical/25 ring-inset"
        >
          {state.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{labels.email}</span>
        <input
          type="email"
          name="email"
          required
          defaultValue={state.email ?? ''}
          autoComplete="username"
          dir="ltr"
          className={FIELD}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{labels.password}</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          dir="ltr"
          className={FIELD}
        />
      </label>

      <Submit labels={labels} />
    </form>
  )
}
