'use client'

/**
 * The lane map.
 *
 * The one graphic on the board that a person who knows nothing about freight
 * understands immediately: here is where our cargo comes from, here is where
 * it goes, and the thick lines are the routes we actually run.
 *
 * ## Why this is a real map now
 *
 * It used to be a hand-drawn SVG of Natural Earth's coastline with beziers over
 * the top, on the reasoning that a map library costs ~200KB in the browser and
 * a tile server learns which ports an operator is looking at. Both of those are
 * still true. What the reasoning missed is that a hand-rolled map has to *earn*
 * its place by looking right, and it did not: no borders, no place names, an
 * equirectangular projection that reads as stretched to eyes trained on Web
 * Mercator, and a coastline whose level of detail could only ever be a
 * compromise between one zoom level and another.
 *
 * So: **MapLibre GL** — the open-source library, not Mapbox — against
 * OpenFreeMap's tiles. That combination is deliberate on two counts.
 *
 *   1. **No API key exists to provision.** This product is meant to be
 *      whitelabelled to other forwarders, and a Mapbox token is a per-client
 *      account, a per-client bill and a per-client thing to rotate. There is
 *      none of that here.
 *   2. **The tiles are swappable.** The style below points at a URL. Pointing
 *      it at a self-hosted PMTiles file instead removes the third party
 *      entirely, and nothing else in this file changes.
 *
 * ## Why the style is built here rather than fetched
 *
 * OpenFreeMap serves ready-made styles, and using one would have been a line of
 * code. But a stock basemap is somebody else's palette — grey-green land, blue
 * water, orange motorways — and it would sit inside a product where every other
 * colour resolves from `--qb-*` tokens and re-skins for the next operator. So
 * the style is assembled from those same tokens against OpenFreeMap's vector
 * tiles: the map is dark when the product is dark, and carries the operator's
 * hue rather than a cartographer's.
 *
 * It also means the basemap is *quiet*. Motorways, buildings, parks and land
 * use are simply not drawn. The subject of this map is ten lanes, and every
 * layer that is not land, water, a border or a place name competes with them.
 */

import 'maplibre-gl/dist/maplibre-gl.css'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Map as MapLibreMap, Popup as MapLibrePopup } from 'maplibre-gl'
import { laneGeometry } from '@/lib/sea-route'

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
const MODE_TOKEN: Record<string, string> = {
  sea_fcl: '--qb-chart-1',
  sea_lcl: '--qb-chart-2',
  air: '--qb-chart-3',
  land: '--qb-chart-4',
  courier: '--qb-chart-2',
}

const TILE_SOURCE = 'https://tiles.openfreemap.org/planet'
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

/**
 * OpenStreetMap's licence requires attribution wherever its data is shown.
 *
 * MapLibre renders this in the corner from the source definition. It is not
 * optional and it is not decoration — removing it would put the deployment in
 * breach of ODbL.
 */
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · ' +
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'

/**
 * Resolves a CSS colour expression to something MapLibre can parse.
 *
 * Two conversions, and both are needed. `var(--qb-chart-1)` means nothing
 * outside the DOM, so it is resolved against a probe element that inherits the
 * document's custom properties. And the tokens are authored in **OKLCH**, which
 * MapLibre's style parser does not understand — painting the resolved colour
 * onto a 1×1 canvas and reading the pixel back is the shortest correct way to
 * get an `rgba()` string out of any colour the browser itself can parse.
 */
function createResolver() {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.documentElement.appendChild(probe)

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })

  const resolve = (expression: string, fallback = 'rgb(128,128,128)'): string => {
    if (!context) return fallback
    probe.style.color = ''
    probe.style.color = expression
    const computed = getComputedStyle(probe).color
    if (!computed) return fallback

    context.clearRect(0, 0, 1, 1)
    context.fillStyle = fallback
    context.fillStyle = computed
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    return `rgba(${r}, ${g}, ${b}, ${((a ?? 255) / 255).toFixed(3)})`
  }

  return { resolve, dispose: () => probe.remove() }
}

