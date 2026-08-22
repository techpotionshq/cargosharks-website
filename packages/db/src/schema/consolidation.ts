/**
 * Consolidation — many house bills under one master (0012).
 *
 * `jobs` carries `master_bill_number` and `house_bill_number` as two columns on
 * one row, which says: one job, one house, one master. Exactly right for FCL
 * and for customs brokerage, and unable to represent what an LCL or air
 * consolidator does weekly — twenty shippers under one master bill, one ocean
 * freight cost, and a groupage margin that exists only if that cost is split
 * correctly.
 *
 * Two decisions carry this file.
 *
 * **The master-level facts belong to the consolidation.** The master bill, the
 * carrier, the vessel and voyage, the sailing dates: shared by every house
 * under them. Left on `jobs` they are copied twenty times and the twenty-first
 * edit disagrees with the other twenty. A vessel does not sail per house.
 *
 * **Allocated costs become ordinary charge lines.** The split writes normal
 * rows into `charge_lines` on each house, carrying `source_kind` of
 * `consol_allocation` and `source_id` pointing back here — two columns that
 * have existed since 0000 for exactly this shape of thing. So job P&L, the
 * invoice builder, the margin report and the accounting export need to know
 * nothing about consolidation, and "why is there a 62.400 KWD freight cost on
 * this house?" is one join from an answer.
 */

import { index, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { amount, pk, quantity, rate, ref, timestamps, tsz } from './columns'
import { pgTable } from './table'
import {
  allocationBasisEnum,
  chargeDirectionEnum,
  basisEnum,
  consolidationStatusEnum,
  directionEnum,
  modeEnum,
} from './enums'
import { branches, principals } from './identity'
import { chargeTypes, currencies, locations } from './reference'
import { partners } from './commercial'
import { jobs } from './jobs'

export const consolidations = pgTable(
  'consolidations',
  {
    id: pk(),
    reference: text('reference').notNull().unique(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    status: consolidationStatusEnum('status').notNull().default('open'),
    mode: modeEnum('mode').notNull(),
    tradeDirection: directionEnum('trade_direction').notNull(),
    /** The master bill is the consolidation's, not any house's. */
    masterBillNumber: text('master_bill_number'),
    bookingNumber: text('booking_number'),
    carrierPartnerId: ref('carrier_partner_id').references(() => partners.id),
    /**
     * The co-loader, where we bought space rather than sold it.
     *
     * A forwarder is on one side or the other of every consolidation and the
     * difference is the commercial point: co-loading *in* means our master,
     * our margin, their house; co-loading *out* means somebody else's master.
     * The partner is recorded either way; the direction is read from whether
     * we hold the master bill.
     */
    coloadPartnerId: ref('coload_partner_id').references(() => partners.id),
    vesselName: text('vessel_name'),
    voyageNumber: text('voyage_number'),
    flightNumber: text('flight_number'),
    originId: ref('origin_id').references(() => locations.id),
    destinationId: ref('destination_id').references(() => locations.id),
    etd: tsz('etd'),
    eta: tsz('eta'),
    atd: tsz('atd'),
    ata: tsz('ata'),
    /** Manifest cut-off: past this the house list is closed and allocable. */
    closedAt: tsz('closed_at'),
    cancelledAt: tsz('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    ownerId: ref('owner_id').references(() => principals.id),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('consolidations_branch_idx').on(t.branchId, t.status, t.etd),
    index('consolidations_master_bill_idx').on(t.masterBillNumber),
  ],
)

/**
 * A cost bought once, at master level, before it is divided.
 *
 * The same columns as `charge_lines` — currency, FX rate and the moment it was
 * taken, base amount, counterparty — because it is the same kind of fact and
 * will become those rows. What it adds is how it divides and whether it has.
 */
export const consolChargeLines = pgTable(
  'consol_charge_lines',
  {
    id: pk(),
    consolidationId: ref('consolidation_id')
      .notNull()
      .references(() => consolidations.id),
    /**
     * Carried, not derived — the same reason `job_partners` carries one. The
     * RLS policy scopes by branch, and reaching into `consolidations` to find
     * it would make the two policies mutually recursive; PostgreSQL rejects
     * both.
     */
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    direction: chargeDirectionEnum('direction').notNull(),
    chargeTypeId: ref('charge_type_id')
      .notNull()
      .references(() => chargeTypes.id),
    description: text('description'),
    basis: basisEnum('basis').notNull(),
    quantity: quantity('quantity').notNull().default('1'),
    rate: amount('rate').notNull(),
    amount: amount('amount').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    fxRate: rate('fx_rate').notNull().default('1'),
    fxRateAt: tsz('fx_rate_at').notNull().defaultNow(),
    amountBase: amount('amount_base').notNull(),
    baseCurrency: text('base_currency')
      .notNull()
      .references(() => currencies.code),
    counterpartyPartnerId: ref('counterparty_partner_id').references(() => partners.id),
    allocationBasis: allocationBasisEnum('allocation_basis').notNull().default('volume'),
    /**
     * When the split was posted, and by whom.
     *
     * An unallocated master cost is a consolidation that has not been costed
     * yet — visible on the screen as outstanding work. Once allocated the line
     * is frozen: editing it would leave twenty house charge lines describing a
     * cost that no longer exists, so the routine reverses and re-posts.
     */
    allocatedAt: tsz('allocated_at'),
    allocatedById: ref('allocated_by_id').references(() => principals.id),
    ...timestamps,
  },
  (t) => [index('consol_charge_lines_consol_idx').on(t.consolidationId, t.direction)],
)

/**
 * Manual shares, where the operator overrode the basis.
 *
 * Every other basis computes its shares from cargo the system already holds,
 * so this table stays empty unless somebody stated the split by hand — which
 * is itself the useful signal when a margin is questioned later.
 */
export const consolAllocationShares = pgTable(
  'consol_allocation_shares',
  {
    id: pk(),
    consolChargeLineId: ref('consol_charge_line_id')
      .notNull()
      .references(() => consolChargeLines.id),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    shareAmount: amount('share_amount').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('consol_allocation_shares_unique').on(t.consolChargeLineId, t.jobId)],
)
