import { describe, expect, it } from 'vitest'
import {
  aisstreamSource,
  aisstreamSubscription,
  backoffDelay,
  chunkMmsis,
  parseAisEta,
  parseAisTime,
  parseAisstreamMessage,
  type Clock,
  type SocketLike,
} from './aisstream'
import { resolveVesselPositionConfig } from './vessel-positions'
import type { VesselReport } from '../ports/index'
import type { LiveIntegration } from '../settings'

// Two frames as aisstream sent them on 2026-10-05, verbatim apart from line breaks.
const POSITION = {
  MetaData: {
    MMSI: 244909000,
    MMSI_String: 244909000,
    ShipName: 'TIMBER NAVIGATOR',
    latitude: 53.95606,
    longitude: 9.24279,
    time_utc: '2026-10-05 08:33:12.327168992 +0000 UTC',
  },
  MessageType: 'PositionReport',
  Message: {
    PositionReport: {
      MessageID: 1,
      UserID: 244909000,
      Valid: true,
      NavigationalStatus: 0,
      Sog: 6.6,
      Longitude: 9.242785,
      Latitude: 53.95606,
      Cog: 38,
      TrueHeading: 40,
    },
  },
}

const STATIC = {
  MetaData: {
    MMSI: 244090404,
    ShipName: 'PRINS 6  ',
    latitude: 51.81851,
    longitude: 4.70127,
    time_utc: '2026-10-05 08:33:22.455805351 +0000 UTC',
  },
  MessageType: 'ShipStaticData',
  Message: {
    ShipStaticData: {
      CallSign: 'PD8551',
      Destination: 'ROTTERDAM@@@',
      Eta: { Day: 31, Hour: 9, Minute: 53, Month: 12 },
      ImoNumber: 9074729,
      Name: 'PRINS 6  ',
      Type: 33,
      UserID: 244090404,
    },
  },
}

const received = new Date('2026-10-05T08:33:13Z')

describe('parseAisstreamMessage', () => {
  it('reads a position report into our terms', () => {
    expect(parseAisstreamMessage(POSITION, received)).toEqual({
      kind: 'position',
      mmsi: '244909000',
      source: 'aisstream',
      latitude: 53.95606,
      longitude: 9.242785,
      speedKnots: 6.6,
      courseDegrees: 38,
      headingDegrees: 40,
      navStatus: 0,
      positionAt: new Date('2026-10-05T08:33:12.327Z'),
      receivedAt: received,
      name: 'TIMBER NAVIGATOR',
    })
  })

  it('reads static data: IMO, cleaned name and destination, and an ETA with a year', () => {
    const report = parseAisstreamMessage(STATIC, received)
    expect(report).toMatchObject({
      kind: 'static',
      mmsi: '244090404',
      imo: '9074729',
      name: 'PRINS 6',
      callSign: 'PD8551',
      shipType: 33,
      reportedDestination: 'ROTTERDAM',
      reportedEta: new Date('2026-12-31T09:53:00Z'),
    })
  })

  it('drops the AIS sentinels rather than storing them as values', () => {
    const sentinel = structuredClone(POSITION)
    Object.assign(sentinel.Message.PositionReport, { Sog: 102.3, Cog: 360, TrueHeading: 511 })
    expect(parseAisstreamMessage(sentinel, received)).toMatchObject({
      speedKnots: null,
      courseDegrees: null,
      headingDegrees: null,
    })
    const noImo = structuredClone(STATIC)
    noImo.Message.ShipStaticData.ImoNumber = 0
    expect(parseAisstreamMessage(noImo, received)).toMatchObject({ imo: null })
  })

  it('returns null for confirmations, other types, bad positions and bad MMSIs', () => {
    expect(
      parseAisstreamMessage({ MessageType: 'SubscriptionConfirmation' } as never, received),
    ).toBeNull()
    expect(
      parseAisstreamMessage({ ...POSITION, MessageType: 'SafetyBroadcast' }, received),
    ).toBeNull()
    const island = structuredClone(POSITION)
    Object.assign(island.Message.PositionReport, { Latitude: 91, Longitude: 181 })
    Object.assign(island.MetaData, { latitude: 91, longitude: 181 })
    expect(parseAisstreamMessage(island, received)).toBeNull()
    expect(
      parseAisstreamMessage(
        { ...POSITION, MetaData: { ...POSITION.MetaData, MMSI: 2442000 } },
        received,
      ),
    ).toBeNull()
  })

  it('reads Go time stamps and refuses what it cannot read', () => {
    expect(parseAisTime('2026-10-05 08:33:12.327168992 +0000 UTC')?.toISOString()).toBe(
      '2026-10-05T08:33:12.327Z',
    )
    expect(parseAisTime('2026-10-05 11:33:12 +0300 +03')?.toISOString()).toBe(
      '2026-10-05T08:33:12.000Z',
    )
    expect(parseAisTime('yesterday')).toBeNull()
  })

  it('places an ETA in the right year, and treats zeros as not available', () => {
    const october = new Date('2026-10-05T00:00:00Z')
    expect(parseAisEta({ Month: 1, Day: 4, Hour: 6, Minute: 0 }, october)?.toISOString()).toBe(
      '2027-01-04T06:00:00.000Z',
    )
    // Yesterday's ETA on a ship that has not updated its transponder.
    expect(parseAisEta({ Month: 10, Day: 4, Hour: 6, Minute: 0 }, october)?.toISOString()).toBe(
      '2026-10-04T06:00:00.000Z',
    )
    expect(parseAisEta({ Month: 0, Day: 0, Hour: 24, Minute: 60 }, october)).toBeNull()
    expect(parseAisEta({ Month: 2, Day: 31, Hour: 1, Minute: 1 }, october)).toBeNull()
  })
})

