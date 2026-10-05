/**
 * @qabandi/core — pure domain.
 *
 * Imports nothing from the rest of the repository. No I/O, no database, no
 * framework, no clock of its own: every function that needs "now" is handed
 * it. That is what lets FR-RT-03's worked examples run as millisecond unit
 * tests against no infrastructure at all.
 *
 * Dependency direction, enforced by lint: core <- db <- {web, service}.
 */

export * from './errors'
export * from './money'
export * from './chargeable'
export * from './rating'
export * from './allocation'
export * from './accounting'
export * from './margin'
export * from './matching'
export * from './netting'
export * from './settlement'
export * from './duty'
export * from './clocks'
export * from './credit'
export * from './credit-note'
export * from './states'
export * from './lockout'
export * from './notifications'
export * from './staff-notifications'
export * from './integrations'
export * from './ai'
export * from './extraction'
export * from './intake'
export * from './evaluation'
export * from './grouping'
export * from './assistant'
export * from './labels'
export * from './time'
export * from './correspondence'
export * from './thread-sides'
export * from './provider-errors'
export * from './invoice-note'
export * from './fx-guard'
export * from './overdue'

/**
 * `./import` is deliberately *not* re-exported here.
 *
 * Its cell parsers are named for what they parse — `text`, `decimal`,
 * `boolean`, `integer`, `code`, `email` — which reads correctly at the call
 * site (`text({ max: 200 })`) and disastrously in a barrel that a file also
 * importing Drizzle's `text` would pull from. Import it by path:
 *
 *     import { readImport, text } from '@qabandi/core/import'
 */
