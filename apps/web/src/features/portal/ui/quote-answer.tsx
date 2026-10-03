/**
 * Accept or decline: the customer's two answers to a sent quotation (D12).
 *
 * Rendered only while the offer stands: sent, current, and inside its
 * validity day. The server checks all three again under the customer's own
 * policy, so a stale tab that still shows the buttons gets a sentence, not a
 * second decision.
 */

import { getTranslations } from 'next-intl/server'
import { RecordDialog } from '@/ui/record-dialog'
import { decidePortalQuote } from '../form-actions'

export async function PortalQuoteAnswer({
  quoteId,
  reference,
}: {
  readonly quoteId: string
  readonly reference: string
}) {
  const [t, tc] = await Promise.all([getTranslations('portalQuotes'), getTranslations('common')])

  return (
    <>
      {/* Declining is a normal answer, not a destructive act: secondary, not red. */}
      <RecordDialog
        action={decidePortalQuote}
        icon="close"
        size="sm"
        variant="secondary"
        submitIcon="close"
        fields={[
          { kind: 'hidden', name: 'quoteId', value: quoteId },
          { kind: 'hidden', name: 'decision', value: 'rejected' },
          {
            kind: 'textarea',
            name: 'reason',
            label: t('decline.reason'),
            placeholder: t('decline.placeholder'),
            rows: 3,
          },
        ]}
        labels={{
          open: t('decline.open'),
          title: t('decline.title', { reference }),
          description: t('decline.description'),
          submit: t('decline.submit'),
          submitting: tc('saving'),
          cancel: tc('cancel'),
          success: t('decline.done'),
        }}
      />
      <RecordDialog
        action={decidePortalQuote}
        icon="check"
        size="sm"
        variant="primary"
        submitIcon="check"
        fields={[
          { kind: 'hidden', name: 'quoteId', value: quoteId },
          { kind: 'hidden', name: 'decision', value: 'accepted' },
          { kind: 'note', text: t('accept.note'), tone: 'info' },
        ]}
        labels={{
          open: t('accept.open'),
          title: t('accept.title', { reference }),
          description: t('accept.description'),
          submit: t('accept.submit'),
          submitting: tc('saving'),
          cancel: tc('cancel'),
          success: t('accept.done'),
        }}
      />
    </>
  )
}