/** The basemap, in the product's own colours. */
function buildStyle(color: (expression: string) => string) {
  /*
    Land and water need real separation.

    The first pass used surface-sunken against a 14% tint and the two came out
    six points apart in lightness — legible on a swatch, indistinguishable at
    the size a continent is drawn. Land is now the plain surface and water
    carries enough of the brand hue to read as water at a glance.
  */
  const land = color('var(--qb-surface)')
  const water = color('color-mix(in oklab, var(--qb-chart-1) 26%, var(--qb-canvas))')
  const border = color('var(--qb-line-strong)')
  const label = color('var(--qb-ink-muted)')

  return {
    version: 8 as const,
    glyphs: GLYPHS,
    sources: {
      ofm: { type: 'vector' as const, url: TILE_SOURCE, attribution: ATTRIBUTION },
    },
    layers: [
      /*
        Land is the background and water is painted over it, rather than the
        other way round. That is how the vector schema is shaped — there are
        water polygons, there is no "land" polygon — and it means the map has
        no unpainted gaps at any zoom.
      */
      { id: 'land', type: 'background' as const, paint: { 'background-color': land } },
      {
        id: 'water',
        type: 'fill' as const,
        source: 'ofm',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'] as unknown as never,
        paint: { 'fill-color': water, 'fill-antialias': true },
      },
      {
        // Country borders only. State and county lines are noise at the zoom
        // levels a lane map lives at.
        id: 'border',
        type: 'line' as const,
        source: 'ofm',
        'source-layer': 'boundary',
        filter: [
          'all',
          ['<=', ['get', 'admin_level'], 2],
          ['!=', ['get', 'maritime'], 1],
        ] as unknown as never,
        paint: {
          'line-color': border,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 1.1] as unknown as never,
        },
      },
      {
        id: 'country-label',
        type: 'symbol' as const,
        source: 'ofm',
        'source-layer': 'place',
        /*
          Only the most significant countries, and only where the lanes are not.

          Every country label is a name competing with a port name, and the
          port names are the point. Rank 1–3 keeps the continental anchors and
          drops the eighty smaller labels that turned the Atlantic into a wall
          of text.
        */
        filter: [
          'all',
          ['==', ['get', 'class'], 'country'],
          ['<=', ['get', 'rank'], 3],
        ] as unknown as never,
        maxzoom: 7,
        layout: {
          /*
            Latin names in both languages, deliberately.

            Arabic place labels would need MapLibre's RTL text plugin, which is
            loaded from a CDN at runtime — a third script host for the sake of
            country names on a map whose port names come off bills of lading in
            Latin anyway. The rest of the interface is fully bilingual; this one
            layer is not, and that is a considered trade rather than an
            oversight.
          */
          /*
            English first, then any Latin name, then whatever the tile has.

            `name:latin` alone gives the *local* Latin spelling — ESPAÑA,
            MÉXICO, BRASIL, SUOMI/FINLAND — which reads as a mistake beside an
            English interface rather than as multilingual.
          */
          'text-field': [
            'coalesce',
            ['get', 'name:en'],
            ['get', 'name:latin'],
            ['get', 'name'],
          ] as unknown as never,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 8.5, 6, 12] as unknown as never,
          'text-transform': 'uppercase' as const,
          'text-letter-spacing': 0.08,
          'text-max-width': 7,
          'symbol-sort-key': ['get', 'rank'] as unknown as never,
        },
        paint: {
          'text-color': label,
          'text-halo-color': land,
          'text-halo-width': 1.3,
          'text-opacity': 0.75,
        },
      },
      {
        id: 'city-label',
        type: 'symbol' as const,
        source: 'ofm',
        'source-layer': 'place',
        filter: ['==', ['get', 'class'], 'city'] as unknown as never,
        minzoom: 5,
        layout: {
          'text-field': [
            'coalesce',
            ['get', 'name:en'],
            ['get', 'name:latin'],
            ['get', 'name'],
          ] as unknown as never,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 9, 13] as unknown as never,
          'text-max-width': 8,
          'symbol-sort-key': ['get', 'rank'] as unknown as never,
        },
        paint: {
          'text-color': label,
          'text-halo-color': land,
          'text-halo-width': 1.3,
          'text-opacity': 0.6,
        },
      },
    ],
  }
}

