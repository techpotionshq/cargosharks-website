/**
 * The public read API — FR-AD-05.
 *
 * The one surface a stranger can reach. Everything else in this service sits
 * behind either a session or a shared secret held by our own web tier; this
 * takes a key handed to a customer and turns it into an `Actor`, and every
 * question about who may see what is answered after that by RLS.
 *
 * That design is the reason this file exists. The API never assembles a
 * tenancy filter of its own — there is no `where customer_id = …` in the
 * handlers — so the tests that matter are the ones proving the *key* resolves
 * to the right actor and nothing else, because an actor with one field wrong
 * is a customer reading another customer's shipments through a policy that is
 * working exactly as written.
 *
 * Four refusals are load-bearing:
 *
 * - **A revoked key is dead immediately.** Revocation that took effect at the
 *   next restart would be no revocation at all.
 * - **An expired key is dead on the second.** The comparison is against `now`
 *   in the database, not a cached clock.
 * - **A wrong secret is refused in constant time**, and a secret of the wrong
 *   *length* is refused before `timingSafeEqual` is allowed to throw on it.
 * - **A shipment nobody may see is 404, not 403** — FR-ID-04. Forbidden would
 *   confirm the reference exists, which is the enumeration oracle the whole
 *   not-found convention avoids.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  apiKeys,
  branches,
  customers,
  jobMilestones,
  jobs,
  principals,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { publicApi } = await import('./public')

const BRANCH = '00000000-0000-7000-8000-00000000ab01'
const CUSTOMER = '00000000-0000-7000-8000-00000000ab02'
const OTHER_CUSTOMER = '00000000-0000-7000-8000-00000000ab03'
const PRINCIPAL = '00000000-0000-7000-8000-00000000ab04'

const systemActor = {
  principalId: PRINCIPAL,
  type: 'system' as const,
  branchIds: [BRANCH],
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
const next = () => (seq += 1)

let app: FastifyInstance

/**
 * Issues a key the way the administration screen does: a random secret, only
 * its SHA-256 stored, and the prefix as the lookup handle.
 */
async function issueKey(over: Record<string, unknown> = {}): Promise<string> {
  const prefix = `qk_${RUN}${next()}`
  const secret = randomBytes(24).toString('hex')
  await withActor(systemActor, (tx) =>
    tx.insert(apiKeys).values({
      prefix,
      secretHash: createHash('sha256').update(secret).digest('hex'),
      name: `Public API fixture ${prefix}`,
      customerId: CUSTOMER,
      branchId: BRANCH,
      createdById: PRINCIPAL,
      ...over,
    } as never),
  )
  return `${prefix}.${secret}`
}

async function job(over: Record<string, unknown> = {}): Promise<{ id: string; reference: string }> {
  const reference = `PUB-${RUN}-${next()}`
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference,
        branchId: BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'in_transit',
        ...over,
      })
      .returning({ id: jobs.id })
    return { id: row!.id, reference }
  })
}

const get = (path: string, key?: string) =>
  app.inject({
    method: 'GET',
    url: path,
    headers: key ? { authorization: `Bearer ${key}` } : {},
  })

