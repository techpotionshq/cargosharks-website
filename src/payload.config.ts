import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { ar } from '@payloadcms/translations/languages/ar'
import { en } from '@payloadcms/translations/languages/en'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { Media } from '@/cms/collections/Media'
import { Posts } from '@/cms/collections/Posts'
import { Topics } from '@/cms/collections/Topics'
import { Users } from '@/cms/collections/Users'
import { migrations } from '@/migrations'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The CMS behind the blog: Payload, in this app, at `/admin`, on its own
 * Postgres database.
 *
 * Built after techpotions.com's (techpotionshq/techpotions-website), with two
 * deliberate differences: Postgres rather than MongoDB, because everything else
 * CargoSharks runs is Postgres and lives on the same Coolify server; and post
 * bodies are Markdown rather than Lexical rich text, because the generator
 * writes Markdown and `src/lib/blog.ts` already renders it safely, with the
 * escaping and link rules its tests pin down.
 *
 * Content is localised (`en`, `ar`), not duplicated: one post, one slug, two
 * languages, which is how the site's URLs already pair `/blog/<slug>/` with
 * `/ar/blog/<slug>/`. `fallback: false` so an Arabic page never shows English
 * text and calls it Arabic.
 */
const secret =
  process.env.PAYLOAD_SECRET ??
  // `next build` evaluates this module to compile the admin routes, and the
  // image is built with no runtime secrets. Nothing is signed or verified at
  // build time, so a placeholder is safe there and refused everywhere else.
  (process.env.NEXT_PHASE === 'phase-production-build'
    ? 'build-time-placeholder-not-used-at-runtime'
    : (() => {
        throw new Error('PAYLOAD_SECRET is required')
      })())

export default buildConfig({
  secret,
  serverURL: process.env.SITE_URL ?? 'https://cargosharks.com',
  admin: {
    user: Users.slug,
    meta: { titleSuffix: ' · CargoSharks admin' },
    importMap: { baseDir: resolve(here) },
  },
  i18n: { supportedLanguages: { en, ar } },
  localization: {
    locales: [
      { code: 'en', label: 'English' },
      { code: 'ar', label: 'العربية', rtl: true },
    ],
    defaultLocale: 'en',
    fallback: false,
  },
  collections: [Posts, Topics, Media, Users],
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL ?? '' },
    migrationDir: resolve(here, 'migrations'),
    // Applied when the server starts in production, so a deploy that adds a
    // field migrates its own database. `push` stays off: it would sync the
    // schema behind the migrations' back.
    prodMigrations: migrations,
    push: false,
  }),
  sharp,
  typescript: { outputFile: resolve(here, 'payload-types.ts') },
  telemetry: false,
})
