/**
 * The internal API — what `apps/web` calls when it needs the service.
 *
 * `INTERNAL_API_SECRET` has been required in `config.ts` since Release One and
 * read by nothing. This is what it was for.
 *
 * ## Why the web app cannot render documents itself
 *
 * Chromium lives in `infra/Dockerfile.service`, not in the web image, and it
 * belongs there: a browser is a heavyweight, memory-hungry dependency and the
 * request path that serves the operations board should not carry it. So a
 * document request crosses one process boundary — which is also why this route
 * exists rather than the renderer being imported into a Next route handler.
 *
 * ## The actor is passed, not re-derived
 *
 * The web app has already resolved the session; this route trusts the shared
 * secret for *authentication* and the passed actor for *authorisation*. The
 * actor is then stamped into the transaction exactly as it would be in-process,
 * so row-level security decides what the document may contain (§5.2).
 *
 * That means the secret is genuinely load-bearing: anyone holding it can name
 * any principal. It is a service-to-service credential on a network that
 * should never expose this port publicly, and it is checked in constant time
 * so the check itself does not leak.
 */

import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import type { Actor } from '@qabandi/db'
import { config } from '../config'
import { DocumentNotFoundError, renderInvoicePdf } from '../pdf/documents'

interface DocumentRequest {
  readonly actor: Actor
  readonly locale?: 'en' | 'ar'
}

/** Constant-time compare, so a wrong secret leaks nothing about the right one. */
function secretMatches(header: unknown): boolean {
  if (typeof header !== 'string') return false
  const a = Buffer.from(header)
  const b = Buffer.from(config.INTERNAL_API_SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function internalApi(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    if (!secretMatches(request.headers['x-internal-secret'])) {
      return reply.code(401).send({ error: 'unauthenticated' })
    }
  })

  /**
   * Render an invoice, bilingually, on demand.
   *
   * Streamed rather than stored — see `renderInvoicePdf`. `Content-Disposition`
   * carries the series number, because that is what finance files it under.
   */
  app.post<{ Params: { id: string }; Body: DocumentRequest }>(
    '/documents/invoice/:id',
    async (request, reply) => {
      const { actor, locale } = request.body ?? {}

      if (!actor?.principalId || !actor.type) {
        return reply.code(400).send({ error: 'no_actor' })
      }

      try {
        const { pdf, filename } = await renderInvoicePdf(
          actor,
          request.params.id,
          locale === 'ar' ? 'ar' : 'en',
        )

        return (
          reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', `inline; filename="${filename}"`)
            // Never cached by a proxy: the same URL renders different content for
            // different principals, and an invoice is commercial data.
            .header('cache-control', 'private, no-store')
            .send(pdf)
        )
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          // Not found, not forbidden — the row is invisible to this principal,
          // so saying "forbidden" would confirm it exists (FR-ID-04).
          return reply.code(404).send({ error: 'not_found' })
        }
        throw error
      }
    },
  )
}
