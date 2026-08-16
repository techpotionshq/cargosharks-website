/**
 * Environment loading for workspace scripts.
 *
 * `import 'dotenv/config'` reads `.env` from the *current working directory*,
 * which for `pnpm --filter @qabandi/db migrate` is `packages/db` — so a
 * connection string at the workspace root is invisible to exactly the commands
 * that need it. This walks up to the root and loads what it finds there.
 *
 * Precedence follows the Next.js convention, so one mental model covers both
 * applications and scripts: `.env.local` beats `.env`, and anything already in
 * the real environment beats both. That last part matters in CI, where the
 * connection strings come from the workflow rather than a file.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'

/** Walks up from this file until it finds the pnpm workspace manifest. */
export function workspaceRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  let current = resolve(from)
  for (let depth = 0; depth < 10; depth++) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return process.cwd()
}

let loaded = false

export function loadEnv(): void {
  if (loaded) return
  loaded = true

  const root = workspaceRoot()
  // Loaded in order; dotenv never overwrites a variable that is already set,
  // so the first file to define a key wins and the real environment wins over
  // every file.
  //
  // The `turbopackIgnore` markers matter for the Next build. Turbopack traces
  // dynamic filesystem access to decide what to bundle, and a `join` it cannot
  // resolve statically makes it conservatively trace *the whole workspace* into
  // the server output — every source file and the public folder shipped as
  // server code. These paths are resolved at run time from the real filesystem
  // and are never bundled, so opting out is correct rather than a silencer.
  for (const file of ['.env.local', '.env']) {
    const path = join(/* turbopackIgnore: true */ root, file)
    if (existsSync(/* turbopackIgnore: true */ path)) loadDotenv({ path, quiet: true })
  }
}
