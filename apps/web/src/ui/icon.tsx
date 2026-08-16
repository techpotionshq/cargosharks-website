/**
 * The icon set.
 *
 * Drawn in-repo rather than pulled from a library: an icon dependency is
 * 60–200kB for the two dozen glyphs a freight product actually uses, and every
 * one of those glyphs would then need overriding to inherit the brand's stroke
 * weight. These take `currentColor` and one stroke width, so they are correct
 * on the navy sidebar, on a white card and inside a status pill without any
 * per-placement styling.
 *
 * Mirroring: directional glyphs flip under RTL through `rtl:-scale-x-100`.
 * A chevron that points at the next page must point *away* from the reader's
 * start edge, and in Arabic that is the other way round. Non-directional
 * glyphs — a ship, a clock — must not flip, so mirroring is opt-in per glyph.
 */

import type { SVGProps } from 'react'

/** Glyphs whose meaning depends on reading direction. */
const MIRRORED = new Set([
  'chevron-end',
  'arrow-end',
  'arrow-up-end',
  'arrow-down-end',
  'sign-out',
  'external',
])

const PATHS = {
  // --- navigation -------------------------------------------------------
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  enquiries: 'M3 12h5l2 3h4l2-3h5M5 5h14l2 7v7H3v-7z',
  jobs: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  rates: 'M3 3h8l10 10-8 8L3 11zM7.6 7.6h.01',
  finance: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9.5 7h5M9.5 11h5M9.5 15h3',
  admin: 'M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4',
  tracking: 'M12 21.5S19 15 19 10a7 7 0 1 0-14 0c0 5 7 11.5 7 11.5z',
  partners:
    'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20.5a6.5 6.5 0 0 1 13 0M16 4.7a3.5 3.5 0 0 1 0 6.6M17.2 14.4a6.5 6.5 0 0 1 4.3 6.1',

  // --- transport modes --------------------------------------------------
  ship: 'M3.5 17l1.6-5h13.8l1.6 5M6.5 12V7.5h11V12M12 4v3.5M2 20.5c1.6 0 2.1-1 3.7-1s2.1 1 3.7 1 2.1-1 3.7-1 2.1 1 3.7 1 2.1-1 3.2-1',
  plane: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  truck: 'M3 6.5h11v10H3zM14 9.5h4l3 3v4h-7z',
  courier: 'M8 3h8l2 5H6zM6 8h12v13H6zM10 12h4',
  container: 'M3 7h18v11H3zM7.5 7v11M12 7v11M16.5 7v11',

  // --- state ------------------------------------------------------------
  clock: 'M12 7.5V12l3.2 1.9',
  alert: 'M12 3.6 2.9 19.6h18.2zM12 10v4M12 17.2h.01',
  hold: 'M12 3l8 3v6c0 5-4 8.2-8 9-4-.8-8-4-8-9V6zM9.5 12l1.8 1.8 3.4-3.4',
  check: 'M20 6.5 9 17.5l-5-5',
  /** A filled bullet — the circle below carries it; there is no stroke path. */
  dot: '',
  document: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13.5h6M9 17h4',
  calendar: 'M4 6.5h16v14.5H4zM4 10.5h16M8 3.5v4M16 3.5v4',
  trend: 'M3 12h4l3-8 4 16 3-8h4',
  anchor: 'M12 7.8V21M5 13H2.2a9.8 9.8 0 0 0 19.6 0H19M8.5 11h7',

  // --- controls ---------------------------------------------------------
  search: 'm20.2 20.2-3.7-3.7',
  filter: 'M3 5h18l-7 8.2V20l-4 1.6v-8.4z',
  'chevron-end': 'm9.5 6 6 6-6 6',
  'chevron-down': 'm6 9.5 6 6 6-6',
  'arrow-end': 'M4 12h15M13.5 6.5 19.5 12l-6 5.5',
  'arrow-up-end': 'M7.5 16.5 16.5 7.5M9.5 7.5h7v7',
  'arrow-down-end': 'M7.5 7.5 16.5 16.5M16.5 9.5v7h-7',
  globe: 'M3 12h18M12 3a15.3 15.3 0 0 1 0 18 15.3 15.3 0 0 1 0-18',
  sun: 'M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6',
  moon: 'M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.6 8.6 0 1 0 11.3 11.3z',
  user: 'M4.5 20.5a7.5 7.5 0 0 1 15 0',
  bell: 'M18 9.5a6 6 0 1 0-12 0c0 5.6-2 6.8-2 6.8h16s-2-1.2-2-6.8M10.3 20.2a2 2 0 0 0 3.4 0',
  download: 'M12 3.5v11.8M7.6 11.2 12 15.6l4.4-4.4M4 20.2h16',
  external: 'M14 4h6v6M20 4l-8.5 8.5M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5',
  'sign-out': 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8.2 6.2 12l3.8 3.8M6.4 12H16',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  menu: 'M4 7h16M4 12h16M4 17h16',
  plus: 'M12 5v14M5 12h14',
} as const

export type IconName = keyof typeof PATHS

/** Glyphs that need a circle the path notation cannot express cleanly. */
const CIRCLES: Partial<Record<IconName, { cx: number; cy: number; r: number }[]>> = {
  clock: [{ cx: 12, cy: 12, r: 9 }],
  search: [{ cx: 11, cy: 11, r: 7 }],
  globe: [{ cx: 12, cy: 12, r: 9 }],
  sun: [{ cx: 12, cy: 12, r: 4 }],
  user: [{ cx: 12, cy: 8, r: 3.8 }],
  truck: [
    { cx: 7, cy: 18.5, r: 1.9 },
    { cx: 17.5, cy: 18.5, r: 1.9 },
  ],
  anchor: [{ cx: 12, cy: 5.2, r: 2.6 }],
  tracking: [{ cx: 12, cy: 10, r: 2.6 }],
  dot: [{ cx: 12, cy: 12, r: 3.5 }],
  check: [],
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  readonly name: IconName
  /** Rendered square size in px. 18 for inline, 20 for nav, 24 for headers. */
  readonly size?: number
  /** Heavier at small sizes keeps the glyph from disappearing in a pill. */
  readonly strokeWidth?: number
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className, ...rest }: IconProps) {
  const circles = CIRCLES[name] ?? []
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={[MIRRORED.has(name) ? 'rtl:-scale-x-100' : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {PATHS[name] ? <path d={PATHS[name]} /> : null}
      {circles.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
    </svg>
  )
}

/** The glyph for a transport mode — used on every job, enquiry and quote. */
export function modeIcon(mode: string | null | undefined): IconName {
  switch (mode) {
    case 'air':
      return 'plane'
    case 'land':
      return 'truck'
    case 'courier':
      return 'courier'
    case 'sea_lcl':
    case 'sea_fcl':
      return 'ship'
    default:
      return 'jobs'
  }
}
