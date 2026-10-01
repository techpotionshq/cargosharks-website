/**
 * The slice's contract.
 *
 * Extends the generated schema from `@qabandi/db` rather than restating it —
 * one column definition, one source of truth (§2). What is added here is only
 * what the *form* needs and the table cannot express: that a lane has both
 * ends, that a ready date is not in the past.
 */

import { z } from 'zod'
import { insertEnquiry, isoDate } from '@qabandi/db'
import type { Translate } from '@/lib/form-state'

/*
  A factory of the translator: the two refinements below carry messages the
  operator reads, and a locale exists only per request.
*/
export const createEnquirySchema = (tv: Translate<'enquiriesValidation'>) =>
  insertEnquiry
    .pick({
      branchId: true,
      customerId: true,
      contactEmail: true,
      contactName: true,
      channel: true,
      mode: true,
      tradeDirection: true,
      originId: true,
      destinationId: true,
      commodityId: true,
      incoterm: true,
      readyOn: true,
      grossWeightKg: true,
      volumeCbm: true,
      pieces: true,
      containerCount: true,
      isDangerous: true,
      notes: true,
    })
    .extend({
      /*
        The table's own rule, with the operator's wording. The generated
        schema says "not a floating-point number" when "1e3" is typed — in
        English on an Arabic page, and in words written for developers.
      */
      grossWeightKg: z
        .string()
        .trim()
        .regex(/^\d{1,13}(\.\d{1,6})?$/, tv('weightAmount'))
        .nullish(),
      volumeCbm: z
        .string()
        .trim()
        .regex(/^\d{1,13}(\.\d{1,6})?$/, tv('volumeAmount'))
        .nullish(),
      readyOn: isoDate.nullish(),
      /*
        A whole number of containers, one or more (F39). FCL pricing multiplies
        every per-container rate by it, so 0, 1.5 or -2 is a price, not a typo;
        the database refuses the same (`enquiries_container_count_positive`).
        One message for all three, since the fix is the same.
      */
      containerCount: z
        .number({ error: tv('containerCountWhole') })
        .int(tv('containerCountWhole'))
        .min(1, tv('containerCountWhole'))
        .nullish(),
    })
    .refine((value) => value.customerId || value.contactEmail, {
      message: tv('customerOrEmail'),
      path: ['customerId'],
    })
    .refine(
      (value) => !value.originId || !value.destinationId || value.originId !== value.destinationId,
      {
        message: tv('originDestinationDiffer'),
        path: ['destinationId'],
      },
    )
