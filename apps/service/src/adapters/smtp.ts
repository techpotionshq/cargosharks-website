/**
 * The SMTP wire protocol — the half of the email channel with no policy in it.
 *
 * `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` have
 * been in `config.ts` since Release One and read by nothing. `registerChannel`
 * in the dispatcher held an empty map, so every notification the system raised
 * resolved no adapter and was recorded as `failed: no adapter` against a
 * recipient who was never told anything. This is the missing implementation.
 *
 * ## Why the protocol is spoken here rather than by a library
 *
 * The same argument `s3.ts` makes. SMTP submission is six verbs — EHLO,
 * STARTTLS, AUTH, MAIL, RCPT, DATA — and the MIME this product needs is one
 * body part, or one body part and an attachment. What a mail library adds on
 * top of that is a plugin surface, an OAuth stack and a template engine, none
 * of which are wanted, and it takes over the two decisions that actually
 * matter here: whether credentials may cross an unencrypted socket, and how a
 * non-Latin subject line is encoded.
 *
 * Both of those are wrong by default almost everywhere, and both are settled
 * explicitly below.
 *
 * ## Arabic is not an edge case in this product
 *
 * Half the notifications this sends are Arabic (NFR-01, FR-NT-03). A subject
 * header is ASCII by definition, so an Arabic subject *must* be RFC 2047
 * encoded or it arrives as mojibake in every client — and the encoding is
 * per-word with a 75-character limit that has to split on character
 * boundaries, because splitting a UTF-8 sequence in half produces a replacement
 * character in the middle of a customer's own language. `encodeHeader` below
 * is that, and it is why this file has a test rather than a hope.
 *
 * ## One connection per message
 *
 * Not pooled. This sends notifications for a freight desk, not a mailing list:
 * the volume is tens per day, the cost of a connection is milliseconds, and a
 * pooled connection that has gone stale behind a NAT fails the *next* message
 * rather than its own — which is the shape of bug that gets diagnosed as "email
 * sometimes doesn't work".
 */

import { createConnection, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import { randomUUID } from 'node:crypto'
import type { NotificationChannel, OutboundMessage, SendResult } from '../ports/index'

export interface SmtpOptions {
  readonly host: string
  readonly port: number
  /** Implicit TLS from the first byte — port 465. Otherwise STARTTLS. */
  readonly secure: boolean
  readonly user?: string
  readonly password?: string
  /** Envelope sender and `From:`. */
  readonly from: string
  /** Certificate verification. False is for a private CA, and nothing else. */
  readonly rejectUnauthorized?: boolean
  readonly timeoutMs?: number
}

/** Long enough for a slow relay, short enough that a worker is not wedged. */
const DEFAULT_TIMEOUT_MS = 20_000

interface Reply {
  readonly code: number
  readonly lines: readonly string[]
}

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'SmtpError'
  }
}

/**
 * One SMTP conversation.
 *
 * The socket is read as a stream of *replies*, not of lines, because a reply is
 * the unit the protocol is defined in: `250-PIPELINING` continues and
 * `250 SIZE` terminates, and a reader that hands back lines makes every caller
 * re-implement that rule.
 */
class SmtpSession {
  private socket: Socket | TLSSocket
  private buffer = ''
  private replies: Reply[] = []
  private waiting: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null
  private failure: Error | null = null

  private constructor(socket: Socket | TLSSocket) {
    this.socket = socket
    this.attach(socket)
  }

  /*
    Buffers, not `setEncoding('utf8')`.

    The socket is handed to `tls.connect` on upgrade, and a socket carrying a
    string decoder would hand TLS records to it as text — corrupting the
    handshake in a way that surfaces as an unrelated protocol error. Replies
    are ASCII by specification, so decoding each chunk is safe.
  */
  private attach(socket: Socket | TLSSocket): void {
    socket.on('data', (chunk: Buffer) => this.consume(chunk.toString('utf8')))
    socket.on('error', (error: Error) => this.abort(error))
    socket.on('close', () => this.abort(new SmtpError('The mail server closed the connection.')))
  }

  private abort(error: Error): void {
    this.failure ??= error
    const waiter = this.waiting
    this.waiting = null
    waiter?.reject(error)
  }

  private consume(chunk: string): void {
    this.buffer += chunk

    // A reply is complete at the first line whose fourth character is a space.
    let newline = this.buffer.indexOf('\r\n')
    let lines: string[] = []
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 2)
      lines.push(line)

