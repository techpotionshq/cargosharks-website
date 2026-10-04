import type { FastifyRequest } from 'fastify'
import { secretMatches } from './internal-secret'

/**
 * Who the service's rate limit is for.
 *
 * It exists for the unauthenticated surfaces: the public read API and the
 * tracking lookup (FR-CP-05, FR-NT-07). It used to cover `/internal` too, and
 * there it was a launch fault rather than a control. The web app is the only
 * caller of that prefix and calls it with no client address, so every member
 * of staff shared one budget of 120 requests a minute: PDFs, downloads,
 * uploads, the assistant and mail actions for the whole firm. A busy morning
 * with a hundred people turned into "the document could not be generated".
 *
 * So a request to `/internal` that carries the right secret is let through.
 * One without it still counts, and the guard in `internal.ts` refuses it
 * anyway, so guessing the secret is no faster than before.
 */
export function isTrustedInternalCall(req: Pick<FastifyRequest, 'url' | 'headers'>): boolean {
  return (
    (req.url === '/internal' || req.url.startsWith('/internal/')) &&
    secretMatches(req.headers['x-internal-secret'])
  )
}

export const rateLimitOptions = {
  max: 120,
  timeWindow: '1 minute',
  allowList: (req: FastifyRequest) => isTrustedInternalCall(req),
}
