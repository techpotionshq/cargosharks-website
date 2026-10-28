'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A demurrage counter that is not a decoration and is not sped up.
 *
 * The container it stands for is on KWD 32.000 a day, which is 0.000370 a
 * second, so the third decimal turns about every 2.7 seconds — slow enough to
 * be honest and fast enough to notice. That is the argument of the whole page
 * made before anyone has scrolled: the clock runs whether or not a person
 * remembers it.
 *
 * **Three decimals because the dinar has three.** A component here that
 * rendered money to two would be wrong in exactly the way `CLAUDE.md` says a
 * global `toFixed(2)` is wrong in the product.
 */
/**
 * Three decimals and a thousands separator, as the calculator and the product
 * print a dinar amount. `toFixed(3)` alone gave "4187.267" beside "16,588.800".
 */
const kwd = (value: number) =>
  value.toLocaleString('en-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

export function Accrue({
  from,
  perDay,
  className,
}: {
  from: number
  perDay: number
  className?: string
}) {
  const [text, setText] = useState(kwd(from))
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const perSecond = perDay / 86400
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    /**
     * Reduced motion stops the animation, not the fact. The figure stays and
     * simply does not move: someone who asked for less motion is not asking to
     * be told less.
     */
    if (reduced.matches) return

    let origin = performance.now()
    let elapsed = 0
    let last = ''

    const paint = (now: number) => {
      const value = from + ((elapsed + (now - origin)) / 1000) * perSecond
      const next = kwd(value)
      // Writing the same string every frame is layout thrash for nothing.
      if (next !== last) {
        last = next
        setText(next)
      }
      frame.current = requestAnimationFrame(paint)
    }

    const halt = () => {
      if (frame.current === null) return
      cancelAnimationFrame(frame.current)
      frame.current = null
      elapsed += performance.now() - origin
    }

    const run = () => {
      if (frame.current !== null) return
      origin = performance.now()
      frame.current = requestAnimationFrame(paint)
    }

    /**
     * Stop when the tab is hidden. A counter that has silently advanced four
     * hundred dinars while the visitor was reading their email reads as a bug,
     * and the elapsed time is banked rather than discarded so the figure is
     * still correct when they come back.
     */
    const onVisibility = () => (document.hidden ? halt() : run())
    document.addEventListener('visibilitychange', onVisibility)
    run()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      halt()
    }
  }, [from, perDay])

  // `suppressHydrationWarning`: the static export ships the starting figure and
  // the first frame after hydration is already past it. That is the animation
  // working, not a mismatch worth a console error.
  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  )
}
