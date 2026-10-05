import { timingSafeEqual } from 'node:crypto'
import { config } from '../config'

/**
 * Constant-time compare, so a wrong secret leaks nothing about the right one.
 *
 * Its own module so the rate limiter in `index.ts` can ask the same question
 * as the `/internal` guard without loading that route's handler graph.
 */
export function secretMatches(header: unknown): boolean {
  if (typeof header !== 'string') return false
  const a = Buffer.from(header)
  const b = Buffer.from(config.INTERNAL_API_SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}
