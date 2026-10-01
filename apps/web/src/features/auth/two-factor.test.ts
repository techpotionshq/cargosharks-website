/**
 * The sign-in challenge takes a backup code — A6.
 *
 * The page has always told a person who lost their phone to enter a backup
 * code, and the field stripped every letter and demanded six digits. These
 * assert which endpoint each shape of input reaches; the library spends the
 * code and keeps its own failure counters.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  verifyTOTP: vi.fn(),
  verifyBackupCode: vi.fn(),
  redirected: null as string | null,
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    harness.redirected = to
    throw new Error(`NEXT_REDIRECT:${to}`)
  },
}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock('qrcode', () => ({ default: { toString: async () => '' } }))
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      verifyTOTP: (...args: unknown[]) => harness.verifyTOTP(...args),
      verifyBackupCode: (...args: unknown[]) => harness.verifyBackupCode(...args),
    },
  },
}))

const { verifyChallenge } = await import('./two-factor')

const ok = () => ({ ok: true, headers: new Headers() }) as unknown as Response
const form = (code: string) => {
  const data = new FormData()
  data.set('code', code)
  return data
}

async function submit(code: string) {
  try {
    return await verifyChallenge({}, form(code))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) return null
    throw error
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.verifyTOTP.mockResolvedValue(ok())
  harness.verifyBackupCode.mockResolvedValue(ok())
})

describe('the challenge', () => {
  it('sends six digits, however spaced, to the authenticator check', async () => {
    await submit('123 456')
    expect(harness.verifyTOTP).toHaveBeenCalledWith(
      expect.objectContaining({ body: { code: '123456' } }),
    )
    expect(harness.verifyBackupCode).not.toHaveBeenCalled()
  })

  it('sends a backup code, case kept, to the backup check', async () => {
    await submit('aB3x9-Q7kLm')
    expect(harness.verifyBackupCode).toHaveBeenCalledWith(
      expect.objectContaining({ body: { code: 'aB3x9-Q7kLm' } }),
    )
    expect(harness.verifyTOTP).not.toHaveBeenCalled()
  })

  it('accepts a backup code typed without its dash, or with spaces', async () => {
    await submit(' aB3x9 Q7kLm ')
    expect(harness.verifyBackupCode).toHaveBeenCalledWith(
      expect.objectContaining({ body: { code: 'aB3x9-Q7kLm' } }),
    )
  })

  it('signs the person in when the backup code is accepted', async () => {
    await submit('aB3x9-Q7kLm')
    expect(harness.redirected).toBe('/dashboard')
  })

  it('says the same thing for a spent backup code as for a wrong one', async () => {
    harness.verifyBackupCode.mockRejectedValue(new Error('APIError: invalid backup code'))
    expect((await submit('aB3x9-Q7kLm'))?.error).toBe('twoFactor.errorInvalid')
  })

  it('names both kinds of code when the field is neither', async () => {
    expect((await submit('12'))?.error).toBe('twoFactor.errorMissingOrBackup')
  })
})