describe('the subscription', () => {
  it('asks for the whole world, filtered to the MMSIs, positions and static data only', () => {
    expect(aisstreamSubscription('k', ['244909000'])).toEqual({
      APIKey: 'k',
      BoundingBoxes: [
        [
          [-90, -180],
          [90, 180],
        ],
      ],
      FiltersShipMMSI: ['244909000'],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    })
  })

  it('splits more than fifty vessels over several subscriptions', () => {
    const many = Array.from({ length: 120 }, (_, i) => String(244000000 + i))
    expect(chunkMmsis(many).map((c) => c.length)).toEqual([50, 50, 20])
  })

  it('backs off exponentially with jitter, capped', () => {
    const mid = () => 0.5
    expect(backoffDelay(0, 1000, 300_000, mid)).toBe(750)
    expect(backoffDelay(3, 1000, 300_000, mid)).toBe(6000)
    expect(backoffDelay(30, 1000, 300_000, mid)).toBe(225_000)
    expect(backoffDelay(0, 1000, 300_000, () => 0)).toBe(500)
  })
})

// --- the connection, against a fake socket and a fake clock -------------------

class FakeSocket implements SocketLike {
  binaryType?: string
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onerror: SocketLike['onerror'] = null
  onclose: SocketLike['onclose'] = null
  sent: string[] = []
  closed = false
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  open() {
    this.onopen?.({})
  }
  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
  drop(code = 1006) {
    this.onclose?.({ code, reason: 'network' })
  }
}

function fakeClock() {
  let now = Date.parse('2026-10-05T08:00:00Z')
  let next = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (id) => {
      timers.delete(id as number)
    },
  }
  const advance = (ms: number) => {
    const until = now + ms
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].fn()
    }
    now = until
  }
  return { clock, advance, pending: () => timers.size }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function harness() {
  const sockets: FakeSocket[] = []
  const reports: VesselReport[] = []
  const statuses: (string | null)[] = []
  const time = fakeClock()
  const source = aisstreamSource({
    apiKey: 'test-key',
    sink: (batch) => reports.push(...batch),
    onStatus: (status) => statuses.push(status),
    socket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    clock: time.clock,
    random: () => 0.5,
  })
  return { sockets, reports, statuses, time, source }
}

