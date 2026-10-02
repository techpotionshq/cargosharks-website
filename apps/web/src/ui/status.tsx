/**
 * Status as colour — and the one place that decides which colour.
 *
 * Every status in the product maps to one of five tones here. Centralising the
 * mapping is not tidiness: an ops board where `held` is amber on one screen
 * and red on another is a board people stop trusting, and the person who
 * notices is the operations manager watching the demo (Pilot §8).
 *
 * Colour is never the only channel. Every pill carries its label, and the ones
 * that matter carry a glyph as well — a red pill is invisible to roughly one
 * man in twelve.
 */

import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'

export type Tone = 'positive' | 'caution' | 'critical' | 'info' | 'muted' | 'brand'

const PILL_CLASS: Record<Tone, string> = {
  positive: 'bg-positive-soft text-positive ring-positive/25',
  caution: 'bg-caution-soft text-caution ring-caution/25',
  critical: 'bg-critical-soft text-critical ring-critical/30',
  info: 'bg-info-soft text-info ring-info/25',
  muted: 'bg-muted-soft text-ink-muted ring-line',
  /*
    The accent, despite the name. `brand` is the tone for "new" and
    "approved" — states that want to be noticed and are not problems — and in
    the brand red they were the same pill as `lost` and `credited` beside
    them. The name stays because it is the *role* (the house highlight); the
    colour is whichever ramp can carry that role without reading as alarm.
  */
  brand: 'bg-accent-soft text-accent ring-accent/20',
}

const DOT_CLASS: Record<Tone, string> = {
  positive: 'bg-positive',
  caution: 'bg-caution',
  critical: 'bg-critical',
  info: 'bg-info',
  muted: 'bg-muted',
  brand: 'bg-accent',
}

export interface BadgeProps {
  readonly children: ReactNode
  readonly tone?: Tone
  readonly icon?: IconName
  /** A leading dot instead of a glyph — quieter, for dense table cells. */
  readonly dot?: boolean
  readonly className?: string
}

export function Badge({ children, tone = 'muted', icon, dot = false, className }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.75rem] font-medium ring-1 ring-inset whitespace-nowrap',
        PILL_CLASS[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {dot ? <span className={`size-1.5 rounded-full ${DOT_CLASS[tone]}`} /> : null}
      {icon ? <Icon name={icon} size={13} strokeWidth={2} /> : null}
      {children}
    </span>
  )
}

/** A bare dot, for timelines and legends. */
export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={['inline-block size-2 rounded-full', DOT_CLASS[tone], className]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

// --- the mappings ---------------------------------------------------------

/** `enquiry_status` — mirrors `core/states.ts`. */
export function enquiryTone(status: string): Tone {
  switch (status) {
    case 'won':
      return 'positive'
    // Arrived and untouched: news, not trouble. It was `brand`, which for a
    // red brand put every fresh enquiry in the colour of a lost one.
    case 'new':
      return 'info'
    case 'assigned':
    case 'rating':
      return 'caution'
    case 'quoted':
      return 'info'
    case 'lost':
      return 'critical'
    default:
      return 'muted'
  }
}

/** `job_status`. `on_hold` is the one that must interrupt. */
export function jobTone(status: string): Tone {
  switch (status) {
    case 'delivered':
    case 'completed':
      return 'positive'
    case 'on_hold':
      return 'critical'
    case 'customs':
    case 'arrived':
      return 'caution'
    case 'in_transit':
    case 'booked':
      return 'info'
    case 'cancelled':
    case 'closed':
    case 'draft':
      return 'muted'
    default:
      return 'muted'
  }
}

/** `customs_status` — `held` is the seeded hold the demo turns on (Pilot §3.1). */
export function customsTone(status: string): Tone {
  switch (status) {
    case 'released':
      return 'positive'
    case 'held':
      return 'critical'
    case 'inspection':
    case 'documents_pending':
      return 'caution'
    case 'declaration_filed':
    case 'assessed':
    case 'duty_paid':
      return 'info'
    default:
      return 'muted'
  }
}

export function severityTone(severity: string): Tone {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'critical'
    case 'medium':
      return 'caution'
    default:
      return 'info'
  }
}

export function quoteTone(status: string): Tone {
  switch (status) {
    case 'accepted':
      return 'positive'
    case 'sent':
      return 'info'
    case 'rejected':
    case 'expired':
      return 'critical'
    default:
      return 'muted'
  }
}

/**
 * An invoice's tone from its status.
 *
 * `part_paid` is amber rather than green: money has arrived and the ledger is
 * still open, which is a state somebody has to chase. Overdue is not a status
 * in the enum — it is a status *and* a date — so callers pass `critical`
 * themselves when the due date has gone, and this covers the rest.
 */
export function invoiceTone(status: string): Tone {
  switch (status) {
    case 'paid':
      return 'positive'
    case 'issued':
      return 'info'
    case 'approved':
      return 'brand'
    case 'part_paid':
      return 'caution'
    // Replaced by a credit note — finished business, not a fault. Red here
    // made every credited invoice look like an overdue one.
    case 'credited':
      return 'muted'
    default:
      return 'muted'
  }
}

/**
 * An SLA clock's tone from its remaining time.
 *
 * The thresholds are the point: amber at a quarter of the window left is early
 * enough to act on, and anything past due is red rather than "very amber".
 */
export function slaTone(dueAt: Date | null, respondedAt: Date | null, now: number): Tone {
  if (respondedAt) return 'positive'
  if (!dueAt) return 'muted'
  const remaining = dueAt.getTime() - now
  if (remaining < 0) return 'critical'
  if (remaining < 4 * 60 * 60 * 1000) return 'caution'
  return 'info'
}
