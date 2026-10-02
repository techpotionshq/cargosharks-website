/**
 * The password-reset mail speaks the recipient's language — A8.
 *
 * The handler read `principals` on bare `db`. That table is FORCE ROW LEVEL
 * SECURITY, so with no actor stamped it found nobody, and every reset mail
 * went out in English with no name — for an Arabic account too. This runs the
 * real read against a real database; only the mail relay is stubbed.
 */

import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const SECRET = 'test-internal-secret'

const harness = vi.hoisted(() => ({ sent: [] as { to: string; locale: string; body: string }[] }))

vi.mock('../config', () => ({
  config: {
    INTERNAL_API_SECRET: SECRET,
    INTERNAL_API_TRUST_PROXY: false,
    WEB_URL: 'http://localhost:3000',
  },
}))
vi.mock('../adapters/index', () => ({
  sendMail: async (_options: unknown, message: { to: string; locale: string; body: string }) => {
    harness.sent.push(message)
  },
  mailSettings: async () => ({}),
  smtpOptions: () => ({}),
}))

const { principals, systemActor, withActor } = await import('@qabandi/db')
const { internalApi } = await import('./internal')

const EMAIL = `reset-ar-${Date.now()}@qabandi.test`

describe.skipIf(!enabled)('the password-reset mail', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    await withActor(systemActor(), (tx) =>
      tx.insert(principals).values({
        type: 'internal',
        email: EMAIL,
        nameEn: 'Reset Person',
        nameAr: 'شخص الاستعادة',
        locale: 'ar',
      }),
    )
    app = Fastify({ logger: false })
    await app.register(internalApi, { prefix: '/internal' })
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
  })

  it("goes out in the account's own language, with its name", async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/mail/password-reset',
      headers: { 'x-internal-secret': SECRET },
      payload: { email: EMAIL.toUpperCase(), url: 'https://example.test/reset/abc' },
    })

    expect(response.statusCode).toBe(202)
    const mail = harness.sent.find((m) => m.to === EMAIL.toUpperCase())
    expect(mail?.locale).toBe('ar')
    expect(mail?.body).toContain('شخص الاستعادة')
  })
})
