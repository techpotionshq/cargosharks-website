/**
 * Development and pilot seed.
 *
 * Everything here is a *row that drives an engine* (§7): currencies with their
 * minor units, the six-basis charge catalogue, milestone templates per mode,
 * exception codes, working calendars. Seeding them is not test-data
 * convenience — it is the configuration the application has no hard-coded
 * fallback for.
 *
 * Runs as `app_migrator`, since reference tables are administrator-write and
 * there is no administrator yet.
 */

import { sql } from 'drizzle-orm'
import { loadEnv } from './env'
import { ADMIN_PERMISSIONS, SEED_KW_TARIFF, permissionKeys } from '@qabandi/core'
import { createDatabase } from './client'
import { NOTIFICATION_TEMPLATES } from './notification-templates'
import { SYSTEM_PRINCIPAL_ID, systemActor, withActor } from './actor'
import {
  chargeTypes,
  chargeableRules,
  containerTypes,
  countries,
  currencies,
  dutyRates,
  exceptionCodes,
  documentTypes,
  incoterms,
  milestoneTemplates,
  notificationTemplates,
  principals,
  rolePermissions,
  roles,
  workingCalendars,
} from './schema/index'
loadEnv()

/*
  `isTracked` decides which of these the daily FX refresh fetches a rate for.

  Every currency except the base, because that is what `FX_QUOTE_CURRENCIES`
  defaulted to before this was a column and a fresh seed should behave the way
  a fresh deployment always has. KWD is left untracked because a rate from the
  base to itself is one, and asking a metered feed for it is noise.

  An administrator narrows this on the reference screen where the feed is
  metered — it is separate from `is_active` precisely so a currency can stay
  perfectly live on historic invoices without costing an API call a day.
*/
const CURRENCIES = [
  { code: 'KWD', nameEn: 'Kuwaiti Dinar', nameAr: 'دينار كويتي', minorUnits: 3, symbol: 'د.ك', isTracked: false },
  { code: 'BHD', nameEn: 'Bahraini Dinar', nameAr: 'دينار بحريني', minorUnits: 3, symbol: 'د.ب', isTracked: true },
  { code: 'OMR', nameEn: 'Omani Rial', nameAr: 'ريال عماني', minorUnits: 3, symbol: 'ر.ع', isTracked: true },
  { code: 'USD', nameEn: 'US Dollar', nameAr: 'دولار أمريكي', minorUnits: 2, symbol: '$', isTracked: true },
  { code: 'EUR', nameEn: 'Euro', nameAr: 'يورو', minorUnits: 2, symbol: '€', isTracked: true },
  { code: 'GBP', nameEn: 'Pound Sterling', nameAr: 'جنيه إسترليني', minorUnits: 2, symbol: '£', isTracked: true },
  { code: 'AED', nameEn: 'UAE Dirham', nameAr: 'درهم إماراتي', minorUnits: 2, symbol: 'د.إ', isTracked: true },
  { code: 'QAR', nameEn: 'Qatari Riyal', nameAr: 'ريال قطري', minorUnits: 2, symbol: 'ر.ق', isTracked: true },
  { code: 'SAR', nameEn: 'Saudi Riyal', nameAr: 'ريال سعودي', minorUnits: 2, symbol: 'ر.س', isTracked: true },
  { code: 'INR', nameEn: 'Indian Rupee', nameAr: 'روبية هندية', minorUnits: 2, symbol: '₹', isTracked: true },
  { code: 'CNY', nameEn: 'Chinese Yuan', nameAr: 'يوان صيني', minorUnits: 2, symbol: '¥', isTracked: true },
]

