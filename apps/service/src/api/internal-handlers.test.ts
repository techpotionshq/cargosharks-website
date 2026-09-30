/**
 * The handlers behind `/internal`, as against the guard in front of them.
 *
 * `internal.test.ts` covers the hook: the shared secret, and the refusal of
 * anything that arrived through a proxy. This covers what the nine routes do
 * once a caller is through it, and the reason that is worth its own file is
 * what this prefix *is* — it authenticates the caller by shared secret and
 * then acts as whatever principal the caller names. Every route therefore
 * starts by refusing a request that names no principal, and none of them
 * re-derives one.
 *
 * Everything heavy is stubbed. Chromium, the storage driver, the mail relay
 * and the export engine each have their own tests; what runs here is the
 * decisions the routes make around them — the status codes, the headers, and
 * which failures become a sentence rather than a stack trace.
 *
 * Three of those decisions are worth naming.
 *
 * **A document nobody may see is 404, not 403.** The row is invisible to this
 * principal under RLS, and "forbidden" would confirm it exists (FR-ID-04).
 *
 * **An export refusal is 422 with the message.** An unmapped charge type, a
 * missing control account, a journal that does not balance — every one is a
 * row the finance manager can go and fix, and a 500 tells them to call support
 * about their own chart of accounts.
 *
 * **The password-reset reply never says whether the address exists.** 202
 * regardless, or the endpoint rebuilds the account-enumeration oracle that
 * `signIn` is careful not to be.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const SECRET = 'test-internal-secret'

class StubDocumentNotFound extends Error {}
class StubFileStoreError extends Error {}
class StubDocumentTypeNotSeeded extends StubDocumentNotFound {
  constructor(readonly kind: string) {
    super(`${kind} — run pnpm db:seed`)
  }
}
class StubExportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly values?: Readonly<Record<string, string>>,
  ) {
    super(message)
  }
}

const harness = vi.hoisted(() => ({
  principal: null as { locale: string; nameEn: string; nameAr: string | null } | null,
  mailed: [] as { to: string; subject: string; body: string; locale: string }[],
  mailThrows: false,
  stored: [] as { storageKey: string; bytes: number }[],
  storePutThrows: false,
  signedUrlThrows: false,
  assetRows: [{ id: 'asset-1' }] as { id: string }[],
}))

vi.mock('../config', () => ({
  config: {
    INTERNAL_API_SECRET: SECRET,
    INTERNAL_API_TRUST_PROXY: false,
    WEB_URL: 'http://localhost:3000',
  },
}))

vi.mock('../adapters/file-store', () => ({ FileStoreError: StubFileStoreError }))

/**
 * The stub store, offered under both names the handlers have used.
 *
 * `internal.ts` reads it as `await fileStore()` now — the resolver became a
 * query when object storage moved into `integration_settings`, so that a key
 * pasted at 09:05 works at 09:06 rather than at the next restart. This mock
 * still only answered the older synchronous `adapters().fileStore`, so every
 * upload and signing test called `undefined()` and asserted 200 against a 500.
 *
 * Five tests failed that way, and none of their names suggested a stale mock —
 * "stores the bytes and records the asset" reads like a storage bug. Both
 * shapes are exported here so the file cannot fail that way again for whichever
 * one a handler reaches for.
 */
const stubFileStore = {
  key: 'memory',
  put: async (storageKey: string, bytes: Buffer) => {
    if (harness.storePutThrows) throw new StubFileStoreError('bucket unreachable')
    harness.stored.push({ storageKey, bytes: bytes.byteLength })
    return { storageKey, byteSize: bytes.byteLength, checksum: 'sum' }
  },
  signedUrl: async (key: string) => {
    if (harness.signedUrlThrows) throw new StubFileStoreError('no such object')
    return `https://storage.test/${key}?signed`
  },
}