describe('aisstreamSource', () => {
  it('opens nothing until it has vessels to follow', () => {
    const { sockets, source } = harness()
    source.follow([])
    expect(sockets).toHaveLength(0)
  })

  it('subscribes on open, delivers reports, and reports the confirmation', async () => {
    const { sockets, reports, statuses, source } = harness()
    source.follow(['244909000'])
    expect(sockets).toHaveLength(1)
    const socket = sockets[0]!
    socket.open()
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      APIKey: 'test-key',
      FiltersShipMMSI: ['244909000'],
    })
    socket.message({ MessageType: 'SubscriptionConfirmation', Message: {} })
    socket.message(POSITION)
    await tick()
    expect(statuses).toEqual([null])
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ kind: 'position', mmsi: '244909000' })
  })

  it('reads binary frames as well as text', async () => {
    const { sockets, reports, source } = harness()
    source.follow(['244909000'])
    const socket = sockets[0]!
    socket.open()
    socket.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(POSITION)).buffer })
    await tick()
    expect(reports).toHaveLength(1)
  })

  it('does not reconnect when the same set is followed again', () => {
    const { sockets, source } = harness()
    source.follow(['244909000', '244090404'])
    source.follow(['244090404', '244909000'])
    expect(sockets).toHaveLength(1)
    source.follow(['244090404'])
    expect(sockets).toHaveLength(2)
    expect(sockets[0]!.closed).toBe(true)
  })

  it('reconnects with growing backoff after drops, and resets once confirmed', async () => {
    const { sockets, time, source } = harness()
    source.follow(['244909000'])
    sockets[0]!.drop()
    // attempt 0: 750 ms with the jitter fixed at the midpoint.
    time.advance(749)
    expect(sockets).toHaveLength(1)
    time.advance(1)
    expect(sockets).toHaveLength(2)
    sockets[1]!.drop()
    time.advance(1499)
    expect(sockets).toHaveLength(2)
    time.advance(1)
    expect(sockets).toHaveLength(3)

    // Confirmed: the next drop starts from the shortest delay again.
    sockets[2]!.open()
    sockets[2]!.message({ MessageType: 'SubscriptionConfirmation', Message: {} })
    await tick()
    sockets[2]!.drop()
    time.advance(750)
    expect(sockets).toHaveLength(4)
  })

  it('times out a socket that never opens, or opens and is never confirmed', () => {
    const { sockets, time, source } = harness()
    source.follow(['244909000'])
    time.advance(15_000)
    expect(sockets[0]!.closed).toBe(true)
    time.advance(750)
    expect(sockets).toHaveLength(2)
    sockets[1]!.open()
    time.advance(10_000)
    expect(sockets[1]!.closed).toBe(true)
  })

  it('treats twenty silent minutes as a dead connection and reopens it', async () => {
    const { sockets, time, source } = harness()
    source.follow(['244909000'])
    sockets[0]!.open()
    sockets[0]!.message({ MessageType: 'SubscriptionConfirmation', Message: {} })
    await tick()
    time.advance(19 * 60_000)
    expect(sockets[0]!.closed).toBe(false)
    time.advance(60_000)
    expect(sockets[0]!.closed).toBe(true)
    time.advance(750)
    expect(sockets).toHaveLength(2)
  })

  it('reports a refused key and waits long before trying again', async () => {
    const { sockets, statuses, time, source } = harness()
    source.follow(['244909000'])
    sockets[0]!.open()
    sockets[0]!.message({ error: 'Api Key Is Not Valid' })
    await tick()
    expect(statuses).toEqual(['Api Key Is Not Valid'])
    expect(sockets[0]!.closed).toBe(true)
    time.advance(14 * 60_000)
    expect(sockets).toHaveLength(1)
    time.advance(60_000)
    expect(sockets).toHaveLength(2)
  })

  it('leaves no socket or timer behind when closed', async () => {
    const { sockets, time, source } = harness()
    source.follow(['244909000'])
    sockets[0]!.drop()
    await source.close()
    expect(time.pending()).toBe(0)
    time.advance(60 * 60_000)
    expect(sockets).toHaveLength(1)
  })
})

describe('resolveVesselPositionConfig', () => {
  const settings = (driver: string | undefined, key?: string) =>
    ({ driver, secret: () => key }) as unknown as LiveIntegration

  it('is off unless a driver is chosen and its key is present', () => {
    expect(resolveVesselPositionConfig(settings(undefined))).toEqual({ driver: 'off' })
    expect(resolveVesselPositionConfig(settings('off', 'k'))).toEqual({ driver: 'off' })
    expect(() => resolveVesselPositionConfig(settings('aisstream'))).toThrow(/no API key/)
    expect(() => resolveVesselPositionConfig(settings('aistream', 'k'))).toThrow(/unknown/)
    expect(resolveVesselPositionConfig(settings('aisstream', 'k'))).toEqual({
      driver: 'aisstream',
      apiKey: 'k',
    })
  })
})
