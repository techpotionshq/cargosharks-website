/**
 * Prove the aisstream key and the whole write path, end to end, on demand.
 *
 *     AISSTREAM_API_KEY=… pnpm --filter @qabandi/service verify:vessels
 *     AISSTREAM_API_KEY=… pnpm --filter @qabandi/service verify:vessels --seconds 90
 *
 * Opt-in, and never part of a test run: it needs a live key, the network and
 * a database, and it writes rows.
 *
 *   1. Samples the sea off Rotterdam and Shanghai for a few seconds and picks
 *      up to five vessels that are reporting right now. Picking them live is
 *      the point: a hard-coded MMSI is a ship that sails out of coverage the
 *      week after the script is written.
 *   2. Follows exactly those MMSIs through `aisstreamSource`, the driver the
 *      service runs, for `--seconds`.
 *   3. Writes what it hears through `recordVesselReports` under the system
 *      actor, then reads the rows back and prints them.
 *
 * **It refuses any database that is not on this machine.** The development
 * databases are remote and shared, and a check that writes test vessels into
 * them is a check somebody has to clean up after in a product that never
 * deletes.
 */

import { inArray } from 'drizzle-orm'
import {
  loadEnv,
  placesWithCoordinates,
  recordVesselReports,
  systemActor,
  vesselPositions,
  withActor,
} from '@qabandi/db'
import type { VesselReport } from '../ports/index'
import { AISSTREAM_URL, aisstreamSource, parseAisstreamMessage } from './aisstream'

loadEnv()

const REGIONS = {
  Rotterdam: [
    [51.85, 3.6],
    [52.1, 4.5],
  ],
  Shanghai: [
    [30.6, 121.3],
    [31.6, 122.6],
  ],
} as const

function argument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function localOnly(): void {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const host = new URL(url).hostname
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`refusing to write to ${host}: this check writes only to a local database`)
  }
}

/** A short sample of who is reporting near each port right now. */
async function discover(apiKey: string, seconds: number): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const perRegion = new Map<string, number>()
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(AISSTREAM_URL)
    socket.binaryType = 'arraybuffer'
    const done = setTimeout(() => {
      socket.close()
      resolve()
    }, seconds * 1000)
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: Object.values(REGIONS),
          FilterMessageTypes: ['PositionReport'],
        }),
      )
    socket.onerror = () => {
      clearTimeout(done)
      reject(new Error('could not reach aisstream'))
    }
    socket.onmessage = (event) => {
      const text =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer)
      const envelope = JSON.parse(text) as { error?: string }
      if (envelope.error) {
        clearTimeout(done)
        socket.close()
        reject(new Error(`aisstream refused: ${envelope.error}`))
        return
      }
      const report = parseAisstreamMessage(envelope, new Date())
      if (report?.kind !== 'position' || found.has(report.mmsi)) return
      const region = Object.entries(REGIONS).find(
        ([, [[s, w], [n, e]]]) =>
          report.latitude >= s &&
          report.latitude <= n &&
          report.longitude >= w &&
          report.longitude <= e,
      )?.[0]
      // Moving ships first: a vessel under way reports every few seconds.
      if (!region || (report.speedKnots ?? 0) < 1) return
      if ((perRegion.get(region) ?? 0) >= 3 || found.size >= 5) return
      perRegion.set(region, (perRegion.get(region) ?? 0) + 1)
      found.set(report.mmsi, `${report.name ?? '?'} near ${region}`)
    }
  })
  return found
}

async function main(): Promise<void> {
  const apiKey = process.env.AISSTREAM_API_KEY
  if (!apiKey) throw new Error('set AISSTREAM_API_KEY to run this check')
  localOnly()
  const seconds = argument('--seconds', 60)

  console.log('1. sampling Rotterdam and Shanghai for 20 s to find vessels reporting now…')
  const vessels = await discover(apiKey, 20)
  if (vessels.size === 0) throw new Error('no moving vessels heard; try again in a minute')
  for (const [mmsi, label] of vessels) console.log(`   ${mmsi}  ${label}`)

  console.log(`2. following ${vessels.size} MMSIs through aisstreamSource for ${seconds} s…`)
  const heard: VesselReport[] = []
  const source = aisstreamSource({
    apiKey,
    sink: (reports) => heard.push(...reports),
    onStatus: (error) => console.log(error ? `   refused: ${error}` : '   subscription confirmed'),
    log: () => {},
  })
  source.follow([...vessels.keys()])
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  await source.close()
  const positions = heard.filter((r) => r.kind === 'position').length
  console.log(`   heard ${positions} positions and ${heard.length - positions} static reports`)

  console.log('3. writing through recordVesselReports as the system actor…')
  const written = await withActor(systemActor(), async (tx) => {
    const places = await placesWithCoordinates(tx)
    return recordVesselReports(tx, heard, places)
  })
  console.log(`   ${written} vessel rows written`)

  const rows = await withActor(systemActor(), (tx) =>
    tx
      .select({
        mmsi: vesselPositions.mmsi,
        name: vesselPositions.name,
        imo: vesselPositions.imo,
        lat: vesselPositions.latitude,
        lon: vesselPositions.longitude,
        knots: vesselPositions.speedKnots,
        course: vesselPositions.courseDegrees,
        status: vesselPositions.navStatus,
        destination: vesselPositions.reportedDestination,
        eta: vesselPositions.reportedEta,
        positionAt: vesselPositions.positionAt,
        receivedAt: vesselPositions.receivedAt,
        source: vesselPositions.source,
      })
      .from(vesselPositions)
      .where(inArray(vesselPositions.mmsi, [...vessels.keys()])),
  )
  console.log('4. read back from vessel_positions:')
  console.table(
    rows.map((row) => ({
      ...row,
      lat: row.lat?.toFixed(4),
      lon: row.lon?.toFixed(4),
      eta: row.eta?.toISOString().slice(0, 16),
      positionAt: row.positionAt?.toISOString().slice(11, 19),
      receivedAt: row.receivedAt?.toISOString().slice(11, 19),
    })),
  )
  process.exit(rows.length > 0 ? 0 : 1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
