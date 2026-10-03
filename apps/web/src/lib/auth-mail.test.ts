/**
 * What the service said about a reset mail, as the web app hears it.
 *
 * The service answers 202 whether it sent the mail or, on a deployment set to
 * log only, wrote it down and sent nothing. Read as "sent", an administrator
 * was told an invitation had gone that never would, and was offered no link.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const { deliverResetMail } = await import('./auth')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const answering = (body: unknown) => {
  vi.stubEnv('SERVICE_URL', 'http://service.test')
  vi.stubEnv('INTERNAL_API_SECRET', 'secret')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 202, json: async () => body })),
  )
}

describe('deliverResetMail', () => {
  it('reports a mail the service only logged as logged', async () => {
    answering({ status: 'logged' })
    expect(await deliverResetMail('a@example.test', 'https://app.test/r', 'invitation')).toBe(
      'logged',
    )
  })

  it('reports a delivered one as sent', async () => {
    answering({ status: 'sent' })
    expect(await deliverResetMail('a@example.test', 'https://app.test/r')).toBe('sent')
  })
})
