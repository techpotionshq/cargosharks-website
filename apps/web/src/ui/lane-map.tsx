/**
 * The lane map.
 *
 * The one graphic on the board that a person who knows nothing about freight
 * understands immediately: here is where our cargo comes from, here is where
 * it goes, and the thick lines are the routes we actually run.
 *
 * Three decisions worth stating, because each had an easier and worse
 * alternative:
 *
 *   1. **It is a server component with no client JavaScript.** The coastline
 *      is a baked SVG path (`world-path.ts`), the projection is two lines of
 *      arithmetic, and hover states are CSS. The easier alternative — a map
 *      library and a tile server — costs ~200KB in the browser and tells a
 *      third party which ports this operator is looking at.
 *   2. **Arcs, not straight lines.** A quadratic bezier bowed away from the
 *      equator reads as a route rather than as a chord through a landmass, and
 *      it separates two lanes that share an endpoint. It is *not* a great
 *      circle and does not pretend to be — the map's subject is which lanes
 *      exist and how busy they are, not navigation.
 *   3. **Line weight carries volume; colour carries mode.** Two encodings for
 *      two facts. Encoding volume with colour as well would spend the palette
 *      on something a width already says.
 *
 * The map is decoration only in the sense that a chart is: every mark on it is
 * a row in `jobs`, and every port is clickable through to its own register.
 */

import type { Route } from 'next'
import Link from 'next/link'
import { WORLD_HEIGHT, WORLD_LAND_PATH, WORLD_WIDTH, projectLonLat } from './world-path'

export interface MapLane {
  readonly id: string
  readonly originName: string
  readonly originLon: number
  readonly originLat: number
  readonly destinationName: string
  readonly destinationLon: number
  readonly destinationLat: number
  readonly count: number
  readonly mode: string
  /** Where clicking the lane goes — usually the shipment register, filtered. */
  readonly href?: string
}

export interface MapPort {
  readonly id: string
  readonly name: string
  readonly longitude: number
  readonly latitude: number
  readonly count: number
  readonly href?: string
}

/**
 * Mode → series slot, in the fixed assignment order the palette defines.
 *
 * Never a colour literal: these resolve to the four validated categorical
 * slots, so a re-skin moves the map with everything else, and the slots
 * deliberately exclude red — which on this board means *alarm*, not "sea
 * freight".
 */
const MODE_COLOR: Record<string, string> = {
  sea_fcl: 'var(--qb-chart-1)',
  sea_lcl: 'var(--qb-chart-2)',
  air: 'var(--qb-chart-3)',
  land: 'var(--qb-chart-4)',
  courier: 'var(--qb-chart-2)',
}

/**
 * The window the map crops to — computed from the traffic, not fixed.
 *
 * A fixed world view spends most of its pixels on ocean nobody sails and
 * leaves the Gulf as a smudge three pixels wide. Cropping to the bounding box
 * of the ports actually in use, with generous padding for context, is the
 * difference between a decorative world map and a legible one.
 *
 * Two guards keep it sane. A **minimum span** stops a single lane from zooming
 * to street level, and the box is widened to the panel's aspect ratio so the
 * SVG is never letterboxed — a viewBox narrower than its container stretches
 * the coastline, which is the one thing that makes a map look wrong.
 */
const MIN_SPAN_X = 90

/*
  A wide, short window.

  Trade lanes run east–west and the ports sit in a narrow latitude band, so a
  squarer frame spends its extra height on Siberia and the Sahara. 3.1 keeps
  the drawing to the strip the shipping actually occupies.
*/
const ASPECT = 3.1

