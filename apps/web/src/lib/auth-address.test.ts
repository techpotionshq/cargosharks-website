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

import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { BETTER_AUTH_IP_ADDRESS, CLIENT_ADDRESS_HEADER } from './client-address'
import { proxy } from '../proxy'

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
