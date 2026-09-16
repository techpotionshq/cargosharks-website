/**
 * The in-app channel — FR-NT-02's third channel, the one with no outside.
 *
 * Every other channel hands a message to a system this application does not
 * own: a mail relay, WhatsApp. `send` is the moment it leaves, and it can be
 * refused. In-app has neither. The `notification_deliveries` row *is* the
 * notification, waiting in the recipient's own inbox for the topbar bell to
 * read — so there is nothing to transmit and nothing that can bounce, and
 * `send` accepts the instant it is called.
 *
 * ## The wording is not carried through here
 *
 * The inbox renders the template against the event payload at read time
 * (`features/notifications/queries.ts`), for the same reason the dispatcher
 * never stores rendered text: a `body` this adapter received and dropped on
 * the floor would only be a second, staler copy of what the screen already
 * builds. That is what lets the delivery row stay as it is — no
 * rendered-subject column — and it is why this adapter ignores `message`.
 *
 * Registering it is also what makes the dispatcher fan an event out to in-app
 * at all: pass one builds a delivery per *registered* channel, so without this
 * the `in_app` templates would sit in the seed with nothing ever resolving
 * them.
 */

import { randomUUID } from 'node:crypto'
import type { NotificationChannel, OutboundMessage, SendResult } from '../ports/index'

export const inAppChannel: NotificationChannel = {
  key: 'in_app',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(_message: OutboundMessage): Promise<SendResult> {
    // Delivered the moment the row exists. The `externalRef` is only so the
    // delivery log carries the same shape it has for every other channel; no
    // provider webhook will ever match it back.
    return Promise.resolve({ accepted: true, externalRef: `in_app:${randomUUID()}` })
  },
}
