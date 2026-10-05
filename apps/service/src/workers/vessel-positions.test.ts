import { afterEach, describe, expect, it } from 'vitest'
import { vesselPositionSupervisor, type VesselPositionDeps } from './vessel-positions'
import type { VesselPositionConfig } from '../adapters/vessel-positions'
import type { VesselPositionSource, VesselReport, VesselReportSink } from '../ports/index'

const report: VesselReport = {
  kind: 'position',
  mmsi: '477000101',
  source: 'fake',
  latitude: 31.2,
  longitude: 121.6,
  speedKnots: 12,
  courseDegrees: 90,
  headingDegrees: 90,
  navStatus: 0,
  positionAt: new Date('2026-10-05T08:00:00Z'),
  receivedAt: new Date('2026-10-05T08:00:01Z'),
}

function setup(initial: VesselPositionConfig) {
  let config = initial
  let open = ['477000101']
  const built: { config: VesselPositionConfig; followed: string[][]; closed: boolean }[] = []
  let sink: VesselReportSink = () => {}
  const written: VesselReport[][] = []
  let failWrites = false

  const deps: VesselPositionDeps = {
    config: () => Promise.resolve(config),
    openMmsis: () => Promise.resolve(open),
    write: (reports) => {
      if (failWrites) return Promise.reject(new Error('database unreachable'))
      written.push([...reports])
      return Promise.resolve(reports.length)
    },
    build: (resolved, s) => {
      sink = s
      const record = { config: resolved, followed: [] as string[][], closed: false }
      built.push(record)
      const source: VesselPositionSource = {
        key: resolved.driver,
        follow: (mmsis) => record.followed.push([...mmsis]),
        close: () => {
          record.closed = true
          return Promise.resolve()
        },
      }
      return source
    },
    log: () => {},
    // Long, so the timers never fire during a test; refresh and flush are called directly.
    refreshMs: 3_600_000,
    flushMs: 3_600_000,
    maxBuffered: 3,
  }
  const supervisor = vesselPositionSupervisor(deps)
  return {
    supervisor,
    built,
    written,
    emit: (reports: VesselReport[]) => sink(reports),
    setConfig: (next: VesselPositionConfig) => {
      config = next
    },
    setOpen: (next: string[]) => {
      open = next
    },
    failWrites: (fail: boolean) => {
      failWrites = fail
    },
  }
}

let stop: (() => Promise<void>) | undefined
afterEach(async () => {
  await stop?.()
  stop = undefined
})

describe('vesselPositionSupervisor', () => {
  it('stays off, building and connecting nothing, unless configured', async () => {
    const t = setup({ driver: 'off' })
    stop = t.supervisor.stop
    await t.supervisor.refresh()
    expect(t.built).toHaveLength(0)
    expect(t.supervisor.driver()).toBe('off')
  })

  it('subscribes to the MMSIs of open sea jobs, and refreshes when they change', async () => {
    const t = setup({ driver: 'aisstream', apiKey: 'k' })
    stop = t.supervisor.stop
    await t.supervisor.refresh()
    expect(t.built).toHaveLength(1)
    expect(t.built[0]!.followed).toEqual([['477000101']])

    t.setOpen(['477000101', '244000202'])
    await t.supervisor.refresh()
    // The same source, told the new set; `follow` itself skips an unchanged set.
    expect(t.built).toHaveLength(1)
    expect(t.built[0]!.followed.at(-1)).toEqual(['477000101', '244000202'])
  })

  it('rebuilds the source when the key changes, and closes it when switched off', async () => {
    const t = setup({ driver: 'aisstream', apiKey: 'k1' })
    stop = t.supervisor.stop
    await t.supervisor.refresh()
    t.setConfig({ driver: 'aisstream', apiKey: 'k2' })
    await t.supervisor.refresh()
    expect(t.built).toHaveLength(2)
    expect(t.built[0]!.closed).toBe(true)

    t.setConfig({ driver: 'off' })
    await t.supervisor.refresh()
    expect(t.built[1]!.closed).toBe(true)
    expect(t.supervisor.driver()).toBe('off')
  })

  it('writes buffered reports in one batch, and keeps them when the database is down', async () => {
    const t = setup({ driver: 'aisstream', apiKey: 'k' })
    stop = t.supervisor.stop
    await t.supervisor.refresh()
    t.emit([report, report])
    await t.supervisor.flush()
    expect(t.written).toEqual([[report, report]])

    t.failWrites(true)
    t.emit([report])
    await t.supervisor.flush()
    t.failWrites(false)
    await t.supervisor.flush()
    expect(t.written.at(-1)).toEqual([report])
  })

  it('holds at most the configured number of reports while it cannot write', async () => {
    const t = setup({ driver: 'aisstream', apiKey: 'k' })
    stop = t.supervisor.stop
    await t.supervisor.refresh()
    const at = (minute: number) => ({
      ...report,
      positionAt: new Date(Date.UTC(2026, 9, 5, 8, minute)),
    })
    t.emit([at(1), at(2), at(3), at(4), at(5)])
    await t.supervisor.flush()
    expect(
      t.written[0]!.map((r) => (r.kind === 'position' ? r.positionAt.getUTCMinutes() : 0)),
    ).toEqual([3, 4, 5])
  })

  it('survives a refresh that throws', async () => {
    const t = setup({ driver: 'aisstream', apiKey: 'k' })
    stop = t.supervisor.stop
    t.setOpen(null as unknown as string[])
    await expect(t.supervisor.refresh()).resolves.toBeUndefined()
  })
})
