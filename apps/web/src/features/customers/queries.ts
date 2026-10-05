/**
 * Customer reads.
 *
 * Every query runs under the caller's actor, so RLS decides what a coordinator
 * in Kuwait sees without this file mentioning branches at all.
 *
 * Each read has a second implementation behind `usePilotFixtures()`, taken
 * before `withActor` rather than inside it — the point of fixture mode is that
 * no database is reached at all, and a branch inside the transaction would
 * still have opened one. Same signature, same return type, so the switch is an
 * environment variable and no page changes. See `lib/pilot/source.ts`.
 */

import { cache } from 'react'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import {
  branches,
  countries,
  customerBranchTerms,
  customerContacts,
  customers,
  withActor,
  type Actor,
} from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pageOf, pageRequest, readPage, type Page, type PageRequest } from '@/lib/paging'
import {
  pilotCustomer,
  pilotCustomerContacts,
  pilotCustomers,
  pilotFormReference,
  pilotHasAnyCustomer,
} from '@/lib/pilot/fixtures'

export interface CustomerRow {
  readonly id: string
  readonly code: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly countryCode: string | null
  readonly isActive: boolean
  readonly branchCode: string | null
  readonly openJobs: number
}

export interface CustomerDetail extends CustomerRow {
  readonly registration: string | null
  readonly taxRegistration: string | null
  readonly primaryBranchId: string | null
  readonly terms: {
    readonly branchId: string
    readonly branchCode: string
    readonly paymentTermsDays: number
    readonly creditLimit: string | null
    readonly creditCurrency: string | null
    readonly freeTimeDays: number | null
    readonly defaultIncoterm: string | null
    /** The house margin "Price it" uses over a buying rate (D8). */
    readonly defaultMarginKind: string | null
    readonly defaultMarginValue: string | null
    readonly isOnHold: boolean
  }[]
}

export async function listCustomers(
  actor: Actor,
  search?: string,
  request: PageRequest = pageRequest(undefined),
): Promise<Page<CustomerRow>> {
  // The search term goes through: a register whose box does nothing is a
  // register the room reads as broken.
  if (usePilotFixtures()) return pageOf(pilotCustomers(search), request)

  return withActor(actor, async (tx) => {
    const term = search?.trim()
    const filter = term
      ? or(
          ilike(customers.legalNameEn, `%${term}%`),
          ilike(customers.code, `%${term}%`),
          ilike(customers.legalNameAr, `%${term}%`),
        )
      : undefined

    /*
      Paged, with a count (R10). This was `limit(200)` with no way past it, so
      with 211 customers the last eleven by name — Jahra Industries among them
      — were missing from the register while the search box still found them.
    */
    return readPage(
      request,
      (limit, offset) =>
        tx
          .select({
            id: customers.id,
            code: customers.code,
            legalNameEn: customers.legalNameEn,
            legalNameAr: customers.legalNameAr,
            countryCode: customers.countryCode,
            isActive: customers.isActive,
            branchCode: branches.code,
            // Counted in the same statement rather than an N+1 per row: at a
            // 300ms round trip, one query per customer is a visibly slow page.
            openJobs: sql<number>`(
          select count(*)::int from jobs j
           where j.customer_id = "customers"."id"
             and j.status not in ('closed', 'cancelled')
        )`,
          })
          .from(customers)
          .leftJoin(branches, eq(branches.id, customers.primaryBranchId))
          .where(filter)
          // `id` breaks ties between two companies with the same name, so no
          // row sits on two pages or on none.
          .orderBy(asc(customers.legalNameEn), asc(customers.id))
          .limit(limit)
          .offset(offset),
      async () => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(customers)
          .where(filter)
        return row?.n ?? 0
      },
    )
  })
}

export const getCustomer = cache(
  async (actor: Actor, customerId: string): Promise<CustomerDetail | null> => {
    if (usePilotFixtures()) return pilotCustomer(customerId)

    return withActor(actor, async (tx) => {
      const [row] = await tx
        .select({
          id: customers.id,
          code: customers.code,
          legalNameEn: customers.legalNameEn,
          legalNameAr: customers.legalNameAr,
          countryCode: customers.countryCode,
          isActive: customers.isActive,
          registration: customers.registration,
          taxRegistration: customers.taxRegistration,
          primaryBranchId: customers.primaryBranchId,
          branchCode: branches.code,
          openJobs: sql<number>`(
          select count(*)::int from jobs j
           where j.customer_id = "customers"."id"
             and j.status not in ('closed', 'cancelled')
        )`,
        })
        .from(customers)
        .leftJoin(branches, eq(branches.id, customers.primaryBranchId))
        .where(eq(customers.id, customerId))
        .limit(1)

      // Invisible under RLS is the same answer as absent — no enumeration
      // signal for another branch's customer (FR-ID-04).
      if (!row) return null

      const terms = await tx
        .select({
          branchId: customerBranchTerms.branchId,
          branchCode: branches.code,
          paymentTermsDays: customerBranchTerms.paymentTermsDays,
          creditLimit: customerBranchTerms.creditLimit,
          creditCurrency: customerBranchTerms.creditCurrency,
          freeTimeDays: customerBranchTerms.freeTimeDays,
          defaultIncoterm: customerBranchTerms.defaultIncoterm,
          defaultMarginKind: customerBranchTerms.defaultMarginKind,
          defaultMarginValue: customerBranchTerms.defaultMarginValue,
          isOnHold: customerBranchTerms.isOnHold,
        })
        .from(customerBranchTerms)
        .innerJoin(branches, eq(branches.id, customerBranchTerms.branchId))
        .where(eq(customerBranchTerms.customerId, customerId))
        .orderBy(asc(branches.code))

      return { ...row, terms }
    })
  },
)