      if (line.charAt(3) !== '-') {
        const code = Number.parseInt(lines[0]!.slice(0, 3), 10)
        this.deliver({ code, lines: lines.map((l) => l.slice(4)) })
        lines = []
      }
      newline = this.buffer.indexOf('\r\n')
    }

    // Any partial reply goes back on the buffer for the next chunk.
    if (lines.length) this.buffer = lines.join('\r\n') + '\r\n' + this.buffer
  }

  private deliver(reply: Reply): void {
    const waiter = this.waiting
    if (waiter) {
      this.waiting = null
      waiter.resolve(reply)
    } else {
      this.replies.push(reply)
    }
  }

  private read(): Promise<Reply> {
    const queued = this.replies.shift()
    if (queued) return Promise.resolve(queued)
    if (this.failure) return Promise.reject(this.failure)

    return new Promise<Reply>((resolve, reject) => {
      this.waiting = { resolve, reject }
    })
  }

  /** Send a command and read its reply, insisting on an expected class. */
  async command(line: string, expect: number[]): Promise<Reply> {
    if (line) this.socket.write(line + '\r\n')
    const reply = await this.read()
    if (!expect.includes(Math.floor(reply.code / 100))) {
      throw new SmtpError(
        `The mail server rejected ${line.split(' ')[0] || 'the connection'}: ` +
          `${reply.code} ${reply.lines.join(' ')}`,
        reply.code,
      )
    }
    return reply
  }

  /** Raw write, for the message body — which is not a command. */
  write(payload: string): void {
    this.socket.write(payload)
  }

  end(): void {
    this.socket.removeAllListeners('close')
    this.socket.end()
    this.socket.destroy()
  }

  /**
   * STARTTLS: upgrade the same socket, then start again.
   *
   * `EHLO` has to be repeated after the upgrade — the extension list a server
   * advertises in the clear is not the one it honours once encrypted, and AUTH
   * in particular is routinely absent before TLS and present after. A client
   * that reuses the first list is the reason "authentication not supported"
   * appears against servers that plainly support it.
   */
  async upgrade(host: string, rejectUnauthorized: boolean): Promise<void> {
    const plain = this.socket

    /*
      Paused before the listeners come off, and that order matters.

      Removing the last `data` listener does not take a stream out of flowing
      mode — it keeps reading and discards what arrives. The discarded bytes
      here would be the server's half of the TLS handshake, and the symptom is
      a connection that hangs until the timeout with nothing in any log.
    */
    plain.pause()
    plain.removeAllListeners('data')
    plain.removeAllListeners('error')
    plain.removeAllListeners('close')

    const secured = await new Promise<TLSSocket>((resolve, reject) => {
      const tls = tlsConnect({ socket: plain, servername: host, rejectUnauthorized }, () =>
        resolve(tls),
      )
      tls.once('error', reject)
    })

    this.buffer = ''
    this.replies = []
    this.socket = secured
    this.attach(secured)
  }

  get encrypted(): boolean {
    return 'encrypted' in this.socket && this.socket.encrypted === true
  }

  static async open(options: SmtpOptions): Promise<SmtpSession> {
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const rejectUnauthorized = options.rejectUnauthorized ?? true

    const socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
      const s = options.secure
        ? tlsConnect({
            host: options.host,
            port: options.port,
            servername: options.host,
            rejectUnauthorized,
          })
        : createConnection({ host: options.host, port: options.port })

      const onReady = (): void => {
        s.setTimeout(0)
        s.removeListener('error', onError)
        resolve(s)
      }
      const onError = (error: Error): void => {
        s.destroy()
        reject(
          new SmtpError(
            `Could not reach the mail server at ${options.host}:${options.port} — ` +
              `${error.message}`,
          ),
        )
      }

      s.setTimeout(timeout, () => onError(new Error(`no response within ${timeout}ms`)))
      s.once(options.secure ? 'secureConnect' : 'connect', onReady)
      s.once('error', onError)
    })

    socket.setTimeout(timeout, () => socket.destroy(new SmtpError('The mail server timed out.')))
    return new SmtpSession(socket)
  }
}

