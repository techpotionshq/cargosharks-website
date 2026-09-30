/**
 * Customer mutations.
 *
 * One property carries the slice, and it is the reason `createCustomer` writes
 * two tables: **a customer with no payment terms is a customer nobody can
 * invoice.** Both writes are in one transaction, because splitting them is
 * exactly how that row gets created — the first insert succeeds, the second
 * fails or is skipped, and the record looks complete on every screen until
 * somebody tries to bill it.
 *
 * The update path upserts the terms rather than updating them, which is not
 * defensive: the primary branch may have moved to one that has no terms row
 * yet, and an update would silently write nothing.
 *
 * And nothing is deleted (FR-ID-09, §5.5). A customer with shipment history
 * cannot be removed without taking the history with it, so the record stays
 * and stops being selectable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown, redirected: null as string | null }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

/*
  `redirect()` throws in Next — that is how it unwinds the render — so a stub
  that returned normally would let `createCustomer` fall off the end and hide
  the fact that it navigates at all. This records where it went and throws the
  same way.
*/
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    harness.redirected = to
    throw new Error(`NEXT_REDIRECT:${to}`)
  },
}))

const { customerBranchTerms, customers, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { createCustomer, updateCustomer, setCustomerActive } = await import('./actions')

function sessionWith(permissions: readonly string[]) {
  return {
    actor: bothBranchesActor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Customer Desk',
      nameAr: null,
      email: 'customers@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([
      [HOME_BRANCH, 'operations_manager'],
      [AWAY_BRANCH, 'operations_manager'],
    ]),
    requiresTwoFactor: false,
  }
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
const nextCode = () => `CU${RUN}${(seq += 1)}`

const customerForm = (extra: Record<string, string> = {}) =>
  form({
    code: nextCode(),
    legalNameEn: 'Test Trading Company',
    primaryBranchId: HOME_BRANCH,
    paymentTermsDays: '30',
    isActive: 'on',
    ...extra,
  })

const byCode = async (value: string) => {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx.select().from(customers).where(eq(customers.code, value)),
  )
  return row
}

const termsFor = async (customerId: string, branchId: string) => {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select()
      .from(customerBranchTerms)
      .where(
        and(
          eq(customerBranchTerms.customerId, customerId),
          eq(customerBranchTerms.branchId, branchId),
        ),
      ),
  )
  return row
}

/** `createCustomer` navigates on success, and `redirect()` throws to do it. */
async function create(data: FormData) {
  harness.redirected = null
  try {
    return { state: await createCustomer({}, data), redirected: harness.redirected }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) {
      return { state: undefined, redirected: harness.redirected }
    }
    throw error
  }
}

