/**
 * Vessel positions — the one long-lived connection in the service.
 *
 * Everything else here is a pg-boss job that runs and finishes. A websocket
 * does not fit that shape, so this is a small supervisor started beside the
 * workers and stopped at shutdown. Every few minutes it asks three questions
 * and makes the source agree with the answers:
 *
 *   1. Is the integration on? (`vesselPositions`, row first, environment
 *      beneath, resolved per run like every other integration.) If not, close
 *      the source; nothing is connected while it is off.
 *   2. Has the driver or its key changed? Then rebuild the source.
 *   3. Which MMSIs are on open sea jobs? Hand that set to `follow`, which does
 *      nothing when it has not changed.
 *
 * Reports are buffered in memory and written in one batch every few seconds,
 * under the system actor. Nothing here is on a request path: a provider that
 * is down, a refused key or an unreachable database shows up as positions
 * going stale, which every screen already says honestly, and never as a slow
 * page.
 *
 * Two service replicas would each hold their own connection and both write.
 * That is harmless — the write is an upsert that keeps the newest fix — and
 * simpler than electing one.
 */

import {
  openSeaVesselMmsis,
  placesWithCoordinates,
  recordVesselReports,
  systemActor,
  withActor,
  type NamedPlace,
} from '@qabandi/db'
import type { VesselPositionSource, VesselReport, VesselReportSink } from '../ports/index'
import type { VesselPositionConfig } from '../adapters/vessel-positions'
import { aisstreamSource } from '../adapters/aisstream'

type Log = (o: unknown, m: string) => void

export interface VesselPositionDeps {
  /** The resolved driver; never throws (the caller wraps it in `safely`). */
  readonly config: () => Promise<VesselPositionConfig>
  readonly openMmsis: () => Promise<string[]>
  readonly write: (reports: readonly VesselReport[]) => Promise<number>
  readonly build: (config: VesselPositionConfig, sink: VesselReportSink) => VesselPositionSource
  readonly log: Log
  readonly refreshMs?: number
  readonly flushMs?: number
  /** Most reports held while the database is unreachable. */
  readonly maxBuffered?: number
}

export interface VesselPositionSupervisor {
  /** Run one refresh now. Exposed for tests and for the boot log. */
  refresh(): Promise<void>
  /** Write whatever is buffered. */
  flush(): Promise<void>
  /** The driver currently connected, or `off`. */
  readonly driver: () => string
  stop(): Promise<void>
}

/** Comparable without holding the key in a log line. */
function fingerprint(config: VesselPositionConfig): string {
  return config.driver === 'off' ? 'off' : `${config.driver}:${config.apiKey}`
}

export function vesselPositionSupervisor(deps: VesselPositionDeps): VesselPositionSupervisor {
  const maxBuffered = deps.maxBuffered ?? 5_000
  let source: VesselPositionSource | null = null
  let current = 'off'
  let buffer: VesselReport[] = []
  let refreshing: Promise<void> | null = null
  let flushing: Promise<void> | null = null
  let stopped = false

  const sink: VesselReportSink = (reports) => {
    buffer.push(...reports)
    // Bounded: a database that is down for an hour must not become a memory
    // leak. The oldest go first; the newest fix is the one that matters.
    if (buffer.length > maxBuffered) buffer = buffer.slice(buffer.length - maxBuffered)
  }

  async function doRefresh(): Promise<void> {
    if (stopped) return
    const config = await deps.config()
    const next = fingerprint(config)

    if (config.driver === 'off') {
      if (source) {
        await source.close()
        source = null
        deps.log({}, 'vessel positions switched off; connection closed')
      }
      current = 'off'
      return
    }

    if (!source || next !== current) {
      await source?.close()
      source = deps.build(config, sink)
      current = next
      deps.log({ driver: source.key }, 'vessel positions source started')
    }

    const mmsis = await deps.openMmsis()
    source.follow(mmsis)
  }

  async function doFlush(): Promise<void> {
    if (buffer.length === 0) return
    const batch = buffer
    buffer = []
    try {
      const written = await deps.write(batch)
      if (written > 0)
        deps.log({ vessels: written, reports: batch.length }, 'vessel positions written')
    } catch (error) {
      deps.log({ err: String(error) }, 'vessel positions could not be written; kept for retry')
      buffer = [...batch, ...buffer].slice(-maxBuffered)
    }
  }

  const refresh = () => {
    refreshing ??= doRefresh()
      .catch((error: unknown) =>
        deps.log({ err: String(error) }, 'vessel positions refresh failed'),
      )
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }
  const flush = () => {
    flushing ??= doFlush().finally(() => {
      flushing = null
    })
    return flushing
  }

  const refreshTimer = setInterval(() => void refresh(), deps.refreshMs ?? 3 * 60_000)
  const flushTimer = setInterval(() => void flush(), deps.flushMs ?? 5_000)
  refreshTimer.unref?.()
  flushTimer.unref?.()

  return {
    refresh,
    flush,
    driver: () => source?.key ?? 'off',
    async stop() {
      stopped = true
      clearInterval(refreshTimer)
      clearInterval(flushTimer)
      await refreshing
      await source?.close()
      source = null
      await flush()
    },
  }
}

/**
 * The supervisor as the service runs it: real settings, real database, real
 * socket. `config` comes from `adapters/index.ts` so the misconfigured-row
 * handling is the same `safely` every other integration uses.
 */
export function startVesselPositions(
  config: () => Promise<VesselPositionConfig>,
  onStatus: (error: string | null) => void,
  log: Log,
): VesselPositionSupervisor {
  // Ports with coordinates, for "last seen near …". They change rarely.
  let places: { at: number; rows: NamedPlace[] } | null = null
  const placesFresh = async (): Promise<NamedPlace[]> => {
    if (places && Date.now() - places.at < 30 * 60_000) return places.rows
    const rows = await withActor(systemActor(), (tx) => placesWithCoordinates(tx))
    places = { at: Date.now(), rows }
    return rows
  }

  const supervisor = vesselPositionSupervisor({
    config,
    log,
    openMmsis: () => withActor(systemActor(), (tx) => openSeaVesselMmsis(tx)),
    write: async (reports) => {
      const rows = await placesFresh()
      return withActor(systemActor(), (tx) => recordVesselReports(tx, reports, rows))
    },
    build: (resolved, sink) => {
      if (resolved.driver !== 'aisstream') throw new Error(`no driver for ${resolved.driver}`)
      return aisstreamSource({ apiKey: resolved.apiKey, sink, log, onStatus })
    },
  })

  // First refresh straight away, off the boot path.
  void supervisor.refresh()
  return supervisor
}
