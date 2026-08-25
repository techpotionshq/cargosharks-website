/**
 * Plausible sea routes between two ports.
 *
 * The lane map used to draw a bezier from origin to destination, which meant
 * Rotterdam–Shuwaikh ran across France, Italy, Turkey and Iraq, and
 * Shuwaikh–Shanghai crossed the Himalayas. A prettier basemap does not fix
 * that: it draws better cartography *underneath* a line still going over the
 * mountains, and to anyone in this business that is the most obviously wrong
 * thing on the screen.
 *
 * ## What this is, and what it is not
 *
 * It is **not** navigation. There is no bathymetry, no traffic separation
 * scheme, no weather routing, no canal booking, and the distances it produces
 * must never be used to price a shipment or estimate a transit. A real answer
 * to "how far is it actually" comes from a maritime routing service, and that
 * is a paid per-request dependency this does not pretend to replace.
 *
 * It is a **graph of the places ships actually go through** — Gibraltar, Suez,
 * Bab-el-Mandeb, Hormuz, Malacca — with shortest-path routing over great-circle
 * distances. The result is a line that leaves the right port, passes through
 * the right chokepoints in the right order, and stays in water. That is exactly
 * the amount of truth a dashboard needs, and it is the amount it can support.
 *
 * ## Why a graph rather than a route table
 *
 * A table of "Europe to Gulf goes via Suez" needs an entry for every pair of
 * regions and has to be extended by hand every time this operator opens a lane.
 * A graph is extended by adding one waypoint. Ports are not in the graph at
 * all: each is joined to its three nearest waypoints when a route is asked for,
 * and the shortest path decides which of the three to actually use. Three
 * rather than one because the nearest waypoint by straight-line distance is
 * sometimes on the wrong side of a landmass — Hamburg's nearest node is the
 * Kattegat, on the far side of Denmark, and only letting the search choose
 * between candidates sends it out through the North Sea instead.
 */

export type LonLat = readonly [number, number]

/**
 * Waypoints, every one of them in open water or in a canal.
 *
 * Positions are deliberately a little off the coast. A waypoint placed on a
 * port sits in the harbour, and the leg into it then crosses the headland next
 * door.
 */
const NODES: Record<string, LonLat> = {
  // --- northern Europe and the Atlantic approaches ---
  baltic: [14.0, 55.5],
  kattegat: [11.0, 57.3],
  northSea: [3.5, 55.0],
  englishChannel: [1.0, 50.5],
  celticSea: [-7.0, 49.5],
  biscay: [-6.0, 45.0],
  iberiaWest: [-9.8, 38.0],
  atlanticNE: [-20.0, 40.0],
  canaries: [-16.0, 28.0],
  atlanticC: [-25.0, 15.0],
  guinea: [2.0, 2.0],
  atlanticSE: [8.0, -20.0],

  // --- Mediterranean and the Black Sea ---
  gibraltar: [-5.6, 35.95],
  medWest: [4.5, 38.5],
  medCentral: [15.0, 35.5],
  medEast: [28.5, 33.8],
  aegean: [25.0, 37.0],
  bosphorus: [29.0, 41.0],
  blackSea: [33.0, 43.5],

  // --- Suez and the Red Sea ---
  portSaid: [32.35, 31.5],
  suezCanal: [32.5, 30.5],
  suezSouth: [32.6, 29.4],
  redSeaNorth: [36.5, 25.0],
  redSeaSouth: [40.5, 16.0],
  babElMandeb: [43.4, 12.6],
  gulfOfAden: [48.0, 12.5],

  // --- Arabian Sea and the Gulf ---
  arabianSea: [61.0, 18.0],
  omanSea: [59.0, 24.0],
  hormuz: [56.4, 26.6],
  gulfSouth: [53.5, 25.8],
  gulfCentral: [51.5, 27.5],
  gulfNorth: [48.8, 29.3],

  // --- India and the Bay of Bengal ---
  indiaWest: [70.0, 19.5],
  lakshadweep: [72.0, 10.0],
  indiaSouth: [78.0, 5.5],
  bayOfBengal: [86.0, 13.0],
  andaman: [93.0, 10.0],

  // --- south-east and east Asia ---
  malaccaWest: [96.5, 5.0],
  malaccaStrait: [100.5, 3.0],
  singapore: [104.2, 1.2],
  southChinaSea: [112.0, 12.0],
  hongKong: [114.5, 21.0],
  taiwanStrait: [119.5, 24.5],
  eastChinaSea: [123.5, 30.0],
  yellowSea: [123.0, 35.5],
  koreaStrait: [129.0, 34.0],
  japanSouth: [135.0, 33.0],
  tokyoBay: [140.0, 34.5],

  // --- the long way round, for when Suez is not an option ---
  capeTown: [18.0, -35.5],
  mozambiqueChannel: [41.0, -20.0],
  mauritius: [58.0, -20.0],
}

