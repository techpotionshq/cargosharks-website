import type { CollectionConfig } from 'payload'

/**
 * The backlog the generator drafts from, oldest `ready` first. Was
 * `scripts/blog/topics.json` and a pull request per change; now an admin edits
 * it here. Set a topic to `rejected` to stop it ever being drafted.
 */
export const Topics: CollectionConfig = {
  slug: 'topics',
  admin: {
    group: 'Content',
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'archetype', 'updatedAt'],
  },
  access: { read: ({ req }) => Boolean(req.user) },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'key',
      type: 'text',
      unique: true,
      index: true,
      admin: { description: 'Stable id, used for de-duplication.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'ready',
      options: ['ready', 'written', 'rejected'].map((value) => ({ label: value, value })),
      admin: { position: 'sidebar' },
    },
    {
      name: 'archetype',
      type: 'select',
      required: true,
      defaultValue: 'guide',
      options: [
        'explainer',
        'guide',
        'checklist',
        'regulation',
        'comparison',
        'alternatives',
        'use-case',
      ].map((value) => ({ label: value, value })),
    },
    { name: 'targetQuery', type: 'text', required: true },
    { name: 'audience', type: 'text' },
    { name: 'angle', type: 'textarea' },
    {
      name: 'expertNote',
      type: 'textarea',
      admin: {
        description:
          'First-hand detail the model cannot invent. Required for comparison, alternatives and use-case topics, which are skipped without it.',
      },
    },
    { name: 'keywords', type: 'text', hasMany: true },
    { name: 'internalLinks', type: 'text', hasMany: true },
    { name: 'post', type: 'relationship', relationTo: 'posts', admin: { position: 'sidebar' } },
  ],
}
