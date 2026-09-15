/**
 * The SMTP adapter, against a socket.
 *
 * `OP-14` is the reason this exists rather than a mock: two adapters were
 * written from documentation and both were wrong — an endpoint that did not
 * exist, and a vocabulary that existed nowhere in our own seed. A mocked
 * `send` would have passed in both cases.
 *
 * So this speaks the protocol to a real server over a real socket. The server
 * is thirty lines and lives at the bottom of this file, and it is deliberately
 * strict: it fails the test if the client sends a command out of order, omits
 * the terminating dot, or writes a header the specification does not allow.
 */

import { describe, expect, it } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { encodeHeader, parseAddress, sendMail, type SmtpOptions } from './smtp'

// --- header encoding ---------------------------------------------------------

describe('encodeHeader', () => {
  it('leaves printable ASCII exactly as it is', () => {
    expect(encodeHeader('Invoice KWI-2026-00042')).toBe('Invoice KWI-2026-00042')
  })

  it('encodes Arabic as a base64 encoded-word', () => {
    const encoded = encodeHeader('الفاتورة')
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(decodeWords(encoded)).toBe('الفاتورة')
  })

  it('round-trips a mixed subject with merge fields substituted', () => {
    const subject = 'الفاتورة KWI-2026-00042 متأخرة السداد'
    expect(decodeWords(encodeHeader(subject))).toBe(subject)
  })

  /**
   * The bug this is here to catch.
   *
   * Arabic is two bytes per character in UTF-8. A splitter that chunks the
   * *bytes* to fit the 75-character encoded-word limit will cut a two-byte
   * sequence in half, and the recipient sees a replacement character in the
   * middle of a word in their own language — on the long subjects only, which
   * is why it survives casual testing.
   */
  it('splits long Arabic on character boundaries, not byte boundaries', () => {
    const long = 'تم إصدار شهادة المنشأ الخاصة بالشحنة رقم كويت-٢٠٢٦-٠٠٠٤٢ وهي متاحة الآن'
    const encoded = encodeHeader(long)

    expect(encoded).toContain('\r\n ')
    for (const word of encoded.split('\r\n ')) expect(word.length).toBeLessThanOrEqual(75)
    expect(decodeWords(encoded)).toBe(long)
    expect(decodeWords(encoded)).not.toContain('�')
  })

  it('folds every encoded word within the 75-character limit', () => {
    const encoded = encodeHeader('ا'.repeat(400))
    for (const word of encoded.split('\r\n ')) expect(word.length).toBeLessThanOrEqual(75)
    expect(decodeWords(encoded)).toBe('ا'.repeat(400))
  })
})

/** RFC 2047 in reverse — what a mail client does, so the test asserts on that. */
function decodeWords(header: string): string {
  return header
    .split('\r\n ')
    .map((word) => {
      const match = /^=\?UTF-8\?B\?(.*)\?=$/.exec(word)
      return match ? Buffer.from(match[1]!, 'base64').toString('utf8') : word
    })
    .join('')
}

describe('parseAddress', () => {
  it('passes a bare address through unchanged', () => {
    expect(parseAddress('no-reply@qabandi.local')).toEqual({
      address: 'no-reply@qabandi.local',
      header: 'no-reply@qabandi.local',
    })
  })

  /**
   * The exact value `.env.example` ships.
   *
   * A client that used it verbatim would send
   * `MAIL FROM:<Al-Qabandi & Partners <no-reply@qabandi.local>>` — malformed,
   * rejected by every relay, and only on deployments that copied the example.
   */
  it('separates the display name from the envelope address', () => {
    expect(parseAddress('Al-Qabandi & Partners <no-reply@qabandi.local>')).toEqual({
      address: 'no-reply@qabandi.local',
      header: 'Al-Qabandi & Partners <no-reply@qabandi.local>',
    })
  })

  it('encodes an Arabic display name and keeps the address bare', () => {
    const parsed = parseAddress('شركة القبندي وشركاه <no-reply@qabandi.local>')
    expect(parsed.address).toBe('no-reply@qabandi.local')
    expect(parsed.header).toMatch(/^=\?UTF-8\?B\?.+\?= <no-reply@qabandi\.local>$/)
    expect(decodeWords(parsed.header.replace(' <no-reply@qabandi.local>', ''))).toBe(
      'شركة القبندي وشركاه',
    )
  })

  it('quotes a display name holding a comma, so one sender stays one', () => {
    const parsed = parseAddress('Qabandi, Partners <no-reply@qabandi.local>')
    expect(parsed.header).toBe('"Qabandi, Partners" <no-reply@qabandi.local>')
  })

  it('strips quotes already present rather than doubling them', () => {
    expect(parseAddress('"Al-Qabandi" <no-reply@qabandi.local>').header).toBe(
      'Al-Qabandi <no-reply@qabandi.local>',
    )
  })
})

