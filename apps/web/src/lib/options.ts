/**
 * Select options — every list a form needs, in one round trip.
 *
 * Fourteen create-forms need some overlapping subset of the same twelve lists.
 * The obvious implementation is twelve `select`s in a transaction, and it is
 * wrong for a reason that is easy to miss: `node-postgres` sends queries on a
 * connection **sequentially**, so wrapping them in `Promise.all` does not
 * overlap them. Twelve queries against a database ~325ms away is four seconds
 * before a dialog can render its first `<option>` — and, because each one
 * holds a pooled connection for that whole time, a page rendering two such
 * forms exhausts the pool and starts timing out.
 *
 * So this is a single statement. Each list is aggregated to JSON in the
 * database and the whole thing comes back as one row: **one** round trip,
 * **one** connection, ~325ms. The cost is that the query is written in SQL
 * rather than in the query builder, which for a projection this shallow — id,
 * code, label, group — is a fair trade and is confined to this file.
 *
 * Memoised with React's `cache`, which is a *per-request* memo rather than a
 * shared one: two concurrent requests from two principals never see each
 * other's rows, which is what makes it safe under RLS at all.
 *
 * Each list is capped. A `<select>` holding four thousand ports is not a
 * usable control, and the cap is the forcing function that says so — the long
 * lists belong behind their own search.
 *
 * The whole statement has a fixture counterpart, taken before `withActor`.
 * This one query is why `/enquiries` and `/jobs` needed a database even though
 * both registers had fixtures: each renders a dialog, every dialog calls this,
 * and one un-branched read is enough to fail the route.
 */

import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { withActor, type Actor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotOptions } from '@/lib/pilot/fixtures'
import { named } from '@/lib/named'

export interface Choice {
  readonly value: string
  readonly label: string
  /** Renders the option inside an `<optgroup>` — partners by type, ports by country. */
  readonly group?: string
}

export interface ReferenceOptions {
  readonly branches: readonly Choice[]
  readonly customers: readonly Choice[]
  readonly partners: readonly Choice[]
  readonly locations: readonly Choice[]
  readonly commodities: readonly Choice[]
  readonly incoterms: readonly Choice[]
  readonly countries: readonly Choice[]
  readonly currencies: readonly Choice[]
  readonly containerTypes: readonly Choice[]
  readonly chargeTypes: readonly Choice[]
  readonly documentTypes: readonly Choice[]
  readonly exceptionCodes: readonly Choice[]
  readonly milestoneCodes: readonly Choice[]
  readonly people: readonly Choice[]
  readonly roles: readonly Choice[]
}

const EMPTY: ReferenceOptions = {
  branches: [],
  customers: [],
  partners: [],
  locations: [],
  commodities: [],
  incoterms: [],
  countries: [],
  currencies: [],
  containerTypes: [],
  chargeTypes: [],
  documentTypes: [],
  exceptionCodes: [],
  milestoneCodes: [],
  people: [],
  roles: [],
}

/**
 * The label format is `CODE — Name`, consistently, and the code comes first on
 * purpose: a browser's own type-to-select matches from the start of the option
 * text, so an operator who knows the code can type it. One who does not reads
 * the name. Putting the name first would break the first case for no gain in
 * the second.
 *
 * `locale` names every reference row in the reader's language — Arabic where
 * the row has it, English where it is blank (F27). Only the name moves: the
 * code stays first, and the capped subset is still chosen in English order, so
 * an Arabic reader is offered the same rows sorted for them. People are the
 * exception — a name is not translated.
 *
 * `cache` keys on both arguments, and the locale is a string, so the memo
 * still holds across every dialog on one page.
 */
