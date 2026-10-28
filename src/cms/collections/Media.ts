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
  fields: [
    { name: 'alt', type: 'text', localized: true },
    // Stock photos: who took it, shown under the cover as "Photo by … on
    // Pexels", and the source's own id, which the drafting run reads so it
    // never picks a photo the site already uses.
    {
      name: 'credit',
      type: 'text',
      admin: { description: 'Photographer, shown under the cover.' },
    },
    { name: 'creditUrl', type: 'text', admin: { description: 'The photo page on Pexels.' } },
    {
      name: 'sourceId',
      type: 'text',
      index: true,
      admin: { readOnly: true, description: 'e.g. pexels:12345. Set by the drafting run.' },
    },
  ],
}
