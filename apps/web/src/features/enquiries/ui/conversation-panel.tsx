/**
 * The conversation with the customer, on the enquiry screen (D5).
 *
 * The customer's WhatsApp or email thread, oldest first, with what we sent back
 * in among it: the agent's replies, the automatic acknowledgement, and anything
 * a member of staff wrote, from here or from their own phone. Then a box to
 * answer in, on the channel the customer used.
 *
 * ## Reading it
 *
 * The customer's messages sit at the inline start and ours at the inline end,
 * the way every messaging app the coordinator uses lays a thread out, and both
 * flip with the page in Arabic. Every outbound message says who wrote it, the
 * agent or a named person, because "did the bot say that, or did Fatima?" is
 * the first question asked of a thread a customer complains about.
 *
 * Bodies are text, never markup: React escapes them, `whitespace-pre-wrap`
 * keeps the customer's line breaks, and `dir="auto"` gives an Arabic message
 * its own direction on an English page. An email's quoted history is folded
 * under a disclosure (`splitQuotedHistory`), so a five-message thread reads as
 * five messages and not as a pyramid of repeats.
 *
 * ## Answering
 *
 * The box is offered where there is somewhere to send it and the reader may
 * (`enquiry.assign` in the branch). On WhatsApp it warns before a send Meta is
 * going to refuse: more than 24 hours after the customer's last message only
 * an approved template may reopen the conversation.
 *
 * Renders nothing on an enquiry with no messages and nobody to answer, which is
 * an enquiry somebody typed in from a phone call.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { splitQuotedHistory } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { canIn } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Icon } from '@/ui/icon'
import { enquiryConversation } from '../conversation'
import { ReplyForm } from './reply-form'
import type { ConversationMessageLike } from '@/lib/pilot/types'

/** Meta's customer-service window: free text only this long after the customer wrote. */
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000

export async function ConversationPanel({ enquiryId }: { readonly enquiryId: string }) {
  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const [conversation, t, timeZone] = await Promise.all([
    enquiryConversation(session.actor, enquiryId, locale),
    getTranslations('conversation'),
    getTimeZone(),
  ])
  if (!conversation) return null
  if (conversation.messages.length === 0 && !conversation.replyChannel) return null

  const canReply =
    conversation.replyChannel !== null && canIn(session, 'enquiry.assign', conversation.branchId)
  const windowClosed =
    conversation.replyChannel === 'whatsapp' &&
    (!conversation.lastInboundAt ||
      Date.now() - conversation.lastInboundAt.getTime() > WHATSAPP_WINDOW_MS)

  const channelName = (channel: ConversationMessageLike['channel']) =>
    channel === 'whatsapp'
      ? t('channels.whatsapp')
      : channel === 'email'
        ? t('channels.email')
        : t('channels.other')

  const description = conversation.replyChannel
    ? t('description', {
        count: conversation.messages.length,
        channel: channelName(conversation.replyChannel),
      })
    : t('descriptionNoReply', { count: conversation.messages.length })

  return (
    <Card className="mb-4" padding="none">
      <div className="px-4 pt-4 pb-2">
        <CardHeader icon="conversation" title={t('title')} description={description} />
      </div>

      {conversation.messages.length > 0 ? (
        <ol className="@container flex flex-col gap-3 border-t border-line px-4 py-4">
          {conversation.messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              when={formatDateTime(message.at, locale, timeZone)}
              labels={{
                channel: channelName(message.channel),
                from: authorLabel(t, message),
                partnerNote: t('partnerNote'),
                showQuoted: t('showQuoted'),
                attachments: t('attachments'),
                noFile: t('noFile'),
              }}
            />
          ))}
        </ol>
      ) : (
        <p className="border-t border-line px-4 py-3 text-body-sm text-ink-muted">{t('empty')}</p>
      )}

      {canReply ? (
        <div className="border-t border-line px-4 py-4">
          {windowClosed ? (
            <p className="mb-3 flex items-start gap-2 rounded-sm bg-caution-soft px-3 py-2 text-body-sm text-ink">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-caution" />
              <span>{t('windowWarning')}</span>
            </p>
          ) : null}
          <ReplyForm
            enquiryId={enquiryId}
            labels={{
              field: t('replyLabel'),
              placeholder: t('replyPlaceholder'),
              hint: t('replyHint', {
                channel: channelName(conversation.replyChannel ?? 'other'),
                // Isolated left-to-right, or an Arabic sentence reverses the
                // groups of a phone number ("0142 6555 +965").
                to: `\u2066${conversation.replyTo ?? ''}\u2069`,
              }),
              send: t('send'),
              sending: t('sending'),
              sent: t('sent'),
            }}
          />
        </div>
      ) : conversation.replyRefused && canIn(session, 'enquiry.assign', conversation.branchId) ? (
        <p className="border-t border-line px-4 py-3 text-body-sm text-ink-muted">
          {t('notCustomer')}
        </p>
      ) : null}
    </Card>
  )
}

