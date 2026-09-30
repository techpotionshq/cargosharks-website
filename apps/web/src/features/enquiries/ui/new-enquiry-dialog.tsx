/**
 * The server half of the new-enquiry dialog.
 *
 * The dialog itself has to be a client component — it holds open state and
 * renders server-side field errors — but nothing about *loading its options*
 * or *translating its labels* needs a browser. So the split is here: this
 * component reads the reference lists and the message catalogue on the server
 * and hands the client component plain serialisable props.
 *
 * The consequence worth having is that `next-intl`'s catalogue never crosses
 * the boundary. A client component calling `useTranslations` ships the
 * messages for its whole namespace to the browser; passing the fifty strings
 * this form actually uses ships fifty strings.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { EnquiryDialog } from './enquiry-dialog'

const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const
const DIRECTIONS = ['import', 'export', 'cross_trade'] as const
const CHANNELS = ['email', 'portal', 'whatsapp', 'phone', 'walk_in'] as const

export async function NewEnquiryButton({
  variant = 'primary',
}: {
  readonly variant?: 'primary' | 'secondary'
}) {
  const session = await requireSession()

  // The permission gate is here, not inside the dialog: an operator who cannot
  // create an enquiry should not see a button that fails when they press it.
  // The server action re-checks it regardless — a hidden control is a
  // courtesy, never a boundary.
  if (!can(session, 'enquiry.assign')) return null

  const [options, t, tMode, tDirection] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('enquiryForm'),
    getTranslations('mode'),
    getTranslations('direction'),
  ])

  // The branch someone works in most of the time. With one branch there is no
  // decision to make, so it is preselected and the field becomes a
  // confirmation rather than a question.
  const defaultBranchId = [...session.branchRoles.keys()][0]

  return (
    <EnquiryDialog
      variant={variant}
      defaultBranchId={defaultBranchId}
      options={{
        branches: options.branches,
        customers: options.customers,
        locations: options.locations,
        commodities: options.commodities,
        incoterms: options.incoterms,
        people: options.people,
      }}
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description'),
        who: t('who'),
        whoHint: t('whoHint'),
        branch: t('branch'),
        customer: t('customer'),
        customerHint: t('customerHint'),
        contactName: t('contactName'),
        contactEmail: t('contactEmail'),
        channel: t('channel'),
        owner: t('owner'),
        ownerHint: t('ownerHint'),
        what: t('what'),
        mode: t('mode'),
        direction: t('direction'),
        commodity: t('commodity'),
        incoterm: t('incoterm'),
        incotermHint: t('incotermHint'),
        lane: t('lane'),
        origin: t('origin'),
        destination: t('destination'),
        readyOn: t('readyOn'),
        readyOnHint: t('readyOnHint'),
        cargo: t('cargo'),
        weight: t('weight'),
        volume: t('volume'),
        pieces: t('pieces'),
        containers: t('containers'),
        containersHint: t('containersHint'),
        dangerous: t('dangerous'),
        dangerousHint: t('dangerousHint'),
        notes: t('notes'),
        notesHint: t('notesHint'),
        submit: t('submit'),
        submitting: t('submitting'),
        cancel: t('cancel'),
        none: t('none'),
        modes: Object.fromEntries(MODES.map((mode) => [mode, tMode(mode)])),
        directions: Object.fromEntries(
          DIRECTIONS.map((direction) => [direction, tDirection(direction)]),
        ),
        channels: Object.fromEntries(
          CHANNELS.map((channel) => [channel, t(`channels.${channel}`)]),
        ),
      }}
    />
  )
}
