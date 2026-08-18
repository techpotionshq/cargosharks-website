/**
 * Enumerations that belong in code.
 *
 * The line that decides whether something is an enum or a table:
 *
 *   - A status is an enum. `states.ts` in core defines the transitions, so the
 *     set is only extensible by a code change anyway; a database enum makes an
 *     out-of-range write impossible rather than merely unlikely.
 *   - A charge type, milestone, exception code, document type or notification
 *     template is a *row*. FR-AD-03 requires an administrator to add one
 *     without a release, and that is honoured literally — see `reference.ts`.
 *
 * Getting this line wrong in either direction is expensive: an enum where a
 * row belongs means a migration to add a surcharge; a row where an enum
 * belongs means a status the state machine has never heard of.
 */

import { pgEnum } from 'drizzle-orm/pg-core'

export const principalTypeEnum = pgEnum('principal_type', [
  'internal',
  'customer_contact',
  'agent_contact',
  'system',
  /**
   * The vendor's support engineer — a *fifth* population, deliberately not the
   * fourth wearing a different hat.
   *
   * When the platform is sold with support, someone outside the operator's
   * staff has to be able to answer "the invoice total is wrong on KWI-1042",
   * and `app_user` holds `nobypassrls` (§5.1) so there is no back door to
   * improvise with. Modelling that access as an `internal` principal would
   * have made it indistinguishable from the operator's own staff in the audit
   * trail, which is the one property that makes hosting someone's commercial
   * data defensible: we can prove exactly what we looked at, and when, and
   * under whose authority.
   *
   * Access is read-only by construction (`0008` grants support `for select`
   * and nothing else), time-boxed, and granted by the customer rather than
   * assumed by us.
   */
  'support',
])

/**
 * What a support grant admits. Read unless someone deliberately chose
 * otherwise, and `write` is a separate escalation rather than a wider default:
 * the overwhelming majority of support work is answering "why does this say
 * that", which needs no write at all.
 */
export const supportScopeEnum = pgEnum('support_scope', ['read', 'write'])

export const modeEnum = pgEnum('transport_mode', ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'])

export const directionEnum = pgEnum('trade_direction', ['import', 'export', 'cross_trade'])

export const rateDirectionEnum = pgEnum('rate_direction', ['buy', 'sell'])

export const chargeDirectionEnum = pgEnum('charge_direction', ['cost', 'revenue'])

export const basisEnum = pgEnum('charge_basis', [
  'flat',
  'per_unit',
  'per_kg',
  'per_container',
  'per_day',
  'percent',
])

export const partnerTypeEnum = pgEnum('partner_type', [
  'agent',
  'haulier',
  'carrier',
  'broker',
  'terminal',
])

export const clockKindEnum = pgEnum('clock_kind', ['demurrage', 'detention', 'storage'])

// --- statuses: mirror packages/core/src/states.ts --------------------------

export const enquiryStatusEnum = pgEnum('enquiry_status', [
  'new',
  'assigned',
  'rating',
  'quoted',
  'won',
  'lost',
  'cancelled',
  'expired',
])

export const quoteStatusEnum = pgEnum('quote_status', [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'superseded',
])

export const jobStatusEnum = pgEnum('job_status', [
  'draft',
  'booked',
  'in_transit',
  'arrived',
  'customs',
  'delivered',
  'completed',
  'closed',
  'on_hold',
  'cancelled',
])

export const customsStatusEnum = pgEnum('customs_status', [
  'not_started',
  'documents_pending',
  'declaration_filed',
  'assessed',
  'duty_paid',
  'inspection',
  'released',
  'held',
])

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'approved',
  'issued',
  'part_paid',
  'paid',
  'credited',
  'void',
])

// --- operational ----------------------------------------------------------

export const severityEnum = pgEnum('exception_severity', ['low', 'medium', 'high', 'critical'])

export const channelEnum = pgEnum('message_channel', ['email', 'whatsapp', 'in_app', 'portal'])

export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound'])

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'suppressed',
])

export const localeEnum = pgEnum('locale', ['en', 'ar'])

export const dayBasisEnum = pgEnum('day_basis', ['calendar', 'working'])

export const marginKindEnum = pgEnum('margin_kind', ['percent', 'absolute', 'target_sell'])

export const taxTreatmentEnum = pgEnum('tax_treatment', [
  'out_of_scope',
  'zero_rated',
  'exempt',
  'standard',
  'reverse_charge',
])

/**
 * Who prints where on a bill of lading — 0010.
 *
 * Not the same list as `job_partners.role`, and deliberately so. That role
 * says who is *working* the shipment: the origin agent, the haulier, the
 * broker. This says who is *named on the document*, which is a different
 * question with a different answer — the shipper on the bill is frequently not
 * our customer, and the consignee is frequently the words "TO ORDER".
 */
export const billPartyRoleEnum = pgEnum('bill_party_role', [
  'shipper',
  'consignee',
  'notify',
  'second_notify',
  'delivery_agent',
  'forwarding_agent',
])

export const consolidationStatusEnum = pgEnum('consolidation_status', [
  'open',
  'closed',
  'cancelled',
])

/**
 * How a master cost divides across the houses under it — 0012.
 *
 * Every value except `manual` is a number the system already holds per house,
 * which is what makes an allocation auditable rather than negotiable.
 */
export const allocationBasisEnum = pgEnum('allocation_basis', [
  'chargeable_weight',
  'volume',
  'gross_weight',
  'packages',
  'equal',
  'manual',
])

/**
 * `draft` previews, `posted` marks its invoices, `void` releases them again.
 * The three-state life cycle is what makes re-exporting a period a deliberate
 * act rather than an accident — 0011.
 */
export const accountingExportStatusEnum = pgEnum('accounting_export_status', [
  'draft',
  'posted',
  'void',
])
