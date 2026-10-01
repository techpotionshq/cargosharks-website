/**
 * The lockout and the throttles, as Better Auth runs them — A1.
 *
 * These hooks are the reason `POST /api/auth/sign-in/email` can no longer
 * skip the lockout. Each assertion is about a request that never touches the
 * server action: a script posting straight at the route, as the sweep did.
 *
 * The lockout policy is proved in `core` and the budget arithmetic in
 * `throttle.test.ts`; the database half is stubbed so this stays about which
 * request is refused, counted or cleared.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APIError } from 'better-auth/api'

const lockout = vi.hoisted(() => ({
  readLockout: vi.fn(),
  recordSignInFailure: vi.fn(),
  clearSignInFailures: vi.fn(),
}))

vi.mock('./lockout', () => lockout)

const { guardBefore, recordAfter, refusalOf, AUTH_REFUSAL } = await import('./auth-guard')
const { __resetThrottle } = await import('./throttle')

const headersFrom = (forwardedFor?: string) =>
  new Headers(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {})

/** What a raw `POST /api/auth/sign-in/email` looks like to a hook. */
const signInRequest = (email: string, forwardedFor = '203.0.113.9') => ({
  path: '/sign-in/email',
  body: { email, password: 'guess' },
  headers: headersFrom(forwardedFor),
})

async function refusal(work: Promise<unknown>) {
  try {
    await work
  } catch (error) {
    return refusalOf(error)
  }
  return null
}

beforeEach(() => {
  __resetThrottle()
  vi.clearAllMocks()
  lockout.readLockout.mockResolvedValue(null)
})

describe('before a sign-in', () => {
  it('refuses a locked account before its password is compared', async () => {
    lockout.readLockout.mockResolvedValue({ locked: true, until: new Date(), minutesRemaining: 9 })

    expect(await refusal(guardBefore(signInRequest('Owner@B.test')))).toEqual({
      code: AUTH_REFUSAL.accountLocked,
      minutesRemaining: 9,
    })
    // Read under the address as an account would store it.
    expect(lockout.readLockout).toHaveBeenCalledWith('owner@b.test')
  })

  it('lets an unlocked account through', async () => {
    await expect(guardBefore(signInRequest('a@b.test'))).resolves.toBeUndefined()
  })

  it('spends the per-address budget on every attempt, and then refuses', async () => {
    for (let i = 0; i < 10; i += 1) await guardBefore(signInRequest(`a${i}@b.test`))

    lockout.readLockout.mockClear()
    expect((await refusal(guardBefore(signInRequest('a@b.test'))))?.code).toBe(
      AUTH_REFUSAL.signInThrottled,
    )
    expect(lockout.readLockout).not.toHaveBeenCalled()
  })

  /** A15: a header the caller wrote does not buy a fresh budget. */
  it('cannot be reset by prefixing a forged address', async () => {
    for (let i = 0; i < 10; i += 1) {
      await guardBefore(signInRequest('a@b.test', `10.0.0.${i}, 203.0.113.9`))
    }
    expect(
      (await refusal(guardBefore(signInRequest('a@b.test', '10.9.9.9, 203.0.113.9'))))?.code,
    ).toBe(AUTH_REFUSAL.signInThrottled)
  })

  it('leaves every other endpoint alone', async () => {
    lockout.readLockout.mockResolvedValue({ locked: true, until: new Date(), minutesRemaining: 9 })
    await expect(
      guardBefore({ path: '/get-session', headers: headersFrom('203.0.113.9') }),
    ).resolves.toBeUndefined()
  })
})

describe('after a sign-in', () => {
  it('counts a wrong password', async () => {
    await recordAfter({
      ...signInRequest('a@b.test'),
      context: { returned: new APIError('UNAUTHORIZED', { message: 'Invalid email or password' }) },
    })
    expect(lockout.recordSignInFailure).toHaveBeenCalledWith('a@b.test')
    expect(lockout.clearSignInFailures).not.toHaveBeenCalled()
  })

  it('does not count a refusal that was not a password guess', async () => {
    await recordAfter({
      ...signInRequest('a@b.test'),
      context: { returned: new APIError('BAD_REQUEST', { message: 'Invalid body' }) },
    })
    expect(lockout.recordSignInFailure).not.toHaveBeenCalled()
  })

  it('clears the run, and the address budget, once the password was right', async () => {
    for (let i = 0; i < 9; i += 1) await guardBefore(signInRequest('a@b.test'))
    await recordAfter({ ...signInRequest('a@b.test'), context: { returned: { token: 't' } } })

    expect(lockout.clearSignInFailures).toHaveBeenCalledWith('a@b.test')
    // The full ten again, which proves the budget was returned.
    for (let i = 0; i < 10; i += 1) await guardBefore(signInRequest('a@b.test'))
  })

  it('never turns a failure to count into a failure to answer', async () => {
    lockout.recordSignInFailure.mockRejectedValue(new Error('database is down'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      recordAfter({
        ...signInRequest('a@b.test'),
        context: { returned: new APIError('UNAUTHORIZED', { message: 'no' }) },
      }),
    ).resolves.toBeUndefined()
    quiet.mockRestore()
  })
})

describe('asking for a reset link', () => {
  const resetRequest = (email: string, forwardedFor = '203.0.113.9') => ({
    path: '/request-password-reset',
    body: { email },
    headers: headersFrom(forwardedFor),
  })

  it('stops one mailbox being flooded from many addresses', async () => {
    for (let i = 0; i < 3; i += 1) {
      await guardBefore(resetRequest('owner@b.test', `198.51.100.${i}`))
    }
    expect((await refusal(guardBefore(resetRequest('owner@b.test', '198.51.100.99'))))?.code).toBe(
      AUTH_REFUSAL.resetThrottled,
    )
  })

  it('stops one address walking a list of mailboxes', async () => {
    for (let i = 0; i < 10; i += 1) await guardBefore(resetRequest(`m${i}@b.test`))
    expect((await refusal(guardBefore(resetRequest('m99@b.test'))))?.code).toBe(
      AUTH_REFUSAL.resetThrottled,
    )
  })
})