vi.mock('../adapters/index', () => ({
  fileStore: async () => stubFileStore,
  adapters: () => ({ fileStore: stubFileStore }),
  sendMail: async (_options: unknown, message: Record<string, string>) => {
    if (harness.mailThrows) throw new Error('relay refused: 550 mailbox unavailable')
    harness.mailed.push(message as never)
  },
  smtpOptions: () => ({}),
  /*
    The relay's settings are a row now, so the handler asks for them before it
    builds the options. Stubbed to the shape rather than to a value: nothing in
    the password-reset path reads a field off it, and a stub that answered with
    plausible settings would be asserting something this test does not test.
  */
  mailSettings: async () => ({
    key: 'smtp',
    driver: 'smtp',
    live: true,
    missing: [],
    fromRow: false,
    text: () => undefined,
    number: (_name: string, fallback: number) => fallback,
    bool: (_name: string, fallback: boolean) => fallback,
    secret: () => undefined,
  }),
}))

vi.mock('../pdf/documents', () => ({
  DocumentNotFoundError: StubDocumentNotFound,
  renderInvoicePdf: async (_actor: unknown, id: string) => {
    if (id === 'missing') throw new StubDocumentNotFound('no such invoice')
    return { pdf: Buffer.from('%PDF-invoice'), filename: 'KWI-2026-00042.pdf' }
  },
}))

vi.mock('../pdf/job-documents', () => ({
  JOB_DOCUMENT_KINDS: ['house_bill', 'delivery_order', 'packing_list', 'customs_pack'],
  renderJobDocumentPdf: async (_actor: unknown, id: string) => {
    if (id === 'missing') throw new StubDocumentNotFound('no such job')
    return { pdf: Buffer.from('%PDF-job'), filename: 'house-bill.pdf' }
  },
  renderManifestPdf: async (_actor: unknown, id: string) => {
    if (id === 'missing') throw new StubDocumentNotFound('no such consolidation')
    return { pdf: Buffer.from('%PDF-manifest'), filename: 'manifest.pdf' }
  },
}))

vi.mock('../pdf/store', () => ({
  DocumentTypeNotSeededError: StubDocumentTypeNotSeeded,
  storeJobDocument: async (_actor: unknown, id: string, kind: string) => {
    if (id === 'unseeded') throw new StubDocumentTypeNotSeeded(kind)
    if (id === 'bucket-down') throw new StubFileStoreError('bucket unreachable')
    return { documentId: 'doc-1', version: 2, assetId: 'asset-9' }
  },
}))

/*
  The two AI workers, as the routes see them: what a worker returns, not how it
  got there. Enough to prove the codes travel beside the English.
*/
vi.mock('../workers/quote-cover-note', () => ({
  draftQuoteCoverNote: async (input: { quoteId: string; locale: 'en' | 'ar' }) =>
    input.quoteId === 'sent'
      ? {
          invocationId: null,
          note: null,
          locale: input.locale,
          refusal: 'A covering note can only be drafted on a draft quote.',
          refusalCode: 'not_draft',
        }
      : { invocationId: 'inv-1', note: 'We are pleased to enclose…', locale: input.locale },
}))

vi.mock('../workers/invoice-extract', async () => {
  const { readExtractedInvoice } =
    await vi.importActual<typeof import('@qabandi/core')>('@qabandi/core')
  return {
    extractSupplierInvoice: async () => ({
      invocationId: 'inv-2',
      // A real reading, so the issues are the ones `core` actually produces.
      extracted: readExtractedInvoice(
        {
          invoiceNumber: '',
          invoiceDate: '2026-01-15',
          currency: 'KWD',
          lines: [{ description: 'Ocean freight', amount: '900.000', chargeType: 'MYSTERY' }],
          confidence: 0.9,
        },
        { currencies: new Set(['KWD']), chargeTypes: new Set(['OFR']) },
      ),
      findings: [],
      consistent: false,
      refusal: 'Invoice number: Invoice number is required',
      refusalCode: 'unreadable_fields',
      refusalValues: { count: '2' },
    }),
  }
})

