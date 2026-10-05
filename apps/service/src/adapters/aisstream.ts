/**
 * aisstream.io — the first `VesselPositionSource`.
 *
 * A websocket that pushes AIS messages as receivers hear them. Free, and
 * terrestrial only: measured on 2026-10-05, a 120-second global sample held
 * 10,790 positions and none in the Arabian Gulf, the Gulf of Oman, the Red Sea
 * or the Arabian Sea. It earns its place on origin legs (China, Singapore,
 * North Europe, the Mediterranean) and goes quiet before a ship reaches Kuwait
 * or Dubai, which the screens say rather than hide.
 *
 * ## The protocol, as it actually behaves
 *
 *   - Connect to `wss://stream.aisstream.io/v0/stream`.
 *   - Within three seconds send `{APIKey, BoundingBoxes, FiltersShipMMSI,
 *     FilterMessageTypes}`, or the server closes the socket.
 *   - It answers `{MessageType: "SubscriptionConfirmation"}`, or `{error}`
 *     for a bad key or a malformed subscription.
 *   - Then `{MessageType, MetaData: {MMSI, ShipName, latitude, longitude,
 *     time_utc}, Message: {PositionReport | ShipStaticData: {...}}}`, as text
 *     or as binary frames depending on the server's compression.
 *
 * One subscription per socket, so a new set of MMSIs means a new connection.
 * The set changes when a job is booked or arrives, a few times a day, so that
 * costs nothing. `FiltersShipMMSI` takes at most 50 entries; a larger set is
 * split over several sockets rather than truncated.
 *
 * ## Staying up without anyone watching
 *
 *   - **Backoff.** A dropped or refused connection retries after 1 s, 2 s,
 *     4 s … up to five minutes, with jitter, and resets once a connection has
 *     delivered something. A bad key is not retried at the fast rate: that is
 *     a configuration error, and hammering the server will not fix it.
 *   - **Timeouts.** A socket that does not open in 15 s, or is not confirmed
 *     10 s after subscribing, is closed and retried.
 *   - **Idle.** The protocol has no ping. A socket that has delivered nothing
 *     for 20 minutes is closed and reopened, which is also what catches a
 *     half-open TCP connection. Twenty, not two, because a quiet socket is
 *     normal here: a subscription to ten ships in the Indian Ocean hears
 *     nothing for days.
 */

import {
  aisCourse,
  aisCoordinatesValid,
  aisHeading,
  aisSpeed,
  aisText,
  normaliseImo,
  normaliseMmsi,
} from '@qabandi/core'
import type { VesselPositionSource, VesselReport, VesselReportSink } from '../ports/index'

export const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
/** The provider's cap on `FiltersShipMMSI`. */
export const AISSTREAM_MAX_MMSIS = 50

/** The subset of the WHATWG `WebSocket` this driver uses — so a test can fake it. */
export interface SocketLike {
  binaryType?: string
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: { code?: number; reason?: string }) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type SocketFactory = (url: string) => SocketLike

/** Timers, injectable so the reconnect tests run without waiting. */
export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    // Never the thing that keeps a process alive at shutdown.
    handle.unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface AisstreamOptions {
  readonly apiKey: string
  readonly sink: VesselReportSink
  readonly log?: (o: unknown, m: string) => void
  /** Called with an error message, or null once a subscription is confirmed. */
  readonly onStatus?: (error: string | null) => void
  readonly socket?: SocketFactory
  readonly clock?: Clock
  readonly url?: string
  readonly openTimeoutMs?: number
  readonly confirmTimeoutMs?: number
  readonly idleTimeoutMs?: number
  readonly backoffBaseMs?: number
  readonly backoffMaxMs?: number
  /** After a refused key, how long before trying again. */
  readonly authRetryMs?: number
  readonly random?: () => number
}

// --- parsing ----------------------------------------------------------------

interface AisMetaData {
  readonly MMSI?: number | string
  readonly ShipName?: string
  readonly latitude?: number
  readonly longitude?: number
  readonly time_utc?: string
}

