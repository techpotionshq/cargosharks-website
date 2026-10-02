/**
 * Opening an alert goes only where an alert can point — A13.
 *
 * The bell's form posts the `href`, and the action redirected to whatever it
 * was given: the product's own domain as a redirector to anywhere.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ redirected: null as string | null, read: [] as string[] }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    harness.redirected = to
    throw new Error(`NEXT_REDIRECT:${to}`)
  },
}))
vi.mock('@/lib/session', () => ({ requireSession: async () => ({ actor: {} }) }))
vi.mock('./queries', () => ({
  markRead: async (_actor: unknown, id: string) => {
    harness.read.push(id)
  },
  markAllRead: async () => {},
}))

const { openNotification } = await import('./actions')

async function open(href: string) {
  const form = new FormData()
  form.set('id', 'n1')
  form.set('href', href)
  try {
    await openNotification(form)
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith('NEXT_REDIRECT:'))) throw error
  }
}

beforeEach(() => {
  harness.redirected = null
  harness.read = []
})

describe('opening an alert', () => {
  it('goes to the job or enquiry it is about', async () => {
    await open('/jobs/0192f1a2-7b3c-7d4e-8f50-123456789abc')
    expect(harness.redirected).toBe('/jobs/0192f1a2-7b3c-7d4e-8f50-123456789abc')
    await open('/enquiries/enq-1041')
    expect(harness.redirected).toBe('/enquiries/enq-1041')
  })

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    '/settings/users',
    'javascript:alert(1)',
  ])('refuses to send anyone to %s, and still marks the alert read', async (href) => {
    await open(href)
    expect(harness.redirected).toBeNull()
    expect(harness.read).toEqual(['n1'])
  })
})
