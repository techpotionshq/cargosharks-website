import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

const { demoReadOnly, demoReadOnlyMessage } = await import('./read-only')

describe('demoReadOnly', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('refuses in fixture mode, in words, and hands the form back', async () => {
    process.env.QABANDI_PILOT_FIXTURES = '1'
    delete process.env.DATABASE_URL
    const form = new FormData()
    form.set('name', 'Integration for Alghanim')

    const refusal = await demoReadOnly(form)
    expect(refusal?.message).toBe('app.demoReadOnly')
    expect(refusal?.values).toEqual({ name: 'Integration for Alghanim' })
    expect(await demoReadOnlyMessage()).toBe('app.demoReadOnly')
  })

  it('stays out of the way on an instance with a database', async () => {
    process.env.QABANDI_PILOT_FIXTURES = '0'
    process.env.DATABASE_URL = 'postgres://example/qabandi'
    expect(await demoReadOnly(new FormData())).toBeNull()
  })
})
