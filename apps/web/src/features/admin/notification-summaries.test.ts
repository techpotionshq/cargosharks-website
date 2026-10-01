/**
 * Every notification event has a summary in both languages — U1.
 *
 * The settings page printed `NOTIFICATION_EVENTS[].summary`, the developer's
 * English description in `core`, on the Arabic page too. It now reads
 * `notificationTemplates.summaries.<event>` from the catalogue, and an event
 * added to `core` without one would render a missing-message error — so the
 * catalogue is checked against the event list here.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NOTIFICATION_EVENTS } from '@qabandi/core'

// Read, not imported — see `assistant/labels.test.ts` for why.
const MESSAGES = join(dirname(fileURLToPath(import.meta.url)), '../../../messages')
const catalogue = (locale: string) =>
  JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), 'utf8')) as Record<string, unknown>

const lookup = (messages: Record<string, unknown>, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages)

describe('notification event summaries', () => {
  for (const locale of ['en', 'ar']) {
    it(`has one for every event in ${locale}`, () => {
      const messages = catalogue(locale)
      const missing = NOTIFICATION_EVENTS.map((event) => event.key).filter(
        (key) => typeof lookup(messages, `notificationTemplates.summaries.${key}`) !== 'string',
      )
      expect(missing).toEqual([])
    })
  }

  it('says it in Arabic on the Arabic page, not in English', () => {
    const ar = catalogue('ar')
    for (const event of NOTIFICATION_EVENTS) {
      expect(lookup(ar, `notificationTemplates.summaries.${event.key}`)).not.toBe(event.summary)
    }
  })
})