export function LaneMap({
  lanes,
  ports,
  className,
}: {
  readonly lanes: readonly MapLane[]
  readonly ports: readonly MapPort[]
  readonly className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const router = useRouter()

  /*
    The data is held in a ref so a re-render with the same lanes does not tear
    the map down and rebuild it. The effect below depends on the *identity* of
    these arrays, and a server component hands new array instances every time.
  */
  const data = useRef({ lanes, ports })
  data.current = { lanes, ports }

  useEffect(() => {
    const node = container.current
    if (!node) return

    let map: MapLibreMap | null = null
    let popup: MapLibrePopup | null = null
    let disposed = false
    const cleanups: (() => void)[] = []

    void (async () => {
      /*
        Imported here rather than at module scope: MapLibre touches `window` on
        load, and this component is server-rendered before it hydrates.

        The `default ?? module` dance covers both shapes the package has
        shipped — v5 exports a default namespace, v6 exports named bindings —
        so a version bump does not turn into a blank rectangle.
      */
      const imported = await import('maplibre-gl')
      const maplibre = (imported as unknown as { default?: typeof imported }).default ?? imported
      if (disposed) return
      /*
        v6 finds its worker beside its own module, and bundled into a Next chunk
        that is nowhere: the map logged "Worker failed to load" and stayed
        blank. `scripts/maplibre-worker.mjs` serves the worker from `public/`
        under the installed version, which is the path given here.
      */
      maplibre.setWorkerUrl(`/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`)

      const resolver = createResolver()
      cleanups.push(resolver.dispose)

      const laneFeatures = data.current.lanes.map((lane) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: laneGeometry(
            [lane.originLon, lane.originLat],
            [lane.destinationLon, lane.destinationLat],
            lane.mode,
          ).map(([lon, lat]) => [lon, lat]),
        },
        properties: {
          id: lane.id,
          mode: lane.mode,
          count: lane.count,
          href: lane.href ?? '',
          // The arrow points at the destination in either direction; U+2192
          // under RTL pointed back at the origin (see `formatLane`). This runs
          // in the browser, so the document's own `dir` is the source.
          label: `${lane.originName} ${
            document.documentElement.dir === 'rtl' ? '←' : '→'
          } ${lane.destinationName} · ${lane.count}`,
        },
      }))

      const busiestPort = Math.max(1, ...data.current.ports.map((port) => port.count))
      const portFeatures = data.current.ports.map((port) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [port.longitude, port.latitude] },
        properties: {
          id: port.id,
          name: port.name,
          count: port.count,
          href: port.href ?? '',
          radius: 3.5 + (port.count / busiestPort) * 4,
        },
      }))

      /*
        Held in a local const as well as the outer `let`.

        The outer binding exists so the cleanup function can reach it, but it
        is typed nullable and every use inside this async closure would need a
        guard that can never actually fire. The const is what the rest of the
        setup talks to.
      */
      const instance = new maplibre.Map({
        container: node,
        style: buildStyle(resolver.resolve),
        center: [40, 25],
        zoom: 1.4,
        // A lane map has no use for pitch or bearing, and both are ways for
        // someone to end up looking at a map they cannot straighten.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: { compact: true },
      })
      map = instance

      /*
        A map that fails silently is worse than one that is obviously broken.

        MapLibre reports tile, style, worker and font failures through this
        event and nowhere else — without a handler, a basemap that never loads
        renders as a plain coloured rectangle and looks like a styling mistake.
      */
      instance.on('error', (event) => {
        console.error('[lane-map]', event?.error?.message ?? event)
      })

      instance.touchZoomRotate.disableRotation()
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right')

      const hoverPopup = new maplibre.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'qb-map-popup',
      })
      popup = hoverPopup

      /**
       * Sources and layers, re-added whenever the style is replaced.
       *
       * `setStyle` discards everything the style did not declare, so a theme
       * change would otherwise drop the lanes. MapLibre fires `style.load`
       * after each swap, which is the hook for putting them back — and because
       * the paint colours are read at this moment, they pick up the new theme
       * for free.
       */
      const addOverlays = () => {
        const color = resolver.resolve

        const modeColors: unknown[] = ['match', ['get', 'mode']]
        for (const [mode, token] of Object.entries(MODE_TOKEN)) {
          modeColors.push(mode, color(`var(${token})`))
        }
        modeColors.push(color('var(--qb-chart-1)'))

        instance.addSource('lanes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: laneFeatures },
        })
        instance.addSource('ports', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: portFeatures },
        })

        /*
          Width carries volume, and grows with zoom so a lane stays legible
          when the board is zoomed out and proportionate when it is not.

          The casing is a *separate* interpolation rather than `['+', weight,
          3]`. MapLibre rejects a `zoom` expression used as an input to
          anything but a top-level `step` or `interpolate`, so wrapping the
          width in arithmetic throws at `addLayer` and — because that aborts
          the rest of this function — takes the ports and labels down with it.
        */
        const laneWidth = (base: number, top: number) => [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          ['+', base, ['*', ['get', 'count'], 0.32]],
          6,
          ['+', top, ['*', ['get', 'count'], 0.7]],
        ]

        const weight = laneWidth(2.2, 4)

        // A light casing under each lane so a line crossing a border or a
        // label still reads as one continuous route.
        instance.addLayer({
          id: 'lane-casing',
          type: 'line',
          source: 'lanes',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': color('var(--qb-surface)'),
            'line-width': laneWidth(5.2, 7.5) as never,
            'line-opacity': 0.55,
          },
        })

        instance.addLayer({
          id: 'lane-line',
          type: 'line',
          source: 'lanes',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': modeColors as never,
            'line-width': weight as never,
            'line-opacity': 0.9,
          },
        })

        // A 20px transparent line is the hit target. Nobody can deliberately
        // hover a 3px one.
        instance.addLayer({
          id: 'lane-hit',
          type: 'line',
          source: 'lanes',
          paint: { 'line-color': 'rgba(0,0,0,0)', 'line-width': 20 },
        })

        instance.addLayer({
          id: 'port-halo',
          type: 'circle',
          source: 'ports',
          paint: {
            'circle-radius': ['+', ['get', 'radius'], 3] as never,
            'circle-color': color('var(--qb-surface)'),
            'circle-opacity': 0.85,
          },
        })

        instance.addLayer({
          id: 'port-dot',
          type: 'circle',
          source: 'ports',
          paint: {
            'circle-radius': ['get', 'radius'] as never,
            'circle-color': color('var(--qb-ink)'),
            'circle-stroke-width': 1.5,
            'circle-stroke-color': color('var(--qb-surface)'),
          },
        })

        /*
          Port names, with collision handling done by the renderer.

          The SVG version placed these by hand — six candidate positions per
          marker, rejecting overlaps against a list of boxes — and still had to
          give up on labelling the Gulf, where Shuwaikh, Jebel Ali and Dubai sit
          within a few hundred kilometres. MapLibre does it properly and, more
          to the point, redoes it on every zoom, so the labels that will not fit
          at one level appear at the next.
        */
        instance.addLayer({
          id: 'port-label',
          type: 'symbol',
          source: 'ports',
          layout: {
            'text-field': ['get', 'name'] as never,
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-anchor': 'left',
            'text-offset': [0.75, 0],
            'text-max-width': 10,
            // Lower sorts first, so the busiest port wins a contested spot.
            'symbol-sort-key': ['-', 0, ['get', 'count']] as never,
          },
          paint: {
            'text-color': color('var(--qb-ink)'),
            'text-halo-color': color('var(--qb-surface)'),
            'text-halo-width': 1.6,
          },
        })
      }

      instance.on('style.load', addOverlays)

      instance.once('load', () => {
        /*
          Frame the traffic, not the world.

          Every coordinate of every routed lane is included rather than only
          the endpoints, because a Rotterdam–Shuwaikh route swings out past
          Portugal — bounds taken from the ports alone would clip the line.
        */
        const bounds = new maplibre.LngLatBounds()
        let any = false
        for (const feature of laneFeatures) {
          for (const [lon, lat] of feature.geometry.coordinates) {
            bounds.extend([lon!, lat!])
            any = true
          }
        }
        for (const feature of portFeatures) {
          bounds.extend(feature.geometry.coordinates as [number, number])
          any = true
        }
        if (any) {
          instance.fitBounds(bounds, { padding: 56, animate: false, maxZoom: 6 })
        }
      })

      // --- interaction -----------------------------------------------------

      const hoverable = ['lane-hit', 'port-dot'] as const

      for (const layer of hoverable) {
        instance.on('mouseenter', layer, () => {
          instance.getCanvas().style.cursor = 'pointer'
        })
        instance.on('mouseleave', layer, () => {
          instance.getCanvas().style.cursor = ''
          hoverPopup.remove()
        })
        instance.on('mousemove', layer, (event) => {
          const feature = event.features?.[0]
          if (!feature) return
          const properties = feature.properties as Record<string, unknown>
          const text =
            layer === 'lane-hit'
              ? String(properties.label ?? '')
              : `${String(properties.name ?? '')} · ${String(properties.count ?? '')}`
          hoverPopup.setLngLat(event.lngLat).setText(text).addTo(instance)
        })
        instance.on('click', layer, (event) => {
          const href = event.features?.[0]?.properties?.href
          if (typeof href === 'string' && href) router.push(href as never)
        })
      }

      // --- theme ------------------------------------------------------------

      /*
        The palette lives in CSS, so the map has to be told when it changes.

        Two signals, because the product has three theme states: an explicit
        choice stamps `data-theme` on the root, and "system" stamps nothing and
        follows the media query.
      */
      const restyle = () => instance.setStyle(buildStyle(resolver.resolve))

      const observer = new MutationObserver(restyle)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class'],
      })
      cleanups.push(() => observer.disconnect())

      const scheme = window.matchMedia('(prefers-color-scheme: dark)')
      scheme.addEventListener('change', restyle)
      cleanups.push(() => scheme.removeEventListener('change', restyle))

      // MapLibre does not watch its own container, and this one sits in a
      // grid that reflows when the sidebar collapses.
      const resize = new ResizeObserver(() => instance.resize())
      resize.observe(node)
      cleanups.push(() => resize.disconnect())
    })()

    return () => {
      disposed = true
      for (const cleanup of cleanups) cleanup()
      popup?.remove()
      map?.remove()
    }
    // Rebuilt only when the *shape* of the data changes. `data.current` always
    // holds the latest arrays, so a re-render with equal contents is free.
  }, [lanes.length, ports.length, router])

  return (
    <div
      ref={container}
      className={['qb-map h-[26rem] w-full overflow-hidden rounded-sm', className]
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={`Shipping lanes: ${lanes.length} routes across ${ports.length} ports`}
    />
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
        <li key={entry.mode} className="flex items-center gap-1.5 text-caption text-ink-muted">
          <span
            aria-hidden
            className="h-[3px] w-4 rounded-full"
            style={{ backgroundColor: `var(${MODE_TOKEN[entry.mode] ?? '--qb-chart-1'})` }}
          />
          {entry.label}
          <span className="numeric font-semibold text-ink">{entry.count}</span>
        </li>
      ))}
    </ul>
  )
}
