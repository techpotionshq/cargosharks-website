/**
 * IMAP — the first implementation of `InboundMailSource`.
 *
 * Al-Qabandi already has five mailboxes, one per office, and SRS §3 calls that
 * out as *"the single most telling finding — the inbox is the system of
 * record, and there are five of them"*. This reads those five rather than
 * asking anybody to move.
 *
 * ## Why a library here, when `smtp.ts` writes the protocol by hand
 *
 * `smtp.ts` argues that SMTP submission is six verbs and a mail library brings
 * a plugin surface nobody wants. Both halves of that argument fail for
 * inbound, and it is worth saying why rather than looking inconsistent.
 *
 * IMAP is not six verbs. It is a mailbox-state protocol with UID validity,
 * flag synchronisation and a dozen extensions servers negotiate at greeting;
 * `imapflow` implements RFC 3501 *and* RFC 9051 and picks between them. And
 * where outbound MIME is one body part or two — a thing this codebase
 * generates and therefore controls — inbound MIME is whatever any sender's
 * client produced: nested multiparts, `quoted-printable`, charset labels that
 * lie, and Outlook's `winmail.dat`. Writing that parser is not a weekend, and
 * getting it subtly wrong loses a customer's packing list rather than
 * producing a visible error.
 *
 * So: hand-written where the surface is small and the defaults are dangerous,
 * borrowed where the surface is enormous and well-trodden.
 *
 * ## What acknowledgement means here
 *
 * A message is flagged `\Seen` — and moved, where a mailbox is configured with
 * somewhere to move it to — only *after* the handler has returned. A handler
 * that throws leaves the message exactly as it was, so the next run collects
 * it again. That is at-least-once, and the duplicate it risks is caught
 * upstream by `inbound_webhook_events`' unique key on the `Message-ID`.
 *
 * The alternative — flag first, then work — cannot lose a duplicate but can
 * lose an enquiry, and this is a business whose enquiries are its pipeline.
 */

import { createHash } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import type { InboundAttachment, InboundMailSource, InboundMessage } from '../ports/index'

export interface ImapOptions {
  readonly host: string
  readonly port: number
  /** Implicit TLS, which is what 993 is. STARTTLS on 143 is the other one. */
  readonly secure: boolean
  readonly user: string
  readonly password: string
  readonly folder: string
  /** Where a handled message goes. Unset leaves it flagged in place. */
  readonly archiveFolder?: string
  /** Messages taken per run, per mailbox. */
  readonly batch: number
  /** Attachments above this are recorded by name and their bytes dropped. */
  readonly maxAttachmentBytes: number
}

/**
 * Long enough for a mailbox with a slow WAN in front of it, short enough that
 * a wedged server does not hold the minute's poll open into the next one.
 */
const CONNECT_TIMEOUT_MS = 15_000
const SOCKET_TIMEOUT_MS = 60_000

class ImapError extends Error {
  constructor(
    message: string,
    readonly mailbox: string,
  ) {
    super(message)
    this.name = 'ImapError'
  }
}

/** First address of a header that may be one object, several, or absent. */
function addresses(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return []
  const list = Array.isArray(field) ? field : [field]
  return list.flatMap((entry) => entry.value.map((v) => v.address ?? '').filter(Boolean))
}

/**
 * HTML down to something a person can read in a plain-text thread.
 *
 * The fallback, not the usual path: mailparser derives a text part from the
 * HTML where the sender supplied none, and its conversion is the better one.
 * This runs for what that leaves empty — messages whose only content is inside
 * a table, and the malformed HTML that a converter gives up on but a regex
 * still gets something out of.
 *
 * Deliberately crude, and the crudeness is the point: `messages.body` is text
 * and the whole system treats it as text — the notification templates render
 * `text/plain` for the same reason. Keeping the HTML would mean every screen
 * that shows a message becoming a sanitiser, and the first one that forgot
 * would be stored XSS carrying a customer's own words.
 *
 * Style and script *contents* go before the tags do. Stripping tags alone
 * leaves the CSS behind as body text, which is how a two-line enquiry arrives
 * as four hundred lines of Outlook's mso declarations.
 */