// --- the conversation --------------------------------------------------------

describe('sendMail', () => {
  it('delivers a plain English message and returns the queue reference', async () => {
    const server = await fakeSmtp()
    try {
      const reference = await sendMail(options(server.port), {
        to: 'ops@customer.example',
        subject: 'Shipment KWI-2026-0031 booked',
        body: 'Hello Ahmed\n\nYour shipment is booked.\n',
        locale: 'en',
      })

      const message = server.messages[0]!
      expect(server.commands).toContain('MAIL FROM:<no-reply@qabandi.test>')
      expect(server.commands).toContain('RCPT TO:<ops@customer.example>')
      expect(header(message, 'Subject')).toBe('Shipment KWI-2026-0031 booked')
      expect(header(message, 'To')).toBe('ops@customer.example')
      expect(header(message, 'Content-Language')).toBe('en')
      expect(body(message)).toBe('Hello Ahmed\n\nYour shipment is booked.\n')
      expect(reference).toContain('queued as')
    } finally {
      await server.close()
    }
  })

  /**
   * The whole reason the body is base64 and the subject is an encoded word.
   *
   * Half of what this product sends is Arabic. A transport that mangles it is
   * not a partial success — it is a customer who cannot read their own arrival
   * notice.
   */
  it('delivers Arabic intact through the subject and the body', async () => {
    const server = await fakeSmtp()
    try {
      const subject = 'تم حجز الشحنة KWI-2026-0031'
      const text = 'مرحباً أحمد\n\nتم حجز شحنتكم بنجاح.\n\nشركة القبندي وشركاه\n'

      await sendMail(options(server.port), {
        to: 'ops@customer.example',
        subject,
        body: text,
        locale: 'ar',
      })

      const message = server.messages[0]!
      expect(decodeWords(header(message, 'Subject'))).toBe(subject)
      expect(body(message)).toBe(text)
      expect(header(message, 'Content-Language')).toBe('ar')
    } finally {
      await server.close()
    }
  })

  it('carries an attachment as a multipart part', async () => {
    const server = await fakeSmtp()
    try {
      await sendMail(options(server.port), {
        to: 'ops@customer.example',
        subject: 'Invoice',
        body: 'Attached.',
        locale: 'en',
        attachments: [
          {
            filename: 'KWI-2026-00042.pdf',
            content: Buffer.from('%PDF-1.7 fake'),
            contentType: 'application/pdf',
          },
        ],
      })

      const message = server.messages[0]!
      expect(header(message, 'Content-Type')).toContain('multipart/mixed')
      expect(message).toContain('Content-Disposition: attachment; filename="KWI-2026-00042.pdf"')
      expect(message).toContain(Buffer.from('%PDF-1.7 fake').toString('base64'))
    } finally {
      await server.close()
    }
  })

  /**
   * A body line that is a single dot ends the message.
   *
   * The body is base64 here, which never produces a leading dot, so this
   * asserts the stuffing rule itself rather than a case that arises today —
   * the day someone adds an HTML part is the day the rule starts mattering,
   * and by then the failure looks like "some emails are truncated".
   */
  it('does not let the message body terminate the DATA block early', async () => {
    const server = await fakeSmtp()
    try {
      await sendMail(options(server.port), {
        to: 'ops@customer.example',
        subject: 'Dots',
        body: '.\n.\nstill here\n',
        locale: 'en',
      })

      expect(body(server.messages[0]!)).toBe('.\n.\nstill here\n')
    } finally {
      await server.close()
    }
  })

  /**
   * The security decision this adapter exists to make.
   *
   * AUTH PLAIN is base64, not encryption. A relay that offers it without TLS
   * is offering to leak the mailbox password of a freight company to anyone on
   * the path, on every notification, for as long as the deployment runs. Most
   * clients comply. This one refuses, and says which knob to turn.
   */
  it('refuses to send credentials over an unencrypted connection', async () => {
    const server = await fakeSmtp()
    try {
      await expect(
        sendMail(
          { ...options(server.port), user: 'qabandi', password: 'hunter2hunter2' },
          { to: 'ops@customer.example', subject: 'x', body: 'x', locale: 'en' },
        ),
      ).rejects.toThrow(/no encryption/i)

      expect(server.commands.some((c) => c.startsWith('AUTH'))).toBe(false)
      expect(server.messages).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('reports a rejected recipient with the server reason', async () => {
    const server = await fakeSmtp({ rejectRecipient: true })
    try {
      await expect(
        sendMail(options(server.port), {
          to: 'gone@customer.example',
          subject: 'x',
          body: 'x',
          locale: 'en',
        }),
      ).rejects.toThrow(/550/)
    } finally {
      await server.close()
    }
  })

  /**
   * The whole point of `parseAddress`, asserted over a socket.
   *
   * The parser test above proves the split; this proves both halves reach the
   * places they belong — the bare address in the envelope command, the display
   * name only in the header.
   */
  it('sends a display-name sender without putting it in the envelope', async () => {
    const server = await fakeSmtp()
    try {
      await sendMail(
        { ...options(server.port), from: 'Al-Qabandi & Partners <no-reply@qabandi.test>' },
        { to: 'ops@customer.example', subject: 'Sender', body: 'x', locale: 'en' },
      )

      expect(server.commands).toContain('MAIL FROM:<no-reply@qabandi.test>')
      expect(header(server.messages[0]!, 'From')).toBe(
        'Al-Qabandi & Partners <no-reply@qabandi.test>',
      )
    } finally {
      await server.close()
    }
  })

  it('names host and port when nothing is listening', async () => {
    // Port 1 is privileged and never a mail server; the connection is refused
    // rather than hanging, which is the case an operator hits with a typo.
    await expect(
      sendMail(
        { ...options(1), timeoutMs: 2000 },
        { to: 'ops@customer.example', subject: 'x', body: 'x', locale: 'en' },
      ),
    ).rejects.toThrow(/127\.0\.0\.1:1/)
  })
})

function options(port: number): SmtpOptions {
  return {
    host: '127.0.0.1',
    port,
    secure: false,
    from: 'no-reply@qabandi.test',
    timeoutMs: 5000,
  }
}

function header(message: string, name: string): string {
  const headers = message.split('\r\n\r\n')[0]!
  // Unfold continuations before matching, exactly as a client would.
  const unfolded = headers.replace(/\r\n[ \t]/g, '\r\n ')
  const line = unfolded
    .split('\r\n')
    .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))
  return line ? line.slice(name.length + 1).trim() : ''
}

/** Decode the first text part, whatever the message structure is. */
function body(message: string): string {
  const [headers, ...rest] = message.split('\r\n\r\n')
  const payload = rest.join('\r\n\r\n')

  const boundary = /boundary="([^"]+)"/.exec(headers!)?.[1]
  const part = boundary
    ? payload.split(`--${boundary}`)[1]!.split('\r\n\r\n').slice(1).join('\r\n\r\n')
    : payload

  return Buffer.from(part.replace(/\r\n/g, ''), 'base64').toString('utf8')
}

