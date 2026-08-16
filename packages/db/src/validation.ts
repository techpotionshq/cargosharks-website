/**
 * Validation, generated from the schema — Architecture §2.
 *
 * One column definition becomes the database constraint, the TypeScript type,
 * server validation, form validation, the API contract and the bulk-import
 * validator. Nothing here restates a column; it only adds the rules the
 * database cannot express — that a money string parses as a decimal, that an
 * email looks like one.
 *
 * This is why there is no DTO layer and no mapper layer: there is nothing to
 * map between.
 */

import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  branches,
  chargeLines,
  customers,
  enquiries,
  invoices,
  jobs,
  partners,
  principals,
  quotes,
  rateCardLines,
  rateCards,
} from './schema/index'

/**
 * A `numeric` column arrives and leaves as a string, so precision survives the
 * wire (§11). This rejects the shapes that silently lose it — a JS number, an
 * exponent, an empty string — without ever parsing to a float.
 */
export const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d{1,19}(\.\d{1,8})?$/, 'Must be a decimal amount, not a floating-point number')

export const currencyCode = z.string().length(3).toUpperCase()

/** `YYYY-MM-DD`, the form `date` columns are read and written in. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')

const money = { rate: decimalString, amount: decimalString } as const

export const insertBranch = createInsertSchema(branches, {
  baseCurrency: currencyCode,
  legalNameAr: z.string().min(1, 'Arabic legal name is required — every document renders it'),
})
export const selectBranch = createSelectSchema(branches)

export const insertPrincipal = createInsertSchema(principals, {
  email: z.email(),
})
export const updatePrincipal = createUpdateSchema(principals)

export const insertCustomer = createInsertSchema(customers)
export const insertPartner = createInsertSchema(partners)

export const insertEnquiry = createInsertSchema(enquiries, {
  contactEmail: z.email().nullish(),
  readyOn: isoDate.nullish(),
  grossWeightKg: decimalString.nullish(),
  volumeCbm: decimalString.nullish(),
})
export const selectEnquiry = createSelectSchema(enquiries)

export const insertQuote = createInsertSchema(quotes, {
  currency: currencyCode,
  totalSell: decimalString.nullish(),
  totalCost: decimalString.nullish(),
  validUntil: isoDate.nullish(),
})

export const insertJob = createInsertSchema(jobs)
export const selectJob = createSelectSchema(jobs)

export const insertRateCard = createInsertSchema(rateCards, {
  currency: currencyCode,
  validFrom: isoDate,
  validTo: isoDate.nullish(),
}).omit({ validity: true }) // Maintained by a trigger — see 0002_constraints.sql.

export const insertRateCardLine = createInsertSchema(rateCardLines, {
  rate: decimalString,
  currency: currencyCode,
  minimum: decimalString.nullish(),
  maximum: decimalString.nullish(),
})

export const insertChargeLine = createInsertSchema(chargeLines, {
  ...money,
  amountBase: decimalString,
  fxRate: decimalString,
  currency: currencyCode,
  baseCurrency: currencyCode,
})

export const insertInvoice = createInsertSchema(invoices, {
  currency: currencyCode,
  subtotal: decimalString,
  taxAmount: decimalString,
  total: decimalString,
  dueOn: isoDate.nullish(),
})

export type NewBranch = z.infer<typeof insertBranch>
export type NewEnquiry = z.infer<typeof insertEnquiry>
export type NewJob = z.infer<typeof insertJob>
export type NewChargeLine = z.infer<typeof insertChargeLine>