const COUNTRIES = [
  { code: 'KW', nameEn: 'Kuwait', nameAr: 'الكويت', defaultCurrency: 'KWD' },
  { code: 'AE', nameEn: 'United Arab Emirates', nameAr: 'الإمارات', defaultCurrency: 'AED' },
  { code: 'QA', nameEn: 'Qatar', nameAr: 'قطر', defaultCurrency: 'QAR' },
  { code: 'SA', nameEn: 'Saudi Arabia', nameAr: 'السعودية', defaultCurrency: 'SAR' },
  { code: 'BH', nameEn: 'Bahrain', nameAr: 'البحرين', defaultCurrency: 'BHD' },
  { code: 'OM', nameEn: 'Oman', nameAr: 'عُمان', defaultCurrency: 'OMR' },
  { code: 'IN', nameEn: 'India', nameAr: 'الهند', defaultCurrency: 'INR' },
  { code: 'CN', nameEn: 'China', nameAr: 'الصين', defaultCurrency: 'CNY' },
  { code: 'GB', nameEn: 'United Kingdom', nameAr: 'المملكة المتحدة', defaultCurrency: 'GBP' },
  { code: 'US', nameEn: 'United States', nameAr: 'الولايات المتحدة', defaultCurrency: 'USD' },
]

/**
 * FR-RT-05's catalogue: eighteen accessorials, each naming one of the six
 * bases in `core/rating.ts`. Six functions, eighteen rows.
 */
const CHARGE_TYPES = [
  ['ocean_freight', 'Ocean Freight', 'أجرة الشحن البحري', 'per_container', 'freight'],
  ['air_freight', 'Air Freight', 'أجرة الشحن الجوي', 'per_kg', 'freight'],
  ['road_freight', 'Road Freight', 'أجرة النقل البري', 'flat', 'freight'],
  ['thc_origin', 'Terminal Handling — Origin', 'مناولة المحطة - المنشأ', 'per_container', 'origin'],
  [
    'thc_destination',
    'Terminal Handling — Destination',
    'مناولة المحطة - الوجهة',
    'per_container',
    'destination',
  ],
  ['documentation', 'Documentation', 'رسوم المستندات', 'flat', 'origin'],
  ['fuel_surcharge', 'Fuel Surcharge', 'رسوم الوقود', 'percent', 'freight'],
  ['security_surcharge', 'Security Surcharge', 'رسوم الأمن', 'per_kg', 'freight'],
  ['customs_clearance', 'Customs Clearance', 'التخليص الجمركي', 'flat', 'destination'],
  ['delivery_order', 'Delivery Order', 'إذن التسليم', 'flat', 'destination'],
  ['haulage', 'Haulage', 'النقل الداخلي', 'per_container', 'destination'],
  ['dangerous_goods', 'Dangerous Goods', 'البضائع الخطرة', 'per_unit', 'special'],
  ['out_of_gauge', 'Out of Gauge', 'شحنات غير قياسية', 'per_container', 'special'],
  ['reefer_monitoring', 'Reefer Monitoring', 'مراقبة التبريد', 'per_day', 'special'],
  ['inspection', 'Inspection', 'الفحص', 'flat', 'destination'],
  ['legalisation', 'Legalisation', 'التصديق', 'per_unit', 'origin'],
  ['permit', 'Permit', 'التصاريح', 'flat', 'destination'],
  ['insurance', 'Cargo Insurance', 'تأمين البضائع', 'percent', 'other'],
  ['demurrage', 'Demurrage', 'غرامة التأخير', 'per_day', 'other'],
  ['detention', 'Detention', 'غرامة الاحتجاز', 'per_day', 'other'],
  ['storage', 'Storage', 'رسوم التخزين', 'per_day', 'other'],
] as const

/**
 * The four flows from the domain primer — sea import, sea export, air, land —
 * as four sets of rows against one template engine (§7.3).
 */
