'use client'

/**
 * The assistant's button in the top bar, on a desk.
 *
 * The launcher used to float in the bottom corner of every screen, and the
 * bottom corner of every register is its total row: a charge breakdown's
 * margin and amount sat underneath a red pill that never moved. `main` had
 * grown six rems of padding to make room for it, which only moved the
 * problem to whatever was last on the page. In the bar it covers nothing, it
 * sits beside the other things that are always available (the bell, the
 * language), and the ⌘K hint has somewhere to be read.
 *
 * Phones keep a floating button — icon-only, drawn by the dock itself — because
 * a 390px bar has no room for one more labelled control.
 *
 * The dock owns the state; this only asks it to toggle and listens for what
 * it became, so `aria-expanded` tells the truth whichever way the panel was
 * opened (here, ⌘K, or the floating button).
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Icon } from '@/ui/icon'
import { ASSISTANT_SIZE_EVENT, ASSISTANT_TOGGLE_EVENT } from './assistant-events'

export function AssistantLauncher({ label }: { readonly label: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    function onSize(event: Event) {
      setOpen((event as CustomEvent<string>).detail !== 'closed')
    }
    window.addEventListener(ASSISTANT_SIZE_EVENT, onSize)
    return () => window.removeEventListener(ASSISTANT_SIZE_EVENT, onSize)
  }, [])

  // On its own page the assistant already fills the screen.
  if (pathname?.startsWith('/assistant')) return null

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(ASSISTANT_TOGGLE_EVENT))}
      aria-expanded={open}
      className={`hidden h-8 items-center gap-1.5 rounded-full border px-3 text-body-sm font-medium transition-colors md:inline-flex ${
        open
          ? 'border-accent/30 bg-accent-soft text-accent'
          : 'border-line bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink'
      }`}
    >
      <Icon name="assistant" size={15} />
      {label}
      {/* Muted ink: the subtle one on the sunken chip was 4.4:1 at 11px. */}
      <kbd className="numeric hidden rounded-sm bg-surface-sunken px-1.5 py-px text-micro font-medium text-ink-muted lg:inline">
        ⌘K
      </kbd>
    </button>
  )
}
