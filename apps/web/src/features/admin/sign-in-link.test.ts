/**
 * The sign-in link carries its intent into the mail hook (D11).
 *
 * Better Auth has one hook for every set-password mail, so the wording is
 * chosen from `resetMailIntent`, which only `sendSignInLink` sets. This stands
 * a fake `requestPasswordReset` in for the library and reads the store from
 * inside it, exactly where `sendResetPassword` reads it.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  seen: [] as (string | undefined)[],
  outcome: 'sent' as string,
}))

vi.mock('@/lib/auth', async () => {
  const resetMailOutcome = new AsyncLocalStorage<{ outcome: string; url: string }[]>()
  const resetMailIntent = new AsyncLocalStorage<string>()
  return {
    resetMailOutcome,
    resetMailIntent,
    auth: {
      api: {
        requestPasswordReset: async () => {
          harness.seen.push(resetMailIntent.getStore())
          resetMailOutcome
            .getStore()
            ?.push({ outcome: harness.outcome, url: 'https://app.test/reset-password/t' })
        },
      },
    },
  }
})

const { sendSignInLink } = await import('./sign-in-link')
const { resetMailIntent } = await import('@/lib/auth')

describe('sendSignInLink', () => {
  it('words a link as an invitation unless told it is a reset', async () => {
    harness.seen = []
    expect((await sendSignInLink('new@example.test')).outcome).toBe('sent')
    expect((await sendSignInLink('known@example.test', 'reset')).outcome).toBe('sent')
    expect(harness.seen).toEqual(['invitation', 'reset'])
  })

  /*
    The link is handed over only where nothing was delivered and nothing can be
    taken over: an invitation, on a deployment that logs mail. A reset's link
    would let the administrator sign in as somebody with a password.
  */
  it('hands over the link for a logged invitation, and for nothing else', async () => {
    try {
      expect((await sendSignInLink('new@example.test')).handOver).toBeNull()

      harness.outcome = 'logged'
      const invited = await sendSignInLink('new@example.test', 'invitation')
      expect(invited).toEqual({
        outcome: 'logged',
        handOver: 'https://app.test/reset-password/t',
      })
      expect((await sendSignInLink('known@example.test', 'reset')).handOver).toBeNull()
    } finally {
      harness.outcome = 'sent'
    }
  })

  it('leaves no intent behind for the public reset form', async () => {
    await sendSignInLink('new@example.test', 'invitation')
    expect(resetMailIntent.getStore()).toBeUndefined()
  })
})
