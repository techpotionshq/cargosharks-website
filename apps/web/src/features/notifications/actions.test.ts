/**
 * Opening an alert goes only where an alert can point — A13.
 *
 * The bell's form posts the `href`, and the action redirected to whatever it
 * was given: the product's own domain as a redirector to anywhere.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  redirected: null as string | null,
  read: [] as string[],
  optOuts: null as readonly string[] | null,
  actorType: 'internal' as string,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    harness.redirected = to
    throw new Error(`NEXT_REDIRECT:${to}`)
  },
}))
vi.mock('@/lib/session', () => ({
  requireSession: async () => ({ actor: { type: harness.actorType } }),
}))
// A database deployment: the demo answers before it writes anything.
vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => false }))
vi.mock('./queries', () => ({
  markRead: async (_actor: unknown, id: string) => {
    harness.read.push(id)
  },
  markAllRead: async () => {},
  setEmailOptOuts: async (_actor: unknown, groups: readonly string[]) => {
    harness.optOuts = groups
  },
}))

const { openNotification, saveEmailPreferences } = await import('./actions')

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
  harness.optOuts = null
  harness.actorType = 'internal'
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

/** R12: a member of staff turns email off per group; the bell stays on. */
describe('choosing which alerts arrive by email', () => {
  const save = async (ticked: string[]) => {
    const form = new FormData()
    for (const group of ticked) form.append('email', group)
    await saveEmailPreferences(form)
  }

  it('stores the groups left unticked as the ones to stop', async () => {
    await save(['quotes', 'operations', 'rates', 'suppliers', 'finance'])
    expect(harness.optOuts).toEqual(['enquiries'])
  })

  it('stores nothing when every box is ticked', async () => {
    await save(['enquiries', 'quotes', 'operations', 'rates', 'suppliers', 'finance'])
    expect(harness.optOuts).toEqual([])
  })

  it('ignores a value that is not a group', async () => {
    await save(['enquiries', 'quotes', 'operations', 'rates', 'suppliers', 'finance', 'x'])
    expect(harness.optOuts).toEqual([])
  })

  it('writes nothing for a customer or agent contact', async () => {
    harness.actorType = 'customer_contact'
    await save([])
    expect(harness.optOuts).toBeNull()
  })
})