/**
 * RFC 2047 encoded-word, for a header that is not ASCII.
 *
 * Base64 rather than quoted-printable: Arabic is two bytes per character, so
 * quoted-printable would render it as `=D8=A7=D9=84...` at three characters per
 * byte, and the result exceeds the line limit at about eight Arabic letters.
 *
 * The 75-character ceiling is per *encoded word*, and the split has to fall on
 * a character boundary — chunking the base64, or the UTF-8 bytes, cuts a
 * two-byte sequence in half and puts a replacement character in the middle of
 * the customer's own language. So the input is chunked by code point, and each
 * chunk is sized against what its own encoding will cost.
 */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value

  const prefix = '=?UTF-8?B?'
  const suffix = '?='
  /*
    The byte budget per encoded word.

    Base64 emits 4 characters per 3 bytes *and pads to a multiple of 4*, so the
    floor has to be taken on the number of whole 4-character groups that fit —
    not on the byte count afterwards. Dividing first and flooring second yields
    47 bytes, which encodes to 64 characters and produces a 76-character word:
    one over the limit, on Arabic subjects only, which is precisely the length
    at which nobody checks.
  */
  const budget = Math.floor((75 - prefix.length - suffix.length) / 4) * 3

  const words: string[] = []
  let chunk = ''
  let bytes = 0

  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > budget) {
      words.push(prefix + Buffer.from(chunk, 'utf8').toString('base64') + suffix)
      chunk = ''
      bytes = 0
    }
    chunk += character
    bytes += size
  }
  if (chunk) words.push(prefix + Buffer.from(chunk, 'utf8').toString('base64') + suffix)

  // Folded with CRLF + space: a continuation, not a second header.
  return words.join('\r\n ')
}

/**
 * Split a `From` setting into the envelope address and the header form.
 *
 * `MAIL_FROM` is a *sender*, and SMTP wants two different things from it. The
 * envelope — `MAIL FROM:<…>` — takes a bare address and nothing else, while
 * the `From:` header takes the display name too. `.env.example` ships
 * `"Al-Qabandi & Partners <no-reply@qabandi.local>"`, so a client that used
 * the setting verbatim in both places would send
 * `MAIL FROM:<Al-Qabandi & Partners <no-reply@qabandi.local>>`, which every
 * relay on earth rejects — and only on deployments that copied the example,
 * which is all of them.
 *
 * The display name is encoded rather than passed through: an Arabic-branded
 * deployment writes its own name there, and a header is ASCII.
 */
export function parseAddress(from: string): { address: string; header: string } {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from)
  const address = (angled ? angled[2]! : from).trim()
  const name = angled ? angled[1]!.replace(/^"|"$/g, '').trim() : ''

  if (!name) return { address, header: address }

  /*
    Quoted only when it has to be.

    RFC 5322 lets a display name be a run of atoms — `Al-Qabandi & Partners`
    needs no quotes — but the `specials` set does, and an unquoted comma in a
    name silently turns one recipient into two. An encoded word is never
    quoted: the quotes would be part of the decoded text.
  */
  const encoded = encodeHeader(name)
  const display =
    encoded !== name || !/[()<>[\]:;@\\,."]/.test(name)
      ? encoded
      : `"${name.replace(/(["\\])/g, '\\$1')}"`

  return { address, header: `${display} <${address}>` }
}

