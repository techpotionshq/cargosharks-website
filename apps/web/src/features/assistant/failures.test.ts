/**
 * The assistant's failures are codes, and "no service" is its own — U1, U3.
 *
 * An unset `SERVICE_URL` used to arrive as a generic failure, which the panel
 * read as "your key is set — something between here and the model is down".
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { assistantFailure, isUnreachable } from './failures'

vi.mock('@/lib/session', () => ({
  getSession: async () => ({
    actor: { principalId: 'p', type: 'internal', branchIds: ['b'] },
    permissions: new Set<string>(),
    principal: { locale: 'ar' },
  }),
}))

const original = process.env.SERVICE_URL
afterEach(() => {
  if (original === undefined) delete process.env.SERVICE_URL
  else process.env.SERVICE_URL = original
})

describe('assistant failures', () => {
  it("reads the service's codes into the panel's", () => {
    expect(assistantFailure('ai.not_configured')).toBe('aiNotConfigured')
    expect(assistantFailure('ai.budget_exhausted')).toBe('aiBudgetExhausted')
    expect(assistantFailure('error')).toBe('couldNotFinish')
    expect(assistantFailure('serviceNotConfigured')).toBe('serviceNotConfigured')
    expect(assistantFailure('something new')).toBe('unreachable')
  })

  it('does not count a missing service as a service that is down', () => {
    expect(isUnreachable('serviceNotConfigured')).toBe(false)
    expect(isUnreachable('unreachable')).toBe(true)
  })

  it('answers an unconfigured service with its own code, not a sentence', async () => {
    delete process.env.SERVICE_URL
    const { POST } = await import('@/app/api/assistant/route')
    const response = await POST(
      new Request('http://app.test/api/assistant', {
        method: 'POST',
        body: JSON.stringify({ op: 'threads' }),
      }),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, reason: 'serviceNotConfigured' })
  })
})
