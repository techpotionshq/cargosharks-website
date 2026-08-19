/**
 * The carrier-direct HTTP, against a stubbed `fetch`.
 *
 * The translation has its own suite (`dcsa-events.test.ts`); what is checked
 * here is the part where getting it wrong produces an integration that looks
 * live and returns nothing forever — the wrong query parameter for a
 * reference type, a 404 read as "nothing has happened", or a credential
 * failure quietly retried against every shipment in the fleet.
 *
 * No environment is resolved: `fetchDcsaEvents` and `dcsaTracking` both take
 * their credentials as arguments, which is what lets this run in CI with no
 * carrier account and no `.env`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DCSA_CARRIERS,
  DcsaError,
  dcsaTracking,
  fetchDcsaEvents,
  type DcsaCarrierProfile,
} from './dcsa-tracking'

const maersk = DCSA_CARRIERS.find((c) => c.key === 'maersk')!
const hapag = DCSA_CARRIERS.find((c) => c.key === 'hapag')!

const DISCHARGE = {
  eventType: 'EQUIPMENT',
  eventClassifierCode: 'ACT',
  equipmentEventTypeCode: 'DISC',
  eventDateTime: '2026-08-14T11:02:00Z',
  eventLocation: { UNLocationCode: 'KWSWK' },
}

const respond = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

let calls: { url: URL; init: RequestInit }[]

/**
 * Record every request, and answer the two kinds this adapter makes.
 *
 * One mock rather than a queue of canned responses, because the token
 * exchange is a *second* request the caller does not ask for — a queue would
 * have to know where it lands, and the tests that care about ordering are
 * exactly the ones that would then be asserting on the fixture.
 */