vi.mock('../accounting/export', async () => ({
  ExportError: StubExportError,
  buildAccountingExport: async (_actor: unknown, request: { branchId: string }) => {
    if (request.branchId === 'unmapped') {
      throw new StubExportError('unmapped_charge_types', 'These charge types have no account', {
        namesEn: 'Ocean Freight',
        namesAr: 'شحن بحري',
      })
    }
    if (request.branchId === 'domain') {
      const { DomainError } = await import('@qabandi/core')
      throw new DomainError('unbalanced', 'the journal does not balance')
    }
    if (request.branchId === 'no-receivables') {
      const { AccountingError } = await import('@qabandi/core')
      throw new AccountingError('journal_unmapped', 'No receivables configured', {
        account: 'receivables',
        document: 'invoice',
        reference: 'INV-2026-0001',
      })
    }
    // What the driver throws: an Error with a string `code`, e.g. a unique
    // violation. It has the shape of a refusal and is not one.
    if (request.branchId === 'database') {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      })
    }
    if (request.branchId === 'boom') throw new Error('a bug, not a refusal')
    return { exportId: 'exp-1', status: 'draft', rowCount: 12 }
  },
  voidAccountingExport: async (_actor: unknown, id: string) => {
    if (id === 'already') throw new StubExportError('already_void', 'That export has been voided')
    return { released: 4 }
  },
}))

// The real exports underneath, so every table a handler imports resolves (a
// covering-note handler pulls `locations`, `customers`, `quotes`); the harness
// stubs `db` and `withActor` on top so the tested handlers run against fakes and
// never touch a database.
vi.mock('@qabandi/db', async () => ({
  ...(await vi.importActual<typeof import('@qabandi/db')>('@qabandi/db')),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (harness.principal ? [harness.principal] : []) }),
      }),
    }),
  },
  principals: { locale: 'locale', email: 'email', nameEn: 'name_en', nameAr: 'name_ar' },
  assets: {},
  withActor: async (_actor: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => harness.assetRows }),
          returning: async () => harness.assetRows,
        }),
      }),
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => harness.assetRows }) }),
      }),
    }),
}))

const { internalApi } = await import('./internal')

let app: FastifyInstance

