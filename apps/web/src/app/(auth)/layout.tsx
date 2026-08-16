/**
 * The authentication shell — deliberately almost nothing.
 *
 * Sign-in used to sit inside the public shell, which wrapped it in the
 * marketing header and footer: a logo linking to a landing page, a "Sign in"
 * button pointing at the page you were already on, a tracking link, an address
 * block and a copyright line. Every one of those is a way out of the only task
 * this screen has.
 *
 * So there is no header and no footer here. The page fills the viewport and the
 * form is the only thing on it. What the operator's identity needs to say is
 * said by the page itself, which carries the mark, the year the business was
 * founded and the branches it runs — better placed there than in a navigation
 * bar above it.
 *
 * The language switch is the one control that survives, floated in the corner,
 * because an Arabic-first operator should not have to sign in through an
 * English form to change the language afterwards.
 */

import { LanguageSwitch } from '@/ui/preferences'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-surface">
      {/*
        `end-4` rather than `right-4`: under Arabic the whole layout mirrors and
        the switch moves to the left with it, which is where a reader in that
        direction looks for it.
      */}
      <div className="absolute top-4 end-4 z-10">
        <LanguageSwitch />
      </div>
      {children}
    </div>
  )
}
