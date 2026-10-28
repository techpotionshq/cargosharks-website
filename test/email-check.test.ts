import { describe, expect, it } from 'vitest'
import { checkEmail } from '../src/cms/email-check'

// Throwaway inboxes and free providers are decided without the network.
describe('checkEmail', () => {
  it('refuses a disposable inbox, and its subdomains', async () => {
    expect(await checkEmail('a@mailinator.com')).toEqual({ ok: false, reason: 'disposable' })
    expect(await checkEmail('a@x.yopmail.com')).toEqual({ ok: false, reason: 'disposable' })
  })

  it('refuses the domains reserved for testing', async () => {
    expect(await checkEmail('a@example.com')).toEqual({ ok: false, reason: 'undeliverable' })
    expect(await checkEmail('a@shop.test')).toEqual({ ok: false, reason: 'undeliverable' })
  })

  it('accepts a free provider and marks it personal', async () => {
    expect(await checkEmail('owner@gmail.com')).toEqual({ ok: true, personal: true })
  })

  it('does not confuse a lookalike with a disposable domain', async () => {
    const verdict = await checkEmail('ops@notmailinator.com.kw')
    expect(verdict).not.toEqual({ ok: false, reason: 'disposable' })
  })
})