const MILESTONES = [
  [
    'sea_fcl',
    'import',
    [
      'booking_confirmed',
      'cargo_received',
      'vessel_departed',
      'vessel_arrived',
      'discharged',
      'customs_cleared',
      'gate_out',
      'delivered',
      'empty_returned',
    ],
  ],
  [
    'sea_fcl',
    'export',
    [
      'booking_confirmed',
      'empty_picked_up',
      'stuffed',
      'gate_in',
      'customs_cleared',
      'loaded',
      'vessel_departed',
      'vessel_arrived',
      'delivered',
    ],
  ],
  [
    'sea_lcl',
    'import',
    [
      'booking_confirmed',
      'cargo_received',
      'vessel_departed',
      'vessel_arrived',
      'discharged',
      'devanned',
      'customs_cleared',
      'delivered',
    ],
  ],
  [
    'air',
    'import',
    [
      'booking_confirmed',
      'cargo_received',
      'flight_departed',
      'flight_arrived',
      'customs_cleared',
      'delivered',
    ],
  ],
  [
    'air',
    'export',
    [
      'booking_confirmed',
      'cargo_received',
      'customs_cleared',
      'flight_departed',
      'flight_arrived',
      'delivered',
    ],
  ],
  [
    'land',
    'import',
    ['booking_confirmed', 'loaded', 'border_crossed', 'customs_cleared', 'delivered'],
  ],
] as const

const MILESTONE_NAMES: Record<string, [string, string]> = {
  booking_confirmed: ['Booking confirmed', 'تأكيد الحجز'],
  cargo_received: ['Cargo received', 'استلام البضاعة'],
  empty_picked_up: ['Empty container collected', 'استلام الحاوية الفارغة'],
  stuffed: ['Container stuffed', 'تعبئة الحاوية'],
  gate_in: ['Gate in', 'دخول الميناء'],
  loaded: ['Loaded', 'التحميل'],
  vessel_departed: ['Vessel departed', 'مغادرة السفينة'],
  vessel_arrived: ['Vessel arrived', 'وصول السفينة'],
  flight_departed: ['Flight departed', 'مغادرة الرحلة'],
  flight_arrived: ['Flight arrived', 'وصول الرحلة'],
  border_crossed: ['Border crossed', 'عبور الحدود'],
  discharged: ['Discharged', 'التفريغ'],
  devanned: ['Devanned', 'تفريغ الحاوية'],
  customs_cleared: ['Customs cleared', 'التخليص الجمركي'],
  gate_out: ['Gate out', 'الخروج من الميناء'],
  delivered: ['Delivered', 'التسليم'],
  empty_returned: ['Empty returned', 'إعادة الحاوية الفارغة'],
}

/**
 * How far a supplier's bill may drift from the accrual before somebody looks
 * — FR-FN-09, 0014.
 *
 * Seeded rather than left at zero, and that is a judgement rather than a
 * default. Zero tolerance flags every rounding difference on a 2 KWD
 * documentation fee, and a variance report that fires on everything is
 * switched off within a week — which is the failure mode of every variance
 * report that has ever been written.
 *
 * These are starting figures a forwarder recognises: freight moves with the
 * market between booking and bill and gets a percentage; origin and
 * destination accessorials are quoted flat and get a small cash allowance;
 * duty and government charges are billed to the fils and get nothing at all.
 * An administrator changes any of them without a release (FR-AD-03), which is
 * the point of them being rows.
 *
 * `core/matching.ts` takes whichever of the two limits is the more generous.
 */
const VARIANCE_TOLERANCE: Record<
  string,
  { varianceTolerancePercent: string; varianceToleranceAbsolute: string }
> = {
  freight: { varianceTolerancePercent: '1', varianceToleranceAbsolute: '2' },
  origin: { varianceTolerancePercent: '0', varianceToleranceAbsolute: '2' },
  destination: { varianceTolerancePercent: '0', varianceToleranceAbsolute: '2' },
  /*
    Dangerous goods, out-of-gauge and reefer monitoring are quoted per event
    and billed per event: a difference here is a different service, not a
    market movement, and it is worth asking about at any size.
  */
  special: { varianceTolerancePercent: '0', varianceToleranceAbsolute: '0' },
  other: { varianceTolerancePercent: '0', varianceToleranceAbsolute: '1' },
}

const ROLES = [
  ['administrator', 'Administrator', 'مسؤول النظام', true],
  ['finance', 'Finance', 'المالية', true],
  ['operations_manager', 'Operations Manager', 'مدير العمليات', false],
  ['coordinator', 'Coordinator', 'منسق', false],
  ['sales', 'Sales', 'المبيعات', false],
  ['customs_broker', 'Customs Broker', 'مخلص جمركي', false],
  ['read_only', 'Read Only', 'اطلاع فقط', false],
] as const

