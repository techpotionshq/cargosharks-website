/**
 * A customer's contacts, written from the customer's page (D3).
 *
 * WhatsApp files an inbound message under a customer by the contact's phone,
 * and only a CSV import could set it. What is pinned here: the number is
 * stored the way the matcher reads it, a number another customer already
 * holds is refused (the matcher would match neither), a portal login's
 * address is not changed behind its back, nothing is deleted, and the
 * permission is held in the customer's own branch.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { customerContacts, customers, principals, systemActor, withActor } =
  await import('@qabandi/db')
const { AWAY_BRANCH, HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')
const { saveCustomerContact, setCustomerContactActive } = await import('./contacts')

function sessionWith(permissions: readonly string[], onlyIn?: string) {
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
    ...(onlyIn
      ? {
          branchPermissions: new Map([
            [HOME_BRANCH, new Set(onlyIn === HOME_BRANCH ? permissions : [])],
            [AWAY_BRANCH, new Set(onlyIn === AWAY_BRANCH ? permissions : [])],
          ]),
        }
      : {}),
    requiresTwoFactor: false,
  }
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
// A number unique to this run, so suites sharing a database never collide.
// Leading 5, as a Kuwaiti mobile does: a leading 0 would be read as a trunk prefix.
const LOCAL = `5${String(Date.now()).slice(-6)}`
let seq = 0

async function newCustomer(primaryBranchId: string = HOME_BRANCH): Promise<string> {
  seq += 1
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .insert(customers)
      .values({
        code: `CC${RUN}${seq}`,
        legalNameEn: `Contact Test ${seq}`,
        primaryBranchId,
      })
      .returning({ id: customers.id }),
  )
  return row!.id
}

const contactsOf = (customerId: string) =>
  withActor(bothBranchesActor, (tx) =>
    tx.select().from(customerContacts).where(eq(customerContacts.customerId, customerId)),
  )

describe.skipIf(!enabled)('customer contacts', () => {
  beforeAll(async () => {
    await world()
    harness.session = sessionWith(['customer.write'])
  })

  it('adds a contact with the phone stored the way WhatsApp matching reads it', async () => {
    const customerId = await newCustomer()
    // Arabic-Indic digits: the matcher's digits-only comparison stripped
    // these to nothing, so a number typed this way never matched.
    const arabic = `+٩٦٥ ${LOCAL.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)))}0`
    const state = await saveCustomerContact(
      {},
      form({
        customerId,
        nameEn: 'Maryam Buyer',
        nameAr: 'مريم',
        email: 'Maryam@Example.test',
        phone: arabic,
        role: 'Purchasing',
      }),
    )
    expect(state.ok).toBeDefined()

    const [contact] = await contactsOf(customerId)
    expect(contact?.phone).toBe(`+965${LOCAL}0`)
    expect(contact?.email).toBe('maryam@example.test')
    expect(contact?.role).toBe('Purchasing')
    expect(contact?.isActive).toBe(true)
  })

  it('edits the name, email, phone and role in place', async () => {
    const customerId = await newCustomer()
    await saveCustomerContact({}, form({ customerId, nameEn: 'Old Name', phone: `${LOCAL}1` }))
    const [before] = await contactsOf(customerId)

    const state = await saveCustomerContact(
      {},
      form({
        customerId,
        contactId: before!.id,
        nameEn: 'New Name',
        email: 'new@example.test',
        phone: `+965 ${LOCAL}2`,
        role: 'Logistics',
      }),
    )
    expect(state.ok).toBeDefined()

    const rows = await contactsOf(customerId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: before!.id,
      nameEn: 'New Name',
      email: 'new@example.test',
      phone: `+965${LOCAL}2`,
      role: 'Logistics',
    })
  })

  it('refuses a number that is not one', async () => {
    const customerId = await newCustomer()
    const state = await saveCustomerContact({}, form({ customerId, nameEn: 'Short', phone: '123' }))
    expect(state.errors?.phone).toBe('customerContacts.validPhone')
    expect(await contactsOf(customerId)).toHaveLength(0)
  })

  /** The matcher refuses a sender two customers share, so both would go unmatched. */
  it('refuses a number another customer holds, in any of its spellings', async () => {
    const first = await newCustomer()
    const second = await newCustomer()
    const held = await saveCustomerContact(
      {},
      form({ customerId: first, nameEn: 'Holder', phone: `${LOCAL}3` }),
    )
    expect(held.ok, JSON.stringify(held)).toBeDefined()

    const clash = await saveCustomerContact(
      {},
      form({ customerId: second, nameEn: 'Second', phone: `+965 ${LOCAL}3` }),
    )
    expect(clash.errors?.phone, JSON.stringify(clash)).toBe('customerContacts.phoneTaken')

    // Once the first contact is deactivated, the number is free.
    const [holder] = await contactsOf(first)
    await setCustomerContactActive({}, form({ customerId: first, contactId: holder!.id }))
    const free = await saveCustomerContact(
      {},
      form({ customerId: second, nameEn: 'Second', phone: `+965 ${LOCAL}3` }),
    )
    expect(free.ok).toBeDefined()

    // And bringing the first back is a new claim, refused like one.
    const back = await setCustomerContactActive(
      {},
      form({ customerId: first, contactId: holder!.id, isActive: 'true' }),
    )
    expect(back.message).toBe('customerContacts.phoneTaken')
  })

  it('deactivates and brings back without deleting', async () => {
    const customerId = await newCustomer()
    await saveCustomerContact({}, form({ customerId, nameEn: 'Toggled', phone: `${LOCAL}4` }))
    const [contact] = await contactsOf(customerId)

    await setCustomerContactActive({}, form({ customerId, contactId: contact!.id }))
    expect((await contactsOf(customerId))[0]?.isActive).toBe(false)

    await setCustomerContactActive(
      {},
      form({ customerId, contactId: contact!.id, isActive: 'true' }),
    )
    const rows = await contactsOf(customerId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.isActive).toBe(true)
  })

  it('leaves a portal login’s address to the login', async () => {
    const customerId = await newCustomer()
    const email = `portal-${RUN.toLowerCase()}@example.test`
    // A customer_contact principal is written by the invite path's authority;
    // the system actor stands in for it here.
    await withActor(systemActor(), async (tx) => {
      const [principal] = await tx
        .insert(principals)
        .values({ type: 'customer_contact', customerId, email, nameEn: 'Portal Person' })
        .returning({ id: principals.id })
      await tx
        .insert(customerContacts)
        .values({ customerId, principalId: principal!.id, nameEn: 'Portal Person', email })
    })
    const [contact] = await contactsOf(customerId)

    const moved = await saveCustomerContact(
      {},
      form({ customerId, contactId: contact!.id, nameEn: 'Portal Person', email: 'x@y.test' }),
    )
    expect(moved.errors?.email).toBe('customerContacts.emailOnLogin')

    const phoned = await saveCustomerContact(
      {},
      form({
        customerId,
        contactId: contact!.id,
        nameEn: 'Portal Person',
        email,
        phone: `${LOCAL}5`,
      }),
    )
    expect(phoned.ok).toBeDefined()
    expect((await contactsOf(customerId))[0]?.phone).toBe(`${LOCAL}5`)
  })

  it('needs customer.write in the customer’s own branch', async () => {
    const away = await newCustomer(AWAY_BRANCH)
    harness.session = sessionWith(['customer.write'], HOME_BRANCH)
    try {
      const state = await saveCustomerContact({}, form({ customerId: away, nameEn: 'Nope' }))
      expect(state.message).toContain('forbiddenAction')
      expect(await contactsOf(away)).toHaveLength(0)
    } finally {
      harness.session = sessionWith(['customer.write'])
    }
  })

  it('refuses a caller who may not write customers', async () => {
    const customerId = await newCustomer()
    harness.session = sessionWith([])
    try {
      const state = await saveCustomerContact({}, form({ customerId, nameEn: 'Nope' }))
      expect(state.message).toContain('forbiddenAction')
    } finally {
      harness.session = sessionWith(['customer.write'])
    }
  })
})
