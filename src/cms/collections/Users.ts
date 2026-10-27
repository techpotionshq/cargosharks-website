import type { CollectionConfig } from 'payload'

/** The people who sign in to `/admin`. The first is created on its first visit. */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: { useAsTitle: 'email', group: 'Admin' },
  fields: [{ name: 'name', type: 'text' }],
}
