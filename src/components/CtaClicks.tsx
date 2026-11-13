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
      const params = {
        cta,
        cta_location: location,
        cta_text: (link.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }

      // A click that unloads the page loses its event: GA4 queues the hit and
      // the navigation tears the queue down before it is sent. Measured on the
      // live site, the header "Get a quote" on the home page never arrived,
      // and "Try the demo" leaves the domain altogether, the CTA that matters
      // most. So a click that navigates in this tab waits for GTM to say the
      // tag fired, at most 700 ms, then goes. Clicks that open a new tab, use
      // a modifier key, jump within the page, or open a mail or phone app do
      // not unload anything and are left alone.
      const url = new URL(link.href)
      const samePageJump =
        url.origin === window.location.origin &&
        url.pathname === window.location.pathname &&
        url.hash !== ''
      const unloads =
        !event.defaultPrevented &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        link.target !== '_blank' &&
        /^https?:$/.test(url.protocol) &&
        !samePageJump
      if (!unloads) return track('cta_click', params)

      event.preventDefault()
      let gone = false
      const go = () => {
        if (gone) return
        gone = true
        window.location.assign(link.href)
      }
      track('cta_click', params, { callback: go, timeoutMs: 700 })
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])

  return null
}