interface AisEnvelope {
  readonly MessageType?: string
  readonly MetaData?: AisMetaData
  readonly Message?: Record<string, Record<string, unknown> | undefined>
  readonly error?: string
}

/**
 * `"2026-10-05 08:33:12.327168992 +0000 UTC"` — Go's default time format.
 *
 * Not ISO 8601, and `Date.parse` refuses it. Nanoseconds are trimmed to
 * milliseconds, which is finer than any receiver's clock.
 */
export function parseAisTime(raw: string | undefined): Date | null {
  if (!raw) return null
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)? ([+-]\d{2})(\d{2})/.exec(raw)
  if (!match) return null
  const fraction = match[3] ? match[3].slice(0, 4) : ''
  const date = new Date(`${match[1]}T${match[2]}${fraction}${match[4]}:${match[5]}`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The ETA a crew typed: month, day, hour and minute, and no year.
 *
 * Month 0, day 0, hour 24 and minute 60 are the protocol's "not available".
 * The year is the one that puts the date nearest after `receivedAt`, allowing
 * a few weeks back: a ship that arrived yesterday and has not updated its
 * transponder still reports yesterday, and that is not next year.
 */
export function parseAisEta(
  eta: { Month?: number; Day?: number; Hour?: number; Minute?: number } | undefined,
  receivedAt: Date,
): Date | null {
  if (!eta) return null
  const { Month: month = 0, Day: day = 0, Hour: hour = 24, Minute: minute = 60 } = eta
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const h = hour >= 0 && hour < 24 ? hour : 0
  const m = minute >= 0 && minute < 60 ? minute : 0
  const year = receivedAt.getUTCFullYear()
  const candidate = (y: number) => new Date(Date.UTC(y, month - 1, day, h, m))
  let date = candidate(year)
  // 31 February rolls into March in JavaScript; refuse it instead.
  if (date.getUTCMonth() !== month - 1) return null
  if (date.getTime() < receivedAt.getTime() - 30 * 86_400_000) date = candidate(year + 1)
  return date
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * One aisstream message as a `VesselReport`, or null for anything else.
 *
 * Null for the subscription confirmation, for message types we did not ask
 * for, and for a position that fails `aisCoordinatesValid`. Never throws: a
 * malformed frame is dropped, not allowed to stop the stream.
 */
export function parseAisstreamMessage(
  envelope: AisEnvelope,
  receivedAt: Date,
  source = 'aisstream',
): VesselReport | null {
  const meta = envelope.MetaData
  const mmsi = normaliseMmsi(meta?.MMSI ?? null)
  if (!mmsi) return null
  const sent = parseAisTime(meta?.time_utc) ?? receivedAt

  if (envelope.MessageType === 'PositionReport') {
    const body = envelope.Message?.PositionReport
    if (!body) return null
    const latitude = num(body.Latitude) ?? num(meta?.latitude)
    const longitude = num(body.Longitude) ?? num(meta?.longitude)
    if (latitude === null || longitude === null || !aisCoordinatesValid(latitude, longitude)) {
      return null
    }
    return {
      kind: 'position',
      mmsi,
      source,
      latitude,
      longitude,
      speedKnots: aisSpeed(num(body.Sog)),
      courseDegrees: aisCourse(num(body.Cog)),
      headingDegrees: aisHeading(num(body.TrueHeading)),
      navStatus: num(body.NavigationalStatus),
      positionAt: sent,
      receivedAt,
      name: aisText(meta?.ShipName),
    }
  }

  if (envelope.MessageType === 'ShipStaticData') {
    const body = envelope.Message?.ShipStaticData
    if (!body) return null
    const imo = num(body.ImoNumber)
    return {
      kind: 'static',
      mmsi,
      source,
      // Zero is "not available", and fails the check digit anyway.
      imo: imo ? normaliseImo(String(imo)) : null,
      name: aisText(typeof body.Name === 'string' ? body.Name : meta?.ShipName),
      callSign: aisText(typeof body.CallSign === 'string' ? body.CallSign : null),
      shipType: num(body.Type),
      reportedDestination: aisText(typeof body.Destination === 'string' ? body.Destination : null),
      reportedEta: parseAisEta(
        body.Eta as { Month?: number; Day?: number; Hour?: number; Minute?: number } | undefined,
        receivedAt,
      ),
      receivedAt,
    }
  }

  return null
}

/** The subscription frame. Exported so a test can assert exactly what is sent. */
export function aisstreamSubscription(apiKey: string, mmsis: readonly string[]) {
  return {
    APIKey: apiKey,
    // The whole world: the MMSI filter is what narrows it, and a ship is
    // wherever it is.
    BoundingBoxes: [
      [
        [-90, -180],
        [90, 180],
      ],
    ],
    FiltersShipMMSI: [...mmsis],
    FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
  }
}

/** Split a set into the provider's 50-per-subscription chunks. */
export function chunkMmsis(mmsis: readonly string[], size = AISSTREAM_MAX_MMSIS): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < mmsis.length; i += size) chunks.push(mmsis.slice(i, i + size))
  return chunks
}

