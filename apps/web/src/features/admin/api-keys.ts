'use server'

/**
 * Per-customer API keys — FR-AD-05.
 *
 * A Must in the SRS, with a table, a permission and an authenticator, and no
 * way to create one. `api_keys` was read by `apps/service`'s public API on
 * every request and written by nobody; `admin.api_keys.write` was declared in
 * `ADMIN_PERMISSIONS` and checked in not one file. So the documented read-only
 * REST API a customer's ERP integrates against could authenticate keys that
 * could not be issued.
 *
 * ## The secret is shown once and never again
 *
 * Only its hash is stored, so there is nothing to show later — which is the
 * point, and is why the creation dialog says so before it is submitted rather
 * than after. A key nobody wrote down is revoked and replaced, which costs a
 * minute; a key retrievable from the interface is one that leaks with the
 * interface.
 *
 * ## Revoked, never deleted
 *
 * `revoked_at` rather than a row disappearing (§5.5). "Was that key ever live,
 * and when did it stop" is a question asked during exactly one kind of
 * conversation, and the answer has to survive the incident.
 */

import { revalidatePath } from 'next/cache'
import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { apiKeys, customers, principals, webhookEndpoints, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { echo, fail, fieldErrors, failWith, succeed, type ActionState } from '@/lib/form-state'

export interface ApiKeyRow {
  readonly id: string
  readonly prefix: string
  readonly name: string
  readonly customerName: string | null
  readonly branchId: string | null
  readonly scopes: string[]
  readonly createdBy: string | null
  readonly createdAt: Date
  readonly lastUsedAt: Date | null
  readonly expiresAt: Date | null
  readonly revokedAt: Date | null
}

/** Live keys first, then revoked ones — the revoked stay visible (§5.5). */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const session = await requireSession()
  assertCan(session, 'admin.api_keys.write')

  return withActor(session.actor, (tx) =>
    tx
      .select({
        id: apiKeys.id,
        prefix: apiKeys.prefix,
        name: apiKeys.name,
        customerName: customers.legalNameEn,
        branchId: apiKeys.branchId,
        scopes: apiKeys.scopes,
        createdBy: principals.nameEn,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .leftJoin(customers, eq(customers.id, apiKeys.customerId))
      .leftJoin(principals, eq(principals.id, apiKeys.createdById))
      .orderBy(desc(apiKeys.createdAt))
      .limit(200),
  )
}

const keySchema = z.object({
  name: z.string().trim().min(3, 'Name it after the system that will use it').max(120),
  customerId: z.uuid('Choose the customer this key reads for'),
  branchId: z.uuid('Choose a branch'),
  expiresAt: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'), z.literal('')])
    .optional()
    .transform((v) => v || null),
})

/**
 * Mint a key, and hand back the only copy of its secret.
 *
 * ## Why the hash is SHA-256 and not Argon2id
 *
 * The column comment says Argon2id and `apps/service` verifies with SHA-256,
 * which is the shape that matters: this has to produce what that reads, and
 * changing the algorithm would invalidate every key already issued. It is also
 * the right call for this input — Argon2's cost exists to make *guessable*
 * secrets expensive to attack, and a 256-bit random secret is not guessable.
 * Applying a slow KDF to it would add latency to every API request and no
 * security. The comment is what is wrong here, not the code.
 */
export async function createApiKey(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.api_keys.write')

  const parsed = keySchema.safeParse({
    name: String(form.get('name') ?? '').trim(),
    customerId: String(form.get('customerId') ?? ''),
    branchId: String(form.get('branchId') ?? ''),
    expiresAt: String(form.get('expiresAt') ?? ''),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertInBranch(session, data.branchId)

  /*
    Two halves, and the split is what makes a key identifiable without being
    usable. The prefix is stored in clear and printed on the screen, so an
    operator looking at a list can tell which key an integration is using; the
    secret is never stored at all. `resolveKey` splits on the first dot, so
    neither half may contain one.
  */
  const prefix = `qb_${randomBytes(6).toString('hex')}`
  const secret = randomBytes(32).toString('hex')
  const secretHash = createHash('sha256').update(secret).digest('hex')

  await withActor(session.actor, (tx) =>
    tx.insert(apiKeys).values({
      prefix,
      secretHash,
      name: data.name,
      customerId: data.customerId,
      branchId: data.branchId,
      /*
        Read-only in Release One — FR-AD-05 says write access is Release Two.
        Stated as a scope rather than assumed, so the day a write endpoint
        exists it refuses every key issued before it.
      */
      scopes: ['job.read'],
      createdById: session.principal.id,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    }),
  )

  revalidatePath('/settings/api-keys')

  /*
    The secret rides back on the success token, which is the only moment it
    exists outside this function. `succeed` suffixes a counter, so the page
    reads everything before the last colon.
  */
  return succeed(`${prefix}.${secret}`)
}

/** Revoke a key. Never deletes it — see the module docstring. */
export async function revokeApiKey(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.api_keys.write')

  const keyId = String(form.get('keyId') ?? '')
  if (!keyId) return failWith('Nothing to revoke.')

  const revoked = await withActor(session.actor, (tx) =>
    tx
      .update(apiKeys)
      .set({ revokedAt: new Date(), revokedById: session.principal.id, updatedAt: new Date() })
      // Already-revoked keys are left alone, so a second click does not move
      // the date and lose when it actually stopped working.
      .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id }),
  )

  if (revoked.length === 0) return failWith('That key was already revoked.')

  revalidatePath('/settings/api-keys')
  return succeed(keyId)
}

/* ------------------------------------------------------ outbound webhooks */

export interface WebhookEndpointRow {
  readonly id: string
  readonly url: string
  readonly customerName: string | null
  readonly events: string[]
  readonly isActive: boolean
  readonly disabledAt: Date | null
  readonly disabledReason: string | null
  readonly queued: number
  readonly failed: number
  readonly lastDeliveredAt: Date | null
}

/**
 * Subscribers, with how their deliveries are actually going — FR-AD-06.
 *
 * The counts matter more than the list. An endpoint that exists is not an
 * endpoint that works, and the failure this screen has to make visible is the
 * customer whose URL died in a redeploy: the worker disables it after a week
 * of nothing landing, and this is where somebody sees why.
 */
export async function listWebhookEndpoints(): Promise<WebhookEndpointRow[]> {
  const session = await requireSession()
  assertCan(session, 'admin.api_keys.write')

  const rows = await withActor(session.actor, (tx) =>
    tx.execute(sql`
      select e.id, e.url, c.legal_name_en as "customerName", e.events,
             e.is_active as "isActive", e.disabled_at as "disabledAt",
             e.disabled_reason as "disabledReason",
             (select count(*) from webhook_deliveries d
               where d.endpoint_id = e.id and d.status = 'queued')::int as queued,
             (select count(*) from webhook_deliveries d
               where d.endpoint_id = e.id and d.status = 'failed')::int as failed,
             (select max(d.delivered_at) from webhook_deliveries d
               where d.endpoint_id = e.id) as "lastDeliveredAt"
        from webhook_endpoints e
        left join customers c on c.id = e.customer_id
       order by e.is_active desc, e.created_at desc
       limit 100
    `),
  )

  return rows.rows as unknown as WebhookEndpointRow[]
}

const endpointSchema = z.object({
  url: z.url('A URL we can post to').max(500),
  customerId: z.union([z.uuid(), z.literal('')]).optional(),
  branchId: z.union([z.uuid(), z.literal('')]).optional(),
  events: z.string().trim().max(2000).optional(),
})

/**
 * Subscribe a URL to events, and hand back its signing secret once.
 *
 * The secret is shown once for the same reason an API key's is — except that
 * here it is stored in clear, because signing requires it: the worker computes
 * an HMAC with it on every delivery. Which is why it is worth saying plainly
 * that this is a shared secret, not a credential the receiver proves identity
 * with.
 */
export async function createWebhookEndpoint(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.api_keys.write')

  const parsed = endpointSchema.safeParse({
    url: String(form.get('url') ?? '').trim(),
    customerId: String(form.get('customerId') ?? ''),
    branchId: String(form.get('branchId') ?? ''),
    events: String(form.get('events') ?? ''),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  if (data.branchId) assertInBranch(session, data.branchId)

  /*
    Only over TLS. A signature proves who sent a payload and does nothing to
    stop anyone reading it, and these carry shipment and customer detail.
  */
  if (!data.url.startsWith('https://')) {
    return fail({ url: 'Must be https — these carry customer data.' }, echo(form))
  }

  const secret = randomBytes(32).toString('hex')

  // Empty subscribes to everything, which is what a customer integrating a
  // whole pipeline asks for — see the expander.
  const events = (data.events ?? '')
    .split(/[\s,]+/)
    .map((e) => e.trim())
    .filter(Boolean)

  await withActor(session.actor, (tx) =>
    tx.insert(webhookEndpoints).values({
      url: data.url,
      secret,
      customerId: data.customerId || null,
      branchId: data.branchId || null,
      events,
    }),
  )

  revalidatePath('/settings/api-keys')
  return succeed(secret)
}

/** Switch a subscriber off, or back on after their URL is fixed. */
export async function setWebhookEndpointActive(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.api_keys.write')

  const endpointId = String(form.get('endpointId') ?? '')
  if (!endpointId) return failWith('Nothing to change.')
  const isActive = form.get('isActive') !== null

  await withActor(session.actor, (tx) =>
    tx
      .update(webhookEndpoints)
      .set({
        isActive,
        // Cleared on re-enable, so a stale "disabled because…" does not sit
        // under a live endpoint.
        disabledAt: isActive ? null : new Date(),
        disabledReason: isActive ? null : 'Switched off by an administrator',
        updatedAt: new Date(),
      })
      .where(eq(webhookEndpoints.id, endpointId)),
  )

  revalidatePath('/settings/api-keys')
  return succeed(endpointId)
}