describe.skipIf(!enabled)('the public read API', () => {
  let key: string

  beforeAll(async () => {
    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'public-api@qabandi.test',
          nameEn: 'Public API Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'PUB',
          legalNameEn: 'Public API Branch Co.',
          legalNameAr: 'فرع الواجهة العامة',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'PUB',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values([
          {
            id: CUSTOMER,
            code: 'CUST-PUBLIC-API',
            legalNameEn: 'Public API Customer',
            primaryBranchId: BRANCH,
          },
          {
            id: OTHER_CUSTOMER,
            code: 'CUST-PUBLIC-API-OTHER',
            legalNameEn: 'Somebody Else Entirely',
            primaryBranchId: BRANCH,
          },
        ])
        .onConflictDoNothing()
    })

    app = Fastify({ logger: false })
    await app.register(publicApi, { prefix: '/api/v1' })
    await app.ready()

    key = await issueKey()
  })

  afterAll(async () => {
    if (!enabled) return
    await app?.close()
    // Revoked rather than removed, and the shipments closed — `DELETE` is
    // revoked from `app_user` and nothing here should outlive the run.
    await withActor(systemActor, async (tx) => {
      await tx.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.branchId, BRANCH))
    })
  })

  describe('the key', () => {
    it('refuses a request carrying no authorization at all', async () => {
      const response = await get('/api/v1/jobs')

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ error: 'unauthorized' })
    })

    it('refuses a scheme it does not speak', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/jobs',
        headers: { authorization: `Basic ${Buffer.from('a:b').toString('base64')}` },
      })

      expect(response.statusCode).toBe(401)
    })

    /** Prefix and secret, separated. Half a key is not a key. */
    it('refuses a token with no secret after the prefix', async () => {
      expect((await get('/api/v1/jobs', 'qk_nosecret')).statusCode).toBe(401)
      expect((await get('/api/v1/jobs', '.only-a-secret')).statusCode).toBe(401)
    })

    it('refuses a prefix nobody issued', async () => {
      expect((await get('/api/v1/jobs', 'qk_neverissued.abcdef')).statusCode).toBe(401)
    })

    /**
     * The wrong secret against a real prefix — the case an attacker actually
     * has. Compared with `timingSafeEqual`, which is why the length is checked
     * first: it throws on a mismatch rather than returning false, and a 500
     * here would be both a leak and an outage.
     */
    it('refuses the right prefix with the wrong secret', async () => {
      const [prefix] = key.split('.')

      const response = await get('/api/v1/jobs', `${prefix}.${'0'.repeat(48)}`)

      expect(response.statusCode).toBe(401)
    })

    it('refuses a secret of the wrong length without falling over', async () => {
      const [prefix] = key.split('.')

      const response = await get('/api/v1/jobs', `${prefix}.short`)

      expect(response.statusCode).toBe(401)
    })

    /** Revocation that waited for a restart would be no revocation at all. */
    it('refuses a key that has been revoked', async () => {
      const revoked = await issueKey()
      const [prefix] = revoked.split('.')
      await withActor(systemActor, (tx) =>
        tx
          .update(apiKeys)
          .set({ revokedAt: new Date(), revokedById: PRINCIPAL })
          .where(eq(apiKeys.prefix, prefix!)),
      )

      expect((await get('/api/v1/jobs', revoked)).statusCode).toBe(401)
    })

    it('refuses a key whose expiry has passed', async () => {
      const expired = await issueKey({ expiresAt: new Date('2020-01-01T00:00:00Z') })

      expect((await get('/api/v1/jobs', expired)).statusCode).toBe(401)
    })

    it('accepts a key whose expiry is still ahead', async () => {
      const dated = await issueKey({ expiresAt: new Date('2099-01-01T00:00:00Z') })

      expect((await get('/api/v1/jobs', dated)).statusCode).toBe(200)
    })

    /** So an administrator can see which keys are live and which are forgotten. */
    it('records when a key was last used', async () => {
      const fresh = await issueKey()
      const [prefix] = fresh.split('.')

      await get('/api/v1/jobs', fresh)

      const [row] = await withActor(systemActor, (tx) =>
        tx
          .select({ lastUsedAt: apiKeys.lastUsedAt })
          .from(apiKeys)
          .where(eq(apiKeys.prefix, prefix!)),
      )
      expect(row?.lastUsedAt).toBeInstanceOf(Date)
    })
  })

  describe('the shipment list', () => {
    it('returns the caller’s own shipments', async () => {
      const mine = await job()

      const response = await get('/api/v1/jobs', key)
      const body = response.json() as { reference: string }[]

      expect(response.statusCode).toBe(200)
      expect(body.map((row) => row.reference)).toContain(mine.reference)
    })

    /**
     * The point of resolving a key into an `Actor` rather than filtering here.
     * Nothing in the handler mentions a customer; the policy does all of it,
     * and this is the assertion that says so.
     */
    it('never returns another customer’s shipment', async () => {
      const theirs = await job({ customerId: OTHER_CUSTOMER })

      const body = (await get('/api/v1/jobs', key)).json() as { reference: string }[]

      expect(body.map((row) => row.reference)).not.toContain(theirs.reference)
    })

    /**
     * Newest first. The hundred-row cap has no paging beside it, so without an
     * order the caller gets an arbitrary hundred — and a different arbitrary
     * hundred each time, because an unordered scan only looks stable until a
     * row is updated.
     */
    it('lists the newest shipments first, so the cap means something', async () => {
      // Stamped explicitly rather than left to `now()`, which is the
      // transaction's clock and can hand two inserts the same microsecond.
      const older = await job({ createdAt: new Date(Date.now() - 4000) })
      const newer = await job({ createdAt: new Date(Date.now() - 2000) })

      const body = (await get('/api/v1/jobs', key)).json() as { reference: string }[]
      const listed = body.map((row) => row.reference)

      // Relative, not absolute: the other cases in this file leave shipments
      // of their own behind, and what is being asserted is the ordering rather
      // than which shipment happens to be at the top today.
      expect(listed).toContain(newer.reference)
      expect(listed.indexOf(newer.reference)).toBeLessThan(listed.indexOf(older.reference))
    })

    it('states only the fields the API promises, and not the row', async () => {
      await job({ customerReference: 'PO-PUBLIC-1' })

      const [row] = (await get('/api/v1/jobs', key)).json() as Record<string, unknown>[]

      expect(Object.keys(row ?? {}).sort()).toEqual([
        'customerReference',
        'eta',
        'etd',
        'mode',
        'reference',
        'status',
      ])
    })
  })

  describe('one shipment', () => {
    it('answers with the shipment and its milestones', async () => {
      const mine = await job()
      await withActor(systemActor, (tx) =>
        tx.insert(jobMilestones).values([
          {
            jobId: mine.id,
            code: 'vessel_departed',
            nameEn: 'Vessel departed',
            nameAr: 'أبحرت الباخرة',
            seq: 20,
            actualAt: new Date('2026-06-02T00:00:00Z'),
          },
          {
            jobId: mine.id,
            code: 'booking_confirmed',
            nameEn: 'Booking confirmed',
            nameAr: 'تم تأكيد الحجز',
            seq: 10,
            actualAt: new Date('2026-05-28T00:00:00Z'),
          },
        ] as never),
      )

      const response = await get(`/api/v1/jobs/${mine.reference}`, key)
      const body = response.json() as {
        job: { reference: string }
        milestones: { code: string }[]
      }

      expect(response.statusCode).toBe(200)
      expect(body.job.reference).toBe(mine.reference)
      // In the order they happen, not the order they were written — a tracking
      // page reads this top to bottom.
      expect(body.milestones.map((m) => m.code)).toEqual(['booking_confirmed', 'vessel_departed'])
    })

    it('answers with an empty milestone list rather than omitting it', async () => {
      const mine = await job()

      const body = (await get(`/api/v1/jobs/${mine.reference}`, key)).json() as {
        milestones: unknown[]
      }

      expect(body.milestones).toEqual([])
    })

    it('is 404 for a reference that does not exist', async () => {
      const response = await get('/api/v1/jobs/NO-SUCH-REFERENCE', key)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    })

    /**
     * The same 404, and deliberately indistinguishable from the one above.
     * "Forbidden" would confirm the reference exists, which turns the endpoint
     * into an oracle for guessing other customers' shipment numbers.
     */
    it('is the same 404 for a shipment belonging to somebody else', async () => {
      const theirs = await job({ customerId: OTHER_CUSTOMER })

      const response = await get(`/api/v1/jobs/${theirs.reference}`, key)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    })

    it('refuses an unauthenticated request before it reaches the lookup', async () => {
      const mine = await job()

      expect((await get(`/api/v1/jobs/${mine.reference}`)).statusCode).toBe(401)
    })
  })
})
