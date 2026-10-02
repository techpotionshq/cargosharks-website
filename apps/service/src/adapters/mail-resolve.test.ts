/**
 * Which email channel a mail configuration resolves to, and what the boot line
 * says about it.
 *
 * The case that matters is the half-configured relay. It used to fall back to
 * the log driver, which accepts every send, so a stray `SMTP_USER` with no
 * password marked customer mail `sent` while none of it left (D14). The log
 * driver is now reached only by choosing it; a broken relay refuses each send
 * with the reason, which is what makes the dispatcher and the intake turn
 * record a failure instead of a success.
 *
 * The settings layer is stubbed: its cache cannot be cleared by design, so a
 * test that switched configuration through the environment within one run
 * would read whichever value it saw first.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveIntegration } from '../settings'

const current = vi.hoisted(() => ({
  values: {} as Record<string, string | undefined>,
  driver: 'smtp' as string | undefined,
}))

vi.mock('../settings', () => ({
  integration: async (key: string) => fake(key),
  noteIntegrationResult: async () => {},
}))

function fake(key: string): LiveIntegration {
  return {
    key,
    driver: current.driver,
    live: true,
    missing: [],
    fromRow: false,
    text: (name) => current.values[name],
    number: (name, fallback) => {
      const parsed = Number(current.values[name])
      return Number.isFinite(parsed) && current.values[name] !== undefined ? parsed : fallback
    },
    bool: (name, fallback) => {
      const raw = current.values[name]
      return raw === undefined ? fallback : raw !== 'false'
    },
    secret: (name) => current.values[name],
  }
}

const { describeMail, resolveEmailChannel } = await import('./index')

const message = {
  to: 'maryam@customer.test',
  subject: 'Re: RFQ',
  body: 'Thanks',
  locale: 'en' as const,
}

describe('the email channel a configuration resolves to', () => {
  beforeEach(() => {
    current.driver = 'smtp'
    current.values = { host: 'smtp.relay.test', port: '587', from: 'desk@forwarder.test' }
  })

  it('refuses every send, naming why, when a username has no password', async () => {
    current.values.user = 'desk@forwarder.test'
    const logged: string[] = []
    const channel = await resolveEmailChannel((_, m) => logged.push(m))

    const result = await channel.send(message)
    expect(result.accepted).toBe(false)
    expect(result.error).toContain('mail is not configured')
    expect(result.error).toContain('no password')
    // Never the log driver's fake success.
    expect(result.externalRef).toBeUndefined()
    expect(logged.some((m) => m.includes('email not sent'))).toBe(false)
  })

  it('uses the log driver only when it is the chosen driver', async () => {
    current.driver = 'log'
    current.values.user = 'desk@forwarder.test' // ignored: nothing is sent
    const channel = await resolveEmailChannel(() => {})
    const result = await channel.send(message)
    expect(result.accepted).toBe(true)
    expect(result.externalRef).toMatch(/^log:/)
  })

  it('builds the relay when the configuration is whole', async () => {
    current.values.user = 'desk@forwarder.test'
    current.values.password = 'secret'
    const channel = await resolveEmailChannel(() => {})
    expect(channel.key).toBe('email')
  })

  it('says on the boot line which of the three things mail is doing', () => {
    expect(describeMail(fake('smtp'))).toBe('smtp smtp.relay.test:587')
    current.values.user = 'desk@forwarder.test'
    expect(describeMail(fake('smtp'))).toMatch(/^smtp smtp\.relay\.test:587 REFUSING every send: /)
    current.driver = 'log'
    expect(describeMail(fake('smtp'))).toContain('not sending')
  })
})
