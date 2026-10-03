/**
 * A provider's refusal read into a code the screen can translate (NEW-2).
 * Each string is a shape a provider has returned, or one it must not match.
 */

import { describe, expect, it } from 'vitest'
import { deliveryRefusal, isWhatsAppWindowClosed } from '../src/provider-errors'

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
