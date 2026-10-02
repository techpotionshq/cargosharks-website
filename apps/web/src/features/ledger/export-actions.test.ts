/**
 * Closing a period, from the browser's side of the boundary.
 *
 * The work happens in the service — the arithmetic would run anywhere, but the
 * *file* has to be stored and storage credentials live in one process by
 * design (§3). So what this file is actually about is what `apps/web` decides
 * before it hands the actor across: the permission, the branch, and whether
 * the dates are dates.
 *
 * Two of the assertions are about sentences rather than behaviour, and they
 * matter more than they look.
 *
 * **A 422 carries a reason the finance manager can act on.** An unmapped
 * charge type names itself; a missing control account names itself. Every one
 * of them is a row they can go and fix, and replacing it with "the export
 * failed" sends them to support about their own chart of accounts.
 *
 * **An empty period is reported, not celebrated.** A successful export of
 * nothing looks identical to a successful export of January until somebody
 * opens the file, so zero rows comes back as a refusal that says which of the
 * two happened.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ session: null as unknown, locale: 'en' }))

/*
  This suite runs the real action with the database mocked out, so the unset
  DATABASE_URL that would put the app in fixture mode is not a demo here.
*/
vi.mock('@/lib/pilot/read-only', () => ({
  demoReadOnly: async () => null,
  demoReadOnlyMessage: async () => null,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
  // Which language an unmapped charge type is named in.
  getLocale: async () => harness.locale,
}))

const HOME_BRANCH = '00000000-0000-7000-8000-00000000c001'
const AWAY_BRANCH = '00000000-0000-7000-8000-00000000c002'
const PRINCIPAL = '00000000-0000-7000-8000-00000000c006'

const { createAccountingExport, voidAccountingExportAction } = await import('./export-actions')

function sessionWith(permissions: readonly string[]) {
  return {
    actor: { principalId: PRINCIPAL, type: 'internal', branchIds: [HOME_BRANCH, AWAY_BRANCH] },
    principal: {
      id: PRINCIPAL,
      nameEn: 'Finance Manager',
      nameAr: null,
      email: 'finance@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([
      [HOME_BRANCH, 'finance'],
      [AWAY_BRANCH, 'finance'],
    ]),
    requiresTwoFactor: false,
  }
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const period = (extra: Record<string, string> = {}) =>
  form({ branchId: HOME_BRANCH, from: '2026-01-01', to: '2026-01-31', ...extra })

/** What the service answers on a period that had something in it. */
const built = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    exportId: '00000000-0000-7000-8000-0000000000e1',
    status: 'draft',
    rowCount: 12,
    invoiceCount: 4,
    costCount: 6,
    paymentCount: 2,
    ...over,
  }),
})

