/**
 * The public read API — FR-AD-05.
 *
 * Versioned from day one (`/api/v1`), read-only, and it shares the Zod schemas
 * generated from the Drizzle tables (§10). There is no separate API model to
 * drift from the database.
 *
 * Authentication is a per-customer API key: prefix, hash, scope, revoke.
 * Written directly rather than importing Better Auth's api-key plugin, whose
 * authorization logic has been wrong before (§8).
 */

import type { FastifyInstance } from 'fastify'
import { and, eq, isNull, or, gt } from 'drizzle-orm'
import { apiKeys, jobs, jobMilestones, withActor, type Actor } from '@qabandi/db'
import { createHash, timingSafeEqual } from 'node:crypto'

export async function publicApi(app: FastifyInstance): Promise<void> {
  /**
   * Resolves the key into an `Actor`, so the API is scoped by exactly the same
   * RLS policies as the web application. A read API that assembled its own
   * filters would be a second place for tenancy to go wrong.
   */
  app.addHook('preHandler', async (request, reply) => {
    const header = request.headers.authorization
    const raw = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (!raw) return reply.code(401).send({ error: 'unauthorized' })

    const [prefix, secret] = raw.split('.', 2)
    if (!prefix || !secret) return reply.code(401).send({ error: 'unauthorized' })

    const actor = await resolveKey(prefix, secret)
    if (!actor) return reply.code(401).send({ error: 'unauthorized' })

    request.actor = actor
  })

  app.get('/jobs', async (request) => {
    return withActor(request.actor!, async (tx) =>
      tx
        .select({
          reference: jobs.reference,
          status: jobs.status,
          mode: jobs.mode,
          etd: jobs.etd,
          eta: jobs.eta,
          customerReference: jobs.customerReference,
        })
        .from(jobs)
        .limit(100),
    )
  })

  app.get<{ Params: { reference: string } }>('/jobs/:reference', async (request, reply) => {
    const result = await withActor(request.actor!, async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.reference, request.params.reference))
        .limit(1)
      if (!job) return null

      const milestones = await tx
        .select({
          code: jobMilestones.code,
          nameEn: jobMilestones.nameEn,
          nameAr: jobMilestones.nameAr,
          plannedAt: jobMilestones.plannedAt,
          actualAt: jobMilestones.actualAt,
        })
        .from(jobMilestones)
        .where(eq(jobMilestones.jobId, job.id))
        .orderBy(jobMilestones.seq)

      return { job, milestones }
    })

    // Not-found rather than forbidden: the row was invisible under the
    // caller's own policy, which is FR-ID-04's intended behaviour.
    if (!result) return reply.code(404).send({ error: 'not_found' })
    return result
  })
}

async function resolveKey(prefix: string, secret: string): Promise<Actor | null> {
  const hash = createHash('sha256').update(secret).digest()

  // The lookup itself runs as the system principal — the key row is not
  // visible to the caller it identifies until the caller has been identified.
  const { systemActor } = await import('@qabandi/db')

  return withActor(systemActor(), async (tx) => {
    const [key] = await tx
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.prefix, prefix),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
        ),
      )
      .limit(1)

    if (!key) return null

    const stored = Buffer.from(key.secretHash, 'hex')
    if (stored.length !== hash.length || !timingSafeEqual(stored, hash)) return null

    await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id))

    return {
      principalId: key.createdById ?? key.id,
      type: 'customer_contact' as const,
      branchIds: key.branchId ? [key.branchId] : [],
      customerId: key.customerId,
      partnerId: null,
      ip: null,
    }
  })
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor
  }
}
