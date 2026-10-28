import type { CollectionConfig } from 'payload'

/**
 * Demo requests from the site's form (`src/app/contact/route.ts`).
 *
 * It replaced a mailto link: a reader without a mail client configured, which
 * is most people on a work laptop that is not their own, clicked the button
 * and nothing happened. Now the request is a row here and a Slack message,
 * and the admin tracks it through to an answer. The form's qualifying answers
 * are written at the top of `message` (see the route) until they settle.
 *
 * Nobody but a signed-in admin reads or writes these. The public route creates
 * them through the local API, so `create` is closed here too.
 */
export const Leads: CollectionConfig = {
  slug: 'leads',
  admin: {
    group: 'Sales',
    useAsTitle: 'company',
    defaultColumns: ['company', 'name', 'country', 'volume', 'status', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'company', type: 'text', required: true },
    { name: 'email', type: 'email', required: true },
    { name: 'phone', type: 'text', admin: { description: 'Phone or WhatsApp, as typed.' } },
    {
      name: 'country',
      type: 'select',
      options: ['Kuwait', 'UAE', 'Saudi Arabia', 'Bahrain', 'Oman', 'Qatar', 'Other'].map(
        (value) => ({
          label: value,
          value,
        }),
      ),
    },
    {
      name: 'volume',
      type: 'select',
      label: 'Shipments a month',
      options: ['Under 50', '50-200', '200-1,000', 'Over 1,000'].map((value) => ({
        label: value,
        value,
      })),
    },
    { name: 'message', type: 'textarea' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'new',
      options: ['new', 'contacted', 'pilot', 'won', 'lost'].map((value) => ({
        label: value,
        value,
      })),
      admin: { position: 'sidebar' },
    },
    { name: 'lang', type: 'text', admin: { position: 'sidebar', readOnly: true } },
    {
      name: 'page',
      type: 'text',
      admin: { position: 'sidebar', readOnly: true, description: 'Where the form was sent from.' },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'Internal, never shown to the lead.' },
    },
  ],
}
