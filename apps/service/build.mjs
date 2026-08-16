/**
 * Bundles the service for the container.
 *
 * The workspace packages are TypeScript source — `@qabandi/core` and
 * `@qabandi/db` are consumed, not published — so they are bundled in.
 * Everything from npm stays external and is installed in the image, which
 * keeps `pino`'s worker threads and `pg`'s native bindings working.
 */

import { build } from 'esbuild'

/** Bundle relative imports and the workspace; leave npm packages alone. */
const externaliseNodeModules = {
  name: 'externalise-node-modules',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return null
      if (args.path.startsWith('.') || args.path.startsWith('@qabandi/')) return null
      return { path: args.path, external: true }
    })
  },
}

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  plugins: [externaliseNodeModules],
})