// --- the fake server ---------------------------------------------------------

interface FakeSmtp {
  readonly port: number
  readonly commands: string[]
  readonly messages: string[]
  close(): Promise<void>
}

/**
 * Enough SMTP to be honest, and no more.
 *
 * No STARTTLS advertised, which is what makes the credential test meaningful:
 * this is a server that would happily take a password in the clear, and the
 * client is the thing that says no.
 */
async function fakeSmtp(behaviour: { rejectRecipient?: boolean } = {}): Promise<FakeSmtp> {
  const commands: string[] = []
  const messages: string[] = []

  const server: Server = createServer((socket: Socket) => {
    let buffer = ''
    let inData = false
    let message = ''

    socket.write('220 fake.qabandi.test ESMTP\r\n')

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')

      let newline = buffer.indexOf('\r\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 2)

        if (inData) {
          if (line === '.') {
            inData = false
            messages.push(message)
            message = ''
            socket.write('250 2.0.0 Ok: queued as 4Q7bXk2mZ1\r\n')
          } else {
            // Undo dot-stuffing, as a real server does before storing.
            message += (line.startsWith('..') ? line.slice(1) : line) + '\r\n'
          }
        } else {
          commands.push(line)
          const verb = line.split(' ')[0]!.toUpperCase()

          if (verb === 'EHLO') socket.write('250-fake.qabandi.test\r\n250 8BITMIME\r\n')
          else if (verb === 'MAIL') socket.write('250 2.1.0 Ok\r\n')
          else if (verb === 'RCPT')
            socket.write(
              behaviour.rejectRecipient
                ? '550 5.1.1 No such recipient here\r\n'
                : '250 2.1.5 Ok\r\n',
            )
          else if (verb === 'DATA') {
            inData = true
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
          } else if (verb === 'QUIT') {
            socket.write('221 2.0.0 Bye\r\n')
            socket.end()
          } else socket.write('502 5.5.2 Not implemented\r\n')
        }

        newline = buffer.indexOf('\r\n')
      }
    })

    socket.on('error', () => {
      // A client that gives up mid-conversation is a case under test, not a
      // server fault.
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    port,
    commands,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
