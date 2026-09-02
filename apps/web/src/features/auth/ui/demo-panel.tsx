'use client'

/**
 * The demo credentials, on the screen — the public demo only.
 *
 * One compact strip, not a section: the "demo" eyebrow and the shared password
 * on the lead edge, three small icon buttons for the three views pushed to the
 * trailing edge. A prospect picks a view by its icon (its name is the tooltip
 * and the `aria-label`); clicking one fills the form's own email and password
 * fields below, so the form's single "Sign in" button is the only one on the
 * screen. The addresses never show.
 *
 * A client component because the fields belong to `SignInForm`, a sibling.
 * Their values are set by id — assigning `.value` on an uncontrolled input is
 * what a browser autofill does — leaving the visible form filled and ready for
 * its own submit.
 *
 * Rendered only where `useDemoLogin()` is true. Nothing here is imported by
 * the ordinary sign-in path.
 */

import { Icon, type IconName } from '@/ui/icon'

export interface DemoPanelPersona {
  readonly email: string
  /** Already resolved to the reading language by the page. */
  readonly name: string
  readonly org: string
  readonly role: string
  readonly icon: IconName
}

interface Labels {
  readonly title: string
  readonly password: string
}

export function DemoPanel({
  personas,
  password,
  labels,
}: {
  readonly personas: readonly DemoPanelPersona[]
  readonly password: string
  readonly labels: Labels
}) {
  /** Fills the sibling form's fields; its own button does the submit. */
  function fill(email: string): void {
    const emailField = document.getElementById('sign-in-email')
    const passwordField = document.getElementById('sign-in-password')
    if (!(emailField instanceof HTMLInputElement)) return
    if (!(passwordField instanceof HTMLInputElement)) return

    emailField.value = email
    passwordField.value = password
    passwordField.focus()
  }

  return (
    <div className="mt-4 flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-2.5 py-1.5">
      <span className="eyebrow flex items-center gap-1 text-brand">
        <Icon name="live" size={11} />
        {labels.title}
      </span>
      <code
        dir="ltr"
        className="numeric rounded-sm bg-surface px-1.5 py-0.5 text-[0.6875rem] text-ink-muted ring-1 ring-line ring-inset"
      >
        {password}
      </code>

      {/* The three views, small and pushed to the trailing edge. */}
      <div className="ms-auto flex items-center gap-1">
        {personas.map((persona) => (
          <div key={persona.email} className="group relative">
            <button
              type="button"
              onClick={() => fill(persona.email)}
              aria-label={`${persona.role} — ${persona.name}`}
              className="flex size-6 items-center justify-center rounded-full bg-brand-soft text-brand-soft-ink transition-colors hover:bg-brand hover:text-on-brand"
            >
              <Icon name={persona.icon} size={13} />
            </button>
            {/*
              The view's name, revealed by pointer or keyboard
              (`group-focus-within`) and stated on `aria-label` besides — a
              tooltip a screen reader cannot announce is decoration.
            */}
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm border border-line bg-surface px-2 py-1 text-[0.6875rem] font-medium text-ink opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {persona.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
