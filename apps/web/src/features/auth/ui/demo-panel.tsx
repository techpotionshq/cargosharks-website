'use client'

/**
 * The demo credentials, on the screen — the public demo only.
 *
 * One compact card, not a section: the "demo" eyebrow and the shared password
 * on the first line, a labelled button per view on the second. Clicking one
 * fills the form's own email and password fields below, so the form's single
 * "Sign in" button is the only submit on the screen. The addresses never show.
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
    <div className="mt-4 rounded-md border border-line bg-surface-sunken px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow flex items-center gap-1 text-accent">
          <Icon name="live" size={11} />
          {labels.title}
        </span>
        {/* One line always: the password broke across two at 390. */}
        <code
          dir="ltr"
          className="numeric rounded-sm bg-surface px-1.5 py-0.5 text-micro whitespace-nowrap text-ink-muted ring-1 ring-line ring-inset"
        >
          {password}
        </code>
      </div>

      {/*
        The three views, each with its name on it. They were three icons with
        the name in a tooltip, and a tooltip is nothing on a phone and a guess
        everywhere else: which view a round "user" glyph opens is the one thing
        a prospect arriving here cannot know.
      */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {personas.map((persona) => (
          <button
            key={persona.email}
            type="button"
            onClick={() => fill(persona.email)}
            title={persona.name}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-caption font-medium text-accent transition-colors hover:bg-accent hover:text-on-brand"
          >
            <Icon name={persona.icon} size={13} className="shrink-0" />
            {persona.role}
          </button>
        ))}
      </div>
    </div>
  )
}
