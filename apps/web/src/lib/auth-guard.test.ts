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

  /** One wrong password, as the hooks see it end to end. */
  const failOnce = async (email: string, forwardedFor = '203.0.113.9') => {
    await guardBefore(signInRequest(email, forwardedFor))
    await recordAfter({
      ...signInRequest(email, forwardedFor),
      context: { returned: new APIError('UNAUTHORIZED', { message: 'Invalid email or password' }) },
    })
  }

  it('refuses an address once it has spent its failure budget', async () => {
    for (let i = 0; i < 50; i += 1) await failOnce(`a${i}@b.test`)

    lockout.readLockout.mockClear()
    expect((await refusal(guardBefore(signInRequest('a@b.test'))))?.code).toBe(
      AUTH_REFUSAL.signInThrottled,
    )
    expect(lockout.readLockout).not.toHaveBeenCalled()
  })

  /** A15: a header the caller wrote does not buy a fresh budget. */
  it('cannot be reset by prefixing a forged address', async () => {
    for (let i = 0; i < 50; i += 1) await failOnce(`a${i}@b.test`, `10.0.0.${i}, 203.0.113.9`)
    expect(
      (await refusal(guardBefore(signInRequest('a@b.test', '10.9.9.9, 203.0.113.9'))))?.code,
    ).toBe(AUTH_REFUSAL.signInThrottled)
  })

  /*
    R11: run 5 put forty people behind one address and refused thirty-seven.
    Fifty colleagues behind one office NAT, each with the right password, all
    get through.
  */
  it('lets fifty different people at one address sign in', async () => {
    for (let i = 0; i < 50; i += 1) {
      const request = signInRequest(`staff${i}@b.test`)
      await expect(guardBefore(request)).resolves.toBeUndefined()
      await recordAfter({ ...request, context: { returned: { token: `t${i}` } } })
    }
  })

  it('throttles eleven wrong passwords on one account', async () => {
    const outcomes: (string | null)[] = []
    for (let i = 0; i < 11; i += 1) {
      const refused = await refusal(guardBefore(signInRequest('owner@b.test')))
      outcomes.push(refused?.code ?? null)
      if (!refused) {
        await recordAfter({
          ...signInRequest('owner@b.test'),
          context: { returned: new APIError('UNAUTHORIZED', { message: 'no' }) },
        })
      }
    }
    // Five guesses reach the password check; every attempt after that is refused.
    expect(outcomes.slice(0, 5)).toEqual([null, null, null, null, null])
    expect(outcomes.slice(5).every((code) => code === AUTH_REFUSAL.accountLocked)).toBe(true)
  })

  /*
    Uniform answers: the stored lock only exists for real accounts, so the
    one in memory must refuse an unknown address at the same attempt with the
    same code, or the lock message tells a stranger which addresses are ours.
  */
  it('answers an unknown address exactly as it answers a real one', async () => {
    const answers = async (email: string) => {
      const seen: (ReturnType<typeof refusalOf> | null)[] = []
      for (let i = 0; i < 7; i += 1) {
        const refused = await refusal(guardBefore(signInRequest(email, `198.51.100.${i}`)))
        seen.push(refused)
        if (!refused) await failOnce(email, `198.51.100.${i}`)
      }
      return seen
    }
    // The stored lock says nothing for either: an unknown address has no row,
    // and the real one is behind by a process restart.
    expect(await answers('nobody@b.test')).toEqual(await answers('owner@b.test'))
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

  it('clears the run once the password was right', async () => {
    for (let i = 0; i < 4; i += 1) {
      await guardBefore(signInRequest('a@b.test'))
      await recordAfter({
        ...signInRequest('a@b.test'),
        context: { returned: new APIError('UNAUTHORIZED', { message: 'no' }) },
      })
    }
    await recordAfter({ ...signInRequest('a@b.test'), context: { returned: { token: 't' } } })

    expect(lockout.clearSignInFailures).toHaveBeenCalledWith('a@b.test')
    // A fifth mistake after the success does not lock: the run started again.
    await recordAfter({
      ...signInRequest('a@b.test'),
      context: { returned: new APIError('UNAUTHORIZED', { message: 'no' }) },
    })
    await expect(guardBefore(signInRequest('a@b.test'))).resolves.toBeUndefined()
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
