/**
 * Serve MapLibre's worker from this origin — run before `next dev` and `next build`.
 *
 * MapLibre 6 no longer builds its renderer worker from a blob. It loads
 * `maplibre-gl-worker.mjs` beside its own module, found through
 * `import.meta.url` — and once Next has bundled the library into a chunk, that
 * URL points into `_next/static`, where no worker file exists. The dashboard
 * map then logs "Worker failed to load" and draws nothing.
 *
 * So the worker, and the shared module it imports, are copied into `public/`
 * under the installed version, and `ui/lane-map.tsx` points `setWorkerUrl` at
 * them. The version is in the path so a release never serves a browser the
 * previous version's cached worker against the new main thread — the two
 * exchange messages whose shape changes between versions.
 *
 * `public/maplibre/` is build output and is not committed.
 */

import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageJson = require.resolve('maplibre-gl/package.json')
const { version } = JSON.parse(readFileSync(packageJson, 'utf8'))
const dist = join(dirname(packageJson), 'dist')

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre')
// Only the installed version: an old one left here is a stale worker waiting.
rmSync(root, { recursive: true, force: true })
const target = join(root, version)
mkdirSync(target, { recursive: true })

for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(dist, file), join(target, file))
}
