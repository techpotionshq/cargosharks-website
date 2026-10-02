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
import { FOCUS_RING } from '@/ui/control'

interface Labels {
  readonly email: string
  readonly password: string
  readonly submit: string
  readonly submitting: string
}

/**
 * Credentials to seed the fields with on first render — the public demo only,
 * where the operations persona is pre-filled so a prospect can sign in with one
 * click. A submission that comes back with an error keeps what was typed
 * (`state.email`) ahead of these.
 */
interface Defaults {
  readonly email: string
  readonly password: string
}

const FIELD = `h-10 rounded-sm border border-line-strong bg-surface-sunken px-3 text-[0.9375rem] text-ink focus:bg-surface ${FOCUS_RING}`

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

export function SignInForm({
  labels,
  defaults,
}: {
  readonly labels: Labels
  readonly defaults?: Defaults
}) {
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

      {/*
        The two ids are load-bearing: on the public demo deployment the panel
        above these fields fills them by id — `demo-panel.tsx`.
      */}
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{labels.email}</span>
        <input
          type="email"
          name="email"
          id="sign-in-email"
          required
          defaultValue={state.email ?? defaults?.email ?? ''}
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
          id="sign-in-password"
          required
          defaultValue={defaults?.password ?? ''}
          autoComplete="current-password"
          dir="ltr"
          className={FIELD}
        />
      </label>

      <Submit labels={labels} />
    </form>
  )
}
