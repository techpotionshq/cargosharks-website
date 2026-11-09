import { describe, expect, it } from 'vitest'
import { CALL_URL } from '@/content/copy'
import { callUrl } from '@/lib/booking'

/**
 * The "pick a time" link after a quote request: Cal.com's own page, with the
 * name and email the visitor just typed, and nothing else.
 */
describe('callUrl', () => {
  it('prefills the name and email on the intro-call page', () => {
    const url = new URL(callUrl({ name: 'Fatima Al-Sabah', email: 'fatima@example.com' }))
    expect(`${url.origin}${url.pathname}`).toBe(CALL_URL)
    expect(url.searchParams.get('name')).toBe('Fatima Al-Sabah')
    expect(url.searchParams.get('email')).toBe('fatima@example.com')
  })

  it('carries nothing else from the form', () => {
    const url = new URL(callUrl({ name: 'A', email: 'a@example.com' }))
    expect([...url.searchParams.keys()].sort()).toEqual(['email', 'name'])
  })

  it('leaves out what is blank instead of sending it empty', () => {
    expect(callUrl({ name: '  ', email: null })).toBe(CALL_URL)
  })

  it('encodes an Arabic name so the link still opens', () => {
    const url = new URL(callUrl({ name: 'فاطمة الصباح', email: 'f@example.com' }))
    expect(url.searchParams.get('name')).toBe('فاطمة الصباح')
  })
})
