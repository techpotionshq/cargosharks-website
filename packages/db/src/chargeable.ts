/**
 * The volumetric rule for a mode, as a branch configures it — FR-AD-03.
 *
 * Here rather than in either caller because there are two, in two
 * applications, and they must not disagree. `apps/service` prints the
 * chargeable weight on an air waybill; `apps/web` rates a consignment against
 * it. A waybill stating a different weight from the invoice beside it is a
 * dispute waiting for somebody to notice, and two copies of "which divisor
 * applies" is how that happens.
 *
 * The fault this file exists to prevent has already happened once in the other
 * direction: the waybill loader read `SEED_CHARGEABLE_RULES`, the compiled
 * constant the seed writes the table *from*, while its own comment promised a
 * divisor change was an administrator's edit. The two agree the day the seed
 * runs and diverge the moment somebody does the edit.
 *
 * Takes a transaction rather than an actor: both callers are already inside
 * one, and opening a second would nest transactions to answer a lookup.
 */

import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { dec, type ChargeableRule } from '@qabandi/core'
import { chargeableRules } from './schema/reference'
import type { Tx } from './actor'

/**
 * Returns `null` where nothing matches, and never a default.
 *
 * A fallback to the constant is what made the original fault invisible: the
 * number is plausible, the document renders, and it came from a source nobody
 * can edit. The reference screen counts these rows precisely so an empty table
 * is visible before a document is.
 *
 * Two rows can match — the seeded default carries no branch, a branch that
 * negotiated its own divisor carries one. `branch_id` sorts nulls last so the
 * branch's own row wins, which is the whole reason the unique constraint is on
 * `(mode, branch_id)` rather than on `mode` alone.
 */
export async function chargeableRuleFor(
  tx: Tx,
  mode: string | null | undefined,
  branchId: string,
): Promise<ChargeableRule | null> {
  if (!mode) return null

  const [rule] = await tx
    .select({
      mode: chargeableRules.mode,
      divisorCm3PerKg: chargeableRules.divisorCm3PerKg,
      roundUpToKg: chargeableRules.roundUpToKg,
      minimumKg: chargeableRules.minimumKg,
    })
    .from(chargeableRules)
    .where(
      and(
        eq(chargeableRules.mode, mode as ChargeableRule['mode']),
        eq(chargeableRules.isActive, true),
        or(eq(chargeableRules.branchId, branchId), isNull(chargeableRules.branchId)),
      ),
    )
    .orderBy(asc(chargeableRules.branchId))
    .limit(1)

  if (!rule) return null

  return {
    mode: rule.mode,
    // `numeric` arrives as a string and `Decimal` is what the engine takes.
    // The round trip through a JS number is exactly the precision loss the
    // divisor is stored as a divisor to avoid.
    divisorCm3PerKg: rule.divisorCm3PerKg === null ? null : dec(rule.divisorCm3PerKg),
    roundUpToKg: dec(rule.roundUpToKg),
    minimumKg: dec(rule.minimumKg),
  }
}

/**
 * The free-time terms a branch grants on a mode — FR-AD-03, §7.2.
 *
 * `free_time_rules` was written for this and read by nothing: every clock in
 * the product was created with its days and its per-diem typed by hand, or by
 * `seed-demo`. Which means the table an administrator was meant to maintain
 * had no effect on anything, and the terms a forwarder negotiates with a
 * carrier lived in whoever opened the clock's memory.
 *
 * Narrowed most-specific-first: a rule naming the container type beats one
 * that does not, a rule naming the partner beats the general one, and a
 * branch's own rule beats the default. Nulls sort last on all three, which is
 * what makes "applies to everything" the fallback rather than a competitor.
 */
export interface FreeTimeTerms {
  readonly kind: 'demurrage' | 'detention' | 'storage'
  readonly freeDays: number
  readonly perDiem: string
  readonly currency: string
  readonly dayBasis: 'calendar' | 'working'
  readonly tiers: { fromDay: number; perDiem: string }[] | null
}

export async function freeTimeTermsFor(
  tx: Tx,
  query: {
    readonly kind: 'demurrage' | 'detention' | 'storage'
    readonly branchId: string
    readonly mode?: string | null
    readonly containerType?: string | null
    readonly partnerId?: string | null
  },
): Promise<FreeTimeTerms | undefined> {
  const rows = await tx.execute(sql`
    select kind::text as kind, free_days as "freeDays", per_diem::text as "perDiem",
           currency, day_basis::text as "dayBasis", tiers
      from free_time_rules
     where kind = ${query.kind}::clock_kind
       and is_active
       and (branch_id is null or branch_id = ${query.branchId})
       and (mode is null or mode = ${query.mode ?? null}::transport_mode)
       and (container_type is null or container_type = ${query.containerType ?? null})
       and (partner_id is null or partner_id = ${query.partnerId ?? null})
     order by branch_id nulls last, partner_id nulls last,
              container_type nulls last, mode nulls last
     limit 1
  `)

  return rows.rows[0] as unknown as FreeTimeTerms | undefined
}