function viewBoxFor(ports: readonly MapPort[]): string {
  if (ports.length === 0) {
    // No traffic: show the trade world, roughly 60°N–35°S.
    return `140 ${((90 - 60) / 180) * WORLD_HEIGHT} 720 ${(95 / 180) * WORLD_HEIGHT}`
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const port of ports) {
    const [x, y] = projectLonLat(port.longitude, port.latitude)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  // Arcs bow away from the equator and labels run to the right, so the padding
  // is not symmetric: the box needs headroom where the drawing actually goes.
  const padX = Math.max((maxX - minX) * 0.14, 24)
  const padY = Math.max((maxY - minY) * 0.3, 16)
  minX -= padX
  maxX += padX * 1.4
  minY -= padY
  maxY += padY

  let width = Math.max(maxX - minX, MIN_SPAN_X)
  let height = width / ASPECT

  // Grow whichever axis is short, around the centre, so nothing is cropped.
  if (maxY - minY > height) {
    height = maxY - minY
    width = Math.max(width, height * ASPECT)
  }

  const centreX = (minX + maxX) / 2
  const centreY = (minY + maxY) / 2
  let x = centreX - width / 2
  let y = centreY - height / 2

  // Never pan past the edges of the projected world.
  x = Math.max(0, Math.min(x, WORLD_WIDTH - width))
  y = Math.max(0, Math.min(y, WORLD_HEIGHT - height))

  return `${x.toFixed(1)} ${y.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`
}

/**
 * A lane as a bowed arc.
 *
 * The control point sits perpendicular to the midpoint, offset by a fraction
 * of the lane's length so short lanes bow gently and long ones bow more. The
 * sign is chosen so the arc bends *away* from the equator, which keeps
 * Asia–Gulf traffic clear of the Indian Ocean's islands and, more usefully,
 * stops an outbound and a return lane from being drawn on top of each other.
 */
function arc(from: [number, number], to: [number, number]): string {
  const [x1, y1] = from
  const [x2, y2] = to
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)

  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2

  // Perpendicular unit vector, pointing to whichever side is further from the
  // equator so the bow never cuts back across it.
  const equator = WORLD_HEIGHT / 2
  const side = midY < equator ? -1 : 1
  const bow = Math.min(length * 0.22, 70) * side

  const controlX = midX + (-dy / (length || 1)) * 0
  const controlY = midY + bow

  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${controlX.toFixed(1)} ${controlY.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

export function LaneMap({
  lanes,
  ports,
  className,
  /** Labels the busiest few ports. More than this and they collide. */
  labelTop = 5,
}: {
  readonly lanes: readonly MapLane[]
  readonly ports: readonly MapPort[]
  readonly className?: string
  readonly labelTop?: number
}) {
  const busiestLane = Math.max(1, ...lanes.map((lane) => lane.count))
  const busiestPort = Math.max(1, ...ports.map((port) => port.count))

  const viewBox = viewBoxFor(ports)
  const [, , boxWidth] = viewBox.split(' ').map(Number)

  /*
    Strokes, radii and type are in viewBox units, so a zoomed-in map would
    otherwise draw them at several times their intended size. Everything
    visual is scaled against the width the box actually ended up with.
  */
  const k = (boxWidth ?? WORLD_WIDTH) / WORLD_WIDTH

  /*
    Which ports get a name, and where the name goes.

    Two problems, solved together. Labels are chosen by *traffic* rather than
    by index, so the map names the places that matter. And they are placed
    greedily with collision rejection: busiest port first, each label tried to
    the right of its marker and then to the left, and skipped entirely if
    neither side is free. Kuwait, Shuwaikh and Jebel Ali are within a few
    hundred kilometres of each other — without this they render as one
    illegible smear, which is worse than labelling two of the three.

    Sizes are in viewBox units and scaled by `k` so the boxes stay in step
    with the type they are standing in for.
  */
  const CHAR_WIDTH = 4.4 * k
  const LABEL_HEIGHT = 9 * k

  const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
  const labels = new Map<string, { x: number; y: number; anchor: 'start' | 'end' }>()

  for (const port of [...ports].sort((a, b) => b.count - a.count)) {
    if (labels.size >= labelTop) break

    const [x, y] = projectLonLat(port.longitude, port.latitude)
    const radius = (2.2 + (port.count / busiestPort) * 3.4) * k
    const width = port.name.length * CHAR_WIDTH
    const gap = radius + 3 * k

    const candidates = [
      { x: x + gap, y: y + 3 * k, anchor: 'start' as const },
      { x: x - gap, y: y + 3 * k, anchor: 'end' as const },
    ]

    for (const candidate of candidates) {
      const x1 = candidate.anchor === 'start' ? candidate.x : candidate.x - width
      const box = {
        x1,
        y1: candidate.y - LABEL_HEIGHT,
        x2: x1 + width,
        y2: candidate.y + 2 * k,
      }
      const clashes = placed.some(
        (other) => box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1,
      )
      if (!clashes) {
        placed.push(box)
        labels.set(port.id, candidate)
        break
      }
    }
  }

  return (
    <div
      className={['relative w-full overflow-hidden rounded-sm', className]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        viewBox={viewBox}
        className="block w-full"
        role="img"
        aria-label={`Shipping lanes: ${lanes.length} routes across ${ports.length} ports`}
      >
        <defs>
          {/* A very soft vertical wash so the ocean is not flat white. */}
          <linearGradient id="qb-ocean" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--qb-chart-2)" stopOpacity="0.16" />
            <stop offset="55%" stopColor="var(--qb-chart-1)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--qb-chart-4)" stopOpacity="0.09" />
          </linearGradient>
          <linearGradient id="qb-land" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--qb-surface)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--qb-surface-sunken)" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* The ocean fills the whole projected world, so panning never
            reveals an unpainted corner. */}
        <rect x="0" y="0" width={WORLD_WIDTH} height={WORLD_HEIGHT} fill="url(#qb-ocean)" />

        {/*
          Land is drawn as a filled shape with a hairline stroke rather than an
          outline: at this scale an outline-only map reads as a diagram of
          borders, and a filled one reads as somewhere cargo cannot sail.
        */}
        {/*
          Land sits *above* the ocean in lightness, not below it. A land fill
          darker than the water reads as sea, which is the wrong way round and
          was why the first version looked like an empty gradient.
        */}
        <path
          d={WORLD_LAND_PATH}
          fill="url(#qb-land)"
          stroke="var(--qb-line-strong)"
          strokeWidth={0.6 * k}
          strokeLinejoin="round"
          fillRule="evenodd"
        />

        {/* Lanes under ports, so a port marker is never hidden by a line. */}
        <g fill="none" strokeLinecap="round">
          {lanes.map((lane) => {
            const from = projectLonLat(lane.originLon, lane.originLat)
            const to = projectLonLat(lane.destinationLon, lane.destinationLat)
            const weight = (1.1 + (lane.count / busiestLane) * 2.8) * k
            const color = MODE_COLOR[lane.mode] ?? 'var(--qb-chart-1)'
            const path = arc(from, to)
            const label = `${lane.originName} → ${lane.destinationName} · ${lane.count}`

            const line = (
              <>
                {/*
                  A wide transparent copy underneath is the hit target. A 2px
                  line is not something anyone can hover deliberately.
                */}
                <path d={path} stroke="transparent" strokeWidth={12 * k} />
                <path
                  d={path}
                  stroke={color}
                  strokeWidth={weight}
                  strokeOpacity="0.75"
                  className="transition-opacity hover:opacity-100"
                />
                <title>{label}</title>
              </>
            )

            return lane.href ? (
              <Link key={lane.id} href={lane.href as Route} className="group">
                {line}
              </Link>
            ) : (
              <g key={lane.id} className="group">
                {line}
              </g>
            )
          })}
        </g>

        <g>
          {ports.map((port) => {
            const [x, y] = projectLonLat(port.longitude, port.latitude)
            const radius = (2.2 + (port.count / busiestPort) * 3.4) * k
            const label = labels.get(port.id)
            const marker = (
              <>
                {/* A soft halo so a marker stays visible over a dark lane. */}
                <circle cx={x} cy={y} r={radius + 2.5 * k} fill="var(--qb-surface)" opacity="0.7" />
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill="var(--qb-brand)"
                  stroke="var(--qb-surface)"
                  strokeWidth={1.2 * k}
                />
                <title>{`${port.name} · ${port.count}`}</title>
              </>
            )

            return (
              <g key={port.id}>
                {port.href ? <Link href={port.href as Route}>{marker}</Link> : marker}
                {label ? (
                  <text
                    x={label.x}
                    y={label.y}
                    textAnchor={label.anchor}
                    className="fill-ink"
                    style={{
                      fontSize: 9 * k,
                      fontWeight: 600,
                      // The halo is painted *under* the glyphs, so a label
                      // crossing a lane stays readable without a box behind it.
                      paintOrder: 'stroke',
                    }}
                    stroke="var(--qb-surface)"
                    strokeWidth={2.6 * k}
                    strokeLinejoin="round"
                  >
                    {port.name}
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

/** The legend, as its own export so a caller can place it outside the frame. */
export function LaneMapLegend({
  modes,
  className,
}: {
  readonly modes: readonly { mode: string; label: string; count: number }[]
  readonly className?: string
}) {
  return (
    <ul
      className={['flex flex-wrap items-center gap-x-4 gap-y-1.5', className]
        .filter(Boolean)
        .join(' ')}
    >
      {modes.map((entry) => (
        <li key={entry.mode} className="flex items-center gap-1.5 text-[0.75rem] text-ink-muted">
          <span
            aria-hidden
            className="h-[3px] w-4 rounded-full"
            style={{ backgroundColor: MODE_COLOR[entry.mode] ?? 'var(--qb-chart-1)' }}
          />
          {entry.label}
          <span className="numeric font-semibold text-ink">{entry.count}</span>
        </li>
      ))}
    </ul>
  )
}