/**
 * Permissions beyond the state-machine keys, now declared in `core` as
 * `ADMIN_PERMISSIONS` alongside the reasoning for each.
 *
 * They lived here, which made this file the only place in the system that knew
 * the full set — so `permissionKeys()` returned half the permissions and every
 * other caller that meant "everything" quietly got the operational half. The
 * pilot session was one such caller, and the visible symptom was that
 * `/settings/*` redirected to the dashboard in every fixture-backed
 * deployment: the console the README points at as inspectable proof of the
 * whitelabel system could not be opened.
 */
const EXTRA_PERMISSIONS = ADMIN_PERMISSIONS

/**
 * The permission matrix — FR-ID-03.
 *
 * Six of the seven roles previously seeded with **no** permissions at all,
 * which made every non-administrator account inert: the session assembled an
 * empty permission set, so `assertCan` rejected every action and the interface
 * offered none. The grants below are the separation of duties a forwarder
 * actually runs on, and the two that matter:
 *
 *   - Only finance may issue, void or credit an invoice. An operations manager
 *     who could issue invoices is the classic segregation-of-duties failure,
 *     and it is the one an auditor asks about first.
 *   - Only a coordinator's supervisor — the operations manager — may cancel or
 *     close a job. A coordinator moves work forward; reversing it is escalated.
 *
 * `administrator` is not listed: it receives every key, including any added
 * later, so a new transition cannot ship unreachable.
 */
const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  finance: [
    'invoice.approve',
    'invoice.credit',
    'invoice.issue',
    'invoice.void',
    'payment.record',
    'customs.pay',
    'finance.export',
    /*
      Finance may split a master cost but not build the master.

      The allocation decides what twenty jobs cost and therefore what twenty
      margins are; the vessel it sailed on is operations' business. Splitting
      the two keys this way is the same segregation as invoice.issue sitting
      with finance and job.book sitting with operations.
    */
    'consol.allocate',
    /*
      Finance approves and pays a supplier bill; it does not capture one.

      Capturing is operations' work — the coordinator holding the file knows
      which job the agent's line belongs to. Approving it *with the variance in
      front of them* is the act this whole feature exists to make possible, and
      it is finance's, for the same segregation reason that keeps invoice
      issuance here (0014).
    */
    'payable.approve',
    'payable.pay',
    'payable.record',
    /*
      A set-off touches receivables as well as payables and moves no cash, so
      it belongs with the people who answer for the relationship rather than
      with either ledger.
    */
    'settlement.run',
    /*
      Finance holds the credit exception because finance holds the ageing.

      Shared with the operations manager below rather than owned here: the
      person who releases the container is as often the one who answers for the
      relationship as the one who answers for the balance, and a check only one
      of them can clear is a check that gets routed around at 4pm.
    */
    'credit.override',
    'report.read',
    'job.read',
  ],
  operations_manager: [
    /*
      Reference data is *operational* here, not administrative.

      An operations manager adds a port, a commodity or an exception code as
      part of doing the job — a shipment routed through a depot nobody has
      recorded cannot be booked until somebody records it. Making that wait for
      an administrator is how a system ends up with a free-text "other" field
      that swallows the data it was meant to structure.
    */
    'admin.reference.write',
    'credit.override',
    'enquiry.assign',
    'enquiry.cancel',
    'enquiry.close',
    'enquiry.rate',
    'quote.accept',
    'quote.reject',
    'quote.revise',
    'quote.send',
    'job.book',
    'job.cancel',
    'job.close',
    'job.complete',
    'job.hold',
    'job.read',
    'job.update',
    'customs.file',
    'customs.update',
    'customs.pay',
    'document.release',
    'document.generate',
    'consol.write',
    'consol.allocate',
    /*
      An operations manager records what an agent billed and matches it, and
      may run a set-off — they are the person who negotiates the agent
      relationship. They cannot approve a bill for payment: that stays with
      finance.
    */
    'payable.record',
    'settlement.run',
    'rate.card.write',
    'customer.write',
    'partner.write',
    'report.read',
  ],
  coordinator: [
    'enquiry.assign',
    'enquiry.rate',
    'quote.send',
    'quote.revise',
    'job.book',
    'job.hold',
    'job.read',
    'job.update',
    'customs.file',
    'customs.update',
    /*
      A coordinator releases documents, and this is a deliberate call rather
      than a default.

      They are the person holding the file when the carrier confirms, and
      routing every release through a manager would mean either a bottleneck
      at the exact moment a shipment is waiting, or a manager who approves
      without looking — which is worse than not requiring approval. The control
      that makes this safe is that the release is audited and irreversible in
      the record, not that it is rationed.
    */
    'document.release',
    /*
      Issuing a document is the coordinator's job for the same reason
      releasing one is: they are holding the file when the carrier confirms,
      and routing it through a manager means either a bottleneck at the moment
      a shipment is waiting or a manager who approves without looking.

      `consol.write` on the same reasoning — building the master is the work,
      not an approval of it. Splitting the cost is not here: that is
      `consol.allocate`, and it belongs with the people who answer for the
      margin.
    */
    'document.generate',
    'consol.write',
    /*
      Capturing an agent's invoice is the coordinator's work for the same
      reason releasing a document is: they are holding the file, and they are
      the only person who can say which of the thirty shipments on a monthly
      agent invoice each line belongs to. Nothing they do here releases money.
    */
    'payable.record',
    'customer.write',
  ],
  sales: [
    'enquiry.assign',
    'enquiry.close',
    'enquiry.cancel',
    'enquiry.rate',
    'quote.accept',
    'quote.reject',
    'quote.revise',
    'quote.send',
    'customer.write',
    'job.read',
    'report.read',
  ],
  customs_broker: ['customs.file', 'customs.update', 'customs.pay', 'job.read', 'job.update'],
  read_only: ['job.read', 'report.read'],
}

