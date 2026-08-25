'use client'

/**
 * The two-factor forms — the challenge, and the two steps of enrolment.
 *
 * Client components for the same reasons `SignInForm` and the reset forms are:
 * a server-side failure has to re-render without losing what was typed, and a
 * slow submit must not be clicked twice. `useActionState` does both.
 */

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { beginEnrolment, completeEnrolment, verifyChallenge } from '../two-factor'
import type { ChallengeState, EnrolState } from '../two-factor'

const FIELD =
  'h-10 rounded-sm border border-line bg-surface-sunken px-3 text-[0.9375rem] text-ink focus:border-brand focus:bg-surface focus:outline-none'

/**
 * The code field.
 *
 * `inputMode="numeric"` puts a phone on the digit pad, and `autoComplete`
 * `one-time-code` is what lets a password manager or an iOS keyboard offer the
 * code directly. `dir="ltr"` because six digits are read left to right in
 * Arabic exactly as in English, and the surrounding page is right to left.
 *
 * Deliberately not `type="number"`: it strips leading zeros in some browsers,
 * and a TOTP code beginning `0` is one code in ten.
 */
const CODE_FIELD = `${FIELD} text-center font-mono text-xl tracking-[0.4em]`

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

function Alert({ children }: { readonly children: string }) {
  return (
    <p
      role="alert"
      className="rounded-sm bg-critical-soft px-3 py-2.5 text-[0.8125rem] leading-snug font-medium text-critical ring-1 ring-critical/25 ring-inset"
    >
      {children}
    </p>
  )
}

function CodeField({ label }: { readonly label: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      <input
        name="code"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={7}
        dir="ltr"
        className={CODE_FIELD}
      />
    </label>
  )
}

export interface ChallengeLabels {
  readonly code: string
  readonly submit: string
  readonly submitting: string
}

/** Finishing a sign-in on an account that already has an authenticator. */
export function ChallengeForm({ labels }: { readonly labels: ChallengeLabels }) {
  const [state, action] = useActionState<ChallengeState, FormData>(verifyChallenge, {})

  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <Alert>{state.error}</Alert> : null}
      <CodeField label={labels.code} />
      <Submit label={labels.submit} pendingLabel={labels.submitting} />
    </form>
  )
}

export interface EnrolLabels {
  readonly password: string
  readonly passwordHint: string
  readonly begin: string
  readonly beginning: string
  readonly scan: string
  readonly manual: string
  readonly backupTitle: string
  readonly backupHint: string
  readonly code: string
  readonly submit: string
  readonly submitting: string
}

/**
 * Enrolment, both steps, in one component.
 *
 * One component because the second step is only reachable through the first
 * and needs what the first returned. Splitting them across two routes would
 * mean parking a freshly issued secret and a set of backup codes somewhere
 * between requests — in a cookie, in a cache, in the URL — and every one of
 * those is a worse place for them than a React state that dies with the tab.
 *
 * The cost is honest and worth naming: a reload before the code is confirmed
 * loses the backup codes on screen. The secret itself survives, because the
 * library has stored it, so the operator repeats step one and is issued a
 * fresh set. Nobody is stranded.
 */
export function EnrolForm({ labels }: { readonly labels: EnrolLabels }) {
  const [begun, beginAction] = useActionState<EnrolState, FormData>(beginEnrolment, {})
  const [verified, verifyAction] = useActionState<ChallengeState, FormData>(completeEnrolment, {})

  if (!begun.totpUri) {
    return (
      <form action={beginAction} className="flex flex-col gap-3">
        {begun.error ? <Alert>{begun.error}</Alert> : null}

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">{labels.password}</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            autoFocus
            className={FIELD}
          />
        </label>

        <p className="text-[0.8125rem] leading-snug text-ink-muted">{labels.passwordHint}</p>
        <Submit label={labels.begin} pendingLabel={labels.beginning} />
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.8125rem] leading-snug text-ink-muted">{labels.scan}</p>

      {/*
        The QR, rendered to SVG on the server and inlined.

        `dangerouslySetInnerHTML` is the only way to put a server-generated SVG
        into the tree, and it is safe here in the way the brand style block in
        `app/layout.tsx` is safe: the markup comes from `qrcode` encoding a URI
        this application constructed, never from anything a person typed.

        On a white square regardless of theme, because a QR code is read by a
        camera that expects dark modules on a light field — inverted, half the
        scanners in a freight office simply fail.
      */}
      <div className="flex justify-center rounded-sm bg-white p-4">
        {/* eslint-disable-next-line react/no-danger -- generated by qrcode from an otpauth URI */}
        <div
          className="[&>svg]:h-auto [&>svg]:w-55"
          dangerouslySetInnerHTML={{ __html: begun.qr ?? '' }}
        />
      </div>

      {/*
        The secret in text, for the phone that cannot scan.

        `break-all` because it is a long unbroken base32 string and it must wrap
        inside the card rather than push the layout wider than the viewport.
      */}
      <details className="text-[0.8125rem] text-ink-muted">
        <summary className="cursor-pointer select-none">{labels.manual}</summary>
        <code
          dir="ltr"
          className="mt-2 block break-all rounded-sm bg-surface-sunken p-2 font-mono text-[0.75rem] text-ink"
        >
          {secretFrom(begun.totpUri)}
        </code>
      </details>

      {begun.backupCodes?.length ? (
        <div className="rounded-sm border border-caution/30 bg-caution-soft p-3">
          <p className="text-[0.8125rem] font-semibold text-caution">{labels.backupTitle}</p>
          <p className="mt-1 text-[0.8125rem] leading-snug text-ink-muted">{labels.backupHint}</p>
          <ul dir="ltr" className="mt-2 grid grid-cols-2 gap-1 font-mono text-[0.8125rem] text-ink">
            {begun.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <form action={verifyAction} className="flex flex-col gap-3">
        {verified.error ? <Alert>{verified.error}</Alert> : null}
        <CodeField label={labels.code} />
        <Submit label={labels.submit} pendingLabel={labels.submitting} />
      </form>
    </div>
  )
}

/**
 * The base32 secret out of the `otpauth://` URI, for manual entry.
 *
 * Parsed rather than returned separately by the action, so there is exactly
 * one thing to carry across the boundary and no chance of a URI and a secret
 * that disagree.
 */
function secretFrom(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}
