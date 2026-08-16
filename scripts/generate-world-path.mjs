/**
 * Bakes the world's coastline into a single SVG path — `node scripts/generate-world-path.mjs`.
 *
 * Run once, and its output is committed. That is the whole point: the map on
 * the operations board needs *accurate* land, and the honest ways to get it
 * are a runtime dependency on a 500KB TopoJSON plus a projection library, or
 * this — a build step that emits a string.
 *
 * The string wins on every axis that matters here. No map library ships to the
 * browser, no tiles are fetched from a third party (which would leak which
 * ports an operator is looking at to whoever hosts the tiles), the map renders
 * server-side in the same pass as the rest of the page, and it works offline.
 *
 * Projection is equirectangular — `x = (lon + 180) / 360`, `y = (90 - lat) /
 * 180` — chosen deliberately over anything prettier: it is the only projection
 * where a port's position can be computed at a call site in two lines of
 * arithmetic, so plotting a lane needs nothing but its latitude and longitude.
 * Its area distortion near the poles is irrelevant to a map whose subject is
 * shipping lanes between 30°S and 60°N.
 *
 * ## Why this was rewritten
 *
 * The first version took Natural Earth's **110m** land and decimated it by
 * dropping any vertex within 3 viewBox units of the last one kept. Both halves
 * of that were wrong, and the reasoning error is worth recording because it is
 * easy to repeat.
 *
 * The threshold was justified as "the map is drawn about 700px wide, so one
 * viewBox unit is 0.7 screen pixels". That is true only of the *whole world*.
 * The map crops to the traffic — typically 300 units of a 1000-unit world,
 * drawn across 1200px — so one unit is nearer **four** pixels, and a 3-unit
 * threshold was discarding detail at twelve pixels. The Gulf, which is the one
 * piece of coastline this operator's whole business sits on, came out as an
 * unrecognisable blob.
 *
 * Dropping by distance-from-last-kept is also the wrong algorithm: it treats a
 * vertex on a straight coast and a vertex at a headland as equally disposable,
 * so it flattens exactly the features that make a coastline recognisable.
 * **Douglas–Peucker** keeps whichever point deviates most from the chord, which
 * is the definition of the shape being preserved. At equal output size it is
 * not a small improvement — the peninsulas come back.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { feature } from 'topojson-client'

const WIDTH = 1000
const HEIGHT = 500

/** Coordinates below this many decimal places are noise at 1000px wide. */
const PRECISION = 1

/**
 * Simplification tolerance, in viewBox units — the maximum a simplified edge
 * may deviate from the true coastline.
 *
 * The map crops to roughly a third of the world and is drawn about 1200px
 * wide, so one unit is about four screen pixels. 0.35 keeps the error under
 * one and a half pixels at the *tightest* zoom the dashboard ever uses, which
 * is the level that has to look right.
 */
const TOLERANCE = 0.35

/**
 * Drops rings whose bounding box is smaller than this, in viewBox units.
 *
 * Lower than it looks like it should be, on purpose. 1.5 units is half a
 * degree, which erases Bahrain, Singapore and Hong Kong — three places a
 * freight forwarder's map cannot be missing. 0.55 keeps them and still throws
 * away the several thousand sub-pixel islets that 50m data is full of.
 */
const MIN_RING_SIZE = 0.55

const topology = JSON.parse(readFileSync('node_modules/world-atlas/land-50m.json', 'utf8'))
const land = feature(topology, topology.objects.land)

const project = ([lon, lat]) => [((lon + 180) / 360) * WIDTH, ((90 - lat) / 180) * HEIGHT]

/**
 * Perpendicular distance from `point` to the segment `a`–`b`, squared.
 *
 * Squared because Douglas–Peucker only ever compares distances to each other
 * and to a threshold, and a square root per vertex over ~200k vertices is
 * measurable for no gain.
 */
function segmentDistanceSq(point, a, b) {
  let [x, y] = a
  const dx = b[0] - x
  const dy = b[1] - y

  if (dx !== 0 || dy !== 0) {
    // Where the perpendicular from `point` meets the infinite line, as a
    // fraction along the segment. Clamped, so a point beyond either end
    // measures to that end rather than to open space past it.
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      x = b[0]
      y = b[1]
    } else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }

  return (point[0] - x) ** 2 + (point[1] - y) ** 2
}

/**
 * Douglas–Peucker, iteratively.
 *
 * Iterative rather than recursive because a single Antarctic ring in the 50m
 * set is long enough to blow the call stack on the naive version.
 */
function simplify(points, toleranceSq) {
  if (points.length < 3) return points

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack = [[0, points.length - 1]]

  while (stack.length) {
    const [first, last] = stack.pop()
    let furthest = -1
    let furthestDistance = toleranceSq

    for (let i = first + 1; i < last; i++) {
      const distance = segmentDistanceSq(points[i], points[first], points[last])
      if (distance > furthestDistance) {
        furthest = i
        furthestDistance = distance
      }
    }

    // Nothing in this span deviates enough to be worth a vertex, so the whole
    // span becomes one straight edge.
    if (furthest === -1) continue

    keep[furthest] = 1
    stack.push([first, furthest], [furthest, last])
  }

  return points.filter((_, i) => keep[i])
}