const record = (answer: (url: URL) => Response) =>
  vi.fn((input: URL | string, init: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    return Promise.resolve(answer(url))
  })

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    record((url) =>
      url.pathname.includes('access_token')
        ? respond({ access_token: 'tok-1', expires_in: 3600 })
        : respond([DISCHARGE]),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DCSA carrier request', () => {
  /**
   * Three parameters and not one, which is the whole reason `TrackingQuery`
   * carries a type. Asking `equipmentReference=` with a bill of lading
   * returns an empty list from a working carrier, which on the board is
   * indistinguishable from a shipment nothing has happened to.
   */
  it('asks with the parameter that matches the reference type', async () => {
    // Lengths that Maersk actually accepts — nine for the documents, eleven
    // for the box. The spec's own example values.
    for (const [type, param, value] of [
      ['booking_number', 'carrierBookingReference', 'VAS000001'],
      ['bill_of_lading', 'transportDocumentReference', '260029935'],
      ['container', 'equipmentReference', 'APZU4812090'],
    ] as const) {
      await fetchDcsaEvents(maersk, { key: 'k' }, { reference: value, type })
      const url = calls.at(-1)!.url
      expect(url.searchParams.get(param), type).toBe(value)
    }
  })

  it('sends each carrier its own credential headers', async () => {
    await fetchDcsaEvents(
      maersk,
      { key: 'consumer-key' },
      { reference: 'BKG000001', type: 'booking_number' },
    )
    expect((calls.at(-1)!.init.headers as Record<string, string>)['Consumer-Key']).toBe(
      'consumer-key',
    )

    await fetchDcsaEvents(
      hapag,
      { key: 'id', secret: 'shh' },
      { reference: 'BKG000001', type: 'booking_number' },
    )
    const headers = calls.at(-1)!.init.headers as Record<string, string>
    expect(headers['X-IBM-Client-Id']).toBe('id')
    expect(headers['X-IBM-Client-Secret']).toBe('shh')
  })

  /**
   * Maersk's own pre-production host, from the spec's `servers` block. A trial
   * key issued against pre-prod is refused by production with the same
   * `ERR_GW_001` a wrong key gets, so this override is the difference between
   * a five-minute fix and an afternoon.
   */
  it('honours a base URL this deployment overrode for pre-production', async () => {
    const stage: DcsaCarrierProfile = {
      ...maersk,
      baseUrl: 'https://api-stage.maersk.com/track-and-trace/',
    }
    await fetchDcsaEvents(stage, { key: 'k' }, { reference: 'BKG000001', type: 'booking_number' })

    expect(calls.at(-1)!.url.href).toContain(
      'https://api-stage.maersk.com/track-and-trace/public-events?',
    )
  })

  /**
   * The path matters as much as the host: one gateway, two products, and a key
   * for one is refused by the other in a way that reads as a bad key.
   *
   * Both halves are overridden together here, and that is the documented way
   * to switch products — the `/track-and-trace` prefix belongs to the open
   * product and lives in the base URL, so moving the path alone would nest one
   * inside the other.
   */
  it('reaches the private product when both halves are overridden', async () => {
    const priv: DcsaCarrierProfile = {
      ...maersk,
      baseUrl: 'https://api.maersk.com',
      eventsPath: '/track-and-trace-private/events',
    }
    await fetchDcsaEvents(priv, { key: 'k' }, { reference: 'BKG000001', type: 'booking_number' })

    expect(calls.at(-1)!.url.pathname).toBe('/track-and-trace-private/events')
  })

  /**
   * DCSA answers a bare array; gateways wrap it anyway. Reading only one shape
   * would produce "the integration returned nothing", which is exactly what a
   * quiet shipment looks like.
   */
  it('reads the event list however the gateway wrapped it', async () => {
    for (const body of [[DISCHARGE], { events: [DISCHARGE] }, { data: [DISCHARGE] }]) {
      vi.mocked(fetch).mockResolvedValueOnce(respond(body))
      const reading = await fetchDcsaEvents(
        maersk,
        { key: 'k' },
        { reference: 'BKG000001', type: 'booking_number' },
      )
      expect(reading.milestones.map((m) => m.code)).toEqual(['discharged'])
    }
  })

  /**
   * 404 is the carrier saying it has never heard of this reference — a
   * cancelled booking, a mistyped master bill. Not worth failing a run over,
   * and not the same thing as a quiet shipment, so it comes back flagged
   * rather than as an indistinguishable empty answer.
   */
  it('flags a 404 rather than answering as though the shipment were quiet', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond({ message: 'not found' }, 404))

    const reading = await fetchDcsaEvents(
      maersk,
      { key: 'k' },
      { reference: 'GONE00001', type: 'bill_of_lading' },
    )

    expect(reading.unknownReference).toBe(true)
    expect(reading.milestones).toEqual([])

    // A shipment nothing has happened to yet answers 200 with an empty list,
    // and must *not* carry the flag — that difference is the whole point.
    vi.mocked(fetch).mockResolvedValueOnce(respond([]))
    const quiet = await fetchDcsaEvents(
      maersk,
      { key: 'k' },
      { reference: 'BKG000001', type: 'booking_number' },
    )

    expect(quiet.unknownReference).toBeUndefined()
    expect(quiet.milestones).toEqual([])
  })

  /**
   * The distinction the poll worker acts on: a bad key is this deployment's
   * fault and no retry fixes it, so the run stops rather than spending the
   * rest of the batch proving the same thing to the same carrier.
   */
  it('marks a credential failure fatal and a rate limit retryable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond({ error: 'unauthorized' }, 401))
    const fatal = await fetchDcsaEvents(
      maersk,
      { key: 'wrong' },
      { reference: 'BKG000001', type: 'booking_number' },
    ).catch((error: unknown) => error)

    // `instanceof` and not the shape, because that is the check the poll
    // worker makes before deciding whether to abandon the run.
    expect(fatal).toBeInstanceOf(DcsaError)
    expect(fatal).toMatchObject({ status: 401, retryable: false })

    vi.mocked(fetch).mockResolvedValueOnce(respond({ error: 'slow down' }, 429))
    const transient = await fetchDcsaEvents(
      maersk,
      { key: 'k' },
      { reference: 'BKG000001', type: 'booking_number' },
    ).catch((error: unknown) => error)

    expect(transient).toBeInstanceOf(DcsaError)
    expect(transient).toMatchObject({ status: 429, retryable: true })
  })

  /**
   * The common way a real reference fails, and it is not the operator's fault:
   * a bill of lading is printed with spaces because that is how people read
   * twelve digits, and a gateway matching `[a-zA-Z0-9]{9}` accepts none of it.
   */
  it('sends the reference as the carrier spells it, not as it was typed', async () => {
    await fetchDcsaEvents(maersk, { key: 'k' }, { reference: ' mrku 123456-7 ', type: 'container' })

    expect(calls.at(-1)!.url.searchParams.get('equipmentReference')).toBe('MRKU1234567')
  })

  /**
   * The quota leak this exists to stop. The poll runs hourly, so one bill of
   * lading with a digit missing spends a call an hour, forever, to be told the
   * same thing — on a tier capped at twenty an hour.
   */
  it('refuses a reference too short to match, without spending a call', async () => {
    const reading = await fetchDcsaEvents(
      maersk,
      { key: 'k' },
      { reference: 'ABC123', type: 'bill_of_lading' },
    )

    expect(reading.malformedReference).toContain('6 characters')
    expect(calls).toHaveLength(0)
  })

  /**
   * Too *long* is refused as well, and that was not obvious.
   *
   * JSON Schema `pattern` is unanchored, so `[a-zA-Z0-9]{9}` reads as "contains
   * nine alphanumerics" and a longer reference ought to pass. The live gateway
   * says otherwise: nine characters answer `404` (looked up, not found), ten
   * answer `400 Validation errors`. Maersk anchors it, so the bound is a range
   * and not a floor.
   */
  it('refuses a reference longer than the carrier accepts', async () => {
    const reading = await fetchDcsaEvents(
      maersk,
      { key: 'k' },
      { reference: 'MAEU1234567890', type: 'bill_of_lading' },
    )

    expect(reading.malformedReference).toContain('exactly 9')
    expect(calls).toHaveLength(0)
  })

  /** A container is the one kind with room to vary — `{11}` plus `maxLength: 15`. */
  it('allows a container reference anywhere in its documented range', async () => {
    for (const reference of ['APZU4812090', 'APZU481209012345']) {
      calls = []
      const reading = await fetchDcsaEvents(maersk, { key: 'k' }, { reference, type: 'container' })
      const asked = calls.length === 1

      expect(asked, reference).toBe(reference.length <= 15)
      if (!asked) expect(reading.malformedReference).toContain('between 11 and 15')
    }
  })

  /**
   * The pre-flight only knows the rules we have modelled. A carrier is entitled
   * to reject a reference for a reason we have not — a checksum, a prefix — and
   * that is still a data problem rather than a broken run.
   */
  it('treats a 400 as a bad reference rather than a failed run', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond({ message: 'invalid parameter' }, 400))

    const reading = await fetchDcsaEvents(
      maersk,
      { key: 'k' },
      { reference: '260029935', type: 'bill_of_lading' },
    )

    expect(reading.malformedReference).toContain('invalid parameter')
    expect(reading.milestones).toEqual([])
  })

  it('reports a carrier that answered with something that is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html>gateway timeout</html>', { status: 200 }),
    )

    const reading = await fetchDcsaEvents(
      maersk,
      { key: 'k' },
      { reference: 'BKG000001', type: 'booking_number' },
    )

    expect(reading.milestones).toEqual([])
  })
})

