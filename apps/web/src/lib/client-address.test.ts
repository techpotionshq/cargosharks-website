/**
 * Which `X-Forwarded-For` entry is the caller — A15.
 *
 * The leftmost entry is whatever the caller sent, so every assertion here is a
 * variation on one: a header the client wrote must never become the address.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { addressFromForwardedFor, trustedProxyHops } from './client-address'

const original = process.env.TRUSTED_PROXY_HOPS

afterEach(() => {
  if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS
  else process.env.TRUSTED_PROXY_HOPS = original
})

describe('the client address', () => {
  it('trusts one hop by default — the proxy in front of the container', () => {
    delete process.env.TRUSTED_PROXY_HOPS
    expect(trustedProxyHops()).toBe(1)
    expect(addressFromForwardedFor('203.0.113.9')).toBe('203.0.113.9')
  })

  it('ignores whatever the caller put in front of the entry our proxy wrote', () => {
    expect(addressFromForwardedFor('6.6.6.6, 7.7.7.7, 203.0.113.9', 1)).toBe('203.0.113.9')
  })

  it('reads further left only for proxies the deployment says it runs', () => {
    expect(addressFromForwardedFor('6.6.6.6, 203.0.113.9, 10.0.0.2', 2)).toBe('203.0.113.9')
  })

  it('believes nothing when there is no proxy in front', () => {
    expect(addressFromForwardedFor('203.0.113.9', 0)).toBeNull()
  })

  it('believes nothing when the chain is shorter than the proxies it should have passed', () => {
    expect(addressFromForwardedFor('203.0.113.9', 2)).toBeNull()
    expect(addressFromForwardedFor(null, 1)).toBeNull()
  })

  it('falls back to the default on a value it cannot read', () => {
    process.env.TRUSTED_PROXY_HOPS = 'two'
    expect(trustedProxyHops()).toBe(1)
    process.env.TRUSTED_PROXY_HOPS = '2'
    expect(trustedProxyHops()).toBe(2)
  })
})
