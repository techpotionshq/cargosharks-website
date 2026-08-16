/**
 * The schema — the only place a field is defined (§4).
 *
 * One column definition becomes the database constraint, the TypeScript type,
 * server validation, form validation, the API contract and the import
 * validator, via `drizzle-zod`. There is no DTO layer and no mapper layer,
 * because there is nothing for them to map between.
 */

export * from './table'
export * from './columns'
export * from './enums'

export * from './auth'
export * from './files'
export * from './identity'
export * from './reference'
export * from './commercial'
export * from './jobs'
export * from './finance'
export * from './comms'
export * from './audit'
