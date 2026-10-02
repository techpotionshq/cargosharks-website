/**
 * The customer slice's contract.
 *
 * Extends the generated schema rather than restating it (§2). What is added is
 * only what the *form* needs and the column definition cannot express: that a
 * code is uppercase and URL-safe, and that the per-branch commercial terms
 * arrive alongside the customer rather than as a second trip through the UI.
 */

import { z } from 'zod'
import { insertCustomer } from '@qabandi/db'
import type { Translate } from '@/lib/form-state'

/**
 * The customer code is a human key — it goes on a quotation, gets read down a
 * phone and gets typed into a search box. Constrained rather than free text so
 * it cannot arrive with a space in it and quietly stop matching.
 */
const customerCode = (tv: Translate<'customersValidation'>) =>
  z
    .string()
    .trim()
    .min(2, tv('minTwoChars'))
    .max(16, tv('maxSixteenChars'))
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, tv('lettersDigitsHyphens'))
    .transform((value) => value.toUpperCase())

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : null))

/*
  Factories rather than constants: the messages are catalogue keys, and a
  locale only exists per request. The action binds `customersValidation` and
  hands the translator in.
*/
export const customerFormSchema = (tv: Translate<'customersValidation'>) =>
  insertCustomer
    .pick({
      legalNameEn: true,
      legalNameAr: true,
      registration: true,
      taxRegistration: true,
      countryCode: true,
      primaryBranchId: true,
      isActive: true,
    })
    .extend({
      code: customerCode(tv),
      legalNameEn: z.string().trim().min(2, tv('required')).max(200),
      legalNameAr: optionalText,
      registration: optionalText,
      taxRegistration: optionalText,
      countryCode: z
        .string()
        .trim()
        .length(2)
        .toUpperCase()
        .optional()
        .or(z.literal('').transform(() => undefined)),
      primaryBranchId: z.uuid(tv('chooseBranch')),
      isActive: z.coerce.boolean().default(true),

      /**
       * Per-branch terms, captured with the customer.
       *
       * A customer with no payment terms is not a customer you can invoice, and
       * making it a second screen is how the field ends up empty on every record
       * the pilot creates.
       */
      paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
      creditLimit: z
        .string()
        .trim()
        .regex(/^\d*\.?\d*$/, tv('numbersOnly'))
        .optional()
        .transform((value) => (value ? value : null)),
      creditCurrency: z
        .string()
        .trim()
        .length(3)
        .toUpperCase()
        .optional()
        .or(z.literal('').transform(() => undefined)),
      freeTimeDays: z.coerce.number().int().min(0).max(120).optional(),
      defaultIncoterm: optionalText,
    })

export const updateCustomerSchema = (tv: Translate<'customersValidation'>) =>
  customerFormSchema(tv).extend({
    customerId: z.uuid(),
  })

/** Parses a `FormData` into the shape the schema expects. */
export function customerFormData(form: FormData): Record<string, unknown> {
  const read = (key: string): string | undefined => {
    const value = form.get(key)
    return typeof value === 'string' ? value : undefined
  }

  return {
    code: read('code') ?? '',
    legalNameEn: read('legalNameEn') ?? '',
    legalNameAr: read('legalNameAr'),
    registration: read('registration'),
    taxRegistration: read('taxRegistration'),
    countryCode: read('countryCode'),
    primaryBranchId: read('primaryBranchId') ?? '',
    isActive: form.get('isActive') !== null,
    paymentTermsDays: read('paymentTermsDays') || 30,
    creditLimit: read('creditLimit'),
    creditCurrency: read('creditCurrency'),
    freeTimeDays: read('freeTimeDays') || undefined,
    defaultIncoterm: read('defaultIncoterm'),
  }
}
