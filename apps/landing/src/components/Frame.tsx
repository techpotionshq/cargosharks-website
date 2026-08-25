import type { ReactNode } from 'react'
import { LockSimple } from '@phosphor-icons/react/dist/ssr'
import type { Lang } from '@/content/copy'

/**
 * Window chrome around a product capture.
 *
 * Three sections show a screenshot and all three used to draw their own frame —
 * a rounded border here, a border plus a fake title bar there, a bare image in
 * the third — so the same product appeared on one page in three different
 * containers. That is the kind of inconsistency a reader cannot name and does
 * register: it makes a page look assembled rather than designed.
 *
 * The chrome is not decoration. A screenshot in a bare rectangle reads as a
 * *picture*, and the eye files it with the illustrations; the same screenshot
 * behind a title bar reads as a *screen*, and the eye reads it. That is the
 * whole trick a photograph of a laptop is playing, at none of its weight.
 *
 * **`dir` is the reason this is a component rather than three copies of a div.**
 * The traffic-light dots and the address bar sit at opposite ends of the bar,
 * and which end is which is a property of the document's direction. Written as
 * logical properties in one place it is right in both languages; written three
 * times it was right in the language whoever wrote it was testing in.
 */
export function Frame({
  url,
  lang,
  label,
  children,
}: {
  url?: string
  lang: Lang
  /** Shown instead of an address, for a frame standing in for an app rather than a page. */
  label?: string
  children: ReactNode
}) {
  return (
    <div className="frame">
      <div className="flex items-center gap-3 border-b border-edge bg-void/40 px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-1.5">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-2.5 rounded-full bg-edge-lit" />
          ))}
        </div>

        {/* The address sits in a pill of its own, centred in the remaining
            space. Latin and left-to-right even on the Arabic page, because a
            URL is: `dir="ltr"` here is the same call the product makes on a
            container number. */}
        <div className="flex min-w-0 flex-1 justify-center">
          <p
            dir="ltr"
            className="flex max-w-full items-center gap-1.5 truncate rounded-md bg-void/60 px-3 py-1 font-mono text-[0.7rem] text-ink-faint"
          >
            {url ? <LockSimple weight="fill" className="size-2.5 shrink-0 text-positive" /> : null}
            <span className={label && !url ? (lang === 'ar' ? 'arabic' : '') : ''}>{url ?? label}</span>
          </p>
        </div>

        {/* Balances the dots so the address sits on the frame's true centre
            rather than pushed a dot's width off it. */}
        <div aria-hidden="true" className="w-[3.25rem] shrink-0" />
      </div>

      {children}
    </div>
  )
}