/** Exponential with full jitter, capped. `attempt` counts from 0. */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 20))
  // Half fixed, half random: never zero, and many services restarting at once
  // do not reconnect in step.
  return Math.round(ceiling / 2 + random() * (ceiling / 2))
}

async function frameText(data: unknown): Promise<string | null> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }
  if (data && typeof (data as Blob).text === 'function') return (data as Blob).text()
  return null
}

// --- the connection -----------------------------------------------------------

/**
 * One socket for one chunk of MMSIs, reconnecting until it is closed.
 *
 * Kept separate from the source so that a set of 120 vessels is three of
 * these, each with its own backoff: one socket refused does not take the
 * other two down with it.
 */
class Connection {
  private socket: SocketLike | null = null
  private attempt = 0
  private timer: unknown = null
  private idle: unknown = null
  private closed = false
  private confirmed = false

  constructor(
    private readonly mmsis: readonly string[],
    private readonly options: Required<
      Omit<AisstreamOptions, 'log' | 'onStatus' | 'socket' | 'random'>
    > & {
      readonly log: (o: unknown, m: string) => void
      readonly onStatus: (error: string | null) => void
      readonly socket: SocketFactory
      readonly random: () => number
    },
  ) {
    this.connect()
  }

  close(): void {
    this.closed = true
    this.clearTimers()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
      try {
        socket.close(1000, 'closing')
      } catch {
        // Already closed.
      }
    }
  }

  private clearTimers(): void {
    const { clock } = this.options
    if (this.timer !== null) clock.clearTimeout(this.timer)
    if (this.idle !== null) clock.clearTimeout(this.idle)
    this.timer = null
    this.idle = null
  }

  private connect(): void {
    if (this.closed) return
    const { clock, log } = this.options
    this.confirmed = false

    let socket: SocketLike
    try {
      socket = this.options.socket(this.options.url)
    } catch (error) {
      log({ err: String(error) }, 'aisstream: could not open a socket')
      this.retry()
      return
    }
    this.socket = socket
    socket.binaryType = 'arraybuffer'

    this.timer = clock.setTimeout(() => this.drop('open timeout'), this.options.openTimeoutMs)

    socket.onopen = () => {
      if (this.timer !== null) clock.clearTimeout(this.timer)
      // Sent at once: the server closes a socket that is silent for 3 s.
      socket.send(JSON.stringify(aisstreamSubscription(this.options.apiKey, this.mmsis)))
      this.timer = clock.setTimeout(
        () => this.drop('no subscription confirmation'),
        this.options.confirmTimeoutMs,
      )
      this.armIdle()
    }

    socket.onmessage = (event) => {
      void this.receive(event.data)
    }

    socket.onerror = () => {
      // `onclose` follows every error and is where the retry happens.
    }

    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.clearTimers()
      if (this.closed) return
      log({ code: event?.code, reason: event?.reason }, 'aisstream: connection closed')
      this.retry()
    }
  }

  private armIdle(): void {
    const { clock } = this.options
    if (this.idle !== null) clock.clearTimeout(this.idle)
    this.idle = clock.setTimeout(() => this.drop('idle'), this.options.idleTimeoutMs)
  }

  private async receive(data: unknown): Promise<void> {
    const text = await frameText(data)
    if (text === null || this.closed) return
    let envelope: AisEnvelope
    try {
      envelope = JSON.parse(text) as AisEnvelope
    } catch {
      return
    }

    if (envelope.error) {
      /*
        The server says no — almost always the key. Reported once to the
        settings row, and retried slowly: an administrator fixes this on a
        screen, and the next attempt after that picks it up.
      */
      this.options.onStatus(envelope.error)
      this.options.log({ err: envelope.error }, 'aisstream refused the subscription')
      this.drop(envelope.error, this.options.authRetryMs)
      return
    }

    this.armIdle()
    if (!this.confirmed) {
      this.confirmed = true
      this.attempt = 0
      if (this.timer !== null) this.options.clock.clearTimeout(this.timer)
      this.timer = null
      this.options.onStatus(null)
    }

    const report = parseAisstreamMessage(envelope, new Date(this.options.clock.now()))
    if (report) {
      try {
        this.options.sink([report])
      } catch (error) {
        this.options.log({ err: String(error) }, 'aisstream: the sink threw')
      }
    }
  }

  /** Close this socket and schedule the next attempt. */
  private drop(reason: string, delayMs?: number): void {
    const socket = this.socket
    this.socket = null
    this.clearTimers()
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
      try {
        socket.close(4000, reason.slice(0, 100))
      } catch {
        // Already closed.
      }
    }
    if (this.closed) return
    this.options.log({ reason }, 'aisstream: reconnecting')
    this.retry(delayMs)
  }

  private retry(delayMs?: number): void {
    if (this.closed) return
    const delay =
      delayMs ??
      backoffDelay(
        this.attempt,
        this.options.backoffBaseMs,
        this.options.backoffMaxMs,
        this.options.random,
      )
    this.attempt++
    this.timer = this.options.clock.setTimeout(() => {
      this.timer = null
      this.connect()
    }, delay)
  }
}

