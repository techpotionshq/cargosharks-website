'use client'

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

/**
 * The page's only scroll animation, defined once.
 *
 * A block rises about twelve pixels and fades in as it comes into view, once,
 * and never again. That is the whole vocabulary, and keeping it in one file is
 * the point: the moment two sections animate by different distances at
 * different speeds the page stops feeling composed and starts feeling
 * assembled, and the difference is invisible in review and obvious in use.
 *
 * Three constraints it is built around.
 *
 * **`once: true`.** A block that re-animates every time it re-enters the
 * viewport turns a scroll back up the page into a light show, and worse, it
 * makes the reader wait for text they have already read.
 *
 * **Twelve pixels, not forty.** A large travel distance is what makes a
 * scroll-reveal read as a template — it draws attention to the animation rather
 * than to the thing arriving. At this distance a reader registers that the page
 * is responsive and never consciously sees a movement.
 *
 * **`margin` pulls the trigger line up off the bottom edge.** Firing exactly at
 * the viewport boundary means a block animates while it is still half a line
 * visible, so on a fast scroll the reader passes a paragraph mid-fade. Starting
 * it 80px early means it has finished by the time it is properly on screen.
 *
 * Under `prefers-reduced-motion` the wrapper renders its children and nothing
 * else — not a faster animation, none.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  /** For staggering siblings. Keep it under ~0.2s; longer reads as a queue. */
  delay?: number
  className?: string
}) {
  const reduced = useReducedMotion()

  if (reduced) return <div className={className}>{children}</div>

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -80px 0px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}