/**
 * Which waypoints a ship can sail between directly.
 *
 * Every pair here is open water end to end — that is the whole correctness
 * condition, and the only one. Adding an edge across a peninsula is how this
 * starts lying again.
 */
const EDGES: readonly (readonly [string, string])[] = [
  ['baltic', 'kattegat'],
  ['kattegat', 'northSea'],
  ['northSea', 'englishChannel'],
  ['englishChannel', 'celticSea'],
  ['celticSea', 'biscay'],
  ['biscay', 'iberiaWest'],
  ['iberiaWest', 'gibraltar'],
  ['iberiaWest', 'atlanticNE'],
  ['atlanticNE', 'canaries'],
  ['canaries', 'atlanticC'],
  ['atlanticC', 'guinea'],
  ['guinea', 'atlanticSE'],
  ['atlanticSE', 'capeTown'],
  ['capeTown', 'mozambiqueChannel'],
  ['mozambiqueChannel', 'mauritius'],
  ['mauritius', 'indiaSouth'],
  ['mauritius', 'arabianSea'],

  ['gibraltar', 'medWest'],
  ['medWest', 'medCentral'],
  ['medCentral', 'medEast'],
  ['medCentral', 'aegean'],
  ['medEast', 'aegean'],
  ['aegean', 'bosphorus'],
  ['bosphorus', 'blackSea'],
  ['medEast', 'portSaid'],

  ['portSaid', 'suezCanal'],
  ['suezCanal', 'suezSouth'],
  ['suezSouth', 'redSeaNorth'],
  ['redSeaNorth', 'redSeaSouth'],
  ['redSeaSouth', 'babElMandeb'],
  ['babElMandeb', 'gulfOfAden'],
  ['gulfOfAden', 'arabianSea'],

  ['arabianSea', 'omanSea'],
  ['omanSea', 'hormuz'],
  ['hormuz', 'gulfSouth'],
  ['gulfSouth', 'gulfCentral'],
  ['gulfCentral', 'gulfNorth'],

  ['arabianSea', 'indiaWest'],
  ['arabianSea', 'lakshadweep'],
  ['indiaWest', 'lakshadweep'],
  ['lakshadweep', 'indiaSouth'],
  ['indiaSouth', 'bayOfBengal'],
  ['bayOfBengal', 'andaman'],
  ['andaman', 'malaccaWest'],
  ['indiaSouth', 'malaccaWest'],
  ['malaccaWest', 'malaccaStrait'],
  ['malaccaStrait', 'singapore'],

  ['singapore', 'southChinaSea'],
  ['southChinaSea', 'hongKong'],
  ['hongKong', 'taiwanStrait'],
  ['taiwanStrait', 'eastChinaSea'],
  ['eastChinaSea', 'yellowSea'],
  ['eastChinaSea', 'koreaStrait'],
  ['koreaStrait', 'japanSouth'],
  ['japanSouth', 'tokyoBay'],
]

const EARTH_RADIUS_KM = 6371
const toRadians = (degrees: number) => (degrees * Math.PI) / 180
const toDegrees = (radians: number) => (radians * 180) / Math.PI

/** Great-circle distance in kilometres. */
export function distanceKm(a: LonLat, b: LonLat): number {
  const [lon1, lat1] = a
  const [lon2, lat2] = b
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Points along the great circle from `a` to `b`.
 *
 * Straight lines in Web Mercator are not straight on the globe, so a long leg
 * drawn as two coordinates bows the wrong way. Interpolating on the sphere and
 * letting the projection do its work is what makes a trans-ocean leg look like
 * a route rather than like a ruler.
 */
export function greatCircle(a: LonLat, b: LonLat, segments?: number): LonLat[] {
  const lon1 = toRadians(a[0])
  const lat1 = toRadians(a[1])
  const lon2 = toRadians(b[0])
  const lat2 = toRadians(b[1])

  const d = distanceKm(a, b)
  // One point roughly every 150km, bounded so a short hop is not a hundred
  // coordinates and an ocean crossing is not a polygon.
  const steps = segments ?? Math.max(2, Math.min(96, Math.round(d / 150)))

  const angular = d / EARTH_RADIUS_KM
  if (angular < 1e-9) return [a, b]

  const sinAngular = Math.sin(angular)
  const out: LonLat[] = []

  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const A = Math.sin((1 - f) * angular) / sinAngular
    const B = Math.sin(f * angular) / sinAngular

    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2)
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)

    out.push([toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, Math.hypot(x, y)))])
  }

  return out
}

/** Adjacency, built once. */
const GRAPH: Map<string, string[]> = (() => {
  const graph = new Map<string, string[]>()
  for (const key of Object.keys(NODES)) graph.set(key, [])
  for (const [from, to] of EDGES) {
    graph.get(from)!.push(to)
    graph.get(to)!.push(from)
  }
  return graph
})()

