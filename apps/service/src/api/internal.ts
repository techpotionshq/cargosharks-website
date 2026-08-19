/**
 * The internal API — what `apps/web` calls when it needs the service.
 *
 * `INTERNAL_API_SECRET` has been required in `config.ts` since Release One and
 * read by nothing. This is what it was for.
 *
 * ## Why the web app cannot render documents itself
 *
 * Chromium lives in `infra/Dockerfile.service`, not in the web image, and it
 * belongs there: a browser is a heavyweight, memory-hungry dependency and the
 * request path that serves the operations board should not carry it. So a
 * document request crosses one process boundary — which is also why this route
 * exists rather than the renderer being imported into a Next route handler.
 *
 * ## The actor is passed, not re-derived
 *
 * The web app has already resolved the session; this route trusts the shared
 * secret for *authentication* and the passed actor for *authorisation*. The
 * actor is then stamped into the transaction exactly as it would be in-process,
 * so row-level security decides what the document may contain (§5.2).
 *
 * That means the secret is genuinely load-bearing: anyone holding it can name
 * any principal. It is a service-to-service credential on a network that
 * should never expose this port publicly, and it is checked in constant time
 * so the check itself does not leak.
 */

import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, principals, type Actor } from '@qabandi/db'
import { adapters, sendMail, smtpOptions } from '../adapters/index'
import { FileStoreError } from '../adapters/file-store'
import { config } from '../config'
import { DocumentNotFoundError, renderInvoicePdf } from '../pdf/documents'
import {
  JOB_DOCUMENT_KINDS,
  renderJobDocumentPdf,
  renderManifestPdf,
  type JobDocumentKind,
} from '../pdf/job-documents'
import { storeJobDocument } from '../pdf/store'
import { ExportError, buildAccountingExport, voidAccountingExport } from '../accounting/export'

interface DocumentRequest {
  readonly actor: Actor
  readonly locale?: 'en' | 'ar'
}

interface JobDocumentRequest extends DocumentRequest {
  readonly kind?: string
  /**
   * Keep a copy, version it, and record it against the job.
   *
   * False previews. True is issue: see `pdf/store.ts` for why those are
   * different operations rather than the same one with a flag.
   */
  readonly store?: boolean
}

interface AccountingExportRequest {
  readonly actor?: Actor
  readonly branchId?: string
  readonly from?: string
  readonly to?: string
  readonly format?: string
  readonly post?: boolean
}

interface VoidExportRequest {
  readonly actor?: Actor
  readonly reason?: string
}

interface PasswordResetRequest {
  readonly email: string
  readonly url: string
}

interface SignedUrlRequest {
  readonly storageKey: string
  readonly fileName?: string
  readonly expiresInSeconds?: number
}

/**
 * Short enough that a link pasted into a chat is dead by the time anyone reads
 * it, long enough to survive a slow connection on a large document.
 */
const DEFAULT_DOWNLOAD_EXPIRY_SECONDS = 300