export interface CustomerContactRow {
  readonly id: string
  readonly nameEn: string
  readonly nameAr: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly role: string | null
  readonly isActive: boolean
  /** Joined to a portal login, whose address is changed on the login. */
  readonly hasLogin: boolean
}

/**
 * The people at a customer, with the phone number WhatsApp matching keys on
 * (D3). Inactive contacts are listed too, below the active ones, because a
 * deactivated contact is brought back from here and nothing is deleted.
 */
export async function listCustomerContacts(
  actor: Actor,
  customerId: string,
): Promise<CustomerContactRow[]> {
  if (usePilotFixtures()) return pilotCustomerContacts(customerId)

  return withActor(actor, (tx) =>
    tx
      .select({
        id: customerContacts.id,
        nameEn: customerContacts.nameEn,
        nameAr: customerContacts.nameAr,
        email: customerContacts.email,
        phone: customerContacts.phone,
        role: customerContacts.role,
        isActive: customerContacts.isActive,
        hasLogin: sql<boolean>`${customerContacts.principalId} is not null`,
      })
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId))
      .orderBy(desc(customerContacts.isActive), asc(customerContacts.nameEn))
      .limit(200),
  )
}

export interface BranchOption {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly currency: string
}

export interface FormReference {
  readonly branches: BranchOption[]
  readonly countries: { code: string; name: string }[]
}

/**
 * The reference lists a customer form needs — branches (FR-ID-02) and
 * countries — in **one** transaction, memoised for the request.
 *
 * Both parts matter. Each `withActor` is its own `BEGIN`, `set_config` and
 * `COMMIT`, so two lookups is not two round trips but roughly eight; against a
 * database 300ms away that alone was two and a half seconds. And `cache`
 * collapses the repeat call that `generateMetadata` would otherwise make on
 * the same request. React's `cache` is a per-request memo, not a shared one:
 * two requests never see each other's data, so this is safe under RLS.
 */
export const loadFormReference = cache(
  async (actor: Actor, locale: 'en' | 'ar'): Promise<FormReference> => {
    if (usePilotFixtures()) return pilotFormReference(locale)

    return withActor(actor, async (tx) => {
      const branchRows = await tx
        .select({
          id: branches.id,
          code: branches.code,
          nameEn: branches.legalNameEn,
          nameAr: branches.legalNameAr,
          currency: branches.baseCurrency,
        })
        .from(branches)
        .where(eq(branches.isActive, true))
        .orderBy(asc(branches.code))

      const countryRows = await tx
        .select({ code: countries.code, nameEn: countries.nameEn, nameAr: countries.nameAr })
        .from(countries)

      /*
      Named in the operator's language. Both lists read only the English
      column, so an Arabic form offered "Kuwait" and "Your Company Co." among
      Arabic labels. Sorted by the name shown, in that language's order.
    */
      const named = (en: string, ar: string | null) => (locale === 'ar' && ar ? ar : en)
      return {
        branches: branchRows.map(({ nameEn, nameAr, ...row }) => ({
          ...row,
          name: named(nameEn, nameAr),
        })),
        countries: countryRows
          .map(({ code, nameEn, nameAr }) => ({ code, name: named(nameEn, nameAr) }))
          .sort((a, b) => a.name.localeCompare(b.name, locale)),
      }
    })
  },
)

/**
 * Whether the operator has any customers yet.
 *
 * Drives the onboarding checklist. A `limit 1` existence check rather than a
 * count: the answer is a boolean and the table could be long.
 */
export async function hasAnyCustomer(actor: Actor): Promise<boolean> {
  if (usePilotFixtures()) return pilotHasAnyCustomer()

  return withActor(actor, async (tx) => {
    const [row] = await tx.select({ id: customers.id }).from(customers).limit(1)
    return Boolean(row)
  })
}

/** Used by the code field to tell the operator a code is taken before submit. */
export async function customerCodeExists(
  actor: Actor,
  code: string,
  exceptId?: string,
): Promise<boolean> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        exceptId
          ? and(eq(customers.code, code), sql`${customers.id} <> ${exceptId}`)
          : eq(customers.code, code),
      )
      .limit(1)
    return Boolean(row)
  })
}
