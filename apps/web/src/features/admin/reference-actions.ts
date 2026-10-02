'use server'

/**
 * The configuration tables the four-column reference form cannot hold —
 * FR-AD-03.
 *
 * `saveReferenceRecord` handles charge types, commodities, document types and
 * exception codes, which share a shape: a code, two names, a flag. These four
 * do not. A milestone template carries a mode, a direction and a sequence; a
 * calendar carries a weekend and a working day; a duty rate carries a tariff
 * prefix and a period. Squeezing them through one form would mean a dialog of
 * conditional fields nobody could read, so they get their own actions.
 *
 * Every one of them was named in `CLAUDE.md` as configuration an administrator
 * edits without a release, and every one of them was seed-only until now:
 * milestone templates decided what steps a job gets, calendars decided every
 * SLA and free-time calculation, and the tariff decided what a customer was
 * told a shipment would cost to clear. Three things a forwarder changes and a
 * developer should not have to.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  calendarHolidays,
  chargeableRules,
  dutyRates,
  freeTimeRules,
  fxRates,
  milestoneTemplates,
  withActor,
  workingCalendars,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import {
  databaseMessage,
  echo,
  fail,
  isForeignKeyViolation,
  isUniqueViolation,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { normaliseAmount } from '@/lib/amount'
import { localeParse } from '@/lib/validate'
import { refuseForbidden } from '@/lib/refuse-forbidden'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function fieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const out: Record<string, string> = {}
  for (const issue of error.issues) out[String(issue.path[0] ?? '_')] ??= issue.message
  return out
}

const optional = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

/* ------------------------------------------------------ milestone templates */

const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const
const DIRECTIONS = ['import', 'export', 'cross_trade'] as const

const milestoneSchema = (tv: Translate) =>
  z.object({
    templateId: z.uuid().optional(),
    mode: z.enum(MODES),
    direction: z.enum(DIRECTIONS),
    seq: z.coerce.number().int().min(1, tv('sequence')).max(99),
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9_]+$/, tv('lowerDigitsUnderscores')),
    nameEn: z.string().trim().min(2, tv('required')).max(120),
    /** Required, like every other customer-facing name — NFR-01. */
    nameAr: z.string().trim().min(2, tv('requiredCustomersSee')).max(120),
    ownerRole: optional(40),
    plannedOffsetDays: z
      /*
        The empty string first: `z.coerce.number()` reads '' as 0, so with it
        first a blank offset was saved as 0 — planned for the booking day —
        and the null this transform maps '' to was never reached.
      */
      .union([z.literal(''), z.coerce.number().int().min(-365).max(365)])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    customerVisible: z.coerce.boolean(),
    isActive: z.coerce.boolean(),
  })

/**
 * A step in the plan a job of a given shape gets — FR-JB-02.
 *
 * Templates are read once, when a job is booked; editing one changes what the
 * *next* job gets and leaves every shipment already in flight alone. That is
 * deliberate and worth knowing before editing: a coordinator expecting today's
 * change to appear on yesterday's shipment will not find it, and rewriting
 * live plans would move dates a customer has already been told.
 */
export const saveMilestoneTemplate = refuseForbidden(async function saveMilestoneTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(milestoneSchema(tv), {
    templateId: read(form, 'templateId'),
    mode: read(form, 'mode') ?? 'sea_fcl',
    direction: read(form, 'direction') ?? 'import',
    seq: read(form, 'seq') ?? '',
    code: read(form, 'code') ?? '',
    nameEn: read(form, 'nameEn') ?? '',
    nameAr: read(form, 'nameAr') ?? '',
    ownerRole: read(form, 'ownerRole'),
    plannedOffsetDays: read(form, 'plannedOffsetDays') ?? '',
    customerVisible: form.get('customerVisible') !== null,
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  try {
    await withActor(session.actor, async (tx) => {
      const values = {
        mode: data.mode,
        direction: data.direction,
        seq: data.seq,
        code: data.code,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        ownerRole: data.ownerRole,
        plannedOffsetDays: data.plannedOffsetDays,
        customerVisible: data.customerVisible,
        isActive: data.isActive,
      }
      if (data.templateId) {
        await tx
          .update(milestoneTemplates)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(milestoneTemplates.id, data.templateId))
      } else {
        await tx.insert(milestoneTemplates).values(values)
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ code: tv('stepExists') }, echo(form))
    }
    throw error
  }

  revalidatePath('/reference')
  return succeed(data.code)
})

