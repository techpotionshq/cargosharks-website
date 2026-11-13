'use client'

import { useEffect } from 'react'
import { ctaFor, track } from '@/lib/track'

/**
 * One click listener on the document that reports every call to action.
 *
 * Delegated rather than an `onClick` on each link: "Get a quote" and "Try the
 * demo" appear in the header, the mobile menu, the footer, every quote band,
 * the solution and comparison pages and the 404, and a link added next month
 * is counted without anyone remembering to wire it. `ctaFor` decides from the
 * href what a link is.
 *
 * Capture phase, so a component that stops propagation still gets counted.
 *
 * The href itself is never sent. The booking link carries the visitor's name
 * and email once they have sent the quote form (`lib/booking.ts`), and a
 * mailto carries our address in a form the site deliberately never writes out.
 */
export function CtaClicks() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const link = (event.target as Element | null)?.closest?.('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      const cta = ctaFor(link.href)
      if (!cta) return
      const location = link.closest('header')
        ? 'header'
        : link.closest('footer')
          ? 'footer'
          : (link.closest('section[id]')?.id ?? 'page')
      track('cta_click', {
        cta,
        cta_location: location,
        cta_text: (link.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 100),
      })
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])

  return null
}