/**
 * Seeding is background work, and background work is an auditable principal
 * rather than an absence of one (§5.2).
 *
 * So the seed connects as `app_user` and runs under `SYSTEM_ACTOR` — it does
 * not connect as the owner to sidestep the policies. Two things follow, both
 * wanted: the reference tables' write policy (`app.has_permission`) is
 * exercised on the very first insert rather than the first admin edit in
 * production, and every seeded row carries an audit entry attributing it to
 * the system principal.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const database = createDatabase({ connectionString: url, max: 1 })

  await withActor(
    systemActor(),
    async (db) => {
      await db.insert(currencies).values(CURRENCIES).onConflictDoNothing()
      await db.insert(countries).values(COUNTRIES).onConflictDoNothing()

      await db
        .insert(incoterms)
        .values([
          { code: 'EXW', nameEn: 'Ex Works', nameAr: 'تسليم المصنع' },
          { code: 'FCA', nameEn: 'Free Carrier', nameAr: 'التسليم للناقل' },
          { code: 'FOB', nameEn: 'Free on Board', nameAr: 'تسليم ظهر السفينة' },
          { code: 'CFR', nameEn: 'Cost and Freight', nameAr: 'التكلفة وأجرة الشحن' },
          { code: 'CIF', nameEn: 'Cost, Insurance and Freight', nameAr: 'التكلفة والتأمين والشحن' },
          { code: 'CPT', nameEn: 'Carriage Paid To', nameAr: 'أجرة النقل مدفوعة إلى' },
          {
            code: 'CIP',
            nameEn: 'Carriage and Insurance Paid To',
            nameAr: 'النقل والتأمين مدفوعان إلى',
          },
          { code: 'DAP', nameEn: 'Delivered at Place', nameAr: 'التسليم في المكان' },
          {
            code: 'DPU',
            nameEn: 'Delivered at Place Unloaded',
            nameAr: 'التسليم في المكان مفرغاً',
          },
          { code: 'DDP', nameEn: 'Delivered Duty Paid', nameAr: 'التسليم خالص الرسوم' },
        ])
        .onConflictDoNothing()

      await db
        .insert(containerTypes)
        .values([
          { code: '20GP', nameEn: "20' General Purpose", nameAr: 'حاوية 20 قدم', teu: '1' },
          { code: '40GP', nameEn: "40' General Purpose", nameAr: 'حاوية 40 قدم', teu: '2' },
          { code: '40HC', nameEn: "40' High Cube", nameAr: 'حاوية 40 قدم عالية', teu: '2' },
          {
            code: '20RF',
            nameEn: "20' Reefer",
            nameAr: 'حاوية 20 قدم مبردة',
            teu: '1',
            isReefer: true,
          },
          {
            code: '40RF',
            nameEn: "40' Reefer",
            nameAr: 'حاوية 40 قدم مبردة',
            teu: '2',
            isReefer: true,
          },
          { code: '20FR', nameEn: "20' Flat Rack", nameAr: 'حاوية مسطحة 20 قدم', teu: '1' },
          { code: '40OT', nameEn: "40' Open Top", nameAr: 'حاوية مفتوحة 40 قدم', teu: '2' },
        ])
        .onConflictDoNothing()

      await db
        .insert(chargeTypes)
        .values(
          CHARGE_TYPES.map(([key, nameEn, nameAr, basis, category], index) => ({
            key,
            nameEn,
            nameAr,
            defaultBasis: basis,
            category,
            sortOrder: index * 10,
            ...(VARIANCE_TOLERANCE[category] ?? VARIANCE_TOLERANCE.other!),
          })),
        )
        .onConflictDoNothing()

      // Divisors as the industry states them — cm³ per kilogram (§7.1).
      await db
        .insert(chargeableRules)
        .values([
          { mode: 'air' as const, divisorCm3PerKg: '6000', roundUpToKg: '0.5', minimumKg: '45' },
          {
            mode: 'sea_lcl' as const,
            divisorCm3PerKg: '1000',
            roundUpToKg: '0.001',
            minimumKg: '1000',
          },
          { mode: 'land' as const, divisorCm3PerKg: '3000', roundUpToKg: '1', minimumKg: '0' },
          {
            mode: 'courier' as const,
            divisorCm3PerKg: '5000',
            roundUpToKg: '0.5',
            minimumKg: '0.5',
          },
          { mode: 'sea_fcl' as const, divisorCm3PerKg: null, roundUpToKg: '1', minimumKg: '0' },
        ])
        .onConflictDoNothing()

      await db
        .insert(milestoneTemplates)
        .values(
          MILESTONES.flatMap(([mode, direction, codes]) =>
            codes.map((code, index) => ({
              mode,
              direction,
              seq: (index + 1) * 10,
              code,
              nameEn: MILESTONE_NAMES[code]?.[0] ?? code,
              nameAr: MILESTONE_NAMES[code]?.[1] ?? code,
              customerVisible: true,
            })),
          ),
        )
        .onConflictDoNothing()

      await db
        .insert(exceptionCodes)
        .values([
          { code: 'delay_vessel', nameEn: 'Vessel delay', nameAr: 'تأخير السفينة', slaHours: 24 },
          { code: 'delay_customs', nameEn: 'Customs delay', nameAr: 'تأخير جمركي', slaHours: 8 },
          { code: 'doc_missing', nameEn: 'Missing document', nameAr: 'مستند ناقص', slaHours: 4 },
          {
            code: 'doc_discrepancy',
            nameEn: 'Document discrepancy',
            nameAr: 'اختلاف في المستندات',
            slaHours: 8,
          },
          {
            code: 'damage',
            nameEn: 'Cargo damage',
            nameAr: 'تلف البضاعة',
            defaultSeverity: 'high' as const,
            slaHours: 4,
          },
          {
            code: 'shortage',
            nameEn: 'Shortage',
            nameAr: 'نقص في الكمية',
            defaultSeverity: 'high' as const,
            slaHours: 4,
          },
          {
            code: 'inspection_hold',
            nameEn: 'Inspection hold',
            nameAr: 'إيقاف للفحص',
            slaHours: 24,
          },
          { code: 'payment_hold', nameEn: 'Payment hold', nameAr: 'إيقاف للدفع', slaHours: 24 },
          {
            code: 'free_time_expiry',
            nameEn: 'Free time expiring',
            nameAr: 'انتهاء الفترة المجانية',
            defaultSeverity: 'high' as const,
            slaHours: 8,
          },
        ])
        .onConflictDoNothing()

      await db
        .insert(documentTypes)
        .values([
          {
            code: 'mbl',
            nameEn: 'Master Bill of Lading',
            nameAr: 'بوليصة الشحن الرئيسية',
            category: 'transport',
            isRequiredForClearance: true,
          },
          {
            code: 'hbl',
            nameEn: 'House Bill of Lading',
            nameAr: 'بوليصة الشحن الفرعية',
            category: 'transport',
            isRequiredForClearance: true,
          },
          {
            code: 'awb',
            nameEn: 'Air Waybill',
            nameAr: 'بوليصة الشحن الجوي',
            category: 'transport',
            isRequiredForClearance: true,
          },
          {
            code: 'invoice_commercial',
            nameEn: 'Commercial Invoice',
            nameAr: 'الفاتورة التجارية',
            category: 'commercial',
            isRequiredForClearance: true,
          },
          {
            code: 'packing_list',
            nameEn: 'Packing List',
            nameAr: 'قائمة التعبئة',
            category: 'commercial',
            isRequiredForClearance: true,
          },
          {
            code: 'certificate_origin',
            nameEn: 'Certificate of Origin',
            nameAr: 'شهادة المنشأ',
            category: 'compliance',
            isRequiredForClearance: true,
          },
          {
            code: 'delivery_order',
            nameEn: 'Delivery Order',
            nameAr: 'إذن التسليم',
            category: 'transport',
          },
          {
            code: 'customs_declaration',
            nameEn: 'Customs Declaration',
            nameAr: 'البيان الجمركي',
            category: 'compliance',
          },
          {
            code: 'trade_licence',
            nameEn: 'Trade Licence',
            nameAr: 'الرخصة التجارية',
            category: 'partner_compliance',
          },
          {
            code: 'insurance_certificate',
            nameEn: 'Insurance Certificate',
            nameAr: 'شهادة التأمين',
            category: 'partner_compliance',
          },
          /*
            The declaration pack is ours, not the authority's.

            `customs_declaration` above is the filed document that comes back
            with a number on it. This is the working sheet we hand the broker
            beforehand — the fields they would otherwise retype out of three
            other documents. Two rows because they are two artefacts with two
            authors, and conflating them would make "has the declaration been
            filed?" unanswerable.
          */
          {
            code: 'customs_pack',
            nameEn: 'Customs Declaration Pack',
            nameAr: 'ملف البيان الجمركي',
            category: 'compliance',
          },
        ])
        .onConflictDoNothing()

      /*
        The default notification templates — the rows without which the whole
        of FR-NT is inert.

        Upserted rather than left alone, and that is the one place this seed
        deviates from `onConflictDoNothing`. These rows are *vendor* copy: a
        typo in the Arabic, or a wrong merge field, has to be able to reach a
        deployment that was seeded months ago. Everything else in this file is
        a code or a rate that an operator may legitimately have adjusted, so
        leaving those alone is right; overwriting a sentence we wrote is not
        the same act.

        The administrator's own wording is safe because it lives on a *branch*
        row (`branch_id` not null), which wins over the default at resolution
        time and is never matched by the conflict target below. When a template
        editor is built, it must write branch rows for exactly this reason.
      */
      await db
        .insert(notificationTemplates)
        .values(
          NOTIFICATION_TEMPLATES.map((template) => ({
            eventKey: template.eventKey,
            channel: template.channel,
            locale: template.locale,
            branchId: null,
            subject: template.subject,
            body: template.body,
            isActive: true,
          })),
        )
        .onConflictDoUpdate({
          target: [
            notificationTemplates.eventKey,
            notificationTemplates.channel,
            notificationTemplates.locale,
            notificationTemplates.branchId,
          ],
          set: {
            subject: sql`excluded.subject`,
            body: sql`excluded.body`,
            updatedAt: new Date(),
          },
        })

      /*
        The tariff, as far as a generic seed can honestly go.

        Three rows and no more, because the fourth would be a guess. The GCC
        common external tariff is 5% ad valorem across most of the schedule and
        that rate is *not* seeded as a row — it is opted into per estimate, so
        an operator quoting 5% on a code nobody has classified has chosen to.
        The exemptions that matter to most importers here are published at
        chapter level and are facts; those are seeded.

        A deployment that needs the full national schedule loads it as
        reference data, which is the whole point of it being a table.
      */
      await db
        .insert(dutyRates)
        .values(
          SEED_KW_TARIFF.map((line) => ({
            country: line.country,
            hsPrefix: line.hsPrefix,
            ratePercent: String(line.ratePercent),
            descriptionEn: line.descriptionEn,
            effectiveFrom: line.effectiveFrom,
          })),
        )
        .onConflictDoNothing()

      // Kuwait, Qatar and the UAE share neither a weekend nor a holiday list — NFR-03.
      await db
        .insert(workingCalendars)
        .values([
          {
            key: 'kuwait',
            nameEn: 'Kuwait',
            nameAr: 'الكويت',
            timeZone: 'Asia/Kuwait',
            weekend: [5, 6],
          },
          {
            key: 'uae',
            nameEn: 'United Arab Emirates',
            nameAr: 'الإمارات',
            timeZone: 'Asia/Dubai',
            weekend: [6, 0],
            dayStartMinute: 540,
            dayEndMinute: 1080,
          },
          { key: 'qatar', nameEn: 'Qatar', nameAr: 'قطر', timeZone: 'Asia/Qatar', weekend: [5, 6] },
          {
            key: 'saudi',
            nameEn: 'Saudi Arabia',
            nameAr: 'السعودية',
            timeZone: 'Asia/Riyadh',
            weekend: [5, 6],
          },
        ])
        .onConflictDoNothing()

      await db
        .insert(roles)
        .values(
          ROLES.map(([key, nameEn, nameAr, requiresTwoFactor]) => ({
            key,
            nameEn,
            nameAr,
            requiresTwoFactor,
            isSystem: true,
          })),
        )
        .onConflictDoNothing()

      // The permission matrix starts from the keys the state machines declare, so
      // a new transition cannot ship without a permission to gate it — FR-ID-03.
      const allKeys = [...new Set([...permissionKeys(), ...EXTRA_PERMISSIONS])].sort()

      // `insertedRoles` is empty on a re-run, because `onConflictDoNothing`
      // returns only rows it actually wrote. Re-reading is what makes the seed
      // idempotent rather than a one-shot — and it is why the matrix below was
      // never applied to an already-seeded database.
      const everyRole = await db.select({ id: roles.id, key: roles.key }).from(roles)
      const roleId = new Map(everyRole.map((r) => [r.key, r.id]))

      const grants: { roleId: string; permissionKey: string; allowed: boolean }[] = []

      const administrator = roleId.get('administrator')
      if (administrator) {
        for (const permissionKey of allKeys)
          grants.push({ roleId: administrator, permissionKey, allowed: true })
      }

      for (const [key, keys] of Object.entries(ROLE_PERMISSIONS)) {
        const id = roleId.get(key)
        if (!id) continue
        for (const permissionKey of keys) grants.push({ roleId: id, permissionKey, allowed: true })
      }

      if (grants.length) {
        await db.insert(rolePermissions).values(grants).onConflictDoNothing()
      }

      // Background work is an auditable principal, not an absence of one (§5.2).
      await db
        .insert(principals)
        .values({
          id: SYSTEM_PRINCIPAL_ID,
          type: 'system',
          email: 'system@qabandi.internal',
          nameEn: 'System',
          nameAr: 'النظام',
        })
        .onConflictDoNothing()

      console.log(
        `seeded: ${allKeys.length} permission keys across ${everyRole.length} roles ` +
          `(${grants.length} grants), ${CHARGE_TYPES.length} charge types, ` +
          `${NOTIFICATION_TEMPLATES.length} notification templates`,
      )
    },
    database,
  )

  await database.$client.end()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