export const loadOptions = cache(
  async (actor: Actor, locale: 'en' | 'ar' = 'en'): Promise<ReferenceOptions> => {
    /*
      The `list()` normalisation below stays behind the branch. It exists only
      because `json_agg` over an empty set is NULL rather than `[]`, which is a
      fact about the statement and not about the data — the builder returns
      every list as an array already.
    */
    if (usePilotFixtures()) return pilotOptions(locale)

    const legal = named(locale, sql`legal_name_en`, sql`legal_name_ar`)
    const name = named(locale, sql`name_en`, sql`name_ar`)

    return withActor(actor, async (tx) => {
      const result = await tx.execute(sql`
        with
          b as (
            select json_agg(json_build_object('value', id, 'label', code || ' — ' || ${legal})
                            order by code) v
              from branches where is_active
          ),
          c as (
            select json_agg(json_build_object('value', id, 'label', code || ' — ' || ${legal})
                            order by ${legal}) v
              from (select id, code, legal_name_en, legal_name_ar from customers
                     where is_active order by legal_name_en limit 500) t
          ),
          p as (
            select json_agg(json_build_object('value', id,
                                              'label', code || ' — ' || ${legal},
                                              'group', type) order by ${legal}) v
              from (select id, code, legal_name_en, legal_name_ar, type from partners
                     where is_active order by legal_name_en limit 500) t
          ),
          l as (
            select json_agg(json_build_object('value', id,
                                              'label', coalesce(unlocode || ' — ', '') || ${name},
                                              'group', country_code) order by ${name}) v
              from (select id, unlocode, name_en, name_ar, country_code from locations
                     where is_active order by name_en limit 600) t
          ),
          g as (
            select json_agg(json_build_object('value', id, 'label', code || ' — ' || ${name})
                            order by ${name}) v
              from (select id, code, name_en, name_ar from commodities
                     where is_active order by name_en limit 400) t
          ),
          i as (
            select json_agg(json_build_object('value', code, 'label', code || ' — ' || ${name})
                            order by code) v
              from incoterms where is_active
          ),
          co as (
            select json_agg(json_build_object('value', code, 'label', ${name})
                            order by ${name}) v
              from countries where is_active
          ),
          cu as (
            select json_agg(json_build_object('value', code, 'label', code || ' — ' || ${name})
                            order by code) v
              from currencies where is_active
          ),
          ct as (
            select json_agg(json_build_object('value', code, 'label', code || ' — ' || ${name})
                            order by code) v
              from container_types where is_active
          ),
          ch as (
            select json_agg(json_build_object('value', id,
                                              'label', key || ' — ' || ${name},
                                              'group', category) order by sort_order, key) v
              from charge_types where is_active
          ),
          dt as (
            select json_agg(json_build_object('value', id,
                                              'label', code || ' — ' || ${name},
                                              'group', category) order by code) v
              from document_types where is_active
          ),
          ec as (
            select json_agg(json_build_object('value', id,
                                              'label', code || ' — ' || ${name},
                                              'group', default_severity) order by code) v
              from exception_codes where is_active
          ),
          mt as (
            select json_agg(json_build_object('value', code, 'label', code || ' — ' || ${name})
                            order by code) v
              from (select distinct on (code) code, name_en, name_ar from milestone_templates
                     where is_active order by code) t
          ),
          /*
           * People who can own work — internal principals only.
           *
           * A customer contact is a principal too, and offering one as the
           * owner of an enquiry would be a quiet privilege leak in a dropdown.
           *
           * And only someone who can act on what they would own. A read-only
           * user was offered as the owner of a job or an exception they could
           * not so much as tick a milestone on, and the work then sat with
           * nobody able to move it. "Can act" is read off the role's grants
           * rather than its name, so a branch's own role with these keys
           * qualifies and a renamed read-only one does not.
           *
           * Named as the person writes it in the reader's language —
           * principals.name_ar on an Arabic screen, as every other list here.
           */
          pe as (
            select json_agg(json_build_object('value', id, 'label', ${name}) order by ${name}) v
              from (select pr.id, pr.name_en, pr.name_ar from principals pr
                     where pr.type = 'internal' and pr.is_active
                       and pr.email not like '%@qabandi.internal'
                       and exists (
                         select 1 from principal_branch_roles pbr
                           join role_permissions rp on rp.role_id = pbr.role_id
                          where pbr.principal_id = pr.id and pbr.is_active and rp.allowed
                            and rp.permission_key in
                                ('job.update', 'enquiry.assign', 'enquiry.rate', 'customs.update'))
                     order by pr.name_en limit 300) t
          ),
          ro as (
            select json_agg(json_build_object('value', id, 'label', ${name}) order by ${name}) v
              from roles
          )
        select b.v as branches, c.v as customers, p.v as partners, l.v as locations,
               g.v as commodities, i.v as incoterms, co.v as countries, cu.v as currencies,
               ct.v as "containerTypes", ch.v as "chargeTypes", dt.v as "documentTypes",
               ec.v as "exceptionCodes", mt.v as "milestoneCodes", pe.v as people, ro.v as roles
          from b, c, p, l, g, i, co, cu, ct, ch, dt, ec, mt, pe, ro
      `)

      const row = result.rows[0] as Record<string, Choice[] | null> | undefined
      if (!row) return EMPTY

      // `json_agg` over an empty set is NULL, not `[]`. Every list is
      // normalised here so no call site has to hold that fact.
      const list = (key: keyof ReferenceOptions): readonly Choice[] => row[key] ?? []

      return {
        branches: list('branches'),
        customers: list('customers'),
        partners: list('partners'),
        locations: list('locations'),
        commodities: list('commodities'),
        incoterms: list('incoterms'),
        countries: list('countries'),
        currencies: list('currencies'),
        containerTypes: list('containerTypes'),
        chargeTypes: list('chargeTypes'),
        documentTypes: list('documentTypes'),
        exceptionCodes: list('exceptionCodes'),
        milestoneCodes: list('milestoneCodes'),
        people: list('people'),
        roles: list('roles'),
      }
    })
  },
)
