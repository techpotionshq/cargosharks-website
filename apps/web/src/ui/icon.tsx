/**
 * The icon set — Phosphor, addressed by role rather than by glyph name.
 *
 * Call sites ask for `name="enquiries"`, not `name="Envelope"`. That
 * indirection is the whole point: it is a vocabulary of *things in this
 * product*, so the day an enquiry stops looking like an envelope, one line
 * here changes it everywhere, and no screen has an opinion about which glyph
 * an enquiry wears.
 *
 * Imported from `@phosphor-icons/react/dist/ssr`, which is the entry that
 * renders in a server component. The default `.` entry is client-only and
 * would drag every screen that shows an icon across the boundary.
 *
 * Mirroring: directional glyphs flip under RTL through `rtl:-scale-x-100`.
 * A chevron pointing at the next page must point *away* from the reader's
 * start edge, and in Arabic that is the other way round. A ship or a clock
 * must not flip, so mirroring stays opt-in per glyph.
 */

import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import {
  Airplane,
  Anchor,
  Sparkle,
  ArrowRight,
  ArrowsInSimple,
  ArrowsOutSimple,
  ArrowSquareOut,
  ArrowUpRight,
  Bell,
  Boat,
  Buildings,
  CalendarBlank,
  CaretDown,
  CaretRight,
  ChartLineUp,
  Check,
  Circle,
  Clock,
  ClockCounterClockwise,
  CurrencyDollar,
  DotsThree,
  DownloadSimple,
  Envelope,
  FileText,
  FunnelSimple,
  Gauge,
  Gear,
  Globe,
  Lightning,
  List,
  MagnifyingGlass,
  MapPin,
  Moon,
  Package,
  Path,
  PencilSimple,
  Plus,
  Receipt,
  Scales,
  SealCheck,
  ShieldCheck,
  ShippingContainer,
  SignOut,
  Storefront,
  Sun,
  Table,
  Tag,
  TrendUp,
  Truck,
  User,
  UsersThree,
  Warning,
  X,
} from '@phosphor-icons/react/dist/ssr'

/** The product's vocabulary. Add a role here, not a glyph at a call site. */
const ICONS = {
  // --- navigation -------------------------------------------------------
  dashboard: Gauge,
  enquiries: Envelope,
  quotes: Scales,
  jobs: Package,
  rates: Tag,
  customers: Storefront,
  partners: UsersThree,
  locations: MapPin,
  finance: Receipt,
  invoices: Receipt,
  payments: CurrencyDollar,
  admin: Gear,
  settings: Gear,
  users: UsersThree,
  branches: Buildings,
  reference: Table,
  audit: ClockCounterClockwise,
  tracking: Path,
  customs: ShieldCheck,

  // --- transport modes --------------------------------------------------
  ship: Boat,
  plane: Airplane,
  truck: Truck,
  courier: Package,
  container: ShippingContainer,

  // --- state ------------------------------------------------------------
  clock: Clock,
  alert: Warning,
  hold: ShieldCheck,
  check: Check,
  dot: Circle,
  document: FileText,
  calendar: CalendarBlank,
  trend: TrendUp,
  chart: ChartLineUp,
  anchor: Anchor,
  sealed: SealCheck,
  live: Lightning,

  // --- controls ---------------------------------------------------------
  search: MagnifyingGlass,
  filter: FunnelSimple,
  'chevron-end': CaretRight,
  'chevron-down': CaretDown,
  'arrow-end': ArrowRight,
  'arrow-up-end': ArrowUpRight,
  'arrow-down-end': ArrowRight,
  globe: Globe,
  sun: Sun,
  moon: Moon,
  user: User,
  bell: Bell,
  download: DownloadSimple,
  external: ArrowSquareOut,
  'sign-out': SignOut,
  /** The assistant. A role, not a glyph — see the header. */
  assistant: Sparkle,
  close: X,
  menu: List,
  plus: Plus,
  more: DotsThree,
  expand: ArrowsOutSimple,
  collapse: ArrowsInSimple,
  edit: PencilSimple,
} as const satisfies Record<string, PhosphorIcon>

export type IconName = keyof typeof ICONS

/** Glyphs whose meaning depends on reading direction. */
const MIRRORED = new Set<IconName>([
  'chevron-end',
  'arrow-end',
  'arrow-up-end',
  'arrow-down-end',
  'sign-out',
  'external',
  'tracking',
])

type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'

export interface IconProps {
  readonly name: IconName
  readonly size?: number
  readonly className?: string
  /**
   * Phosphor's stroke weight.
   *
   * `regular` is the default and is right for body-adjacent glyphs. `duotone`
   * is used for the icons that head a card or a nav section, where a flat
   * outline reads as a placeholder; `fill` is for the small status bullets
   * that need to hold their colour at 8px.
   */
  readonly weight?: IconWeight
  /**
   * Accepted for compatibility with the hand-drawn set this replaced, and
   * mapped onto Phosphor's weights: anything heavier than a hairline becomes
   * `bold`. New code should pass `weight` instead.
   */
  readonly strokeWidth?: number
  readonly 'aria-hidden'?: boolean
}

export function Icon({ name, size = 18, className, weight, strokeWidth, ...rest }: IconProps) {
  const Glyph = ICONS[name]
  const resolved: IconWeight =
    weight ?? (strokeWidth !== undefined && strokeWidth >= 2.2 ? 'bold' : 'regular')

  const classes = [MIRRORED.has(name) ? 'rtl:-scale-x-100' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <Glyph
      size={size}
      weight={name === 'dot' ? 'fill' : resolved}
      className={classes || undefined}
      aria-hidden
      {...rest}
    />
  )
}

/** The glyph for a transport mode — one mapping, every screen. */
export function modeIcon(mode: string): IconName {
  switch (mode) {
    case 'air':
      return 'plane'
    case 'sea_fcl':
    case 'sea_lcl':
      return 'ship'
    case 'land':
      return 'truck'
    case 'courier':
      return 'courier'
    default:
      return 'container'
  }
}
