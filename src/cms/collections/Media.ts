import type { CollectionConfig } from 'payload'

/**
 * Covers and images. Stored on disk under `MEDIA_DIR` (a Coolify volume in
 * production, so a redeploy keeps them) and served by Payload at
 * `/api/media/file/<name>`. Re-encoded to WebP once at upload; the site's
 * images are `unoptimized`, so there is no second lossy pass.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'Content' },
  access: { read: () => true },
  upload: {
    staticDir: process.env.MEDIA_DIR ?? 'media',
    mimeTypes: ['image/*'],
    formatOptions: { format: 'webp', options: { quality: 85 } },
  },
  fields: [{ name: 'alt', type: 'text', localized: true }],
}
