/**
 * The notification catalogue and the send switches — FR-NT-01…04.
 *
 * The catalogue itself is a data literal and tests as one: the assertions
 * worth writing are that the *vocabulary agrees with itself*, because the
 * whole point of declaring these in `core` is that a raiser, a template row
 * and the dispatcher's lookup cannot drift apart silently.
 *
 * `channelDecision` earns more scrutiny. It is the only thing standing
 * between an administrator's toggle and a customer's inbox, and both of its
 * failure directions are bad in ways that do not look alike:
 *
 *   - **wrongly on** sends mail somebody asked to stop — visible, embarrassing,
 *     and at least self-reporting;
 *   - **wrongly off** sends nothing, and silence is indistinguishable from a
 *     system that is working. Nobody files a ticket about an email that did
 *     not arrive because nobody knows it was due.
 *
 * That asymmetry is why absence means *on*, and why the tests below spend most
 * of their time on the empty and partial cases rather than on the happy path.
 */

import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_EVENTS,
  noticeNoLongerApplies,
  channelDecision,
  notificationEvent,
  notificationEventKeys,
  type NotificationSwitch,
} from '../src/notifications'

const on = (eventKey: string | null, channel = 'email'): NotificationSwitch => ({
  eventKey,
  channel,
  isEnabled: true,
})

const off = (eventKey: string | null, channel = 'email'): NotificationSwitch => ({
  eventKey,
  channel,
  isEnabled: false,
})

describe('the event catalogue', () => {
  it('declares every key exactly once', () => {
    const keys = notificationEventKeys()
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('names every event `noun.verb` with a single dot', () => {
    // The dot is load-bearing beyond style: `next-intl` reads it as a path
    // separator, so a key with two dots cannot be given a label on the
    // settings screen without nesting the messages a second level deep.
    for (const key of notificationEventKeys()) {
      expect(key, key).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })

  it('gives every event an audience, because recipient resolution reads it', () => {
    for (const event of NOTIFICATION_EVENTS) {
      expect(['customer', 'internal'], event.key).toContain(event.audience)
    }
  })

  it('resolves a declared key and refuses an undeclared one', () => {
    expect(notificationEvent('invoice.overdue')?.audience).toBe('customer')
    expect(notificationEvent('invoice.nonsense')).toBeUndefined()
  })
})

describe('channelDecision', () => {
  it('sends when nothing is configured at all', () => {
    // The case every deployment is in before somebody opens the screen. If
    // this ever returns false, a fresh install silently stops writing to
    // customers and looks perfectly healthy doing it.
    expect(channelDecision([], 'invoice.overdue', 'email')).toEqual({ enabled: true })
  })

  it('sends when the switches concern other events', () => {
    const switches = [off('job.eta_changed'), off('job.milestone_reached')]
    expect(channelDecision(switches, 'invoice.overdue', 'email').enabled).toBe(true)
  })

  it('silences one event without touching its neighbours', () => {
    const switches = [off('job.eta_changed')]

    const quiet = channelDecision(switches, 'job.eta_changed', 'email')
    expect(quiet.enabled).toBe(false)
    expect(quiet.enabled === false && quiet.reason).toContain('job.eta_changed')

    expect(channelDecision(switches, 'invoice.overdue', 'email').enabled).toBe(true)
  })

  it('lets the master switch silence everything, per-event rows notwithstanding', () => {
    /*
      The relay-migration case, and the reason the master is checked first.

      An administrator stopping mail for an hour must not have to find and
      clear thirteen toggles — and, far worse, must not have to remember to
      put all thirteen back afterwards. A master that merely defaulted the
      others would leave that restoration to memory.
    */
    const switches = [off(null), on('invoice.overdue'), on('job.created')]

    for (const event of NOTIFICATION_EVENTS) {
      const decision = channelDecision(switches, event.key, 'email')
      expect(decision.enabled, event.key).toBe(false)
      expect(decision.enabled === false && decision.reason).toContain('switched off')
    }
  })

  it('an explicitly-on master leaves the per-event rows in charge', () => {
    const switches = [on(null), off('quote.expiring')]
    expect(channelDecision(switches, 'quote.expiring', 'email').enabled).toBe(false)
    expect(channelDecision(switches, 'quote.sent', 'email').enabled).toBe(true)
  })

  it('keeps channels apart', () => {
    // A future WhatsApp switch must not reach into email. The dispatcher
    // targets every registered channel, so a decision that ignored `channel`
    // would silence a channel nobody had configured a switch for.
    const switches = [off(null, 'whatsapp'), off('invoice.overdue', 'whatsapp')]
    expect(channelDecision(switches, 'invoice.overdue', 'email').enabled).toBe(true)
    expect(channelDecision(switches, 'invoice.overdue', 'whatsapp').enabled).toBe(false)
  })

  it('gives distinguishable reasons for the two ways of being off', () => {
    /*
      These strings land in `notification_deliveries.suppressed_reason` and are
      read by a person asking "why did this not go out". "The channel is off"
      and "this event is off" send that person to two different screens, so
      they must not read alike.
    */
    const master = channelDecision([off(null)], 'invoice.overdue', 'email')
    const event = channelDecision([off('invoice.overdue')], 'invoice.overdue', 'email')

    expect(master.enabled).toBe(false)
    expect(event.enabled).toBe(false)
    expect(master.enabled === false && master.reason).not.toBe(
      event.enabled === false && event.reason,
    )
  })
})

describe('noticeNoLongerApplies, a held notice re-read at send time', () => {
  it('drops a quotation notice once the customer has answered it', () => {
    expect(noticeNoLongerApplies('quote.sent', 'QUO-1', 'accepted')).toBe(
      'no longer applies: quotation QUO-1 is accepted',
    )
    expect(noticeNoLongerApplies('quote.expiring', 'QUO-1', 'superseded')).toContain('superseded')
    expect(noticeNoLongerApplies('quote.sent', 'QUO-1', 'sent')).toBeNull()
  })

  it('drops an invoice notice once the invoice is settled, not while part paid', () => {
    expect(noticeNoLongerApplies('invoice.issued', 'KWI-1', 'paid')).toBe(
      'no longer applies: invoice KWI-1 is paid',
    )
    expect(noticeNoLongerApplies('invoice.overdue', 'KWI-1', 'void')).not.toBeNull()
    expect(noticeNoLongerApplies('invoice.overdue', 'KWI-1', 'part_paid')).toBeNull()
  })

  it('sends when the record cannot be found, and for events that never go stale', () => {
    expect(noticeNoLongerApplies('invoice.issued', 'KWI-1', null)).toBeNull()
    expect(noticeNoLongerApplies('job.milestone_reached', 'KWI-JOB-1', 'closed')).toBeNull()
  })
})
