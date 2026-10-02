/**
 * The configuration tables the four-column reference form cannot hold —
 * FR-AD-03.
 *
 * Milestone templates, calendars, holidays, the tariff, the volumetric rules
 * and free time. Each is a row an administrator edits instead of a release,
 * and each feeds an engine that trusts it: a seven-day weekend never returns
 * a due date, a duty rate dated backwards cannot be reproduced for last
 * March's declaration. So the refusals matter as much as the saves, and each
 * one is asserted by its catalogue key rather than by a wording.
 *
 * The test database is never emptied. Every code, key and HS prefix below is
 * suffixed per run, and the two tables keyed by branch (chargeable and
 * free-time rules) are written against a branch this run creates for itself —
 * `chargeable_rules` is unique on (mode, branch), so a shared branch would
 * collide with the previous run's row on the second run.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/** Keys stand in for the sentences, as in `form-actions.test.ts`. */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const {
  branches,
  calendarHolidays,
  chargeableRules,
  dutyRates,
  freeTimeRules,
  fxRates,
  milestoneTemplates,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { ADMIN_PRINCIPAL, AWAY_BRANCH, HOME_BRANCH, adminActor, world } =
  await import('@/lib/testing/fixtures')

const {
  saveMilestoneTemplate,
  saveWorkingCalendar,
  saveHoliday,
  saveDutyRate,
  saveChargeableRule,
  saveFreeTimeRule,
  saveFxRate,
} = await import('./reference-actions')

const baseSession = {
  actor: adminActor,
  principal: {
    id: ADMIN_PRINCIPAL,
    nameEn: 'Fixture Administrator',
    nameAr: null,
    email: 'fixtures-admin@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['admin.reference.write', 'admin.branches.write']),
  branchRoles: new Map([
    [HOME_BRANCH, 'administrator'],
    [AWAY_BRANCH, 'administrator'],
  ]),
  requiresTwoFactor: false,
}

/** Replaced in `beforeAll` once the run's own branch exists. */
let session = baseSession

const form = (fields: Record<string, string | string[]>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v))
    else data.set(key, value)
  }
  return data
}

/** Per-run, because reference rows are retired rather than removed. */
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
/** The lower-case form, for the columns that allow only `[a-z0-9_]`. */
const run = RUN.toLowerCase()
let seq = 0
const next = () => (seq += 1)

let calendarId: string
let runBranch: string

/** A well-formed id that names no row, for the paths the database refuses. */
const NOWHERE = '00000000-0000-7000-8000-00000000ffff'