export function flattenHtml(html: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  }

  return html
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (entity) => entities[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * A stable id for a message whose sender omitted `Message-ID`.
 *
 * Rare but real — some web forms and a lot of scanner-to-email appliances send
 * without one. The id is the idempotency key, so inventing a random one would
 * make the same mail a new enquiry on every single poll, forever. Hashing the
 * parts that identify it instead means a re-poll of the same message produces
 * the same key and is correctly refused as a duplicate.
 */
/**
 * Whether the headers say a machine sent this.
 *
 * Four signals, each one a standard rather than a heuristic: `Auto-Submitted`
 * is RFC 3834 and anything but `no` means a responder; `X-Auto-Response-
 * Suppress` is Exchange saying the same; a `bulk`, `junk` or `auto_reply`
 * precedence is list and responder mail; and a bounce is sent from the empty
 * reverse path `<>` precisely so that it can never itself be bounced. A DSN
 * body (`multipart/report`) is the fifth, belt and braces for an MTA that set
 * none of the others.
 *
 * Only the adapter can read these — the worker sees an `InboundMessage`, not
 * a header map — which is why the fact crosses the port as a flag. The
 * sender-name and subject heuristics live with the other attribution rules
 * in `inbound-routing.ts`, and either side alone is enough.
 */
function automaticByHeaders(parsed: ParsedMail): boolean {
  const header = (name: string): string => headerOf(parsed, name)

  const auto = header('auto-submitted').toLowerCase()
  if (auto !== '' && auto !== 'no') return true
  if (header('x-auto-response-suppress') !== '') return true

  const precedence = header('precedence').toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk' || precedence === 'auto_reply') return true

  const returnPath = header('return-path')
  if (returnPath === '<>' || returnPath === '') {
    // An absent Return-Path is ordinary on IMAP; only the explicit null path counts.
    if (returnPath === '<>') return true
  }

  return header('content-type').toLowerCase().startsWith('multipart/report')
}

/** One header as text, whether mailparser kept it as a string or structured it. */
function headerOf(parsed: ParsedMail, name: string): string {
  const value = parsed.headers.get(name)
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  // mailparser gives structured headers as `{ value, params }`.
  const structured = value as { value?: unknown; text?: unknown }
  return String(structured.value ?? structured.text ?? '').trim()
}

/**
 * The MIME parts a bounce carries its evidence in.
 *
 * `message/delivery-status` is the machine-readable report (RFC 3464) — though
 * mailparser folds it into `text` rather than listing it, so both are read.
 * `message/rfc822` and `text/rfc822-headers` are the original message, or its
 * headers alone, which is where the `Message-ID` we sent is quoted back. The
 * `global` variants are the same thing for an SMTPUTF8 message (RFC 6533).
 */
const BOUNCE_PARTS =
  /^(message\/(rfc822|global|delivery-status|global-delivery-status|global-headers)|text\/rfc822-headers)$/i

const DAEMON_SENDERS = new Set(['mailer-daemon', 'postmaster', 'mail-daemon', 'maildaemon'])

/**
 * Which message of ours this bounce reports undeliverable, and why — FR-NT-06.
 *
 * Two shapes of bounce, because MTAs send two:
 *
 *   - a **DSN** (RFC 3464): `multipart/report; report-type=delivery-status`,
 *     with per-recipient `Action:` fields and the original attached. Postfix,
 *     Exchange, Gmail and most hosted mail send this.
 *   - a **daemon's letter**: plain text from `MAILER-DAEMON` or `postmaster`,
 *     the original quoted in the body. qmail's "failure notice" and older Exim.
 *
 * What it must never do is call a delay a failure. A DSN reporting `Action:
 * delayed` quotes the original exactly as a bounce does, and the mail usually
 * arrives an hour later — marking that row `failed` would tell an operator a
 * customer was never told something they were. So a DSN counts only when some
 * recipient's action is `failed`, and a daemon's letter only when its subject
 * does not read as a warning. An out-of-office quoting our message is neither
 * shape and is never a bounce.
 *
 * Undefined whenever the original `Message-ID` cannot be found, because a
 * failure we cannot tie to a row changes nothing downstream.
 */
export function bounceOf(parsed: ParsedMail): InboundMessage['bounceOf'] {
  const contentType = parsed.headers.get('content-type') as
    { value?: string; params?: Record<string, string> } | string | undefined
  const isReport =
    typeof contentType === 'object' &&
    contentType !== null &&
    String(contentType.value ?? '').toLowerCase() === 'multipart/report' &&
    String(contentType.params?.['report-type'] ?? '').toLowerCase() === 'delivery-status'

  const local = (parsed.from?.value[0]?.address ?? '').toLowerCase().split('@')[0] ?? ''
  const fromDaemon = DAEMON_SENDERS.has(local) || headerOf(parsed, 'x-failed-recipients') !== ''
  if (!isReport && !fromDaemon) return undefined

  const parts = parsed.attachments
    .filter((part) => BOUNCE_PARTS.test(part.contentType ?? ''))
    .map((part) => (part.content as Buffer).toString('utf8'))
  // Folded lines unfolded, so a `Diagnostic-Code` the MTA wrapped reads whole.
  const text = [parsed.text ?? '', ...parts].join('\n').replace(/\r?\n[ \t]+/g, ' ')

  const actions = [...text.matchAll(/^Action:\s*([a-z-]+)/gim)].map((m) => m[1]!.toLowerCase())
  if (actions.length > 0) {
    if (!actions.includes('failed')) return undefined
  } else if (!fromDaemon) {
    // A report with no per-recipient actions says nothing about failure.
    return undefined
  } else if (/\b(delay(ed)?|warning|will (be )?retr(y|ied))\b/i.test(parsed.subject ?? '')) {
    return undefined
  }

  /*
    The original id: from the attached original first, then from the text, and
    only then from threading headers.

    The attached part is the strongest evidence — it *is* our message. The text
    comes next because a daemon's letter quotes the original's headers inline.
    `In-Reply-To` and `References` last: few MTAs set them on a bounce, but the
    ones that do point at exactly the message that failed.
  */
  const idIn = (source: string): string | undefined =>
    /^Message-ID:\s*(<[^<>\s]+>)/im.exec(source)?.[1]
  const threaded = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references.at(-1)
      : parsed.references
    : undefined
  const messageId =
    parts.map(idIn).find(Boolean) ?? idIn(parsed.text ?? '') ?? parsed.inReplyTo ?? threaded
  if (!messageId) return undefined

  /*
    Why, in the MTA's own words, and short.

    `Diagnostic-Code` is the remote server's reply — "550 5.1.1 User unknown" —
    and is what an operator needs to tell a typo from a full mailbox. `Status`
    alone is the bare enhanced code. A daemon's letter has neither, so the first
    line carrying an SMTP reply code stands in, and failing that the subject,
    which at least says it bounced.
  */
  const diagnostic = /^Diagnostic-Code:\s*(?:[a-z-]+;\s*)?(.+)$/im.exec(text)?.[1]
  const status = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(text)?.[1]
  const replyLine = /^.*\b[45]\d\d[ -].*$/m.exec(parsed.text ?? '')?.[0]
  const reason = (diagnostic ?? (status ? `status ${status}` : undefined) ?? replyLine ?? '')
    .trim()
    .slice(0, 500)

  return {
    messageId: messageId.startsWith('<') ? messageId : `<${messageId}>`,
    reason: reason || parsed.subject?.trim() || 'returned as undeliverable',
  }
}

function synthesiseId(parsed: ParsedMail, mailbox: string): string {
  const material = [
    mailbox,
    parsed.from?.text ?? '',
    parsed.subject ?? '',
    parsed.date?.toISOString() ?? '',
    // `html` is `string | false` — mailparser says "no HTML part" with `false`.
    (parsed.text || parsed.html || '').slice(0, 2000),
  ].join('\0')

  return `synthetic-${createHash('sha256').update(material).digest('hex').slice(0, 32)}@qabandi`
}

export function toInboundMessage(
  parsed: ParsedMail,
  mailbox: string,
  maxAttachmentBytes: number,
): InboundMessage {
  const body = parsed.text?.trim()
    ? parsed.text.trim()
    : parsed.html
      ? flattenHtml(parsed.html)
      : ''

  /*
    Inline images are not attachments.

    mailparser flags a part `related` when the HTML references it by `cid` —
    which in practice is every logo in every signature block. Storing them
    would put four PNGs on the enquiry of anyone whose company has a letterhead
    and bury the packing list that actually matters underneath them.
  */
  const attachments: InboundAttachment[] = parsed.attachments
    .filter((part) => !part.related)
    .map((part) => ({
      filename: part.filename ?? 'attachment',
      contentType: part.contentType || 'application/octet-stream',
      /*
        Oversized parts keep their name and lose their bytes.

        An empty buffer rather than a dropped entry, so the message still
        records that a 90MB scan was sent and a coordinator can ask for it
        another way. Dropping the entry entirely would leave no trace of a file
        the customer believes they have supplied.
      */
      content: part.size > maxAttachmentBytes ? Buffer.alloc(0) : (part.content as Buffer),
    }))

  const references = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : [parsed.references]
    : []

  return {
    externalId: parsed.messageId ?? synthesiseId(parsed, mailbox),
    mailbox,
    from: parsed.from?.value[0]?.address ?? '',
    fromName: parsed.from?.value[0]?.name || undefined,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    subject: parsed.subject ?? '',
    body,
    receivedAt: parsed.date ?? new Date(),
    inReplyTo: parsed.inReplyTo ?? undefined,
    references,
    attachments,
    automatic: automaticByHeaders(parsed),
    bounceOf: bounceOf(parsed),
  }
}

/**
 * Each item in turn, with one item's failure costing that item and no other.
 *
 * The loop `collect` runs, pulled out so it can be tested without an IMAP
 * server. The rule it holds: a message whose handler throws is left
 * unacknowledged for the next poll, and the rest of the batch is still read.
 * Before this the first throw ended the batch — and because the failed message
 * stays unread and the search hands unseen mail back oldest first, it was
 * first in line again a minute later. One PDF that could not be stored held
 * every mail behind it until somebody configured the bucket.
 *
 * Failures come back as text, first one first, for `collect` to put in front
 * of an administrator.
 */
export async function eachIsolated<T>(
  items: readonly T[],
  step: (item: T) => Promise<void>,
): Promise<{ handled: number; failures: string[] }> {
  let handled = 0
  const failures: string[] = []

  for (const item of items) {
    try {
      await step(item)
      handled++
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  return { handled, failures }
}

/**
 * One mailbox, polled.
 *
 * A source per mailbox rather than one source over all five: a credential that
 * has expired on the Dubai account should stop Dubai's mail and not Kuwait's,
 * and a single connection that fails part-way through a list of hosts gives no
 * clean way to say which ones were done.
 */
export function imapSource(options: ImapOptions): InboundMailSource {
  return {
    key: `imap ${options.user}`,

    async collect(handler: (message: InboundMessage) => Promise<void>): Promise<number> {
      const client = new ImapFlow({
        host: options.host,
        port: options.port,
        secure: options.secure,
        auth: { user: options.user, pass: options.password },
        // imapflow logs the whole conversation through pino otherwise, which
        // at one poll a minute is a mail server's worth of noise a day — and
        // it prints the AUTH line.
        logger: false,
        connectionTimeout: CONNECT_TIMEOUT_MS,
        greetingTimeout: CONNECT_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
      })

      /*
        An `'error'` event with no listener is fatal to the whole process.

        imapflow emits one when the socket times out — including on a client
        whose `connect()` already failed and was abandoned, a minute later, long
        after this function returned. Unheard, that took the service down (and
        every worker with it) once per failed poll. The failure is already
        reported through the rejected `connect()` or the command that hit it;
        this listener only stops the echo from being fatal.
      */
      client.on('error', () => {})

      try {
        await client.connect()
      } catch (error) {
        // Cut the half-open socket now rather than leave it to time out later.
        client.close()
        throw new ImapError(
          `Could not open ${options.host}:${options.port} as ${options.user} — ` +
            `${error instanceof Error ? error.message : String(error)}`,
          options.user,
        )
      }

      let handled = 0
      let attempted = 0
      let failures: string[] = []

      try {
        const lock = await client.getMailboxLock(options.folder)

        try {
          /*
            Unseen, by UID.

            UIDs rather than sequence numbers because a sequence number is
            relative to the mailbox as it stands: a message arriving — or the
            owner deleting one — during this loop renumbers everything after
            it, and the flag would land on the wrong mail. Silently, and on
            somebody else's correspondence.
          */
          const uids = await client.search({ seen: false }, { uid: true })

          // imapflow answers `false` where the server refused the search.
          const batch = (uids || []).slice(0, options.batch)
          attempted = batch.length

          const outcome = await eachIsolated(batch, async (uid) => {
            const fetched = await client.fetchOne(String(uid), { source: true }, { uid: true })
            if (!fetched || !fetched.source) return

            const parsed = await simpleParser(fetched.source)
            const message = toInboundMessage(parsed, options.user, options.maxAttachmentBytes)

            /*
              The handler first, the flag second.

              A throw here leaves the message unflagged and unmoved, and the
              next run picks it up again. The duplicate that risks is refused
              upstream on the `Message-ID`; the alternative ordering risks an
              enquiry that no longer exists anywhere.

              `eachIsolated` catches the throw and moves on to the next
              message. It is relabelled with the `Message-ID` first, because
              that is what an administrator can search the mailbox and
              `inbound_webhook_events` for; a UID means nothing to anyone.
            */
            try {
              await handler(message)
            } catch (error) {
              throw new Error(
                `${message.externalId}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }

            await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })

            if (options.archiveFolder) {
              await client.messageMove(String(uid), options.archiveFolder, { uid: true })
            }
          })

          handled = outcome.handled
          failures = outcome.failures
        } finally {
          lock.release()
        }
      } finally {
        /*
          `logout` speaks QUIT and waits; `close` cuts the socket.

          A server that has stopped answering would hang the poll on the
          graceful path, so the fallback is not politeness — it is what stops
          one unreachable mailbox holding the worker past the next tick.
        */
        await client.logout().catch(() => client.close())
      }

      /*
        The batch is done; now say what did not get through.

        Rejecting is what puts it on `mailboxes.last_error` — the wrapper in
        `adapters/index.ts` writes any rejection there and clears it after a
        clean poll — so the mailbox reads red on the settings screen for as
        long as a message keeps failing, and clears itself on the poll after
        the cause is fixed. The messages that *were* filed are already
        flagged; rejecting afterwards cannot un-file them.

        No retry cap, deliberately. A cap would end in flagging `\Seen` a
        message nothing ever filed — losing an enquiry, the one outcome this
        adapter is built to refuse — and the retries it would save are cheap:
        one fetch and one fast failure a minute. What a cap would really buy
        is somebody noticing, and the red row, with the reason on the
        message's own receipt, is that.
      */
      if (failures.length > 0) {
        throw new ImapError(
          `${failures.length} of ${attempted} message(s) in ${options.user} could not be ` +
            `filed and stay unread for the next poll to retry. First: ${failures[0]}`,
          options.user,
        )
      }

      return handled
    },
  }
}
