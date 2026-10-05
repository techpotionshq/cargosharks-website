/**
 * A provider's refusal read into a code the screen can translate (NEW-2).
 * Each string is a shape a provider has returned, or one it must not match.
 */

import { describe, expect, it } from 'vitest'
import { deliveryRefusal, integrationFailure, isWhatsAppWindowClosed } from '../src/provider-errors'

describe('reading a provider refusal', () => {
  it('knows the 24-hour window in every shape it has been returned', () => {
    for (const error of [
      'kapso 422: {"error":"Cannot send non-template messages outside the 24-hour window."}',
      'kapso 400: {"error":{"message":"Re-engagement message","code":131047}}',
      'Message failed to send because more than 24 hours have passed since the customer last replied',
      'outside the customer service window',
    ]) {
      expect(deliveryRefusal(error), error).toBe('whatsapp_window')
    }
  })

  it('reads anything else as other', () => {
    expect(deliveryRefusal('kapso 401: invalid api key')).toBe('other')
    expect(deliveryRefusal('550 mailbox unavailable')).toBe('other')
    expect(isWhatsAppWindowClosed(null)).toBe(false)
    expect(isWhatsAppWindowClosed('')).toBe(false)
  })
})

describe('integrationFailure', () => {
  it('reads a rejected key as a credentials problem', () => {
    expect(integrationFailure('Maersk track-and-trace returned 401 — consumer key rejected')).toBe(
      'credentials',
    )
    expect(integrationFailure('Invalid login: 535 Authentication failed')).toBe('credentials')
  })

  it('tells an unreachable host and an outage apart', () => {
    expect(integrationFailure('connect ECONNREFUSED 10.0.0.1:587')).toBe('unreachable')
    expect(integrationFailure('Request timed out after 15000ms')).toBe('unreachable')
    expect(integrationFailure('Hapag-Lloyd returned 503 Service Unavailable')).toBe('provider_down')
  })

  it('names a certificate, a limit and a missing resource', () => {
    expect(integrationFailure('self-signed certificate in certificate chain')).toBe('certificate')
    expect(integrationFailure('429 Too Many Requests')).toBe('rate_limited')
    expect(integrationFailure('CMA CGM returned 404')).toBe('not_found')
  })

  it('falls back to other, and to other for nothing', () => {
    expect(integrationFailure('something nobody anticipated')).toBe('other')
    expect(integrationFailure(null)).toBe('other')
  })
})
