/**
 * The site's motion, as constants. Every animated component reads these, so
 * the whole site moves at one speed and a change here is a change everywhere.
 *
 * The standard (see DESIGN.md): motion confirms that something arrived or
 * changed, it never delays reading. Nothing starts invisible, nothing runs
 * longer than `slow`, and nothing waits on a stagger longer than `stagger`.
 */

/** Exponential ease-out: fast start, soft landing. The only curve on the site. */
export const EASE = [0.16, 1, 0.3, 1] as const

export const DURATION = {
  /** Hover, press, colour and underline changes. */
  fast: 0.15,
  /** A block settling into place on scroll; menus opening. */
  base: 0.35,
  /** The one larger move: the hero's product frame. */
  slow: 0.5,
} as const

/** Between siblings revealed together. Longer reads as a queue. */
export const STAGGER = 0.05

/** How far a block travels into place, in pixels. */
export const RISE = 12

/**
 * Fire before the block is on screen, not after. A negative bottom margin
 * (the old `-80px`) shrinks the viewport, so a block started moving only once
 * it was already 80px into view and arrived visibly late on a quick scroll.
 * A positive one starts it just before it appears, so the move is finishing
 * as it comes into view.
 */
export const VIEWPORT = { once: true, margin: '0px 0px 64px 0px' } as const