/** The `count` waypoints closest to a point, nearest first. */
function nearestNodes(point: LonLat, count: number): string[] {
  return Object.entries(NODES)
    .map(([key, position]) => ({ key, d: distanceKm(point, position) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((entry) => entry.key)
}

/**
 * Dijkstra between two waypoints.
 *
 * The graph is fifty-odd nodes, so a linear scan for the next node is faster
 * than the heap that would replace it and considerably easier to read.
 */
function shortestPath(start: string, goal: string): string[] | null {
  if (start === goal) return [start]

  const distance = new Map<string, number>([[start, 0]])
  const previous = new Map<string, string>()
  const settled = new Set<string>()

  for (;;) {
    let current: string | null = null
    let best = Infinity
    for (const [key, d] of distance) {
      if (!settled.has(key) && d < best) {
        best = d
        current = key
      }
    }
    if (current === null) return null
    if (current === goal) break

    settled.add(current)
    for (const next of GRAPH.get(current) ?? []) {
      if (settled.has(next)) continue
      const candidate = best + distanceKm(NODES[current]!, NODES[next]!)
      if (candidate < (distance.get(next) ?? Infinity)) {
        distance.set(next, candidate)
        previous.set(next, current)
      }
    }
  }

  const path = [goal]
  let cursor = goal
  while (cursor !== start) {
    cursor = previous.get(cursor)!
    path.unshift(cursor)
  }
  return path
}

/** A candidate route and what it costs, for choosing between entry waypoints. */
function routeVia(from: LonLat, to: LonLat, entry: string, exit: string) {
  const path = shortestPath(entry, exit)
  if (!path) return null

  let length = distanceKm(from, NODES[entry]!) + distanceKm(NODES[exit]!, to)
  for (let i = 1; i < path.length; i++) {
    length += distanceKm(NODES[path[i - 1]!]!, NODES[path[i]!]!)
  }
  return { path, length }
}

/**
 * A sea route between two ports, as a list of coordinates.
 *
 * Falls back to a plain great circle when the graph cannot connect the two —
 * a Pacific crossing, say, which has no waypoints here yet. A straight line is
 * wrong in that case, but it is visibly a straight line, whereas an empty lane
 * is a shipment that looks like it does not exist.
 */
export function seaRoute(from: LonLat, to: LonLat): LonLat[] {
  const entries = nearestNodes(from, 3)
  const exits = nearestNodes(to, 3)

  let best: { path: string[]; length: number } | null = null
  for (const entry of entries) {
    for (const exit of exits) {
      const candidate = routeVia(from, to, entry, exit)
      if (candidate && (!best || candidate.length < best.length)) best = candidate
    }
  }

  if (!best) return greatCircle(from, to)

  /*
    Very short hops skip the graph entirely.

    Two berths a few miles apart are closer to each other than either is to
    the nearest waypoint, so routing them produces a visible dogleg out to sea
    and back. The test is against the *approach legs* rather than against the
    total: comparing to the total would skip the graph for every long lane,
    because going around Iberia and through Suez is of course much further
    than the straight line — that is the entire point of routing it.
  */
  const entryLeg = distanceKm(from, NODES[best.path[0]!]!)
  const exitLeg = distanceKm(NODES[best.path.at(-1)!]!, to)
  if (distanceKm(from, to) < entryLeg + exitLeg) return greatCircle(from, to)

  const waypoints: LonLat[] = [from, ...best.path.map((key) => NODES[key]!), to]

  // Densify each leg so the whole line follows the globe rather than the
  // projection, and drop the duplicated joint between consecutive legs.
  const out: LonLat[] = []
  for (let i = 1; i < waypoints.length; i++) {
    const leg = greatCircle(waypoints[i - 1]!, waypoints[i]!)
    out.push(...(i === 1 ? leg : leg.slice(1)))
  }
  return unwrap(out)
}

/**
 * Keeps a line from jumping the antimeridian.
 *
 * GeoJSON longitudes wrap at ±180, so a Shanghai–Los Angeles leg drawn from
 * 121 to -118 renders as a line straight back across Asia and Europe. Letting
 * the longitude run past 180 instead is what map renderers expect.
 */
function unwrap(points: readonly LonLat[]): LonLat[] {
  const out: LonLat[] = []
  let offset = 0
  for (let i = 0; i < points.length; i++) {
    const [lon, lat] = points[i]!
    if (i > 0) {
      const delta = lon + offset - out[i - 1]![0]
      if (delta > 180) offset -= 360
      else if (delta < -180) offset += 360
    }
    out.push([lon + offset, lat])
  }
  return out
}

/**
 * The geometry a lane should be drawn with, by mode.
 *
 * Air and courier fly, so they get a great circle and are *supposed* to cross
 * land. Road and rail cross land too, and modelling their actual corridors is
 * a different graph nobody has asked for — a straight line is honest about
 * being a schematic. Only sea freight gets routed, because only sea freight
 * looks wrong when it is not.
 */
export function laneGeometry(from: LonLat, to: LonLat, mode: string): LonLat[] {
  if (mode === 'sea_fcl' || mode === 'sea_lcl') return seaRoute(from, to)
  return unwrap(greatCircle(from, to))
}
