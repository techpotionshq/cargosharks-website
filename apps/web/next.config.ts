import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { loadEnv, workspaceRoot } from '@qabandi/db'

/**
 * Next reads `.env` files relative to the *app* directory, so in this monorepo
 * the connection strings at the workspace root are invisible to `apps/web` —
 * which meant the application silently fell back to the pilot fixtures even
 * with a perfectly good database configured two directories up. The scripts in
 * `@qabandi/db` already walk up to the workspace root; the application uses the
 * same loader so both see one environment.
 *
 * It runs here rather than in a module because `next.config.ts` is evaluated
 * once, before any server code, in the Node process that serves the app.
 * Anything already in the real environment still wins.
 */
loadEnv()

/**
 * `next-intl` is wired without locale routing: the language is a property of
 * the signed-in principal (`principals.locale`), not of the URL. An operator
 * who works in Arabic does not want a different URL from their colleague, and
 * the public tracking page takes its language from a cookie.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@qabandi/brand', '@qabandi/core', '@qabandi/db'],

  /**
   * The container ships the traced output, not the workspace.
   *
   * `standalone` writes `.next/standalone` with a `server.js` and only the
   * `node_modules` the traced routes actually reach, which is what lets the
   * runtime image drop pnpm, the lockfile and every devDependency. Without it
   * the image would have to carry an installed workspace to run `next start`.
   *
   * Tracing defaults to the *app* directory, and in this monorepo that would
   * silently omit `@qabandi/core`, `@qabandi/db` and `@qabandi/brand` — they
   * are TypeScript source consumed through the workspace, two directories up.
   * The root is the same one `loadEnv` walks to, so both agree on where the
   * workspace begins rather than each hard-coding `../..`.
   */
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot(),

  /**
   * The tracer follows `@swc/helpers` into its CommonJS build and stops there,
   * so the standalone output ships `helpers/cjs` without `helpers/esm` — and
   * the server dies on its first request with `Cannot find module
   * .../@swc/helpers/esm/_interop_require_default.js`. The helpers are reached
   * through Next's own require hook rather than a static import, which is
   * precisely the shape `@vercel/nft` cannot see.
   *
   * Taking the whole package is a few kilobytes and immune to which helper the
   * next compiler release happens to emit.
   */
  outputFileTracingIncludes: {
    '/*': ['../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**'],
  },

  experimental: {
    // Server Actions are the only mutation path; nothing posts to an API route.
    serverActions: { bodySizeLimit: '10mb' },
  },
  typedRoutes: true,
  serverExternalPackages: ['pg', 'pg-boss'],

  /**
   * Hosts `next dev` may serve its scripts to, besides localhost.
   *
   * Opening the dev server through a tunnel (ngrok, for the Kapso webhook)
   * rendered pages whose client code Next then refused — "Blocked cross-origin
   * request to Next.js dev resource" — so buttons did nothing and it read as a
   * broken screen. Opt-in per developer from `.env.local`, empty by default,
   * and ignored by `next start`: production is not affected.
   */
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),

  /**
   * Administration moved out of the operations shell into `/settings`, and
   * reference data stayed behind in operations at `/reference`.
   *
   * These are permanent (308) because the old paths are not coming back and a
   * browser that caches the redirect is the desired outcome — an administrator
   * who bookmarked `/admin/audit` during the pilot should land on the audit log
   * rather than on a 404, once, and then stop asking.
   *
   * `/admin/reference` is the odd one out: it redirects *out* of the settings
   * tree rather than into it, because adding a port is operational work.
   */
  async redirects() {
    return [
      { source: '/admin', destination: '/settings', permanent: true },
      { source: '/admin/users', destination: '/settings/users', permanent: true },
      { source: '/admin/branches', destination: '/settings/branches', permanent: true },
      { source: '/admin/audit', destination: '/settings/audit', permanent: true },
      { source: '/admin/reference', destination: '/reference', permanent: true },
    ]
  },
}

export default withNextIntl(config)
