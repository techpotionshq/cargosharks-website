/**
 * The slice's contract.
 *
 * Extends the generated schema from `@qabandi/db` rather than restating it —
 * one column definition, one source of truth (§2). What is added here is only
 * what the *form* needs and the table cannot express: that a lane has both
 * ends, that a ready date is not in the past.
 */

import { insertEnquiry, isoDate } from '@qabandi/db'

export const createEnquirySchema = insertEnquiry
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
    isDangerous: true,
    notes: true,
  })
  .extend({
    readyOn: isoDate.nullish(),
  })
  .refine((value) => value.customerId || value.contactEmail, {
    message: 'An enquiry needs either a known customer or a contact email',
    path: ['customerId'],
  })
  .refine(
    (value) => !value.originId || !value.destinationId || value.originId !== value.destinationId,
    {
      message: 'Origin and destination must differ',
      path: ['destinationId'],
    },
  )
