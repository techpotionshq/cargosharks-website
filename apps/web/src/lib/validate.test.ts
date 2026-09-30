/**
 * `localeParse` — zod's own messages replaced by the catalogue's, and never
 * over a message the rule carries itself.
 *
 * The precedence is zod's, not ours (rule message, then per-parse map, then
 * locale), so these pin it: an upgrade that changed the order would put a
 * generic sentence over one a translator wrote, and nothing else would notice.
 * The translator stands in with its keys, as in `auth/actions.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const harness = vi.hoisted(() => ({ request: true }))

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    if (!harness.request) throw new Error('no request')
    return (key: string, values?: Record<string, unknown>) =>
      values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`
  },
}))

const { localeParse } = await import('./validate')

const messagesFor = async (schema: z.ZodType, input: unknown) => {
  const parsed = await localeParse(schema, input)
  expect(parsed.success).toBe(false)
  return (parsed.error?.issues ?? []).map((issue) => issue.message)
}

describe('localeParse', () => {
  beforeEach(() => {
    harness.request = true
  })

  it('keeps a rule’s own message', async () => {
    expect(await messagesFor(z.string().min(2, 'catalogue message'), 'x')).toEqual([
      'catalogue message',
    ])
  })

  it('replaces zod’s defaults with catalogue sentences', async () => {
    expect(await messagesFor(z.string().min(3), 'x')).toEqual(['validation.tooShort:{"minimum":3}'])
    expect(await messagesFor(z.string().max(2), 'xyz')).toEqual([
      'validation.tooLong:{"maximum":2}',
    ])
    expect(await messagesFor(z.string().length(2), 'xyz')).toEqual([
      'validation.exactLength:{"length":2}',
    ])
    expect(await messagesFor(z.number().min(1), 0)).toEqual([
      'validation.numberTooSmall:{"minimum":1}',
    ])
    expect(await messagesFor(z.array(z.string()).min(1), [])).toEqual([
      'validation.chooseAtLeast:{"minimum":1}',
    ])
    expect(await messagesFor(z.uuid(), 'nope')).toEqual(['validation.chooseOption'])
    expect(await messagesFor(z.email(), 'nope')).toEqual(['validation.validEmail'])
    expect(await messagesFor(z.enum(['a', 'b']), 'c')).toEqual(['validation.chooseOption'])
    expect(await messagesFor(z.number(), 'x')).toEqual(['validation.expectedNumber'])
  })

  it('falls back to zod’s English where there is no request to read a locale from', async () => {
    harness.request = false
    const schema = z.uuid()
    expect(await messagesFor(schema, 'nope')).toEqual([
      schema.safeParse('nope').error?.issues[0]?.message,
    ])
  })

  it('returns the parsed value on success', async () => {
    const parsed = await localeParse(z.object({ code: z.string().min(2) }), { code: 'KWI' })
    expect(parsed.success && parsed.data.code).toBe('KWI')
  })
})
