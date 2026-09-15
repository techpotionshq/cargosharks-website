/**
 * Resolving an integration: the row first, the environment beneath it.
 *
 * One function, used by both applications and by `pnpm doctor`, because the
 * precedence rule is the thing that must not be implemented twice. A screen
 * that reported "set in the environment" while the service was reading a row
 * would be worse than no screen at all — it would be a confident wrong answer
 * to the only question anybody asks of a settings page.
 *
 * ## The rule
 *
 *   1. a value on the `integration_settings` row wins;
 *   2. otherwise the environment variable the catalogue names;
 *   3. otherwise nothing, and `required` fields report themselves missing.
 *
 * An *inactive* row is skipped entirely and the environment answers, which is
 * what makes deactivating a row a rollback rather than a wipe.
 *
 * ## Secrets are never opened here
 *
 * This module returns ciphertext and a presence flag, never a plaintext
 * credential. `apps/web` imports it to render a settings screen and must not
 * be able to read a key back out even by accident; `apps/service` opens what
 * it needs with `openSecret` at the point of use. The split is the same one
 * `mailboxes` draws by simply never selecting `password_sealed`.
 */

import { eq } from 'drizzle-orm'
import { INTEGRATIONS, integrationSpec, isLiveDriver, type IntegrationSpec } from '@qabandi/core'
import type { Tx } from './actor'
import { integrationSettings, type IntegrationSettings } from './schema/settings'

/** Every column, named once — three readers here select exactly the same set. */
const COLUMNS = {
  id: integrationSettings.id,
  key: integrationSettings.key,
  driver: integrationSettings.driver,
  settings: integrationSettings.settings,
  secrets: integrationSettings.secrets,
  isActive: integrationSettings.isActive,
  lastCheckedAt: integrationSettings.lastCheckedAt,
  lastOkAt: integrationSettings.lastOkAt,
  lastError: integrationSettings.lastError,
  createdAt: integrationSettings.createdAt,
  updatedAt: integrationSettings.updatedAt,
}

/** Where a value came from — shown on the screen, and the whole point of it. */
export type SettingSource = 'row' | 'env' | 'unset'

export interface ResolvedIntegration {
  readonly key: string
  readonly spec: IntegrationSpec
  /** The chosen driver, or the catalogue default where neither layer sets one. */
  readonly driver: string | undefined
  readonly driverSource: SettingSource
  /** Whether the chosen driver is one that needs its required fields filled. */
  readonly live: boolean
  /** Non-secret values as strings — the caller coerces. */
  readonly settings: Readonly<Record<string, string | undefined>>
  readonly sources: Readonly<Record<string, SettingSource>>
  /** Sealed ciphertext per secret name, where a row supplies one. */
  readonly sealed: Readonly<Record<string, string | undefined>>
  /** Whether a secret has a value at all, from either layer. Safe to render. */
  readonly hasSecret: Readonly<Record<string, boolean>>
  /** Required fields and secrets with no value in either layer. */
  readonly missing: readonly string[]
  readonly isActive: boolean
  readonly lastCheckedAt: Date | null
  readonly lastOkAt: Date | null
  readonly lastError: string | null
}

/**
 * A row's stored value as a string, or undefined when it is absent or blank.
 *
 * Blank is unset, deliberately, and it is the same reasoning `blankIsUnset` in
 * the service config was written for: a form posts empty strings for fields
 * nobody touched, and treating one as a value means an empty string wins over
 * the environment default it was supposed to fall through to.
 */
function stored(settings: Record<string, unknown> | null, name: string): string | undefined {
  const value = settings?.[name]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = String(value).trim()
  return text === '' ? undefined : text
}

function fromEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim()
  return value === undefined || value === '' ? undefined : value
}

/**
 * Merge one integration's row over the environment.
 *
 * `row` may be undefined — a deployment that has never opened the settings
 * screen has no rows at all, and every integration must still resolve to
 * exactly what the environment said.
 */
export function resolveIntegration(
  spec: IntegrationSpec,
  row?: IntegrationSettings,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedIntegration {
  // An inactive row answers nothing; the environment does. Deactivating is how
  // a change is rolled back without losing what was configured.
  const active = row?.isActive !== false ? row : undefined

  const driverFromRow = active?.driver?.trim() || undefined
  const driverFromEnv = spec.driverEnv ? fromEnv(env, spec.driverEnv) : undefined
  const driver = driverFromRow ?? driverFromEnv ?? spec.defaultDriver
  const driverSource: SettingSource = driverFromRow ? 'row' : driverFromEnv ? 'env' : 'unset'

  const settings: Record<string, string | undefined> = {}
  const sources: Record<string, SettingSource> = {}
  const sealed: Record<string, string | undefined> = {}
  const hasSecret: Record<string, boolean> = {}
  const missing: string[] = []

  const live = isLiveDriver(spec, driver)

  for (const field of spec.fields) {
    const rowValue = stored(active?.settings ?? null, field.name)
    const envValue = fromEnv(env, field.env)
    settings[field.name] = rowValue ?? envValue
    sources[field.name] = rowValue !== undefined ? 'row' : envValue !== undefined ? 'env' : 'unset'
    if (live && field.required && settings[field.name] === undefined) missing.push(field.name)
  }

  for (const secret of spec.secrets) {
    const rowValue = stored(active?.secrets ?? null, secret.name)
    sealed[secret.name] = rowValue
    hasSecret[secret.name] = rowValue !== undefined || fromEnv(env, secret.env) !== undefined
    if (live && secret.required && !hasSecret[secret.name]) missing.push(secret.name)
  }

  return {
    key: spec.key,
    spec,
    driver,
    driverSource,
    live,
    settings,
    sources,
    sealed,
    hasSecret,
    missing,
    isActive: row?.isActive ?? true,
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastOkAt: row?.lastOkAt ?? null,
    lastError: row?.lastError ?? null,
  }
}

/**
 * Every integration, resolved. Rows the catalogue does not name are ignored.
 *
 * Ignored rather than an error, because the two ways it happens are both
 * benign and both temporary: a downgrade that removes an integration the
 * previous release wrote a row for, and a rolling deploy where one instance is
 * a version behind. Neither is worth refusing to resolve the other nine over.
 */
export async function resolveIntegrations(
  tx: Tx,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Map<string, ResolvedIntegration>> {
  const rows = await tx.select(COLUMNS).from(integrationSettings)
  const byKey = new Map(rows.map((row) => [row.key, row]))

  return new Map(
    INTEGRATIONS.map((spec) => [spec.key, resolveIntegration(spec, byKey.get(spec.key), env)]),
  )
}

/**
 * The same read with the secrets left behind.
 *
 * `apps/web` uses this. It is a separate function rather than a flag because a
 * flag defaulting the wrong way is how a credential reaches a browser, and a
 * call site that has to name what it wants cannot get it by omission.
 */
export function withoutSealed(resolved: ResolvedIntegration): ResolvedIntegration {
  return { ...resolved, sealed: {} }
}

export { integrationSpec, INTEGRATIONS }

/** The single-row read, for a screen or a probe that wants one integration. */
export async function readIntegrationRow(
  tx: Tx,
  key: string,
): Promise<IntegrationSettings | undefined> {
  const [row] = await tx
    .select(COLUMNS)
    .from(integrationSettings)
    .where(eq(integrationSettings.key, key))
    .limit(1)

  return row
}
