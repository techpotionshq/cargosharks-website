/**
 * A sentence the page needs to say out loud, above the content it is about.
 *
 * Six screens had already grown their own version of this strip — the overdue
 * invoice, the expiring quotation, the finance reconciliation warning, the
 * unpriced lane — each hand-rolled with slightly different padding, a
 * different corner radius and, on two of them, no glyph at all. Colour alone
 * carries none of that to a reader who cannot see the difference between amber
 * and red, so the glyph is not decoration and is chosen here rather than at
 * each call site.
 *
 * Deliberately not a toast. Everything that reaches this component is
 * something the operator can act on — load the rate card, chase the payment,
 * raise an RFQ — and a message that removes itself after four seconds is a
 * message the person who stepped away never saw.
 */

import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'

export type NoticeTone = 'caution' | 'critical' | 'info' | 'positive'

const TONE_CLASS: Record<NoticeTone, string> = {
  caution: 'border-caution/35 bg-caution-soft/50 text-caution',
  critical: 'border-critical/40 bg-critical-soft/50 text-critical',
  info: 'border-info/30 bg-info-soft/50 text-info',
  positive: 'border-positive/30 bg-positive-soft/50 text-positive',
}

/** The glyph each tone wears, so one tone never arrives with two faces. */
const TONE_ICON: Record<NoticeTone, IconName> = {
  caution: 'alert',
  critical: 'alert',
  info: 'assistant',
  positive: 'check',
}

export function Notice({
  children,
  tone = 'info',
  icon,
  className,
}: {
  readonly children: ReactNode
  readonly tone?: NoticeTone
  /** Overrides the tone's own glyph where the subject has a better one. */
  readonly icon?: IconName
  readonly className?: string
}) {
  return (
    <div
      /*
        A live region with the right urgency, and a `div` so it may hold more
        than a phrase.

        It was a bare `<p>`: nothing announced it, so a refusal that arrived
        after a click — "this lane has no rate card" — was silent to anyone
        not looking at that strip, and a notice wrapping a list was invalid
        markup. Critical interrupts (`alert`); everything else waits its turn
        (`status`), because a page that opens with three alerts has taught its
        reader to ignore them.
      */
      role={tone === 'critical' ? 'alert' : 'status'}
      /*
        `items-start`, not `items-center`: a refusal is often two lines long,
        and a centred glyph beside wrapped text floats in the middle of the
        block instead of marking where it begins.
      */
      className={[
        'flex items-start gap-2 rounded-card border px-4 py-3 text-[0.875rem]',
        TONE_CLASS[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name={icon ?? TONE_ICON[tone]} size={16} className="mt-0.5 shrink-0" />
      {/* `break-words`: an error code or an address with no spaces in it
          pushed the integrations screen 63px past a phone's edge. */}
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}
