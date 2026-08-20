/**
 * @qabandi/db — the data layer.
 *
 * There is no repository layer here and none is coming: Drizzle *is* the data
 * access layer, and Postgres is not swappable in this design. Wrapping it to
 * enable a migration that will never happen adds indirection with no payoff
 * (§2). Feature slices import tables and query through `withActor`.
 */

export * from './schema/index'
export * from './actor'
export { createDatabase, createPool, db, type Database, type PoolConfig } from './client'
export * from './validation'
export * from './credit'
export * from './rate-cards'
export * from './schema-version'
export {
  NOTIFICATION_TEMPLATES,
  type NotificationTemplateSeed,
} from './notification-templates'
export { loadEnv, workspaceRoot } from './env'