function authorLabel(
  t: Awaited<ReturnType<typeof getTranslations<'conversation'>>>,
  message: ConversationMessageLike,
): string {
  if (message.author === 'customer') return t('fromCustomer')
  if (message.author === 'partner') {
    return message.authorName
      ? t('fromPartner', { name: message.authorName })
      : t('fromPartnerUnnamed')
  }
  if (message.author === 'agent') return t('byAgent')
  if (message.authorName) return t('byStaff', { name: message.authorName })
  return t('byStaffOutside')
}

function MessageItem({
  message,
  when,
  labels,
}: {
  readonly message: ConversationMessageLike
  readonly when: string
  readonly labels: {
    readonly channel: string
    readonly from: string
    readonly partnerNote: string
    readonly showQuoted: string
    readonly attachments: string
    readonly noFile: string
  }
}) {
  const outbound = message.direction === 'outbound'
  const partner = message.author === 'partner'
  // Only email carries a quoted history worth folding; a WhatsApp ">" is the customer's own.
  const split =
    message.channel === 'email'
      ? splitQuotedHistory(message.body)
      : { body: message.body, quoted: null }

  return (
    <li
      className={`flex min-w-0 flex-col gap-1 ${
        outbound ? 'ms-auto items-end' : 'me-auto items-start'
      } w-full @2xl:w-auto @2xl:max-w-[80%]`}
    >
      <div
        className={`flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-micro text-ink-subtle ${
          outbound ? 'justify-end' : ''
        }`}
      >
        <span className="font-medium text-ink-muted">{labels.from}</span>
        {message.direction === 'inbound' && message.fromAddress ? (
          <span dir="ltr" className="break-all">
            {message.fromAddress}
          </span>
        ) : null}
        <span>·</span>
        <span>{labels.channel}</span>
        <span>·</span>
        <time dateTime={message.at.toISOString()}>{when}</time>
      </div>
      <div
        className={`max-w-full min-w-0 rounded-card border px-3 py-2 ${
          outbound
            ? 'border-brand/20 bg-brand-soft'
            : partner
              ? 'border-caution/30 bg-caution-soft'
              : 'border-line bg-surface-sunken'
        }`}
      >
        {partner ? (
          /*
            Buy prices are internal. Staff need to read them here, beside the
            customer's words, but never mistake them for the customer's, and
            no customer-facing surface reads this table.
          */
          <p className="mb-1 flex items-center gap-1.5 text-caption font-medium text-caution">
            <Icon name="alert" size={14} className="shrink-0" />
            <span>{labels.partnerNote}</span>
          </p>
        ) : null}
        {message.subject && message.channel === 'email' ? (
          <p className="mb-1 text-body-sm font-semibold break-words text-ink" dir="auto">
            {message.subject}
          </p>
        ) : null}
        <p className="text-body-sm break-words whitespace-pre-wrap text-ink" dir="auto">
          {split.body}
        </p>
        {split.quoted ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-caption text-ink-muted hover:text-ink">
              {labels.showQuoted}
            </summary>
            <p
              className="mt-1 border-s-2 border-line ps-2 text-caption break-words whitespace-pre-wrap text-ink-muted"
              dir="auto"
            >
              {split.quoted}
            </p>
          </details>
        ) : null}
        {message.attachments.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={labels.attachments}>
            {message.attachments.map((file, index) => (
              <li key={file.assetId ?? `${file.fileName}-${index}`} className="max-w-full">
                {file.assetId ? (
                  <a
                    href={`/api/assets/${file.assetId}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line bg-surface px-2 py-1 text-caption text-ink hover:bg-surface-sunken"
                  >
                    <Icon name="attachment" size={14} className="shrink-0" />
                    <span className="truncate" dir="auto">
                      {file.fileName}
                    </span>
                  </a>
                ) : (
                  <span
                    className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-dashed border-line px-2 py-1 text-caption text-ink-muted"
                    title={labels.noFile}
                  >
                    <Icon name="attachment" size={14} className="shrink-0" />
                    <span className="truncate" dir="auto">
                      {file.fileName}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}
