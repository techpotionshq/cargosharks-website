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

const harness = vi.hoisted(() => ({ seen: [] as (string | undefined)[] }))

vi.mock('@/lib/auth', async () => {
  const resetMailOutcome = new AsyncLocalStorage<string[]>()
  const resetMailIntent = new AsyncLocalStorage<string>()
  return {
    resetMailOutcome,
    resetMailIntent,
    auth: {
      api: {
        requestPasswordReset: async () => {
          harness.seen.push(resetMailIntent.getStore())
          resetMailOutcome.getStore()?.push('sent')
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
    expect(await sendSignInLink('new@example.test')).toBe('sent')
    expect(await sendSignInLink('known@example.test', 'reset')).toBe('sent')
    expect(harness.seen).toEqual(['invitation', 'reset'])
  })

  it('leaves no intent behind for the public reset form', async () => {
    await sendSignInLink('new@example.test', 'invitation')
    expect(resetMailIntent.getStore()).toBeUndefined()
  })
})
