'use client'

/**
 * The credentials, on the screen — the public demo only.
 *
 * A demo whose password is in an email is a demo nobody gets into, and a
 * prospect who has clicked through from a marketing page will not hunt for a
 * login. So the three personas and the one password are printed above the
 * form, and each row fills it.
 *
 * A client component because filling a field is a click, and the fields are
 * `defaultValue` inputs the form owns — assigning `.value` on an uncontrolled
 * input is exactly what a browser autofill does, and needs no state here. It
 * is reached by id rather than by ref because the inputs belong to
 * `SignInForm`, which is a sibling; a shared ref would mean lifting both into
 * a parent client component and turning the sign-in page into one, for a
 * panel that renders on one deployment.
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
  readonly body: string
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
  function fill(email: string): void {
    const emailField = document.getElementById('sign-in-email')
    const passwordField = document.getElementById('sign-in-password')
    if (!(emailField instanceof HTMLInputElement)) return
    if (!(passwordField instanceof HTMLInputElement)) return

    emailField.value = email
    passwordField.value = password
    // Focus the password rather than the email: the fields are now full, and
    // this is where the person's eye goes to check before submitting.
    passwordField.focus()
  }

  return (
    <section className="mt-6 rounded-sm border border-line bg-surface-sunken p-3.5">
      <p className="eyebrow flex items-center gap-1.5 text-brand">
        <Icon name="live" size={13} />
        {labels.title}
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-snug text-ink-muted">{labels.body}</p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {personas.map((persona) => (
          <li key={persona.email}>
            <button
              type="button"
              onClick={() => fill(persona.email)}
              className="flex w-full items-center gap-2.5 rounded-sm border border-line bg-surface px-2.5 py-2 text-start transition-colors hover:border-brand hover:bg-brand-soft"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-ink">
                <Icon name={persona.icon} size={14} />
              </span>
              {/*
                Three stacked lines rather than a name column and an address
                column. Side by side, the address squeezed the label until
                every row read "Operations — the for…" — an agency name and an
                email address are both long, and neither can be the one that
                gets cut.
              */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-semibold text-ink">
                  {persona.role}
                </span>
                <span className="block truncate text-[0.75rem] text-ink-muted">
                  {persona.name} · {persona.org}
                </span>
                {/*
                  No `dir="ltr"`, deliberately. An address is all Latin
                  letters with neutrals (`@`, `.`) between them, so bidi
                  resolves it as one left-to-right run inside an Arabic
                  paragraph anyway — while the attribute *also* forced the
                  line's alignment to the left, leaving the address hanging off
                  the wrong edge of a right-aligned row.
                */}
                <span className="mt-0.5 block truncate text-[0.75rem] text-ink-subtle">
                  {persona.email}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-3 flex items-center gap-2 text-[0.75rem] text-ink-muted">
        <span className="eyebrow">{labels.password}</span>
        <code dir="ltr" className="numeric rounded-sm bg-surface px-1.5 py-0.5 text-ink">
          {password}
        </code>
      </p>
    </section>
  )
}
