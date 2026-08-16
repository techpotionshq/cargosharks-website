/**
 * Bakes the world's coastline into a single SVG path — `node scripts/generate-world-path.mjs`.
 *
 * Run once, and its output is committed. That is the whole point: the map on
 * the operations board needs *accurate* land, and the honest ways to get it
 * are a runtime dependency on a 100KB TopoJSON plus a projection library, or
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
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { feature } from 'topojson-client'

const WIDTH = 1000
const HEIGHT = 500

/** Coordinates below this many decimal places are noise at 1000px wide. */
const PRECISION = 1

/** Drops rings whose bounding box is smaller than this fraction of the map. */
const MIN_RING_SIZE = 1.5

/** Drops a vertex closer than this to the last one kept, in viewBox units. */
const MIN_STEP = 3.0

const topology = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'))
const land = feature(topology, topology.objects.land)

const project = ([lon, lat]) => [((lon + 180) / 360) * WIDTH, ((90 - lat) / 180) * HEIGHT]

function ringPath(ring) {
  // A ring's extent decides whether it survives: at this size an islet is one
  // sub-pixel speck that costs as much path data as a country.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const points = ring.map((coordinate) => {
    const [x, y] = project(coordinate)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    return [x, y]
  })
  if (maxX - minX < MIN_RING_SIZE && maxY - minY < MIN_RING_SIZE) return ''

  /*
    Reject rings that are long and flat.

    Decimation can collapse a thin sliver — an ice shelf edge, a river delta
    traced at 110m — into what is effectively a horizontal line, and a closed
    path of near-collinear points fills as a full-width stripe across the map.
    One of those was drawn straight across the North Atlantic. A ring that is
    two orders of magnitude wider than it is tall is that artefact, not a
    coastline anybody needs.
  */
  const width = maxX - minX
  const height = maxY - minY
  if (height < 1.2 && width > 8) return ''
  if (width < 1.2 && height > 8) return ''

  /*
    Decimation, and it is what makes this shippable rather than merely correct.
    Natural Earth's 110m land is still ~1500 vertices for Russia alone, and at
    1000px wide most consecutive pairs land within a pixel of each other.
    Dropping any point within `MIN_STEP` of the last one kept takes the path
    from 58KB to 30KB. The map is drawn about 700px wide, so one viewBox unit
    is roughly 0.7 screen pixels and a 3-unit threshold discards detail finer
    than two pixels — invisible at the size it is displayed, and a third of
    the bytes.

    The last point of a ring is always kept: dropping it leaves the closing
    `Z` to interpolate a long chord across whatever was trimmed.
  */
  let out = ''
  let keptX = -Infinity
  let keptY = -Infinity

  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]
    const last = i === points.length - 1
    if (!last && i > 0 && Math.abs(x - keptX) < MIN_STEP && Math.abs(y - keptY) < MIN_STEP) {
      continue
    }
    const pair = `${x.toFixed(PRECISION)},${y.toFixed(PRECISION)}`
    out += (out === '' ? 'M' : 'L') + pair
    keptX = x
    keptY = y
  }
  return out ? `${out}Z` : ''
}

const parts = []
for (const geometry of land.features) {
  const polygons =
    geometry.geometry.type === 'Polygon'
      ? [geometry.geometry.coordinates]
      : geometry.geometry.coordinates
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const path = ringPath(ring)
      if (path) parts.push(path)
    }
  }
}

const path = parts.join('')

const output = `/**
 * The world's coastline, as one SVG path. **Generated — do not edit.**
 *
 * Produced by \`node scripts/generate-world-path.mjs\` from Natural Earth's
 * 110m land polygons (public domain), projected equirectangularly into a
 * ${WIDTH}×${HEIGHT} viewBox and rounded to ${PRECISION} decimal place.
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

export const WORLD_LAND_PATH =
  '${path}'
`

writeFileSync('apps/web/src/ui/world-path.ts', output)

console.log(
  `wrote apps/web/src/ui/world-path.ts — ${parts.length} rings, ` +
    `${(path.length / 1024).toFixed(1)}KB of path data`,
)
