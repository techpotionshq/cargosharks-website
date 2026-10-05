/**
 * The two-factor step at launch — R11's twin.
 *
 * Every finance and admin user arrives from one Cloudflare address and
 * confirms TOTP at about the same time. The two-factor plugin's own rule
 * (three per ten seconds per address on `/two-factor/*`) refused the fourth.
 * This runs the application's hooks and rate-limit setting on a real Better
 * Auth instance with the plugin, the library limiter switched on as in
 * production, and every request through the proxy from one address.
 */

import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { twoFactor } from 'better-auth/plugins'
import { BETTER_AUTH_IP_ADDRESS } from './client-address'
import { proxy } from '../proxy'

// The stored password lock is the database's; nothing here reaches it.
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

const BASE = 'http://localhost'
const OFFICE = '203.0.113.9'

/** The request as the route handler sees it once the proxy has run. */
function throughProxy(path: string, body: unknown, cookie = '') {
  const request = new NextRequest(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': OFFICE, cookie },
    body: JSON.stringify(body),
  })
  const response = proxy(request)
  const headers = new Headers()
  const overridden = (response.headers.get('x-middleware-override-headers') ?? '').split(',')
  for (const name of overridden.filter(Boolean)) {
    const value = response.headers.get(`x-middleware-request-${name}`)
    if (value !== null) headers.set(name, value)
  }
  return new Request(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}

/** `name=value` pairs from a response's Set-Cookie headers, as a Cookie header. */
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .filter((pair) => !pair!.endsWith('='))
    .join('; ')

/** RFC 6238 — what an authenticator app computes from the enrolment URI. */
function totp(uri: string, at = Date.now()): string {
  const secret = new URL(uri).searchParams.get('secret')!
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const mac = createHmac('sha1', key).update(counter).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, '0')
}

/** A wrong code that is certainly wrong now. */
const wrong = (uri: string) => String((Number(totp(uri)) + 500_000) % 1_000_000).padStart(6, '0')

async function office(people: number) {
  __resetThrottle()
  process.env.TRUSTED_PROXY_HOPS = '1'
  const auth = betterAuth({
    secret: 'a-test-secret-that-is-long-enough-to-pass-0123456789',
    baseURL: BASE,
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      twoFactor: [],
    }),
    emailAndPassword: {
      enabled: true,
      password: {
        hash: async (plain: string) => `plain:${plain}`,
        verify: async ({ hash, password }: { hash: string; password: string }) =>
          hash === `plain:${password}`,
      },
    },
    hooks: authHooks,
    rateLimit: { ...AUTH_RATE_LIMIT, enabled: true, storage: 'memory' },
    advanced: { ipAddress: BETTER_AUTH_IP_ADDRESS },
    plugins: [twoFactor({ issuer: 'Qabandi test' })],
  })

  /*
    Enrolled through `auth.api`, which the router's limiter never sees, so the
    setup cannot trip what is under test. The enrolment check runs through the
    hooks all the same, with the right code.
  */
  const uris: string[] = []
  for (let i = 0; i < people; i += 1) {
    const password = `password-${i}-long`
    const signedUp = await auth.api.signUpEmail({
      body: { email: `finance${i}@qabandi.test`, password, name: `F${i}` },
      asResponse: true,
    })
    const cookie = cookiesOf(signedUp)
    const { totpURI } = await auth.api.enableTwoFactor({
      body: { password },
      headers: new Headers({ cookie }),
    })
    await auth.api.verifyTOTP({ body: { code: totp(totpURI) }, headers: new Headers({ cookie }) })
    uris.push(totpURI)
  }

  /** The password step from the office, leaving the challenge cookie. */
  const challenge = async (i: number) => {
    const response = await auth.handler(
      throughProxy('/api/auth/sign-in/email', {
        email: `finance${i}@qabandi.test`,
        password: `password-${i}-long`,
      }),
    )
    expect(response.status).toBe(200)
    return cookiesOf(response)
  }

  const verify = (cookie: string, code: string) =>
    auth.handler(throughProxy('/api/auth/two-factor/verify-totp', { code }, cookie))

  return { uris, challenge, verify }
}

describe('confirming TOTP from one address', () => {
  it('lets thirty people verify their codes at once', async () => {
    const { uris, challenge, verify } = await office(30)
    const cookies = await Promise.all(uris.map((_, i) => challenge(i)))
    const statuses = await Promise.all(
      cookies.map((cookie, i) => verify(cookie, totp(uris[i]!)).then((r) => r.status)),
    )
    expect(statuses.filter((status) => status === 200)).toHaveLength(30)
  }, 30_000)

  it('locks one user after five wrong codes, and nobody else', async () => {
    const { uris, challenge, verify } = await office(3)
    const cookie = await challenge(0)

    const statuses: number[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await verify(cookie, wrong(uris[0]!))).status)
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    const locked = await verify(cookie, wrong(uris[0]!))
    expect(statuses[5]).toBe(403)
    expect(((await locked.json()) as { code?: string }).code).toBe('ACCOUNT_LOCKED')

    // The right code is refused too while the lock stands.
    expect((await verify(cookie, totp(uris[0]!))).status).toBe(403)

    // A colleague at the same address is untouched.
    expect((await verify(await challenge(1), totp(uris[1]!))).status).toBe(200)
  }, 30_000)
})
