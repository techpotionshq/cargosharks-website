/**
 * The service — Architecture §3.
 *
 * Exists for the work Next.js cannot do: long-running workers, Chromium PDF
 * rendering, inbound webhooks, and the public read API.
 *
 * `apps/web` never sends an email, renders a PDF or calls a third party
 * inline. It writes a row and enqueues a job. That division is what makes
 * retry, delivery logging (FR-NT-06) and rate limiting (FR-NT-07) a single
 * implementation rather than a per-caller concern.
 */

// First, and it has to stay first. OpenTelemetry patches modules as they are
// required, so anything imported above this line is never instrumented — and
// the symptom is a trace with no database spans under it, which reads like a
// sampling problem rather than an import-order one. Starting the SDK is a side
// effect of this import for exactly that reason; see `observability.ts`.
import { stopTelemetry } from './observability'

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { config } from './config'
import { registerSchedules, stopBoss } from './queue'
import { describeAdapters } from './adapters/index'
import { registerWorkers } from './workers/index'
import { publicApi } from './api/public'
import { internalApi } from './api/internal'
import { webhooks } from './webhooks/index'
import { syncNotificationTemplates, systemActor, withActor } from '@qabandi/db'

const app = Fastify({
  logger:
    config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty' }, level: 'debug' }
      : { level: 'info' },
  // Trust exactly the proxies we run, so `x-forwarded-for` reaches the audit
  // trail and the rate limiter as our proxy wrote it, not as the caller did
  // (§5.4, A15 — `TRUSTED_PROXY_HOPS` in `config.ts`). Written as the function
  // proxy-addr compiles a hop count into: fastify 5.12.5's types dropped the
  // number overload, and the function is the same rule — trust the nearest N.
  trustProxy: (_address: string, hop: number) => hop < config.TRUSTED_PROXY_HOPS,
})

await app.register(helmet)
await app.register(cors, { origin: [config.WEB_URL], credentials: true })

/**
 * The public read API and the tracking lookup are the only unauthenticated
 * surfaces, and both are rate limited — FR-CP-05's enumeration control and
 * FR-NT-07's throttle are the same mechanism.
 */
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' })

app.get('/health', async () => ({ ok: true, at: new Date().toISOString() }))

await app.register(publicApi, { prefix: '/api/v1' })

/*
  Service-to-service only. Never expose this prefix publicly: it authenticates
  with a shared secret and takes the acting principal from the request body, so
  anyone who can reach it with the secret can render any document the named
  principal could see.
*/
await app.register(internalApi, { prefix: '/internal' })
await app.register(webhooks, { prefix: '/webhooks' })

/*
  The default notification templates follow the code on every boot. A deploy
  runs migrations but not the seed, so without this an event added after the
  database was seeded had no template and every delivery of it failed.
*/
try {
  const templates = await withActor(systemActor(), (tx) => syncNotificationTemplates(tx))
  app.log.info({ templates }, 'notification templates synced')
} catch (error) {
  // Old copy is better than no service: log it and carry on.
  app.log.error({ err: error }, 'notification templates could not be synced')
}

await registerWorkers(app.log)
await registerSchedules()

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await stopBoss()
  // Last, so the spans from whatever was still in flight are flushed rather
  // than discarded with the buffer — and those are the ones worth having.
  await stopTelemetry()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

/*
  Which integrations this deployment is actually wired to.

  "Which of these is live here?" is the first question of any support
  conversation about a fleet, and reading it off the environment by hand gets
  it wrong. Resolving here also means a half-configured driver — a key with no
  URL — stops the service at boot with a clear message rather than surfacing
  as a feed that quietly returns nothing.

  Awaited, because four of these answers are rows now (FR-AD-03) and the log
  has to ask the database for them. A row that is wrong does *not* stop the
  boot — that would put the screen which fixes it behind the mistake — so this
  line is also where a misconfigured row first announces itself.
*/
app.log.info(await describeAdapters(), 'external adapters resolved')

await app.listen({ port: config.SERVICE_PORT, host: '0.0.0.0' })