/** Constant-time compare, so a wrong secret leaks nothing about the right one. */
function secretMatches(header: unknown): boolean {
  if (typeof header !== 'string') return false
  const a = Buffer.from(header)
  const b = Buffer.from(config.INTERNAL_API_SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Did this request come through a reverse proxy?
 *
 * A request from the web container over the Docker network arrives with no
 * forwarding headers at all. One that came through Traefik, Caddy, nginx or a
 * load balancer always carries at least one — proxies add them, and cannot
 * usefully be configured not to.
 *
 * So their presence is a reliable signal that a request reached this prefix
 * from outside the private network, which is the one thing that must never
 * happen here: the secret below authenticates the *caller*, and the caller
 * then names the principal to act as. A leaked secret plus a publicly routable
 * `/internal` is every branch's data.
 *
 * The service needs a public domain regardless — `/webhooks` takes carrier
 * callbacks and `/api/v1` is the public tracking API — so "just don't expose
 * it" is not available. A proxy rule blocking this prefix is the right control
 * and it lives in somebody's deployment config, where it is one checkbox away
 * from being lost. This is the same control, expressed where it cannot be.
 */
function viaProxy(headers: Record<string, unknown>): boolean {
  return (
    headers['x-forwarded-for'] !== undefined ||
    headers['x-forwarded-host'] !== undefined ||
    headers['x-forwarded-proto'] !== undefined ||
    headers['forwarded'] !== undefined
  )
}

export async function internalApi(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    /*
      Refused before the secret is even compared.

      404 rather than 403, on the same reasoning as FR-ID-04 everywhere else:
      a prefix that answers "forbidden" has confirmed it exists and is worth
      attacking. From the public side this prefix simply is not there.

      `INTERNAL_API_TRUST_PROXY` exists for the deployment that genuinely
      fronts this port internally — a service mesh, or a sidecar that adds
      forwarding headers on the private network. It defaults to off, so the
      safe shape is the one nobody has to choose.
    */
    if (!config.INTERNAL_API_TRUST_PROXY && viaProxy(request.headers)) {
      request.log.warn(
        { path: request.url, ip: request.ip },
        'internal API reached through a proxy — refused',
      )
      return reply.code(404).send({ error: 'not_found' })
    }

    if (!secretMatches(request.headers['x-internal-secret'])) {
      return reply.code(401).send({ error: 'unauthenticated' })
    }
  })

  /**
   * Render an invoice, bilingually, on demand.
   *
   * Streamed rather than stored — see `renderInvoicePdf`. `Content-Disposition`
   * carries the series number, because that is what finance files it under.
   */
  app.post<{ Params: { id: string }; Body: DocumentRequest }>(
    '/documents/invoice/:id',
    async (request, reply) => {
      const { actor, locale } = request.body ?? {}

      if (!actor?.principalId || !actor.type) {
        return reply.code(400).send({ error: 'no_actor' })
      }

      try {
        const { pdf, filename } = await renderInvoicePdf(
          actor,
          request.params.id,
          locale === 'ar' ? 'ar' : 'en',
        )

        return (
          reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', `inline; filename="${filename}"`)
            // Never cached by a proxy: the same URL renders different content for
            // different principals, and an invoice is commercial data.
            .header('cache-control', 'private, no-store')
            .send(pdf)
        )
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          // Not found, not forbidden — the row is invisible to this principal,
          // so saying "forbidden" would confirm it exists (FR-ID-04).
          return reply.code(404).send({ error: 'not_found' })
        }
        throw error
      }
    },
  )


  /**
   * Render a job document — the bill of lading, delivery order, packing list
   * or customs pack.
   *
   * One route rather than four, because they differ in template and in nothing
   * else: same actor, same authorisation, same locale handling, same failure.
   * `kind` is validated against the list rather than trusted, so an unknown
   * value is a 400 and never a path into `renderJobHtml` with a bad key.
   *
   * `store: true` is issue rather than preview. It writes the bytes, versions
   * the previous copy and records the document, and it returns JSON — the
   * caller wanted a record, not a download.
   */
  app.post<{ Params: { id: string }; Body: JobDocumentRequest }>(
    '/documents/job/:id',
    async (request, reply) => {
      const { actor, locale, kind, store } = request.body ?? {}

      if (!actor?.principalId || !actor.type) {
        return reply.code(400).send({ error: 'no_actor' })
      }
      if (!kind || !JOB_DOCUMENT_KINDS.includes(kind as JobDocumentKind)) {
        return reply
          .code(400)
          .send({ error: 'unknown_kind', allowed: JOB_DOCUMENT_KINDS })
      }

      const documentLocale = locale === 'ar' ? 'ar' : 'en'

      try {
        const { pdf, filename } = await renderJobDocumentPdf(
          actor,
          request.params.id,
          kind as JobDocumentKind,
          documentLocale,
        )

        if (store === true) {
          const stored = await storeJobDocument(
            actor,
            request.params.id,
            kind as JobDocumentKind,
            documentLocale,
            pdf,
            filename,
          )
          return reply.header('cache-control', 'private, no-store').send(stored)
        }

        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `inline; filename="${filename}"`)
          .header('cache-control', 'private, no-store')
          .send(pdf)
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          return reply.code(404).send({ error: 'not_found' })
        }
        throw error
      }
    },
  )

  /**
   * The cargo manifest — a consolidation's document, not a job's.
   *
   * Streamed only. A manifest is regenerated from the house list every time it
   * is asked for, because the house list is exactly what changes up to the
   * cut-off; a stored copy would be authoritative and stale at once.
   */
  app.post<{ Params: { id: string }; Body: DocumentRequest }>(
    '/documents/manifest/:id',
    async (request, reply) => {
      const { actor, locale } = request.body ?? {}

      if (!actor?.principalId || !actor.type) {
        return reply.code(400).send({ error: 'no_actor' })
      }

      try {
        const { pdf, filename } = await renderManifestPdf(
          actor,
          request.params.id,
          locale === 'ar' ? 'ar' : 'en',
        )

        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `inline; filename="${filename}"`)
          .header('cache-control', 'private, no-store')
          .send(pdf)
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          return reply.code(404).send({ error: 'not_found' })
        }
        throw error
      }
    },
  )

  /**
   * Build a period's journal, and optionally post it.
   *
   * Here rather than in the web app for one reason: the file has to be stored,
   * and storage credentials live in this process (§3). The arithmetic itself
   * is `@qabandi/core` and would run anywhere.
   *
   * A refusal — an unmapped charge type, a missing control account, a journal
   * that does not balance — comes back as 422 with the message, because every
   * one of them is a row the finance manager can go and fix. A 500 would tell
   * them to call support about their own chart of accounts.
   */
  app.post<{ Body: AccountingExportRequest }>('/accounting/export', async (request, reply) => {
    const { actor, branchId, from, to, format, post } = request.body ?? {}

    if (!actor?.principalId || !actor.type) {
      return reply.code(400).send({ error: 'no_actor' })
    }
    if (!branchId || !from || !to) {
      return reply.code(400).send({ error: 'period_required' })
    }

    try {
      const result = await buildAccountingExport(actor, { branchId, from, to, format, post })
      return reply.header('cache-control', 'private, no-store').send(result)
    } catch (error) {
      if (error instanceof ExportError) {
        return reply.code(422).send({ error: error.code, message: error.message })
      }
      /*
        The engine's own refusals arrive as DomainError with a `code`. They are
        the same class of thing — something in the period is not what it claims
        to be — and the operator needs the sentence, not a stack trace.
      */
      if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        return reply.code(422).send({ error: error.code, message: error.message })
      }
      throw error
    }
  })

  /** Void a posted export, releasing everything it consumed. */
  app.post<{ Params: { id: string }; Body: VoidExportRequest }>(
    '/accounting/export/:id/void',
    async (request, reply) => {
      const { actor, reason } = request.body ?? {}

      if (!actor?.principalId || !actor.type) {
        return reply.code(400).send({ error: 'no_actor' })
      }

      try {
        const result = await voidAccountingExport(actor, request.params.id, reason ?? '')
        return reply.send(result)
      } catch (error) {
        if (error instanceof ExportError) {
          return reply.code(422).send({ error: error.code, message: error.message })
        }
        throw error
      }
    },
  )

  /**
   * The password-reset email — the one message that is not a notification.
   *
   * ## Why it does not go through the outbox
   *
   * Everything else the product sends is an event about a shipment, and the
   * dispatcher is built for that: resolve the audience, pick a template, defer
   * for quiet hours, retry on a widening backoff. Applying any of it here
   * would be wrong.
   *
   * - **Audience.** There is exactly one recipient and it is not derived from
   *   a customer or a branch. It is whoever typed the address.
   * - **Quiet hours.** Somebody locked out at 22:30 needs the link at 22:30.
   *   Holding it until 07:00 is a nine-hour outage for that person, which is
   *   precisely the courtesy inverted into an obstruction.
   * - **Retry.** The token expires. A message retried in an hour arrives after
   *   the link is dead, which is worse than a failure the person can see and
   *   respond to by asking again.
   *
   * So it is sent inline, and the caller learns whether it left.
   *
   * ## Why the web app posts here rather than sending it itself
   *
   * The same boundary as documents and signed URLs (§3): SMTP credentials live
   * in one process. The alternative puts a mailbox password in the environment
   * of every server component and every dependency any of them import.
   *
   * ## The response never says whether the address exists
   *
   * `202` regardless. Better Auth has already decided whether there is an
   * account, and the reply here is about whether *this service* accepted the
   * request — a 404 for an unknown address would rebuild the account-enumeration
   * oracle that `signIn` is careful not to be (FR-ID-04).
   */
  app.post<{ Body: PasswordResetRequest }>('/mail/password-reset', async (request, reply) => {
    const { email, url } = request.body ?? {}

    if (typeof email !== 'string' || typeof url !== 'string' || !email || !url) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    /*
      The recipient's own language.

      Read from `principals` rather than passed in, because the caller is a
      sign-in page that has no session and therefore knows only what an
      anonymous visitor typed — and a browser's `Accept-Language` is the
      language of the device, not of the person's account. Someone whose
      account is Arabic must get the Arabic mail even when they ask for the
      link from a colleague's English laptop.
    */
    const [principal] = await db
      .select({ locale: principals.locale, nameEn: principals.nameEn, nameAr: principals.nameAr })
      .from(principals)
      .where(eq(principals.email, email.toLowerCase()))
      .limit(1)

    const locale = principal?.locale === 'ar' ? 'ar' : 'en'
    const name = (locale === 'ar' ? principal?.nameAr : principal?.nameEn) ?? ''

    try {
      await sendMail(smtpOptions(), {
        to: email,
        subject: locale === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset your password',
        body: passwordResetBody(locale, name, url),
        locale,
      })
      return reply.code(202).send({ status: 'sent' })
    } catch (error) {
      /*
        Logged in full, reported as a class.

        The message from a refused relay carries the host, the port and often
        the mailbox user. This endpoint is behind the shared secret rather than
        public, but the caller renders its reply into a page an anonymous
        visitor is looking at — so the same rule as `/api/health` applies
        (OP-10): the cause goes to stderr, the class goes on the wire.
      */
      request.log.error({ error }, 'password reset mail failed')
      return reply.code(502).send({ error: 'mail_failed' })
    }
  })

  /**
   * Sign a download link for a stored file.
   *
   * ## Why the web app does not sign these itself
   *
   * It could — SigV4 is a pure function and `apps/web` has `node:crypto`. But
   * signing needs the secret access key, and the moment that key is in the web
   * app's environment it is in the environment of every server component, every
   * server action and every dependency any of them import. The service already
   * holds the credentials for storage; keeping them to one process is the whole
   * reason the boundary is here.
   *
   * ## Why authorisation is *not* done here
   *
   * Unlike the invoice route above, this takes a storage key rather than an
   * actor: the caller has already decided the principal may have this file, by
   * running the lookup under their own actor and letting row-level security
   * answer. That is a real delegation and worth stating plainly — anyone
   * holding `INTERNAL_API_SECRET` can sign a link to any object in the bucket.
   * It is no weaker than the invoice route, which lets the same holder name any
   * principal, and it rests on the same premise: this port is never exposed
   * publicly.
   */
  app.post<{ Body: SignedUrlRequest }>('/files/signed-url', async (request, reply) => {
    const { storageKey, fileName, expiresInSeconds } = request.body ?? {}

    if (typeof storageKey !== 'string' || storageKey.length === 0) {
      return reply.code(400).send({ error: 'no_storage_key' })
    }

    try {
      const url = await adapters().fileStore.signedUrl(
        storageKey,
        expiresInSeconds ?? DEFAULT_DOWNLOAD_EXPIRY_SECONDS,
        { downloadFilename: fileName },
      )
      return reply.header('cache-control', 'private, no-store').send({ url })
    } catch (error) {
      if (error instanceof FileStoreError) {
        // A bad key or a refused expiry is the caller's mistake, not an outage.
        return reply.code(400).send({ error: 'invalid_request', message: error.message })
      }
      throw error
    }
  })
}

