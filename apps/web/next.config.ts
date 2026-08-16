import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

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
}

export default withNextIntl(config)
