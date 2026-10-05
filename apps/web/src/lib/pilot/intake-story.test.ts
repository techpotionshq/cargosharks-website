/**
 * The demo intake agent reads what the customer wrote — no database.
 *
 * Writing the sales demo script found two things wrong with the scripted
 * conversation on ENQ-KWI-2026-0317 and 0318: the customer writes "2 × 40'HC"
 * and the agent still asked for the container type, and its reply quoted
 * `KWI-ENQ-2026-00418` beside a header reading `ENQ-KWI-2026-0318`. Both are
 * held here against the same data the screens render.
 */

import { describe, expect, it } from 'vitest'
import { containerTypeCode } from '@qabandi/core'
import {
  pilotEnquiries,
  pilotEnquiryConversation,
  pilotEnquiryIntake,
  pilotEnquiryProposals,
  pilotIntakeSettings,
} from './fixtures'

const NOW = Date.parse('2026-10-05T09:00:00Z')

describe('the scripted intake conversation', () => {
  it.each(['enq-317', 'enq-318'])(
    'quotes the reference %s is shown under, in the panel and the thread',
    (id) => {
      const reference = pilotEnquiries(NOW).find((row) => row.id === id)!.reference
      const reply = pilotEnquiryIntake(id, NOW).recent[0]!.replyBody
      expect(reply).toContain(`(${reference})`)

      const sent = pilotEnquiryConversation(id, NOW).messages.find(
        (message) => message.direction === 'outbound',
      )
      expect(sent?.body).toBe(reply)
    },
  )

  it('does not ask for a container type the customer already named', () => {
    const inbound = pilotEnquiryConversation('enq-318', NOW)
      .messages.filter((message) => message.direction === 'inbound')
      .map((message) => message.body)
    // The customer's own words fold to a code we hold...
    expect(inbound.map(containerTypeCode)).toContain('40HC')

    // ...so neither the agent nor its reply treats the box as missing.
    const intake = pilotEnquiryIntake('enq-318', NOW)
    expect(intake.missing).not.toContain('containerType')
    expect(intake.recent[0]!.missing).not.toContain('containerType')
    expect(intake.recent[0]!.replyBody).not.toMatch(/container type/i)

    // And what it does ask for is a requirement the office actually holds.
    const office = pilotIntakeSettings().find((row) => row.branchId === intake.branchId)!
    for (const key of intake.missing) {
      expect(office.requirements.map((requirement) => requirement.key)).toContain(key)
    }
  })

  it('suggests the boxes the customer named', () => {
    const proposals = pilotEnquiryProposals('enq-318')
    expect(proposals.find((row) => row.field === 'containerType')?.value).toBe('40HC')
    expect(proposals.find((row) => row.field === 'containerCount')?.value).toBe('2')
  })
})