describe('closing a period', () => {
  const fetchMock = vi.fn()

  beforeAll(() => {
    harness.session = sessionWith(['finance.export'])
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('SERVICE_URL', 'http://service.test/')
    vi.stubEnv('INTERNAL_API_SECRET', 'secret')
  })

  afterEach(() => {
    fetchMock.mockReset()
  })

  afterAll(() => {
    harness.session = null
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  describe('building one', () => {
    it('hands the actor and the period across the boundary', async () => {
      fetchMock.mockResolvedValue(built())

      const state = await createAccountingExport({}, period())

      expect(state.message).toBeUndefined()
      const [url, init] = fetchMock.mock.calls[0]!
      // The trailing slash on SERVICE_URL is trimmed, not doubled.
      expect(url).toBe('http://service.test/internal/accounting/export')

      const body = JSON.parse((init as { body: string }).body)
      expect(body.branchId).toBe(HOME_BRANCH)
      expect(body.from).toBe('2026-01-01')
      expect(body.actor.principalId).toBe(PRINCIPAL)
      // A draft unless the form said otherwise.
      expect(body.post).toBe(false)
    })

    it('authenticates itself to the service', async () => {
      fetchMock.mockResolvedValue(built())
      await createAccountingExport({}, period())

      const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }
      expect(init.headers['x-internal-secret']).toBe('secret')
    })

    it('posts the period when the form asked it to', async () => {
      fetchMock.mockResolvedValue(built({ status: 'posted' }))
      await createAccountingExport({}, period({ post: 'true' }))

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
      expect(body.post).toBe(true)
    })

    it('returns the export it built', async () => {
      fetchMock.mockResolvedValue(built())
      const state = await createAccountingExport({}, period())

      expect(String(state.ok)).toContain('00000000-0000-7000-8000-0000000000e1')
    })

    /**
     * A successful export of nothing looks identical to a successful export of
     * January until somebody opens the file. This says which happened.
     */
    it('says so when the period held nothing to post', async () => {
      fetchMock.mockResolvedValue(built({ rowCount: 0, invoiceCount: 0 }))

      const state = await createAccountingExport({}, period())

      expect(state.message).toBe('ledgerValidation.nothingToPost')
    })

    it('asks for a branch and a period when either is missing', async () => {
      expect((await createAccountingExport({}, form({}))).message).toBe(
        'ledgerValidation.chooseBranchAndPeriod',
      )
      expect((await createAccountingExport({}, period({ to: '' }))).message).toBe(
        'ledgerValidation.chooseBranchAndPeriod',
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a date that is not one', async () => {
      const state = await createAccountingExport({}, period({ from: '01/01/2026' }))
      expect(state.message).toBe('ledgerValidation.datesFormat')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a period that ends before it starts', async () => {
      const state = await createAccountingExport(
        {},
        period({ from: '2026-01-31', to: '2026-01-01' }),
      )
      expect(state.message).toBe('ledgerValidation.periodEndsBeforeStart')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a branch the manager does not hold', async () => {
      await expect(
        createAccountingExport({}, period({ branchId: '00000000-0000-7000-8000-0000000000e9' })),
      ).resolves.toMatchObject({ message: expect.stringContaining('forbiddenAction') })
    })

    it('refuses a caller without the export permission', async () => {
      harness.session = sessionWith(['invoice.approve'])
      try {
        await expect(createAccountingExport({}, period())).resolves.toMatchObject({
          message: expect.stringContaining('forbiddenAction'),
        })
      } finally {
        harness.session = sessionWith(['finance.export'])
      }
    })

    it('names the variables that are missing rather than dialling nothing', async () => {
      vi.stubEnv('SERVICE_URL', '')
      try {
        const state = await createAccountingExport({}, period())
        expect(state.message).toBe('ledgerValidation.exportServiceNotConfigured')
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        vi.stubEnv('SERVICE_URL', 'http://service.test/')
      }
    })

    /** The row they can go and fix, rather than a ticket to support. */
    const unmapped = {
      ok: false,
      status: 422,
      json: async () => ({
        error: 'unmapped_charge_types',
        message: 'These charge types have no account against them: Ocean Freight.',
        values: { namesEn: 'Ocean Freight', namesAr: 'شحن بحري' },
      }),
    }

    it('translates the service’s reason, naming what to fix', async () => {
      fetchMock.mockResolvedValue(unmapped)

      const state = await createAccountingExport({}, period())

      expect(state.message).toBe(
        'ledgerValidation.exportUnmappedChargeTypes:{"names":"Ocean Freight"}',
      )
    })

    /** The list sits inside the sentence, so it is named in the reader's language. */
    it('names the charge types in Arabic for an Arabic reader', async () => {
      fetchMock.mockResolvedValue(unmapped)
      harness.locale = 'ar'
      try {
        const state = await createAccountingExport({}, period())
        expect(state.message).toBe(
          'ledgerValidation.exportUnmappedChargeTypes:{"names":"شحن بحري"}',
        )
      } finally {
        harness.locale = 'en'
      }
    })

    it('translates the engine’s own refusals by code', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: 'journal_unbalanced', message: 'Journal is out by 0.5 KWD' }),
      })

      const state = await createAccountingExport({}, period())
      expect(state.message).toBe('ledgerValidation.exportJournalUnbalanced')
    })

    /** A refusal is only actionable if it says which invoice and which account. */
    const engineRefusal = (error: string, values: Record<string, string>) => ({
      ok: false,
      status: 422,
      json: async () => ({ error, message: 'English, for the log', values }),
    })

    it('names how far out the journal is, the amount as the decimal string sent', async () => {
      fetchMock.mockResolvedValue(
        engineRefusal('journal_unbalanced', { amount: '0.004', currency: 'KWD' }),
      )

      const state = await createAccountingExport({}, period())
      expect(state.message).toBe(
        'ledgerValidation.exportJournalUnbalancedBy:{"amount":"0.004","currency":"KWD"}',
      )
    })

    it('names the missing account and the invoice it stopped', async () => {
      fetchMock.mockResolvedValue(
        engineRefusal('journal_unmapped', {
          account: 'receivables',
          document: 'invoice',
          reference: 'KWI-2026-00001',
        }),
      )

      const state = await createAccountingExport({}, period())
      expect(state.message).toBe(
        'ledgerValidation.exportJournalAccountMissing:' +
          '{"account":"receivables","document":"invoice","reference":"KWI-2026-00001"}',
      )
    })

    it('names an unmapped charge type in the reader’s language', async () => {
      fetchMock.mockResolvedValue(
        engineRefusal('journal_unmapped', {
          account: 'revenue',
          document: 'invoice',
          reference: 'KWI-2026-00001',
          chargeTypeEn: 'Legalisation',
          chargeTypeAr: 'تصديق',
        }),
      )
      harness.locale = 'ar'
      try {
        const state = await createAccountingExport({}, period())
        expect(state.message).toBe(
          'ledgerValidation.exportJournalChargeTypeUnmapped:' +
            '{"chargeType":"تصديق","account":"revenue","document":"invoice","reference":"KWI-2026-00001"}',
        )
      } finally {
        harness.locale = 'en'
      }
    })

    it('names the line with no charge type and the document it is on', async () => {
      fetchMock.mockResolvedValue(
        engineRefusal('journal_unmapped_line', {
          document: 'supplier_invoice',
          reference: 'SUP-778',
          line: 'Sundry',
        }),
      )

      const state = await createAccountingExport({}, period())
      expect(state.message).toBe(
        'ledgerValidation.exportJournalLineNoChargeType:' +
          '{"line":"Sundry","document":"supplier_invoice","reference":"SUP-778"}',
      )
    })

    /**
     * A code this side does not know yet is never answered with the English
     * `message` — the fallback says the service refused, in the reader's language.
     */
    it('falls back rather than showing an unknown code’s English', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: 'something_new', message: 'An English sentence' }),
      })

      const state = await createAccountingExport({}, period())
      expect(state.message).toBe('ledgerValidation.exportServiceRefused:{"status":"422"}')
    })

    it('falls back to the status where the service said nothing', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json')
        },
      })

      const state = await createAccountingExport({}, period())
      expect(state.message).toBe('ledgerValidation.exportServiceRefused:{"status":"503"}')
    })
  })

  describe('voiding one', () => {
    const voidForm = (extra: Record<string, string> = {}) =>
      form({ exportId: '00000000-0000-7000-8000-0000000000e1', reason: 'Wrong period', ...extra })

    it('asks the service to release what the export consumed', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ released: 4 }) })

      await voidAccountingExportAction({}, voidForm())

      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe(
        'http://service.test/internal/accounting/export/00000000-0000-7000-8000-0000000000e1/void',
      )
      expect(JSON.parse((init as { body: string }).body).reason).toBe('Wrong period')
    })

    /**
     * "Why was March posted twice" is answered by that row or by nobody.
     *
     * On the field rather than thrown: the reason is the whole record, and a
     * dialog that throws loses what the finance manager had already typed.
     */
    it('refuses a void with no reason, on the field', async () => {
      const state = await voidAccountingExportAction({}, voidForm({ reason: '' }))

      expect(state.errors?.reason).toBe('ledgerValidation.sayWhyUnwound')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a void with nothing to void', async () => {
      const state = await voidAccountingExportAction({}, voidForm({ exportId: '' }))

      expect(state.message).toBe('ledgerValidation.nothingToVoid')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a caller without the export permission', async () => {
      harness.session = sessionWith([])
      try {
        await expect(voidAccountingExportAction({}, voidForm())).resolves.toMatchObject({
          message: expect.stringContaining('forbiddenAction'),
        })
      } finally {
        harness.session = sessionWith(['finance.export'])
      }
    })

    it('names the variables that are missing', async () => {
      vi.stubEnv('INTERNAL_API_SECRET', '')
      try {
        const state = await voidAccountingExportAction({}, voidForm())
        expect(state.message).toBe('ledgerValidation.serviceSecretsRequired')
      } finally {
        vi.stubEnv('INTERNAL_API_SECRET', 'secret')
      }
    })

    it('translates the service’s reason', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: 'already_void',
          message: 'That export has already been voided',
          values: {},
        }),
      })

      const state = await voidAccountingExportAction({}, voidForm())
      expect(state.message).toBe('ledgerValidation.exportAlreadyVoid')
    })

    it('falls back to a plain sentence where the service said nothing', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => null,
      })

      const state = await voidAccountingExportAction({}, voidForm())
      expect(state.message).toBe('ledgerValidation.exportNotVoided')
    })
  })
})