/** Base64, wrapped at 76 characters as the transfer encoding requires. */
function base64Lines(input: Buffer): string {
  return (input.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
}

/**
 * Dot-stuffing — the one part of DATA that silently corrupts if skipped.
 *
 * A line consisting of a single `.` terminates the message, so any body line
 * *starting* with a dot must be doubled. Body text is base64 here, which never
 * begins a line with a dot, but headers and future formats are not, and the
 * failure mode is a message truncated at the point where it happened to wrap.
 */
function stuff(payload: string): string {
  return payload.replace(/\r\n\./g, '\r\n..')
}

function buildMessage(message: OutboundMessage, from: string): string {
  const boundary = `qabandi-${randomUUID()}`
  const sender = parseAddress(from)
  const domain = sender.address.split('@')[1] ?? 'qabandi.local'
  const attachments = message.attachments ?? []

  const headers = [
    `From: ${sender.header}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject ?? '')}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    // The recipient's language, so a client that groups by locale can.
    `Content-Language: ${message.locale}`,
    'MIME-Version: 1.0',
  ]

  if (attachments.length === 0) {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64')
    return (
      headers.join('\r\n') + '\r\n\r\n' + base64Lines(Buffer.from(message.body, 'utf8')) + '\r\n'
    )
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)

  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(Buffer.from(message.body, 'utf8')),
    ].join('\r\n'),
    ...attachments.map((file) =>
      [
        `--${boundary}`,
        `Content-Type: ${file.contentType}; name="${encodeHeader(file.filename)}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${encodeHeader(file.filename)}"`,
        '',
        base64Lines(file.content),
      ].join('\r\n'),
    ),
  ]

  return headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + `\r\n--${boundary}--\r\n`
}

/** The extensions a server advertises, upper-cased, one per EHLO line. */
function extensions(reply: Reply): string[] {
  return reply.lines.slice(1).map((line) => line.trim().toUpperCase())
}

/**
 * Send one message over a fresh connection.
 *
 * Exported separately from the channel so the password-reset route can use it
 * without going near the notification outbox — that mail is not a notification,
 * has no template row and must ignore quiet hours (see `api/internal.ts`).
 */
export async function sendMail(options: SmtpOptions, message: OutboundMessage): Promise<string> {
  const session = await SmtpSession.open(options)

  try {
    await session.command('', [2])

    const hostname = 'qabandi'
    let greeting = await session.command(`EHLO ${hostname}`, [2])
    let advertised = extensions(greeting)

    if (!options.secure && advertised.some((e) => e.startsWith('STARTTLS'))) {
      await session.command('STARTTLS', [2])
      await session.upgrade(options.host, options.rejectUnauthorized ?? true)
      greeting = await session.command(`EHLO ${hostname}`, [2])
      advertised = extensions(greeting)
    }

    if (options.user && options.password) {
      /*
        Credentials never cross an unencrypted socket.

        AUTH PLAIN is base64, which is not encryption, so a server that offers
        it in the clear is offering to leak the password to anyone on the path.
        Most clients comply anyway. Refusing is the whole point of writing this
        by hand: a misconfigured relay should fail loudly at the first send,
        while someone is looking at it, rather than transmit the mailbox
        password of a freight company in reversible encoding on every
        notification for a year.
      */
      if (!session.encrypted) {
        throw new SmtpError(
          `SMTP_USER is set but ${options.host}:${options.port} offered no encryption. ` +
            'Credentials will not be sent in the clear. Use port 465 with SMTP_SECURE=true, ' +
            'or a port where the server advertises STARTTLS.',
        )
      }

      const auth = advertised.find((e) => e.startsWith('AUTH'))
      const plain = Buffer.from(`\0${options.user}\0${options.password}`, 'utf8').toString('base64')

      if (auth?.includes('PLAIN')) {
        await session.command(`AUTH PLAIN ${plain}`, [2])
      } else if (auth?.includes('LOGIN')) {
        await session.command('AUTH LOGIN', [3])
        await session.command(Buffer.from(options.user, 'utf8').toString('base64'), [3])
        await session.command(Buffer.from(options.password, 'utf8').toString('base64'), [2])
      } else {
        throw new SmtpError(
          `${options.host} advertises no authentication mechanism this client speaks ` +
            `(${auth ?? 'none offered'}). PLAIN and LOGIN are supported.`,
        )
      }
    }

    // The bare address. See `parseAddress` — the header form belongs in the
    // message, and putting it here is a rejection from every relay.
    await session.command(`MAIL FROM:<${parseAddress(options.from).address}>`, [2])
    await session.command(`RCPT TO:<${message.to}>`, [2])
    await session.command('DATA', [3])

    session.write(stuff('\r\n' + buildMessage(message, options.from)).slice(2))
    const accepted = await session.command('.', [2])

    // Most servers put a queue id in the 250 — the only handle that exists for
    // matching a bounce or a delivery receipt back to this row (FR-NT-06).
    const reference = accepted.lines.join(' ').trim()

    try {
      await session.command('QUIT', [2])
    } catch {
      // A server that drops the socket on QUIT has still accepted the message.
    }

    return reference
  } finally {
    session.end()
  }
}

/**
 * The email channel.
 *
 * `send` never throws. A delivery failure is a *recorded* outcome — the
 * dispatcher writes `failed` with the reason against the recipient, and
 * FR-NT-06 requires exactly that rather than an exception that abandons the
 * remaining recipients of the same event.
 */
export function smtpChannel(options: SmtpOptions): NotificationChannel {
  return {
    key: 'email',
    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        const externalRef = await sendMail(options, message)
        return { accepted: true, externalRef }
      } catch (error) {
        return { accepted: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

/**
 * A channel that writes the message to the service log instead of sending it.
 *
 * For a demonstration on a laptop with no mail server, and for the first hour
 * of a deployment where the relay credentials have not arrived yet. It reports
 * `accepted`, and that is deliberate: the delivery row then reads `sent`, which
 * is true — the message left the system by the route this deployment is
 * configured for. `describeAdapters` prints `email: log` at boot so nobody has
 * to infer it from an empty inbox.
 */
export function logChannel(log: (o: unknown, m: string) => void): NotificationChannel {
  return {
    key: 'email',
    send(message: OutboundMessage): Promise<SendResult> {
      log(
        { to: message.to, subject: message.subject, locale: message.locale },
        'email not sent — MAIL_DRIVER=log',
      )
      return Promise.resolve({ accepted: true, externalRef: `log:${randomUUID()}` })
    },
  }
}
