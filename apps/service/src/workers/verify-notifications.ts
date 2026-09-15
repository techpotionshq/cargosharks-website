/**
 * Prove the whole notification chain works, end to end, against this database.
 *
 *     pnpm --filter @qabandi/service verify:notifications
 *
 * The unit tests cover the two halves that can be tested in isolation — the
 * SMTP conversation against a socket, and the templates against the event
 * catalogue. Neither can catch the thing that actually goes wrong here,
 * because every fault this chain has had was in a *join between* the parts:
 *
 *   - the channel registry was empty, so nothing resolved an adapter
 *   - `notification_templates` was empty, so nothing resolved a template
 *   - nothing ever enqueued the dispatcher, so it never ran
 *   - the recipient query dropped its filter and addressed the whole database
 *
 * Four independent breaks in one path, each of which leaves every other part
 * passing its own tests. So this runs the real dispatcher, against real rows,
 * with a real socket at the far end, and prints the message that came out.
 *
 * ## A throwaway SMTP server rather than a real one
 *
 * The point is not that mail leaves the building — `verify-file-store.ts`
 * checks credentials because storage credentials are what get pasted in
 * wrongly. The point here is that an event raised by the product becomes a
 * *correctly addressed, correctly worded, correctly encoded message*, and a
 * local server proves that without a relay and without writing to a person.
 *
 * ## It writes rows, and it cannot take them back
 *
 * A rolled-back transaction would not work, and the reason is worth stating:
 * the dispatcher opens its *own* transactions, so fixtures held in an
 * uncommitted one are invisible to the very code under test. They have to be
 * committed to be seen.
 *
 * And nothing in this product deletes (§5.5) — `app_user` holds no DELETE on
 * any business table. So the check does what the product does: it writes a
 * customer and a contact prefixed `VERIFY-`, addressed at `.invalid`, and
 * **deactivates both** when it is finished. It prints exactly what it left.
 *
 * That makes it a development and staging check. Run it after `db:seed` on a
 * new deployment, before the first real customer is loaded.
 */

import { createServer, type Server } from 'node:net'
import { eq, sql } from 'drizzle-orm'
import {
  branches,
  customerContacts,
  customers,
  db,
  principals,
  loadEnv,
  notificationDeliveries,
  notificationOutbox,
  notificationTemplates,
  systemActor,
  withActor,
} from '@qabandi/db'
import { smtpChannel } from '../adapters/smtp'
import { clearChannels, registerChannel, runNotificationDispatch } from './notification-dispatch'

interface Captured {
  readonly port: number
  readonly messages: string[]
  close(): Promise<void>
}

