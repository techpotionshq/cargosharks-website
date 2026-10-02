/**
 * The internal API — what `apps/web` calls when it needs the service.
 *
 * `INTERNAL_API_SECRET` has been required in `config.ts` since Release One and
 * read by nothing. This is what it was for.
 *
 * ## Why the web app cannot render documents itself
 *
 * Chromium lives in the service stage of the root `Dockerfile`, not in the web image, and
 * it belongs there: a browser is a heavyweight, memory-hungry dependency and the
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
import { createHash, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { assets, principals, systemActor, withActor, type Actor } from '@qabandi/db'
import { fileStore, mailSettings, modelProvider, sendMail, smtpOptions } from '../adapters/index'
import { FileStoreError } from '../adapters/file-store'
import { ModelError } from '../adapters/model'
import { config } from '../config'
import { DocumentNotFoundError, renderInvoicePdf, renderQuotationPdf } from '../pdf/documents'
import {
  JOB_DOCUMENT_KINDS,
  renderJobDocumentPdf,
  renderManifestPdf,
  type JobDocumentKind,
} from '../pdf/job-documents'
import { DocumentTypeNotSeededError, storeJobDocument } from '../pdf/store'
import { ExportError, buildAccountingExport, voidAccountingExport } from '../accounting/export'
import { extractSupplierInvoice } from '../workers/invoice-extract'
import { draftQuoteCoverNote } from '../workers/quote-cover-note'
import { AiUnavailableError } from '../ai/ledger'
import { ask, askStreaming } from '../ai/assistant'
import { closeThread, historyFor, listThreads, readThread, recordExchange } from '../ai/threads'
import { AccountingError, DomainError, describeFinding, invoiceReadingIssues } from '@qabandi/core'

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

interface AssistantRequest {
  readonly actor?: Actor
  readonly branchId?: string
  /** Permission keys the web app resolved for this session. */
  readonly permissions?: readonly string[]
  readonly locale?: 'en' | 'ar'
  readonly question?: string
  /**
   * The conversation to continue, if any.
   *
   * Used as a filter and never as a destination trusted on sight: RLS narrows
   * it to threads this principal owns, so somebody else's id matches nothing
   * and a fresh thread is opened instead.
   */
  readonly threadId?: string | null
}

interface ThreadRequest {
  readonly actor?: Actor
  readonly threadId?: string
}

interface ExtractInvoiceRequest {
  readonly actor?: Actor
  readonly branchId?: string
  readonly assetId?: string
  readonly partnerId?: string
  readonly jobId?: string | null
  readonly write?: boolean
}

interface QuoteCoverNoteRequest {
  readonly actor?: Actor
  readonly branchId?: string
  readonly quoteId?: string
  readonly locale?: 'en' | 'ar'
}

/**
 * A file the operator captured, on its way into storage.
 *
 * Base64 rather than multipart, and that is a deliberate trade. The payloads
 * are a signature bitmap and a handful of phone photographs — hundreds of
 * kilobytes, not gigabytes — and base64 costs a third more bytes on a hop that
 * never leaves the deployment's own network. What it buys is that this route
 * looks like every other route here: one JSON body carrying the actor, checked
 * by the same secret, with no second content-type path to get authentication
 * wrong on.
 */
interface UploadRequest {
  readonly actor: Actor
  readonly branchId: string
  readonly fileName: string
  readonly contentType: string
  /** Base64, no data-URI prefix. The caller strips it. */
  readonly data: string
  /** Recorded on the asset, so a photograph can say what it was taken for. */
  readonly meta?: Record<string, unknown>
  /**
   * What the file is for, which decides what may be uploaded and where it lands.
   *
   * Defaults to `pod`, so every existing caller keeps the rules it was written
   * against. The distinction is not decoration: proof of delivery is a phone
   * photograph and must never accept a PDF-with-JavaScript, while a supplier
   * bill is a PDF far more often than it is an image. One allow-list for both
   * would have to be the union, which is the loosest of the two applied to the
   * one that matters most.
   */
  readonly purpose?: UploadPurpose
}

type UploadPurpose = 'pod' | 'supplier-invoice'

interface SignedUrlRequest {
  readonly storageKey: string
  readonly fileName?: string
  readonly expiresInSeconds?: number
}

/**
 * What a capture form may store.
 *
 * Images only, and not every image: `image/svg+xml` is markup, and an SVG
 * served from a signed storage URL executes script in the viewer's origin.
 * HEIC is absent because nothing here converts it and a photograph nobody can
 * open is worse than one that was refused at capture.
 */