/* ------------------------------------------------------- working calendars */

const calendarSchema = (tv: Translate) =>
  z.object({
    calendarId: z.uuid().optional(),
    key: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9_]+$/, tv('lowerDigitsUnderscores')),
    nameEn: z.string().trim().min(2, tv('required')).max(120),
    nameAr: z.string().trim().min(2, tv('required')).max(120),
    timeZone: z.string().trim().min(3, tv('chooseTimeZone')).max(64),
    /** Weekday numbers, 0 = Sunday. Kuwait is Friday and Saturday. */
    weekend: z
      .string()
      .trim()
      .regex(/^[0-6](,[0-6])*$/, tv('weekendDays'))
      .transform((v) => [...new Set(v.split(',').map(Number))].sort()),
    dayStartMinute: z.coerce.number().int().min(0).max(1439),
    dayEndMinute: z.coerce.number().int().min(1).max(1440),
    isActive: z.coerce.boolean(),
  })

/**
 * A branch's working week — NFR-03, and the input to every clock in the
 * product.
 *
 * Kuwait, Qatar and the UAE share neither a weekend nor a holiday list, so an
 * SLA computed against the wrong calendar is wrong by days rather than
 * minutes. `core/clocks.ts` does the arithmetic and takes the calendar as an
 * argument precisely so this can be a row.
 */
export const saveWorkingCalendar = refuseForbidden(async function saveWorkingCalendar(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(calendarSchema(tv), {
    calendarId: read(form, 'calendarId'),
    key: read(form, 'key') ?? '',
    nameEn: read(form, 'nameEn') ?? '',
    nameAr: read(form, 'nameAr') ?? '',
    timeZone: read(form, 'timeZone') ?? 'Asia/Kuwait',
    weekend: read(form, 'weekend') ?? '5,6',
    dayStartMinute: read(form, 'dayStartMinute') ?? '480',
    dayEndMinute: read(form, 'dayEndMinute') ?? '1020',
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  if (data.dayEndMinute <= data.dayStartMinute) {
    return fail({ dayEndMinute: tv('dayEnd') }, echo(form))
  }
  /*
    A calendar with no working days would make every SLA infinite.

    `elapsedWorkingMinutes` walks forward looking for a working day, so a
    seven-day weekend does not error — it never returns a due date, and the
    enquiry queue quietly stops escalating anything.
  */
  if (data.weekend.length >= 7) {
    return fail({ weekend: tv('noWorkingDays') }, echo(form))
  }

  try {
    await withActor(session.actor, async (tx) => {
      const values = {
        key: data.key,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        timeZone: data.timeZone,
        weekend: data.weekend,
        dayStartMinute: data.dayStartMinute,
        dayEndMinute: data.dayEndMinute,
        isActive: data.isActive,
      }
      if (data.calendarId) {
        await tx
          .update(workingCalendars)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(workingCalendars.id, data.calendarId))
      } else {
        await tx.insert(workingCalendars).values(values)
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ key: tv('calendarKeyInUse') }, echo(form))
    }
    throw error
  }

  revalidatePath('/reference')
  revalidatePath('/settings/branches')
  return succeed(data.key)
})

const holidaySchema = (tv: Translate) =>
  z.object({
    calendarId: z.uuid(tv('chooseCalendar')),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, tv('dateFormat')),
    nameEn: z.string().trim().min(2, tv('required')).max(120),
    nameAr: optional(120),
  })

/**
 * A day the office is shut — read by every SLA and free-time calculation.
 *
 * Dated rather than recurring, because the ones that matter here are not: Eid
 * moves eleven days a year against the Gregorian calendar, and a rule engine
 * that computed it would be a lunar calendar implementation inside a freight
 * system. Somebody enters next year's dates once a year, which is what every
 * office in the region already does.
 */