/**
 * The message itself, in the recipient's language.
 *
 * Not a `notification_templates` row, deliberately. Those are editable by an
 * administrator (FR-NT-03), and a password-reset email is the one message
 * whose wording an attacker would most like to control — an administrator who
 * could rewrite it could point the link somewhere else. It is also the message
 * that must still work on a deployment whose seed has not been run.
 *
 * The link is printed on its own line rather than wrapped in prose, because
 * plain-text mail clients guess where a URL ends and get it wrong when it is
 * followed by a full stop.
 */
function passwordResetBody(locale: 'en' | 'ar', name: string, url: string): string {
  // `\n` only. `buildMessage` base64-encodes the body, so the transport does
  // not care, and every mail client renders a bare newline as a line break.
  const NEWLINE = '\n'

  if (locale === 'ar') {
    return [
      `مرحباً ${name}`.trim(),
      '',
      'وردنا طلب لإعادة تعيين كلمة المرور الخاصة بحسابكم. لإتمام العملية، يرجى فتح الرابط التالي:',
      '',
      url,
      '',
      'ينتهي هذا الرابط خلال ساعة واحدة ويصلح لمرة واحدة فقط.',
      '',
      'إذا لم تكونوا من قدّم هذا الطلب، فلا حاجة لأي إجراء — كلمة المرور الحالية تبقى كما هي.',
    ].join(NEWLINE)
  }

  return [
    `Hello ${name}`.trim(),
    '',
    'We received a request to reset the password on your account. To continue,',
    'open the link below:',
    '',
    url,
    '',
    'The link expires in one hour and can be used once.',
    '',
    'If you did not ask for this, no action is needed — your current password',
    'still works and nothing has changed.',
  ].join(NEWLINE)
}
