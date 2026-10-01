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
import { and, desc, eq, gt, isNull, ne, or } from 'drizzle-orm'
import { apiKeys, jobs, jobMilestones, withActor, type Actor } from '@qabandi/db'
import { createHash, timingSafeEqual } from 'node:crypto'

/** The fields a shipment is described by on this API — the list and the detail alike. */
const JOB_FIELDS = {
  reference: jobs.reference,
  status: jobs.status,
  mode: jobs.mode,
  etd: jobs.etd,
  eta: jobs.eta,
  customerReference: jobs.customerReference,
}

/** Not a draft, not cancelled: a shipment the customer actually has. */
const VISIBLE = and(ne(jobs.status, 'draft'), isNull(jobs.cancelledAt))

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
        .select(JOB_FIELDS)
        .from(jobs)
        // A draft is the forwarder's work in progress, not a shipment the
        // customer has — the portal hides it for the same reason (A11).
        .where(VISIBLE)
        /*
          Newest first, and that is what makes the cap answerable.

          The limit has always been here; the ordering was not, so a customer
          with more than a hundred shipments got an arbitrary hundred — a
          different arbitrary hundred on each call, because an unordered scan
          is only stable until a row is updated. Ordering does not add paging,
          but it turns "some of your jobs" into "your hundred most recent",
          which a client can reason about and which does not change underneath
          them between two requests.
        */
        .orderBy(desc(jobs.createdAt))
        .limit(100),
    )
  })

  app.get<{ Params: { reference: string } }>('/jobs/:reference', async (request, reply) => {
    const result = await withActor(request.actor!, async (tx) => {
      /*
        The same projection as the list — A11.

        This was `select()`, every column of `jobs`: internal notes, owner and
        coordinator ids, credit-override details, the quote id, whatever the
        next migration adds. RLS decides *which rows* a customer sees, not
        which columns, so the projection is the only thing that keeps the
        forwarder's working data off the customer's integration.
      */
      const [job] = await tx
        .select({ id: jobs.id, ...JOB_FIELDS })
        .from(jobs)
        .where(and(eq(jobs.reference, request.params.reference), VISIBLE))
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
        // Customer-visible only, as on the portal and the tracking page.
        .where(and(eq(jobMilestones.jobId, job.id), eq(jobMilestones.customerVisible, true)))
        .orderBy(jobMilestones.seq)

      const { id: _id, ...shown } = job
      return { job: shown, milestones }
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

    /*
      The key is its own principal — A11.

      This used to act as the administrator who issued the key. The type said
      `customer_contact`, but `app.principal_id()` named a member of staff, and
      every policy that asks `app.has_permission()` or matches
      `id = app.principal_id()` answered for *them*: a customer's integration
      held, at the database, whatever its issuer held. The key's own id holds
      no grant and matches no principal row, so only the `customer_contact`
      arm — this key's customer — applies. Who issued it is still on the key.
    */
    return {
      principalId: key.id,
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

/** Test seam: the actor a key resolves to. Nothing in the product calls it. */
export const resolveKeyForTest = resolveKey
