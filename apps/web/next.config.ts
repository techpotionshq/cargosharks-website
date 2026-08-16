import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { loadEnv } from '@qabandi/db'

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
  experimental: {
    // Server Actions are the only mutation path; nothing posts to an API route.
    serverActions: { bodySizeLimit: '10mb' },
  },
  typedRoutes: true,
  serverExternalPackages: ['pg', 'pg-boss'],

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