/**
 * One ring, as `[minX, minY, maxX, maxY, path]` — or null if it is not worth
 * drawing.
 *
 * The bounding box travels with the path because the map crops to the traffic,
 * and a Gulf-to-Asia view has no use for the Americas, Antarctica or the
 * Pacific islands. Emitting the box lets the component drop every ring that
 * cannot intersect the view *before* serialising it into the HTML, which is
 * what makes 50m detail affordable: the module is 130KB on the server, and the
 * page carries only the coastline actually on screen.
 */
function ringEntry(ring) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const points = ring.map((coordinate) => {
    const [x, y] = project(coordinate)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    return [x, y]
  })

  // A ring's extent decides whether it survives: at this size an islet is one
  // sub-pixel speck that costs as much path data as a country.
  const width = maxX - minX
  const height = maxY - minY
  if (width < MIN_RING_SIZE && height < MIN_RING_SIZE) return null

  /*
    Reject rings that are long and flat.

    Simplification can collapse a thin sliver — an ice shelf edge, a river
    delta traced at 50m — into what is effectively a horizontal line, and a
    closed path of near-collinear points fills as a full-width stripe across
    the map. One of those was drawn straight across the North Atlantic.
  */
  if (height < 1.2 && width > 8) return null
  if (width < 1.2 && height > 8) return null

  const simplified = simplify(points, TOLERANCE * TOLERANCE)
  if (simplified.length < 3) return null

  let out = ''
  let lastPair = ''
  for (const [x, y] of simplified) {
    const pair = `${x.toFixed(PRECISION)},${y.toFixed(PRECISION)}`
    // Rounding to one decimal can make two kept vertices identical; a repeated
    // point is pure payload.
    if (pair === lastPair) continue
    out += (out === '' ? 'M' : 'L') + pair
    lastPair = pair
  }

  if (!out) return null

  const round = (v) => Number(v.toFixed(PRECISION))
  return [round(minX), round(minY), round(maxX), round(maxY), `${out}Z`]
}

const entries = []
let sourceVertices = 0

for (const geometry of land.features) {
  const polygons =
    geometry.geometry.type === 'Polygon'
      ? [geometry.geometry.coordinates]
      : geometry.geometry.coordinates
  for (const polygon of polygons) {
    for (const ring of polygon) {
      sourceVertices += ring.length
      const entry = ringEntry(ring)
      if (entry) entries.push(entry)
    }
  }
}

// Biggest first, so the few rings that carry the continents are the ones a
// truncated read would show, and so painting order is stable.
entries.sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]))

const totalBytes = entries.reduce((sum, entry) => sum + entry[4].length, 0)
const keptVertices = entries.reduce(
  (sum, entry) => sum + (entry[4].match(/[ML]/g) ?? []).length,
  0,
)

const output = `/**
 * The world's coastline, as one SVG path. **Generated — do not edit.**
 *
 * Produced by \`node scripts/generate-world-path.mjs\` from Natural Earth's
 * 50m land polygons (public domain), projected equirectangularly into a
 * ${WIDTH}×${HEIGHT} viewBox, simplified with Douglas–Peucker at a tolerance of
 * ${TOLERANCE} units, and rounded to ${PRECISION} decimal place.
 *
 * Committed rather than fetched so the map needs no runtime dependency, no
 * client-side map library, and no third-party tile server — which would
 * otherwise learn which ports this operator looks at.
 */

/** The viewBox this path is drawn for. */
export const WORLD_WIDTH = ${WIDTH}
export const WORLD_HEIGHT = ${HEIGHT}

/**
 * Longitude/latitude to viewBox coordinates.
 *
 * Equirectangular, which is why this is two lines rather than a projection
 * library: every port in the reference table carries a latitude and longitude,
 * and that is all it takes to place one.
 */
export function projectLonLat(longitude: number, latitude: number): [number, number] {
  return [((longitude + 180) / 360) * WORLD_WIDTH, ((90 - latitude) / 180) * WORLD_HEIGHT]
}

/** \`[minX, minY, maxX, maxY, path]\`, largest ring first. */
export type LandRing = readonly [number, number, number, number, string]

export const WORLD_LAND_RINGS: readonly LandRing[] = [
${entries.map(([a, b, c, d, p]) => `  [${a},${b},${c},${d},'${p}'],`).join('\n')}
]

/**
 * The coastline inside a view, as one path.
 *
 * The whole world is ${(totalBytes / 1024).toFixed(0)}KB of path data at this resolution, which is
 * fine in a server bundle and far too much to inline into every render of the
 * dashboard. The map crops to the traffic, so most rings cannot appear —
 * dropping them by bounding box before serialising is what makes the detail
 * affordable.
 *
 * The margin is generous because a ring that starts off-screen may still have
 * an edge crossing into it.
 */
export function landPathFor(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = 8,
): string {
  const minX = x - margin
  const minY = y - margin
  const maxX = x + width + margin
  const maxY = y + height + margin

  let out = ''
  for (const [rMinX, rMinY, rMaxX, rMaxY, path] of WORLD_LAND_RINGS) {
    if (rMaxX < minX || rMinX > maxX || rMaxY < minY || rMinY > maxY) continue
    out += path
  }
  return out
}
`

writeFileSync('apps/web/src/ui/world-path.ts', output)

console.log(
  `wrote apps/web/src/ui/world-path.ts — ${entries.length} rings, ` +
    `${keptVertices} of ${sourceVertices} vertices kept, ` +
    `${(totalBytes / 1024).toFixed(1)}KB of path data`,
)