beforeEach(async () => {
  harness.principal = null
  harness.mailed.length = 0
  harness.mailThrows = false
  harness.stored.length = 0
  harness.storePutThrows = false
  harness.signedUrlThrows = false
  harness.assetRows = [{ id: 'asset-1' }]

  app = Fastify({ logger: false })
  await app.register(internalApi, { prefix: '/internal' })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const ACTOR = { principalId: '00000000-0000-7000-8000-0000000000a1', type: 'internal' }

const post = (url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: `/internal${url}`,
    headers: { 'x-internal-secret': SECRET },
    payload: payload as never,
  })

/** The one-line PNG the upload route is happy to take. */
const PNG = Buffer.from('a tiny pretend png').toString('base64')

describe('the internal API’s handlers', () => {
  /**
   * The secret authenticates the *caller*; the actor authorises the *work*. So
   * every route that touches data refuses a body that names no principal,
   * rather than falling back to a system actor — which would make the secret
   * alone enough to read anything.
   */
  describe('naming a principal', () => {
    it.each([
      ['/documents/invoice/x'],
      ['/documents/job/x'],
      ['/documents/manifest/x'],
      ['/accounting/export'],
      ['/accounting/export/x/void'],
    ])('refuses %s with no actor', async (url) => {
      const response = await post(url, {})

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'no_actor' })
    })

    it('refuses an actor with no type, not merely one with no id', async () => {
      const response = await post('/documents/invoice/x', {
        actor: { principalId: '00000000-0000-7000-8000-0000000000a1' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('refuses a request with no body at all', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/documents/invoice/x',
        headers: { 'x-internal-secret': SECRET },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('rendering an invoice', () => {
    it('streams the PDF under the series number', async () => {
      const response = await post('/documents/invoice/inv-1', { actor: ACTOR })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.headers['content-disposition']).toContain('KWI-2026-00042.pdf')
    })

    /** The same URL renders different content per principal, and it is commercial data. */
    it('forbids any proxy from caching it', async () => {
      const response = await post('/documents/invoice/inv-1', { actor: ACTOR })

      expect(response.headers['cache-control']).toBe('private, no-store')
    })

    /** Not found, not forbidden — saying forbidden would confirm it exists. */
    it('answers not found for an invoice this principal cannot see', async () => {
      const response = await post('/documents/invoice/missing', { actor: ACTOR })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    })
  })

  describe('rendering a job document', () => {
    it('streams the document it was asked for', async () => {
      const response = await post('/documents/job/job-1', { actor: ACTOR, kind: 'house_bill' })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
    })

    /**
     * Validated against the list rather than trusted, so an unknown value is a
     * 400 and never a path into the renderer with a bad key. The reply names
     * what is allowed, because the caller is a program.
     */
    it('refuses a kind it does not produce, and says what it does', async () => {
      const response = await post('/documents/job/job-1', {
        actor: ACTOR,
        kind: 'certificate_of_origin',
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('unknown_kind')
      expect(response.json().allowed).toContain('house_bill')
    })

    it('refuses a request that names no kind', async () => {
      const response = await post('/documents/job/job-1', { actor: ACTOR })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('unknown_kind')
    })

    /**
     * `store: true` is issue, not preview: it writes the bytes, versions the
     * previous copy and records the document — so it answers with the record
     * rather than the download, because the caller wanted the former.
     */
    it('returns the record rather than the bytes when asked to store it', async () => {
      const response = await post('/documents/job/job-1', {
        actor: ACTOR,
        kind: 'house_bill',
        store: true,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ documentId: 'doc-1', version: 2, assetId: 'asset-9' })
      expect(response.headers['cache-control']).toBe('private, no-store')
    })

    it('previews without storing when it is not asked to', async () => {
      const response = await post('/documents/job/job-1', {
        actor: ACTOR,
        kind: 'house_bill',
        store: false,
      })

      expect(response.headers['content-type']).toBe('application/pdf')
    })

    it('answers not found for a job this principal cannot see', async () => {
      const response = await post('/documents/job/missing', { actor: ACTOR, kind: 'house_bill' })

      expect(response.statusCode).toBe(404)
      expect(response.json().error).toBe('not_found')
    })

    /**
     * An unseeded document type is not "no such shipment" — the job is right
     * there — so it has its own code, and the kind for the sentence to name.
     */
    it('codes a document type the deployment never seeded', async () => {
      const response = await post('/documents/job/unseeded', {
        actor: ACTOR,
        kind: 'customs_pack',
        store: true,
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().error).toBe('document_type_missing')
      expect(response.json().values).toEqual({ kind: 'customs_pack' })
    })

    it('codes a copy that could not be kept, rather than a bare 500', async () => {
      const response = await post('/documents/job/bucket-down', {
        actor: ACTOR,
        kind: 'house_bill',
        store: true,
      })

      expect(response.statusCode).toBe(502)
      expect(response.json().error).toBe('storage_failed')
    })
  })

  describe('drafting a covering note', () => {
    it('sends the refusal as a code beside its English', async () => {
      const response = await post('/ai/quote-cover-note', {
        actor: ACTOR,
        branchId: 'b1',
        quoteId: 'sent',
        locale: 'ar',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().note).toBeNull()
      expect(response.json().refusalCode).toBe('not_draft')
    })

    it('sends no code when a note was drafted', async () => {
      const response = await post('/ai/quote-cover-note', {
        actor: ACTOR,
        branchId: 'b1',
        quoteId: 'q1',
      })

      expect(response.json().refusalCode).toBeNull()
    })
  })

  describe('reading a supplier bill', () => {
    /** Which field on which line, coded — not only the English `issues`. */
    it('sends each reading issue as a code with its field and line', async () => {
      const response = await post('/ai/supplier-invoice', {
        actor: ACTOR,
        branchId: 'b1',
        assetId: 'asset-1',
        partnerId: 'p1',
        write: true,
      })

      expect(response.statusCode).toBe(200)
      const { readingIssues, issues } = response.json()
      expect(issues).toHaveLength(2)
      expect(readingIssues).toEqual([
        { where: 'header', field: 'invoiceNumber', line: null, code: 'required', values: {} },
        expect.objectContaining({ where: 'line', field: 'chargeType', code: 'unknownReference' }),
      ])
    })
  })

  describe('rendering a manifest', () => {
    /**
     * Streamed only. A manifest is rebuilt from the house list every time,
     * because the house list is exactly what changes up to the cut-off — a
     * stored copy would be authoritative and stale at once.
     */
    it('streams it and never offers to store it', async () => {
      const response = await post('/documents/manifest/con-1', { actor: ACTOR, store: true })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.headers['content-disposition']).toContain('manifest.pdf')
    })

    it('answers not found for a consolidation this principal cannot see', async () => {
      const response = await post('/documents/manifest/missing', { actor: ACTOR })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('the accounting export', () => {
    it('builds the period it was given', async () => {
      const response = await post('/accounting/export', {
        actor: ACTOR,
        branchId: 'b1',
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().exportId).toBe('exp-1')
      expect(response.headers['cache-control']).toBe('private, no-store')
    })

    it('insists on a branch and a period', async () => {
      const response = await post('/accounting/export', { actor: ACTOR, branchId: 'b1' })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'period_required' })
    })

    /** A row the finance manager can go and fix, not a call to support. */
    it('reports a refusal as 422 with the reason', async () => {
      const response = await post('/accounting/export', {
        actor: ACTOR,
        branchId: 'unmapped',
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(response.statusCode).toBe(422)
      expect(response.json().error).toBe('unmapped_charge_types')
      expect(response.json().message).toContain('no account')
      // What the web app's sentence names, in both languages — it translates
      // the code rather than showing `message`.
      expect(response.json().values).toEqual({ namesEn: 'Ocean Freight', namesAr: 'شحن بحري' })
    })

    /**
     * The engine's own refusals arrive as a `DomainError` carrying a `code`
     * rather than as an `ExportError`. They are the same class of thing —
     * something in the period is not what it claims to be — and the operator
     * needs the sentence either way.
     */
    it('reports the engine’s own refusals the same way', async () => {
      const response = await post('/accounting/export', {
        actor: ACTOR,
        branchId: 'domain',
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(response.statusCode).toBe(422)
      expect(response.json().error).toBe('unbalanced')
      expect(response.json().values).toEqual({})
    })

    /** Which account and which invoice travel, so the sentence can name them. */
    it('carries the accounting engine’s values beside its code', async () => {
      const response = await post('/accounting/export', {
        actor: ACTOR,
        branchId: 'no-receivables',
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(response.statusCode).toBe(422)
      expect(response.json().error).toBe('journal_unmapped')
      expect(response.json().values).toEqual({
        account: 'receivables',
        document: 'invoice',
        reference: 'INV-2026-0001',
      })
    })

    /** A bug is not a refusal, and dressing it as 422 would hide it. */
    it('lets a genuine fault surface as a fault', async () => {
      const response = await post('/accounting/export', {
        actor: ACTOR,
        branchId: 'boom',
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(response.statusCode).toBe(500)
    })

    /*
      A PostgreSQL error carries a string `code` too. Matching on that shape
      used to send the driver's raw message to the finance manager as a 422
      "refusal"; only a DomainError is one.
    */
    it('does not mistake a database error for a refusal', async () => {
      const response = await post('/accounting/export', {
        actor: ACTOR,
        branchId: 'database',
        from: '2026-01-01',
        to: '2026-01-31',
      })

      expect(response.statusCode).toBe(500)
    })

    it('voids a posted export', async () => {
      const response = await post('/accounting/export/exp-1/void', {
        actor: ACTOR,
        reason: 'Posted to the wrong period',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ released: 4 })
    })

    it('reports a refused void as 422', async () => {
      const response = await post('/accounting/export/already/void', {
        actor: ACTOR,
        reason: 'again',
      })

      expect(response.statusCode).toBe(422)
      expect(response.json().error).toBe('already_void')
      // Nothing to name, but the field is always there for the web to read.
      expect(response.json().values).toEqual({})
    })
  })

  describe('the password-reset email', () => {
    it('sends it and says so', async () => {
      const response = await post('/mail/password-reset', {
        email: 'someone@example.com',
        url: 'https://app.test/reset?token=abc',
      })

      expect(response.statusCode).toBe(202)
      expect(response.json()).toEqual({ status: 'sent' })
      expect(harness.mailed[0]?.to).toBe('someone@example.com')
      expect(harness.mailed[0]?.body).toContain('https://app.test/reset?token=abc')
    })

    /**
     * The recipient's own language, read from `principals` rather than passed
     * in: the caller is a sign-in page with no session, and a browser's
     * `Accept-Language` is the language of the device, not of the account.
     * Someone whose account is Arabic must get the Arabic mail even when they
     * ask from a colleague's English laptop.
     */
    it('writes in the account’s language, not the browser’s', async () => {
      harness.principal = { locale: 'ar', nameEn: 'Fahad', nameAr: 'فهد' }

      await post('/mail/password-reset', {
        email: 'someone@example.com',
        url: 'https://app.test/reset',
      })

      expect(harness.mailed[0]?.locale).toBe('ar')
      expect(harness.mailed[0]?.subject).toBe('إعادة تعيين كلمة المرور')
      expect(harness.mailed[0]?.body).toContain('فهد')
    })

    it('writes in English for an account that has not chosen', async () => {
      harness.principal = { locale: 'en', nameEn: 'Fahad', nameAr: 'فهد' }

      await post('/mail/password-reset', {
        email: 'someone@example.com',
        url: 'https://app.test/reset',
      })

      expect(harness.mailed[0]?.locale).toBe('en')
      expect(harness.mailed[0]?.subject).toBe('Reset your password')
    })

    /**
     * 202 regardless. Better Auth has already decided whether an account
     * exists; a 404 here would rebuild the enumeration oracle `signIn` is
     * careful not to be (FR-ID-04).
     */
    it('answers the same for an address nobody has', async () => {
      harness.principal = null

      const response = await post('/mail/password-reset', {
        email: 'nobody@example.com',
        url: 'https://app.test/reset',
      })

      expect(response.statusCode).toBe(202)
      expect(response.json()).toEqual({ status: 'sent' })
    })

    it('refuses a request missing the address or the link', async () => {
      expect((await post('/mail/password-reset', { url: 'https://x' })).statusCode).toBe(400)
      expect((await post('/mail/password-reset', { email: 'a@b.c' })).statusCode).toBe(400)
      expect((await post('/mail/password-reset', { email: '', url: '' })).statusCode).toBe(400)
    })

    /**
     * The cause goes to stderr, the class goes on the wire (OP-10). A refused
     * relay's message carries the host, the port and often the mailbox user,
     * and the caller renders this reply into a page an anonymous visitor is
     * looking at.
     */
    it('reports a failed send as a class, not as the relay’s words', async () => {
      harness.mailThrows = true

      const response = await post('/mail/password-reset', {
        email: 'someone@example.com',
        url: 'https://app.test/reset',
      })

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ error: 'mail_failed' })
      expect(JSON.stringify(response.json())).not.toContain('mailbox unavailable')
    })
  })

  describe('uploading a file', () => {
    const upload = (over: Record<string, unknown> = {}) =>
      post('/files/upload', {
        actor: ACTOR,
        branchId: '00000000-0000-7000-8000-0000000000b1',
        fileName: 'signature.png',
        contentType: 'image/png',
        data: PNG,
        ...over,
      })

    it('stores the bytes and records the asset', async () => {
      const response = await upload()

      expect(response.statusCode).toBe(200)
      expect(harness.stored).toHaveLength(1)
      expect(response.json().assetId).toBe('asset-1')
    })

    it('refuses an incomplete request', async () => {
      const response = await post('/files/upload', { actor: ACTOR, fileName: 'x.png' })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'incomplete_request' })
    })

    /** An allow-list, and the reply names it — the caller is a program. */
    it('refuses a type it does not accept, and says which it does', async () => {
      const response = await upload({ contentType: 'application/x-msdownload' })

      expect(response.statusCode).toBe(415)
      expect(response.json().error).toBe('unsupported_type')
      expect(Array.isArray(response.json().allowed)).toBe(true)
    })

    it('refuses an empty file', async () => {
      const response = await upload({ data: '' })

      // An empty `data` is an incomplete request before it is an empty file.
      expect(response.statusCode).toBe(400)
    })

    /**
     * Just over the handler's ceiling, and deliberately not far over.
     *
     * Fastify refuses past its own `bodyLimit` before any handler runs, and
     * that limit defaults to one megabyte — so this assertion failed against a
     * bare `Payload Too Large` until the route raised it. Which is the bug
     * worth remembering: with the default in place the ten-megabyte ceiling
     * below was unreachable and every photograph over about 786KB was refused
     * without a sentence. The body limit is derived from this ceiling, so a
     * file a little over it still arrives and is answered properly.
     */
    it('refuses a file past the ceiling, and says what the ceiling is', async () => {
      const justOver = Buffer.alloc(10 * 1024 * 1024 + 1024).toString('base64')

      const response = await upload({ data: justOver })

      expect(response.statusCode).toBe(413)
      expect(response.json().error).toBe('too_large')
      expect(response.json().maxBytes).toBe(10 * 1024 * 1024)
    })

    /** A real photograph is two to five megabytes, and must simply work. */
    it('accepts a photograph of the size a phone actually produces', async () => {
      const response = await upload({ data: Buffer.alloc(4 * 1024 * 1024).toString('base64') })

      expect(response.statusCode).toBe(200)
      expect(harness.stored[0]?.bytes).toBe(4 * 1024 * 1024)
    })

    /*
      The purpose decides the allow-list, and proof of delivery does not widen.

      A bill is a PDF far more often than it is a photograph, and proof of
      delivery must stay photographs only — an HTML or SVG upload would be a
      stored, signed-URL-served document with script in it. One shared
      allow-list would have to be the union of the two, which is the loosest
      rule applied to the case that matters most.
    */
    it('takes a PDF for a supplier invoice', async () => {
      const response = await upload({
        purpose: 'supplier-invoice',
        contentType: 'application/pdf',
        fileName: 'agent-bill.pdf',
      })

      expect(response.statusCode).toBe(200)
      expect(harness.stored[0]?.storageKey).toMatch(/^bills\//)
    })

    it('still refuses a PDF as proof of delivery', async () => {
      const response = await upload({ purpose: 'pod', contentType: 'application/pdf' })

      expect(response.statusCode).toBe(415)
      expect(response.json().allowed).not.toContain('application/pdf')
    })

    /** Bills and photographs get their own prefixes, so a lifecycle rule can
        speak about one without the other. */
    it('files proof of delivery under its own prefix by default', async () => {
      await upload()

      expect(harness.stored[0]?.storageKey).toMatch(/^pod\//)
    })

    it('refuses a purpose it does not know', async () => {
      const response = await upload({ purpose: 'whatever' })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('unknown_purpose')
    })

    /** Storage being down is not the caller's fault, and 502 says so. */
    it('reports a storage failure as a bad gateway', async () => {
      harness.storePutThrows = true

      const response = await upload()

      expect(response.statusCode).toBe(502)
      expect(response.json().error).toBe('storage_failed')
    })
  })

  describe('signing a download link', () => {
    it('signs the key it was given', async () => {
      const response = await post('/files/signed-url', { storageKey: 'pod/b1/abc.png' })

      expect(response.statusCode).toBe(200)
      expect(response.json().url).toContain('pod/b1/abc.png')
    })

    it('refuses a request with no key', async () => {
      expect((await post('/files/signed-url', {})).statusCode).toBe(400)
      expect((await post('/files/signed-url', { storageKey: '' })).statusCode).toBe(400)
    })

    it('reports a key the store will not sign as a bad request', async () => {
      harness.signedUrlThrows = true

      const response = await post('/files/signed-url', { storageKey: 'gone.png' })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('invalid_request')
    })
  })
})