/** A mail server that accepts everything and keeps what it was given. */
async function captureServer(): Promise<Captured> {
  const messages: string[] = []

  const server: Server = createServer((socket) => {
    let buffer = ''
    let inData = false
    let message = ''

    socket.write('220 verify.qabandi.local ESMTP\r\n')
    socket.on('error', () => {})

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
            socket.write('250 2.0.0 Ok: queued as VERIFY01\r\n')
          } else {
            message += (line.startsWith('..') ? line.slice(1) : line) + '\r\n'
          }
        } else {
          const verb = line.split(' ')[0]!.toUpperCase()
          if (verb === 'EHLO') socket.write('250-verify.qabandi.local\r\n250 8BITMIME\r\n')
          else if (verb === 'DATA') {
            inData = true
            socket.write('354 Go ahead\r\n')
          } else if (verb === 'QUIT') {
            socket.write('221 Bye\r\n')
            socket.end()
          } else socket.write('250 Ok\r\n')
        }

        newline = buffer.indexOf('\r\n')
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  return {
    port: typeof address === 'object' && address ? address.port : 0,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** Decode the subject the way a mail client does — the inverse of `encodeHeader`. */
function subjectOf(message: string): string {
  const headers = message.split('\r\n\r\n')[0]!.replace(/\r\n[ \t]/g, '\r\n ')
  const line = headers.split('\r\n').find((l) => l.toLowerCase().startsWith('subject:'))
  const raw = line ? line.slice(8).trim() : ''

  return raw
    .split('\r\n ')
    .map((word) => {
      const match = /^=\?UTF-8\?B\?(.*)\?=$/.exec(word)
      return match ? Buffer.from(match[1]!, 'base64').toString('utf8') : word
    })
    .join('')
}

/** The Arabic block, and the character a broken encoding leaves behind. */
const ARABIC = /[\u0600-\u06ff]/
const REPLACEMENT = '\ufffd'

function bodyOf(message: string): string {
  const payload = message.split('\r\n\r\n').slice(1).join('\r\n\r\n')
  return Buffer.from(payload.replace(/\r\n/g, ''), 'base64').toString('utf8')
}

async function main(): Promise<void> {
  loadEnv()

  const mail = await captureServer()

  // Every send in this run goes to the throwaway server above, whatever the
  // deployment is configured with. Nothing can escape to a real address.
  clearChannels()
  registerChannel(
    smtpChannel({
      host: '127.0.0.1',
      port: mail.port,
      secure: false,
      from: 'verify@qabandi.local',
      timeoutMs: 10_000,
    }),
  )

  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
  const code = `VERIFY-${stamp}`

  try {
    // --- fixtures, committed so the dispatcher's own transaction sees them ---
    const context = await withActor(systemActor(), async (tx) => {
      const [branch] = await tx.select().from(branches).limit(1)
      if (!branch) throw new Error('no branches — run `pnpm db:create-branch` first')

      const [templates] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(notificationTemplates)
      if (!templates?.n) throw new Error('no templates — run `pnpm db:seed` first')

      console.log(`branch    : ${branch.code} (${branch.timeZone})`)
      console.log(`templates : ${templates.n}`)

      const [customer] = await tx
        .insert(customers)
        .values({
          code,
          legalNameEn: 'Verification Customer',
          legalNameAr: 'عميل التحقق',
          primaryBranchId: branch.id,
        })
        .returning({ id: customers.id })

      /*
        `.invalid` is reserved by RFC 2606 and can never resolve.

        Even if this somehow ran against a real relay — it cannot, the channel
        is replaced above — the address is one no mail system on earth will
        deliver to a person.
      */
      await tx.insert(customerContacts).values({
        customerId: customer!.id,
        nameEn: 'Verification Contact',
        nameAr: 'جهة اتصال التحقق',
        email: `${code.toLowerCase()}@example.invalid`,
        isPrimary: true,
      })

      /*
        A second contact who reads Arabic, and the reason there are two.

        One event must become an English message to one contact and an Arabic
        one to another — different template rows, a different encoding on the
        subject line, and a different legal name in the signature, all resolved
        per recipient at send time. That is the property the whole bilingual
        design rests on, and until this ran nothing had demonstrated it end to
        end.

        The language lives on the *principal*, not on the contact, so this
        needs a portal identity. `auth_user_id` stays null: a principal with no
        way to sign in is exactly what a contact who has been recorded but
        never invited looks like.
      */
      const arabicEmail = `${code.toLowerCase()}-ar@example.invalid`

      const [arabicPrincipal] = await tx
        .insert(principals)
        .values({
          type: 'customer_contact',
          email: arabicEmail,
          nameEn: 'Arabic Verification Contact',
          nameAr: 'جهة اتصال التحقق بالعربية',
          locale: 'ar',
          customerId: customer!.id,
        })
        .returning({ id: principals.id })

      await tx.insert(customerContacts).values({
        customerId: customer!.id,
        principalId: arabicPrincipal!.id,
        nameEn: 'Arabic Verification Contact',
        nameAr: 'جهة اتصال التحقق بالعربية',
        email: arabicEmail,
      })

      const [event] = await tx
        .insert(notificationOutbox)
        .values({
          branchId: branch.id,
          eventKey: 'invoice.issued',
          customerId: customer!.id,
          payload: {
            seriesNo: `${branch.invoiceSeries}-2026-09999`,
            total: '1234.567',
            currency: 'KWD',
            dueOn: '2026-09-30',
          },
        })
        .returning({ id: notificationOutbox.id })

      return {
        branchCode: branch.code,
        branchName: branch.legalNameEn,
        branchNameAr: branch.legalNameAr,
        customerId: customer!.id,
        principalId: arabicPrincipal!.id,
        outboxId: event!.id,
      }
    })

    /*
      Fixed at 10:00 UTC — 13:00 in Kuwait, comfortably outside quiet hours.

      Passing the clock in rather than reading "now" means this answers the
      same way whether it is run at lunchtime or at midnight, which is exactly
      why `runNotificationDispatch` takes an `asOf` at all.
    */
    const at = new Date('2026-08-18T10:00:00Z')
    const result = await runNotificationDispatch({ outboxId: context.outboxId }, at)
    console.log('dispatch  :', JSON.stringify(result))

    const deliveries = await withActor(systemActor(), (tx) =>
      tx
        .select({
          status: notificationDeliveries.status,
          to: notificationDeliveries.toAddress,
          locale: notificationDeliveries.locale,
          attempts: notificationDeliveries.attempts,
          externalRef: notificationDeliveries.externalRef,
          error: notificationDeliveries.lastError,
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.outboxId, context.outboxId)),
    )

    if (result.sent !== 2) {
      throw new Error(
        `expected two messages — one per contact — and sent ${result.sent}. ` +
          `Deliveries: ${JSON.stringify(deliveries)}`,
      )
    }

    for (const row of deliveries) {
      console.log(
        `delivery  : ${row.status} to ${row.to} (${row.locale}), ` +
          `attempt ${row.attempts}, ref ${row.externalRef}`,
      )
    }

    if (mail.messages.length !== 2) {
      throw new Error(
        `the adapter reported two sends and ${mail.messages.length} message(s) arrived`,
      )
    }

    /*
      Which message is which is decided by reading them, not by the order they
      were sent in. The dispatcher makes no promise about that order and should
      not have to.
    */
    const decoded = mail.messages.map((m) => ({ subject: subjectOf(m), body: bodyOf(m) }))
    const english = decoded.find((m) => m.body.includes('Hello'))
    const arabic = decoded.find((m) => m.body.includes('مرحبا'))

    if (!english) throw new Error('no English message arrived')
    if (!arabic) throw new Error('no Arabic message arrived')

    for (const [label, message] of [
      ['english', english],
      ['arabic', arabic],
    ] as const) {
      console.log('')
      console.log(`--- ${label} --------------------------------------------------`)
      console.log(`subject: ${message.subject}`)
      console.log(message.body.trimEnd())
      console.log('---------------------------------------------------------------')
    }
    console.log('')

    const body = english.body

    /*
      Four assertions, and each one is a break this chain has actually had.

      The signature proves the branch join reached the message; the greeting
      proves the recipient was matched back from an address alone; the amount
      proves money crossed as a string; and the absence of `{{` proves no merge
      field the template asked for went unanswered.
    */
    for (const [what, ok] of [
      ['the branch signed it', body.includes(context.branchName)],
      ['the contact was greeted by name', body.includes('Verification Contact')],
      ['the amount survived as a string', body.includes('1234.567')],
      ['no merge field was left unrendered', !body.includes('{{')],
      /*
        The Arabic assertions, and the subject line is the one that matters.

        A subject header is ASCII by definition, so Arabic has to survive being
        encoded, folded across 75-character words, and decoded again by the
        client. If any of that is wrong the customer sees a line of
        `=?UTF-8?B?` or a replacement character where their own language should
        be — and it is the failure nobody working on an English keyboard
        notices.
      */
      ['the Arabic subject decodes back to Arabic', ARABIC.test(arabic.subject)],
      ['no replacement character survived the encoding', !arabic.subject.includes(REPLACEMENT)],
      ['the Arabic message used the Arabic template', ARABIC.test(arabic.body)],
      [
        'the branch signed the Arabic message in Arabic',
        arabic.body.includes(context.branchNameAr),
      ],
      ['no merge field was left unrendered in Arabic', !arabic.body.includes('{{')],
    ] as const) {
      if (!ok) throw new Error(`failed: ${what}`)
      console.log(`ok        : ${what}`)
    }

    // --- stand the fixtures down -------------------------------------------
    await withActor(systemActor(), async (tx) => {
      await tx
        .update(customerContacts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(customerContacts.customerId, context.customerId))
      await tx
        .update(customers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(customers.id, context.customerId))
      // The principal too, or a live identity is left in `principals` behind a
      // deactivated contact. FR-ID-09 deactivates; it never deletes.
      await tx
        .update(principals)
        .set({ isActive: false, deactivatedAt: new Date(), updatedAt: new Date() })
        .where(eq(principals.id, context.principalId))
    })

    console.log('')
    console.log(`notifications OK — branch ${context.branchCode}`)
    console.log(
      `left behind: customer ${code}, its two contacts and one principal, ` +
        'all deactivated, plus one outbox row and two delivery records.',
    )
  } finally {
    await mail.close()
    await db.$client.end()
  }
}

main().catch((error: unknown) => {
  console.error('notifications FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