const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * What each purpose accepts, and where it lands.
 *
 * Per purpose rather than one union, because the union is the loosest rule
 * applied to the strictest case. Proof of delivery stays photographs only: an
 * HTML or SVG upload would be a stored, signed-URL-served document with script
 * in it, and that reasoning does not weaken because bills arrive as PDFs.
 *
 * The prefix is part of the contract too. `pod/` and `bills/` are separate so
 * a bucket lifecycle rule, an audit or a retention policy can speak about one
 * without the other — and so nobody has to infer what a key holds from its
 * content type.
 */
const UPLOAD_PURPOSES: Readonly<
  Record<UploadPurpose, { readonly types: readonly string[]; readonly prefix: string }>
> = {
  pod: { types: ALLOWED_UPLOAD_TYPES, prefix: 'pod' },
  'supplier-invoice': {
    types: [...ALLOWED_UPLOAD_TYPES, 'application/pdf'],
    prefix: 'bills',
  },
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/**
 * Ten megabytes — a generous phone photograph, and a refusal well before
 * anything that would trouble the process holding it in memory.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * The body Fastify will accept for an upload, derived rather than chosen.
 *
 * Fastify's default `bodyLimit` is one megabyte, and it refuses past it before
 * any handler runs — so the ten megabytes above was unreachable and every
 * photograph over about 786KB came back as a bare `Payload Too Large`. A
 * proof-of-delivery photo from a phone is two to five megabytes, which meant
 * *every* real one failed, and the capture reported it as an upload the driver
 * should retry from a desk, where it failed again.
 *
 * The bytes arrive base64-encoded, which is four characters per three bytes,
 * and the JSON envelope carries the actor, the file name and the metadata
 * around them. Derived from `MAX_UPLOAD_BYTES` so the two cannot drift: the
 * handler stays the thing that decides, and answers with a sentence.
 */
const MAX_UPLOAD_BODY_BYTES = Math.ceil(MAX_UPLOAD_BYTES * (4 / 3)) + 64 * 1024

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
 * The service is not meant to have a public domain at all: `/webhooks` and
 * `/api/v1` are served through the web container, which forwards those two
 * prefixes and nothing else (`apps/web/src/lib/service-proxy.ts`). But "no
 * domain" lives in somebody's deployment UI, one text box away from being
 * given one. This is the same control, expressed where it cannot be lost.
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
        return reply.code(400).send({ error: 'unknown_kind', allowed: JOB_DOCUMENT_KINDS })
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
        /*
          Every refusal as a code, with `values` for what its sentence names —
          the web app translates these rather than showing `message`, which is
          English and stays for the log. A render fault is still a 500.
        */
        if (error instanceof DocumentTypeNotSeededError) {
          return reply.code(404).send({
            error: 'document_type_missing',
            message: error.message,
            values: { kind: error.kind },
          })
        }
        if (error instanceof DocumentNotFoundError) {
          return reply.code(404).send({ error: 'not_found' })
        }
        if (error instanceof FileStoreError) {
          // Rendered, but the copy could not be kept — so nothing was issued.
          return reply.code(502).send({ error: 'storage_failed', message: error.message })
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
   * The quotation — FR-EQ-08.
   *
   * Streamed only, and never stored. A revision is a new `quotes` row with the
   * previous one marked superseded (FR-RT-08), so the record already keeps
   * every version that was ever offered; a stored PDF beside it would be a
   * second copy of the same fact with nothing to reconcile it against.
   */
  app.post<{ Params: { id: string }; Body: DocumentRequest }>(
    '/documents/quotation/:id',
    async (request, reply) => {
      const { actor, locale } = request.body ?? {}

      if (!actor?.principalId || !actor.type) {
        return reply.code(400).send({ error: 'no_actor' })
      }

      try {
        const { pdf, filename } = await renderQuotationPdf(
          actor,
          request.params.id,
          locale === 'ar' ? 'ar' : 'en',
        )

        return (
          reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', `inline; filename="${filename}"`)
            // Never cached: a quotation carries a price and a customer name.
            .header('cache-control', 'private, no-store')
            .send(pdf)
        )
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
      /*
        `error` is the code the web app translates and `values` what its
        sentence names; `message` stays for a caller that has no catalogue.
      */
      if (error instanceof ExportError) {
        return reply
          .code(422)
          .send({ error: error.code, message: error.message, values: error.values ?? {} })
      }
      /*
        The engine's own refusals arrive as DomainError with a `code`. They are
        the same class of thing — something in the period is not what it claims
        to be — and the operator needs the sentence, not a stack trace.

        The class, not the shape. This used to accept any Error with a string
        `code`, and a PostgreSQL error has one (`23505`, `40001`) — so a database
        fault reached the finance manager as a 422 "refusal" carrying the
        driver's raw message. A fault is a 500 and goes to the log.
      */
      if (error instanceof DomainError) {
        /*
          `AccountingError` carries which invoice or account it is about, as
          strings; without them the translated sentence could only say "an
          account is missing", not which one.
        */
        const values = error instanceof AccountingError ? error.values : {}
        return reply.code(422).send({ error: error.code, message: error.message, values })
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
        // The rule is an Express one and its advice — `resp.render()` — does not
        // exist here. Fastify serialises this to JSON against the route's response
        // schema; nothing is written as HTML, and there is no browser rendering the
        // result. `result` is also assembled from the database rather than echoed
        // from the request.
        //
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
        return reply.send(result)
      } catch (error) {
        if (error instanceof ExportError) {
          return reply
            .code(422)
            .send({ error: error.code, message: error.message, values: error.values ?? {} })
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

  /*
    Supplier invoice extraction — FR-FN-09's missing half.

    Synchronous, unlike the queued path in `workers/index.ts`, and the two
    exist for genuinely different callers. This one serves a coordinator who is
    standing on the capture form with the PDF already uploaded: they are
    waiting, the answer pre-fills the form in front of them, and the review
    *is* the form. The queued job serves a bill that arrived by email with
    nobody looking.

    `write` defaults to false here for that reason. A route a screen calls must
    not create a row behind the person filling one in, or they end up with two.
  */

  /*
    The operator assistant.

    Permissions are passed rather than re-derived, exactly as the actor is, and
    on the same reasoning this file opens with: the web app has already
    resolved the session, this route trusts the shared secret for
    authentication and the passed identity for authorisation. What the
    assistant may *see* is not decided here at all — the actor is stamped into
    every tool's transaction and RLS answers that question a layer below
    anything a prompt can reach.

    Nothing this route does can change a business record. A proposal comes back
    as data for the interface to render as a button; pressing it runs the
    ordinary server action under the person's own actor.
  */
  app.post<{ Body: AssistantRequest }>('/ai/assistant', async (request, reply) => {
    const { actor, branchId, permissions, locale, question, threadId } = request.body ?? {}

    if (!actor || !branchId || !question?.trim()) {
      return reply.code(400).send({ error: 'incomplete_request' })
    }

    try {
      /*
        History is read from the thread rather than posted by the browser.

        A client that sends its own transcript is a client that can send one it
        was never given — a rewritten "earlier turn" is the cheapest possible
        prompt injection, and it would arrive from an authenticated session
        looking exactly like the real thing. Reading it back under the same
        actor costs one indexed query and removes the whole class.
      */
      const history = threadId ? await historyFor(actor, threadId) : []

      const answer = await ask({
        actor,
        branchId,
        permissions: new Set(permissions ?? []),
        locale: locale === 'ar' ? 'ar' : 'en',
        question: question.trim(),
        history,
      })

      const stored = await recordExchange({
        actor,
        branchId,
        threadId,
        question: question.trim(),
        answer: answer.reply,
        proposals: answer.proposals as unknown as Record<string, unknown>[],
        // Each lookup with its result, so a follow-up is answered from them (ai-2).
        used: answer.calls as unknown as Record<string, unknown>[],
        invocationId: answer.invocationIds.at(-1) ?? null,
      })

      // The results stay server-side; the browser is told which tools ran.
      const { calls: _calls, ...visible } = answer
      return reply.send({ ...visible, threadId: stored.threadId, title: stored.title })
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        return reply.code(503).send({ error: error.code, message: error.message })
      }
      throw error
    }
  })

  /*
    The assistant, streamed.

    Server-sent events rather than a JSON body, because the loop can take half a
    minute and somebody watching a spinner for that long assumes it has hung.
    Three kinds of event arrive: which lookup is running, fragments of the
    answer, and a final settlement carrying the thread and any proposals.

    The exchange is still stored server-side at the end, so a reload shows what
    was read rather than the pieces it arrived in. A connection dropped
    mid-answer loses that turn's transcript and keeps the ledger row — the right
    way round, since the spend happened and the conversation did not.
  */
  app.post<{ Body: AssistantRequest }>('/ai/assistant/stream', async (request, reply) => {
    const { actor, branchId, permissions, locale, question, threadId } = request.body ?? {}

    if (!actor || !branchId || !question?.trim()) {
      return reply.code(400).send({ error: 'incomplete_request' })
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      /*
        Nginx and friends buffer proxied responses by default, which delivers a
        stream in one piece at the end — the exact thing this route exists to
        avoid, and invisible in development where nothing sits in front.
      */
      'x-accel-buffering': 'no',
    })

    const send = (event: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      const history = threadId ? await historyFor(actor, threadId) : []

      let answer = ''
      let proposals: unknown[] = []
      let used: string[] = []
      let calls: unknown[] = []
      let invocationIds: string[] = []
      let truncated: string | undefined

      for await (const event of askStreaming({
        actor,
        branchId,
        permissions: new Set(permissions ?? []),
        locale: locale === 'ar' ? 'ar' : 'en',
        question: question.trim(),
        history,
      })) {
        if (event.type === 'done') {
          answer = event.reply
          proposals = event.proposals as unknown[]
          used = [...event.used]
          calls = [...event.calls]
          invocationIds = [...event.invocationIds]
          truncated = event.truncated
        } else {
          send(event)
        }
      }

      const stored = await recordExchange({
        actor,
        branchId,
        threadId,
        question: question.trim(),
        answer,
        proposals: proposals as Record<string, unknown>[],
        /*
          Every lookup with its result, not only the tool names (ai-2): a
          follow-up is answered from these, where before it was answered from
          the assistant's own prose — with figures nobody had looked up.
        */
        used: calls as Record<string, unknown>[],
        invocationId: invocationIds.at(-1) ?? null,
      })

      send({
        type: 'done',
        reply: answer,
        proposals,
        used,
        truncated,
        threadId: stored.threadId,
        title: stored.title,
      })
    } catch (error) {
      /*
        The head is already sent, so a failure cannot become a status code. It
        becomes an event the panel renders as a message — better than a silently
        truncated stream, where a person cannot tell a finished answer from an
        abandoned one.
      */
      send({
        type: 'failed',
        code: error instanceof AiUnavailableError ? error.code : 'error',
        message:
          error instanceof AiUnavailableError
            ? error.message
            : 'The assistant could not finish that answer.',
      })
    } finally {
      reply.raw.end()
    }

    return reply
  })

  /**
   * This person's conversations, and whether the assistant can run at all.
   *
   * The two together because the panel asks this once when it opens and the
   * answer decides what it renders. Reporting "no key" only after somebody has
   * typed a question and waited is the wrong order: the deployment already
   * knew, and the person spent a minute finding out.
   *
   * `available` and not the reason — an operator sees "add a key in Settings",
   * which is the only thing they can act on, and the driver's own diagnosis
   * stays in the boot log where an engineer will look for it.
   */
  app.post<{ Body: ThreadRequest }>('/ai/threads', async (request, reply) => {
    const { actor } = request.body ?? {}
    if (!actor) return reply.code(400).send({ error: 'incomplete_request' })

    const [threads, provider] = await Promise.all([listThreads(actor), modelProvider()])
    return reply.send({ threads, configured: provider.available })
  })

  /** One conversation, in full — what a person said, not what the model saw. */
  app.post<{ Body: ThreadRequest }>('/ai/thread', async (request, reply) => {
    const { actor, threadId } = request.body ?? {}
    if (!actor || !threadId) return reply.code(400).send({ error: 'incomplete_request' })
    return reply.send({ turns: await readThread(actor, threadId) })
  })

  /** Closing hides a thread. Nothing is deleted (§5.5). */
  app.post<{ Body: ThreadRequest }>('/ai/thread/close', async (request, reply) => {
    const { actor, threadId } = request.body ?? {}
    if (!actor || !threadId) return reply.code(400).send({ error: 'incomplete_request' })
    return reply.send({ closed: await closeThread(actor, threadId) })
  })

  app.post<{ Body: ExtractInvoiceRequest }>('/ai/supplier-invoice', async (request, reply) => {
    const { actor, branchId, assetId, partnerId, jobId, write } = request.body ?? {}

    if (!actor || !branchId || !assetId || !partnerId) {
      return reply.code(400).send({ error: 'incomplete_request' })
    }

    try {
      const result = await extractSupplierInvoice({
        actor,
        branchId,
        assetId,
        partnerId,
        jobId: jobId ?? null,
        write: write === true,
      })

      return reply.send({
        invocationId: result.invocationId,
        consistent: result.consistent,
        supplierInvoiceId: result.supplierInvoiceId ?? null,
        refusal: result.refusal ?? null,
        /*
          The refusal again as a code and the values its sentence names — what
          the web app translates. `refusal` stays for a caller with no
          catalogue; a screen shows the code's sentence, not this one.
        */
        refusalCode: result.refusalCode ?? null,
        refusalValues: result.refusalValues ?? {},
        header: result.extracted.header,
        confidence: result.extracted.confidence,
        lines: result.extracted.lines.rows.map((row) => row.values),
        /*
          Both the machine-readable findings and the sentence. The screen wants
          to point at line 3; the log wants "line 3 says 450.000, the figures
          give 451.500" — and rendering that sentence in three places is how
          three renderings of one fact drift apart.

          `stated` and `computed` are the two figures, as decimal strings (never
          a JS number: KWD carries three places), so a screen in Arabic can put
          them in its own sentence rather than quoting `message`.
        */
        findings: result.findings.map((finding) => ({
          check: finding.check,
          line: finding.line ?? null,
          stated: finding.stated.amount.toFixed(),
          computed: finding.computed.amount.toFixed(),
          message: describeFinding(finding),
        })),
        issues: [
          ...result.extracted.headerIssues,
          ...result.extracted.lines.issues.map((issue) => `line ${issue.line}: ${issue.message}`),
        ],
        /*
          The same issues as data — which field, which line, what code — for
          the screen to word. `issues` above is English and stays for the log
          and any caller with no catalogue.
        */
        readingIssues: invoiceReadingIssues(result.extracted).map((issue) => ({
          where: issue.where,
          field: issue.field,
          line: issue.line ?? null,
          code: issue.code,
          values: issue.values ?? {},
        })),
      })
    } catch (error) {
      /*
        `503` for an unconfigured or exhausted provider, not `500`.

        A deployment that has bought no model, and one that has spent its
        ceiling for the month, are both *this service is not offering that
        right now* — a state the screen should explain and fall back from, not
        an error it should report as a fault. The code travels so the web app
        can say which of the two it is.
      */
      if (error instanceof AiUnavailableError) {
        return reply.code(503).send({ error: error.code, message: error.message })
      }
      throw error
    }
  })

  app.post<{ Body: QuoteCoverNoteRequest }>('/ai/quote-cover-note', async (request, reply) => {
    const { actor, branchId, quoteId, locale } = request.body ?? {}

    if (!actor || !branchId || !quoteId) {
      return reply.code(400).send({ error: 'incomplete_request' })
    }

    try {
      const result = await draftQuoteCoverNote({
        actor,
        branchId,
        quoteId,
        locale: locale === 'ar' ? 'ar' : 'en',
      })

      return reply.send({
        invocationId: result.invocationId,
        note: result.note,
        locale: result.locale,
        refusal: result.refusal ?? null,
        // The code is what the web app translates; `refusal` stays for logs.
        refusalCode: result.refusalCode ?? null,
      })
    } catch (error) {
      // Same 503 as the invoice route: no model, or the budget spent, is a
      // "not offering that right now" the screen falls back from, not a fault.
      if (error instanceof AiUnavailableError) {
        return reply.code(503).send({ error: error.code, message: error.message })
      }
      /*
        The provider had a bad minute — a timeout, a dropped body (ai-12). A
        504 with the code, so the screen can say "it took too long, try again"
        rather than reporting a fault in our service.
      */
      if (error instanceof ModelError && error.retryable) {
        return reply.code(504).send({ error: error.code, message: error.message })
      }
      throw error
    }
  })

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

      As the system principal, through `withActor` — A8. This was the one read
      in the service on bare `db`, and `principals` is FORCE ROW LEVEL
      SECURITY: with no actor stamped every policy arm is false, the query
      found nobody, and every reset mail went out in English with no name.
      There is no caller to act as (the person is signed out by definition),
      and the read is one fixed projection keyed by the address the link is
      being sent to.
    */
    const [principal] = await withActor(systemActor(), (tx) =>
      tx
        .select({ locale: principals.locale, nameEn: principals.nameEn, nameAr: principals.nameAr })
        .from(principals)
        .where(eq(principals.email, email.toLowerCase()))
        .limit(1),
    )

    const locale = principal?.locale === 'ar' ? 'ar' : 'en'
    const name = (locale === 'ar' ? principal?.nameAr : principal?.nameEn) ?? ''

    try {
      await sendMail(smtpOptions(await mailSettings()), {
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
  /**
   * Store a captured file and record it as an asset.
   *
   * The counterpart to `/files/signed-url` above: that one hands a link out,
   * this one takes bytes in. It exists because the storage credentials live in
   * this process and nowhere else, for exactly the reason the signing route
   * gives — the moment the secret key is in the web app's environment it is in
   * the environment of every server component that app imports.
   *
   * ## Why the asset row is written here rather than by the caller
   *
   * Two writes that must not come apart. A row with no object is a broken
   * download; an object with no row is a file nobody can find and nobody will
   * ever delete. Writing both here means the failure mode is one the caller
   * can see — the request failed and there is no asset id — rather than a
   * half-state it has to reconcile.
   *
   * The insert runs under the *caller's* actor, so row-level security decides
   * whether that principal may write to that branch. This route authenticates
   * with the shared secret and authorises with the actor, like every other one.
   */
  app.post<{ Body: UploadRequest }>(
    '/files/upload',
    { bodyLimit: MAX_UPLOAD_BODY_BYTES },
    async (request, reply) => {
      const { actor, branchId, fileName, contentType, data, meta, purpose } = request.body ?? {}

      if (!actor || !branchId || !fileName || !contentType || !data) {
        return reply.code(400).send({ error: 'incomplete_request' })
      }

      const rules = UPLOAD_PURPOSES[purpose ?? 'pod']
      if (!rules) return reply.code(400).send({ error: 'unknown_purpose' })

      /*
      The allow-list is on the server, not the form.

      A file input's `accept` attribute is a hint to a file picker and nothing
      more; anything can be posted here. Proof of delivery is photographs and a
      signature bitmap, so that is what this takes — an HTML or SVG upload
      would be a stored, signed-URL-served document with script in it.
    */
      if (!rules.types.includes(contentType)) {
        return reply.code(415).send({ error: 'unsupported_type', allowed: rules.types })
      }

      const bytes = Buffer.from(data, 'base64')
      if (bytes.byteLength === 0) return reply.code(400).send({ error: 'empty_file' })
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return reply.code(413).send({ error: 'too_large', maxBytes: MAX_UPLOAD_BYTES })
      }

      const checksum = createHash('sha256').update(bytes).digest('hex')
      const extension = EXTENSIONS[contentType] ?? 'bin'
      /*
      Keyed by checksum, not by name.

      Two drivers photographing the same delivery note produce the same object
      once. It also means a re-submitted form — the classic double tap on a
      phone — overwrites rather than accumulating, and the key carries nothing
      an operator typed, so a filename with a slash in it cannot escape the
      prefix.
    */
      const storageKey = `${rules.prefix}/${branchId}/${checksum}.${extension}`

      try {
        const stored = await (await fileStore()).put(storageKey, bytes, contentType)

        const [asset] = await withActor(actor, (tx) =>
          tx
            .insert(assets)
            .values({
              branchId,
              storageKey: stored.storageKey,
              fileName,
              contentType,
              byteSize: bytes.byteLength,
              checksum,
              uploadedById: actor.principalId,
              meta: meta ?? {},
            })
            .onConflictDoNothing({ target: assets.storageKey })
            .returning({ id: assets.id }),
        )

        /*
        No row returned means the object was already recorded — the same bytes,
        already uploaded. Read the existing asset rather than failing: to the
        caller this is the same successful outcome, and to storage it is the
        same object.
      */
        if (!asset) {
          const [existing] = await withActor(actor, (tx) =>
            tx
              .select({ id: assets.id })
              .from(assets)
              .where(eq(assets.storageKey, stored.storageKey))
              .limit(1),
          )
          if (!existing) return reply.code(500).send({ error: 'asset_not_recorded' })
          return reply.send({ assetId: existing.id, storageKey: stored.storageKey })
        }

        return reply.send({ assetId: asset.id, storageKey: stored.storageKey })
      } catch (error) {
        if (error instanceof FileStoreError) {
          return reply.code(502).send({ error: 'storage_failed', message: error.message })
        }
        throw error
      }
    },
  )

  app.post<{ Body: SignedUrlRequest }>('/files/signed-url', async (request, reply) => {
    const { storageKey, fileName, expiresInSeconds } = request.body ?? {}

    if (typeof storageKey !== 'string' || storageKey.length === 0) {
      return reply.code(400).send({ error: 'no_storage_key' })
    }

    try {
      const url = await (
        await fileStore()
      ).signedUrl(storageKey, expiresInSeconds ?? DEFAULT_DOWNLOAD_EXPIRY_SECONDS, {
        downloadFilename: fileName,
      })
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
