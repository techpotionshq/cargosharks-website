/**
 * Signing in, signing out, and resetting a password.
 *
 * The only slice where the interesting assertions are about what the code
 * *refuses to tell you*. Four of them, and each is a specific attack:
 *
 * **One message for "no such user" and "wrong password".** Two messages turn
 * the sign-in form into an account-enumeration oracle (FR-ID-04).
 *
 * **The reset form answers the same either way.** It matters more there than
 * on sign-in, because probing it needs no password at all — so an unknown
 * address and a real one both come back `done`, and a thrown error from the
 * auth library is swallowed rather than surfaced.
 *
 * **Every session cookie is cleared, under both of its names.**
 * `useSecureCookies` renames them rather than only adding an attribute, so in
 * production they are `__Secure-qabandi.…`. Matching the bare prefix cleared
 * nothing on a deployed environment and the next request signed the operator
 * straight back in. A browser also *rejects* a `__Secure-` cookie that arrives
 * without `Secure`, so the deletion has to carry the attribute or it leaves
 * behind the very cookie it exists to remove.
 *
 * **A reset ends every session rather than starting one.** Somebody resetting
 * a password may be doing it because another person has it; Better Auth
 * revokes the account's sessions, and issuing a fresh one here would quietly
 * reintroduce what was just revoked.
 *
 * No database. Every edge this touches is a library or a framework store, so
 * they are stubbed and the logic between them is what runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APIError } from 'better-auth/api'

const harness = vi.hoisted(() => ({
  redirected: null as string | null,
  cookies: [] as { name: string; value: string }[],
  deleted: [] as { name: string; path?: string; secure?: boolean }[],
  set: [] as { name: string; value: string; options: Record<string, unknown> }[],
  signInEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  signOutApi: vi.fn(),
  /** What the proxy says the caller's address is. Null means no header. */
  forwardedFor: null as string | null,
  /** Whether the pilot fixtures stand in for a database. */
  pilot: false,
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    harness.redirected = to
    throw new Error(`NEXT_REDIRECT:${to}`)
  },
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => harness.cookies,
    delete: (options: { name: string; path?: string; secure?: boolean }) =>
      harness.deleted.push(options),
    set: (name: string, value: string, options: Record<string, unknown>) =>
      harness.set.push({ name, value, options }),
  }),
  // `signIn` reads `x-forwarded-for` to spend the per-address budget
  // (FR-ID-05). Without this the whole file fails on a missing export rather
  // than on anything it means to assert.
  headers: async () => ({
    get: (name: string) => (name === 'x-forwarded-for' ? harness.forwardedFor : null),
  }),
}))

/*
  The lockout and the throttles are no longer this file's: they run inside
  Better Auth (`lib/auth-guard.ts`, proved in `auth-guard.test.ts`), because
  the raw `/api/auth` route skipped every control that lived here (A1). What
  is left for the action is translating a refusal, which is asserted below.
*/
vi.mock('@/lib/pilot/source', () => ({
  useDemoLogin: () => false,
  usePilotFixtures: () => harness.pilot,
}))

/** The message keys stand in for the sentences, so an assertion names the case. */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

vi.mock('@/lib/auth', () => ({
  MIN_PASSWORD_LENGTH: 12,
  auth: {
    api: {
      signInEmail: (...args: unknown[]) => harness.signInEmail(...args),
      requestPasswordReset: (...args: unknown[]) => harness.requestPasswordReset(...args),
      resetPassword: (...args: unknown[]) => harness.resetPassword(...args),
      signOut: (...args: unknown[]) => harness.signOutApi(...args),
    },
  },
}))

const { signIn, signOut, requestPasswordReset, resetPassword } = await import('./actions')

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

/** A `Response` carrying whatever `Set-Cookie` headers the case needs. */
const responseWith = (headers: string[], ok = true, body: unknown = null) => {
  const h = new Headers()
  for (const value of headers) h.append('set-cookie', value)
  const self = { ok, headers: h, json: async () => body, clone: () => self }
  return self as unknown as Response
}

/** Both actions navigate on success, and `redirect()` throws to do it. */
async function navigating<T>(run: () => Promise<T>): Promise<{ result?: T; to: string | null }> {
  harness.redirected = null
  try {
    return { result: await run(), to: harness.redirected }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) {
      return { to: harness.redirected }
    }
    throw error
  }
}

