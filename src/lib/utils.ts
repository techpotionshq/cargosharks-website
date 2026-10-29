import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge, told about this site's type scale.
 *
 * Without it, `text-body` (a size from `globals.css`) and `text-on-void` (a
 * colour) look like the same kind of class to the merger, and the later one
 * silently removes the earlier: a button on a dark band lost its light text
 * colour that way and rendered ink on near-black.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ['display', 'h2', 'h3', 'lede', 'body', 'small', 'label'] },
  },
})

/** shadcn/ui's class joiner: later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