describe.skipIf(!enabled)('reference configuration — FR-AD-03', () => {
  beforeAll(async () => {
    const built = await world()
    calendarId = built.calendarId

    /*
      A branch of this run's own, so the (mode, branch) uniqueness on
      chargeable rules starts clean every run. The actor has to list it too:
      `chargeable_rules_scope` only lets an internal actor touch rows of the
      branches it carries.
    */
    const code = `RA${RUN}`
    await withActor(adminActor, (tx) =>
      tx
        .insert(branches)
        .values({
          code,
          legalNameEn: `Reference fixture ${RUN}`,
          legalNameAr: 'فرع الاختبار',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: code,
          calendarId,
        })
        .onConflictDoNothing(),
    )
    const [row] = await withActor(adminActor, (tx) =>
      tx.select({ id: branches.id }).from(branches).where(eq(branches.code, code)),
    )
    runBranch = row!.id

    session = {
      ...baseSession,
      actor: { ...adminActor, branchIds: [HOME_BRANCH, AWAY_BRANCH, runBranch] },
    }
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  /* ---------------------------------------------------- milestone templates */

  describe('milestone templates', () => {
    const step = (fields: Record<string, string>) =>
      form({
        mode: 'air',
        direction: 'export',
        seq: '3',
        nameEn: 'Cargo tendered',
        nameAr: 'تسليم البضاعة',
        customerVisible: 'on',
        isActive: 'on',
        ...fields,
      })

    const templateByCode = async (code: string) => {
      const rows = await withActor(adminActor, (tx) =>
        tx.select().from(milestoneTemplates).where(eq(milestoneTemplates.code, code)),
      )
      return rows
    }

    it('adds a step with its owner and planned offset', async () => {
      const code = `step_${run}_${next()}`

      const state = await saveMilestoneTemplate(
        {},
        step({ code, ownerRole: 'coordinator', plannedOffsetDays: '-2' }),
      )

      expect(state.errors).toBeUndefined()
      expect(state.ok).toMatch(new RegExp(`^${code}:`))
      const [row] = await templateByCode(code)
      expect(row?.mode).toBe('air')
      expect(row?.direction).toBe('export')
      expect(row?.seq).toBe(3)
      expect(row?.ownerRole).toBe('coordinator')
      expect(row?.plannedOffsetDays).toBe(-2)
      expect(row?.customerVisible).toBe(true)
    })

    it('falls back to the form’s defaults and stores an absent owner as nothing', async () => {
      const code = `step_${run}_${next()}`

      await saveMilestoneTemplate({}, form({ code, seq: '1', nameEn: 'Only', nameAr: 'فقط' }))

      const [row] = await templateByCode(code)
      // An unchecked box arrives as absent, not as 'false'.
      expect(row?.mode).toBe('sea_fcl')
      expect(row?.direction).toBe('import')
      expect(row?.ownerRole).toBeNull()
      expect(row?.customerVisible).toBe(false)
      expect(row?.isActive).toBe(false)
    })

    /**
     * No offset means "not planned", not "day zero". This stored 0 while the
     * union tried `z.coerce.number()` first, because `Number('')` is 0.
     */
    it('stores an absent offset as nothing rather than day zero', async () => {
      const code = `step_${run}_${next()}`

      await saveMilestoneTemplate({}, form({ code, seq: '1', nameEn: 'Only', nameAr: 'فقط' }))

      const [row] = await templateByCode(code)
      expect(row?.plannedOffsetDays).toBeNull()
    })

    it('edits the step it was given rather than adding another', async () => {
      const code = `step_${run}_${next()}`
      await saveMilestoneTemplate({}, step({ code }))
      const [created] = await templateByCode(code)

      await saveMilestoneTemplate(
        {},
        step({ templateId: created!.id, code, seq: '7', nameEn: 'Cargo tendered late' }),
      )

      const rows = await templateByCode(code)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.seq).toBe(7)
      expect(rows[0]?.nameEn).toBe('Cargo tendered late')
    })

    it('names the clash when the step already exists for that shape', async () => {
      const code = `step_${run}_${next()}`
      await saveMilestoneTemplate({}, step({ code }))

      const state = await saveMilestoneTemplate({}, step({ code }))

      expect(state.errors?.code).toBe('adminValidation.stepExists')
      // The form keeps what was typed.
      expect(state.values?.code).toBe(code)
    })

    it('refuses a code outside lower case, digits and underscores', async () => {
      const state = await saveMilestoneTemplate({}, step({ code: 'Cargo-Tendered' }))
      expect(state.errors?.code).toBe('adminValidation.lowerDigitsUnderscores')
    })

    it('refuses a sequence below one', async () => {
      const state = await saveMilestoneTemplate({}, step({ code: `step_${run}_z`, seq: '0' }))
      expect(state.errors?.seq).toBe('adminValidation.sequence')
    })

    /** NFR-01 — the Arabic name is what an Arabic customer's tracking page shows. */
    it('insists on the Arabic name, because customers see it', async () => {
      const state = await saveMilestoneTemplate({}, step({ code: `step_${run}_z`, nameAr: '' }))
      expect(state.errors?.nameAr).toBe('adminValidation.requiredCustomersSee')
    })

    it('insists on the English name', async () => {
      const state = await saveMilestoneTemplate({}, step({ code: `step_${run}_z`, nameEn: 'x' }))
      expect(state.errors?.nameEn).toBe('adminValidation.required')
    })

    it('refuses an offset that is not a whole number of days', async () => {
      const state = await saveMilestoneTemplate(
        {},
        step({ code: `step_${run}_z`, plannedOffsetDays: 'soon' }),
      )
      expect(state.errors?.plannedOffsetDays).toBeDefined()
    })

    it('refuses a mode the engine does not run', async () => {
      const state = await saveMilestoneTemplate({}, step({ code: `step_${run}_z`, mode: 'rail' }))
      expect(state.errors?.mode).toBeDefined()
    })
  })

  /* ------------------------------------------------------ working calendars */

  describe('working calendars', () => {
    const calendar = (fields: Record<string, string>) =>
      form({
        nameEn: 'Qatar office',
        nameAr: 'مكتب قطر',
        timeZone: 'Asia/Qatar',
        weekend: '5,6',
        dayStartMinute: '450',
        dayEndMinute: '990',
        isActive: 'on',
        ...fields,
      })

    const calendarByKey = async (key: string) => {
      const rows = await withActor(adminActor, (tx) =>
        tx.select().from(workingCalendars).where(eq(workingCalendars.key, key)),
      )
      return rows
    }

    it('adds a calendar with its weekend de-duplicated and in order', async () => {
      const key = `cal_${run}_${next()}`

      const state = await saveWorkingCalendar({}, calendar({ key, weekend: '6,5,6' }))

      expect(state.errors).toBeUndefined()
      const [row] = await calendarByKey(key)
      expect(row?.weekend).toEqual([5, 6])
      expect(row?.timeZone).toBe('Asia/Qatar')
      expect(row?.dayStartMinute).toBe(450)
      expect(row?.dayEndMinute).toBe(990)
    })

    /** Kuwait's week, eight to five — what a blank form means. */
    it('falls back to a Kuwaiti working week where the form left it out', async () => {
      const key = `cal_${run}_${next()}`

      await saveWorkingCalendar({}, form({ key, nameEn: 'Defaults', nameAr: 'افتراضي' }))

      const [row] = await calendarByKey(key)
      expect(row?.timeZone).toBe('Asia/Kuwait')
      expect(row?.weekend).toEqual([5, 6])
      expect(row?.dayStartMinute).toBe(480)
      expect(row?.dayEndMinute).toBe(1020)
      expect(row?.isActive).toBe(false)
    })

    it('edits the calendar it was given rather than adding another', async () => {
      const key = `cal_${run}_${next()}`
      await saveWorkingCalendar({}, calendar({ key }))
      const [created] = await calendarByKey(key)

      await saveWorkingCalendar({}, calendar({ calendarId: created!.id, key, weekend: '0' }))

      const rows = await calendarByKey(key)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.weekend).toEqual([0])
    })

    it('names the clash when the key is taken', async () => {
      const key = `cal_${run}_${next()}`
      await saveWorkingCalendar({}, calendar({ key }))

      const state = await saveWorkingCalendar({}, calendar({ key }))

      expect(state.errors?.key).toBe('adminValidation.calendarKeyInUse')
    })

    it('refuses a working day that ends before it starts', async () => {
      const state = await saveWorkingCalendar(
        {},
        calendar({ key: `cal_${run}_z`, dayStartMinute: '600', dayEndMinute: '600' }),
      )
      expect(state.errors?.dayEndMinute).toBe('adminValidation.dayEnd')
    })

    /**
     * Not an error anywhere downstream — `elapsedWorkingMinutes` would simply
     * never find a working day, and the enquiry queue would stop escalating.
     */
    it('refuses a week with no working days in it', async () => {
      const state = await saveWorkingCalendar(
        {},
        calendar({ key: `cal_${run}_z`, weekend: '0,1,2,3,4,5,6' }),
      )
      expect(state.errors?.weekend).toBe('adminValidation.noWorkingDays')
    })

    it('refuses a weekend that is not a list of weekday numbers', async () => {
      const state = await saveWorkingCalendar({}, calendar({ key: `cal_${run}_z`, weekend: 'Fri' }))
      expect(state.errors?.weekend).toBe('adminValidation.weekendDays')
    })

    it('refuses a key outside lower case, digits and underscores', async () => {
      const state = await saveWorkingCalendar({}, calendar({ key: 'Qatar Office' }))
      expect(state.errors?.key).toBe('adminValidation.lowerDigitsUnderscores')
    })

    it('refuses a time zone too short to be one', async () => {
      const state = await saveWorkingCalendar({}, calendar({ key: `cal_${run}_z`, timeZone: 'Q' }))
      expect(state.errors?.timeZone).toBe('adminValidation.chooseTimeZone')
    })
  })

  /* --------------------------------------------------------------- holidays */

  describe('holidays', () => {
    /** A calendar of this run's own, so a date is free the first time. */
    let holidayCalendar: string

    beforeAll(async () => {
      const key = `hol_${run}`
      await saveWorkingCalendar({}, form({ key, nameEn: 'Holidays', nameAr: 'عطلات' }))
      const [row] = await withActor(adminActor, (tx) =>
        tx
          .select({ id: workingCalendars.id })
          .from(workingCalendars)
          .where(eq(workingCalendars.key, key)),
      )
      holidayCalendar = row!.id
    })

    it('adds a closure to the calendar', async () => {
      const state = await saveHoliday(
        {},
        form({
          calendarId: holidayCalendar,
          onDate: '2027-03-20',
          nameEn: 'Eid al-Fitr',
          nameAr: 'عيد الفطر',
        }),
      )

      expect(state.ok).toMatch(/^2027-03-20:/)
      const rows = await withActor(adminActor, (tx) =>
        tx
          .select()
          .from(calendarHolidays)
          .where(
            and(
              eq(calendarHolidays.calendarId, holidayCalendar),
              eq(calendarHolidays.onDate, '2027-03-20'),
            ),
          ),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.nameAr).toBe('عيد الفطر')
    })

    it('says the day is already closed rather than raising', async () => {
      const fields = { calendarId: holidayCalendar, onDate: '2027-06-16', nameEn: 'Arafat Day' }
      await saveHoliday({}, form(fields))

      const state = await saveHoliday({}, form(fields))

      expect(state.errors?.onDate).toBe('adminValidation.closureExists')
    })

    it('insists on a calendar', async () => {
      const state = await saveHoliday({}, form({ onDate: '2027-01-01', nameEn: 'New Year' }))
      expect(state.errors?.calendarId).toBe('adminValidation.chooseCalendar')
    })

    /** A foreign-key miss is not "already closed", so it is not caught as one. */
    it('lets an unknown calendar’s foreign-key refusal propagate', async () => {
      await expect(
        saveHoliday({}, form({ calendarId: NOWHERE, onDate: '2027-01-01', nameEn: 'New Year' })),
      ).rejects.toThrow()
    })

    it('refuses a date that is not written as a date', async () => {
      const state = await saveHoliday(
        {},
        form({ calendarId, onDate: '01/01/2027', nameEn: 'New Year' }),
      )
      expect(state.errors?.onDate).toBe('adminValidation.dateFormat')
    })

    it('insists on the English name', async () => {
      const state = await saveHoliday({}, form({ calendarId, onDate: '2027-01-01' }))
      expect(state.errors?.nameEn).toBe('adminValidation.required')
    })
  })

  /* ------------------------------------------------------------- duty rates */

  describe('duty rates', () => {
    /*
      The unique index is (country, hs_prefix, effective_from), so the prefix
      carries the run. Seven digits of the clock plus a counter stays inside
      the ten a prefix may have.
    */
    const stamp = String(Date.now()).slice(-7)
    const prefix = () => `${stamp}${next()}`.slice(0, 10)

    const line = (fields: Record<string, string>) =>
      form({
        country: 'KW',
        ratePercent: '5',
        descriptionEn: 'Common external tariff',
        effectiveFrom: '2026-01-01',
        isActive: 'on',
        ...fields,
      })

    const rateByPrefix = async (hsPrefix: string) =>
      withActor(adminActor, (tx) =>
        tx.select().from(dutyRates).where(eq(dutyRates.hsPrefix, hsPrefix)),
      )

    it('adds a tariff line, upper-casing the country', async () => {
      const hsPrefix = prefix()

      const state = await saveDutyRate(
        {},
        line({
          hsPrefix,
          country: 'kw',
          ratePercent: '12.5',
          descriptionAr: 'التعرفة الموحدة',
          effectiveTo: '2026-12-31',
          notes: 'Pinned by a test',
        }),
      )

      expect(state.ok).toMatch(new RegExp(`^${hsPrefix}:`))
      const [row] = await rateByPrefix(hsPrefix)
      expect(row?.country).toBe('KW')
      // numeric(19,6) comes back as a string — compared as one, never as a float.
      expect(row?.ratePercent).toBe('12.500000')
      expect(row?.effectiveTo).toBe('2026-12-31')
      expect(row?.descriptionAr).toBe('التعرفة الموحدة')
    })

    it('leaves an open-ended rate open', async () => {
      const hsPrefix = prefix()

      await saveDutyRate({}, line({ hsPrefix }))

      const [row] = await rateByPrefix(hsPrefix)
      expect(row?.effectiveTo).toBeNull()
      expect(row?.descriptionAr).toBeNull()
      expect(row?.notes).toBeNull()
    })

    it('edits the line it was given rather than adding another', async () => {
      const hsPrefix = prefix()
      await saveDutyRate({}, line({ hsPrefix }))
      const [created] = await rateByPrefix(hsPrefix)

      await saveDutyRate({}, line({ rateId: created!.id, hsPrefix, ratePercent: '0.000001' }))

      const rows = await rateByPrefix(hsPrefix)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.ratePercent).toBe('0.000001')
    })

    /** A second rate from the same day is a second answer to one question. */
    it('names the clash when the prefix already has a rate from that date', async () => {
      const hsPrefix = prefix()
      await saveDutyRate({}, line({ hsPrefix }))

      const state = await saveDutyRate({}, line({ hsPrefix, ratePercent: '7' }))

      expect(state.errors?.hsPrefix).toBe('adminValidation.hsRateExists')
    })

    it('refuses a period that ends before it starts', async () => {
      const state = await saveDutyRate(
        {},
        line({ hsPrefix: prefix(), effectiveFrom: '2026-06-01', effectiveTo: '2026-05-31' }),
      )
      expect(state.errors?.effectiveTo).toBe('adminValidation.periodEndsBeforeStart')
    })

    /**
     * A one-day period. The end date is exclusive, and `duty_rates_period_ordered`
     * wants it after the start; this was a check violation and a 500 until the
     * action refused equal dates itself.
     */
    it('refuses a period that ends the day it starts with a sentence', async () => {
      const state = await saveDutyRate(
        {},
        line({ hsPrefix: prefix(), effectiveFrom: '2026-06-01', effectiveTo: '2026-06-01' }),
      )
      expect(state.errors?.effectiveTo).toBe('adminValidation.periodEndsAfterStart')
    })

    /**
     * `duty_rates_rate_sane` is the backstop the form does not duplicate. A
     * violation that is not a unique one is not the action's to explain, so it
     * propagates rather than turning into a misleading field message.
     */
    it('lets a constraint other than uniqueness propagate', async () => {
      await expect(
        saveDutyRate({}, line({ hsPrefix: prefix(), ratePercent: '150' })),
      ).rejects.toThrow()
    })

    it('refuses a country that is not two letters', async () => {
      const state = await saveDutyRate({}, line({ hsPrefix: prefix(), country: 'KWT' }))
      expect(state.errors?.country).toBe('adminValidation.twoLetterCountry')
    })

    it('refuses a prefix of one digit', async () => {
      const state = await saveDutyRate({}, line({ hsPrefix: '8' }))
      expect(state.errors?.hsPrefix).toBe('adminValidation.minTwoDigits')
    })

    it('refuses a prefix with anything but digits', async () => {
      const state = await saveDutyRate({}, line({ hsPrefix: '87.03' }))
      expect(state.errors?.hsPrefix).toBe('adminValidation.digitsOnly')
    })

    it('refuses a rate written with a percent sign', async () => {
      const state = await saveDutyRate({}, line({ hsPrefix: prefix(), ratePercent: '5%' }))
      expect(state.errors?.ratePercent).toBe('adminValidation.percentageExample')
    })

    it('refuses dates that are not written as dates', async () => {
      const state = await saveDutyRate(
        {},
        line({ hsPrefix: prefix(), effectiveFrom: '1 Jan 2026', effectiveTo: 'never' }),
      )
      expect(state.errors?.effectiveFrom).toBe('adminValidation.dateFormat')
      expect(state.errors?.effectiveTo).toBeDefined()
    })

    it('insists on an English description', async () => {
      const state = await saveDutyRate({}, line({ hsPrefix: prefix(), descriptionEn: '' }))
      expect(state.errors?.descriptionEn).toBe('adminValidation.required')
    })
  })

  /* ------------------------------------------------------ chargeable rules */

  describe('chargeable rules', () => {
    const ruleFor = async (mode: 'air' | 'courier' | 'sea_lcl' | 'sea_fcl' | 'land') =>
      withActor(session.actor, (tx) =>
        tx
          .select()
          .from(chargeableRules)
          .where(and(eq(chargeableRules.branchId, runBranch), eq(chargeableRules.mode, mode))),
      )

    /** A branch that negotiated its own divisor is a row, not a release. */
    it('adds a branch’s own rule, divisor stored as the trade states it', async () => {
      const state = await saveChargeableRule(
        {},
        form({
          mode: 'courier',
          branchId: runBranch,
          divisorCm3PerKg: '5000',
          roundUpToKg: '0.5',
          minimumKg: '1',
          isActive: 'on',
        }),
      )

      expect(state.ok).toMatch(/^courier:/)
      const [row] = await ruleFor('courier')
      expect(row?.divisorCm3PerKg).toBe('5000.000000')
      expect(row?.roundUpToKg).toBe('0.500000')
      expect(row?.minimumKg).toBe('1.000000')
      expect(row?.isActive).toBe(true)
    })

    /** FCL is billed per container, so it has no divisor and no floor. */
    it('stores no divisor and a zero floor where the form left them out', async () => {
      await saveChargeableRule({}, form({ mode: 'sea_fcl', branchId: runBranch, roundUpToKg: '1' }))

      const [row] = await ruleFor('sea_fcl')
      expect(row?.divisorCm3PerKg).toBeNull()
      expect(row?.minimumKg).toBe('0.000000')
      expect(row?.isActive).toBe(false)
    })

    it('edits the rule it was given rather than adding another', async () => {
      await saveChargeableRule(
        {},
        form({ mode: 'land', branchId: runBranch, divisorCm3PerKg: '3000', roundUpToKg: '1' }),
      )
      const [created] = await ruleFor('land')

      await saveChargeableRule(
        {},
        form({
          ruleId: created!.id,
          mode: 'land',
          branchId: runBranch,
          divisorCm3PerKg: '4000',
          roundUpToKg: '1',
          isActive: 'on',
        }),
      )

      const rows = await ruleFor('land')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.divisorCm3PerKg).toBe('4000.000000')
    })

    /** One rule per mode per branch — two would make the divisor a coin toss. */
    it('names the clash when the branch already has a rule for the mode', async () => {
      const fields = {
        mode: 'air',
        branchId: runBranch,
        divisorCm3PerKg: '6000',
        roundUpToKg: '0.5',
      }
      await saveChargeableRule({}, form(fields))

      const state = await saveChargeableRule({}, form(fields))

      expect(state.errors?.mode).toBe('adminValidation.modeRuleExists')
    })

    it('refuses a divisor that is not a number', async () => {
      const state = await saveChargeableRule(
        {},
        form({ mode: 'air', divisorCm3PerKg: 'six thousand', roundUpToKg: '0.5' }),
      )
      expect(state.errors?.divisorCm3PerKg).toBeDefined()
    })

    it('insists on a round-up increment', async () => {
      const state = await saveChargeableRule({}, form({ mode: 'air', divisorCm3PerKg: '6000' }))
      expect(state.errors?.roundUpToKg).toBe('adminValidation.incrementExample')
    })

    it('refuses a floor that is not a number', async () => {
      const state = await saveChargeableRule(
        {},
        form({ mode: 'air', roundUpToKg: '0.5', minimumKg: '-1' }),
      )
      expect(state.errors?.minimumKg).toBe('adminValidation.floorOrZero')
    })

    it('refuses a branch that is not an id', async () => {
      const state = await saveChargeableRule(
        {},
        form({ mode: 'air', branchId: 'kuwait', roundUpToKg: '0.5' }),
      )
      expect(state.errors?.branchId).toBeDefined()
    })

    /**
     * `chargeable_rules_scope` refuses a branch the actor does not carry, and
     * only a unique violation is the action's to explain — anything else
     * propagates rather than being dressed up as "a rule already exists".
     */
    it('lets the branch policy’s refusal propagate', async () => {
      await expect(
        saveChargeableRule(
          {},
          form({ mode: 'air', branchId: NOWHERE, divisorCm3PerKg: '6000', roundUpToKg: '0.5' }),
        ),
      ).rejects.toThrow()
    })
  })

  /* ------------------------------------------------------ free-time rules */

  describe('free-time rules', () => {
    const rulesFor = async (kind: 'demurrage' | 'detention' | 'storage') =>
      withActor(session.actor, (tx) =>
        tx
          .select()
          .from(freeTimeRules)
          .where(and(eq(freeTimeRules.branchId, runBranch), eq(freeTimeRules.kind, kind))),
      )

    it('adds the terms a branch negotiated, currency upper-cased', async () => {
      const state = await saveFreeTimeRule(
        {},
        form({
          kind: 'detention',
          branchId: runBranch,
          mode: 'sea_fcl',
          freeDays: '14',
          perDiem: '2.750',
          currency: 'kwd',
          dayBasis: 'working',
          isActive: 'on',
        }),
      )

      expect(state.ok).toMatch(/^detention:/)
      const rows = await rulesFor('detention')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.mode).toBe('sea_fcl')
      expect(rows[0]?.freeDays).toBe(14)
      expect(rows[0]?.perDiem).toBe('2.750000')
      expect(rows[0]?.currency).toBe('KWD')
      expect(rows[0]?.dayBasis).toBe('working')
    })

    /** Narrowing is by absence: no mode applies to every mode. */
    it('leaves mode and container type open where the form left them out', async () => {
      await saveFreeTimeRule({}, form({ branchId: runBranch, perDiem: '10' }))

      const rows = await rulesFor('demurrage')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.mode).toBeNull()
      expect(rows[0]?.containerType).toBeNull()
      expect(rows[0]?.freeDays).toBe(0)
      expect(rows[0]?.currency).toBe('KWD')
      expect(rows[0]?.dayBasis).toBe('calendar')
    })

    it('edits the rule it was given rather than adding another', async () => {
      await saveFreeTimeRule(
        {},
        form({ kind: 'storage', branchId: runBranch, freeDays: '3', perDiem: '1' }),
      )
      const [created] = await rulesFor('storage')

      await saveFreeTimeRule(
        {},
        form({
          ruleId: created!.id,
          kind: 'storage',
          branchId: runBranch,
          freeDays: '5',
          perDiem: '1.250',
          isActive: 'on',
        }),
      )

      const rows = await rulesFor('storage')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.freeDays).toBe(5)
      expect(rows[0]?.perDiem).toBe('1.250000')
    })

    it('refuses a daily charge that is not an amount', async () => {
      const state = await saveFreeTimeRule({}, form({ perDiem: 'KWD 5' }))
      expect(state.errors?.perDiem).toBe('adminValidation.amountPerDay')
    })

    it('refuses negative free days', async () => {
      const state = await saveFreeTimeRule({}, form({ perDiem: '5', freeDays: '-1' }))
      expect(state.errors?.freeDays).toBeDefined()
    })

    it('refuses a currency that is not a three-letter code', async () => {
      const state = await saveFreeTimeRule({}, form({ perDiem: '5', currency: 'KD' }))
      expect(state.errors?.currency).toBeDefined()
    })

    it('refuses a clock kind the engine does not run', async () => {
      const state = await saveFreeTimeRule({}, form({ perDiem: '5', kind: 'parking' }))
      expect(state.errors?.kind).toBeDefined()
    })

    /*
      F53: these passed the schema and reached a foreign key, which used to
      surface as a 500. Each now names its own field, and nothing is written.
    */
    it.each([
      ['containerType', { containerType: `ZZ${RUN}` }, 'adminValidation.unknownContainerType'],
      ['currency', { currency: 'ZZQ' }, 'adminValidation.unknownCurrency'],
      ['branchId', { branchId: NOWHERE }, 'adminValidation.chooseBranch'],
    ] as const)(
      'refuses a %s the reference tables do not hold, beside that field',
      async (field, over, message) => {
        const before = (await rulesFor('detention')).length
        const state = await saveFreeTimeRule(
          {},
          form({ kind: 'detention', branchId: runBranch, perDiem: '5', ...over }),
        )

        expect(state.ok).toBeUndefined()
        expect(state.errors).toEqual({ [field]: message })
        // The form comes back as typed, so the operator corrects one field.
        expect(state.values?.perDiem).toBe('5')
        expect(await rulesFor('detention')).toHaveLength(before)
      },
    )
  })

  /* -------------------------------------------------------- exchange rates */

  /**
   * Pricing refuses a USD card without a rate onto the base, and a fresh
   * instance had no rate and no screen to enter one (S12). Entered again for
   * the same pair and day, the manual figure is corrected, not doubled.
   */
  describe('an exchange rate', () => {
    // INR into QAR: a pair no other suite converts, so this cannot move theirs.
    const ratesFor = (day: string) =>
      withActor(adminActor, (tx) =>
        tx
          .select({ rate: fxRates.rate, source: fxRates.source })
          .from(fxRates)
          .where(
            and(
              eq(fxRates.fromCurrency, 'INR'),
              eq(fxRates.toCurrency, 'QAR'),
              eq(fxRates.effectiveOn, day),
            ),
          ),
      )

    it('records a manual rate, and corrects it on a second entry for the day', async () => {
      const day = `2031-0${(Number(RUN.charCodeAt(0)) % 9) + 1}-15`
      const entry = (rate: string) =>
        saveFxRate({}, form({ fromCurrency: 'inr', toCurrency: 'QAR', rate, effectiveOn: day }))

      expect((await entry('0.04400000')).errors).toBeUndefined()
      expect((await entry('0.04410000')).errors).toBeUndefined()

      // fx_rates.rate holds 14 places since R7, so the stored text carries them.
      expect(await ratesFor(day)).toEqual([{ rate: '0.04410000000000', source: 'manual' }])
    })

    it('refuses a rate of zero and a pair of one currency', async () => {
      const zero = await saveFxRate(
        {},
        form({ fromCurrency: 'INR', toCurrency: 'QAR', rate: '0', effectiveOn: '2031-01-01' }),
      )
      expect(zero.errors?.rate).toBe('adminValidation.fxRateExample')

      const same = await saveFxRate(
        {},
        form({ fromCurrency: 'QAR', toCurrency: 'QAR', rate: '1', effectiveOn: '2031-01-01' }),
      )
      expect(same.errors?.toCurrency).toBe('adminValidation.fxSameCurrency')
    })
  })

  /* ------------------------------------------------------------ permission */

  /**
   * `assertCan` is the first line of every action here. The policies would
   * refuse the write too, but a caller without the key should never reach
   * validation, let alone the database.
   */
  it('refuses every save to a caller without the reference key', async () => {
    harness.session = { ...session, permissions: new Set(['admin.users.write']) }
    try {
      for (const action of [
        saveMilestoneTemplate,
        saveWorkingCalendar,
        saveHoliday,
        saveDutyRate,
        saveChargeableRule,
        saveFreeTimeRule,
        saveFxRate,
      ]) {
        await expect(action({}, form({}))).rejects.toThrow()
      }
    } finally {
      harness.session = session
    }
  })
})