/**
 * The source: one connection per 50 MMSIs, rebuilt when the set changes.
 *
 * `follow` with the same set is a no-op, so the caller can call it on every
 * refresh without reconnecting anything.
 */
export function aisstreamSource(options: AisstreamOptions): VesselPositionSource {
  const resolved = {
    apiKey: options.apiKey,
    sink: options.sink,
    log: options.log ?? (() => {}),
    onStatus: options.onStatus ?? (() => {}),
    socket: options.socket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike),
    clock: options.clock ?? realClock,
    url: options.url ?? AISSTREAM_URL,
    openTimeoutMs: options.openTimeoutMs ?? 15_000,
    confirmTimeoutMs: options.confirmTimeoutMs ?? 10_000,
    idleTimeoutMs: options.idleTimeoutMs ?? 20 * 60_000,
    backoffBaseMs: options.backoffBaseMs ?? 1_000,
    backoffMaxMs: options.backoffMaxMs ?? 5 * 60_000,
    authRetryMs: options.authRetryMs ?? 15 * 60_000,
    random: options.random ?? Math.random,
  }

  let current: string[] = []
  let connections: Connection[] = []

  return {
    key: 'aisstream',

    follow(mmsis) {
      const next = [...new Set(mmsis)].sort()
      if (next.length === current.length && next.every((m, i) => m === current[i])) return
      current = next
      for (const connection of connections) connection.close()
      connections = chunkMmsis(next).map((chunk) => new Connection(chunk, resolved))
      resolved.log({ vessels: next.length, sockets: connections.length }, 'aisstream: following')
    },

    close() {
      for (const connection of connections) connection.close()
      connections = []
      current = []
      return Promise.resolve()
    },
  }
}