export const saveHoliday = refuseForbidden(async function saveHoliday(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(holidaySchema(tv), {
    calendarId: read(form, 'calendarId') ?? '',
    onDate: read(form, 'onDate') ?? '',
    nameEn: read(form, 'nameEn') ?? '',
    nameAr: read(form, 'nameAr'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  try {
    await withActor(session.actor, (tx) => tx.insert(calendarHolidays).values(data))
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ onDate: tv('closureExists') }, echo(form))
    }
    throw error
  }

  revalidatePath('/reference')
  return succeed(data.onDate)
})

/* -------------------------------------------------------------- duty rates */

const dutySchema = (tv: Translate) =>
  z.object({
    rateId: z.uuid().optional(),
    country: z
      .string()
      .trim()
      .length(2, tv('twoLetterCountry'))
      .transform((v) => v.toUpperCase()),
    hsPrefix: z.string().trim().min(2, tv('minTwoDigits')).max(10).regex(/^\d+$/, tv('digitsOnly')),
    ratePercent: z
      .string()
      .trim()
      .overwrite(normaliseAmount)
      .regex(/^\d+(\.\d{1,6})?$/, tv('percentageExample')),
    descriptionEn: z.string().trim().min(2, tv('required')).max(200),
    descriptionAr: optional(200),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, tv('dateFormat')),
    effectiveTo: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, tv('dateFormat')), z.literal('')])
      .optional()
      .transform((v) => v || null),
    notes: optional(500),
    isActive: z.coerce.boolean(),
  })

/**
 * A tariff line — FR-CS-05, and the number a customer is quoted for clearance.
 *
 * Matched by *prefix*, longest first: `findRate` in core takes the most
 * specific line that the HS code starts with, so `8703` beats `87` and both
 * are legitimate rows. That is why this form asks for a prefix rather than a
 * complete code, and why deleting is not offered — a rate that applied last
 * March has to keep applying to last March's declaration, which is what
 * `effective_from` is for.
 */
export const saveDutyRate = refuseForbidden(async function saveDutyRate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(dutySchema(tv), {
    rateId: read(form, 'rateId'),
    country: read(form, 'country') ?? '',
    hsPrefix: read(form, 'hsPrefix') ?? '',
    ratePercent: read(form, 'ratePercent') ?? '',
    descriptionEn: read(form, 'descriptionEn') ?? '',
    descriptionAr: read(form, 'descriptionAr'),
    effectiveFrom: read(form, 'effectiveFrom') ?? '',
    effectiveTo: read(form, 'effectiveTo') ?? '',
    notes: read(form, 'notes'),
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  if (data.effectiveTo && data.effectiveTo < data.effectiveFrom) {
    return fail({ effectiveTo: tv('periodEndsBeforeStart') }, echo(form))
  }
  // The end date is exclusive: `duty_rates_period_ordered` wants it after the
  // start, so a same-day period was a check violation and a 500.
  if (data.effectiveTo && data.effectiveTo === data.effectiveFrom) {
    return fail({ effectiveTo: tv('periodEndsAfterStart') }, echo(form))
  }

  try {
    await withActor(session.actor, async (tx) => {
      const { rateId, ...values } = data
      if (rateId) {
        await tx
          .update(dutyRates)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(dutyRates.id, rateId))
      } else {
        await tx.insert(dutyRates).values(values)
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ hsPrefix: tv('hsRateExists') }, echo(form))
    }
    throw error
  }

  revalidatePath('/reference')
  revalidatePath('/customs')
  return succeed(data.hsPrefix)
})

/* ----------------------------------------------- what the engines measure */

const chargeableSchema = (tv: Translate) =>
  z.object({
    ruleId: z.uuid().optional(),
    mode: z.enum(MODES),
    branchId: z.union([z.uuid(), z.literal('')]).optional(),
    divisorCm3PerKg: z
      .union([
        z
          .string()
          .trim()
          .overwrite(normaliseAmount)
          .regex(/^\d+(\.\d{1,6})?$/, tv('divisorExample')),
        z.literal(''),
      ])
      .optional()
      .transform((v) => v || null),
    roundUpToKg: z
      .string()
      .trim()
      .overwrite(normaliseAmount)
      .regex(/^\d+(\.\d{1,6})?$/, tv('incrementExample')),
    minimumKg: z
      .string()
      .trim()
      .overwrite(normaliseAmount)
      .regex(/^\d+(\.\d{1,6})?$/, tv('floorOrZero')),
    isActive: z.coerce.boolean(),
  })

