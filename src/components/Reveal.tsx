'use client'

import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { DURATION, EASE, RISE, STAGGER, VIEWPORT } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The page's only scroll animation, defined once.
 *
 * A block rises twelve pixels into place as it comes into view, once,
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
 * **It starts just before the block is on screen.** The trigger used to be a
 * `-80px` margin, which shrinks the viewport rather than growing it, so a
 * block only began to move once it was 80px into view and arrived late on a
 * quick scroll. `VIEWPORT` in `lib/motion.ts` starts it 64px early instead,
 * and the move is 0.35s, so it has settled by the time anyone reads it.
 *
 * Under `prefers-reduced-motion` nothing moves, and the element is the same
 * one either way. It used to render a plain `<div>` for reduced motion, but
 * the server cannot know the preference and always sends the animated
 * element with its starting offset inline; React does not repair a style
 * attribute on hydration, so the block stayed twelve pixels low and the
 * console logged a mismatch. The CSS rule pins it in place instead.
 *
 * **It moves; it does not appear.** It used to fade from `opacity: 0`, which
 * the server rendered inline, so until a block scrolled into view it was a
 * blank rectangle: on a fast scroll, on an anchor jump to `#demo`, in a
 * crawler's render and in every full-page screenshot. Content is visible from
 * the first paint now and only travels the twelve pixels into place.
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
  return (
    <motion.div
      className={cn(className, 'motion-reduce:transform-none!')}
      initial={{ y: RISE }}
      whileInView={{ y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: DURATION.base, delay: Math.min(delay, STAGGER * 2), ease: EASE }}
    >
      {children}
    </motion.div>
  )
}
