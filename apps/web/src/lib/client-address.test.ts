/**
 * Which `X-Forwarded-For` entry is the caller — A15.
 *
 * The leftmost entry is whatever the caller sent, so every assertion here is a
 * variation on one: a header the client wrote must never become the address.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  addressFromForwardedFor,
  addressInRanges,
  clientAddressFrom,
  trustedProxyHops,
} from './client-address'

const original = process.env.TRUSTED_PROXY_HOPS
const originalRanges = process.env.CLOUDFLARE_IP_RANGES

afterEach(() => {
  if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS
  else process.env.TRUSTED_PROXY_HOPS = original
  if (originalRanges === undefined) delete process.env.CLOUDFLARE_IP_RANGES
  else process.env.CLOUDFLARE_IP_RANGES = originalRanges
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

/*
  R11: behind Cloudflare the trusted-hop entry is an edge address, shared by
  everybody. `CF-Connecting-IP` names the visitor, but only Cloudflare's own
  requests carry a value Cloudflare wrote.
*/
describe('CF-Connecting-IP', () => {
  const from = (forwardedFor: string, connecting?: string) =>
    clientAddressFrom(
      new Headers({
        'x-forwarded-for': forwardedFor,
        ...(connecting ? { 'cf-connecting-ip': connecting } : {}),
      }),
    )

  it('names the visitor when the connection came from a Cloudflare edge', () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    expect(from('198.51.100.20, 162.158.1.10', '198.51.100.20')).toBe('198.51.100.20')
    expect(from('2606:4700:10::ac43:1', '2001:db8::7')).toBe('2001:db8::7')
  })

  it('is ignored when the origin was reached directly, so it cannot be forged', () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    expect(from('203.0.113.9', '1.2.3.4')).toBe('203.0.113.9')
    // Nor can a forged left-hand entry make the peer look like Cloudflare.
    expect(from('162.158.1.10, 203.0.113.9', '1.2.3.4')).toBe('203.0.113.9')
  })

  it('is ignored with no proxy in front at all', () => {
    process.env.TRUSTED_PROXY_HOPS = '0'
    expect(from('162.158.1.10', '1.2.3.4')).toBeNull()
  })

  it('falls back to the edge when the header is missing or not an address', () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    expect(from('162.158.1.10')).toBe('162.158.1.10')
    expect(from('162.158.1.10', 'not-an-address')).toBe('162.158.1.10')
  })

  it('gives the same answer once Cloudflare is counted as a hop', () => {
    process.env.TRUSTED_PROXY_HOPS = '2'
    expect(from('198.51.100.20, 162.158.1.10', '198.51.100.20')).toBe('198.51.100.20')
  })

  it('takes a replacement range list from the environment', () => {
    process.env.TRUSTED_PROXY_HOPS = '1'
    process.env.CLOUDFLARE_IP_RANGES = '192.0.2.0/24'
    expect(from('192.0.2.5', '198.51.100.20')).toBe('198.51.100.20')
    expect(from('162.158.1.10', '198.51.100.20')).toBe('162.158.1.10')
  })

  it('matches ranges by prefix, for both families', () => {
    expect(addressInRanges('104.16.0.1', ['104.16.0.0/13'])).toBe(true)
    expect(addressInRanges('104.24.0.1', ['104.16.0.0/13'])).toBe(false)
    expect(addressInRanges('2a06:98c7::1', ['2a06:98c0::/29'])).toBe(true)
    expect(addressInRanges('2a06:98c8::1', ['2a06:98c0::/29'])).toBe(false)
    expect(addressInRanges('300.1.1.1', ['0.0.0.0/0'])).toBe(false)
    expect(addressInRanges('10.0.0.1', ['garbage'])).toBe(false)
  })
})
