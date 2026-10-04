/**
 * The rate limit is for strangers, not for staff.
 *
 * Before launch, every member of staff shared one budget of 120 requests a
 * minute to the service, because the web app calls `/internal` for all of them
 * from one address. These tests pin the exemption to the right secret and
 * check that the public surfaces are still throttled.
 */

import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { describe, expect, it, vi } from 'vitest'

const SECRET = 'test-internal-secret'
vi.mock('../config', () => ({ config: { INTERNAL_API_SECRET: SECRET } }))

const { isTrustedInternalCall, rateLimitOptions } = await import('./rate-limit')

async function server() {
  const app = Fastify()
  await app.register(rateLimit, { ...rateLimitOptions, max: 3 })
  app.get('/internal/ping', async () => ({ ok: true }))
  app.get('/api/v1/ping', async () => ({ ok: true }))
  await app.ready()
  return app
}

describe('isTrustedInternalCall', () => {
  it('trusts /internal with the right secret only', () => {
    expect(
      isTrustedInternalCall({ url: '/internal/x', headers: { 'x-internal-secret': SECRET } }),
    ).toBe(true)
    expect(
      isTrustedInternalCall({ url: '/internal/x', headers: { 'x-internal-secret': 'nope' } }),
    ).toBe(false)
    expect(isTrustedInternalCall({ url: '/internal/x', headers: {} })).toBe(false)
  })

  it('never trusts another prefix, even with the secret', () => {
    expect(
      isTrustedInternalCall({ url: '/api/v1/x', headers: { 'x-internal-secret': SECRET } }),
    ).toBe(false)
    expect(
      isTrustedInternalCall({ url: '/internalish', headers: { 'x-internal-secret': SECRET } }),
    ).toBe(false)
  })
})

describe('the service rate limit', () => {
  it('lets the web app through however busy staff are', async () => {
    const app = await server()
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        url: '/internal/ping',
        headers: { 'x-internal-secret': SECRET },
      })
      expect(res.statusCode).toBe(200)
    }
    await app.close()
  })

  it('still throttles /internal without the secret', async () => {
    const app = await server()
    const codes = []
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ url: '/internal/ping' })).statusCode)
    expect(codes).toContain(429)
    await app.close()
  })

  it('still throttles the public API', async () => {
    const app = await server()
    const codes = []
    for (let i = 0; i < 5; i++)
      codes.push(
        (await app.inject({ url: '/api/v1/ping', headers: { 'x-internal-secret': SECRET } }))
          .statusCode,
      )
    expect(codes).toContain(429)
    await app.close()
  })
})