describe.skipIf(!enabled)('customers', () => {
  beforeAll(async () => {
    await world()
    harness.session = sessionWith(['customer.write'])
  })

  afterAll(() => {
    harness.session = null
  })

  describe('creating', () => {
    it('writes the customer and its terms together', async () => {
      const code = nextCode()
      const { redirected } = await create(customerForm({ code, paymentTermsDays: '45' }))

      const customer = await byCode(code)
      expect(customer).toBeDefined()
      expect(redirected).toBe(`/customers/${customer!.id}`)

      const terms = await termsFor(customer!.id, HOME_BRANCH)
      expect(terms?.paymentTermsDays).toBe(45)
    })

    it('records a credit limit as a decimal, not a float', async () => {
      const code = nextCode()
      await create(customerForm({ code, creditLimit: '12500.750', creditCurrency: 'kwd' }))

      const customer = await byCode(code)
      const terms = await termsFor(customer!.id, HOME_BRANCH)
      // Three decimals survive, because KWD has three.
      expect(terms?.creditLimit).toBe('12500.750000')
      expect(terms?.creditCurrency).toBe('KWD')
    })

    it('defaults the terms to thirty days when none were given', async () => {
      const code = nextCode()
      const data = customerForm({ code })
      data.delete('paymentTermsDays')
      await create(data)

      const customer = await byCode(code)
      expect((await termsFor(customer!.id, HOME_BRANCH))?.paymentTermsDays).toBe(30)
    })

    it('records free time and a default Incoterm', async () => {
      const code = nextCode()
      await create(customerForm({ code, freeTimeDays: '7', defaultIncoterm: 'CIF' }))

      const customer = await byCode(code)
      const terms = await termsFor(customer!.id, HOME_BRANCH)
      expect(terms?.freeTimeDays).toBe(7)
      expect(terms?.defaultIncoterm).toBe('CIF')
    })

    it('uppercases the country', async () => {
      const code = nextCode()
      await create(customerForm({ code, countryCode: 'kw' }))
      expect((await byCode(code))?.countryCode).toBe('KW')
    })

    /** Caught rather than pre-checked — the select-then-insert is the race. */
    it('reports a duplicate code on the field rather than raising', async () => {
      const code = nextCode()
      await create(customerForm({ code }))

      const { state } = await create(customerForm({ code }))

      expect(state?.errors?.code).toBe('customersValidation.codeInUse')
      expect(state?.values?.code).toBe(code)
    })

    it('insists on a legal name', async () => {
      const { state } = await create(customerForm({ legalNameEn: 'X' }))
      expect(state?.errors?.legalNameEn).toBeDefined()
    })

    it('insists on a branch', async () => {
      const { state } = await create(customerForm({ primaryBranchId: '' }))
      expect(state?.errors?.primaryBranchId).toBeDefined()
    })

    it('refuses payment terms beyond a year', async () => {
      const { state } = await create(customerForm({ paymentTermsDays: '400' }))
      expect(state?.errors?.paymentTermsDays).toBeDefined()
    })

    it('refuses a credit limit that is not a number', async () => {
      const { state } = await create(customerForm({ creditLimit: 'lots' }))
      expect(state?.errors?.creditLimit).toBeDefined()
    })

    it('refuses a branch the desk does not hold', async () => {
      await expect(
        createCustomer(
          {},
          customerForm({ primaryBranchId: '00000000-0000-7000-8000-0000000000cb' }),
        ),
      ).rejects.toThrow('branch:')
    })

    it('refuses a caller who may not write customers', async () => {
      harness.session = sessionWith([])
      try {
        await expect(createCustomer({}, customerForm())).rejects.toThrow('customer.write')
      } finally {
        harness.session = sessionWith(['customer.write'])
      }
    })
  })

  describe('editing', () => {
    async function existing(extra: Record<string, string> = {}) {
      const code = nextCode()
      await create(customerForm({ code, ...extra }))
      return { code, row: (await byCode(code))! }
    }

    it('renames without adding a second record', async () => {
      const { code, row } = await existing()

      const state = await updateCustomer(
        {},
        customerForm({ customerId: row.id, code, legalNameEn: 'Renamed Trading Company' }),
      )

      expect(state.message).toBe('saved')
      expect((await byCode(code))?.legalNameEn).toBe('Renamed Trading Company')
    })

    it('changes the terms it already had', async () => {
      const { code, row } = await existing({ paymentTermsDays: '30' })

      await updateCustomer({}, customerForm({ customerId: row.id, code, paymentTermsDays: '60' }))

      expect((await termsFor(row.id, HOME_BRANCH))?.paymentTermsDays).toBe(60)
    })

    /**
     * Upsert rather than update, and this is why: moving the primary branch
     * lands on a branch with no terms row, where an update writes nothing and
     * leaves a customer nobody in that branch can invoice.
     */
    it('creates the terms when the primary branch moves somewhere new', async () => {
      const { code, row } = await existing()
      expect(await termsFor(row.id, AWAY_BRANCH)).toBeUndefined()

      await updateCustomer(
        {},
        customerForm({
          customerId: row.id,
          code,
          primaryBranchId: AWAY_BRANCH,
          paymentTermsDays: '15',
        }),
      )

      expect((await termsFor(row.id, AWAY_BRANCH))?.paymentTermsDays).toBe(15)
      // The old branch's terms are left alone — the history is still true.
      expect(await termsFor(row.id, HOME_BRANCH)).toBeDefined()
    })

    it('reports a code taken by somebody else rather than raising', async () => {
      const first = await existing()
      const second = await existing()

      const state = await updateCustomer(
        {},
        customerForm({ customerId: second.row.id, code: first.code }),
      )

      expect(state.errors?.code).toBe('customersValidation.codeInUse')
    })

    it('needs an identifier to edit anything', async () => {
      const state = await updateCustomer({}, customerForm({ customerId: '' }))
      expect(state.errors?.customerId).toBeDefined()
    })

    /** Invisible under RLS is not-found, with no enumeration signal. */
    it('treats a customer it cannot see as missing', async () => {
      await expect(
        updateCustomer({}, customerForm({ customerId: '00000000-0000-7000-8000-0000000000cf' })),
      ).rejects.toThrow('not_found')
    })
  })

  describe('retiring rather than deleting — FR-ID-09', () => {
    /*
      Presence of `isActive` is the signal, not its value — the checkbox
      convention every form in the application follows. Retiring omits the
      field; bringing one back sends it.
    */
    const retire = (customerId: string) => setCustomerActive({}, form({ customerId }))
    const restore = (customerId: string) =>
      setCustomerActive({}, form({ customerId, isActive: 'true' }))

    it('stops the customer being selectable and keeps the row', async () => {
      const code = nextCode()
      await create(customerForm({ code }))
      const row = await byCode(code)

      await retire(row!.id)

      const after = await byCode(code)
      expect(after).toBeDefined()
      expect(after!.isActive).toBe(false)
    })

    it('brings one back', async () => {
      const code = nextCode()
      await create(customerForm({ code }))
      const row = await byCode(code)

      await retire(row!.id)
      await restore(row!.id)

      expect((await byCode(code))?.isActive).toBe(true)
    })

    /** A form with no customer on it is a no-op, not a crash. */
    it('says so plainly when no customer was named', async () => {
      const state = await setCustomerActive({}, form({}))

      expect(state.message).toBe('customersValidation.nothingToUpdate')
    })

    it('refuses a caller who may not write customers', async () => {
      harness.session = sessionWith([])
      try {
        await expect(retire('00000000-0000-7000-8000-0000000000cd')).rejects.toThrow(
          'customer.write',
        )
      } finally {
        harness.session = sessionWith(['customer.write'])
      }
    })
  })
})