/**
 * The volumetric rule for a mode — the divisor a shipment is billed on.
 *
 * Stored as the trade states it: cubic centimetres per kilogram, air 6000,
 * courier 5000, sea LCL 1000. Not as a pre-computed kilograms-per-cbm factor,
 * because 6000 is 166.666… kg per cbm and any decimal approximation of it
 * makes a clean 1.2 cbm consignment weigh 200.00004 kg — which the round-up
 * then turns into 200.5.
 *
 * A branch may hold its own row: an air department that negotiated a 5000
 * divisor with its carrier is a row, not a release. `chargeableRuleFor` sorts
 * the branch's own above the default.
 */
export const saveChargeableRule = refuseForbidden(async function saveChargeableRule(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(chargeableSchema(tv), {
    ruleId: read(form, 'ruleId'),
    mode: read(form, 'mode') ?? 'air',
    branchId: read(form, 'branchId') ?? '',
    divisorCm3PerKg: read(form, 'divisorCm3PerKg') ?? '',
    roundUpToKg: read(form, 'roundUpToKg') ?? '',
    minimumKg: read(form, 'minimumKg') ?? '0',
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  try {
    await withActor(session.actor, async (tx) => {
      const values = {
        mode: data.mode,
        branchId: data.branchId || null,
        divisorCm3PerKg: data.divisorCm3PerKg,
        roundUpToKg: data.roundUpToKg,
        minimumKg: data.minimumKg,
        isActive: data.isActive,
      }
      if (data.ruleId) {
        await tx
          .update(chargeableRules)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(chargeableRules.id, data.ruleId))
      } else {
        await tx.insert(chargeableRules).values(values)
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ mode: tv('modeRuleExists') }, echo(form))
    }
    throw error
  }

  revalidatePath('/reference')
  return succeed(data.mode)
})

const freeTimeSchema = (tv: Translate) =>
  z.object({
    ruleId: z.uuid().optional(),
    kind: z.enum(['demurrage', 'detention', 'storage']),
    branchId: z.union([z.uuid(), z.literal('')]).optional(),
    mode: z.union([z.enum(MODES), z.literal('')]).optional(),
    containerType: optional(20),
    freeDays: z.coerce.number().int().min(0).max(365),
    perDiem: z
      .string()
      .trim()
      .overwrite(normaliseAmount)
      .regex(/^\d+(\.\d{1,6})?$/, tv('amountPerDay')),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    dayBasis: z.enum(['calendar', 'working']),
    isActive: z.coerce.boolean(),
  })

/**
 * The free-time terms a branch grants — §7.2, FR-AD-03.
 *
 * The table `free_time_rules` was written for and nothing read until the clock
 * dialog started defaulting from it. The terms a forwarder negotiates with a
 * carrier are configuration; before this they lived in the memory of whoever
 * opened a clock, and every clock in the product was typed by hand.
 *
 * Narrowing is by absence: a row with no mode applies to every mode, one with
 * no container type to every box, one with no branch to the whole deployment.
 * `freeTimeTermsFor` sorts the most specific first, so the general row is a
 * fallback rather than a competitor.
 */
export const saveFreeTimeRule = refuseForbidden(async function saveFreeTimeRule(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(freeTimeSchema(tv), {
    ruleId: read(form, 'ruleId'),
    kind: read(form, 'kind') ?? 'demurrage',
    branchId: read(form, 'branchId') ?? '',
    mode: read(form, 'mode') ?? '',
    containerType: read(form, 'containerType'),
    freeDays: read(form, 'freeDays') ?? '0',
    perDiem: read(form, 'perDiem') ?? '',
    currency: read(form, 'currency') ?? 'KWD',
    dayBasis: read(form, 'dayBasis') ?? 'calendar',
    isActive: form.get('isActive') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  try {
    await withActor(session.actor, async (tx) => {
      const values = {
        kind: data.kind,
        branchId: data.branchId || null,
        mode: data.mode || null,
        containerType: data.containerType,
        freeDays: data.freeDays,
        perDiem: data.perDiem,
        currency: data.currency,
        dayBasis: data.dayBasis,
        isActive: data.isActive,
      }
      if (data.ruleId) {
        await tx
          .update(freeTimeRules)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(freeTimeRules.id, data.ruleId))
      } else {
        await tx.insert(freeTimeRules).values(values)
      }
    })
  } catch (error) {
    /*
      F53: a container type or currency the reference tables do not hold. The
      currency is typed, so a mistyped code reaches here; a container type or
      branch arrives from a select, so only a stale option does. Caught rather
      than looked up first — the foreign key already answers the question, and a
      lookup before the write is a race. The constraint's name says which field
      to put the sentence beside; one we do not recognise is still a 500,
      because a field message on the wrong field would be worse than none.
    */
    if (isForeignKeyViolation(error)) {
      const said = databaseMessage(error)
      if (said.includes('free_time_rules_container_type_')) {
        return fail({ containerType: tv('unknownContainerType') }, echo(form))
      }
      if (said.includes('free_time_rules_currency_')) {
        return fail({ currency: tv('unknownCurrency') }, echo(form))
      }
      if (said.includes('free_time_rules_branch_id_')) {
        return fail({ branchId: tv('chooseBranch') }, echo(form))
      }
    }
    throw error
  }

  revalidatePath('/reference')
  return succeed(data.kind)
})

/* ------------------------------------------------------- exchange rates */

const fxSchema = (tv: Translate) =>
  z.object({
    fromCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, tv('unknownCurrency'))
      .transform((v) => v.toUpperCase()),
    toCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, tv('unknownCurrency'))
      .transform((v) => v.toUpperCase()),
    // `numeric(19,8)`: eight places, because a weak currency onto a strong
    // one — JPY into KWD — is 0.00204082 and two places is zero.
    rate: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,8})?$/, tv('fxRateExample'))
      .refine((v) => /[1-9]/.test(v), tv('fxRateExample')),
    effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, tv('dateFormat')),
  })

