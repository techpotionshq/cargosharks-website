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

/**
 * The life of a rate request (RFQ) sent to a broker — FR-RT-10.
 *
 *   sent → responded → parsed → accepted
 *
 * with `declined` (the broker said no), `expired` (the window closed with no
 * usable reply) and `superseded` (a re-sent RFQ replaced this one) as the ways
 * out. Nothing is deleted: a withdrawn request is `superseded`, never removed.
 */
export const rateRequestStatusEnum = pgEnum('rate_request_status', [
  'sent',
  'responded',
  'parsed',
  'accepted',
  'declined',
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
 * A supplier's invoice through its life — 0014.
 *
 * `received` is the honest default: the bill exists and has been captured, and
 * nothing has been decided about it. Approval is a separate act by finance,
 * which is what makes the variance report worth reading — a bill approved
 * while a line sits outside tolerance records who judged that acceptable.
 *
 * `disputed` is a state and not a flag because the answer to "why has this not
 * been paid" is different from "this has not been paid yet", and an ageing
 * report that cannot tell them apart chases the wrong agent.
 */
export const supplierInvoiceStatusEnum = pgEnum('supplier_invoice_status', [
  'received',
  'approved',
  'part_paid',
  'paid',
  'disputed',
  'void',
])

/**
 * A monthly set-off — 0014.
 *
 * `agreed` is the state the whole thing turns on. Up to it the figures move as
 * documents land in the period; past it they are frozen, because both sides
 * have signed the same statement and a settlement that changes afterwards is
 * one nobody can rely on. `settled` means the residual has actually moved.
 */
export const settlementStatusEnum = pgEnum('settlement_status', [
  'draft',
  'agreed',
  'settled',
  'void',
])

/** Which way the residual goes after the offset. `square` means nothing moves. */
export const settlementDirectionEnum = pgEnum('settlement_direction', [
  'they_owe_us',
  'we_owe_them',
  'square',
])

/** What a settlement line claimed: one we raised on them, or one they raised on us. */
export const settlementLineKindEnum = pgEnum('settlement_line_kind', ['invoice', 'bill'])

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

/**
 * Every place in the product that may ask a model something — `core/ai.ts`.
 *
 * An enum by the line this file draws at the top: a surface is only extensible
 * by writing the code that calls from it, so the database makes an unknown one
 * unrepresentable rather than merely unexpected. What *is* configuration is
 * which model each surface uses and what it may decide — environment and rows
 * respectively, never this list.
 *
 * It is also the cost dimension. "What is the AI costing us" has one useful
 * answer and it is grouped by this column: an assistant answering forty
 * questions a day and an extraction reading four hundred invoices a month fail
 * economically in completely different ways.
 */
export const aiSurfaceEnum = pgEnum('ai_surface', [
  'enquiry_extract',
  'document_classify',
  'document_extract',
  'invoice_extract',
  'rate_mapping',
  'rate_extract',
  'assistant',
  'draft_reply',
])

/**
 * What became of a proposal.
 *
 * `refused` is not a rejection by a person — it is the allowlist in
 * `core/ai.ts` catching a model that tried to write a field its surface may
 * not speak to. It is kept as its own state rather than folded into
 * `rejected` because the two mean completely different things: one is a
 * coordinator disagreeing, the other is a prompt-injection attempt or a
 * prompt bug, and only the second is somebody's job to investigate tonight.
 */
export const proposalStatusEnum = pgEnum('proposal_status', [
  'proposed',
  'accepted',
  'rejected',
  'applied',
  'superseded',
  'refused',
])
