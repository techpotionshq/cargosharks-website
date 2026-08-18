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

const app = Fastify({
  logger:
    config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty' }, level: 'debug' }
      : { level: 'info' },
  // Trust the proxy so `x-forwarded-for` reaches the audit trail intact (§5.4).
  trustProxy: true,
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
*/
app.log.info(describeAdapters(), 'external adapters resolved')

await app.listen({ port: config.SERVICE_PORT, host: '0.0.0.0' })
