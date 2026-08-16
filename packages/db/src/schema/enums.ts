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
])

export const modeEnum = pgEnum('transport_mode', [
  'sea_fcl',
  'sea_lcl',
  'air',
  'land',
  'courier',
])

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
