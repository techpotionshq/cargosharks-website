'use client'

/**
 * The confirmation that something worked.
 *
 * Every create-and-edit dialog in the product closes on success, and until
 * this existed that was the only acknowledgement there was: the dialog
 * vanished, and whether the record had saved or the dialog had simply been
 * dismissed was something you found out by scanning the page. For a status
 * move that changes only a pill three cards down, nothing on screen changed
 * at all where the person was looking.
 *
 * Deliberately narrow. `Notice` says why it is not a toast — anything a person
 * has to *act on* stays on the page until it is dealt with. This carries only
 * "done", which is safe to lose: the page behind it already shows the result,
 * and the line is a courtesy that says so out loud. Which is also why it is a
 * polite live region and never an alert — it must not interrupt a screen
 * reader that is reading something else.
 *
 * A window event rather than a context. The emitter is a dialog inside a page
 * and the region is in the layout, two server-rendered trees apart; a provider
 * would have to wrap the whole layout and turn it client-side to connect them.
 * With no region mounted — a screen outside the ops and settings shells —
 * `toast()` is a no-op, which is the right failure.
 */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icon'

const EVENT = 'qabandi:toast'

/**
 * Where the thing that was just made can be opened.
 *
 * For a click that creates a record somewhere else — a draft invoice from the
 * unbilled list, a shipment from an accepted quotation. The row that was
 * clicked disappears with the revalidation, so a link drawn beside it would
 * vanish with it; the toast outlives the row (QA P2-6).
 */
export interface ToastLink {
  readonly href: string
  readonly label: string
}

interface Detail {
  readonly message?: string
  readonly link?: ToastLink
}

/** Says "done" in the region, if there is one. Omit the message for the default. */
export function toast(message?: string, link?: ToastLink): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { message, link } }))
}

interface Entry {
  readonly id: number
  readonly message: string
  readonly link?: ToastLink
}

/** Long enough to read a sentence twice, short enough not to linger over work. */
const VISIBLE_MS = 5000

export function Toaster({
  labels,
}: {
  readonly labels: { readonly saved: string; readonly dismiss: string }
}) {
  const [entries, setEntries] = useState<readonly Entry[]>([])
  const next = useRef(0)

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    function onToast(event: Event) {
      const detail = (event as CustomEvent<Detail | undefined>).detail
      const message = detail?.message || labels.saved
      const id = (next.current += 1)
      // Newest last, and never more than three: a burst of saves is one
      // thing happening, not a stack to read.
      setEntries((current) => [...current.slice(-2), { id, message, link: detail?.link }])
      const timer = setTimeout(() => {
        timers.delete(timer)
        setEntries((current) => current.filter((entry) => entry.id !== id))
      }, VISIBLE_MS)
      timers.add(timer)
    }
    window.addEventListener(EVENT, onToast)
    return () => {
      window.removeEventListener(EVENT, onToast)
      for (const timer of timers) clearTimeout(timer)
    }
  }, [labels.saved])

  return (
    /*
      The region is always in the DOM, empty when idle. A live region that is
      inserted together with its first message is one most screen readers
      never register, so they announce nothing the first time it matters.

      Bottom-centre on a phone, where the thumb is not; top-end on a desk,
      under the bar, where it covers no table's total row.
    */
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col items-center gap-2 md:inset-x-auto md:end-6 md:top-16 md:bottom-auto md:items-end"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-card border border-positive/30 bg-surface-raised py-2.5 ps-3 pe-1.5 text-body text-ink shadow-pop motion-safe:animate-[qb-modal-in_140ms_ease-out]"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive">
            <Icon name="check" size={14} weight="bold" />
          </span>
          <span className="min-w-0">
            {entry.message}
            {entry.link ? (
              <Link
                href={entry.link.href}
                className="ms-2 font-medium text-accent underline-offset-2 hover:underline"
              >
                {entry.link.label}
              </Link>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => setEntries((current) => current.filter((e) => e.id !== entry.id))}
            aria-label={labels.dismiss}
            className="flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
