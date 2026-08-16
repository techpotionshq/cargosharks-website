/**
 * Bundles the migration runner for the container.
 *
 * The web image ships Next's standalone output — a traced `node_modules` with
 * no pnpm, no workspace and no TypeScript. `pnpm db:migrate` cannot run there,
 * and installing a second dependency tree just to apply migrations would put
 * `drizzle-orm` in the image twice at two resolutions.
 *
 * So the runner is bundled to a single self-contained file the way the service
 * is, and dropped next to a copy of the migrations folder. `migrate.ts`
 * resolves `../migrations` from its own location, so `dist/migrate.mjs` in the
 * image at `/app/db/migrate.mjs` finds `/app/migrations` and nothing else has
 * to be told where anything is.
 */

import { build } from 'esbuild'

await build({
  entryPoints: ['src/migrate.ts'],
  outfile: 'dist/migrate.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  /**
   * `pg` reaches for two things it can live without: `pg-native`, the optional
   * libpq binding, and `cloudflare:sockets`, which only resolves on Workers.
   * Both are behind a guard at run time; bundling either is impossible and
   * neither is wanted.
   */
  external: ['pg-native', 'cloudflare:sockets'],
  /**
   * Several dependencies in the graph are still CommonJS, and esbuild's interop
   * emits bare `require` calls that do not exist in an ES module. This is the
   * standard shim — without it the bundle dies on `Dynamic require of "fs" is
   * not supported` before it reads a single migration.
   */
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
})
