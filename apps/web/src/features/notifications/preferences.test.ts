/**
 * A member of staff keeps their own email switches — R12.
 *
 * Written by the person on their own `principals` row, under their own actor,
 * by somebody holding no administration permission: the self-service clause
 * of `principals_scope` is what lets it through, and the identity guard on the
 * table must not mistake it for a change of who they are.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { homeActor, world } = await import('@/lib/testing/fixtures')
const { getInbox, setEmailOptOuts } = await import('./queries')

describe.skipIf(!enabled)('email switches', () => {
  beforeAll(async () => {
    await world()
  })

  afterAll(async () => {
    if (enabled) await setEmailOptOuts(homeActor, [])
  })

  it('are written by the person themselves and read back with the bell', async () => {
    await setEmailOptOuts(homeActor, ['enquiries', 'rates'])
    expect((await getInbox(homeActor, 'en')).emailOptOuts).toEqual(['enquiries', 'rates'])

    await setEmailOptOuts(homeActor, [])
    expect((await getInbox(homeActor, 'en')).emailOptOuts).toEqual([])
  })
})
