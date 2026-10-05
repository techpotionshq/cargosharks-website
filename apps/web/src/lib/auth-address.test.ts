/**
 * The address Better Auth throttles by is ours — A15.
 *
 * Better Auth keeps its own rate limiter and stamps an address on every
 * session, and resolves both from headers it is told to read. Left on
 * `X-Forwarded-For` it trusted whatever single entry a caller sent, and
 * resolved nothing — one bucket shared by every caller — once Traefik had
 * appended to a header the caller started. `proxy.ts` now writes the address
 * `client-address.ts` computes into a header of our own, and `auth.ts` points
 * Better Auth at that header alone.
 *
 * Proved end to end on a real Better Auth instance, in memory, with the same
 * `advanced.ipAddress` the application passes: requests go through the proxy
 * first, exactly as they do in production.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { BETTER_AUTH_IP_ADDRESS, CLIENT_ADDRESS_HEADER } from './client-address'
import { proxy } from '../proxy'

// The stored lock is the database's; the in-memory half is what this proves.
vi.mock('./lockout', () => ({
  readLockout: vi.fn(async () => null),
  recordSignInFailure: vi.fn(async () => {}),
  clearSignInFailures: vi.fn(async () => {}),
}))

const { AUTH_RATE_LIMIT, authHooks } = await import('./auth-guard')
const { __resetThrottle } = await import('./throttle')

const original = process.env.TRUSTED_PROXY_HOPS
afterEach(() => {
  if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS
  else process.env.TRUSTED_PROXY_HOPS = original
})

/** The request as the route handler sees it once the proxy has run. */
function throughProxy(
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
) {
  const request = new NextRequest(url, init)
  const response = proxy(request)
  const headers = new Headers(request.headers)
  // `NextResponse.next({ request: { headers } })` carries the rewritten request
  // headers as `x-middleware-request-*`, listed in `x-middleware-override-headers`.
  const overridden = (response.headers.get('x-middleware-override-headers') ?? '').split(',')
  for (const name of overridden.filter(Boolean)) {
    const value = response.headers.get(`x-middleware-request-${name}`)
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  for (const name of [...headers.keys()]) {
    if (!overridden.includes(name)) headers.delete(name)
  }
  return new Request(url, { method: init.method ?? 'GET', headers, body: init.body })
}

describe('the address handed to Better Auth', () => {
  it('is the trusted-hop entry, replacing anything the caller sent under its name', () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    const seen = throughProxy('http://localhost/sign-in', {
      headers: {
        'x-forwarded-for': '6.6.6.6, 203.0.113.9',
        [CLIENT_ADDRESS_HEADER]: '9.9.9.9',
      },
    })
    expect(seen.headers.get(CLIENT_ADDRESS_HEADER)).toBe('203.0.113.9')
  })

  it('is absent when no entry can be believed', () => {
    process.env.TRUSTED_PROXY_HOPS = '0'
    const seen = throughProxy('http://localhost/sign-in', {
      headers: { 'x-forwarded-for': '6.6.6.6', [CLIENT_ADDRESS_HEADER]: '9.9.9.9' },
    })
    expect(seen.headers.get(CLIENT_ADDRESS_HEADER)).toBeNull()
  })

  it('is what Better Auth rate-limits by, whatever X-Forwarded-For says', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    const auth = betterAuth({
      secret: 'a-test-secret-that-is-long-enough-to-pass-0123456789',
      baseURL: 'http://localhost',
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true },
      rateLimit: {
        enabled: true,
        storage: 'memory',
        customRules: { '/sign-in/email': { window: 60, max: 2 } },
      },
      advanced: { ipAddress: BETTER_AUTH_IP_ADDRESS },
    })

    const signIn = (forwardedFor: string) =>
      auth.handler(
        throughProxy('http://localhost/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
          body: JSON.stringify({ email: 'nobody@qabandi.test', password: 'wrong-password' }),
        }),
      )

    // One caller, a different forged left-hand entry each time: one bucket.
    expect((await signIn('1.1.1.1, 203.0.113.9')).status).not.toBe(429)
    expect((await signIn('2.2.2.2, 203.0.113.9')).status).not.toBe(429)
    expect((await signIn('3.3.3.3, 203.0.113.9')).status).toBe(429)

    // Another caller — the address our proxy wrote differs — has its own.
    expect((await signIn('3.3.3.3, 198.51.100.7')).status).not.toBe(429)
  })
})

/*
  R11, end to end: the application's own hooks and rate-limit setting on a
  real Better Auth instance, with the library's limiter switched on as it is
  in production, every request through the proxy from one office address.
  Run 5 sent forty at once and thirty-seven got "Too many requests".
*/
describe('the morning rush from one address', () => {
  // A trivial hash, so fifty accounts do not cost fifty scrypt rounds. The
  // limiter and the hooks never see the hash.
  const password = {
    hash: async (plain: string) => `plain:${plain}`,
    verify: async ({ hash, password: plain }: { hash: string; password: string }) =>
      hash === `plain:${plain}`,
  }

  async function office() {
    __resetThrottle()
    process.env.TRUSTED_PROXY_HOPS = '1'
    const auth = betterAuth({
      secret: 'a-test-secret-that-is-long-enough-to-pass-0123456789',
      baseURL: 'http://localhost',
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true, password },
      hooks: authHooks,
      rateLimit: { ...AUTH_RATE_LIMIT, enabled: true, storage: 'memory' },
      advanced: { ipAddress: BETTER_AUTH_IP_ADDRESS },
    })
    for (let i = 0; i < 50; i += 1) {
      await auth.api.signUpEmail({
        body: { email: `staff${i}@qabandi.test`, password: `password-${i}-long`, name: `S${i}` },
      })
    }
    const signIn = (email: string, secret: string) =>
      auth.handler(
        throughProxy('http://localhost/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
          body: JSON.stringify({ email, password: secret }),
        }),
      )
    return signIn
  }

  it('lets fifty different people sign in at once', async () => {
    const signIn = await office()
    const statuses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        signIn(`staff${i}@qabandi.test`, `password-${i}-long`).then((r) => r.status),
      ),
    )
    expect(statuses.filter((status) => status === 200)).toHaveLength(50)
  })

  it('still throttles eleven wrong passwords on one account', async () => {
    const signIn = await office()
    const statuses: number[] = []
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await signIn('staff7@qabandi.test', `guess-number-${i}`)).status)
    }
    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true)
    expect(statuses.slice(5).every((status) => status === 403)).toBe(true)
    // ...and the right password is refused too while the lock stands.
    expect((await signIn('staff7@qabandi.test', 'password-7-long')).status).toBe(403)
    // Nobody else at the same address is affected.
    expect((await signIn('staff8@qabandi.test', 'password-8-long')).status).toBe(200)
  })
})