/**
 * An exchange rate, entered by hand — S12.
 *
 * Every seeded rate card is in USD and every branch quotes in its own base,
 * so pricing needs a rate onto the base and refuses without one. The only
 * source was the service's fx-refresh worker, which a fresh instance — or one
 * with no feed configured — does not run, and no screen could enter one: on a
 * new deployment every sea enquiry refused "Price it". This is that screen's
 * action, under the permission the `fx_rates` policy already names.
 *
 * Written as `source = 'manual'`, one row per pair and day. The same pair and
 * day entered again corrects that day's manual figure (the audit trigger keeps
 * the old one) rather than adding a second rate for pricing to choose between;
 * a feed's row for the same day is another source and is left alone. Readers
 * take the newest rate on or before the pricing date, so a new day's rate
 * takes over from yesterday's without anything being deleted.
 */
export const saveFxRate = refuseForbidden(async function saveFxRate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')
  const tv = await getTranslations('adminValidation')

  const parsed = await localeParse(fxSchema(tv), {
    fromCurrency: read(form, 'fromCurrency') ?? '',
    toCurrency: read(form, 'toCurrency') ?? '',
    rate: read(form, 'rate') ?? '',
    effectiveOn: read(form, 'effectiveOn') ?? '',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  if (data.fromCurrency === data.toCurrency) {
    return fail({ toCurrency: tv('fxSameCurrency') }, echo(form))
  }

  try {
    await withActor(session.actor, (tx) =>
      tx
        .insert(fxRates)
        .values({ ...data, source: 'manual', takenAt: new Date() })
        .onConflictDoUpdate({
          target: [fxRates.fromCurrency, fxRates.toCurrency, fxRates.effectiveOn, fxRates.source],
          set: { rate: data.rate, takenAt: new Date(), updatedAt: new Date() },
        }),
    )
  } catch (error) {
    // A code the currencies table does not hold.
    if (isForeignKeyViolation(error)) {
      return fail({ fromCurrency: tv('unknownCurrency') }, echo(form))
    }
    throw error
  }

  revalidatePath('/reference')
  return succeed(`${data.fromCurrency}${data.toCurrency}`)
})
