'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from '@phosphor-icons/react/dist/ssr'

/**
 * Back to top, for the long ones.
 *
 * The privacy policy runs to sixteen thousand pixels and the addendum is not
 * far behind. A reader who has followed a cross-reference into clause 14 has a
 * long way back, and every one of these pages carries a table of contents at
 * the top that is worth returning to.
 *
 * Hidden by default in the markup rather than shown and then hidden: rendered
 * visible, it would sit over the masthead on first paint and flick away, and a
 * reader already at the top has nothing to go back to.
 */
export function ToTop() {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <a
      href="#top"
      aria-label="Back to top"
      className={`fixed bottom-6 end-6 z-40 flex size-11 items-center justify-center rounded-full border border-edge-lit bg-void/85 text-ink-dim backdrop-blur-md transition-all hover:text-ink ${
        shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <ArrowUp weight="bold" className="size-4" />
    </a>
  )
}