describe('signing in and out', () => {
  beforeEach(() => {
    harness.redirected = null
    harness.cookies = []
    harness.deleted = []
    harness.set = []
    harness.forwardedFor = null
    harness.pilot = false
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('signing in', () => {
    it('takes the operator to the dashboard', async () => {
      harness.signInEmail.mockResolvedValue(responseWith(['qabandi.session_token=abc; Path=/']))

      const { to } = await navigating(() => signIn({}, form({ email: 'a@b.test', password: 'x' })))

      expect(to).toBe('/dashboard')
    })

    /** One identity per person, whatever the caps lock was doing. */
    it('lower-cases and trims the address before it tries', async () => {
      harness.signInEmail.mockResolvedValue(responseWith([]))

      await navigating(() =>
        signIn({}, form({ email: '  Ahmed@Qabandi.TEST ', password: 'secret' })),
      )

      expect(harness.signInEmail).toHaveBeenCalledWith(
        expect.objectContaining({ body: { email: 'ahmed@qabandi.test', password: 'secret' } }),
      )
    })

    /**
     * `getSetCookie` is the one accessor that keeps multiple `Set-Cookie`
     * headers separate. `get('set-cookie')` folds them into one comma-joined
     * string and silently corrupts any cookie whose attributes contain a
     * comma — which `Expires` does.
     */
    it('carries every cookie across, not just the first', async () => {
      harness.signInEmail.mockResolvedValue(
        responseWith([
          'qabandi.session_token=abc; Path=/; HttpOnly; SameSite=Lax',
          'qabandi.session_data=xyz; Path=/; Max-Age=3600',
        ]),
      )

      await navigating(() => signIn({}, form({ email: 'a@b.test', password: 'x' })))

      expect(harness.set.map((c) => c.name)).toEqual([
        'qabandi.session_token',
        'qabandi.session_data',
      ])
    })

    it('carries the attributes that matter for a session cookie', async () => {
      harness.signInEmail.mockResolvedValue(
        responseWith([
          'qabandi.session_token=abc; Path=/app; HttpOnly; Secure; SameSite=Strict; Max-Age=900; Domain=qabandi.test',
        ]),
      )

      await navigating(() => signIn({}, form({ email: 'a@b.test', password: 'x' })))

      expect(harness.set[0]!.options).toMatchObject({
        path: '/app',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 900,
        domain: 'qabandi.test',
      })
    })

    it('decodes a cookie value the library percent-encoded', async () => {
      harness.signInEmail.mockResolvedValue(
        responseWith(['qabandi.session_token=a%2Bb%3Dc; Path=/']),
      )

      await navigating(() => signIn({}, form({ email: 'a@b.test', password: 'x' })))

      expect(harness.set[0]!.value).toBe('a+b=c')
    })

    it('ignores a header that is not a cookie at all', async () => {
      harness.signInEmail.mockResolvedValue(responseWith(['nonsense-with-no-equals']))

      await navigating(() => signIn({}, form({ email: 'a@b.test', password: 'x' })))

      expect(harness.set).toEqual([])
    })

    it('asks for both an address and a password', async () => {
      expect((await signIn({}, form({ email: 'a@b.test' }))).error).toBe('signIn.errorMissing')
      expect((await signIn({}, form({ password: 'x' }))).error).toBe('signIn.errorMissing')
      expect(harness.signInEmail).not.toHaveBeenCalled()
    })

    /**
     * The enumeration oracle, closed. A thrown `APIError` for a bad password
     * and a non-ok response for an unknown address are the same sentence.
     */
    it('says the same thing whether the account exists or the password was wrong', async () => {
      harness.signInEmail.mockRejectedValue(new Error('APIError: invalid password'))
      const wrongPassword = await signIn({}, form({ email: 'a@b.test', password: 'x' }))

      harness.signInEmail.mockResolvedValue(responseWith([], false))
      const noSuchUser = await signIn({}, form({ email: 'nobody@b.test', password: 'x' }))

      expect(wrongPassword.error).toBe('signIn.errorInvalid')
      expect(noSuchUser.error).toBe(wrongPassword.error)
    })

    /** The form keeps what was typed, so a retype is only the password. */
    it('echoes the address back on a failure', async () => {
      harness.signInEmail.mockResolvedValue(responseWith([], false))

      const state = await signIn({}, form({ email: 'Ahmed@B.test', password: 'x' }))

      expect(state.email).toBe('ahmed@b.test')
    })

    it('sets no cookie when the attempt failed', async () => {
      harness.signInEmail.mockResolvedValue(responseWith(['qabandi.session_token=abc'], false))

      await signIn({}, form({ email: 'a@b.test', password: 'x' }))

      expect(harness.set).toEqual([])
    })
  })

  /*
    Guessing, and what it costs — FR-ID-05, A1.

    The counting and the refusing happen inside Better Auth now
    (`lib/auth-guard.test.ts`). This asserts the half the action still owns:
    that a refusal comes back as the right sentence, whether Better Auth threw
    it or answered it as a non-ok response, and that the caller's headers go
    with the call so the guard can see who is asking.
  */
  describe('repeated attempts', () => {
    it("hands the request's headers to Better Auth, so the guard sees the address", async () => {
      harness.forwardedFor = '203.0.113.9'
      harness.signInEmail.mockResolvedValue(responseWith([]))

      await navigating(() => signIn({}, form({ email: 'a@b.test', password: 'x' })))

      const call = harness.signInEmail.mock.calls[0]![0] as {
        headers: { get(name: string): string | null }
      }
      expect(call.headers.get('x-forwarded-for')).toBe('203.0.113.9')
    })

    it('says the account is locked when the guard refused it', async () => {
      harness.signInEmail.mockResolvedValue(
        responseWith([], false, { code: 'ACCOUNT_LOCKED', minutesRemaining: 12 }),
      )

      const state = await signIn({}, form({ email: 'a@b.test', password: 'x' }))

      expect(state.error).toBe('signIn.errorLocked:{"minutes":12}')
    })

    it('says the caller is throttled, from a thrown refusal too', async () => {
      harness.signInEmail.mockRejectedValue(
        new APIError('TOO_MANY_REQUESTS', { code: 'SIGN_IN_THROTTLED', minutesRemaining: 4 }),
      )

      const state = await signIn({}, form({ email: 'a@b.test', password: 'x' }))

      expect(state.error).toBe('signIn.errorThrottled:{"minutes":4}')
    })

    /** Any other refusal is the one sentence — the oracle stays closed. */
    it('reads an unrecognised refusal as a wrong password', async () => {
      harness.signInEmail.mockResolvedValue(
        responseWith([], false, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'nope' }),
      )

      const state = await signIn({}, form({ email: 'a@b.test', password: 'x' }))

      expect(state.error).toBe('signIn.errorInvalid')
    })
  })

  describe('signing out', () => {
    /**
     * Both spellings. `useSecureCookies` renames rather than decorates, so
     * matching the bare prefix cleared nothing in production and the next
     * request signed the operator straight back in.
     */
    it('clears the session cookie under both of its names', async () => {
      harness.cookies = [
        { name: 'qabandi.session_token', value: 'a' },
        { name: '__Secure-qabandi.session_token', value: 'b' },
      ]

      await navigating(() => signOut())

      expect(harness.deleted.map((c) => c.name)).toEqual([
        'qabandi.session_token',
        '__Secure-qabandi.session_token',
      ])
    })

    /**
     * A browser rejects a `__Secure-`-prefixed cookie that arrives without
     * `Secure`, so the bare deletion would leave the very cookie it is meant
     * to remove.
     */
    it('marks the secure one secure, and states the path', async () => {
      harness.cookies = [
        { name: 'qabandi.session_token', value: 'a' },
        { name: '__Secure-qabandi.session_token', value: 'b' },
      ]

      await navigating(() => signOut())

      expect(harness.deleted[0]).toMatchObject({ path: '/', secure: false })
      expect(harness.deleted[1]).toMatchObject({ path: '/', secure: true })
    })

    it('leaves cookies that are not ours alone', async () => {
      harness.cookies = [
        { name: 'locale', value: 'ar' },
        { name: '_ga', value: 'x' },
        { name: 'qabandi.session_token', value: 'a' },
      ]

      await navigating(() => signOut())

      expect(harness.deleted.map((c) => c.name)).toEqual(['qabandi.session_token'])
    })

    it('takes the operator back to the sign-in page', async () => {
      const { to } = await navigating(() => signOut())
      expect(to).toBe('/sign-in')
    })

    /**
     * A5. Clearing the cookie alone left the session row live for twelve
     * hours, so a copied token kept working after its owner signed out.
     */
    it('revokes the session row, not only the cookie', async () => {
      harness.cookies = [{ name: 'qabandi.session_token', value: 'a' }]

      await navigating(() => signOut())

      expect(harness.signOutApi).toHaveBeenCalledTimes(1)
      expect(harness.deleted.map((c) => c.name)).toEqual(['qabandi.session_token'])
    })

    it('still signs the operator out when the row is already gone', async () => {
      harness.cookies = [{ name: 'qabandi.session_token', value: 'a' }]
      harness.signOutApi.mockRejectedValue(new Error('session not found'))

      const { to } = await navigating(() => signOut())

      expect(to).toBe('/sign-in')
      expect(harness.deleted.map((c) => c.name)).toEqual(['qabandi.session_token'])
    })
  })
})

describe('resetting a password', () => {
  beforeEach(() => {
    harness.redirected = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('asking for a link', () => {
    it('sends one, pointed at the reset page', async () => {
      harness.requestPasswordReset.mockResolvedValue(undefined)

      const state = await requestPasswordReset({}, form({ email: 'Ahmed@B.test' }))

      expect(state.done).toBe(true)
      expect(harness.requestPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { email: 'ahmed@b.test', redirectTo: '/reset-password' },
        }),
      )
    })

    /**
     * A1. The reset budget is per caller and per typed address, whatever the
     * address belongs to, so saying so tells nobody anything about accounts.
     */
    it('says so when the reset budget is spent', async () => {
      harness.requestPasswordReset.mockRejectedValue(
        new APIError('TOO_MANY_REQUESTS', { code: 'RESET_THROTTLED', minutesRemaining: 40 }),
      )

      const state = await requestPasswordReset({}, form({ email: 'a@b.test' }))

      expect(state.error).toBe('forgotPassword.errorThrottled:{"minutes":40}')
      expect(state.done).toBeUndefined()
    })

    /**
     * The oracle that matters most, because probing it needs no password. An
     * address that belongs to nobody gets the same answer as one that does —
     * including when the library throws for the unknown one.
     */
    it('answers the same for an address nobody has', async () => {
      harness.requestPasswordReset.mockResolvedValue(undefined)
      const known = await requestPasswordReset({}, form({ email: 'known@b.test' }))

      harness.requestPasswordReset.mockRejectedValue(new Error('APIError: user not found'))
      const unknown = await requestPasswordReset({}, form({ email: 'nobody@b.test' }))

      expect(known).toEqual({ done: true, email: 'known@b.test' })
      expect(unknown).toEqual({ done: true, email: 'nobody@b.test' })
    })

    it('asks for an address when none was given', async () => {
      const state = await requestPasswordReset({}, form({}))

      expect(state.error).toBe('forgotPassword.errorMissing')
      expect(harness.requestPasswordReset).not.toHaveBeenCalled()
    })
  })

  describe('setting the new one', () => {
    const reset = (extra: Record<string, string> = {}) =>
      form({ token: 'tok', password: 'a-long-enough-one', confirm: 'a-long-enough-one', ...extra })

    /**
     * Straight to sign-in rather than signing them in here. A person resetting
     * a password may be doing it because someone else has it — Better Auth
     * revokes the account's sessions, and issuing a fresh one from this
     * handler would quietly reintroduce what was just revoked.
     */
    it('sends them to sign in again rather than signing them in', async () => {
      harness.resetPassword.mockResolvedValue(undefined)

      const { to } = await navigating(() => resetPassword({}, reset()))

      expect(to).toBe('/sign-in?reset=1')
      expect(harness.resetPassword).toHaveBeenCalledWith({
        body: { newPassword: 'a-long-enough-one', token: 'tok' },
      })
    })

    it('refuses a link with no token on it', async () => {
      const state = await resetPassword({}, reset({ token: '' }))

      expect(state.error).toBe('resetPassword.errorNoToken')
      expect(harness.resetPassword).not.toHaveBeenCalled()
    })

    /** Checked here as well as by the library, so the sentence is translated. */
    it('refuses a password shorter than the minimum, and says the number', async () => {
      const state = await resetPassword({}, reset({ password: 'short', confirm: 'short' }))

      expect(state.error).toContain('resetPassword.errorTooShort')
      expect(state.error).toContain('12')
      expect(harness.resetPassword).not.toHaveBeenCalled()
    })

    it('refuses two passwords that do not agree', async () => {
      const state = await resetPassword({}, reset({ confirm: 'a-different-long-one' }))

      expect(state.error).toBe('resetPassword.errorMismatch')
      expect(harness.resetPassword).not.toHaveBeenCalled()
    })

    /**
     * Expired, already used, or invented — one message. Which of the three it
     * is tells an attacker something and tells the operator nothing they can
     * act on differently.
     */
    it('says the same thing for every kind of bad token', async () => {
      harness.resetPassword.mockRejectedValue(new Error('APIError: token expired'))
      const expired = await resetPassword({}, reset())

      harness.resetPassword.mockRejectedValue(new Error('APIError: invalid token'))
      const invented = await resetPassword({}, reset({ token: 'never-issued' }))

      expect(expired.error).toBe('resetPassword.errorBadToken')
      expect(invented.error).toBe(expired.error)
    })
  })
})
