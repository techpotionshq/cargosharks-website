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
export * from './clocks'
export * from './states'
