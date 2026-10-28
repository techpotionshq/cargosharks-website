import { describe, expect, it } from 'vitest'
import { pickTopic } from '../scripts/blog/generate.mjs'

const topic = (title: string, targetQuery: string, archetype = 'guide') => ({
  id: title,
  title,
  targetQuery,
  archetype,
})

describe('pickTopic', () => {
  // A post on a search a landing page already targets competes with that page.
  it('sets aside topics whose search is already a landing page', () => {
    const known = new Set(['/whatsapp-for-freight-forwarders/'])
    const whatsapp = topic('Handling WhatsApp enquiries', 'WhatsApp for freight forwarders')
    const weight = topic('Chargeable weight', 'chargeable weight air freight')
    const { topic: picked, duplicates } = pickTopic([whatsapp, weight], known)
    expect(picked).toBe(weight)
    expect(duplicates).toEqual([whatsapp])
  })

  it('still needs an expert note for a comparison', () => {
    const { topic: picked, reason } = pickTopic([topic('A vs B', 'a vs b', 'comparison')])
    expect(picked).toBeUndefined()
    expect(reason).toMatch(/expert note/)
  })
})