describe('the DCSA adapter as the port sees it', () => {
  it('claims only the SCACs it holds credentials for', () => {
    const adapter = dcsaTracking({ maersk: { key: 'k' } })

    expect(adapter.scacs).toEqual(expect.arrayContaining(['MAEU', 'SEAU']))
    expect(adapter.scacs).not.toContain('HLCU')
    expect(adapter.key).toContain('maersk')
  })

  it('routes a SCAC to the carrier group that answers for it', async () => {
    const adapter = dcsaTracking({ cmacgm: { key: 'k' } })

    // APL is CMA CGM's, and a lookup table per SCAC is what stops a shipment
    // on a group brand from looking like an unregistered carrier.
    await adapter.poll({ reference: 'BKG000001', type: 'booking_number', scac: 'APLU' })

    expect(calls.at(-1)!.url.host).toBe('apis.cma-cgm.net')
  })

  /**
   * Refused rather than answered empty, and this is the lesson Terminal49
   * paid for: an empty list means "nothing has happened to this container",
   * and on a quiet shipment that claim is indistinguishable from a working
   * feed.
   */
  it('refuses a poll it cannot honestly answer', async () => {
    const adapter = dcsaTracking({ maersk: { key: 'k' } })

    await expect(adapter.poll({ reference: 'BKG000001', type: 'booking_number' })).rejects.toThrow(
      /SCAC/,
    )
    await expect(
      adapter.poll({ reference: 'BKG000001', type: 'booking_number', scac: 'HLCU' }),
    ).rejects.toThrow(/No DCSA credentials for HLCU/)
    expect(calls).toHaveLength(0)
  })

  it('is case-insensitive about the SCAC an operator typed', async () => {
    const adapter = dcsaTracking({ maersk: { key: 'k' } })
    const milestones = await adapter.poll({
      reference: 'BKG000001',
      type: 'booking_number',
      scac: ' maeu ',
    })

    expect(milestones.map((m) => m.code)).toEqual(['discharged'])
  })

  /**
   * Maersk's private Track & Trace wants the Consumer-Key *and* a bearer. The
   * key identifies the application; the bearer authorises the customer whose
   * shipments are being asked about, and sending only the first is a 401 that
   * reads exactly like a wrong key.
   */
  it('exchanges a secret for a bearer, and sends both', async () => {
    const adapter = dcsaTracking({ maersk: { key: 'ck', secret: 'cs' } })
    await adapter.poll({ reference: 'BKG000001', type: 'booking_number', scac: 'MAEU' })

    const [token, events] = calls
    expect(token!.url.pathname).toBe('/customer-identity/oauth/v2/access_token')
    expect(String(token!.init.body)).toContain('grant_type=client_credentials')

    const headers = events!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-1')
    expect(headers['Consumer-Key']).toBe('ck')
  })

  /**
   * One exchange per carrier, not one per shipment. A poll run walks up to
   * `CARRIER_POLL_BATCH` shipments; asking for a fresh token before each would
   * triple the traffic and is the shape that trips a gateway's rate limit.
   */
  it('holds the bearer for as long as the carrier said it is good for', async () => {
    const adapter = dcsaTracking({ maersk: { key: 'ck', secret: 'cs' } })
    await adapter.poll({ reference: 'BKG000001', type: 'booking_number', scac: 'MAEU' })
    await adapter.poll({ reference: 'BKG000002', type: 'booking_number', scac: 'MAEU' })

    const exchanges = calls.filter((c) => c.url.pathname.includes('access_token'))
    expect(exchanges).toHaveLength(1)
  })

  it('skips the exchange for a carrier that authenticates on headers alone', async () => {
    const adapter = dcsaTracking({ maersk: { key: 'ck' } })
    await adapter.poll({ reference: 'BKG000001', type: 'booking_number', scac: 'MAEU' })

    expect(calls).toHaveLength(1)
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('refuses to retry a token exchange the carrier rejected', async () => {
    vi.stubGlobal(
      'fetch',
      record(() => respond({ error: 'invalid_client' }, 401)),
    )

    const adapter = dcsaTracking({ maersk: { key: 'ck', secret: 'wrong' } })
    const error = await adapter
      .poll({ reference: 'BKG000001', type: 'booking_number', scac: 'MAEU' })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DcsaError)
    expect(error).toMatchObject({ retryable: false })
  })

  /**
   * The rate limit belongs to the gateway, not to the brand. A poll worker
   * backing off on `MAEU` while carrying on with `SEAU` is not backing off.
   */
  it('names the gateway on a refusal, and maps sibling brands to it', async () => {
    vi.stubGlobal(
      'fetch',
      record(() => respond({ error: 'slow down' }, 429)),
    )

    const adapter = dcsaTracking({ maersk: { key: 'k' } })
    const error = await adapter
      .poll({ reference: 'BKG000001', type: 'booking_number', scac: 'MAEU' })
      .catch((e: unknown) => e)

    expect(error).toMatchObject({ carrier: 'maersk', status: 429, retryable: true })
    expect(adapter.carrierFor('SEAU')).toBe('maersk')
    expect(adapter.carrierFor('maeu')).toBe('maersk')
    expect(adapter.carrierFor('HLCU')).toBeUndefined()
  })

  it('claims nothing when no carrier is configured', () => {
    const adapter = dcsaTracking({})

    expect(adapter.scacs).toEqual([])
    expect(adapter.key).toBe('dcsa (none)')
  })
})
