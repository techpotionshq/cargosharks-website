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

import { loadEnv } from './env'
import { permissionKeys } from '@qabandi/core'
import { createDatabase } from './client'
import { SYSTEM_PRINCIPAL_ID, systemActor, withActor } from './actor'
import {
  chargeTypes,
  chargeableRules,
  containerTypes,
  countries,
  currencies,
  exceptionCodes,
  documentTypes,
  incoterms,
  milestoneTemplates,
  principals,
  rolePermissions,
  roles,
  workingCalendars,
} from './schema/index'
loadEnv()

const CURRENCIES = [
  { code: 'KWD', nameEn: 'Kuwaiti Dinar', nameAr: 'دينار كويتي', minorUnits: 3, symbol: 'د.ك' },
  { code: 'BHD', nameEn: 'Bahraini Dinar', nameAr: 'دينار بحريني', minorUnits: 3, symbol: 'د.ب' },
  { code: 'OMR', nameEn: 'Omani Rial', nameAr: 'ريال عماني', minorUnits: 3, symbol: 'ر.ع' },
  { code: 'USD', nameEn: 'US Dollar', nameAr: 'دولار أمريكي', minorUnits: 2, symbol: '$' },
  { code: 'EUR', nameEn: 'Euro', nameAr: 'يورو', minorUnits: 2, symbol: '€' },
  { code: 'GBP', nameEn: 'Pound Sterling', nameAr: 'جنيه إسترليني', minorUnits: 2, symbol: '£' },
  { code: 'AED', nameEn: 'UAE Dirham', nameAr: 'درهم إماراتي', minorUnits: 2, symbol: 'د.إ' },
  { code: 'QAR', nameEn: 'Qatari Riyal', nameAr: 'ريال قطري', minorUnits: 2, symbol: 'ر.ق' },
  { code: 'SAR', nameEn: 'Saudi Riyal', nameAr: 'ريال سعودي', minorUnits: 2, symbol: 'ر.س' },
  { code: 'INR', nameEn: 'Indian Rupee', nameAr: 'روبية هندية', minorUnits: 2, symbol: '₹' },
  { code: 'CNY', nameEn: 'Chinese Yuan', nameAr: 'يوان صيني', minorUnits: 2, symbol: '¥' },
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

const ROLES = [
  ['administrator', 'Administrator', 'مسؤول النظام', true],
  ['finance', 'Finance', 'المالية', true],
  ['operations_manager', 'Operations Manager', 'مدير العمليات', false],
  ['coordinator', 'Coordinator', 'منسق', false],
  ['sales', 'Sales', 'المبيعات', false],
  ['customs_broker', 'Customs Broker', 'مخلص جمركي', false],
  ['read_only', 'Read Only', 'اطلاع فقط', false],
] as const

/** Permissions beyond the state-machine keys `core` already enumerates. */
const EXTRA_PERMISSIONS = [
  'admin.reference.write',
  'admin.audit.read',
  'admin.users.write',
  'admin.api_keys.write',
  'rate.card.write',
  'report.read',
  'job.read',
  'finance.export',
  'customer.write',
  'partner.write',
]

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
    'report.read',
    'job.read',
  ],
  operations_manager: [
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
        ])
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
          `(${grants.length} grants), ${CHARGE_TYPES.length} charge types`,
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
