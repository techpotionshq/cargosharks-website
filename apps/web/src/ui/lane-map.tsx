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
 *   2. **Arcs, not straight lines.** A quadratic bezier bowed perpendicular to
 *      its own direction of travel reads as a route rather than as a chord
 *      through a landmass, and it separates an outbound lane from its return.
 *      It is *not* a great circle and does not pretend to be — the map's
 *      subject is which lanes exist and how busy they are, not navigation.
 *   3. **Line weight carries volume; colour carries mode.** Two encodings for
 *      two facts. Encoding volume with colour as well would spend the palette
 *      on something a width already says.
 *
 * The map is decoration only in the sense that a chart is: every mark on it is
 * a row in `jobs`, and every port is clickable through to its own register.
 */

import type { Route } from 'next'
import Link from 'next/link'
import { WORLD_HEIGHT, WORLD_WIDTH, landPathFor, projectLonLat } from './world-path'

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
  squarer frame spends its extra height on Siberia and the Sahara. 3.0 keeps
  the drawing to the strip the shipping actually occupies without flattening
  the coastline into a ribbon.
*/
const ASPECT = 3.0

function viewBoxFor(ports: readonly MapPort[]): [number, number, number, number] {
  if (ports.length === 0) {
    // No traffic: show the trade world, roughly 60°N–35°S.
    return [140, ((90 - 60) / 180) * WORLD_HEIGHT, 720, (95 / 180) * WORLD_HEIGHT]
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

  /*
    Padding is symmetric now.

    It used to add 40% more on the trailing edge, on the reasoning that arcs
    bowed one way and labels ran to the right. Neither is true any more —
    arcs bow perpendicular to their own direction and labels are placed on
    whichever side is free — so the asymmetry was simply a band of empty ocean
    down one side of every map.
  */
  const padX = Math.max((maxX - minX) * 0.1, 18)
  const padY = Math.max((maxY - minY) * 0.18, 12)
  minX -= padX
  maxX += padX
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

  return [x, y, width, height]
}

/**
 * A lane as a bowed arc.
 *
 * The control point is offset from the midpoint **perpendicular to the lane**,
 * by a fraction of its length, so a short lane bows gently and a long one bows
 * more in proportion.
 *
 * Two things were wrong with the version this replaces, and both were visible
 * from across the room:
 *
 *   - It claimed to offset perpendicular and then multiplied the perpendicular
 *     component by zero, so every control point was displaced *straight up*
 *     regardless of the lane's direction. Lanes at different angles bowed
 *     inconsistently and crossed each other.
 *   - The offset was up to 70 units — a quarter of the map's height, twenty-five
 *     degrees of latitude. A Shanghai–Rotterdam lane swung up over Siberia.
 *
 * The sign comes from the direction of travel rather than from which hemisphere
 * the lane sits in. That is what separates an outbound lane from its return:
 * they bow to opposite sides instead of being drawn on top of each other.
 */
function arc(from: [number, number], to: [number, number]): string {
  const [x1, y1] = from
  const [x2, y2] = to
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1

  // A quadratic bezier deviates from its chord by half the control offset, so
  // the visible bow is about 9% of the lane's length — a sea route's worth of
  // curve, not a rainbow.
  const bow = Math.min(length * 0.18, 40)

  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const controlX = midX + (-dy / length) * bow
  const controlY = midY + (dx / length) * bow

  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${controlX.toFixed(1)} ${controlY.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

export function LaneMap({
  lanes,
  ports,
  className,
  /** How many ports may carry a name. Placement drops any that cannot fit. */
  labelTop = 9,
}: {
  readonly lanes: readonly MapLane[]
  readonly ports: readonly MapPort[]
  readonly className?: string
  readonly labelTop?: number
}) {
  const busiestLane = Math.max(1, ...lanes.map((lane) => lane.count))
  const busiestPort = Math.max(1, ...ports.map((port) => port.count))

  const [boxX, boxY, boxWidth, boxHeight] = viewBoxFor(ports)
  const viewBox = `${boxX.toFixed(1)} ${boxY.toFixed(1)} ${boxWidth.toFixed(1)} ${boxHeight.toFixed(1)}`

  // Only the coastline that can appear in this window is serialised into the
  // page — see `landPathFor`. The whole world at this resolution is 128KB.
  const landPath = landPathFor(boxX, boxY, boxWidth, boxHeight)

  /*
    Strokes, radii and type are in viewBox units, so a zoomed-in map would
    otherwise draw them at several times their intended size. Everything
    visual is scaled against the width the box actually ended up with.
  */
  const k = (boxWidth ?? WORLD_WIDTH) / WORLD_WIDTH

  /** The radius a port's marker is drawn at — traffic-weighted. */
  const radiusOf = (count: number) => (1.9 + (count / busiestPort) * 3.2) * k

  /*
    Which ports get a name, and where the name goes.

    Labels are chosen by *traffic* rather than by index, so the map names the
    places that matter, and placed greedily with collision rejection: busiest
    first, each tried in six positions around its marker, skipped entirely if
    none is free. Kuwait, Shuwaikh and Jebel Ali sit within a few hundred
    kilometres of each other, so some will always be skipped — two readable
    names beat three overlapping ones.

    The obstacle set includes **every port marker**, not just the labels placed
    so far. That was the bug behind "Dubai International Airport" being drawn
    straight through the Jebel Ali dot: a label only avoided other labels, so
    it happily ran across a marker two hundred kilometres away.

    Sizes are in viewBox units and scaled by `k` so the boxes stay in step with
    the type they are standing in for.
  */
  const CHAR_WIDTH = 4.3 * k
  const LABEL_HEIGHT = 8 * k

  type Box = { x1: number; y1: number; x2: number; y2: number }

  const overlaps = (a: Box, b: Box) =>
    a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

  // Every marker is an obstacle from the start, whether or not it gets a name.
  const obstacles: Box[] = ports.map((port) => {
    const [x, y] = projectLonLat(port.longitude, port.latitude)
    const r = radiusOf(port.count) + 1.5 * k
    return { x1: x - r, y1: y - r, x2: x + r, y2: y + r }
  })

  const labels = new Map<string, { x: number; y: number; anchor: 'start' | 'end' }>()

  for (const port of [...ports].sort((a, b) => b.count - a.count)) {
    if (labels.size >= labelTop) break

    const [x, y] = projectLonLat(port.longitude, port.latitude)
    const radius = radiusOf(port.count)
    const width = port.name.length * CHAR_WIDTH
    const gap = radius + 3 * k
    const rise = radius + 7 * k

    /*
      Six positions, in preference order: beside the marker first because a
      horizontal label reads fastest, then above, then below. Diagonals are
      not offered — at this type size they read as belonging to no marker in
      particular.
    */
    const candidates = [
      { x: x + gap, y: y + 2.8 * k, anchor: 'start' as const },
      { x: x - gap, y: y + 2.8 * k, anchor: 'end' as const },
      { x: x + gap, y: y - rise, anchor: 'start' as const },
      { x: x - gap, y: y - rise, anchor: 'end' as const },
      { x: x + gap, y: y + rise, anchor: 'start' as const },
      { x: x - gap, y: y + rise, anchor: 'end' as const },
    ]

    for (const candidate of candidates) {
      const x1 = candidate.anchor === 'start' ? candidate.x : candidate.x - width
      const box: Box = {
        x1,
        y1: candidate.y - LABEL_HEIGHT,
        x2: x1 + width,
        y2: candidate.y + 2 * k,
      }

      // A label that runs off the frame is as lost as one that overlaps.
      if (box.x1 < boxX || box.x2 > boxX + boxWidth) continue
      if (box.y1 < boxY || box.y2 > boxY + boxHeight) continue

      if (obstacles.some((other) => overlaps(box, other))) continue

      obstacles.push(box)
      labels.set(port.id, candidate)
      break
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
        {/*
          The ocean is one flat tint, not a gradient.

          It used to be a three-stop wash across chart-2, chart-1 and chart-4 —
          teal to indigo to violet down the page — which put a colour ramp
          behind lines whose *own* colour is the encoding. The sea read as
          data. One barely-there tint stays out of the way, and the whole world
          is painted so panning never reveals an unfilled corner.
        */}
        <rect
          x="0"
          y="0"
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          fill="var(--qb-chart-1)"
          opacity="0.11"
        />

        {/*
          Land is a filled shape with a hairline stroke rather than an outline:
          at this scale an outline-only map reads as a diagram of borders, and a
          filled one reads as somewhere cargo cannot sail.

          It sits *above* the water in lightness. A land fill darker than the
          sea reads as sea, which is the wrong way round.
        */}
        <path
          d={landPath}
          fill="var(--qb-surface)"
          stroke="var(--qb-line-strong)"
          strokeWidth={0.5 * k}
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
            const radius = radiusOf(port.count)
            const label = labels.get(port.id)
            /*
              A port that could not be given a name is drawn quieter.

              Every marker used to be full-strength brand red, so a map with
              nine ports and five labels showed four unexplained red dots — and
              red on this board means *alarm*. Ports are ink now, and the
              unlabelled ones recede rather than demanding to know what they
              are. Their names are still in the tooltip.
            */
            const marker = (
              <>
                {/* A soft halo so a marker stays visible over a lane. */}
                <circle
                  cx={x}
                  cy={y}
                  r={radius + 2.5 * k}
                  fill="var(--qb-surface)"
                  opacity={label ? 0.75 : 0.5}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={label ? radius : radius * 0.72}
                  fill="var(--qb-ink)"
                  fillOpacity={label ? 1 : 0.55}
                  stroke="var(--qb-surface)"
                  strokeWidth={1.1 * k}
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
                      fontSize: 8 * k,
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
