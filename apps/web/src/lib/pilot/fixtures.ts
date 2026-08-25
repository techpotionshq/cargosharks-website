/**
 * The pilot dataset — Pilot §3.1 item 14.
 *
 * *"An empty system demos nothing. A populated one looks alive."*
 *
 * Twenty jobs at varied stages, a live customs hold, a demurrage clock that
 * has already written its own charge line, and an enquiry queue with clocks
 * running. Everything is anchored to the moment it is read, so the board is
 * never stale: a demo where the newest job is three weeks old reads as a
 * screenshot, and the whole premise of Moment 1 is that this is happening now.
 *
 * **These are placeholders, and the plan is that they die.** Pilot §5 items 2
 * and 3 put the client's own job files and customer list on days 2 and 3,
 * because *"recognition is the whole trick"* — their own Shuwaikh–Jebel Ali
 * lane and their own customer names read as their business already running,
 * where a generic dataset reads as a product tour. Every name below is a
 * stand-in with the right shape, so the swap is a data import rather than a
 * rebuild. The lanes, ports, container types, milestone names and charge codes
 * are real; only the company names are invented.
 */

import { D } from '@qabandi/core'
import type { ReferenceOptions } from '@/lib/options'
import type {
  AccountingExportRow,
  AgeableBill,
  AgeingBucket,
  AuditRow,
  BranchRow,
  CalendarRow,
  ChargeBasis,
  ChargeTypeRow,
  ClockView,
  ConsolidationChargeRow,
  ConsolidationDetailRows,
  ConsolidationHouseRow,
  ConsolidationSummary,
  CustomerDetail,
  CustomerRow,
  CustomsRow,
  DebtorRow,
  DocumentRow,
  DocumentView,
  DutyRateRow,
  EngineRuleRow,
  EnquiryProposalRow,
  EnquirySummary,
  ExceptionRow,
  ExceptionView,
  ExpiringRateCardRow,
  FormReference,
  GroupableShipmentRow,
  IntegrationSettingRow,
  InvoiceDetail,
  InvoiceRow,
  InvoiceStatus,
  InvoiceSummary,
  JobDetail,
  JobLedgerRows,
  JobPartnerView,
  JobSummary,
  LaneMarginRow,
  LedgerLineRow,
  LocationRow,
  MapData,
  MatchCandidateRow,
  MilestoneTemplateRow,
  MilestoneView,
  Mode,
  NotificationDeliveryRow,
  NotificationSwitchRow,
  NotificationTemplateRow,
  OpsOverview,
  PartnerAccountRows,
  PartnerComplianceRow,
  PartnerCoverageRow,
  PartnerDetail,
  PartnerRow,
  PayablesSummary,
  PaymentMethod,
  PaymentRow,
  PaymentSummary,
  PodRow,
  PortalShipment,
  QuoteComparison,
  QuoteDetail,
  QuoteRow,
  QuoteStatus,
  RateCardRow,
  RateCardSummary,
  ReceivablesAgeing,
  ReferenceSample,
  ReferenceTable,
  RoleRow,
  SettlementDetail,
  SettlementLineRow,
  SettlementRow,
  StatementEntryRow,
  SupplierBillLineRow,
  SupplierBillMatchRow,
  SupplierBillRow,
  SupplierBillRows,
  SupplierInvoiceRow,
  SupplierPaymentRow,
  TaxTreatment,
  TrackingResult,
  UserRow,
} from './types'

// --- time helpers ----------------------------------------------------------

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Everything is relative to the render, so the board is always current. */
function at(now: number, offsetDays: number, hour = 9): Date {
  const date = new Date(now + offsetDays * DAY)
  date.setHours(hour, offsetDays % 2 === 0 ? 15 : 40, 0, 0)
  return date
}

function hours(now: number, offset: number): Date {
  return new Date(now + offset * HOUR)
}

/**
 * A `date` column, which is a `YYYY-MM-DD` string and not a `Date`.
 *
 * `due_on`, `valid_from`, `invoice_date` and the settlement period are all
 * dates rather than instants, and the driver hands them over as strings. A
 * `Date` here type-checks nowhere and renders as a timestamp everywhere.
 *
 * Cut in UTC while `at()` works in local time, so the two can disagree by a
 * day either side of midnight. That is the right trade: a date column has no
 * time zone to be wrong about, and pinning this one to the render's offset
 * would make the fixture's own ageing arithmetic depend on where it runs.
 */
function day(now: number, offsetDays: number): string {
  return new Date(now + offsetDays * DAY).toISOString().slice(0, 10)
}

// --- money -----------------------------------------------------------------

type Dec = InstanceType<typeof D>

/**
 * An amount as `numeric(19,6)` reaches the driver — `"1284.000000"`.
 *
 * Every figure in this file is authored as a *string* and added with `Decimal`,
 * never as a JS number. KWD carries three decimals, so `0.1 + 0.2` is not an
 * abstract complaint here: it is the difference between a receivables total
 * that reconciles and one a finance manager stops trusting on the first
 * screen. The scale is six because that is what the column is, and `formatMoney`
 * and `trimDecimal` are both written against that shape.
 */
function numeric(value: string | Dec): string {
  return new D(value).toFixed(6)
}

/** Sum of `numeric` strings, exactly. Used for balances and bucket totals. */
function sum(values: readonly (string | Dec)[]): string {
  return values.reduce((total: Dec, value) => total.plus(new D(value)), new D(0)).toFixed(6)
}

function minus(a: string, b: string): string {
  return new D(a).minus(new D(b)).toFixed(6)
}

// --- reference data --------------------------------------------------------

/**
 * The places, with the coordinates the dashboard map plots them at.
 *
 * `kind` and the latitude/longitude pair are here rather than in a second
 * table because the locations register, the map and the lane labels are three
 * readings of one row — and a port that exists on the board but not on the map
 * is the kind of disagreement a prospect notices before anything else.
 */
const PORTS = {
  KWSWK: { en: 'Shuwaikh', ar: 'الشويخ', country: 'KW', kind: 'seaport', lat: 29.35, lon: 47.93 },
  KWSAA: { en: 'Shuaiba', ar: 'الشعيبة', country: 'KW', kind: 'seaport', lat: 29.03, lon: 48.15 },
  KWKWI: {
    en: 'Kuwait International',
    ar: 'مطار الكويت الدولي',
    country: 'KW',
    kind: 'airport',
    lat: 29.23,
    lon: 47.97,
  },
  AEJEA: { en: 'Jebel Ali', ar: 'جبل علي', country: 'AE', kind: 'seaport', lat: 25.01, lon: 55.06 },
  AEDXB: {
    en: 'Dubai International',
    ar: 'مطار دبي الدولي',
    country: 'AE',
    kind: 'airport',
    lat: 25.25,
    lon: 55.36,
  },
  CNNGB: { en: 'Ningbo', ar: 'نينغبو', country: 'CN', kind: 'seaport', lat: 29.87, lon: 121.55 },
  CNSHA: { en: 'Shanghai', ar: 'شنغهاي', country: 'CN', kind: 'seaport', lat: 31.23, lon: 121.47 },
  INNSA: {
    en: 'Nhava Sheva',
    ar: 'نهافا شيفا',
    country: 'IN',
    kind: 'seaport',
    lat: 18.95,
    lon: 72.95,
  },
  NLRTM: { en: 'Rotterdam', ar: 'روتردام', country: 'NL', kind: 'seaport', lat: 51.92, lon: 4.48 },
  DEHAM: { en: 'Hamburg', ar: 'هامبورغ', country: 'DE', kind: 'seaport', lat: 53.55, lon: 9.99 },
  SAJED: { en: 'Jeddah', ar: 'جدة', country: 'SA', kind: 'seaport', lat: 21.48, lon: 39.18 },
  TRIST: { en: 'Istanbul', ar: 'إسطنبول', country: 'TR', kind: 'seaport', lat: 41.01, lon: 28.98 },
} as const

type PortCode = keyof typeof PORTS

const PORT_CODES = Object.keys(PORTS) as PortCode[]

/** A location's synthetic id — the UN/LOCODE, which is already unique. */
function locationId(code: PortCode): string {
  return `loc-${code}`
}

/**
 * The two legal entities — FR-ID-01.
 *
 * The ids are the ones `jobDetail` already stamps on a job, kept in one place
 * now that four other registers need them to agree with it. A branch is a legal
 * entity with its own currency and its own invoice series, which is why `KWD`
 * and `AED` both appear below and why nothing in this file sums across them.
 */
const BRANCHES = [
  {
    id: '00000000-0000-7000-8000-0000000000b1',
    code: 'KWI' as const,
    en: 'Al-Qabandi Freight Services W.L.L.',
    ar: 'القبندي للخدمات الملاحية ذ.م.م',
    country: 'KW',
    currency: 'KWD',
    timeZone: 'Asia/Kuwait',
    calendar: 'kuwait',
  },
  {
    id: '00000000-0000-7000-8000-0000000000b2',
    code: 'DXB' as const,
    en: 'Al-Qabandi Logistics FZE',
    ar: 'القبندي للخدمات اللوجستية',
    country: 'AE',
    currency: 'AED',
    timeZone: 'Asia/Dubai',
    calendar: 'uae',
  },
] as const

type BranchCode = (typeof BRANCHES)[number]['code']

function branch(code: BranchCode): (typeof BRANCHES)[number] {
  return BRANCHES.find((b) => b.code === code)!
}

/**
 * Stand-in customers — replaced by the client's own list on day 3.
 *
 * The last two are agents we also bill, and they are here rather than in
 * `PARTNERS` because they are in *both*: a current account only exists where
 * somebody has said the agent is also a customer of ours, and the settlement
 * screen has nothing to net without that pairing. Appended rather than
 * interleaved so every `customer:` index in `JOB_SEEDS` still means what it
 * did.
 */
const CUSTOMERS = [
  {
    en: 'Gulf Steel Industries',
    ar: 'صناعات الخليج للحديد',
    code: 'GULFST',
    country: 'KW',
    branch: 'KWI',
    terms: 45,
    limit: '75000.000000',
  },
  {
    en: 'Al-Mulla Trading Co.',
    ar: 'شركة الملا التجارية',
    code: 'ALMULLA',
    country: 'KW',
    branch: 'KWI',
    terms: 30,
    limit: '40000.000000',
  },
  {
    en: 'Kuwait Food Company',
    ar: 'شركة الكويت للأغذية',
    code: 'KFOOD',
    country: 'KW',
    branch: 'KWI',
    terms: 30,
    limit: '60000.000000',
  },
  {
    en: 'Boubyan Petrochemicals',
    ar: 'بوبيان للبتروكيماويات',
    code: 'BOUBYAN',
    country: 'KW',
    branch: 'KWI',
    terms: 45,
    limit: '90000.000000',
  },
  {
    en: 'Alghanim Electronics',
    ar: 'الغانم للإلكترونيات',
    code: 'ALGHANIM',
    country: 'KW',
    branch: 'KWI',
    terms: 45,
    limit: '120000.000000',
  },
  {
    en: 'Emirates Building Systems',
    ar: 'أنظمة البناء الإماراتية',
    code: 'EBS',
    country: 'AE',
    branch: 'DXB',
    terms: 30,
    limit: '200000.000000',
  },
  {
    en: 'Al-Sayer Automotive',
    ar: 'الساير للسيارات',
    code: 'ALSAYER',
    country: 'KW',
    branch: 'KWI',
    terms: 60,
    limit: '150000.000000',
  },
  {
    en: 'Ministry of Public Works',
    ar: 'وزارة الأشغال العامة',
    code: 'MPW',
    country: 'KW',
    branch: 'KWI',
    terms: 90,
    limit: '250000.000000',
  },
  {
    en: 'Kirby Building Systems',
    ar: 'كيربي لأنظمة البناء',
    code: 'KIRBY',
    country: 'KW',
    branch: 'KWI',
    terms: 45,
    limit: '80000.000000',
  },
  {
    en: 'Gulf Cables & Electrical',
    ar: 'الخليج للكابلات والصناعات الكهربائية',
    code: 'GULFCAB',
    country: 'KW',
    branch: 'KWI',
    terms: 30,
    limit: '50000.000000',
  },
  {
    en: 'Everbright Logistics (Shanghai)',
    ar: 'إيفربرايت للخدمات اللوجستية (شنغهاي)',
    code: 'EVERBR',
    country: 'CN',
    branch: 'KWI',
    terms: 45,
    limit: '30000.000000',
  },
  {
    en: 'Gulf Agency Co.',
    ar: 'الوكالة الخليجية',
    code: 'GACAE',
    country: 'AE',
    branch: 'DXB',
    terms: 45,
    limit: '40000.000000',
  },
] as const

/** Synthetic and stable, and the job file points at the same one. */
function customerId(index: number): string {
  return `cust-${String(index).padStart(2, '0')}`
}

/**
 * The network, as the partner register lists it.
 *
 * The names are the ones `partnersFor` already puts on a job file — a carrier
 * on the shipment and an agent at the far end — plus the brokers, hauliers and
 * terminals a Kuwaiti forwarder buys from. `settlementCustomer` is the index in
 * `CUSTOMERS` an agent is also billed as; only the two agents have one, which
 * is what makes them the only partners a set-off can run for.
 */
const PARTNERS = [
  {
    id: 'one',
    code: 'ONE',
    type: 'carrier',
    en: 'ONE — Ocean Network Express',
    ar: 'أوشن نتوورك إكسبريس',
    country: 'JP',
    currency: 'USD',
    terms: 30,
    scac: 'ONEY',
  },
  {
    id: 'cmacgm',
    code: 'CMACGM',
    type: 'carrier',
    en: 'CMA CGM',
    ar: 'سي إم إيه سي جي إم',
    country: 'FR',
    currency: 'USD',
    terms: 30,
    scac: 'CMDU',
  },
  {
    id: 'hapag',
    code: 'HAPAG',
    type: 'carrier',
    en: 'Hapag-Lloyd',
    ar: 'هاباغ لويد',
    country: 'DE',
    currency: 'USD',
    terms: 30,
    scac: 'HLCU',
  },
  {
    id: 'msc',
    code: 'MSC',
    type: 'carrier',
    en: 'Mediterranean Shipping Company',
    ar: 'إم إس سي',
    country: 'CH',
    currency: 'USD',
    terms: 30,
    scac: 'MSCU',
  },
  {
    id: 'maersk',
    code: 'MAERSK',
    type: 'carrier',
    en: 'Maersk Line',
    ar: 'ميرسك',
    country: 'DK',
    currency: 'USD',
    terms: 30,
    scac: 'MAEU',
  },
  {
    id: 'ek',
    code: 'EK',
    type: 'carrier',
    en: 'Emirates SkyCargo',
    ar: 'الإمارات للشحن الجوي',
    country: 'AE',
    currency: 'AED',
    terms: 21,
    scac: null,
  },
  {
    id: 'everbright',
    code: 'EVERBR',
    type: 'agent',
    en: 'Everbright Logistics (Shanghai)',
    ar: 'إيفربرايت للخدمات اللوجستية (شنغهاي)',
    country: 'CN',
    currency: 'USD',
    terms: 45,
    scac: null,
    settlementCustomer: 10,
    settlementCurrency: 'USD',
  },
  {
    id: 'gac',
    code: 'GACAE',
    type: 'agent',
    en: 'Gulf Agency Co.',
    ar: 'الوكالة الخليجية',
    country: 'AE',
    currency: 'AED',
    terms: 45,
    scac: null,
    settlementCustomer: 11,
    settlementCurrency: 'AED',
  },
  {
    id: 'mumbai',
    code: 'INDAG',
    type: 'agent',
    en: 'Mumbai Freight Services',
    ar: 'مومباي للشحن',
    country: 'IN',
    currency: 'USD',
    terms: 45,
    scac: null,
  },
  {
    id: 'rotterdam',
    code: 'RTMAG',
    type: 'agent',
    en: 'Rotterdam Forwarding BV',
    ar: 'روتردام للشحن',
    country: 'NL',
    currency: 'EUR',
    terms: 45,
    scac: null,
  },
  {
    id: 'marmara',
    code: 'TRMAR',
    type: 'agent',
    en: 'Marmara Freight Services',
    ar: 'مرمرة للشحن',
    country: 'TR',
    currency: 'USD',
    terms: 45,
    scac: null,
  },
  {
    id: 'shamali',
    code: 'ALSHA',
    type: 'broker',
    en: 'Al-Shamali Customs Clearance',
    ar: 'الشمالي للتخليص الجمركي',
    country: 'KW',
    currency: 'KWD',
    terms: 15,
    scac: null,
  },
  {
    id: 'gulfbridge',
    code: 'GULFB',
    type: 'broker',
    en: 'Gulf Bridge Clearing',
    ar: 'جسر الخليج للتخليص',
    country: 'AE',
    currency: 'AED',
    terms: 15,
    scac: null,
  },
  {
    id: 'ktrans',
    code: 'KTRAN',
    type: 'haulier',
    en: 'Kuwait Transport Company',
    ar: 'شركة النقل الكويتية',
    country: 'KW',
    currency: 'KWD',
    terms: 30,
    scac: null,
  },
  {
    id: 'desert',
    code: 'DESERT',
    type: 'haulier',
    en: 'Desert Line Trucking',
    ar: 'خط الصحراء للنقل',
    country: 'AE',
    currency: 'AED',
    terms: 30,
    scac: null,
  },
  {
    id: 'kpa',
    code: 'KPA',
    type: 'terminal',
    en: 'Kuwait Ports Authority',
    ar: 'المؤسسة العامة للموانئ الكويتية',
    country: 'KW',
    currency: 'KWD',
    terms: 0,
    scac: null,
  },
  {
    id: 'dpw',
    code: 'DPW',
    type: 'terminal',
    en: 'DP World Jebel Ali',
    ar: 'موانئ دبي العالمية - جبل علي',
    country: 'AE',
    currency: 'AED',
    terms: 0,
    scac: null,
  },
] as const

type PartnerKey = (typeof PARTNERS)[number]['id']

function partnerId(key: PartnerKey): string {
  return `partner-${key}`
}

function partner(key: PartnerKey): (typeof PARTNERS)[number] {
  return PARTNERS.find((p) => p.id === key)!
}

const OWNERS = [
  'Fahad Al-Rashid',
  'Maryam Al-Otaibi',
  'Yousef Haddad',
  'Noura Al-Sabah',
  'Rajesh Menon',
] as const

const CARRIERS = ['ONE', 'CMA CGM', 'Hapag-Lloyd', 'MSC', 'Emirates SkyCargo', 'Maersk'] as const

/**
 * Milestone templates — `FR-JB-01`.
 *
 * Rows in the real system (`milestone_templates`), so an administrator can add
 * one without a release. The names here are the ones a Kuwaiti forwarder
 * actually uses; Pilot §5 item 6 books ninety minutes with an operations
 * person specifically to correct them, because *"ops people notice
 * immediately"*.
 */
const TEMPLATES: Record<string, readonly (readonly [string, string, string])[]> = {
  sea_import: [
    ['booking_confirmed', 'Booking confirmed', 'تأكيد الحجز'],
    ['departed_origin', 'Departed origin port', 'المغادرة من ميناء المنشأ'],
    ['arrived_destination', 'Arrived destination port', 'الوصول إلى ميناء الوجهة'],
    ['discharged', 'Discharged from vessel', 'التفريغ من السفينة'],
    ['customs_cleared', 'Customs cleared', 'التخليص الجمركي'],
    ['delivered', 'Delivered to consignee', 'التسليم للمرسل إليه'],
    ['empty_returned', 'Empty container returned', 'إعادة الحاوية الفارغة'],
  ],
  sea_export: [
    ['booking_confirmed', 'Booking confirmed', 'تأكيد الحجز'],
    ['cargo_received', 'Cargo received', 'استلام البضاعة'],
    ['customs_cleared', 'Export customs cleared', 'التخليص الجمركي للتصدير'],
    ['loaded', 'Loaded on vessel', 'التحميل على السفينة'],
    ['departed_origin', 'Vessel sailed', 'إبحار السفينة'],
    ['arrived_destination', 'Arrived destination port', 'الوصول إلى ميناء الوجهة'],
  ],
  air_export: [
    ['booking_confirmed', 'Booking confirmed', 'تأكيد الحجز'],
    ['cargo_received', 'Cargo received at warehouse', 'استلام البضاعة في المستودع'],
    ['customs_cleared', 'Export customs cleared', 'التخليص الجمركي للتصدير'],
    ['uplifted', 'Uplifted', 'الإقلاع'],
    ['arrived_destination', 'Arrived destination airport', 'الوصول إلى مطار الوجهة'],
    ['delivered', 'Delivered to consignee', 'التسليم للمرسل إليه'],
  ],
}

/**
 * Document types, with the category `document_types.category` carries.
 *
 * The category is not decoration: the register groups by it, and the customs
 * pack is the difference between "the papers exist" and "the papers the
 * authority will accept exist".
 */
const DOCUMENT_TYPES = [
  ['bill_of_lading', 'Bill of Lading', 'بوليصة الشحن', 'transport'],
  ['commercial_invoice', 'Commercial Invoice', 'الفاتورة التجارية', 'commercial'],
  ['packing_list', 'Packing List', 'قائمة التعبئة', 'commercial'],
  ['certificate_of_origin', 'Certificate of Origin', 'شهادة المنشأ', 'compliance'],
  ['delivery_order', 'Delivery Order', 'إذن التسليم', 'transport'],
  ['customs_declaration', 'Customs Declaration', 'البيان الجمركي', 'compliance'],
] as const

// --- the jobs --------------------------------------------------------------

interface JobSeed {
  readonly seq: number
  readonly branch: 'KWI' | 'DXB'
  readonly template: keyof typeof TEMPLATES
  readonly mode: Mode
  readonly direction: 'import' | 'export'
  readonly customer: number
  readonly origin: PortCode
  readonly destination: PortCode
  readonly status: string
  /** How far through the template the job is. */
  readonly done: number
  /** ETA offset in days from now — negative is already arrived. */
  readonly etaOffset: number
  readonly transitDays: number
  readonly containers: number
  readonly customs?: string
  readonly owner: number
}

/**
 * Twenty jobs, weighted the way a real board is: mostly live sea import on the
 * Far East–Kuwait lane, a handful of exports, two exceptions and one job in
 * trouble. A board where every row is healthy demonstrates nothing.
 */
const JOB_SEEDS: readonly JobSeed[] = [
  {
    seq: 1041,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 0,
    origin: 'CNNGB',
    destination: 'KWSWK',
    status: 'customs',
    done: 4,
    etaOffset: -6,
    transitDays: 24,
    containers: 3,
    customs: 'held',
    owner: 0,
  },
  {
    seq: 1039,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 2,
    origin: 'INNSA',
    destination: 'KWSWK',
    status: 'arrived',
    done: 3,
    etaOffset: -1,
    transitDays: 9,
    containers: 2,
    customs: 'documents_pending',
    owner: 1,
  },
  {
    seq: 1044,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 4,
    origin: 'CNSHA',
    destination: 'KWSWK',
    status: 'in_transit',
    done: 2,
    etaOffset: 5,
    transitDays: 26,
    containers: 4,
    owner: 0,
  },
  {
    seq: 1046,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 9,
    origin: 'CNNGB',
    destination: 'KWSAA',
    status: 'in_transit',
    done: 2,
    etaOffset: 9,
    transitDays: 25,
    containers: 2,
    owner: 2,
  },
  {
    seq: 1047,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_lcl',
    direction: 'import',
    customer: 1,
    origin: 'TRIST',
    destination: 'KWSWK',
    status: 'in_transit',
    done: 2,
    etaOffset: 3,
    transitDays: 14,
    containers: 1,
    owner: 1,
  },
  {
    seq: 1035,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 8,
    origin: 'NLRTM',
    destination: 'KWSWK',
    status: 'delivered',
    done: 6,
    etaOffset: -12,
    transitDays: 28,
    containers: 2,
    customs: 'released',
    owner: 3,
  },
  {
    seq: 1033,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 3,
    origin: 'DEHAM',
    destination: 'KWSWK',
    status: 'completed',
    done: 7,
    etaOffset: -19,
    transitDays: 30,
    containers: 1,
    customs: 'released',
    owner: 0,
  },
  {
    seq: 1048,
    branch: 'KWI',
    template: 'sea_export',
    mode: 'sea_fcl',
    direction: 'export',
    customer: 3,
    origin: 'KWSWK',
    destination: 'INNSA',
    status: 'booked',
    done: 1,
    etaOffset: 14,
    transitDays: 11,
    containers: 2,
    owner: 4,
  },
  {
    seq: 1045,
    branch: 'KWI',
    template: 'sea_export',
    mode: 'sea_fcl',
    direction: 'export',
    customer: 0,
    origin: 'KWSWK',
    destination: 'SAJED',
    status: 'in_transit',
    done: 4,
    etaOffset: 2,
    transitDays: 6,
    containers: 3,
    owner: 2,
  },
  {
    seq: 1042,
    branch: 'KWI',
    template: 'air_export',
    mode: 'air',
    direction: 'export',
    customer: 7,
    origin: 'KWKWI',
    destination: 'DEHAM',
    status: 'in_transit',
    done: 3,
    etaOffset: 1,
    transitDays: 2,
    containers: 0,
    owner: 1,
  },
  {
    seq: 1043,
    branch: 'KWI',
    template: 'air_export',
    mode: 'air',
    direction: 'export',
    customer: 4,
    origin: 'KWKWI',
    destination: 'NLRTM',
    status: 'delivered',
    done: 6,
    etaOffset: -3,
    transitDays: 2,
    containers: 0,
    owner: 1,
  },
  {
    seq: 1049,
    branch: 'KWI',
    template: 'air_export',
    mode: 'air',
    direction: 'export',
    customer: 6,
    origin: 'KWKWI',
    destination: 'TRIST',
    status: 'booked',
    done: 1,
    etaOffset: 4,
    transitDays: 1,
    containers: 0,
    owner: 4,
  },
  {
    seq: 1036,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 6,
    origin: 'CNSHA',
    destination: 'KWSWK',
    status: 'customs',
    done: 4,
    etaOffset: -4,
    transitDays: 27,
    containers: 2,
    customs: 'inspection',
    owner: 3,
  },
  {
    seq: 1038,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_lcl',
    direction: 'import',
    customer: 5,
    origin: 'INNSA',
    destination: 'KWSWK',
    status: 'delivered',
    done: 6,
    etaOffset: -8,
    transitDays: 10,
    containers: 1,
    customs: 'released',
    owner: 2,
  },
  {
    seq: 2018,
    branch: 'DXB',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 5,
    origin: 'CNNGB',
    destination: 'AEJEA',
    status: 'in_transit',
    done: 2,
    etaOffset: 6,
    transitDays: 21,
    containers: 5,
    owner: 4,
  },
  {
    seq: 2019,
    branch: 'DXB',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 8,
    origin: 'INNSA',
    destination: 'AEJEA',
    status: 'arrived',
    done: 3,
    etaOffset: -2,
    transitDays: 7,
    containers: 3,
    customs: 'declaration_filed',
    owner: 4,
  },
  {
    seq: 2016,
    branch: 'DXB',
    template: 'sea_export',
    mode: 'sea_fcl',
    direction: 'export',
    customer: 5,
    origin: 'AEJEA',
    destination: 'KWSWK',
    status: 'in_transit',
    done: 4,
    etaOffset: 1,
    transitDays: 5,
    containers: 2,
    owner: 2,
  },
  {
    seq: 2020,
    branch: 'DXB',
    template: 'air_export',
    mode: 'air',
    direction: 'export',
    customer: 4,
    origin: 'AEDXB',
    destination: 'KWKWI',
    status: 'booked',
    done: 1,
    etaOffset: 3,
    transitDays: 1,
    containers: 0,
    owner: 3,
  },
  {
    seq: 2014,
    branch: 'DXB',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 9,
    origin: 'CNSHA',
    destination: 'AEJEA',
    status: 'completed',
    done: 7,
    etaOffset: -16,
    transitDays: 22,
    containers: 4,
    customs: 'released',
    owner: 4,
  },
  {
    seq: 1050,
    branch: 'KWI',
    template: 'sea_import',
    mode: 'sea_fcl',
    direction: 'import',
    customer: 1,
    origin: 'CNNGB',
    destination: 'KWSWK',
    status: 'draft',
    done: 0,
    etaOffset: 21,
    transitDays: 25,
    containers: 2,
    owner: 0,
  },
]

const CONTAINER_TYPES = ['40HC', '20GP', '40GP', '40RF'] as const

function containerNumber(seq: number, index: number): string {
  /** ISO 6346 shape: four letters, six digits, one check digit. */
  const owners = ['ONEU', 'CMAU', 'HLXU', 'MSCU', 'MRKU']
  const owner = owners[(seq + index) % owners.length]!
  const serial = String((seq * 37 + index * 811) % 1_000_000).padStart(6, '0')
  const check = (seq + index * 7) % 10
  return `${owner}${serial}${check}`
}

function milestonesFor(seed: JobSeed, now: number): MilestoneView[] {
  const template = TEMPLATES[seed.template]!
  const arrivalIndex = template.findIndex(([code]) => code === 'arrived_destination')
  const etaDay = seed.etaOffset

  return template.map(([code, nameEn, nameAr], index) => {
    /**
     * Steps are spread backwards from the arrival milestone across the transit
     * time, so a job with a 26-day sailing shows a 26-day gap where the
     * sailing is — not six evenly spaced dots.
     */
    const fromArrival = index - arrivalIndex
    const offset =
      fromArrival <= 0
        ? etaDay - seed.transitDays * (Math.abs(fromArrival) / Math.max(arrivalIndex, 1))
        : etaDay + fromArrival * 2

    const planned = at(now, Math.round(offset), 8 + (index % 6))
    const done = index < seed.done
    /** Actuals drift from plan by up to a day: real dates are never exact. */
    const actual = done ? at(now, Math.round(offset) + ((index % 3) - 1), 10 + (index % 5)) : null
    const slipped = !done && seed.customs === 'held' && index >= seed.done

    return {
      id: `${seed.branch}-${seed.seq}-${code}`,
      code,
      nameEn,
      nameAr,
      plannedAt: planned,
      revisedAt: slipped ? at(now, Math.round(offset) + 4, 11) : null,
      actualAt: actual,
    }
  })
}

function clocksFor(seed: JobSeed, now: number): ClockView[] {
  /**
   * One job carries the demurrage clock the demo turns on (Pilot §3.1 item
   * 12). It is deliberately past its free time and has already written a
   * charge line — the beat is *"that charge line appeared on its own"*.
   */
  if (seed.seq !== 1041) return []

  const freeDays = 10
  const startsOn = at(now, -14, 7)
  const elapsed = 14
  const chargeable = elapsed - freeDays
  const perDiem = 32
  return [
    {
      id: `clock-${seed.seq}`,
      kind: 'demurrage',
      containerNo: containerNumber(seed.seq, 0),
      freeDays,
      startsOn,
      elapsedDays: elapsed,
      chargeableDays: chargeable,
      perDiem: { amount: perDiem, currency: 'KWD' },
      accrued: { amount: chargeable * perDiem * 3, currency: 'KWD' },
      counterparty: 'ONE — Ocean Network Express',
      chargeLineWritten: true,
    },
  ]
}

function documentsFor(seed: JobSeed, now: number): DocumentView[] {
  const count = seed.done === 0 ? 0 : Math.min(2 + seed.done, DOCUMENT_TYPES.length)
  return DOCUMENT_TYPES.slice(0, count).map(([code, nameEn, nameAr], index) => ({
    id: `${seed.seq}-${code}`,
    code,
    nameEn,
    nameAr,
    version: index === 0 && seed.done > 3 ? 2 : 1,
    /** A draft is not a release. The last one stays unreleased on live jobs. */
    releasedAt: index < count - (seed.done >= 5 ? 0 : 1) ? at(now, -3 - index, 12) : null,
    sizeKb: 120 + index * 47 + (seed.seq % 90),
  }))
}

function jobSummary(seed: JobSeed, now: number): JobSummary {
  const customer = CUSTOMERS[seed.customer]!
  const origin = PORTS[seed.origin]
  const destination = PORTS[seed.destination]
  const template = TEMPLATES[seed.template]!
  const clocks = clocksFor(seed, now)
  const year = new Date(now).getFullYear()

  const accruing = clocks.reduce((sum, c) => sum + c.accrued.amount, 0)
  const isAir = seed.mode === 'air'

  return {
    id: `job-${seed.seq}`,
    reference: `${seed.branch}-${year}-${String(seed.seq).padStart(5, '0')}`,
    branchCode: seed.branch,
    status: seed.status,
    mode: seed.mode,
    direction: seed.direction,
    customerName: customer.en,
    customerNameAr: customer.ar,
    originName: origin.en,
    originNameAr: origin.ar,
    originCode: seed.origin,
    destinationName: destination.en,
    destinationNameAr: destination.ar,
    destinationCode: seed.destination,
    vesselOrFlight: isAir
      ? `EK ${800 + (seed.seq % 90)}`
      : `${CARRIERS[seed.seq % CARRIERS.length]} · ${['MERIDIAN', 'AL SALAM', 'NORTHERN STAR', 'GULF TRADER'][seed.seq % 4]} ${String(seed.seq % 40).padStart(3, '0')}W`,
    etd: at(now, seed.etaOffset - seed.transitDays, 6),
    eta: at(now, seed.etaOffset, 14),
    ata: seed.etaOffset < 0 ? at(now, seed.etaOffset, 14) : null,
    owner: OWNERS[seed.owner]!,
    customsStatus: seed.customs ?? null,
    containerCount: seed.containers,
    milestonesTotal: template.length,
    milestonesDone: seed.done,
    openExceptions: seed.customs === 'held' ? 1 : seed.customs === 'inspection' ? 1 : 0,
    accruing: accruing > 0 ? { amount: accruing, currency: 'KWD' } : null,
    updatedAt: hours(now, -(seed.seq % 30) - 1),
  }
}

export function pilotJobs(now = Date.now()): JobSummary[] {
  return JOB_SEEDS.map((seed) => jobSummary(seed, now))
}

export function pilotJob(id: string, now = Date.now()): JobDetail | undefined {
  const seed = JOB_SEEDS.find((s) => `job-${s.seq}` === id || String(s.seq) === id)
  if (!seed) return undefined
  return jobDetail(seed, now)
}

export function pilotJobByReference(reference: string, now = Date.now()): JobDetail | undefined {
  const normalised = reference.trim().toUpperCase()
  const seed = JOB_SEEDS.find((s) => {
    const year = new Date(now).getFullYear()
    return `${s.branch}-${year}-${String(s.seq).padStart(5, '0')}` === normalised
  })
  return seed ? jobDetail(seed, now) : undefined
}

function jobDetail(seed: JobSeed, now: number): JobDetail {
  const summary = jobSummary(seed, now)
  const containers = Array.from({ length: seed.containers }, (_, index) => ({
    containerNo: containerNumber(seed.seq, index),
    type: CONTAINER_TYPES[(seed.seq + index) % CONTAINER_TYPES.length]!,
    sealNo: `KW${String((seed.seq * 13 + index) % 100000).padStart(5, '0')}`,
    dischargedAt: seed.done >= 4 ? at(now, seed.etaOffset + 1, 9) : null,
    gateOutAt: seed.done >= 5 ? at(now, seed.etaOffset + 3, 11) : null,
    emptyReturnedAt: seed.done >= 7 ? at(now, seed.etaOffset + 6, 13) : null,
  }))

  return {
    ...summary,
    /*
      The fixture has no real rows to point at, so these are the fixture's own
      synthetic ids. They are as valid as the rest of it: the pilot path never
      writes, and an edit form rendered against fixtures is a preview.
    */
    branchId: branch(seed.branch).id,
    /*
      The customer's own id, not the job's.

      This read `summary.id` — the *job* id — which nothing noticed while the
      customers register needed a database: the field only ever fed a `<select>`
      that had no options to match it against. With the register on fixtures the
      same value is a link, and a job file pointing at a customer record that is
      really a shipment is exactly the incoherence Pilot §3.1 warns about.
    */
    customerId: customerId(seed.customer),
    originId: locationId(seed.origin),
    destinationId: locationId(seed.destination),
    commodityId: null,
    customerReference: `PO-${2026}-${String(seed.seq * 3).padStart(4, '0')}`,
    masterBillNumber:
      seed.mode === 'air'
        ? `176-${String(seed.seq * 7).padStart(8, '0')}`
        : `${CARRIERS[seed.seq % CARRIERS.length]!.replace(/[^A-Z]/g, '').slice(0, 4) || 'ONEY'}KWI${seed.seq}00`,
    houseBillNumber: `AQP${seed.branch}${String(seed.seq).padStart(6, '0')}`,
    // Every third sea import is telex-released, which is about the Gulf ratio.
    houseBillSurrenderedAt:
      seed.mode !== 'air' && seed.direction === 'import' && seed.seq % 3 === 0
        ? at(now, seed.etaOffset - 4, 10)
        : null,
    bookingNumber: `BKG${String(seed.seq * 11).padStart(7, '0')}`,
    placeOfReceipt: null,
    placeOfDelivery: null,
    incoterm: seed.direction === 'import' ? 'CFR' : 'FOB',
    commodity:
      seed.customer === 0
        ? 'Steel coils'
        : seed.customer === 2
          ? 'Foodstuffs — ambient'
          : seed.customer === 4
            ? 'Consumer electronics'
            : 'General cargo',
    grossWeightKg: seed.mode === 'air' ? 1850 + seed.seq : 18500 + seed.seq * 12,
    chargeableWeightKg: seed.mode === 'air' ? 2100 + seed.seq : null,
    volumeCbm: seed.mode === 'air' ? 11.4 : seed.containers * 62,
    pieces: seed.mode === 'air' ? 42 : seed.containers * 210,
    milestones: milestonesFor(seed, now),
    containers,
    clocks: clocksFor(seed, now),
    exceptions: pilotExceptions(now).filter((e) => e.jobId === summary.id),
    documents: documentsFor(seed, now),
    partners: partnersFor(seed),
    customsNote:
      seed.customs === 'held'
        ? 'Held by Kuwait General Administration of Customs pending origin certificate attestation.'
        : seed.customs === 'inspection'
          ? 'Physical inspection scheduled — yard 4.'
          : null,
  }
}

/**
 * Who we engaged on the shipment.
 *
 * A carrier on everything and an agent at the far end on anything that
 * crossed a border, which is the shape of a real file — and enough for the
 * panel to have something in it rather than an empty state that reads like a
 * broken query.
 */
/**
 * The agent at the far end, chosen by where the far end is.
 *
 * This used to be Shanghai on every import and Gulf Agency on every export,
 * which put a Chinese agent on a Hamburg sailing. Nobody could see it while
 * the partner register needed a database; with the register on fixtures the
 * same row is a link to a company with a country on it, and the mismatch is
 * visible from either side.
 */
const FAR_END_AGENTS: Record<string, PartnerKey> = {
  CN: 'everbright',
  IN: 'mumbai',
  NL: 'rotterdam',
  DE: 'rotterdam',
  TR: 'marmara',
  AE: 'gac',
  SA: 'gac',
  KW: 'gac',
}

function partnersFor(seed: JobSeed): JobPartnerView[] {
  const stem = `${seed.branch}-${seed.seq}`
  const carrier: PartnerKey = seed.mode === 'air' ? 'ek' : 'one'
  const farEnd = seed.direction === 'import' ? seed.origin : seed.destination
  const agent: PartnerKey = FAR_END_AGENTS[PORTS[farEnd].country] ?? 'gac'

  /*
    The partner *register's* id, not a per-job one.

    These used to be `${stem}-p1`, unique per job and pointing at nothing, which
    was harmless while the network register needed a database and is not now:
    the panel links a name to a record, and a link that resolves to a partner
    who does not exist is the demo failing in front of the person clicking it.
  */
  const rows: JobPartnerView[] = [
    {
      id: `${stem}-carrier`,
      partnerId: partnerId(carrier),
      name: partner(carrier).en,
      role: 'carrier',
      reference: `BK-${seed.seq}9812`,
    },
    {
      id: `${stem}-agent`,
      partnerId: partnerId(agent),
      name: partner(agent).en,
      role: seed.direction === 'import' ? 'origin_agent' : 'destination_agent',
      reference: null,
    },
  ]

  /*
    The broker, on any shipment that has a customs stage.

    The customs register names one on every row it draws; without this the same
    broker had no shipments at all on the partner register, and the two screens
    answered "who cleared this" differently.
  */
  if (seed.customs !== undefined) {
    const broker: PartnerKey = seed.branch === 'KWI' ? 'shamali' : 'gulfbridge'
    rows.push({
      id: `${stem}-broker`,
      partnerId: partnerId(broker),
      name: partner(broker).en,
      role: 'customs_broker',
      reference: null,
    })
  }

  // The haulier appears once the box has left the terminal, not before.
  if (seed.direction === 'import' && seed.done >= 5) {
    const haulier: PartnerKey = seed.branch === 'KWI' ? 'ktrans' : 'desert'
    rows.push({
      id: `${stem}-haulier`,
      partnerId: partnerId(haulier),
      name: partner(haulier).en,
      role: 'haulier',
      reference: null,
    })
  }

  return rows
}

// --- exceptions ------------------------------------------------------------

/**
 * The exceptions register, oldest first — `FR-JB-09`.
 *
 * The customs hold at the top is the seeded one from Pilot §3.1 item 12. It is
 * on a job that is otherwise unremarkable, which is the point: it is the sort
 * of thing that goes unnoticed for a week today.
 */
export function pilotExceptions(now = Date.now()): ExceptionView[] {
  const year = new Date(now).getFullYear()
  return [
    {
      id: 'exc-1',
      jobId: 'job-1041',
      jobReference: `KWI-${year}-01041`,
      code: 'customs_hold',
      nameEn: 'Customs hold',
      nameAr: 'احتجاز جمركي',
      severity: 'critical',
      openedAt: at(now, -4, 8),
      dueAt: at(now, -1, 12),
      owner: OWNERS[0]!,
      description: 'Origin certificate requires chamber attestation before release.',
      customerName: CUSTOMERS[0]!.en,
    },
    {
      id: 'exc-2',
      jobId: 'job-1036',
      jobReference: `KWI-${year}-01036`,
      code: 'customs_inspection',
      nameEn: 'Customs inspection',
      nameAr: 'تفتيش جمركي',
      severity: 'high',
      openedAt: at(now, -3, 10),
      dueAt: at(now, 1, 12),
      owner: OWNERS[3]!,
      description: 'Selected for physical inspection at yard 4.',
      customerName: CUSTOMERS[6]!.en,
    },
    {
      id: 'exc-3',
      jobId: 'job-1039',
      jobReference: `KWI-${year}-01039`,
      code: 'docs_missing',
      nameEn: 'Documents outstanding',
      nameAr: 'مستندات ناقصة',
      severity: 'medium',
      openedAt: at(now, -2, 9),
      dueAt: at(now, 0, 17),
      owner: OWNERS[1]!,
      description: 'Packing list not received from shipper.',
      customerName: CUSTOMERS[2]!.en,
    },
    {
      id: 'exc-4',
      jobId: 'job-2019',
      jobReference: `DXB-${year}-02019`,
      code: 'vessel_delay',
      nameEn: 'Vessel delay',
      nameAr: 'تأخر السفينة',
      severity: 'medium',
      openedAt: at(now, -1, 14),
      dueAt: at(now, 2, 12),
      owner: OWNERS[4]!,
      description: 'Berthing delayed 36 hours at Jebel Ali.',
      customerName: CUSTOMERS[8]!.en,
    },
  ]
}

// --- enquiries -------------------------------------------------------------

interface EnquirySeed {
  readonly seq: number
  readonly branch: 'KWI' | 'DXB'
  readonly status: string
  readonly channel: string
  readonly mode: Mode
  readonly customer: number
  readonly origin: PortCode
  readonly destination: PortCode
  readonly owner: number | null
  /** Hours ago the enquiry arrived. */
  readonly age: number
  /** SLA window in hours — the branch calendar decides this in the real system. */
  readonly sla: number
  readonly respondedAfter?: number
  readonly sell?: number
  readonly margin?: number
}

const ENQUIRY_SEEDS: readonly EnquirySeed[] = [
  {
    seq: 318,
    branch: 'KWI',
    status: 'new',
    channel: 'email',
    mode: 'sea_fcl',
    customer: 0,
    origin: 'CNNGB',
    destination: 'KWSWK',
    owner: null,
    age: 26,
    sla: 24,
  },
  {
    seq: 319,
    branch: 'KWI',
    status: 'new',
    channel: 'portal',
    mode: 'air',
    customer: 4,
    origin: 'KWKWI',
    destination: 'DEHAM',
    owner: null,
    age: 21,
    sla: 24,
  },
  {
    seq: 317,
    branch: 'KWI',
    status: 'assigned',
    channel: 'whatsapp',
    mode: 'sea_fcl',
    customer: 2,
    origin: 'INNSA',
    destination: 'KWSWK',
    owner: 1,
    age: 30,
    sla: 24,
  },
  {
    seq: 320,
    branch: 'KWI',
    status: 'rating',
    channel: 'email',
    mode: 'sea_lcl',
    customer: 9,
    origin: 'TRIST',
    destination: 'KWSWK',
    owner: 2,
    age: 6,
    sla: 24,
  },
  {
    seq: 321,
    branch: 'KWI',
    status: 'new',
    channel: 'phone',
    mode: 'sea_fcl',
    customer: 8,
    origin: 'CNSHA',
    destination: 'KWSAA',
    owner: null,
    age: 3,
    sla: 24,
  },
  {
    seq: 316,
    branch: 'KWI',
    status: 'quoted',
    channel: 'email',
    mode: 'sea_fcl',
    customer: 3,
    origin: 'KWSWK',
    destination: 'INNSA',
    owner: 0,
    age: 34,
    sla: 24,
    respondedAfter: 2,
    sell: 1840,
    margin: 18.5,
  },
  {
    seq: 315,
    branch: 'KWI',
    status: 'quoted',
    channel: 'portal',
    mode: 'air',
    customer: 7,
    origin: 'KWKWI',
    destination: 'NLRTM',
    owner: 1,
    age: 46,
    sla: 24,
    respondedAfter: 1,
    sell: 3260,
    margin: 22.4,
  },
  {
    seq: 314,
    branch: 'KWI',
    status: 'won',
    channel: 'email',
    mode: 'sea_fcl',
    customer: 0,
    origin: 'CNNGB',
    destination: 'KWSWK',
    owner: 0,
    age: 62,
    sla: 24,
    respondedAfter: 3,
    sell: 4720,
    margin: 16.2,
  },
  {
    seq: 313,
    branch: 'DXB',
    status: 'quoted',
    channel: 'email',
    mode: 'sea_fcl',
    customer: 5,
    origin: 'CNNGB',
    destination: 'AEJEA',
    owner: 4,
    age: 40,
    sla: 24,
    respondedAfter: 5,
    sell: 2980,
    margin: 14.8,
  },
  {
    seq: 322,
    branch: 'DXB',
    status: 'assigned',
    channel: 'email',
    mode: 'sea_fcl',
    customer: 8,
    origin: 'INNSA',
    destination: 'AEJEA',
    owner: 4,
    age: 12,
    sla: 24,
  },
  {
    seq: 323,
    branch: 'DXB',
    status: 'new',
    channel: 'portal',
    mode: 'air',
    customer: 4,
    origin: 'AEDXB',
    destination: 'KWKWI',
    owner: null,
    age: 2,
    sla: 24,
  },
  {
    seq: 312,
    branch: 'KWI',
    status: 'lost',
    channel: 'email',
    mode: 'sea_fcl',
    customer: 6,
    origin: 'DEHAM',
    destination: 'KWSWK',
    owner: 3,
    age: 96,
    sla: 24,
    respondedAfter: 28,
    sell: 3110,
    margin: 11.2,
  },
  {
    seq: 311,
    branch: 'KWI',
    status: 'won',
    channel: 'whatsapp',
    mode: 'sea_lcl',
    customer: 1,
    origin: 'INNSA',
    destination: 'KWSWK',
    owner: 2,
    age: 120,
    sla: 24,
    respondedAfter: 4,
    sell: 980,
    margin: 24.1,
  },
  {
    seq: 324,
    branch: 'KWI',
    status: 'rating',
    channel: 'email',
    mode: 'sea_fcl',
    customer: 5,
    origin: 'CNNGB',
    destination: 'KWSWK',
    owner: 0,
    age: 9,
    sla: 24,
  },
]

export function pilotEnquiries(now = Date.now()): EnquirySummary[] {
  const year = new Date(now).getFullYear()
  return ENQUIRY_SEEDS.map((seed) => {
    const customer = CUSTOMERS[seed.customer]!
    const createdAt = hours(now, -seed.age)
    return {
      id: `enq-${seed.seq}`,
      reference: `ENQ-${seed.branch}-${year}-${String(seed.seq).padStart(4, '0')}`,
      branchCode: seed.branch,
      status: seed.status,
      channel: seed.channel,
      mode: seed.mode,
      customerName: customer.en,
      customerNameAr: customer.ar,
      originName: PORTS[seed.origin].en,
      destinationName: PORTS[seed.destination].en,
      owner: seed.owner === null ? null : OWNERS[seed.owner]!,
      createdAt,
      slaDueAt: new Date(createdAt.getTime() + seed.sla * HOUR),
      firstRespondedAt:
        seed.respondedAfter === undefined
          ? null
          : new Date(createdAt.getTime() + seed.respondedAfter * HOUR),
      quotedSell: seed.sell === undefined ? null : { amount: seed.sell, currency: 'KWD' },
      quotedMargin: seed.margin ?? null,
    }
  })
}

// --- the quote comparison — Moment 2 and 2b -------------------------------

/**
 * The priced enquiry, with buy, sell and margin side by side.
 *
 * `manualTurnaroundHours` is the punchline of Moment 2: the same enquiry,
 * answered by hand last month, took a day and a half. Pilot §5 item 7 asks the
 * client for that number specifically, with *"the honest turnaround time"*.
 */
export function pilotQuote(now = Date.now()): QuoteComparison {
  const year = new Date(now).getFullYear()
  return {
    enquiryReference: `ENQ-KWI-${year}-0320`,
    customerName: CUSTOMERS[0]!.en,
    lane: 'Ningbo → Shuwaikh',
    mode: 'sea_fcl',
    containerType: '1 × 40HC',
    incoterm: 'CFR Shuwaikh',
    preparedBy: OWNERS[0]!,
    pricedAt: hours(now, -1),
    manualTurnaroundHours: 36,
    pricingMs: 840,
    hasResponded: false,
    isClosed: false,
    options: [
      {
        id: 'opt-1',
        carrier: 'ONE — Ocean Network Express',
        service: 'Direct · weekly',
        transitDays: 24,
        buy: { amount: 1284, currency: 'KWD' },
        sell: { amount: 1580, currency: 'KWD' },
        marginPct: 18.7,
        validUntil: at(now, 21, 23),
        isRecommended: true,
        lines: [
          {
            chargeCode: 'ocean_freight',
            nameEn: 'Ocean Freight',
            nameAr: 'أجرة الشحن البحري',
            basis: 'per_container',
            quantity: 1,
            buyRate: 980,
            sellRate: 1180,
            amount: { amount: 1180, currency: 'KWD' },
          },
          {
            chargeCode: 'thc_origin',
            nameEn: 'Terminal Handling — Origin',
            nameAr: 'مناولة المحطة - المنشأ',
            basis: 'per_container',
            quantity: 1,
            buyRate: 118,
            sellRate: 145,
            amount: { amount: 145, currency: 'KWD' },
          },
          {
            chargeCode: 'thc_destination',
            nameEn: 'Terminal Handling — Destination',
            nameAr: 'مناولة المحطة - الوجهة',
            basis: 'per_container',
            quantity: 1,
            buyRate: 132,
            sellRate: 168,
            amount: { amount: 168, currency: 'KWD' },
          },
          {
            chargeCode: 'documentation',
            nameEn: 'Documentation',
            nameAr: 'رسوم المستندات',
            basis: 'flat',
            quantity: 1,
            buyRate: 22,
            sellRate: 45,
            amount: { amount: 45, currency: 'KWD' },
          },
          {
            chargeCode: 'delivery_order',
            nameEn: 'Delivery Order',
            nameAr: 'إذن التسليم',
            basis: 'flat',
            quantity: 1,
            buyRate: 32,
            sellRate: 42,
            amount: { amount: 42, currency: 'KWD' },
          },
        ],
      },
      {
        id: 'opt-2',
        carrier: 'CMA CGM',
        service: 'Direct · fortnightly',
        transitDays: 21,
        buy: { amount: 1362, currency: 'KWD' },
        sell: { amount: 1690, currency: 'KWD' },
        marginPct: 19.4,
        validUntil: at(now, 14, 23),
        isRecommended: false,
        lines: [
          {
            chargeCode: 'ocean_freight',
            nameEn: 'Ocean Freight',
            nameAr: 'أجرة الشحن البحري',
            basis: 'per_container',
            quantity: 1,
            buyRate: 1050,
            sellRate: 1275,
            amount: { amount: 1275, currency: 'KWD' },
          },
          {
            chargeCode: 'thc_origin',
            nameEn: 'Terminal Handling — Origin',
            nameAr: 'مناولة المحطة - المنشأ',
            basis: 'per_container',
            quantity: 1,
            buyRate: 126,
            sellRate: 155,
            amount: { amount: 155, currency: 'KWD' },
          },
          {
            chargeCode: 'thc_destination',
            nameEn: 'Terminal Handling — Destination',
            nameAr: 'مناولة المحطة - الوجهة',
            basis: 'per_container',
            quantity: 1,
            buyRate: 132,
            sellRate: 168,
            amount: { amount: 168, currency: 'KWD' },
          },
          {
            chargeCode: 'documentation',
            nameEn: 'Documentation',
            nameAr: 'رسوم المستندات',
            basis: 'flat',
            quantity: 1,
            buyRate: 22,
            sellRate: 45,
            amount: { amount: 45, currency: 'KWD' },
          },
          {
            chargeCode: 'delivery_order',
            nameEn: 'Delivery Order',
            nameAr: 'إذن التسليم',
            basis: 'flat',
            quantity: 1,
            buyRate: 32,
            sellRate: 47,
            amount: { amount: 47, currency: 'KWD' },
          },
        ],
      },
      {
        id: 'opt-3',
        carrier: 'Hapag-Lloyd',
        service: 'Transhipment via Jebel Ali',
        transitDays: 29,
        buy: { amount: 1178, currency: 'KWD' },
        sell: { amount: 1420, currency: 'KWD' },
        marginPct: 17.0,
        validUntil: at(now, 28, 23),
        isRecommended: false,
        lines: [
          {
            chargeCode: 'ocean_freight',
            nameEn: 'Ocean Freight',
            nameAr: 'أجرة الشحن البحري',
            basis: 'per_container',
            quantity: 1,
            buyRate: 890,
            sellRate: 1050,
            amount: { amount: 1050, currency: 'KWD' },
          },
          {
            chargeCode: 'thc_origin',
            nameEn: 'Terminal Handling — Origin',
            nameAr: 'مناولة المحطة - المنشأ',
            basis: 'per_container',
            quantity: 1,
            buyRate: 118,
            sellRate: 145,
            amount: { amount: 145, currency: 'KWD' },
          },
          {
            chargeCode: 'thc_destination',
            nameEn: 'Terminal Handling — Destination',
            nameAr: 'مناولة المحطة - الوجهة',
            basis: 'per_container',
            quantity: 1,
            buyRate: 132,
            sellRate: 168,
            amount: { amount: 168, currency: 'KWD' },
          },
          {
            chargeCode: 'documentation',
            nameEn: 'Documentation',
            nameAr: 'رسوم المستندات',
            basis: 'flat',
            quantity: 1,
            buyRate: 6,
            sellRate: 15,
            amount: { amount: 15, currency: 'KWD' },
          },
          {
            chargeCode: 'delivery_order',
            nameEn: 'Delivery Order',
            nameAr: 'إذن التسليم',
            basis: 'flat',
            quantity: 1,
            buyRate: 32,
            sellRate: 42,
            amount: { amount: 42, currency: 'KWD' },
          },
        ],
      },
    ],
  }
}

// --- the dashboard ---------------------------------------------------------

const LIVE_STATUSES = new Set(['booked', 'in_transit', 'arrived', 'customs', 'on_hold'])

export function pilotOverview(now = Date.now()): OpsOverview {
  const jobs = pilotJobs(now)
  const enquiries = pilotEnquiries(now)
  const exceptions = pilotExceptions(now)
  const live = jobs.filter((j) => LIVE_STATUSES.has(j.status))
  const openEnquiries = enquiries.filter(
    (e) => !['won', 'lost', 'cancelled', 'expired'].includes(e.status),
  )

  const byStatus = (rows: readonly { status: string }[]) => {
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
    return [...counts.entries()].map(([status, count]) => ({ status, count }))
  }

  const byMode = new Map<Mode, number>()
  for (const job of live) byMode.set(job.mode, (byMode.get(job.mode) ?? 0) + 1)

  const lanes = new Map<string, { count: number; value: number }>()
  for (const job of jobs) {
    const lane = `${job.originName} → ${job.destinationName}`
    const current = lanes.get(lane) ?? { count: 0, value: 0 }
    lanes.set(lane, {
      count: current.count + 1,
      value: current.value + 480 + job.containerCount * 640,
    })
  }

  const accruing = jobs.reduce((sum, job) => sum + (job.accruing?.amount ?? 0), 0)
  const quoted = enquiries.filter((e) => e.quotedSell)
  const won = enquiries.filter((e) => e.status === 'won').length
  const decided = enquiries.filter((e) => e.status === 'won' || e.status === 'lost').length

  /** Fourteen days of arrivals, which is what an enquiry trend looks like. */
  const trend = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(now - (13 - index) * DAY)
    const weekday = day.getDay()
    /** Friday and Saturday are the Kuwaiti weekend — the trough is real. */
    const base = weekday === 5 ? 1 : weekday === 6 ? 2 : 4 + ((index * 7) % 5)
    return {
      label: day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      value: base,
    }
  })

  return {
    branchCode: 'KWI',
    enquiries: {
      open: openEnquiries.length,
      unassigned: openEnquiries.filter((e) => e.owner === null).length,
      breached: openEnquiries.filter(
        (e) => e.firstRespondedAt === null && e.slaDueAt !== null && e.slaDueAt.getTime() < now,
      ).length,
      dueToday: openEnquiries.filter(
        (e) =>
          e.firstRespondedAt === null &&
          e.slaDueAt !== null &&
          e.slaDueAt.getTime() >= now &&
          e.slaDueAt.getTime() < now + DAY,
      ).length,
      trend,
      byStatus: byStatus(openEnquiries),
    },
    jobs: {
      live: live.length,
      arrivingThisWeek: jobs.filter(
        (j) => j.eta !== null && j.eta.getTime() > now && j.eta.getTime() < now + 7 * DAY,
      ).length,
      onHold: jobs.filter((j) => j.customsStatus === 'held' || j.status === 'on_hold').length,
      byStatus: byStatus(live),
      byMode: [...byMode.entries()].map(([mode, count]) => ({ mode, count })),
    },
    quotes: {
      sentThisMonth: quoted.length,
      winRatePct: decided === 0 ? 0 : Math.round((won / decided) * 100),
      averageMarginPct:
        quoted.length === 0
          ? 0
          : Math.round(
              (quoted.reduce((sum, e) => sum + (e.quotedMargin ?? 0), 0) / quoted.length) * 10,
            ) / 10,
      quotedValue: {
        amount: quoted.reduce((sum, e) => sum + (e.quotedSell?.amount ?? 0), 0),
        currency: 'KWD',
      },
      medianResponseMinutes: 14,
    },
    clocks: {
      running: jobs.filter((j) => j.accruing !== null).length,
      accruing: { amount: accruing, currency: 'KWD' },
      containersAtRisk: 3,
    },
    exceptions,
    slaWatch: openEnquiries
      .filter((e) => e.firstRespondedAt === null && e.slaDueAt !== null)
      .sort((a, b) => (a.slaDueAt?.getTime() ?? 0) - (b.slaDueAt?.getTime() ?? 0))
      .slice(0, 6),
    arrivals: jobs
      .filter((j) => j.eta !== null && j.eta.getTime() > now)
      .sort((a, b) => (a.eta?.getTime() ?? 0) - (b.eta?.getTime() ?? 0))
      .slice(0, 6),
    topLanes: [...lanes.entries()]
      .map(([lane, v]) => ({ lane, count: v.count, value: { amount: v.value, currency: 'KWD' } }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  }
}

// --- the customer's own view ----------------------------------------------

/** The seeded portal customer — Pilot §3.1 item 10. */
export const PILOT_PORTAL_CUSTOMER = CUSTOMERS[0]!

export function pilotPortalShipments(now = Date.now()): PortalShipment[] {
  return pilotJobs(now)
    .filter((job) => job.customerName === PILOT_PORTAL_CUSTOMER.en)
    .map((job) => {
      const detail = pilotJob(job.id, now)
      const next = detail?.milestones.find((m) => m.actualAt === null)
      return {
        id: job.id,
        reference: job.reference,
        customerReference: detail?.customerReference ?? null,
        status: job.status,
        mode: job.mode,
        originName: job.originName,
        destinationName: job.destinationName,
        eta: job.eta,
        milestonesTotal: job.milestonesTotal,
        milestonesDone: job.milestonesDone,
        documentsReleased: detail?.documents.filter((d) => d.releasedAt !== null).length ?? 0,
        nextMilestone: next?.nameEn ?? null,
      }
    })
}

/**
 * Public tracking — `FR-CP-05`.
 *
 * Two identifiers, not one: a reference alone is guessable and this page has
 * no session (§8). The verifier is matched against the bill of lading or any
 * container on the job, which is what a customer has to hand.
 */
export function pilotTracking(
  reference: string,
  verifier: string,
  now = Date.now(),
): TrackingResult | undefined {
  const job = pilotJobByReference(reference, now)
  if (!job) return undefined

  const supplied = verifier.trim().toUpperCase().replace(/\s+/g, '')
  const accepted = [
    job.masterBillNumber,
    job.houseBillNumber,
    job.bookingNumber,
    job.customerReference,
    ...job.containers.map((c) => c.containerNo),
  ]
    .filter(Boolean)
    .map((v) => v!.toUpperCase().replace(/\s+/g, ''))

  if (!accepted.includes(supplied)) return undefined

  return {
    reference: job.reference,
    status: job.status,
    mode: job.mode,
    customerName: job.customerName,
    originName: job.originName,
    originNameAr: job.originNameAr,
    destinationName: job.destinationName,
    destinationNameAr: job.destinationNameAr,
    vesselOrFlight: job.vesselOrFlight,
    etd: job.etd,
    eta: job.eta,
    ata: job.ata,
    containers: job.containers,
    milestones: job.milestones.filter((m) => m.code !== 'empty_returned'),
    /** Released only — a draft bill of lading is not a customer document. */
    documents: job.documents.filter((d) => d.releasedAt !== null),
    notices: job.exceptions
      .filter((e) => e.code === 'customs_hold' || e.code === 'vessel_delay')
      .map((e) => ({ code: e.code, nameEn: e.nameEn, nameAr: e.nameAr })),
  }
}

/** The reference the demo script types first (Pilot §6). */
export function pilotDemoReference(now = Date.now()): { reference: string; verifier: string } {
  const job = pilotJob('job-1041', now)!
  return { reference: job.reference, verifier: job.containers[0]?.containerNo ?? '' }
}

/* ===========================================================================
   The registers.

   Everything below stands in for a query listed as `NEEDS_DATABASE` in
   `apps/web/e2e/support/harness.ts`. Each builder names the query it serves.

   Two rules run through all of it, and both are about the same failure:

   1. **Nothing is invented in parallel.** An invoice belongs to a job on the
      board, for a customer in `CUSTOMERS`, in that job's branch currency. A
      supplier bill names a partner the job file already names. A rate card
      covers a lane the board actually runs. A demo where finance and
      operations disagree about one shipment is worse than a finance screen
      that 500s, because it is the thing a prospect notices in the meeting and
      it cannot be explained away.

   2. **Nothing sums two currencies.** KWI bills in KWD and DXB in AED, and
      several of these queries add a column up and label the total with one
      currency — true of the SQL, untrue of money. The dataset is arranged so
      the question never arises: every *open* receivable is the Kuwait
      entity's, every supplier bill is bought by the Kuwait entity and carries
      its own `fxRate` back to KWD. Where a screen shows a foreign figure it is
      per row, beside its own currency code.
   ======================================================================== */

// --- quotations — features/ledger/queries.ts -------------------------------

/**
 * The quotations, derived from the enquiries that were priced.
 *
 * Every row here is an `ENQUIRY_SEEDS` entry carrying a `sell`, so the quote
 * register and the enquiry queue agree about which enquiries got a price and
 * what it was. `totalCost` is back-computed from the margin the enquiry
 * already advertises rather than stated twice — margin known at the moment of
 * quoting is `FR-EQ-07`'s whole argument, and two numbers that could drift
 * apart would undermine it on the one screen that exists to show it.
 *
 * All KWD, including the Dubai enquiry. `pilotEnquiries` already labels every
 * `quotedSell` KWD; a quote register that priced the same enquiry in AED would
 * be the two screens disagreeing in the most literal way available.
 */
export function pilotQuotes(now = Date.now(), status?: string): QuoteRow[] {
  const year = new Date(now).getFullYear()

  const priced = ENQUIRY_SEEDS.filter((seed) => seed.sell !== undefined)

  const rows = priced.flatMap((seed): QuoteRow[] => {
    const customer = CUSTOMERS[seed.customer]!
    const createdAt = hours(now, -seed.age)
    const sentAt = new Date(createdAt.getTime() + (seed.respondedAfter ?? 1) * HOUR)
    const sell = new D(seed.sell!)
    const cost = sell.times(new D(100).minus(new D(seed.margin ?? 0))).dividedBy(100)
    const enquiryReference = `ENQ-${seed.branch}-${year}-${String(seed.seq).padStart(4, '0')}`
    const decided = seed.status === 'won' || seed.status === 'lost'

    const current: QuoteRow = {
      id: `quote-${seed.seq}`,
      reference: `QTE-${seed.branch}-${year}-${String(seed.seq).padStart(4, '0')}`,
      // The one revision on the board, and the reason `version` is a column.
      version: seed.seq === 316 ? 2 : 1,
      status: seed.status === 'won' ? 'accepted' : seed.status === 'lost' ? 'rejected' : 'sent',
      currency: 'KWD',
      totalSell: numeric(sell),
      totalCost: numeric(cost),
      // The lost one has lapsed as well as being lost, which is usually the order.
      validUntil: seed.status === 'lost' ? day(now, -2) : day(now, 14),
      sentAt,
      decidedAt: decided ? hours(now, -Math.round(seed.age / 3)) : null,
      customerName: customer.en,
      enquiryReference,
      preparedBy: seed.owner === null ? null : OWNERS[seed.owner]!,
      branchCode: seed.branch,
    }

    if (seed.seq !== 316) return [current]

    /*
      The superseded first version, kept rather than replaced.

      A quotation is versioned because the customer asked for the same lane
      with a different incoterm, and both prices were real. `listQuotes` does
      not filter superseded rows out, so a register with only the current
      version would be the fixture quietly answering a different question from
      the database.
    */
    return [
      current,
      {
        ...current,
        id: `quote-${seed.seq}-v1`,
        version: 1,
        status: 'superseded',
        totalSell: numeric(sell.minus(new D('120'))),
        totalCost: numeric(cost.minus(new D('120'))),
        sentAt: new Date(sentAt.getTime() - 6 * HOUR),
        decidedAt: null,
      },
    ]
  })

  return status ? rows.filter((row) => row.status === status) : rows
}

/** Serves `quoteStatusCounts`. Derived, so the strip cannot disagree. */
export function pilotQuoteStatusCounts(now = Date.now()): { status: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of pilotQuotes(now)) counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status))
}

/** Serves `hasQuotes` — the empty-state check. */
export function pilotHasQuotes(now = Date.now()): boolean {
  return pilotQuotes(now).length > 0
}

// --- invoices and receivables — features/ledger/queries.ts ------------------

interface InvoiceSeed {
  readonly seq: number
  readonly branch: BranchCode
  readonly customer: number
  /**
   * The job this bills, where it is one on the board.
   *
   * Null on the aged debt, and that is a statement rather than a shortcut. The
   * board is twenty live and recently-closed shipments; a receivable a hundred
   * and thirty days old belongs to a job that closed long before the newest
   * row on it. Tying one to a board job would mean either an invoice older
   * than the shipment it bills, or a "live" job nobody has touched in four
   * months — both of which read as broken data to anybody who looks twice.
   */
  readonly job: number | null
  /** Days ago it was issued. */
  readonly issued: number
  readonly termsDays: number
  readonly subtotal: string
  readonly tax: string
  readonly paid: string
  readonly status: string
  readonly isCreditNote?: boolean
}

/**
 * The receivables position, arranged to fill every ageing bucket.
 *
 * There is something genuinely overdue — `4081`, a hundred and thirty days
 * past its terms and never chased — because an ageing chart where everything
 * sits in `current` demonstrates that the chart renders and nothing else. The
 * distribution below is the one a forwarder recognises: most of the book
 * current, a tail that stops being collectable, and one name that is most of
 * the tail.
 *
 * Every Dubai invoice is settled. `receivablesAgeing` sums balances across
 * currencies and labels the total with whichever it finds first, so an open
 * AED invoice would put dirhams into a Kuwaiti dinar total. That is the
 * query's flaw and not this file's to fix, but it is this file's to avoid
 * demonstrating.
 */
const INVOICE_SEEDS: readonly InvoiceSeed[] = [
  // Current — issued, inside terms.
  {
    seq: 4118,
    branch: 'KWI',
    customer: 3,
    job: 1033,
    issued: 18,
    termsDays: 30,
    subtotal: '4820.500',
    tax: '0',
    paid: '0',
    status: 'issued',
  },
  {
    seq: 4117,
    branch: 'KWI',
    customer: 8,
    job: 1035,
    issued: 11,
    termsDays: 30,
    subtotal: '3115.750',
    tax: '0',
    paid: '1000.000',
    status: 'part_paid',
  },
  /*
    A credit note against `4117` — the customer was billed a delivery order
    twice. It carries `isCreditNote` and a matching `amountPaid`, which is how
    a credited document leaves the ageing without being deleted (§5.5).
  */
  {
    seq: 4116,
    branch: 'KWI',
    customer: 8,
    job: 1035,
    issued: 9,
    termsDays: 30,
    subtotal: '420.000',
    tax: '0',
    paid: '420.000',
    status: 'credited',
    isCreditNote: true,
  },
  {
    seq: 4115,
    branch: 'KWI',
    customer: 5,
    job: 1038,
    issued: 7,
    termsDays: 15,
    subtotal: '980.250',
    tax: '0',
    paid: '980.250',
    status: 'paid',
  },
  // 1–30 days.
  {
    seq: 4114,
    branch: 'KWI',
    customer: 4,
    job: 1043,
    issued: 40,
    termsDays: 30,
    subtotal: '2760.000',
    tax: '0',
    paid: '0',
    status: 'issued',
  },
  {
    seq: 4110,
    branch: 'KWI',
    customer: 7,
    job: null,
    issued: 52,
    termsDays: 45,
    subtotal: '7420.000',
    tax: '0',
    paid: '0',
    status: 'issued',
  },
  // 31–60.
  {
    seq: 4104,
    branch: 'KWI',
    customer: 0,
    job: null,
    issued: 75,
    termsDays: 30,
    subtotal: '6240.000',
    tax: '0',
    paid: '2000.000',
    status: 'part_paid',
  },
  // 61–90.
  {
    seq: 4096,
    branch: 'KWI',
    customer: 6,
    job: null,
    issued: 105,
    termsDays: 30,
    subtotal: '1890.500',
    tax: '0',
    paid: '0',
    status: 'issued',
  },
  // Over 90 — the one the credit controller opens the screen for.
  {
    seq: 4081,
    branch: 'KWI',
    customer: 2,
    job: null,
    issued: 160,
    termsDays: 30,
    subtotal: '3450.000',
    tax: '0',
    paid: '0',
    status: 'issued',
  },
  // Drafted this morning against the job that arrived yesterday.
  {
    seq: 4119,
    branch: 'KWI',
    customer: 2,
    job: 1039,
    issued: 1,
    termsDays: 30,
    subtotal: '1240.750',
    tax: '0',
    paid: '0',
    status: 'draft',
  },
  /*
    Dubai, in dirhams, with 5% VAT — the UAE charges it and Kuwait does not,
    which is why `tax` is zero on every row above and not on these two.
  */
  {
    seq: 2054,
    branch: 'DXB',
    customer: 9,
    job: 2014,
    issued: 30,
    termsDays: 30,
    subtotal: '9800.00',
    tax: '490.00',
    paid: '10290.00',
    status: 'paid',
  },
  {
    seq: 2051,
    branch: 'DXB',
    customer: 5,
    job: 2019,
    issued: 6,
    termsDays: 30,
    subtotal: '5240.00',
    tax: '262.00',
    paid: '5502.00',
    status: 'paid',
  },
]

function invoiceTotal(seed: InvoiceSeed): string {
  return sum([seed.subtotal, seed.tax])
}

function invoiceRow(seed: InvoiceSeed, now: number): InvoiceRow {
  const customer = CUSTOMERS[seed.customer]!
  const home = branch(seed.branch)
  return {
    id: `inv-${seed.seq}`,
    // Drafts have no number yet: the series is consumed at issue, not at save.
    seriesNo: seed.status === 'draft' ? null : `${home.code}-${String(seed.seq).padStart(6, '0')}`,
    status: seed.status,
    currency: home.currency,
    subtotal: numeric(seed.subtotal),
    taxAmount: numeric(seed.tax),
    total: invoiceTotal(seed),
    amountPaid: numeric(seed.paid),
    issuedAt: seed.status === 'draft' ? null : at(now, -seed.issued, 11),
    dueOn: seed.status === 'draft' ? null : day(now, -seed.issued + seed.termsDays),
    isCreditNote: seed.isCreditNote ?? false,
    customerName: customer.en,
    branchCode: home.code,
  }
}

/** Serves `listInvoices`. Newest first, as `order by created_at desc` gives. */
export function pilotInvoices(now = Date.now(), status?: string): InvoiceRow[] {
  const rows = [...INVOICE_SEEDS]
    .sort((a, b) => a.issued - b.issued)
    .map((seed) => invoiceRow(seed, now))
  return status ? rows.filter((row) => row.status === status) : rows
}

/** Every invoice still owing something, with how far past due it is. */
function openInvoices(now: number): { row: InvoiceRow; balance: string; daysOverdue: number }[] {
  return pilotInvoices(now)
    .filter((row) => !['paid', 'void', 'draft'].includes(row.status))
    .map((row) => ({
      row,
      balance: minus(row.total ?? '0', row.amountPaid ?? '0'),
      daysOverdue: row.dueOn === null ? 0 : Math.floor((now - Date.parse(row.dueOn)) / DAY),
    }))
    .filter((entry) => new D(entry.balance).greaterThan(0))
}

/**
 * Serves `invoiceSummary`.
 *
 * The counts mirror the statement's `filter` clauses exactly, including the
 * two that look wrong and are not: `issued` counts a credited invoice, and
 * `outstanding` includes drafts. Both follow from `status not in (…)` lists
 * that differ by one word, and a fixture that quietly tidied them up would
 * make the offline number disagree with the database's.
 */
export function pilotInvoiceSummary(now = Date.now()): InvoiceSummary {
  const rows = pilotInvoices(now)
  const open = rows.filter((row) => !['paid', 'void', 'draft'].includes(row.status))

  return {
    issued: open.length,
    paid: rows.filter((row) => row.status === 'paid').length,
    overdue: open.filter((row) => row.dueOn !== null && Date.parse(row.dueOn) < now).length,
    outstanding: sum(
      rows
        .filter((row) => !['paid', 'void'].includes(row.status))
        .map((row) => minus(row.total ?? '0', row.amountPaid ?? '0')),
    ),
    // `select currency from invoices order by created_at desc limit 1`.
    currency: rows[0]?.currency ?? null,
  }
}

/**
 * Serves `receivablesAgeing`.
 *
 * The 30/60/90 boundaries are the query's and not a choice made here: a credit
 * controller already reads those buckets and inventing different ones would
 * mean nobody could compare the screen to their bank's statement.
 */
export function pilotReceivablesAgeing(now = Date.now()): ReceivablesAgeing {
  const open = openInvoices(now)

  const inBucket = (key: AgeingBucket['key']) =>
    open.filter(({ daysOverdue }) => {
      if (key === 'current') return daysOverdue <= 0
      if (key === 'd1_30') return daysOverdue >= 1 && daysOverdue <= 30
      if (key === 'd31_60') return daysOverdue >= 31 && daysOverdue <= 60
      if (key === 'd61_90') return daysOverdue >= 61 && daysOverdue <= 90
      return daysOverdue > 90
    })

  const bucket = (key: AgeingBucket['key']): AgeingBucket => {
    const rows = inBucket(key)
    return { key, count: rows.length, amount: sum(rows.map((r) => r.balance)) }
  }

  return {
    buckets: [
      bucket('current'),
      bucket('d1_30'),
      bucket('d31_60'),
      bucket('d61_90'),
      bucket('d90_plus'),
    ],
    total: sum(open.map((entry) => entry.balance)),
    currency: open[0]?.row.currency ?? null,
  }
}

/**
 * Serves `topDebtors`.
 *
 * Ordered by balance rather than by age, which is what a credit controller
 * actually does: the oldest debt is frequently the smallest and the least
 * collectable, and chasing the largest exposure first is the job.
 */
export function pilotTopDebtors(now = Date.now(), limit = 8): DebtorRow[] {
  const byCustomer = new Map<string, { row: InvoiceRow; balance: string; daysOverdue: number }[]>()
  for (const entry of openInvoices(now)) {
    const name = entry.row.customerName!
    byCustomer.set(name, [...(byCustomer.get(name) ?? []), entry])
  }

  return [...byCustomer.entries()]
    .map(([customerName, entries]): DebtorRow => {
      const index = CUSTOMERS.findIndex((c) => c.en === customerName)
      const oldest = entries.reduce((worst, e) => (e.daysOverdue > worst.daysOverdue ? e : worst))
      return {
        customerId: customerId(index),
        customerName,
        balance: sum(entries.map((e) => e.balance)),
        currency: entries[0]!.row.currency,
        invoiceCount: entries.length,
        oldestDueOn: oldest.row.dueOn,
        daysOverdue: Math.max(0, oldest.daysOverdue),
      }
    })
    .sort((a, b) => (new D(b.balance).greaterThan(new D(a.balance)) ? 1 : -1))
    .slice(0, limit)
}

// --- payments — features/ledger/queries.ts ----------------------------------

interface PaymentSeed {
  readonly seq: number
  readonly branch: BranchCode
  readonly customer: number
  readonly amount: string
  /** Days ago the money landed. */
  readonly received: number
  readonly method: string
  readonly reference: string
  readonly recordedBy: number
  /** What of it is matched to an invoice. Short of `amount` is money in limbo. */
  readonly allocated: string
}

/**
 * Receipts against the Kuwait ledger only.
 *
 * `paymentSummary` adds `amount` up across every row and labels the total with
 * one currency, so handing it dinars and dirhams would produce a figure that
 * is wrong in a way nobody can see. The Dubai invoices above are settled and
 * their receipts are simply not modelled — which is also what a register
 * scoped by RLS to a Kuwaiti coordinator would show.
 */
const PAYMENT_SEEDS: readonly PaymentSeed[] = [
  {
    seq: 233,
    branch: 'KWI',
    customer: 8,
    amount: '1000.000',
    received: 6,
    method: 'bank_transfer',
    reference: 'NBK-778112',
    recordedBy: 3,
    allocated: '1000.000',
  },
  {
    seq: 232,
    branch: 'KWI',
    customer: 5,
    amount: '980.250',
    received: 7,
    method: 'cheque',
    reference: 'CHQ-004518',
    recordedBy: 3,
    allocated: '980.250',
  },
  {
    seq: 231,
    branch: 'KWI',
    customer: 0,
    amount: '2000.000',
    received: 21,
    method: 'bank_transfer',
    reference: 'GTB-99031',
    recordedBy: 3,
    allocated: '2000.000',
  },
  /*
    Money we have and cannot close a ledger with.

    Alghanim paid a round 1,500 against no invoice number, which is the single
    most common thing a receipts desk deals with and the reason `allocated` is
    on the row at all. It is deliberately the newest receipt, so it is the
    first line of the register.
  */
  {
    seq: 230,
    branch: 'KWI',
    customer: 4,
    amount: '1500.000',
    received: 2,
    method: 'bank_transfer',
    reference: 'KFH-220417',
    recordedBy: 3,
    allocated: '0',
  },
]

/** Serves `listPayments`, newest receipt first. */
export function pilotPayments(now = Date.now()): PaymentRow[] {
  return [...PAYMENT_SEEDS]
    .sort((a, b) => a.received - b.received)
    .map((seed): PaymentRow => ({
      id: `pay-${seed.seq}`,
      amount: numeric(seed.amount),
      currency: branch(seed.branch).currency,
      receivedOn: day(now, -seed.received),
      method: seed.method,
      reference: seed.reference,
      customerName: CUSTOMERS[seed.customer]!.en,
      branchCode: seed.branch,
      recordedBy: OWNERS[seed.recordedBy]!,
      allocated: numeric(seed.allocated),
    }))
}

/** Serves `paymentSummary`. */
export function pilotPaymentSummary(now = Date.now()): PaymentSummary {
  const rows = pilotPayments(now)
  return {
    count: rows.length,
    received: sum(rows.map((row) => row.amount)),
    unallocated: rows.filter((row) => new D(row.allocated).isZero()).length,
    currency: rows[0]?.currency ?? null,
  }
}

/**
 * Serves `listAccountingExports`.
 *
 * The voided row stays in the list, because that is the point of a void rather
 * than a delete: the reason somebody gives for unwinding a posted period is a
 * thing an auditor asks about (FR-FN-12).
 */
export function pilotAccountingExports(now = Date.now()): AccountingExportRow[] {
  return [
    {
      id: 'exp-31',
      branchCode: 'KWI',
      format: 'journal_csv',
      periodFrom: day(now, -30),
      periodTo: day(now, -1),
      rowCount: 412,
      status: 'draft',
      postedAt: null,
      postedBy: null,
      voidedAt: null,
      voidReason: null,
    },
    {
      id: 'exp-30',
      branchCode: 'KWI',
      format: 'journal_csv',
      periodFrom: day(now, -61),
      periodTo: day(now, -31),
      rowCount: 508,
      status: 'posted',
      postedAt: at(now, -28, 16),
      postedBy: OWNERS[3]!,
      voidedAt: null,
      voidReason: null,
    },
    {
      id: 'exp-29',
      branchCode: 'DXB',
      format: 'journal_csv',
      periodFrom: day(now, -61),
      periodTo: day(now, -31),
      rowCount: 96,
      status: 'void',
      postedAt: at(now, -27, 10),
      postedBy: OWNERS[4]!,
      voidedAt: at(now, -26, 9),
      voidReason: 'Posted against the wrong period — reposted as the corrected month.',
    },
  ]
}

// --- rate cards — features/rates/queries.ts ---------------------------------

interface RateCardSeed {
  readonly seq: number
  readonly direction: 'buy' | 'sell'
  readonly mode: Mode
  readonly tradeDirection: 'import' | 'export'
  readonly origin: PortCode
  readonly destination: PortCode
  /** The agent or carrier on a buy card. */
  readonly partner?: PartnerKey
  /** The customer on a negotiated sell card; absent means the standing tariff. */
  readonly customer?: number
  readonly branch: BranchCode
  readonly version: number
  /** Days from now. Negative is in the past; `validTo` null is open-ended. */
  readonly from: number
  readonly to: number | null
  readonly lineCount: number
  readonly total: string
}

/**
 * The rate book — deliberately incomplete, because that is the argument.
 *
 * Three things are seeded to be found:
 *
 * - **Istanbul → Shuwaikh has a sell card and no buy card.** Job `1047` and
 *   enquiry `320` both run that lane, so it has traffic; the margin column
 *   reads *unknown* rather than zero and the lane is being quoted blind. That
 *   is `laneMargins`' entire reason for existing.
 * - **Shuwaikh → Jeddah's buy card lapsed five days ago.** Job `1045` sailed
 *   it this week. Coverage does not announce its own expiry, which is why
 *   `FR-RT-11` has both a panel and a nightly digest.
 * - **Ningbo → Shuwaikh's sell card expires in nine days**, on the busiest
 *   lane on the board.
 *
 * Every card is in the branch's own currency. A lane margin that compares a
 * dollar buy to a dinar sell is arithmetic on two different things, and the
 * conditional aggregation in `laneMargins` would do it without complaint.
 */
const RATE_CARD_SEEDS: readonly RateCardSeed[] = [
  {
    seq: 71,
    direction: 'buy',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    origin: 'CNNGB',
    destination: 'KWSWK',
    partner: 'one',
    branch: 'KWI',
    version: 2,
    from: -120,
    to: 40,
    lineCount: 5,
    total: '1284.000',
  },
  {
    seq: 72,
    direction: 'sell',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    origin: 'CNNGB',
    destination: 'KWSWK',
    branch: 'KWI',
    version: 3,
    from: -120,
    to: 9,
    lineCount: 5,
    total: '1580.000',
  },
  {
    seq: 73,
    direction: 'buy',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    origin: 'CNSHA',
    destination: 'KWSWK',
    partner: 'one',
    branch: 'KWI',
    version: 1,
    from: -150,
    to: 60,
    lineCount: 5,
    total: '1342.500',
  },
  {
    seq: 74,
    direction: 'sell',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    origin: 'CNSHA',
    destination: 'KWSWK',
    customer: 4,
    branch: 'KWI',
    version: 1,
    from: -150,
    to: 60,
    lineCount: 5,
    total: '1655.000',
  },
  {
    seq: 75,
    direction: 'buy',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    origin: 'INNSA',
    destination: 'KWSWK',
    partner: 'mumbai',
    branch: 'KWI',
    version: 1,
    from: -90,
    to: 95,
    lineCount: 4,
    total: '612.000',
  },
  {
    seq: 76,
    direction: 'sell',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    origin: 'INNSA',
    destination: 'KWSWK',
    branch: 'KWI',
    version: 1,
    from: -90,
    to: 95,
    lineCount: 4,
    total: '760.000',
  },
  {
    seq: 77,
    direction: 'buy',
    mode: 'air',
    tradeDirection: 'export',
    origin: 'KWKWI',
    destination: 'DEHAM',
    partner: 'ek',
    branch: 'KWI',
    version: 1,
    from: -60,
    to: 120,
    lineCount: 4,
    total: '2180.000',
  },
  {
    seq: 78,
    direction: 'sell',
    mode: 'air',
    tradeDirection: 'export',
    origin: 'KWKWI',
    destination: 'DEHAM',
    customer: 7,
    branch: 'KWI',
    version: 1,
    from: -60,
    to: 120,
    lineCount: 4,
    total: '2760.000',
  },
  // Lapsed. `isLive` is false and the register says so rather than hiding it.
  {
    seq: 68,
    direction: 'buy',
    mode: 'sea_fcl',
    tradeDirection: 'export',
    origin: 'KWSWK',
    destination: 'SAJED',
    partner: 'one',
    branch: 'KWI',
    version: 1,
    from: -200,
    to: -5,
    lineCount: 4,
    total: '480.000',
  },
  // Sell with no buy behind it — the lane that is being quoted blind.
  {
    seq: 79,
    direction: 'sell',
    mode: 'sea_lcl',
    tradeDirection: 'import',
    origin: 'TRIST',
    destination: 'KWSWK',
    customer: 1,
    branch: 'KWI',
    version: 1,
    from: -40,
    to: 80,
    lineCount: 3,
    total: '96.000',
  },
  {
    seq: 41,
    direction: 'buy',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    origin: 'CNNGB',
    destination: 'AEJEA',
    partner: 'one',
    branch: 'DXB',
    version: 1,
    from: -100,
    to: 22,
    lineCount: 5,
    total: '1120.000',
  },
  {
    seq: 42,
    direction: 'sell',
    mode: 'sea_fcl',
    tradeDirection: 'import',
    origin: 'CNNGB',
    destination: 'AEJEA',
    customer: 5,
    branch: 'DXB',
    version: 1,
    from: -100,
    to: 120,
    lineCount: 5,
    total: '1390.000',
  },
]

const EXPIRY_HORIZON_DAYS = 30

function isLiveCard(seed: RateCardSeed): boolean {
  return seed.from <= 0 && (seed.to === null || seed.to >= 0)
}

/** Serves `listRateCards`, newest validity first. */
export function pilotRateCards(now = Date.now(), direction?: string): RateCardRow[] {
  const rows = [...RATE_CARD_SEEDS]
    .sort((a, b) => b.from - a.from)
    .map((seed): RateCardRow => ({
      id: `rate-${seed.seq}`,
      direction: seed.direction,
      mode: seed.mode,
      tradeDirection: seed.tradeDirection,
      originName: PORTS[seed.origin].en,
      originCode: seed.origin,
      destinationName: PORTS[seed.destination].en,
      destinationCode: seed.destination,
      partnerName: seed.partner ? partner(seed.partner).en : null,
      customerName: seed.customer === undefined ? null : CUSTOMERS[seed.customer]!.en,
      branchCode: seed.branch,
      currency: branch(seed.branch).currency,
      version: seed.version,
      validFrom: day(now, seed.from),
      validTo: seed.to === null ? null : day(now, seed.to),
      lineCount: seed.lineCount,
      /*
        The sum of the card's lines, which is not the price of a shipment —
        bases differ and a per-container line means nothing without a container
        count. Shown as an order of magnitude, and the column is labelled as
        one.
      */
      total: numeric(seed.total),
      isLive: isLiveCard(seed),
      isExpiring: seed.to !== null && seed.to >= 0 && seed.to <= EXPIRY_HORIZON_DAYS,
    }))

  return direction ? rows.filter((row) => row.direction === direction) : rows
}

/**
 * Serves `rateCardSummary`.
 *
 * `uncoveredLanes` is counted the way the SQL counts it — distinct
 * origin/destination/mode across jobs that are not closed or cancelled, minus
 * the ones a live buy card covers. It is the most useful number on the page
 * and it is about lanes with *traffic*, not about lanes somebody once made a
 * card for.
 */
export function pilotRateCardSummary(): RateCardSummary {
  const live = RATE_CARD_SEEDS.filter(isLiveCard)
  const buyKeys = new Set(
    live.filter((c) => c.direction === 'buy').map((c) => `${c.origin}:${c.destination}:${c.mode}`),
  )

  const trafficked = new Set(
    JOB_SEEDS.filter((job) => job.status !== 'closed' && job.status !== 'cancelled').map(
      (job) => `${job.origin}:${job.destination}:${job.mode}`,
    ),
  )

  return {
    live: live.length,
    expiring: RATE_CARD_SEEDS.filter(
      (c) => c.to !== null && c.to >= 0 && c.to <= EXPIRY_HORIZON_DAYS,
    ).length,
    lanesCovered: buyKeys.size,
    uncoveredLanes: [...trafficked].filter((key) => !buyKeys.has(key)).length,
  }
}

/**
 * Serves `laneMargins`.
 *
 * One row per lane by construction, with whichever side is missing arriving as
 * null — which is the shape the query's conditional aggregation produces and
 * the reason it is not a full outer join. Null margin is *unknown*, never
 * zero, and the register has to be able to tell the difference.
 */
export function pilotLaneMargins(): LaneMarginRow[] {
  const live = RATE_CARD_SEEDS.filter(isLiveCard)
  const lanes = new Map<string, RateCardSeed[]>()
  for (const card of live) {
    const key = `${card.origin}:${card.destination}:${card.mode}`
    lanes.set(key, [...(lanes.get(key) ?? []), card])
  }

  return (
    [...lanes.values()]
      .map((cards): LaneMarginRow => {
        const first = cards[0]!
        const buy = cards.find((c) => c.direction === 'buy')
        const sell = cards.find((c) => c.direction === 'sell')
        const margin =
          buy && sell
            ? Math.round(
                new D(sell.total)
                  .minus(new D(buy.total))
                  .dividedBy(new D(sell.total))
                  .times(1000)
                  .toNumber(),
              ) / 10
            : null

        return {
          lane: `${PORTS[first.origin].en} → ${PORTS[first.destination].en}`,
          mode: first.mode,
          buyTotal: buy ? numeric(buy.total) : null,
          sellTotal: sell ? numeric(sell.total) : null,
          currency: branch(first.branch).currency,
          marginPct: margin,
        }
      })
      // Thinnest margin first, unknowns last — the query's `nulls last`.
      .sort((a, b) => (a.marginPct ?? Infinity) - (b.marginPct ?? Infinity))
      .slice(0, 20)
  )
}

/**
 * Serves `listExpiringRateCards` — re-exported into the rates slice from
 * `@qabandi/db`, because the nightly digest reads the same answer.
 *
 * The lane is rendered in reading order for the language it is named for, so
 * the Arabic string is not the English one with the ports swapped in: `‹من›
 * → ‹إلى›` reversed is the same journey described backwards.
 */
export function pilotExpiringRateCards(
  now = Date.now(),
  withinDays = EXPIRY_HORIZON_DAYS,
): ExpiringRateCardRow[] {
  return RATE_CARD_SEEDS.filter((c) => c.to !== null && c.to >= 0 && c.to <= withinDays)
    .sort((a, b) => a.to! - b.to!)
    .map((seed): ExpiringRateCardRow => {
      const counterparty = seed.partner
        ? partner(seed.partner)
        : seed.customer === undefined
          ? null
          : CUSTOMERS[seed.customer]!
      return {
        id: `rate-${seed.seq}`,
        branchId: branch(seed.branch).id,
        direction: seed.direction,
        mode: seed.mode,
        lane: `${PORTS[seed.origin].en} → ${PORTS[seed.destination].en}`,
        laneAr: `${PORTS[seed.origin].ar} ← ${PORTS[seed.destination].ar}`,
        // A tariff card has no counterparty; the digest names it as such.
        counterparty: counterparty?.en ?? 'Standing tariff',
        counterpartyAr: counterparty?.ar ?? 'التعرفة المعتمدة',
        validTo: day(now, seed.to!),
        daysRemaining: seed.to!,
      }
    })
}

// --- customers — features/customers/queries.ts ------------------------------

/** Live work, counted the way every `openJobs` column in the product counts it. */
const OPEN_JOB_STATUSES = new Set([
  'draft',
  'booked',
  'in_transit',
  'arrived',
  'customs',
  'delivered',
  'completed',
  'on_hold',
])

function openJobsForCustomer(index: number): number {
  return JOB_SEEDS.filter((job) => job.customer === index && OPEN_JOB_STATUSES.has(job.status))
    .length
}

function customerRow(index: number): CustomerRow {
  const customer = CUSTOMERS[index]!
  return {
    id: customerId(index),
    code: customer.code,
    legalNameEn: customer.en,
    legalNameAr: customer.ar,
    countryCode: customer.country,
    isActive: true,
    branchCode: customer.branch,
    openJobs: openJobsForCustomer(index),
  }
}

/** Serves `listCustomers`, alphabetical, with the same search the query does. */
export function pilotCustomers(search?: string): CustomerRow[] {
  const term = search?.trim().toLowerCase()
  return CUSTOMERS.map((_, index) => customerRow(index))
    .filter(
      (row) =>
        !term ||
        row.legalNameEn.toLowerCase().includes(term) ||
        row.code.toLowerCase().includes(term) ||
        (row.legalNameAr ?? '').includes(term),
    )
    .sort((a, b) => a.legalNameEn.localeCompare(b.legalNameEn))
}

/**
 * Serves `getCustomer`.
 *
 * Null rather than a throw for a customer that is not here: invisible under
 * RLS is the same answer as absent, and FR-ID-04 wants not-found rather than
 * forbidden so there is no enumeration signal.
 *
 * `terms` is per branch because credit is per legal entity — the Kuwait
 * company's 45 days say nothing about what the Dubai company will extend. Only
 * the primary branch is seeded for most, which is the ordinary state.
 */
export function pilotCustomer(id: string): CustomerDetail | null {
  const index = CUSTOMERS.findIndex((_, i) => customerId(i) === id)
  if (index === -1) return null

  const customer = CUSTOMERS[index]!
  const home = branch(customer.branch as BranchCode)

  return {
    ...customerRow(index),
    registration: `CR-${String(180000 + index * 37)}`,
    // Kuwait has no VAT registration to hold; the UAE customers do.
    taxRegistration: customer.country === 'AE' ? `1000${String(index).padStart(11, '4')}` : null,
    primaryBranchId: home.id,
    terms: [
      {
        branchId: home.id,
        branchCode: home.code,
        paymentTermsDays: customer.terms,
        creditLimit: numeric(customer.limit),
        creditCurrency: home.currency,
        freeTimeDays: 10,
        defaultIncoterm: 'CFR',
        /*
          One customer on stop, and it is the one carrying the 130-day debt.
          A credit hold that does not line up with the receivables screen is a
          hold nobody believes.
        */
        isOnHold: index === 2,
      },
    ],
  }
}

/** Serves `loadFormReference` — the branch and country lists a form needs. */
export function pilotFormReference(): FormReference {
  return {
    branches: BRANCHES.map((b) => ({ id: b.id, code: b.code, name: b.en, currency: b.currency })),
    countries: COUNTRIES.map((c) => ({ code: c.code, name: c.en })),
  }
}

/** Serves `hasAnyCustomer`. */
export function pilotHasAnyCustomer(): boolean {
  return CUSTOMERS.length > 0
}

// --- the network — features/network/queries.ts ------------------------------

/**
 * The countries the reference screens and the form pickers list.
 *
 * Every country a `PORTS` entry, a customer or a partner names, and nothing
 * else. A picker holding two hundred countries is a picker nobody scrolls, and
 * the count on the reference screen has to agree with the list beside it.
 */
const COUNTRIES = [
  { code: 'KW', en: 'Kuwait', ar: 'الكويت' },
  { code: 'AE', en: 'United Arab Emirates', ar: 'الإمارات' },
  { code: 'SA', en: 'Saudi Arabia', ar: 'السعودية' },
  { code: 'CN', en: 'China', ar: 'الصين' },
  { code: 'IN', en: 'India', ar: 'الهند' },
  { code: 'NL', en: 'Netherlands', ar: 'هولندا' },
  { code: 'DE', en: 'Germany', ar: 'ألمانيا' },
  { code: 'TR', en: 'Türkiye', ar: 'تركيا' },
  { code: 'JP', en: 'Japan', ar: 'اليابان' },
  { code: 'FR', en: 'France', ar: 'فرنسا' },
  { code: 'CH', en: 'Switzerland', ar: 'سويسرا' },
  { code: 'DK', en: 'Denmark', ar: 'الدنمارك' },
] as const

function openJobsForPartner(key: PartnerKey): number {
  return JOB_SEEDS.filter(
    (job) =>
      OPEN_JOB_STATUSES.has(job.status) &&
      partnersFor(job).some((row) => row.partnerId === partnerId(key)),
  ).length
}

function partnerRow(seed: (typeof PARTNERS)[number]): PartnerRow {
  return {
    id: partnerId(seed.id),
    code: seed.code,
    type: seed.type,
    legalNameEn: seed.en,
    legalNameAr: seed.ar,
    countryCode: seed.country,
    currency: seed.currency,
    paymentTermsDays: seed.terms,
    scac: seed.scac,
    isActive: true,
    openJobs: openJobsForPartner(seed.id),
  }
}

/** Serves `listPartners`. */
export function pilotPartners(search?: string): PartnerRow[] {
  const term = search?.trim().toLowerCase()
  return PARTNERS.map(partnerRow)
    .filter(
      (row) =>
        !term ||
        row.legalNameEn.toLowerCase().includes(term) ||
        row.code.toLowerCase().includes(term),
    )
    .sort((a, b) => a.legalNameEn.localeCompare(b.legalNameEn))
}

/** Serves `partnerTypeCounts` — the filter strip, derived so it cannot drift. */
export function pilotPartnerTypeCounts(): { type: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of PARTNERS) counts.set(row.type, (counts.get(row.type) ?? 0) + 1)
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type))
}

/** Serves `listLocations`. `useCount` is the column that tells you which matter. */
export function pilotLocations(search?: string): LocationRow[] {
  const term = search?.trim().toLowerCase()
  return PORT_CODES.map((code): LocationRow => {
    const port = PORTS[code]
    return {
      id: locationId(code),
      unlocode: code,
      nameEn: port.en,
      nameAr: port.ar,
      countryCode: port.country,
      kind: port.kind,
      isActive: true,
      useCount: JOB_SEEDS.filter((job) => job.origin === code || job.destination === code).length,
    }
  })
    .filter(
      (row) =>
        !term ||
        row.nameEn.toLowerCase().includes(term) ||
        (row.unlocode ?? '').toLowerCase().includes(term),
    )
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
}

/** Serves `countNetwork`. */
export function pilotNetworkCounts(): { partners: number; locations: number } {
  return { partners: PARTNERS.length, locations: PORT_CODES.length }
}

/**
 * Serves `getPartnerDetail`.
 *
 * The shipments and the exception count are the reason this page is worth
 * having: a partner's value is not their details, it is which lanes they carry
 * and how often something goes wrong on one. The exception count assigns no
 * blame — it is the number that tells you which agent to have a conversation
 * with.
 */
export function pilotPartner(id: string, now = Date.now()): PartnerDetail | undefined {
  const seed = PARTNERS.find((p) => partnerId(p.id) === id)
  if (!seed) return undefined

  const onJobs = JOB_SEEDS.filter((job) => partnersFor(job).some((row) => row.partnerId === id))
  const open = onJobs.filter((job) => OPEN_JOB_STATUSES.has(job.status))
  const exceptions = pilotExceptions(now)
  const settlementCustomer =
    'settlementCustomer' in seed ? (seed.settlementCustomer as number) : null

  return {
    id,
    code: seed.code,
    type: seed.type,
    legalNameEn: seed.en,
    legalNameAr: seed.ar,
    countryCode: seed.country,
    currency: seed.currency,
    paymentTermsDays: seed.terms,
    scac: seed.scac,
    isActive: true,
    /*
      How far this partner's bills may drift from the accrual before somebody
      has to look — 0014, and read by `resolveTolerance` in core. The carriers
      are held tighter than the agents, which is the usual arrangement: a
      carrier's tariff is published and an agent's disbursements are not.
    */
    varianceTolerancePercent: seed.type === 'carrier' ? '1.000000' : '2.500000',
    varianceToleranceAbsolute: seed.type === 'carrier' ? '5.000000' : '15.000000',
    settlementCustomerId: settlementCustomer === null ? null : customerId(settlementCustomer),
    settlementCurrency: 'settlementCurrency' in seed ? (seed.settlementCurrency as string) : null,
    openJobs: open.length,
    totalJobs: onJobs.length,
    openExceptions: exceptions.filter((e) => onJobs.some((job) => `job-${job.seq}` === e.jobId))
      .length,
    contacts: [
      {
        id: `${id}-c1`,
        nameEn: seed.type === 'carrier' ? 'Bookings Desk' : 'Operations Desk',
        email: `ops@${seed.code.toLowerCase()}.example`,
        phone: '+965 2222 0000',
        role: 'operations',
      },
      {
        id: `${id}-c2`,
        nameEn: 'Accounts',
        email: `accounts@${seed.code.toLowerCase()}.example`,
        phone: null,
        role: 'finance',
      },
    ],
    jobs: open.map((job) => {
      const summary = jobSummary(job, now)
      return {
        id: summary.id,
        reference: summary.reference,
        status: summary.status,
        role: partnersFor(job).find((row) => row.partnerId === id)!.role,
        customerName: summary.customerName,
        lane: `${summary.originName} → ${summary.destinationName}`,
        eta: summary.eta,
      }
    }),
  }
}

/**
 * Serves `listPartnerCredentials` — FR-RT-10 and FR-MD-05.
 *
 * The superseded trade licence is returned rather than filtered, and that is
 * the point of the pair: what proves an agent was licensed on the day a
 * shipment moved is the certificate that was current *then*. The live
 * insurance certificate on the Shanghai agent expires in eleven days, which is
 * what the nightly compliance sweep exists to warn about.
 */
export function pilotPartnerCredentials(
  id: string,
  now = Date.now(),
): { coverage: PartnerCoverageRow[]; compliance: PartnerComplianceRow[] } {
  const seed = PARTNERS.find((p) => partnerId(p.id) === id)
  if (!seed) return { coverage: [], compliance: [] }

  const lanes = RATE_CARD_SEEDS.filter((card) => card.partner === seed.id)

  return {
    coverage: lanes.map((card, index) => ({
      id: `${id}-cov-${index}`,
      mode: card.mode,
      lane: `${PORTS[card.origin].en} → ${PORTS[card.destination].en}`,
      transitDays:
        JOB_SEEDS.find((job) => job.origin === card.origin && job.destination === card.destination)
          ?.transitDays ?? null,
      isActive: isLiveCard(card),
    })),
    compliance: [
      {
        id: `${id}-comp-1`,
        documentType: 'Trade Licence',
        reference: `TL-${seed.code}-2026`,
        issuedOn: day(now, -300),
        expiresOn: day(now, 65),
        supersededById: null,
        daysRemaining: 65,
      },
      {
        id: `${id}-comp-0`,
        documentType: 'Trade Licence',
        reference: `TL-${seed.code}-2025`,
        issuedOn: day(now, -665),
        expiresOn: day(now, -300),
        // Points forward at the renewal above; the old row stays.
        supersededById: `${id}-comp-1`,
        daysRemaining: -300,
      },
      {
        id: `${id}-comp-2`,
        documentType: 'Insurance Certificate',
        reference: `INS-${seed.code}-4471`,
        issuedOn: day(now, -354),
        expiresOn: day(now, 11),
        supersededById: null,
        daysRemaining: 11,
      },
    ],
  }
}

// --- the operations registers — features/operations/queries.ts --------------

/**
 * Exceptions closed in the last fortnight.
 *
 * `pilotExceptions` above is the open queue, and the dashboard's shape. The
 * register asks a wider question — it can be scoped to `closed` or `all` — and
 * a register that answered "nothing" to two of its three filters would look
 * broken rather than tidy. These also give the counts strip something to
 * count, and the closed pair is where `costImpact` earns its column: the
 * detention that was absorbed is the one worth remembering.
 */
const CLOSED_EXCEPTIONS = [
  {
    id: 'exc-c1',
    job: 1035,
    customer: 8,
    code: 'delay_vessel',
    nameEn: 'Vessel delay',
    nameAr: 'تأخير السفينة',
    severity: 'medium',
    openedAgo: 16,
    closedAgo: 13,
    owner: 3,
    description: 'Rotterdam sailing put back two days by berth congestion.',
    costImpact: null,
  },
  {
    id: 'exc-c2',
    job: 1038,
    customer: 5,
    code: 'doc_discrepancy',
    nameEn: 'Document discrepancy',
    nameAr: 'اختلاف في المستندات',
    severity: 'high',
    openedAgo: 11,
    closedAgo: 9,
    owner: 2,
    description: 'Packing list weight disagreed with the bill; amended at origin.',
    costImpact: '48.000',
  },
] as const

/**
 * Serves `listExceptions`, oldest first.
 *
 * Oldest rather than most severe, and the ordering is the point: the exception
 * nobody has looked at for four days is by definition the one the current
 * process missed. Severity is already visible as a colour.
 */
export function pilotExceptionRows(
  now = Date.now(),
  scope: 'open' | 'closed' | 'all' = 'open',
): ExceptionRow[] {
  const year = new Date(now).getFullYear()

  const open: ExceptionRow[] = pilotExceptions(now).map((view) => ({
    id: view.id,
    jobId: view.jobId,
    jobReference: view.jobReference,
    customerName: view.customerName,
    code: view.code,
    nameEn: view.nameEn,
    nameAr: view.nameAr,
    severity: view.severity,
    description: view.description,
    openedAt: view.openedAt,
    dueAt: view.dueAt,
    closedAt: null,
    owner: view.owner,
    costImpact: null,
    costCurrency: null,
  }))

  const closed: ExceptionRow[] = CLOSED_EXCEPTIONS.map((seed) => ({
    id: seed.id,
    jobId: `job-${seed.job}`,
    jobReference: `KWI-${year}-${String(seed.job).padStart(5, '0')}`,
    customerName: CUSTOMERS[seed.customer]!.en,
    code: seed.code,
    nameEn: seed.nameEn,
    nameAr: seed.nameAr,
    severity: seed.severity,
    description: seed.description,
    openedAt: at(now, -seed.openedAgo, 9),
    dueAt: at(now, -seed.openedAgo + 1, 17),
    closedAt: at(now, -seed.closedAgo, 14),
    owner: OWNERS[seed.owner]!,
    costImpact: seed.costImpact === null ? null : numeric(seed.costImpact),
    costCurrency: seed.costImpact === null ? null : 'KWD',
  }))

  const rows = scope === 'open' ? open : scope === 'closed' ? closed : [...open, ...closed]
  return rows.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
}

/** Serves `exceptionCounts`. */
export function pilotExceptionCounts(now = Date.now()): {
  open: number
  closed: number
  overdue: number
} {
  const open = pilotExceptionRows(now, 'open')
  return {
    open: open.length,
    closed: CLOSED_EXCEPTIONS.length,
    overdue: open.filter((row) => row.dueAt !== null && row.dueAt.getTime() < now).length,
  }
}

/**
 * Serves `listCustoms`, soonest SLA first.
 *
 * Derived entirely from the `customs` field on `JOB_SEEDS`, so the customs
 * board and the job board cannot disagree about which shipment is held. Job
 * `1041` is the seeded hold from Pilot §3.1 item 12 and its declaration is
 * past its SLA; `1036` is the physical inspection.
 *
 * Duty is 5% of an assessed value the fixture does not otherwise model, so it
 * is stated per job rather than computed — inventing a customs value to
 * multiply would be inventing a second, contradictory account of the cargo.
 */
const CUSTOMS_DUTY: Record<number, string> = {
  1041: '1420.500',
  1039: '318.750',
  1036: '842.000',
  1035: '206.250',
  1033: '96.000',
  1038: '54.500',
}

export function pilotCustomsRows(
  now = Date.now(),
  scope: 'live' | 'released' | 'all' = 'live',
): CustomsRow[] {
  const rows = JOB_SEEDS.filter((seed) => seed.customs !== undefined).map((seed): CustomsRow => {
    const summary = jobSummary(seed, now)
    const released = seed.customs === 'released'
    const home = branch(seed.branch)
    const isKuwait = seed.branch === 'KWI'

    return {
      id: `customs-${seed.seq}`,
      jobId: summary.id,
      jobReference: summary.reference,
      customerName: summary.customerName,
      status: seed.customs!,
      declarationType: seed.direction === 'import' ? 'import' : 'export',
      /*
          Null while the declaration has not been filed. The number comes back
          *from* the authority, so a shipment with documents outstanding
          legitimately has none — and a placeholder here would be the register
          claiming a filing that never happened.
        */
      declarationNo:
        seed.customs === 'documents_pending'
          ? null
          : `${isKuwait ? 'KW' : 'AE'}-${new Date(now).getFullYear()}-${String(seed.seq * 7).padStart(7, '0')}`,
      filedAt: seed.customs === 'documents_pending' ? null : at(now, seed.etaOffset + 1, 10),
      releasedAt: released ? at(now, seed.etaOffset + 3, 15) : null,
      slaDueAt: at(now, seed.etaOffset + 3, 12),
      inspectionRequired: seed.customs === 'inspection',
      dutyAmount: CUSTOMS_DUTY[seed.seq] ? numeric(CUSTOMS_DUTY[seed.seq]!) : null,
      dutyCurrency: CUSTOMS_DUTY[seed.seq] ? home.currency : null,
      brokerName: partner(isKuwait ? 'shamali' : 'gulfbridge').en,
    }
  })

  const scoped =
    scope === 'live'
      ? rows.filter((row) => row.releasedAt === null)
      : scope === 'released'
        ? rows.filter((row) => row.releasedAt !== null)
        : rows

  return scoped.sort((a, b) => (a.slaDueAt?.getTime() ?? 0) - (b.slaDueAt?.getTime() ?? 0))
}

/** Serves `customsCounts`. */
export function pilotCustomsCounts(now = Date.now()): {
  live: number
  released: number
  held: number
} {
  const all = pilotCustomsRows(now, 'all')
  return {
    live: all.filter((row) => row.releasedAt === null).length,
    released: all.filter((row) => row.releasedAt !== null).length,
    held: all.filter((row) => row.status === 'held').length,
  }
}

/**
 * Serves `listDocuments`, newest first.
 *
 * Built from the same `documentsFor` the job file uses, so a document on the
 * register opens a job that has it. Superseded versions are emitted as their
 * own rows rather than filtered out: a house bill that was reissued is exactly
 * the thing somebody needs to find when the customer is holding the old one,
 * and the register is the only place that question gets asked.
 */
export function pilotDocumentRows(now = Date.now()): DocumentRow[] {
  const rows = JOB_SEEDS.flatMap((seed) => {
    const summary = jobSummary(seed, now)
    const category = new Map<string, string>(DOCUMENT_TYPES.map(([code, , , cat]) => [code, cat]))

    return documentsFor(seed, now).flatMap((document, index): DocumentRow[] => {
      const base = {
        jobId: summary.id,
        jobReference: summary.reference,
        customerName: summary.customerName,
        typeCode: document.code,
        typeNameEn: document.nameEn,
        typeNameAr: document.nameAr,
        category: category.get(document.code) ?? 'transport',
        authorName: OWNERS[(seed.seq + index) % OWNERS.length]!,
        createdAt: at(now, -4 - index, 10),
      }

      const current: DocumentRow = {
        ...base,
        id: document.id,
        version: document.version,
        releasedAt: document.releasedAt,
        isSuperseded: false,
      }

      if (document.version === 1) return [current]

      // The reissued bill, and the version it replaced.
      return [
        current,
        {
          ...base,
          id: `${document.id}-v1`,
          version: 1,
          releasedAt: at(now, -9 - index, 10),
          createdAt: at(now, -9 - index, 10),
          isSuperseded: true,
        },
      ]
    })
  })

  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 200)
}

/** Serves `documentCounts`. */
export function pilotDocumentCounts(now = Date.now()): {
  total: number
  released: number
  draft: number
} {
  const rows = pilotDocumentRows(now)
  return {
    total: rows.length,
    released: rows.filter((row) => row.releasedAt !== null).length,
    draft: rows.filter((row) => row.releasedAt === null).length,
  }
}

// --- payables — features/payables/queries.ts --------------------------------

interface SupplierInvoiceSeed {
  readonly seq: number
  readonly partner: PartnerKey
  readonly reference: string
  readonly currency: string
  /** Transaction currency to the branch's base — KWD throughout here. */
  readonly fxRate: string
  readonly total: string
  readonly paid: string
  /** Days ago the bill is dated, and days from now it falls due. */
  readonly dated: number
  readonly due: number
  readonly status: string
  readonly lineCount: number
  readonly unmatchedCount: number
  /**
   * Billed minus accrued, in base currency. Positive means they billed over.
   *
   * Stated rather than derived because the accrual it is measured against
   * lives on `charge_lines`, which the pilot fixtures do not model — the job
   * file shows charges as a total, not as matched lines. The number is the one
   * the register scans for and the one the summary counts, so it is authored
   * here and the two read the same figure.
   */
  readonly varianceBase: string
}

/**
 * The supplier bills, and the argument about one of them.
 *
 * `8841` is the row this feature exists for: ONE has billed 96 KWD more than
 * the job accrued, because a general rate increase landed between booking and
 * invoice. It is above the carrier's 1% tolerance, so it sits in
 * `needingReview` and in the sidebar badge, and nothing about it is visible
 * from the total alone — which is exactly how that money is lost today.
 *
 * `8837` is the other half of the same story: a detention charge from the
 * Mumbai agent that nobody agreed to, disputed rather than approved, because
 * "why has this not been paid" and "this has not been paid yet" are different
 * answers and an ageing report that cannot tell them apart chases the wrong
 * agent.
 *
 * Every bill is bought by the Kuwait entity and carries its own rate back to
 * KWD, so the ageing below adds up like with like.
 */
const SUPPLIER_INVOICE_SEEDS: readonly SupplierInvoiceSeed[] = [
  {
    seq: 8841,
    partner: 'one',
    reference: 'ONE-KW-77120',
    currency: 'KWD',
    fxRate: '1',
    total: '1380.000',
    paid: '0',
    dated: 9,
    due: 21,
    status: 'received',
    lineCount: 5,
    unmatchedCount: 0,
    varianceBase: '96.000',
  },
  {
    seq: 8842,
    partner: 'everbright',
    reference: 'EBL-SH-4471',
    currency: 'USD',
    fxRate: '0.306000',
    total: '1850.00',
    paid: '0',
    dated: 5,
    due: 25,
    status: 'received',
    lineCount: 6,
    unmatchedCount: 2,
    varianceBase: '42.180',
  },
  // Past due and approved — the one the payables board leads with.
  {
    seq: 8840,
    partner: 'ktrans',
    reference: 'KTC-9903',
    currency: 'KWD',
    fxRate: '1',
    total: '165.000',
    paid: '0',
    dated: 12,
    due: -2,
    status: 'approved',
    lineCount: 2,
    unmatchedCount: 0,
    varianceBase: '0',
  },
  {
    seq: 8837,
    partner: 'mumbai',
    reference: 'MFS-2026-0338',
    currency: 'USD',
    fxRate: '0.306000',
    total: '980.00',
    paid: '0',
    dated: 24,
    due: 6,
    status: 'disputed',
    lineCount: 3,
    unmatchedCount: 1,
    varianceBase: '210.400',
  },
  {
    seq: 8843,
    partner: 'ek',
    reference: 'EK-CGO-55120',
    currency: 'AED',
    fxRate: '0.083500',
    total: '4180.00',
    paid: '2000.00',
    dated: 8,
    due: 22,
    status: 'part_paid',
    lineCount: 3,
    unmatchedCount: 0,
    varianceBase: '0',
  },
  {
    seq: 8838,
    partner: 'shamali',
    reference: 'ASH-2211',
    currency: 'KWD',
    fxRate: '1',
    total: '210.000',
    paid: '210.000',
    dated: 22,
    due: -7,
    status: 'paid',
    lineCount: 3,
    unmatchedCount: 0,
    varianceBase: '0',
  },
  {
    seq: 8835,
    partner: 'kpa',
    reference: 'KPA-INV-88231',
    currency: 'KWD',
    fxRate: '1',
    total: '96.000',
    paid: '96.000',
    dated: 30,
    due: -15,
    status: 'paid',
    lineCount: 1,
    unmatchedCount: 0,
    varianceBase: '0',
  },
]

const OPEN_BILL_STATUSES = ['received', 'approved', 'part_paid']

/** Serves `listSupplierInvoices`. Void bills are excluded unless asked for. */
export function pilotSupplierInvoices(
  now = Date.now(),
  filters: { readonly status?: string; readonly partnerId?: string } = {},
): SupplierInvoiceRow[] {
  return [...SUPPLIER_INVOICE_SEEDS]
    .sort((a, b) => a.dated - b.dated)
    .filter((seed) => (filters.status ? seed.status === filters.status : seed.status !== 'void'))
    .filter((seed) => !filters.partnerId || partnerId(seed.partner) === filters.partnerId)
    .map((seed): SupplierInvoiceRow => ({
      id: `sup-${seed.seq}`,
      reference: seed.reference,
      partnerId: partnerId(seed.partner),
      partnerName: partner(seed.partner).en,
      status: seed.status,
      currency: seed.currency,
      total: numeric(seed.total),
      amountPaid: numeric(seed.paid),
      invoiceDate: day(now, -seed.dated),
      dueOn: day(now, seed.due),
      baseCurrency: branch('KWI').currency,
      varianceBase: numeric(seed.varianceBase),
      lineCount: seed.lineCount,
      unmatchedCount: seed.unmatchedCount,
    }))
}

/**
 * Serves `payablesSummary`.
 *
 * `needingReview` is the count that earns its place at the top of the screen:
 * bills whose lines disagree with the accrual at all. Put anywhere else it
 * gets looked at monthly rather than daily.
 */
export function pilotPayablesSummary(): PayablesSummary {
  const open = SUPPLIER_INVOICE_SEEDS.filter((s) => OPEN_BILL_STATUSES.includes(s.status))
  return {
    outstanding: open.length,
    overdue: open.filter((s) => s.due < 0).length,
    awaitingApproval: SUPPLIER_INVOICE_SEEDS.filter((s) => s.status === 'received').length,
    inDispute: SUPPLIER_INVOICE_SEEDS.filter((s) => s.status === 'disputed').length,
    needingReview: SUPPLIER_INVOICE_SEEDS.filter(
      (s) => ['received', 'approved'].includes(s.status) && !new D(s.varianceBase).isZero(),
    ).length,
  }
}

/**
 * Serves `payablesAgeing` — the items, before `ageItems` buckets them.
 *
 * Stops at the rows on purpose. The real query selects `(total - paid) *
 * fx_rate` and a due date and hands both to `core`; a fixture that returned a
 * finished `Ageing` would be demonstrating arithmetic the product does not
 * run. The branch calls `ageItems(pilotPayableAgeing(), 'KWD', asOf)`, which is
 * the same call on the same shape.
 */
export function pilotPayableAgeing(now = Date.now()): AgeableBill[] {
  return SUPPLIER_INVOICE_SEEDS.filter((s) => OPEN_BILL_STATUSES.includes(s.status)).map(
    (seed): AgeableBill => ({
      outstanding: numeric(new D(seed.total).minus(new D(seed.paid)).times(new D(seed.fxRate))),
      dueOn: new Date(Date.parse(day(now, seed.due))),
    }),
  )
}

/** Serves `listSupplierPayments`. */
export function pilotSupplierPayments(now = Date.now()): SupplierPaymentRow[] {
  return [
    {
      seq: 514,
      partner: 'ek' as PartnerKey,
      amount: '2000.00',
      currency: 'AED',
      paid: 6,
      reference: 'NBK-OUT-3402',
    },
    {
      seq: 512,
      partner: 'shamali' as PartnerKey,
      amount: '210.000',
      currency: 'KWD',
      paid: 20,
      reference: 'NBK-OUT-3391',
    },
    {
      seq: 513,
      partner: 'kpa' as PartnerKey,
      amount: '96.000',
      currency: 'KWD',
      paid: 28,
      reference: 'NBK-OUT-3288',
    },
  ].map((seed): SupplierPaymentRow => ({
    id: `suppay-${seed.seq}`,
    partnerId: partnerId(seed.partner),
    partnerName: partner(seed.partner).en,
    amount: numeric(seed.amount),
    currency: seed.currency,
    paidOn: day(now, -seed.paid),
    method: 'bank_transfer',
    reference: seed.reference,
    // Every outgoing payment here is fully allocated: we know what we paid for.
    allocated: numeric(seed.amount),
  }))
}

/** Serves `listPayableInvoices` — the allocation form's picker. */
export function pilotPayableInvoices(
  id: string,
): { readonly id: string; readonly reference: string; readonly outstanding: string }[] {
  return (
    SUPPLIER_INVOICE_SEEDS.filter(
      (seed) =>
        partnerId(seed.partner) === id &&
        ['approved', 'part_paid'].includes(seed.status) &&
        new D(seed.total).greaterThan(new D(seed.paid)),
    )
      // Soonest due first: the form is filled in the order the money is owed.
      .sort((a, b) => a.due - b.due)
      .map((seed) => ({
        id: `sup-${seed.seq}`,
        reference: seed.reference,
        outstanding: numeric(new D(seed.total).minus(new D(seed.paid))),
      }))
  )
}

// --- the agent current account — features/payables/queries.ts ---------------

/**
 * Monthly set-offs with the two agents we also bill.
 *
 * `agreed` is the state the whole thing turns on: up to it the figures move as
 * documents land in the period, past it they are frozen because both sides
 * have signed the same statement. So the board shows one of each — a draft
 * still moving, one agreed and awaiting the residual, one settled and closed.
 *
 * Each settlement is in the partner's own settlement currency, which is why
 * `listSettleablePartners` returns one too: netting a dollar payable against a
 * dinar receivable is not netting.
 */
const SETTLEMENT_SEEDS = [
  {
    seq: 119,
    partner: 'everbright' as PartnerKey,
    branch: 'KWI' as BranchCode,
    currency: 'USD',
    from: 30,
    to: 1,
    receivable: '3150.00',
    payable: '5240.00',
    status: 'draft',
    agreed: null,
    settled: null,
  },
  {
    seq: 118,
    partner: 'gac' as PartnerKey,
    branch: 'DXB' as BranchCode,
    currency: 'AED',
    from: 60,
    to: 31,
    receivable: '8800.00',
    payable: '6250.00',
    status: 'agreed',
    agreed: 28,
    settled: null,
  },
  {
    seq: 117,
    partner: 'everbright' as PartnerKey,
    branch: 'KWI' as BranchCode,
    currency: 'USD',
    from: 91,
    to: 61,
    receivable: '4200.00',
    payable: '6810.00',
    status: 'settled',
    agreed: 55,
    settled: 50,
  },
] as const

/** Serves `listSettlements`, newest period first. */
export function pilotSettlements(
  now = Date.now(),
  filters: { readonly partnerId?: string; readonly status?: string } = {},
): SettlementRow[] {
  const year = new Date(now).getFullYear()

  /*
    The `<> 'void'` default is the query's, kept even though no seed is void:
    the guard is what the branch has to reproduce, and a fixture that dropped
    it would pass until the first voided set-off existed.
  */
  return (
    SETTLEMENT_SEEDS.filter((seed) =>
      filters.status ? seed.status === filters.status : (seed.status as string) !== 'void',
    )
      .filter((seed) => !filters.partnerId || partnerId(seed.partner) === filters.partnerId)
      .map((seed): SettlementRow => {
        const receivable = new D(seed.receivable)
        const payable = new D(seed.payable)
        /*
        The offset is the smaller of the two sides and the residual is what is
        left — `settlement.ts`'s arithmetic, restated here rather than
        hard-coded, so a figure edited above cannot leave the pair inconsistent.
      */
        const offset = receivable.lessThan(payable) ? receivable : payable
        const residual = receivable.minus(payable)

        return {
          id: `settle-${seed.seq}`,
          reference: `SET-${seed.branch}-${year}-${String(seed.seq).padStart(4, '0')}`,
          partnerId: partnerId(seed.partner),
          partnerName: partner(seed.partner).en,
          status: seed.status,
          currency: seed.currency,
          periodFrom: day(now, -seed.from),
          periodTo: day(now, -seed.to),
          receivableTotal: numeric(receivable),
          payableTotal: numeric(payable),
          offsetAmount: numeric(offset),
          residualAmount: numeric(residual.abs()),
          /*
          The enum's own three values, not a description of them.

          This said `'payable' | 'receivable'`, which reads correctly and is
          not what `settlementDirectionEnum` holds — the screen renders it as
          `t(\`directions.${residualDirection}\`)`, so every settlement row
          threw `MISSING_MESSAGE: Could not resolve settlements.directions.payable`
          instead of showing a side. It typechecked because the field was typed
          `string`; that is now the enum, so the next one fails at compile time.
        */
          residualDirection: residual.isZero()
            ? 'square'
            : residual.isNegative()
              ? 'we_owe_them'
              : 'they_owe_us',
          agreedAt: seed.agreed === null ? null : at(now, -seed.agreed, 16),
          settledAt: seed.settled === null ? null : at(now, -seed.settled, 11),
        }
      })
      // Latest period first, which is the query's `order by period_to desc`.
      .sort((a, b) => b.periodTo.localeCompare(a.periodTo))
  )
}

/** Serves `listSettleablePartners` — those with a current account configured. */
export function pilotSettleablePartners(): {
  readonly id: string
  readonly name: string
  readonly currency: string
}[] {
  return PARTNERS.filter((p) => 'settlementCustomer' in p)
    .map((p) => ({
      id: partnerId(p.id),
      name: p.en,
      currency: ('settlementCurrency' in p ? (p.settlementCurrency as string) : null) ?? p.currency,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// --- consolidation — features/consolidation/queries.ts ----------------------

/**
 * The masters, each on a lane and a sailing the board already runs.
 *
 * `441` is the Istanbul groupage job `1047` is a house of — same lane, same
 * ETA, same fourteen-day transit — and it carries two master costs nobody has
 * split across the houses yet, which is the number the register exists to
 * surface. `438` is the closed Nhava Sheva master behind job `1038`.
 *
 * The house count, the cargo totals and the unsplit-cost count are *not* here.
 * `getConsolidation` reduces them out of the houses and charges it loads, so
 * stating them beside the master would be a second copy of a figure the master
 * file recomputes — and the first time one was edited the register and the
 * page would disagree about how big the same sailing is. They come from
 * `CONSOLIDATION_HOUSE_SEEDS` and `CONSOL_CHARGE_SEEDS` instead, which is the
 * same pair of lists the detail page reads.
 */
const CONSOLIDATION_SEEDS = [
  {
    seq: 441,
    branch: 'KWI' as BranchCode,
    status: 'open' as const,
    mode: 'sea_lcl',
    tradeDirection: 'import',
    origin: 'TRIST' as PortCode,
    destination: 'KWSWK' as PortCode,
    master: 'ONEYISTKWI4410',
    vessel: 'AL SALAM',
    voyage: '014W',
    flight: null,
    etd: -11,
    eta: 3,
  },
  {
    seq: 438,
    branch: 'KWI' as BranchCode,
    status: 'closed' as const,
    mode: 'sea_lcl',
    tradeDirection: 'import',
    origin: 'INNSA' as PortCode,
    destination: 'KWSWK' as PortCode,
    master: 'ONEYNSAKWI3880',
    vessel: 'GULF TRADER',
    voyage: '021W',
    flight: null,
    etd: -18,
    eta: -8,
  },
  {
    seq: 442,
    branch: 'KWI' as BranchCode,
    status: 'open' as const,
    mode: 'air',
    tradeDirection: 'export',
    origin: 'KWKWI' as PortCode,
    destination: 'TRIST' as PortCode,
    master: '176-44120033',
    vessel: null,
    voyage: null,
    flight: 'EK 899',
    etd: 3,
    eta: 4,
  },
] as const

/** Serves `listConsolidations`, latest sailing first. */
export function pilotConsolidations(
  now = Date.now(),
  filters: { readonly status?: string } = {},
): ConsolidationSummary[] {
  const year = new Date(now).getFullYear()

  // As with settlements: the default excludes cancelled, which nothing here is.
  return CONSOLIDATION_SEEDS.filter((seed) =>
    filters.status ? seed.status === filters.status : (seed.status as string) !== 'cancelled',
  )
    .map((seed): ConsolidationSummary => {
      const houses = consolidationHouses(seed.seq, now)
      return {
        id: `consol-${seed.seq}`,
        reference: `CNS-${seed.branch}-${year}-${String(seed.seq).padStart(4, '0')}`,
        status: seed.status,
        mode: seed.mode,
        tradeDirection: seed.tradeDirection,
        masterBillNumber: seed.master,
        vesselName: seed.vessel,
        voyageNumber: seed.voyage,
        flightNumber: seed.flight,
        originName: PORTS[seed.origin].en,
        destinationName: PORTS[seed.destination].en,
        etd: at(now, seed.etd, 6),
        eta: at(now, seed.eta, 14),
        /*
        Reduced out of the houses, exactly as `getConsolidation` reduces them.

        The register and the master file are two readings of one list, and the
        house count is the figure a reader carries from one to the other.
      */
        houseCount: houses.length,
        volumeCbm: sum(houses.map((house) => house.volumeCbm)),
        grossWeightKg: sum(houses.map((house) => house.grossWeightKg)),
        unallocatedCount: consolidationUnallocated(seed.seq),
      }
    })
    .sort((a, b) => (b.etd?.getTime() ?? 0) - (a.etd?.getTime() ?? 0))
}

/**
 * Serves `consolidationCandidates` — the shipments, before `clusterShipments`.
 *
 * Stops at the rows for the same reason `pilotPayableAgeing` does: the
 * clustering is the thing being demonstrated, it is pure, and it runs
 * identically in both modes. The filters are the query's — loose LCL and air
 * only, nothing already consolidated, nothing closed or cancelled, and nothing
 * with neither a volume nor a weight to add up.
 */
export function pilotGroupableShipments(now = Date.now()): GroupableShipmentRow[] {
  return JOB_SEEDS.filter(
    (seed) =>
      (seed.mode === 'sea_lcl' || seed.mode === 'air') &&
      seed.status !== 'cancelled' &&
      seed.status !== 'closed',
  ).map((seed): GroupableShipmentRow => {
    const summary = jobSummary(seed, now)
    const detail = jobDetail(seed, now)
    return {
      jobId: summary.id,
      reference: summary.reference,
      branchId: branch(seed.branch).id,
      customerId: customerId(seed.customer),
      customerName: summary.customerName,
      mode: seed.mode,
      originId: locationId(seed.origin),
      destinationId: locationId(seed.destination),
      originName: summary.originName,
      destinationName: summary.destinationName,
      readyOn: summary.etd,
      volumeCbm: detail.volumeCbm,
      grossWeightKg: detail.grossWeightKg,
      pieces: detail.pieces,
    }
  })
}

// --- people and branches — features/admin/queries.ts ------------------------

/**
 * The seven roles the product ships with, and how many permissions each holds.
 *
 * The counts are stated rather than derived: the permission matrix lives in
 * `core/states.ts` and `ADMIN_PERMISSIONS`, and walking it here would put a
 * second, drifting copy of the answer in a fixture. What the screen needs from
 * this column is the shape of the ladder — an administrator holds everything,
 * a read-only account holds the reads — and that is what these say.
 */
const ROLES = [
  {
    key: 'administrator',
    en: 'Administrator',
    ar: 'مسؤول النظام',
    twoFactor: true,
    permissions: 74,
  },
  { key: 'coordinator', en: 'Coordinator', ar: 'منسق', twoFactor: false, permissions: 31 },
  {
    key: 'customs_broker',
    en: 'Customs Broker',
    ar: 'مخلص جمركي',
    twoFactor: false,
    permissions: 14,
  },
  { key: 'finance', en: 'Finance', ar: 'المالية', twoFactor: true, permissions: 38 },
  {
    key: 'operations_manager',
    en: 'Operations Manager',
    ar: 'مدير العمليات',
    twoFactor: false,
    permissions: 52,
  },
  { key: 'read_only', en: 'Read Only', ar: 'اطلاع فقط', twoFactor: false, permissions: 22 },
  { key: 'sales', en: 'Sales', ar: 'المبيعات', twoFactor: false, permissions: 26 },
] as const

/**
 * The people, and the branches they hold a role in.
 *
 * The first five are `OWNERS`, in order, so a job owned by Fahad Al-Rashid on
 * the board resolves to a person on this register. Two accounts are here for
 * states the screen has to be able to draw and a healthy team would not
 * volunteer: one invited and never signed in — `hasLogin` false, which is what
 * FR-ID-07's invitation-only model produces — and one suspended, which is the
 * only thing `SuspendUserDialog` can be demonstrated against.
 */
const PEOPLE = [
  {
    en: 'Fahad Al-Rashid',
    ar: 'فهد الرشيد',
    email: 'fahad.alrashid',
    roles: [['KWI', 'operations_manager']],
    lastSeen: 1,
    active: true,
    hasLogin: true,
  },
  {
    en: 'Maryam Al-Otaibi',
    ar: 'مريم العتيبي',
    email: 'maryam.alotaibi',
    roles: [['KWI', 'coordinator']],
    lastSeen: 3,
    active: true,
    hasLogin: true,
  },
  {
    en: 'Yousef Haddad',
    ar: 'يوسف حداد',
    email: 'yousef.haddad',
    roles: [
      ['KWI', 'coordinator'],
      ['DXB', 'coordinator'],
    ],
    lastSeen: 6,
    active: true,
    hasLogin: true,
  },
  {
    en: 'Noura Al-Sabah',
    ar: 'نورة الصباح',
    email: 'noura.alsabah',
    roles: [['KWI', 'finance']],
    lastSeen: 2,
    active: true,
    hasLogin: true,
  },
  {
    en: 'Rajesh Menon',
    ar: 'راجيش مينون',
    email: 'rajesh.menon',
    roles: [['DXB', 'operations_manager']],
    lastSeen: 9,
    active: true,
    hasLogin: true,
  },
  {
    en: 'Abdullah Al-Qabandi',
    ar: 'عبدالله القبندي',
    email: 'abdullah.alqabandi',
    roles: [
      ['KWI', 'administrator'],
      ['DXB', 'administrator'],
    ],
    lastSeen: 26,
    active: true,
    hasLogin: true,
  },
  {
    en: 'Hessa Al-Failakawi',
    ar: 'حصة الفيلكاوي',
    email: 'hessa.alfailakawi',
    roles: [['KWI', 'sales']],
    lastSeen: null,
    active: true,
    hasLogin: false,
  },
  {
    en: 'Tareq Bourisly',
    ar: 'طارق بورسلي',
    email: 'tareq.bourisly',
    roles: [['KWI', 'read_only']],
    lastSeen: 900,
    active: false,
    hasLogin: true,
  },
] as const

/** Serves `listUsers`, alphabetical. */
export function pilotUsers(now = Date.now()): UserRow[] {
  return PEOPLE.map((person, index): UserRow => ({
    id: `person-${String(index).padStart(2, '0')}`,
    nameEn: person.en,
    nameAr: person.ar,
    email: `${person.email}@alqabandi.com`,
    type: 'internal',
    locale: index % 3 === 0 ? 'ar' : 'en',
    isActive: person.active,
    lastSeenAt: person.lastSeen === null ? null : hours(now, -person.lastSeen),
    hasLogin: person.hasLogin,
    assignments: person.roles.map(([branchCode, roleKey]) => ({
      branchCode,
      roleKey,
      requiresTwoFactor: ROLES.find((role) => role.key === roleKey)?.twoFactor ?? false,
    })),
  })).sort((a, b) => a.nameEn.localeCompare(b.nameEn))
}

/** Serves `listRoles` — the permission matrix as the interface renders it. */
export function pilotRoles(): RoleRow[] {
  return ROLES.map((role) => ({
    key: role.key,
    nameEn: role.en,
    nameAr: role.ar,
    requiresTwoFactor: role.twoFactor,
    permissions: role.permissions,
  }))
}

/**
 * Serves `listBranches`.
 *
 * Wide because a branch *is* the legal entity: its own currency, its own
 * invoice series, its own trading conditions and its own six account codes. A
 * screen that showed only the code and the name would be hiding everything
 * that makes the second branch a second company.
 */
export function pilotBranches(): BranchRow[] {
  return BRANCHES.map((home): BranchRow => {
    const isKuwait = home.code === 'KWI'
    return {
      id: home.id,
      code: home.code,
      legalNameEn: home.en,
      legalNameAr: home.ar,
      country: home.country,
      baseCurrency: home.currency,
      timeZone: home.timeZone,
      mailFrom: `${home.code.toLowerCase()}@alqabandi.com`,
      /*
        Quiet hours on in Kuwait and off in Dubai — the same switch set two
        ways, because it is per entity and this is the only screen that shows
        that. `22:00` to `07:00` local, which is what `channelDecision` defers
        a customer notification against.
      */
      quietHoursEnabled: isKuwait,
      quietHoursFromHour: 22,
      quietHoursToHour: 7,
      invoiceSeries: home.code,
      invoiceSeriesNext: isKuwait ? 4120 : 2055,
      taxRegistration: isKuwait ? null : '100412233900003',
      houseBillSeries: `AQP${home.code}`,
      arAccountCode: '1200',
      apAccountCode: '2100',
      taxAccountCode: isKuwait ? null : '2200',
      bankAccountCode: '1010',
      fxVarianceAccountCode: '7800',
      roundingAccountCode: '7810',
      tradingConditionsEn: 'All business undertaken subject to our Standard Trading Conditions.',
      tradingConditionsAr: 'تخضع جميع الأعمال لشروط التعامل القياسية الخاصة بنا.',
      billOfLadingTermsEn: 'Received in apparent good order and condition unless otherwise noted.',
      billOfLadingTermsAr: 'استُلمت بحالة ظاهرية جيدة ما لم يُذكر خلاف ذلك.',
      defaultExclusionsEn: 'Duty, taxes, demurrage, detention and storage are excluded.',
      defaultExclusionsAr: 'الرسوم الجمركية والضرائب والأرضيات ورسوم التأخير والتخزين غير مشمولة.',
      isActive: true,
      calendarId: `cal-${home.calendar}`,
      calendarName: isKuwait ? 'Kuwait' : 'United Arab Emirates',
      people: PEOPLE.filter((p) => p.roles.some(([code]) => code === home.code)).length,
      openJobs: JOB_SEEDS.filter(
        (job) => job.branch === home.code && OPEN_JOB_STATUSES.has(job.status),
      ).length,
    }
  })
}

// --- reference data — features/admin/queries.ts -----------------------------

const CALENDARS = [
  {
    key: 'kuwait',
    en: 'Kuwait',
    ar: 'الكويت',
    timeZone: 'Asia/Kuwait',
    weekend: [5, 6],
    start: 480,
    end: 1020,
    holidays: 9,
  },
  {
    key: 'uae',
    en: 'United Arab Emirates',
    ar: 'الإمارات',
    timeZone: 'Asia/Dubai',
    weekend: [6, 0],
    start: 540,
    end: 1080,
    holidays: 11,
  },
  {
    key: 'saudi',
    en: 'Saudi Arabia',
    ar: 'السعودية',
    timeZone: 'Asia/Riyadh',
    weekend: [5, 6],
    start: 480,
    end: 1020,
    holidays: 6,
  },
] as const

const INCOTERM_ROWS = [
  { code: 'EXW', en: 'Ex Works' },
  { code: 'FCA', en: 'Free Carrier' },
  { code: 'FAS', en: 'Free Alongside Ship' },
  { code: 'FOB', en: 'Free on Board' },
  { code: 'CFR', en: 'Cost and Freight' },
  { code: 'CIF', en: 'Cost, Insurance and Freight' },
  { code: 'CPT', en: 'Carriage Paid To' },
  { code: 'CIP', en: 'Carriage and Insurance Paid To' },
  { code: 'DAP', en: 'Delivered at Place' },
  { code: 'DPU', en: 'Delivered at Place Unloaded' },
  { code: 'DDP', en: 'Delivered Duty Paid' },
] as const

const CONTAINER_TYPE_ROWS = [
  { code: '20GP', en: "20' General Purpose", teu: '1' },
  { code: '40GP', en: "40' General Purpose", teu: '2' },
  { code: '40HC', en: "40' High Cube", teu: '2' },
  { code: '20RF', en: "20' Reefer", teu: '1' },
  { code: '40RF', en: "40' Reefer", teu: '2' },
  { code: '20FR', en: "20' Flat Rack", teu: '1' },
  { code: '40OT', en: "40' Open Top", teu: '2' },
] as const

const EXCEPTION_CODE_ROWS = [
  {
    code: 'customs_hold',
    en: 'Customs hold',
    ar: 'احتجاز جمركي',
    severity: 'critical',
    slaHours: 8,
  },
  {
    code: 'customs_inspection',
    en: 'Customs inspection',
    ar: 'تفتيش جمركي',
    severity: 'high',
    slaHours: 24,
  },
  { code: 'damage', en: 'Cargo damage', ar: 'تلف البضاعة', severity: 'high', slaHours: 4 },
  {
    code: 'delay_vessel',
    en: 'Vessel delay',
    ar: 'تأخير السفينة',
    severity: 'medium',
    slaHours: 24,
  },
  {
    code: 'doc_discrepancy',
    en: 'Document discrepancy',
    ar: 'اختلاف في المستندات',
    severity: 'medium',
    slaHours: 8,
  },
  {
    code: 'docs_missing',
    en: 'Documents outstanding',
    ar: 'مستندات ناقصة',
    severity: 'medium',
    slaHours: 4,
  },
  {
    code: 'free_time_expiry',
    en: 'Free time expiring',
    ar: 'انتهاء وقت السماح',
    severity: 'high',
    slaHours: 8,
  },
  { code: 'shortage', en: 'Shortage', ar: 'نقص في الكمية', severity: 'high', slaHours: 4 },
] as const

const CURRENCY_ROWS = [
  { code: 'KWD', en: 'Kuwaiti Dinar' },
  { code: 'AED', en: 'UAE Dirham' },
  { code: 'SAR', en: 'Saudi Riyal' },
  { code: 'USD', en: 'US Dollar' },
  { code: 'EUR', en: 'Euro' },
  { code: 'GBP', en: 'Pound Sterling' },
  { code: 'INR', en: 'Indian Rupee' },
  { code: 'CNY', en: 'Chinese Yuan' },
] as const

const COMMODITY_ROWS = [
  { code: 'STEEL', en: 'Steel coils and sections', ar: 'لفائف ومقاطع حديدية', hs: '7208' },
  { code: 'FOOD', en: 'Foodstuffs, ambient', ar: 'مواد غذائية', hs: '2106' },
  { code: 'ELEC', en: 'Consumer electronics', ar: 'إلكترونيات استهلاكية', hs: '8517' },
  { code: 'BLDG', en: 'Building materials', ar: 'مواد بناء', hs: '6810' },
  { code: 'AUTO', en: 'Vehicle parts', ar: 'قطع غيار مركبات', hs: '8708' },
  { code: 'CHEM', en: 'Petrochemicals, non-hazardous', ar: 'بتروكيماويات غير خطرة', hs: '3901' },
  { code: 'CABLE', en: 'Electrical cable', ar: 'كابلات كهربائية', hs: '8544' },
  { code: 'GEN', en: 'General cargo', ar: 'بضائع عامة', hs: '9999' },
] as const

/**
 * The charge catalogue — FR-RT-05's accessorials.
 *
 * Two rows carry no account codes, and they are there to be found. The
 * accounting export refuses to run against an unmapped charge type, and
 * burying that in the export's error message means finding it twelve times
 * instead of once — which is why the reference screen shows the column at all.
 */
const CHARGE_TYPE_ROWS = [
  {
    key: 'ocean_freight',
    en: 'Ocean Freight',
    ar: 'أجرة الشحن البحري',
    basis: 'per_container',
    category: 'freight',
    revenue: '4100',
    cost: '5100',
  },
  {
    key: 'air_freight',
    en: 'Air Freight',
    ar: 'أجرة الشحن الجوي',
    basis: 'per_kg',
    category: 'freight',
    revenue: '4110',
    cost: '5110',
  },
  {
    key: 'thc_origin',
    en: 'Terminal Handling — Origin',
    ar: 'مناولة المحطة - المنشأ',
    basis: 'per_container',
    category: 'origin',
    revenue: '4200',
    cost: '5200',
  },
  {
    key: 'thc_destination',
    en: 'Terminal Handling — Destination',
    ar: 'مناولة المحطة - الوجهة',
    basis: 'per_container',
    category: 'destination',
    revenue: '4210',
    cost: '5210',
  },
  {
    key: 'documentation',
    en: 'Documentation',
    ar: 'رسوم المستندات',
    basis: 'flat',
    category: 'origin',
    revenue: '4300',
    cost: '5300',
  },
  {
    key: 'customs_clearance',
    en: 'Customs Clearance',
    ar: 'التخليص الجمركي',
    basis: 'flat',
    category: 'destination',
    revenue: '4310',
    cost: '5310',
  },
  {
    key: 'delivery_order',
    en: 'Delivery Order',
    ar: 'إذن التسليم',
    basis: 'flat',
    category: 'destination',
    revenue: '4320',
    cost: '5320',
  },
  {
    key: 'haulage',
    en: 'Haulage',
    ar: 'النقل الداخلي',
    basis: 'per_container',
    category: 'destination',
    revenue: '4400',
    cost: '5400',
  },
  {
    key: 'demurrage',
    en: 'Demurrage',
    ar: 'أرضيات',
    basis: 'per_day',
    category: 'other',
    revenue: '4500',
    cost: '5500',
  },
  {
    key: 'detention',
    en: 'Detention',
    ar: 'رسوم التأخير',
    basis: 'per_day',
    category: 'other',
    revenue: '4510',
    cost: '5510',
  },
  {
    key: 'storage',
    en: 'Storage',
    ar: 'رسوم التخزين',
    basis: 'per_day',
    category: 'other',
    revenue: null,
    cost: null,
  },
  {
    key: 'inspection',
    en: 'Inspection',
    ar: 'الفحص',
    basis: 'flat',
    category: 'destination',
    revenue: null,
    cost: null,
  },
] as const

/** Serves `listChargeTypes`. The array's order is `sort_order`. */
export function pilotChargeTypes(): ChargeTypeRow[] {
  return CHARGE_TYPE_ROWS.map((row) => ({
    id: `charge-${row.key}`,
    key: row.key,
    nameEn: row.en,
    nameAr: row.ar,
    category: row.category,
    basis: row.basis,
    revenueAccountCode: row.revenue,
    costAccountCode: row.cost,
  }))
}

/**
 * Serves `listMilestoneTemplates` — the plan a job of each shape is booked
 * with (FR-JB-02).
 *
 * Expanded from `TEMPLATES` above rather than restated, so the register and
 * the milestone bar on a job file are two readings of one list. The LCL rows
 * reuse the sea import plan because they *are* the sea import plan: the
 * paperwork does not change with the container count.
 */
const TEMPLATE_SHAPES: readonly (readonly [keyof typeof TEMPLATES, Mode, 'import' | 'export'])[] = [
  ['sea_import', 'sea_fcl', 'import'],
  ['sea_import', 'sea_lcl', 'import'],
  ['sea_export', 'sea_fcl', 'export'],
  ['air_export', 'air', 'export'],
]

export function pilotMilestoneTemplates(): MilestoneTemplateRow[] {
  return TEMPLATE_SHAPES.flatMap(([template, mode, direction]) =>
    TEMPLATES[template]!.map(([code, nameEn, nameAr], index): MilestoneTemplateRow => ({
      id: `mt-${mode}-${direction}-${code}`,
      mode,
      direction,
      seq: (index + 1) * 10,
      code,
      nameEn,
      nameAr,
      ownerRole: code === 'customs_cleared' ? 'customs_broker' : 'coordinator',
      plannedOffsetDays: null,
      /*
        The empty return is ours, not the customer's. `pilotTracking` already
        filters it out of the public page; this is the row that says why, so
        the two are one decision rather than two.
      */
      customerVisible: code !== 'empty_returned',
      isActive: true,
    })),
  )
}

/** Serves `listCalendars` — NFR-03's working weeks. */
export function pilotCalendars(): CalendarRow[] {
  return CALENDARS.map((cal) => ({
    id: `cal-${cal.key}`,
    key: cal.key,
    nameEn: cal.en,
    nameAr: cal.ar,
    timeZone: cal.timeZone,
    weekend: [...cal.weekend],
    dayStartMinute: cal.start,
    dayEndMinute: cal.end,
    isActive: true,
    holidays: cal.holidays,
  }))
}

/** Serves `listCalendarOptions` — the branch form's picker. */
export function pilotCalendarOptions(): { value: string; label: string }[] {
  return CALENDARS.map((cal) => ({ value: `cal-${cal.key}`, label: cal.en })).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

/**
 * Serves `listDutyRates` — the tariff, longest prefix first.
 *
 * The order is the order `findRate` matches in, so an operator looking for
 * "which line will catch 8703.23" scans down and stops at the first prefix it
 * starts with. The zero-rated dairy line and the 100% tobacco line are both
 * real Kuwaiti positions and both matter: a tariff where every row says 5%
 * teaches nobody how the screen behaves.
 */
const DUTY_ROWS = [
  {
    country: 'KW',
    hs: '870323',
    rate: '5.000',
    en: 'Motor cars, 1500–3000 cc',
    ar: 'سيارات ركوب ١٥٠٠-٣٠٠٠ سي سي',
  },
  { country: 'KW', hs: '2402', rate: '100.000', en: 'Tobacco products', ar: 'منتجات التبغ' },
  {
    country: 'KW',
    hs: '7208',
    rate: '5.000',
    en: 'Flat-rolled iron and steel',
    ar: 'حديد وصلب مسطح',
  },
  {
    country: 'KW',
    hs: '0402',
    rate: '0.000',
    en: 'Milk and cream, concentrated',
    ar: 'حليب وقشدة مركزة',
  },
  {
    country: 'KW',
    hs: '85',
    rate: '5.000',
    en: 'Electrical machinery and equipment',
    ar: 'آلات ومعدات كهربائية',
  },
  {
    country: 'AE',
    hs: '8517',
    rate: '5.000',
    en: 'Telephone sets and network apparatus',
    ar: 'أجهزة هاتف وشبكات',
  },
] as const

export function pilotDutyRates(now = Date.now()): DutyRateRow[] {
  return [...DUTY_ROWS]
    .sort(
      (a, b) =>
        a.country.localeCompare(b.country) || b.hs.length - a.hs.length || a.hs.localeCompare(b.hs),
    )
    .map((row, index) => ({
      id: `duty-${index}`,
      country: row.country,
      hsPrefix: row.hs,
      ratePercent: numeric(row.rate),
      descriptionEn: row.en,
      descriptionAr: row.ar,
      effectiveFrom: day(now, -420),
      effectiveTo: null,
      notes: null,
      isActive: true,
    }))
}

/**
 * Serves `listEngineRules`.
 *
 * Two tables presented as one list because an operator thinks of them as one
 * question: what does this mode weigh, and how long do we get before it costs.
 * The demurrage row is the one the running clock on job `1041` is measured
 * against — ten free days at 32 KWD — so the rule and the charge it wrote
 * agree when somebody checks.
 */
export function pilotEngineRules(): { chargeable: EngineRuleRow[]; freeTime: EngineRuleRow[] } {
  const chargeableRaw = [
    {
      id: 'cr-1',
      mode: 'sea_fcl',
      branchCode: null,
      divisorCm3PerKg: null,
      roundUpToKg: null,
      minimumKg: null,
      isActive: true,
    },
    {
      id: 'cr-2',
      mode: 'sea_lcl',
      branchCode: null,
      divisorCm3PerKg: '1000',
      roundUpToKg: '1',
      minimumKg: '1',
      isActive: true,
    },
    {
      id: 'cr-3',
      mode: 'air',
      branchCode: null,
      divisorCm3PerKg: '6000',
      roundUpToKg: '0.5',
      minimumKg: '1',
      isActive: true,
    },
    {
      id: 'cr-4',
      mode: 'courier',
      branchCode: null,
      divisorCm3PerKg: '5000',
      roundUpToKg: '0.5',
      minimumKg: '0.5',
      isActive: true,
    },
    {
      id: 'cr-5',
      mode: 'land',
      branchCode: null,
      divisorCm3PerKg: '3000',
      roundUpToKg: '1',
      minimumKg: '1',
      isActive: true,
    },
  ]

  const freeTimeRaw = [
    {
      id: 'ft-1',
      kind: 'demurrage',
      branchCode: 'KWI',
      mode: 'sea_fcl',
      containerType: '40HC',
      freeDays: 10,
      perDiem: '32',
      currency: 'KWD',
      dayBasis: 'calendar',
      isActive: true,
    },
    {
      id: 'ft-2',
      kind: 'demurrage',
      branchCode: 'KWI',
      mode: 'sea_fcl',
      containerType: '20GP',
      freeDays: 10,
      perDiem: '24',
      currency: 'KWD',
      dayBasis: 'calendar',
      isActive: true,
    },
    {
      id: 'ft-3',
      kind: 'detention',
      branchCode: 'KWI',
      mode: 'sea_fcl',
      containerType: null,
      freeDays: 7,
      perDiem: '18',
      currency: 'KWD',
      dayBasis: 'working',
      isActive: true,
    },
    {
      id: 'ft-4',
      kind: 'storage',
      branchCode: null,
      mode: null,
      containerType: null,
      freeDays: 5,
      perDiem: '12',
      currency: 'KWD',
      dayBasis: 'calendar',
      isActive: true,
    },
    {
      id: 'ft-5',
      kind: 'demurrage',
      branchCode: 'DXB',
      mode: 'sea_fcl',
      containerType: null,
      freeDays: 5,
      perDiem: '160',
      currency: 'AED',
      dayBasis: 'calendar',
      isActive: true,
    },
  ]

  return {
    chargeable: chargeableRaw.map((row) => ({
      id: row.id,
      label: row.mode,
      scope: row.branchCode ?? '—',
      // Stated as the trade states it: a divisor, an increment, a floor. A null
      // divisor is FCL, billed per container and never by volume.
      detail:
        row.divisorCm3PerKg === null
          ? 'per container'
          : `${Number(row.divisorCm3PerKg)} cm³/kg · ↑${Number(row.roundUpToKg)} · min ${Number(row.minimumKg)}`,
      isActive: row.isActive,
      raw: row as Record<string, unknown>,
    })),
    freeTime: freeTimeRaw.map((row) => ({
      id: row.id,
      label: row.kind,
      // Absence is how a rule widens, so an empty scope is "everything".
      scope: [row.branchCode, row.mode, row.containerType].filter(Boolean).join(' · ') || '—',
      detail: `${row.freeDays} days · ${Number(row.perDiem)} ${row.currency} · ${row.dayBasis}`,
      isActive: row.isActive,
      raw: row as Record<string, unknown>,
    })),
  }
}

/**
 * Serves `listReferenceSample` — the lists the register tables draw.
 *
 * These are the *same arrays* `pilotReferenceCounts` counts, which is the only
 * arrangement that works: the whole point of the screen is that an empty
 * reference table is a silent failure, and a count that disagreed with the
 * list beside it would be a louder one.
 */
export function pilotReferenceSample(): ReferenceSample {
  return {
    incoterms: INCOTERM_ROWS.map((row) => ({ code: row.code, nameEn: row.en })),
    containers: CONTAINER_TYPE_ROWS.map((row) => ({
      code: row.code,
      nameEn: row.en,
      teu: row.teu,
    })),
    exceptions: EXCEPTION_CODE_ROWS.map((row) => ({
      code: row.code,
      nameEn: row.en,
      slaHours: row.slaHours,
    })),
    documents: DOCUMENT_TYPES.map(([code, nameEn, , category]) => ({ code, nameEn, category })),
    calendars: CALENDARS.map((cal) => ({ key: cal.key, nameEn: cal.en, timeZone: cal.timeZone })),
    currencies: CURRENCY_ROWS.map((row) => ({ code: row.code, nameEn: row.en })),
    countries: COUNTRIES.map((row) => ({ code: row.code, nameEn: row.en })),
    milestones: pilotMilestoneTemplates().length,
  }
}

/**
 * Serves `referenceCounts`.
 *
 * The keys are the table names in snake case, because that is what
 * `Object.entries` over the statement's aliases produces and the screen
 * translates them by that key.
 */
export function pilotReferenceCounts(): ReferenceTable[] {
  return [
    { key: 'currencies', count: CURRENCY_ROWS.length },
    { key: 'countries', count: COUNTRIES.length },
    { key: 'incoterms', count: INCOTERM_ROWS.length },
    { key: 'container_types', count: CONTAINER_TYPE_ROWS.length },
    { key: 'charge_types', count: CHARGE_TYPE_ROWS.length },
    { key: 'exception_codes', count: EXCEPTION_CODE_ROWS.length },
    { key: 'document_types', count: DOCUMENT_TYPES.length },
    { key: 'milestone_templates', count: pilotMilestoneTemplates().length },
    { key: 'working_calendars', count: CALENDARS.length },
    { key: 'commodities', count: COMMODITY_ROWS.length },
    { key: 'chargeable_rules', count: pilotEngineRules().chargeable.length },
  ]
}

// --- the audit trail — features/admin/queries.ts ----------------------------

/**
 * Serves `listAudit` and `auditTableCounts`.
 *
 * Derived from things that visibly happened on the board — the milestone
 * somebody completed on the arriving job, the hold raised on `1041`, the
 * invoice drafted this morning — because the audit trail's whole claim is that
 * it records the writes rather than being written alongside them. A trail that
 * named rows nothing else in the demo mentions would be a table of nonsense
 * with timestamps.
 *
 * The trigger stamps the row, so the ids run in write order and the newest is
 * the largest. `bigint` because the table is append-only and long.
 */
const AUDIT_SEEDS = [
  { table: 'invoices', op: 'INSERT', row: 'inv-4119', person: 3, branch: 'KWI', minutesAgo: 42 },
  { table: 'payments', op: 'INSERT', row: 'pay-230', person: 3, branch: 'KWI', minutesAgo: 96 },
  {
    table: 'job_milestones',
    op: 'UPDATE',
    row: 'KWI-1039-discharged',
    person: 1,
    branch: 'KWI',
    minutesAgo: 180,
  },
  { table: 'exceptions', op: 'INSERT', row: 'exc-1', person: 0, branch: 'KWI', minutesAgo: 340 },
  {
    table: 'free_time_clocks',
    op: 'UPDATE',
    row: 'clock-1041',
    person: null,
    branch: 'KWI',
    minutesAgo: 400,
  },
  {
    table: 'charge_lines',
    op: 'INSERT',
    row: 'clock-1041-demurrage',
    person: null,
    branch: 'KWI',
    minutesAgo: 401,
  },
  { table: 'jobs', op: 'UPDATE', row: 'job-1041', person: 0, branch: 'KWI', minutesAgo: 460 },
  {
    table: 'supplier_invoices',
    op: 'INSERT',
    row: 'sup-8841',
    person: 3,
    branch: 'KWI',
    minutesAgo: 720,
  },
  { table: 'quotes', op: 'UPDATE', row: 'quote-316', person: 0, branch: 'KWI', minutesAgo: 900 },
  {
    table: 'enquiries',
    op: 'INSERT',
    row: 'enq-323',
    person: null,
    branch: 'DXB',
    minutesAgo: 1200,
  },
  { table: 'jobs', op: 'INSERT', row: 'job-1050', person: 0, branch: 'KWI', minutesAgo: 1500 },
  {
    table: 'documents',
    op: 'INSERT',
    row: '1035-bill_of_lading',
    person: 2,
    branch: 'KWI',
    minutesAgo: 1800,
  },
  { table: 'customers', op: 'UPDATE', row: 'cust-02', person: 3, branch: 'KWI', minutesAgo: 2400 },
  {
    table: 'partners',
    op: 'UPDATE',
    row: 'partner-one',
    person: 5,
    branch: 'KWI',
    minutesAgo: 3000,
  },
  {
    table: 'principals',
    op: 'INSERT',
    row: 'person-06',
    person: 5,
    branch: 'KWI',
    minutesAgo: 4200,
  },
] as const

export function pilotAudit(now = Date.now(), table?: string): AuditRow[] {
  return AUDIT_SEEDS.filter((seed) => !table || seed.table === table)
    .map((seed, index): AuditRow => ({
      id: BigInt(900_000 + AUDIT_SEEDS.length - index),
      at: new Date(now - seed.minutesAgo * 60 * 1000),
      op: seed.op,
      tableName: seed.table,
      rowId: seed.row,
      principalName: seed.person === null ? null : PEOPLE[seed.person]!.en,
      /*
        Null principal is the *system* writing — the free-time sweep raising a
        clock and the charge line it wrote by itself. That pair is the audit
        proof of the demo's best beat, and dressing it up as a person would
        undo the point of the beat.
      */
      principalType: seed.person === null ? 'system' : 'internal',
      branchCode: seed.branch,
      ip: seed.person === null ? null : '10.20.30.40',
    }))
    .slice(0, 150)
}

export function pilotAuditTableCounts(now = Date.now()): { tableName: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of pilotAudit(now)) {
    counts.set(row.tableName, (counts.get(row.tableName) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tableName, count]) => ({ tableName, count }))
    .sort((a, b) => b.count - a.count || a.tableName.localeCompare(b.tableName))
    .slice(0, 12)
}

// --- notifications — features/admin/notifications.ts ------------------------

/**
 * Serves the row half of `listTemplates`.
 *
 * The rows, not the finished `TemplateEvent[]`. That list is driven from
 * `NOTIFICATION_EVENTS` in core rather than from the table — which is the
 * reason the screen draws all thirteen events even against an empty table, and
 * the reason an untranslatable event key once threw `MISSING_MESSAGE` on it.
 * A fixture that returned finished events would route around exactly the code
 * that broke.
 *
 * Six events are seeded in both languages and the rest are deliberately
 * missing, because an event with no template is a real state that needs
 * filling and used to send `failed: no adapter` to nobody. The one branch
 * override on `invoice.overdue` is the pair the screen exists to show: an
 * administrator's question is never "what is the default", it is "what will
 * Kuwait actually send".
 */
const TEMPLATE_SEEDS = [
  {
    eventKey: 'enquiry.created',
    channel: 'email',
    subject: { en: 'We have your enquiry — {{reference}}', ar: 'استلمنا طلبكم — {{reference}}' },
    body: {
      en: 'Thank you for your enquiry {{reference}}. {{ownerName}} is working on it and will come back to you with a price.',
      ar: 'شكراً لطلبكم {{reference}}. يعمل {{ownerName}} عليه وسيوافيكم بالسعر.',
    },
  },
  {
    eventKey: 'quote.sent',
    channel: 'email',
    subject: { en: 'Your quotation {{reference}}', ar: 'عرض السعر {{reference}}' },
    body: {
      en: 'Our quotation for {{lane}} is attached. It is valid until {{validUntil}}.',
      ar: 'مرفق عرض السعر لخط {{lane}}. العرض ساري حتى {{validUntil}}.',
    },
  },
  {
    eventKey: 'job.milestone_reached',
    channel: 'email',
    subject: { en: '{{reference}} — {{milestoneName}}', ar: '{{reference}} — {{milestoneName}}' },
    body: {
      en: 'Shipment {{reference}} has reached {{milestoneName}}.',
      ar: 'وصلت الشحنة {{reference}} إلى مرحلة {{milestoneName}}.',
    },
  },
  {
    eventKey: 'document.released',
    channel: 'email',
    subject: {
      en: '{{documentName}} for {{reference}}',
      ar: '{{documentName}} للشحنة {{reference}}',
    },
    body: {
      en: '{{documentName}} for shipment {{reference}} is ready.',
      ar: '{{documentName}} الخاص بالشحنة {{reference}} جاهز.',
    },
  },
  {
    eventKey: 'invoice.issued',
    channel: 'email',
    subject: { en: 'Invoice {{reference}}', ar: 'الفاتورة {{reference}}' },
    body: {
      en: 'Invoice {{reference}} for {{amount}} is attached and falls due on {{dueOn}}.',
      ar: 'مرفق الفاتورة {{reference}} بمبلغ {{amount}} وتستحق في {{dueOn}}.',
    },
  },
  {
    eventKey: 'invoice.overdue',
    channel: 'email',
    subject: { en: 'Overdue: invoice {{reference}}', ar: 'متأخرة: الفاتورة {{reference}}' },
    body: {
      en: 'Invoice {{reference}} for {{amount}} fell due on {{dueOn}} and is still open.',
      ar: 'استحقت الفاتورة {{reference}} بمبلغ {{amount}} في {{dueOn}} ولا تزال مفتوحة.',
    },
  },
] as const

export function pilotNotificationTemplates(): NotificationTemplateRow[] {
  const rows = TEMPLATE_SEEDS.flatMap((seed) =>
    (['en', 'ar'] as const).map((locale): NotificationTemplateRow => ({
      id: `tpl-${seed.eventKey}-${seed.channel}-${locale}`,
      eventKey: seed.eventKey,
      channel: seed.channel,
      locale,
      branchId: null,
      branchCode: null,
      subject: seed.subject[locale],
      body: seed.body[locale],
      isActive: true,
    })),
  )

  const kuwait = branch('KWI')
  return [
    ...rows,
    {
      id: 'tpl-invoice.overdue-email-en-KWI',
      eventKey: 'invoice.overdue',
      channel: 'email',
      locale: 'en',
      branchId: kuwait.id,
      branchCode: kuwait.code,
      subject: 'Statement reminder — invoice {{reference}}',
      body:
        'Invoice {{reference}} for {{amount}} fell due on {{dueOn}}. Kindly arrange settlement or ' +
        'let us know if anything is outstanding from our side.',
      isActive: true,
    },
  ]
}

/**
 * Serves `listChannelSettings` — FR-NT-03's switches, not a resolved answer.
 *
 * The master switch for WhatsApp is off because the integration below is off
 * too; a switch that says "on" for a channel with no credentials is the screen
 * disagreeing with the deployment. `channelDecision` in core resolves the
 * precedence between these rows, and nothing here duplicates it.
 */
export function pilotNotificationSwitches(): NotificationSwitchRow[] {
  return [
    { eventKey: null, channel: 'email', isEnabled: true },
    { eventKey: null, channel: 'in_app', isEnabled: true },
    { eventKey: null, channel: 'portal', isEnabled: true },
    { eventKey: null, channel: 'whatsapp', isEnabled: false },
    { eventKey: 'job.eta_changed', channel: 'email', isEnabled: false },
    { eventKey: 'invoice.overdue', channel: 'email', isEnabled: true },
  ]
}

/**
 * Serves `listDeliveries` — FR-NT-06's log.
 *
 * The failures are the point, and they are first whatever their age: a send
 * that failed last week is more interesting than one that succeeded this
 * morning. A notification that never arrived is an incident to investigate
 * rather than a row to garbage-collect, which is why the queue keeps failed
 * jobs for a month.
 */
export function pilotNotificationDeliveries(now = Date.now()): NotificationDeliveryRow[] {
  const seeds = [
    {
      seq: 9,
      eventKey: 'invoice.overdue',
      channel: 'email',
      recipient: 'finance@kfood.example',
      status: 'failed',
      attempts: 4,
      lastError: '550 5.1.1 recipient rejected',
      suppressed: null,
      deferred: null,
      sent: null,
      created: 26,
    },
    {
      seq: 7,
      eventKey: 'quote.sent',
      channel: 'email',
      recipient: 'purchasing@gulfst.example',
      status: 'failed',
      attempts: 2,
      lastError: 'connect ETIMEDOUT smtp.office365.com:587',
      suppressed: null,
      deferred: 1,
      sent: null,
      created: 30,
    },
    {
      seq: 12,
      eventKey: 'job.milestone_reached',
      channel: 'whatsapp',
      recipient: '+965 9000 1122',
      status: 'suppressed',
      attempts: 0,
      lastError: null,
      suppressed: 'whatsapp is switched off',
      deferred: null,
      sent: null,
      created: 4,
    },
    {
      seq: 13,
      eventKey: 'job.milestone_reached',
      channel: 'email',
      recipient: 'logistics@alghanim.example',
      status: 'queued',
      attempts: 0,
      lastError: null,
      suppressed: null,
      deferred: 8,
      sent: null,
      created: 2,
    },
    {
      seq: 11,
      eventKey: 'document.released',
      channel: 'email',
      recipient: 'docs@kirby.example',
      status: 'delivered',
      attempts: 1,
      lastError: null,
      suppressed: null,
      deferred: null,
      sent: 6,
      created: 6,
    },
    {
      seq: 10,
      eventKey: 'invoice.issued',
      channel: 'email',
      recipient: 'ap@boubyan.example',
      status: 'sent',
      attempts: 1,
      lastError: null,
      suppressed: null,
      deferred: null,
      sent: 18,
      created: 18,
    },
    {
      seq: 8,
      eventKey: 'enquiry.created',
      channel: 'email',
      recipient: 'ops@ebs.example',
      status: 'delivered',
      attempts: 1,
      lastError: null,
      suppressed: null,
      deferred: null,
      sent: 21,
      created: 21,
    },
  ] as const

  const rank = (status: string) => (status === 'failed' || status === 'queued' ? 0 : 1)

  return [...seeds]
    .sort((a, b) => rank(a.status) - rank(b.status) || a.created - b.created)
    .map((seed): NotificationDeliveryRow => ({
      id: `delivery-${seed.seq}`,
      eventKey: seed.eventKey,
      channel: seed.channel,
      recipient: seed.recipient,
      status: seed.status,
      attempts: seed.attempts,
      lastError: seed.lastError,
      suppressedReason: seed.suppressed,
      deferredUntil: seed.deferred === null ? null : hours(now, seed.deferred),
      sentAt: seed.sent === null ? null : hours(now, -seed.sent),
      createdAt: hours(now, -seed.created),
    }))
}

// --- integrations — features/admin/integrations.ts --------------------------

/**
 * Serves the row half of `listIntegrations`.
 *
 * Rows only, and that is the design rather than a shortcut. The screen's answer
 * is the catalogue in `@qabandi/core` merged over the environment merged over
 * these rows, and only the last of the three needs a database — `harness.ts`
 * says outright that resolving from the environment alone would show half an
 * answer, which is why the route is listed as needing one. Handing the resolver
 * a row set restores the other half without inventing a configuration this
 * deployment does not have.
 *
 * `secrets` holds sealed ciphertext in the real table and this file never
 * opens one. The values below are visibly not ciphertext, so the screen can
 * report a credential as *set* while there is nothing to leak — the resolver
 * only ever asks whether the key is present.
 *
 * Seven of the twelve integrations have a row. The other five are configured
 * from the environment or not at all, which is what every deployment looks
 * like on the day it is handed over.
 */
export function pilotIntegrationSettings(now = Date.now()): IntegrationSettingRow[] {
  const row = (
    key: string,
    driver: string | null,
    settings: Record<string, string | number | boolean>,
    secrets: Record<string, string>,
    extra: Partial<IntegrationSettingRow> = {},
  ): IntegrationSettingRow => ({
    id: `integration-${key}`,
    key,
    driver,
    settings,
    secrets,
    isActive: true,
    lastCheckedAt: hours(now, -1),
    lastOkAt: hours(now, -1),
    lastError: null,
    createdAt: at(now, -40, 10),
    updatedAt: hours(now, -30),
    ...extra,
  })

  return [
    row(
      'smtp',
      'smtp',
      {
        host: 'smtp.office365.com',
        port: 587,
        secure: 'false',
        user: 'no-reply@alqabandi.com',
        from: 'Al-Qabandi Freight <no-reply@alqabandi.com>',
        rejectUnauthorized: 'true',
      },
      { password: 'set-in-fixtures-never-sealed' },
    ),
    row(
      'fileStore',
      's3',
      {
        endpoint: 'https://example.r2.cloudflarestorage.com',
        bucket: 'qabandi-documents',
        region: 'auto',
        accessKeyId: 'AKIAEXAMPLEFIXTURE',
        forcePathStyle: 'true',
      },
      { secretAccessKey: 'set-in-fixtures-never-sealed' },
    ),
    /*
      No driver, because `inboundEmail` declares none.

      This said `'imap'`, which is the right word for what the worker does and
      the wrong value for this column: `INTEGRATIONS` gives the spec no
      `drivers` array, so nothing validates the string and the settings screen
      renders `t(\`drivers.inboundEmail.imap\`)` — a key that does not exist in
      either catalogue, and cannot, because `check-messages.mjs` only sees keys
      that are written out rather than interpolated. The page threw
      MISSING_MESSAGE on every render. A driver belongs here only where the
      spec offers a choice between drivers.
    */
    row(
      'inboundEmail',
      null,
      { cron: '* * * * *' },
      { webhookSecret: 'set-in-fixtures-never-sealed' },
    ),
    /*
      The carrier poll, with the arithmetic the screen checks.

      `batch × runs-per-hour ≤ the carrier's cap`: twelve every half hour is
      twenty-four calls an hour, which is above a trial tier's twenty. Left
      that way deliberately — it is the one cross-field rule this integration
      has a screen for, and a demo where the number is comfortably inside the
      limit never shows what the warning is for.
    */
    row('carrierPoll', null, { batch: 12, cron: '*/30 * * * *', activeWithinMinutes: 120 }, {}),
    /*
      Live, and failing. A carrier key that is wrong produces no error anywhere
      an operator looks — the poll asks, the gateway answers 401, and the board
      simply shows shipments that have not moved. `lastError` on the row is
      what turns that into something a person can see without a service log.
    */
    row(
      'carrierTracking',
      'dcsa',
      {},
      { DCSA_MAERSK_CONSUMER_KEY: 'set-in-fixtures-never-sealed' },
      {
        lastCheckedAt: hours(now, -2),
        lastOkAt: at(now, -3, 14),
        lastError: 'Maersk track-and-trace returned 401 — consumer key rejected.',
      },
    ),
    row('fx', 'manual', {}, {}, { lastCheckedAt: null, lastOkAt: null }),
    // Switched off rather than deleted, which is how a change is rolled back.
    row(
      'whatsapp',
      null,
      { phoneNumberId: '' },
      {},
      {
        isActive: false,
        lastCheckedAt: null,
        lastOkAt: null,
      },
    ),
  ]
}

// --- the dashboard map — features/dashboard/queries.ts ----------------------

/**
 * Serves `getMapData`.
 *
 * Live shipments only, because a map of everything ever shipped is a picture
 * of history and the board's subject is what is moving now. Both ends need
 * coordinates or the lane is dropped — plotting a missing pair at (0, 0) puts
 * it in the Atlantic off Ghana, which looks exactly like a real route.
 */
export function pilotMapData(): MapData {
  const live = JOB_SEEDS.filter(
    (seed) => !['closed', 'cancelled', 'completed'].includes(seed.status),
  )

  const lanes = new Map<string, { seed: JobSeed; count: number }>()
  const ports = new Map<PortCode, number>()

  for (const seed of live) {
    const key = `${seed.origin}:${seed.destination}:${seed.mode}`
    lanes.set(key, { seed, count: (lanes.get(key)?.count ?? 0) + 1 })
    ports.set(seed.origin, (ports.get(seed.origin) ?? 0) + 1)
    ports.set(seed.destination, (ports.get(seed.destination) ?? 0) + 1)
  }

  return {
    lanes: [...lanes.entries()]
      .map(([id, { seed, count }]) => ({
        id,
        originName: PORTS[seed.origin].en,
        originLon: PORTS[seed.origin].lon,
        originLat: PORTS[seed.origin].lat,
        destinationName: PORTS[seed.destination].en,
        destinationLon: PORTS[seed.destination].lon,
        destinationLat: PORTS[seed.destination].lat,
        count,
        mode: seed.mode,
      }))
      .sort((a, b) => b.count - a.count),
    ports: [...ports.entries()]
      .map(([code, count]) => ({
        id: locationId(code),
        name: PORTS[code].en,
        longitude: PORTS[code].lon,
        latitude: PORTS[code].lat,
        count,
      }))
      .sort((a, b) => b.count - a.count),
  }
}

// --- select options — lib/options.ts ----------------------------------------

/**
 * Serves `loadOptions` — every list a form needs.
 *
 * This is the "secondary register query" `harness.ts` names against
 * `/enquiries` and `/jobs`, and it is the reason those two routes need a
 * database despite both their register reads already having fixtures: the
 * boards render a dialog, the dialog needs its `<option>` lists, and
 * `loadOptions` went straight to `withActor`.
 *
 * The label format is the query's — `CODE — Name`, code first — and it is not
 * cosmetic: a browser's type-to-select matches from the start of the option
 * text, so an operator who knows the code can type it and one who does not
 * reads the name. Putting the name first breaks the first case and helps the
 * second not at all.
 */
export function pilotOptions(): ReferenceOptions {
  return {
    branches: BRANCHES.map((b) => ({ value: b.id, label: `${b.code} — ${b.en}` })),
    customers: CUSTOMERS.map((c, index) => ({
      value: customerId(index),
      label: `${c.code} — ${c.en}`,
    })).sort((a, b) => a.label.localeCompare(b.label)),
    partners: PARTNERS.map((p) => ({
      value: partnerId(p.id),
      label: `${p.code} — ${p.en}`,
      // `<optgroup>` by type, which is what makes a fifteen-row list readable.
      group: p.type,
    })).sort((a, b) => a.label.localeCompare(b.label)),
    locations: PORT_CODES.map((code) => ({
      value: locationId(code),
      label: `${code} — ${PORTS[code].en}`,
      group: PORTS[code].country,
    })).sort((a, b) => a.label.localeCompare(b.label)),
    commodities: COMMODITY_ROWS.map((c) => ({
      value: `commodity-${c.code}`,
      label: `${c.code} — ${c.en}`,
    })),
    incoterms: INCOTERM_ROWS.map((i) => ({ value: i.code, label: `${i.code} — ${i.en}` })),
    countries: COUNTRIES.map((c) => ({ value: c.code, label: c.en })),
    currencies: CURRENCY_ROWS.map((c) => ({ value: c.code, label: `${c.code} — ${c.en}` })),
    containerTypes: CONTAINER_TYPE_ROWS.map((c) => ({
      value: c.code,
      label: `${c.code} — ${c.en}`,
    })),
    chargeTypes: CHARGE_TYPE_ROWS.map((c) => ({
      value: `charge-${c.key}`,
      label: `${c.key} — ${c.en}`,
      group: c.category,
    })),
    documentTypes: DOCUMENT_TYPES.map(([code, nameEn, , category]) => ({
      value: `doctype-${code}`,
      label: `${code} — ${nameEn}`,
      group: category,
    })),
    exceptionCodes: EXCEPTION_CODE_ROWS.map((e) => ({
      value: `exccode-${e.code}`,
      label: `${e.code} — ${e.en}`,
      group: e.severity,
    })),
    milestoneCodes: [
      ...new Map(
        pilotMilestoneTemplates().map((row) => [
          row.code,
          { value: row.code, label: `${row.code} — ${row.nameEn}` },
        ]),
      ).values(),
    ].sort((a, b) => a.value.localeCompare(b.value)),
    /*
      Internal principals only. A customer contact is a principal too, and
      offering one as the owner of an enquiry would be a privilege leak wearing
      a dropdown.
    */
    people: PEOPLE.map((person, index) => ({
      value: `person-${String(index).padStart(2, '0')}`,
      label: person.en,
    })).sort((a, b) => a.label.localeCompare(b.label)),
    roles: ROLES.map((role) => ({ value: `role-${role.key}`, label: role.en })),
  }
}

// --- proof of delivery — features/pod/queries.ts ----------------------------

/**
 * Serves `jobProofOfDelivery`.
 *
 * The reason `/jobs/:id` is in `NEEDS_DATABASE` for a fault of its own rather
 * than an inherited one: `getJobDetail` has the fixture branch every other
 * query on the page has, and this pair does not, so the job file goes to
 * `withActor` even in fixture mode.
 *
 * Job `1035` carries two records and the older one is superseded, because a
 * corrected POD and the one it corrected are both facts and the second is the
 * one somebody will ask about. Ordered current-first; the caller decides how
 * much history to show.
 */
export function pilotProofOfDelivery(jobId: string, now = Date.now()): PodRow[] {
  const seed = JOB_SEEDS.find((s) => `job-${s.seq}` === jobId)
  // A POD exists once the cargo has been handed over — nothing earlier has one.
  if (!seed || seed.done < 6) return []

  const detail = jobDetail(seed, now)
  const containerNo = detail.containers[0]?.containerNo ?? null
  const deliveredAt = at(now, seed.etaOffset + 4, 13)

  const current: PodRow = {
    id: `pod-${seed.seq}`,
    deliveredAt,
    receivedByName: 'Mohammed Ali',
    receivedByIdNumber: '284091500217',
    signatureAssetId: `asset-sig-${seed.seq}`,
    containerNo,
    // Shuwaikh gate 4, to six places — `numeric` columns, so strings.
    latitude: '29.352100',
    longitude: '47.931400',
    accuracyMetres: '8.500000',
    hasException: false,
    exceptionNotes: null,
    notes: 'Delivered to consignee warehouse, offloaded by receiver.',
    capturedByEn: OWNERS[seed.owner]!,
    capturedByAr: null,
    createdAt: deliveredAt,
    supersededById: null,
    photos: [
      {
        id: `pod-${seed.seq}-p1`,
        assetId: `asset-pod-${seed.seq}-1`,
        caption: 'Seal intact at gate',
      },
      {
        id: `pod-${seed.seq}-p2`,
        assetId: `asset-pod-${seed.seq}-2`,
        caption: 'Cargo on the dock',
      },
    ],
  }

  if (seed.seq !== 1035) return [current]

  return [
    current,
    {
      ...current,
      id: `pod-${seed.seq}-v1`,
      deliveredAt: new Date(deliveredAt.getTime() - 2 * HOUR),
      receivedByName: 'M. Ali',
      receivedByIdNumber: null,
      signatureAssetId: null,
      hasException: true,
      exceptionNotes: 'Two cartons scuffed; receiver signed subject to inspection.',
      notes: 'Corrected — the receiver name and the damage note were captured twice.',
      createdAt: new Date(deliveredAt.getTime() - 2 * HOUR),
      supersededById: `pod-${seed.seq}`,
      photos: [
        {
          id: `pod-${seed.seq}-v1-p1`,
          assetId: `asset-pod-${seed.seq}-3`,
          caption: 'Scuffed cartons',
        },
      ],
    },
  ]
}

/** Serves `jobEquipmentOptions` — the "which part was delivered" picker. */
export function pilotJobEquipmentOptions(
  jobId: string,
  now = Date.now(),
): { value: string; label: string }[] {
  const seed = JOB_SEEDS.find((s) => `job-${s.seq}` === jobId)
  if (!seed) return []

  return jobDetail(seed, now).containers.map((container, index) => ({
    value: `equip-${seed.seq}-${index}`,
    label: `${container.containerNo} · ${container.type}`,
  }))
}

/* ===========================================================================
   The documents, opened — features/ledger/queries.ts.

   `getQuoteDetail` and `getInvoiceDetail` are the two reads a register row
   links to, and they are the two places rule 1 above bites hardest: the
   person reading a detail page clicked that row a second ago and is still
   holding its total. So neither builder restates a header figure. Both start
   from the row the register already returned and open it — the lines are
   composed so that they *cannot* fail to sum to it, and the receipts are the
   payment seeds the receipts register already lists, joined rather than
   re-typed.
   ======================================================================== */

/**
 * Narrow a seed's `string` to the union a message key is looked up by.
 *
 * The seed tables above state statuses and methods as `string`, which is what
 * the columns are. The screens render `statuses.<status>` and
 * `methods.<method>`, so a value outside the list is not a wrong label — it is
 * `MISSING_MESSAGE` thrown while the page renders, with nothing having failed
 * to compile. This is what makes that a compile error in this file instead,
 * and the throw is the belt to that braces: it can only fire if a seed above
 * is edited to a value the messages do not carry, and it names the value.
 */
function oneOf<T extends string>(known: readonly T[], value: string, field: string): T {
  const match = known.find((candidate) => candidate === value)
  if (match === undefined) {
    throw new Error(`pilot fixture: ${field} "${value}" is not one of ${known.join(', ')}`)
  }
  return match
}

const QUOTE_STATUSES: readonly QuoteStatus[] = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'superseded',
]

const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'draft',
  'approved',
  'issued',
  'part_paid',
  'paid',
  'credited',
  'void',
]

const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'bank_transfer',
  'cheque',
  'cash',
  'card',
  'offset',
]

// --- the invoice, opened ----------------------------------------------------

/**
 * Who takes their invoice in Arabic.
 *
 * `language` decides which of the bilingual columns the PDF renders and which
 * direction the template runs, and it is a property of the *customer* rather
 * than of the branch: a Kuwaiti ministry's accounts department will not
 * process an English invoice, and the trading companies beside it in
 * `CUSTOMERS` are content with one. One name is enough to show the column is
 * real; making it a branch default would show the opposite of what it is.
 */
const ARABIC_INVOICE_CUSTOMERS: ReadonlySet<string> = new Set(['MPW'])

/**
 * The destination charges every invoice on this board carries, by currency.
 *
 * The freight line takes whatever the subtotal has left after these, which is
 * what makes the lines add up to the header by construction rather than by
 * arithmetic somebody has to keep true. Stating five amounts and a subtotal
 * beside them would be six numbers free to drift apart, and the one that
 * drifted would be on the screen a finance manager checks first.
 *
 * Two sets because the two entities bill in two currencies and 25 KWD is not
 * 25 AED. Both are comfortably under the smallest subtotal in `INVOICE_SEEDS`,
 * which is what keeps every freight line positive.
 *
 * English only: `invoice_lines` carries a `description_ar` the PDF renders and
 * `getInvoiceDetail` does not select it, so neither does this.
 */
const INVOICE_ANCILLARIES: Record<
  string,
  readonly { readonly description: string; readonly amount: string }[]
> = {
  KWD: [
    { description: 'Documentation', amount: '25.000' },
    { description: 'Customs clearance', amount: '65.000' },
    { description: 'Delivery order', amount: '42.000' },
  ],
  AED: [
    { description: 'Documentation', amount: '275.00' },
    { description: 'Customs clearance', amount: '720.00' },
    { description: 'Delivery order', amount: '460.00' },
  ],
}

/**
 * The rate that produced the invoice's tax, backed out of the two figures.
 *
 * Derived rather than stated so the header cannot claim 5% over a tax amount
 * that is 4.8% of the subtotal. Kuwait charges no VAT, which is why every KWI
 * seed carries a zero tax and this returns a zero rate for them.
 */
function invoiceTaxRate(seed: InvoiceSeed): Dec {
  const tax = new D(seed.tax)
  return tax.isZero() ? new D(0) : tax.dividedBy(new D(seed.subtotal)).times(100)
}

/**
 * `out_of_scope` rather than `zero_rated` on the Kuwaiti invoices, and the
 * distinction is not pedantry: zero-rated is inside a tax at nil, and Kuwait
 * has no tax for the supply to be inside of. An auditor reads the two
 * differently, and the treatment is what the PDF prints under the total.
 */
function invoiceTaxTreatment(seed: InvoiceSeed): TaxTreatment {
  return invoiceTaxRate(seed).isZero() ? 'out_of_scope' : 'standard'
}

/** Credit note sequence → the invoice sequence it reverses. */
const CREDITED_INVOICES: Record<number, number> = { 4116: 4117 }

function invoiceLines(seed: InvoiceSeed): InvoiceDetail['lines'] {
  const rate = invoiceTaxRate(seed)
  const lineTax = (amount: string): string => numeric(new D(amount).times(rate).dividedBy(100))

  /*
    A credit note is one line and no breakdown. It reverses something that was
    billed; splitting it into freight and destination charges would invent a
    composition the document it credits does not have, and the number a
    customer disputes is the one on the original invoice, named.
  */
  if (seed.isCreditNote === true) {
    // `credits_invoice_id` on the real row. Stated rather than guessed from
    // the sequence: which document a credit note reverses is the one fact on
    // it a customer's accounts department checks.
    const credited = INVOICE_SEEDS.find((other) => other.seq === CREDITED_INVOICES[seed.seq])!
    const against = `${branch(credited.branch).code}-${String(credited.seq).padStart(6, '0')}`
    return [
      {
        id: `invl-${seed.seq}-1`,
        descriptionEn: `Destination charges billed twice on invoice ${against} — credited`,
        quantity: numeric('1'),
        unitPrice: numeric(seed.subtotal),
        amount: numeric(seed.subtotal),
        taxAmount: lineTax(seed.subtotal),
      },
    ]
  }

  const ancillaries = INVOICE_ANCILLARIES[branch(seed.branch).currency]!
  const lines = ancillaries.map((charge, index) => ({
    id: `invl-${seed.seq}-${index + 2}`,
    descriptionEn: charge.description,
    quantity: numeric('1'),
    unitPrice: numeric(charge.amount),
    amount: numeric(charge.amount),
    taxAmount: lineTax(charge.amount),
  }))
  const freight = minus(numeric(seed.subtotal), sum(ancillaries.map((charge) => charge.amount)))

  return [
    {
      id: `invl-${seed.seq}-1`,
      descriptionEn: 'Freight and origin charges',
      quantity: numeric('1'),
      unitPrice: freight,
      amount: freight,
      // The residual rather than a rounding of its own. Five per cent of five
      // amounts, each rounded to the column's scale, is not five per cent of
      // their sum — and the sum is what the header prints.
      taxAmount: minus(numeric(seed.tax), sum(lines.map((line) => line.taxAmount))),
    },
    ...lines,
  ]
}

/**
 * The Dubai receipts, which happened and are not in `PAYMENT_SEEDS`.
 *
 * `paymentSummary` adds `amount` up across every row and labels the total with
 * one currency, so the payments register is deliberately dinars only — the
 * reasoning is on the seed list itself. But an invoice marked paid whose
 * receipts panel is empty is the detail page contradicting its own header, so
 * the two settled AED invoices keep their receipts here: allocated against the
 * invoice they cleared, and absent from the register that cannot add them up.
 */
const DXB_RECEIPT_SEEDS: readonly PaymentSeed[] = [
  {
    seq: 240,
    branch: 'DXB',
    customer: 9,
    amount: '10290.00',
    received: 26,
    method: 'bank_transfer',
    reference: 'ENBD-410882',
    recordedBy: 4,
    allocated: '10290.00',
  },
  {
    seq: 241,
    branch: 'DXB',
    customer: 5,
    amount: '5502.00',
    received: 3,
    method: 'cheque',
    reference: 'CHQ-118204',
    recordedBy: 4,
    allocated: '5502.00',
  },
]

/**
 * Which receipt settled which invoice — `payment_allocations`.
 *
 * The join neither seed list can carry on its own. Every entry's `allocated`
 * amount is exactly the invoice's `amountPaid`, which is what makes the
 * receipts panel add up to the balance the header already showed.
 *
 * Receipt 230 is deliberately absent. Alghanim's round 1,500 against no
 * invoice number is the unallocated money the payments register exists to
 * show, and matching it here would quietly delete the point of it. So is
 * invoice 4116: its `amountPaid` is a credit applied, not money received, and
 * a credit note listing a receipt would have the customer paying us to be
 * refunded.
 */
const PAYMENT_ALLOCATION_SEEDS: readonly { readonly payment: number; readonly invoice: number }[] =
  [
    { payment: 233, invoice: 4117 },
    { payment: 232, invoice: 4115 },
    { payment: 231, invoice: 4104 },
    { payment: 240, invoice: 2054 },
    { payment: 241, invoice: 2051 },
  ]

function invoiceAllocations(seed: InvoiceSeed, now: number): InvoiceDetail['allocations'] {
  const receipts = [...PAYMENT_SEEDS, ...DXB_RECEIPT_SEEDS]

  return PAYMENT_ALLOCATION_SEEDS.filter((link) => link.invoice === seed.seq)
    .map((link) => {
      const receipt = receipts.find((row) => row.seq === link.payment)!
      return {
        id: `alloc-${link.payment}-${link.invoice}`,
        amount: numeric(receipt.allocated),
        receivedOn: day(now, -receipt.received),
        reference: receipt.reference,
        method: oneOf(PAYMENT_METHODS, receipt.method, 'payment method'),
      }
    })
    .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))
}

/**
 * Serves `getInvoiceDetail`.
 *
 * Everything on the header comes back through `invoiceRow`, the same function
 * the register renders from, so the two cannot disagree about a number, a
 * status or a customer. Only what the register has no column for is added.
 */
export function pilotInvoiceDetail(id: string, now = Date.now()): InvoiceDetail | undefined {
  const seed = INVOICE_SEEDS.find((candidate) => `inv-${candidate.seq}` === id)
  if (seed === undefined) return undefined

  const row = invoiceRow(seed, now)
  const customer = CUSTOMERS[seed.customer]!
  const home = branch(seed.branch)

  return {
    id: row.id,
    seriesNo: row.seriesNo,
    status: oneOf(INVOICE_STATUSES, row.status, 'invoice status'),
    branchId: home.id,
    branchCode: row.branchCode,
    customerId: customerId(seed.customer),
    customerName: row.customerName,
    currency: row.currency,
    subtotal: numeric(seed.subtotal),
    taxAmount: numeric(seed.tax),
    total: invoiceTotal(seed),
    amountPaid: numeric(seed.paid),
    taxTreatment: invoiceTaxTreatment(seed),
    taxRatePercent: numeric(invoiceTaxRate(seed)),
    language: ARABIC_INVOICE_CUSTOMERS.has(customer.code) ? 'ar' : 'en',
    issuedAt: row.issuedAt,
    dueOn: row.dueOn,
    // Nobody issued a draft, so nobody is named on one. The finance desk in
    // each entity is the same person the exports register credits.
    issuedBy: seed.status === 'draft' ? null : OWNERS[seed.branch === 'KWI' ? 3 : 4]!,
    notes: invoiceNotes(seed),
    lines: invoiceLines(seed),
    allocations: invoiceAllocations(seed, now),
  }
}

/**
 * What is printed under the lines, where anything is.
 *
 * Notes are customer-facing — they go onto the PDF — so they say the thing the
 * customer needs rather than what the desk thinks. Two invoices have one: the
 * credit note, because a document that reverses another has to name it, and
 * the ministry's, because a government payable that arrives without its
 * purchase order number comes straight back.
 */
function invoiceNotes(seed: InvoiceSeed): string | null {
  if (seed.isCreditNote === true) return 'Credited in full. No payment is due against this note.'
  if (CUSTOMERS[seed.customer]!.code === 'MPW') return 'Against purchase order MPW/AQ/1184.'
  return null
}

// --- the quotation, opened --------------------------------------------------

type ChargeKey = (typeof CHARGE_TYPE_ROWS)[number]['key']

interface QuoteShape {
  readonly freight: {
    readonly charge: ChargeKey
    readonly basis: ChargeBasis
    readonly quantity: string
    readonly description: string
  }
  readonly ancillaries: readonly {
    readonly charge: ChargeKey
    readonly basis: ChargeBasis
    readonly amount: string
  }[]
}

/**
 * What a quotation is made of, by mode.
 *
 * The ancillaries are stated and the freight line takes the remainder, so the
 * lines sum to the `totalSell` the register showed a second earlier by
 * construction. The sell rates are the ones `pilotQuote` already quotes for the
 * same charge codes on the comparison screen: the two Moment 2 screens are
 * reading one price list, and a prospect who checks them against each other
 * should find they agree.
 *
 * The freight `quantity` is chosen so the remainder divides exactly *at the
 * three decimals the screen prints a dinar to*, for every priced enquiry in
 * `ENQUIRY_SEEDS`. Six would not be enough: an air rate stored as 2.486400
 * renders as 2.486 and multiplies back to 3,107.50 against a line of 3,108,
 * and multiplying a quotation out is the first thing anybody receiving one
 * does. 1,000 kg at 3.108 does not have that problem.
 *
 * Land and courier are here and unused: no enquiry on the board is priced in
 * either. They are stated anyway because the fallback for a missing mode would
 * have to be one of the others, and a land quotation with an ocean freight
 * line on it is a worse answer than no quotation at all.
 */
const QUOTE_SHAPES: Record<Mode, QuoteShape> = {
  sea_fcl: {
    freight: {
      charge: 'ocean_freight',
      basis: 'per_container',
      quantity: '1',
      description: '1 × 40HC',
    },
    ancillaries: [
      { charge: 'thc_origin', basis: 'per_container', amount: '145.000' },
      { charge: 'thc_destination', basis: 'per_container', amount: '168.000' },
      { charge: 'documentation', basis: 'flat', amount: '45.000' },
      { charge: 'delivery_order', basis: 'flat', amount: '42.000' },
    ],
  },
  sea_lcl: {
    freight: {
      charge: 'ocean_freight',
      basis: 'per_unit',
      quantity: '19',
      description: '19 cbm, weight/measure',
    },
    ancillaries: [
      { charge: 'documentation', basis: 'flat', amount: '45.000' },
      { charge: 'delivery_order', basis: 'flat', amount: '42.000' },
    ],
  },
  air: {
    freight: {
      charge: 'air_freight',
      basis: 'per_kg',
      quantity: '1000',
      description: '1,000 kg chargeable',
    },
    ancillaries: [
      { charge: 'documentation', basis: 'flat', amount: '45.000' },
      { charge: 'customs_clearance', basis: 'flat', amount: '65.000' },
      { charge: 'delivery_order', basis: 'flat', amount: '42.000' },
    ],
  },
  land: {
    freight: {
      charge: 'haulage',
      basis: 'per_container',
      quantity: '1',
      description: '1 × 40ft trailer',
    },
    ancillaries: [
      { charge: 'documentation', basis: 'flat', amount: '45.000' },
      { charge: 'customs_clearance', basis: 'flat', amount: '65.000' },
    ],
  },
  courier: {
    freight: { charge: 'air_freight', basis: 'per_kg', quantity: '25', description: '25 kg' },
    ancillaries: [{ charge: 'documentation', basis: 'flat', amount: '45.000' }],
  },
}

function chargeName(key: ChargeKey): string {
  return CHARGE_TYPE_ROWS.find((row) => row.key === key)!.en
}

function quoteLines(row: QuoteRow, mode: Mode): QuoteDetail['lines'] {
  const shape = QUOTE_SHAPES[mode]
  const lines = shape.ancillaries.map((charge, index) => ({
    id: `qtl-${row.id}-${index + 2}`,
    chargeName: chargeName(charge.charge),
    description: null,
    basis: charge.basis,
    quantity: numeric('1'),
    rate: numeric(charge.amount),
    amount: numeric(charge.amount),
    currency: row.currency,
  }))

  const freight = minus(row.totalSell ?? '0', sum(shape.ancillaries.map((charge) => charge.amount)))

  return [
    {
      id: `qtl-${row.id}-1`,
      chargeName: chargeName(shape.freight.charge),
      description: shape.freight.description,
      basis: shape.freight.basis,
      quantity: numeric(shape.freight.quantity),
      rate: numeric(new D(freight).dividedBy(new D(shape.freight.quantity))),
      amount: freight,
      currency: row.currency,
    },
    ...lines,
  ]
}

/**
 * The note frozen into `priced_snapshot` at the moment of quoting.
 *
 * Only the revised quotation carries one, and it says what the revision was
 * for — which is the whole reason a second version exists rather than an edit,
 * and the thing somebody opening version 1 needs to be told.
 */
function quoteNotes(id: string): string | null {
  if (id === 'quote-316') {
    return 'Revised to CIF Nhava Sheva at the customer request. Version 1, quoted CFR, stands until they confirm which they want.'
  }
  if (id === 'quote-316-v1') {
    return 'Quoted CFR Nhava Sheva, 1 × 40HC, cargo ready within ten days.'
  }
  return null
}

/**
 * Serves `getQuoteDetail`.
 *
 * Built on top of `pilotQuotes`, so the reference, version, status, sell, cost
 * and validity are literally the register's own row rather than a second
 * computation of it — and the margin the page derives from sell and cost is
 * therefore the margin the enquiry queue already advertised.
 *
 * The history is the other versions of the same enquiry's quotation, which is
 * `where h.enquiry_id = q.enquiry_id and h.id <> q.id` read off the register.
 * Only enquiry 316 has one, and both of its rows list the other: a customer
 * holding a printed version 1 has to be able to find version 1 here.
 */
export function pilotQuoteDetail(id: string, now = Date.now()): QuoteDetail | undefined {
  const rows = pilotQuotes(now)
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return undefined

  // `quote-316-v1` is the superseded first version of enquiry 316's quotation.
  const seq = Number(id.replace('quote-', '').replace('-v1', ''))
  const seed = ENQUIRY_SEEDS.find((candidate) => candidate.seq === seq)!
  const customer = CUSTOMERS[seed.customer]!
  const year = new Date(now).getFullYear()

  // The first version was raised six hours before the revision, which is the
  // same six hours `pilotQuotes` backdates its `sentAt` by.
  const createdAt = hours(now, -seed.age - (id.endsWith('-v1') ? 6 : 0))

  return {
    id: row.id,
    reference: row.reference,
    enquiryId: `enq-${seed.seq}`,
    enquiryReference: `ENQ-${seed.branch}-${year}-${String(seed.seq).padStart(4, '0')}`,
    branchId: branch(seed.branch).id,
    branchCode: row.branchCode,
    customerId: customerId(seed.customer),
    customerName: customer.en,
    version: row.version,
    status: oneOf(QUOTE_STATUSES, row.status, 'quote status'),
    currency: row.currency,
    totalSell: row.totalSell,
    totalCost: row.totalCost,
    validUntil: row.validUntil,
    preparedBy: row.preparedBy,
    sentAt: row.sentAt,
    decidedAt: row.decidedAt,
    createdAt,
    lane: `${PORTS[seed.origin].en} → ${PORTS[seed.destination].en}`,
    mode: seed.mode,
    notes: quoteNotes(row.id),
    lines: quoteLines(row, seed.mode),
    history: rows
      .filter((other) => other.enquiryReference === row.enquiryReference && other.id !== row.id)
      .map((other) => ({
        id: other.id,
        reference: other.reference,
        version: other.version,
        status: oneOf(QUOTE_STATUSES, other.status, 'quote status'),
      }))
      .sort((a, b) => b.version - a.version),
  }
}

/* ===========================================================================
   The charge ledger, and the four screens that argue with it.

   Everything below hangs off one dataset: what each shipment cost us. Until
   now the pilot had a job's *money* only as totals — a quotation, an invoice,
   a variance figure stated on a supplier bill — and the six detail pages that
   needed the lines underneath them were the six that still wanted a database.

   Two rules shape it, and they are the ones §5.5 of the architecture note
   already sets for fixtures generally:

   1. **The register's row is the header.** A reader opening a detail page
      clicked that row a second ago and is still holding its total, so no
      builder here restates a figure — each starts from `pilotJobs`,
      `pilotSupplierInvoices`, `pilotSettlements`, `pilotConsolidations` or
      `pilotPartner` and opens it.

   2. **Nothing here does the arithmetic the product does.** `jobMargin`,
      `compareToAccrual`, `summariseInvoice`, `buildStatement`, `netPosition`
      and `ageItems` all live in `@qabandi/core`, and every branch below stops
      at the rows those functions take. A fixture that computed a margin or a
      verdict itself would be demonstrating a second implementation — which is
      exactly the thing the pilot exists to promise it is not doing.

   The accruals are the join between them. `sup-8841` bills 96 KWD more ocean
   freight than job `1041` accrued because the *bill line* claims a charge line
   the ledger below actually holds; the payables screen reaches that number by
   running `compareToAccrual` over the pair, and the job's own ledger shows the
   same line flagged "billed over" from the other side. Neither figure is
   written down twice.
   ======================================================================== */

/**
 * The Dubai entity's rates, from Kuwait's.
 *
 * Every rate in `LEDGER_SHAPES` is stated once, in dinars, and multiplied for
 * the branch that keeps its books in dirhams. Twelve is the standing cross
 * rate the pilot uses; it is not a live FX feed and is not meant to be. What
 * matters is that a Dubai job's ledger reads in dirhams at a scale a Gulf
 * forwarder recognises rather than in Kuwaiti figures with an AED label on
 * them, which is the sort of thing a prospect spots in the first ten seconds.
 */
const BRANCH_RATE_SCALE: Record<BranchCode, number> = { KWI: 1, DXB: 12 }

/** Where the quantity on a charge line comes from. */
type LedgerQuantity = 'containers' | 'chargeable_weight' | number

/** Which of the companies on the job file the cost is owed to. */
type LedgerParty = 'carrier' | 'agent' | 'broker' | 'haulier' | 'terminal'

interface LedgerShapeLine {
  readonly charge: ChargeKey
  readonly quantity: LedgerQuantity
  /** Cost per unit, in Kuwaiti dinars — see `BRANCH_RATE_SCALE`. */
  readonly rate: string
  /** Sell over buy. The revenue line is the cost line times this. */
  readonly markup: string
  readonly party: LedgerParty
  /**
   * When the line exists at all.
   *
   * A haulage cost before the box has left the terminal is a cost nobody has
   * incurred, and a ledger that shows one teaches people to distrust the whole
   * card. `customs` follows the job's customs stage, `delivered` follows the
   * milestone count, `inspection` is the one job on the board sitting in a
   * yard being looked at.
   */
  readonly when?: 'customs' | 'delivered' | 'inspection'
}

/**
 * What each shape of shipment costs, and what it is sold for.
 *
 * The charge codes are `CHARGE_TYPE_ROWS` above — the same rows the reference
 * screen lists and the quotation lines are priced from, so a prospect who
 * checks the job P&L against the quotation finds the same vocabulary. The
 * rates are a Kuwaiti forwarder's order of magnitude on the Far East lane and
 * are placeholders like every other figure in this file.
 *
 * Revenue is *derived* from cost rather than stated beside it, and that is
 * deliberate: a stated sell rate drifts from its buy rate the first time
 * somebody edits one of the two, and a job whose margin quietly went negative
 * because of a typo in a fixture is a demo that dies on stage.
 */
const LEDGER_SHAPES: Record<keyof typeof TEMPLATES, readonly LedgerShapeLine[]> = {
  sea_import: [
    {
      charge: 'ocean_freight',
      quantity: 'containers',
      rate: '320.000',
      markup: '1.28',
      party: 'carrier',
    },
    {
      charge: 'thc_origin',
      quantity: 'containers',
      rate: '60.000',
      markup: '1.22',
      party: 'carrier',
    },
    {
      charge: 'thc_destination',
      quantity: 'containers',
      rate: '32.000',
      markup: '1.22',
      party: 'carrier',
    },
    { charge: 'documentation', quantity: 1, rate: '24.000', markup: '1.45', party: 'carrier' },
    { charge: 'delivery_order', quantity: 1, rate: '24.000', markup: '1.25', party: 'carrier' },
    {
      charge: 'customs_clearance',
      quantity: 1,
      rate: '45.000',
      markup: '1.44',
      party: 'broker',
      when: 'customs',
    },
    {
      charge: 'haulage',
      quantity: 'containers',
      rate: '55.000',
      markup: '1.42',
      party: 'haulier',
      when: 'delivered',
    },
    {
      charge: 'inspection',
      quantity: 1,
      rate: '120.000',
      markup: '1.25',
      party: 'broker',
      when: 'inspection',
    },
    {
      charge: 'storage',
      quantity: 3,
      rate: '32.000',
      markup: '1.25',
      party: 'terminal',
      when: 'inspection',
    },
  ],
  sea_export: [
    {
      charge: 'ocean_freight',
      quantity: 'containers',
      rate: '280.000',
      markup: '1.30',
      party: 'carrier',
    },
    {
      charge: 'thc_origin',
      quantity: 'containers',
      rate: '60.000',
      markup: '1.22',
      party: 'carrier',
    },
    { charge: 'documentation', quantity: 1, rate: '24.000', markup: '1.45', party: 'carrier' },
    {
      charge: 'customs_clearance',
      quantity: 1,
      rate: '40.000',
      markup: '1.45',
      party: 'broker',
      when: 'customs',
    },
  ],
  air_export: [
    {
      charge: 'air_freight',
      quantity: 'chargeable_weight',
      rate: '0.480',
      markup: '1.30',
      party: 'carrier',
    },
    { charge: 'documentation', quantity: 1, rate: '18.000', markup: '1.45', party: 'carrier' },
    {
      charge: 'customs_clearance',
      quantity: 1,
      rate: '40.000',
      markup: '1.45',
      party: 'broker',
      when: 'customs',
    },
  ],
}

/**
 * The costs accrued in somebody else's currency.
 *
 * A cost is accrued in the currency it will be billed in, at the rate on the
 * day it was committed — `FR-RT-06` — and these are the lines the foreign
 * bills below are matched against. Two of them carry a different rate from
 * their neighbours on the same shipment, which is not sloppiness: it is the
 * whole reason `payables/queries.ts` compares in base currency and says so at
 * length in its header. Compare the dollars and a three-day move in the rate
 * reads as the agent overcharging.
 *
 * Each entry replaces the shape's line for the same charge on the same job,
 * or adds one where the shape has none.
 */
interface ForeignAccrual {
  readonly job: number
  readonly charge: ChargeKey
  readonly amount: string
  readonly currency: string
  readonly fxRate: string
  readonly markup: string
  readonly party: LedgerParty
}

const FOREIGN_ACCRUALS: readonly ForeignAccrual[] = [
  // Everbright, the Shanghai agent, invoices its origin disbursements in dollars.
  {
    job: 1044,
    charge: 'thc_origin',
    amount: '900.00',
    currency: 'USD',
    fxRate: '0.306000',
    markup: '1.22',
    party: 'agent',
  },
  {
    job: 1044,
    charge: 'documentation',
    amount: '300.00',
    currency: 'USD',
    fxRate: '0.306000',
    markup: '1.45',
    party: 'agent',
  },
  {
    job: 1046,
    charge: 'documentation',
    amount: '120.00',
    currency: 'USD',
    fxRate: '0.306000',
    markup: '1.45',
    party: 'agent',
  },
  // Committed three days later, at a rate three days older. See above.
  {
    job: 1046,
    charge: 'thc_origin',
    amount: '400.00',
    currency: 'USD',
    fxRate: '0.300000',
    markup: '1.22',
    party: 'agent',
  },
  // Mumbai, on the job that arrived yesterday — the detention nobody agreed to.
  {
    job: 1039,
    charge: 'detention',
    amount: '261.40',
    currency: 'USD',
    fxRate: '0.306000',
    markup: '1.00',
    party: 'agent',
  },
  {
    job: 1039,
    charge: 'delivery_order',
    amount: '31.12',
    currency: 'USD',
    fxRate: '0.305000',
    markup: '1.25',
    party: 'agent',
  },
  // Emirates SkyCargo's handling account for the Istanbul export, in dirhams.
  {
    job: 1049,
    charge: 'thc_origin',
    amount: '2800.00',
    currency: 'AED',
    fxRate: '0.083500',
    markup: '1.22',
    party: 'carrier',
  },
  {
    job: 1049,
    charge: 'documentation',
    amount: '500.00',
    currency: 'AED',
    fxRate: '0.083500',
    markup: '1.45',
    party: 'carrier',
  },
  {
    job: 1049,
    charge: 'storage',
    amount: '880.00',
    currency: 'AED',
    fxRate: '0.083500',
    markup: '1.25',
    party: 'carrier',
  },
]

/**
 * The supplier bills, line by line, and which of our costs each one claims.
 *
 * A line with a `charge` and a `job` is matched to the charge line that job's
 * ledger holds for that charge code — matched *by reference*, never by a
 * second copy of the figure, which is what makes it impossible for the two
 * screens to disagree about what was accrued.
 *
 * The lines are authored to sum to the `total` its seed above already states
 * and to leave exactly the `varianceBase` it already states, so the payables
 * register and this page report one number. Two lines on `8842` name no job at
 * all — a congestion surcharge and an equipment fee nobody accrued — which is
 * the other half of `FR-FN-09`: a charge billed against nothing is as much a
 * finding as a charge billed over.
 */
interface BillLineSeed {
  readonly bill: number
  readonly description: string
  readonly charge: ChargeKey | null
  readonly job: number | null
  readonly quantity: string
  readonly billed: string
}

const BILL_LINE_SEEDS: readonly BillLineSeed[] = [
  // ONE, against the Ningbo box sitting in customs. The freight line is the
  // one this whole feature exists for: a GRI landed between booking and
  // invoice and 96 KWD of it is nobody's agreement.
  {
    bill: 8841,
    description: 'OCEAN FREIGHT NINGBO/SHUWAIKH — 3 X 40HC',
    charge: 'ocean_freight',
    job: 1041,
    quantity: '3',
    billed: '1056.000',
  },
  {
    bill: 8841,
    description: 'ORIGIN TERMINAL HANDLING',
    charge: 'thc_origin',
    job: 1041,
    quantity: '3',
    billed: '180.000',
  },
  {
    bill: 8841,
    description: 'DESTINATION TERMINAL HANDLING',
    charge: 'thc_destination',
    job: 1041,
    quantity: '3',
    billed: '96.000',
  },
  {
    bill: 8841,
    description: 'BILL OF LADING FEE',
    charge: 'documentation',
    job: 1041,
    quantity: '1',
    billed: '24.000',
  },
  {
    bill: 8841,
    description: 'DELIVERY ORDER FEE',
    charge: 'delivery_order',
    job: 1041,
    quantity: '1',
    billed: '24.000',
  },

  // Everbright's monthly account, across two shipments.
  {
    bill: 8842,
    description: 'ORIGIN THC — SHANGHAI',
    charge: 'thc_origin',
    job: 1044,
    quantity: '4',
    billed: '960.00',
  },
  {
    bill: 8842,
    description: 'EXPORT DOCUMENTATION',
    charge: 'documentation',
    job: 1044,
    quantity: '1',
    billed: '300.00',
  },
  {
    bill: 8842,
    description: 'EXPORT DOCUMENTATION',
    charge: 'documentation',
    job: 1046,
    quantity: '1',
    billed: '120.00',
  },
  {
    bill: 8842,
    description: 'ORIGIN THC — NINGBO',
    charge: 'thc_origin',
    job: 1046,
    quantity: '2',
    billed: '400.00',
  },
  {
    bill: 8842,
    description: 'PORT CONGESTION SURCHARGE',
    charge: null,
    job: null,
    quantity: '1',
    billed: '40.00',
  },
  {
    bill: 8842,
    description: 'EQUIPMENT IMBALANCE FEE',
    charge: null,
    job: null,
    quantity: '1',
    billed: '30.00',
  },

  {
    bill: 8840,
    description: 'HAULAGE SHUWAIKH/SHUAIBA — 2 X 40FT',
    charge: 'haulage',
    job: 1035,
    quantity: '2',
    billed: '110.000',
  },
  {
    bill: 8840,
    description: 'HAULAGE SHUWAIKH/ARDIYA — 1 X 20FT',
    charge: 'haulage',
    job: 1033,
    quantity: '1',
    billed: '55.000',
  },

  // The disputed one. Six days of detention against an accrual of two, and a
  // storage charge on a terminal nobody engaged.
  {
    bill: 8837,
    description: 'DETENTION — 6 DAYS, NHAVA SHEVA',
    charge: 'detention',
    job: 1039,
    quantity: '6',
    billed: '480.00',
  },
  {
    bill: 8837,
    description: 'DELIVERY ORDER FEE',
    charge: 'delivery_order',
    job: 1039,
    quantity: '1',
    billed: '60.00',
  },
  {
    bill: 8837,
    description: 'TERMINAL STORAGE — 3 DAYS',
    charge: null,
    job: null,
    quantity: '3',
    billed: '440.00',
  },

  {
    bill: 8843,
    description: 'CARGO HANDLING — KWI CARGO VILLAGE',
    charge: 'thc_origin',
    job: 1049,
    quantity: '1',
    billed: '2800.00',
  },
  {
    bill: 8843,
    description: 'AIR WAYBILL FEE',
    charge: 'documentation',
    job: 1049,
    quantity: '1',
    billed: '500.00',
  },
  {
    bill: 8843,
    description: 'WAREHOUSE STORAGE — 2 DAYS',
    charge: 'storage',
    job: 1049,
    quantity: '2',
    billed: '880.00',
  },

  {
    bill: 8838,
    description: 'CUSTOMS CLEARANCE — IMPORT DECLARATION',
    charge: 'customs_clearance',
    job: 1035,
    quantity: '1',
    billed: '45.000',
  },
  {
    bill: 8838,
    description: 'CUSTOMS CLEARANCE — IMPORT DECLARATION',
    charge: 'customs_clearance',
    job: 1033,
    quantity: '1',
    billed: '45.000',
  },
  {
    bill: 8838,
    description: 'INSPECTION ATTENDANCE — YARD 4',
    charge: 'inspection',
    job: 1036,
    quantity: '1',
    billed: '120.000',
  },

  {
    bill: 8835,
    description: 'YARD STORAGE — 3 DAYS',
    charge: 'storage',
    job: 1036,
    quantity: '3',
    billed: '96.000',
  },
]

/** A charge line's synthetic id — the job and the charge code, which is unique per side. */
function chargeLineId(jobSeq: number, charge: ChargeKey, direction: 'cost' | 'revenue'): string {
  return `chg-${jobSeq}-${charge}-${direction === 'cost' ? 'c' : 'r'}`
}

/**
 * Which company on the job file a cost is owed to.
 *
 * The same four choices `partnersFor` makes, plus the terminal, which is not
 * on the partner panel because nobody engages a port authority — the box
 * arrives and the yard bills for it. Restated rather than read off
 * `partnersFor` because that function answers a different question: who is on
 * the shipment, not who is owed for this line.
 */
function ledgerParty(seed: JobSeed, party: LedgerParty): PartnerKey | null {
  switch (party) {
    case 'carrier':
      return seed.mode === 'air' ? 'ek' : 'one'
    case 'agent': {
      const farEnd = seed.direction === 'import' ? seed.origin : seed.destination
      return FAR_END_AGENTS[PORTS[farEnd].country] ?? 'gac'
    }
    case 'broker':
      return seed.branch === 'KWI' ? 'shamali' : 'gulfbridge'
    case 'haulier':
      return seed.branch === 'KWI' ? 'ktrans' : 'desert'
    case 'terminal':
      return seed.branch === 'KWI' ? 'kpa' : 'dpw'
  }
}

/** One accrued cost, before it is projected into a ledger row or a candidate. */
interface JobAccrual {
  readonly jobSeq: number
  readonly charge: ChargeKey
  readonly quantity: string
  readonly rate: string
  readonly amount: string
  readonly currency: string
  readonly fxRate: string
  readonly amountBase: string
  readonly markup: string
  readonly partner: PartnerKey | null
  readonly sourceKind: string | null
}

/**
 * Everything one shipment has cost, in the currency each part was committed in.
 *
 * Three sources, in the order they override each other: the shape for the mode,
 * the foreign-currency accruals that replace individual lines of it, and the
 * free-time clock, which wrote its own line and is the beat Pilot §3.1 builds
 * the demo around — *"nobody had to remember to add this"*.
 */
function jobAccruals(seed: JobSeed, now: number): JobAccrual[] {
  const home = branch(seed.branch)
  const scale = new D(BRANCH_RATE_SCALE[seed.branch])
  const foreign = FOREIGN_ACCRUALS.filter((row) => row.job === seed.seq)

  const quantityOf = (quantity: LedgerQuantity): Dec => {
    if (quantity === 'containers') return new D(Math.max(seed.containers, 1))
    // The chargeable weight `jobDetail` puts on an air job, and null on a sea
    // one — where the shape never asks for it.
    if (quantity === 'chargeable_weight') return new D(2100 + seed.seq)
    return new D(quantity)
  }

  const rows: JobAccrual[] = []

  for (const line of LEDGER_SHAPES[seed.template]!) {
    if (line.when === 'customs' && seed.customs === undefined) continue
    if (line.when === 'delivered' && seed.done < 5) continue
    if (line.when === 'inspection' && seed.customs !== 'inspection') continue
    // A foreign accrual for the same charge replaces the shape's line rather
    // than sitting beside it: one cost, committed once, in one currency.
    if (foreign.some((row) => row.charge === line.charge)) continue

    const quantity = quantityOf(line.quantity)
    const rate = new D(line.rate).times(scale)
    rows.push({
      jobSeq: seed.seq,
      charge: line.charge,
      quantity: numeric(quantity),
      rate: numeric(rate),
      amount: numeric(quantity.times(rate)),
      currency: home.currency,
      fxRate: numeric('1'),
      amountBase: numeric(quantity.times(rate)),
      markup: line.markup,
      partner: ledgerParty(seed, line.party),
      sourceKind: null,
    })
  }

  for (const row of foreign) {
    rows.push({
      jobSeq: seed.seq,
      charge: row.charge,
      quantity: numeric('1'),
      rate: numeric(row.amount),
      amount: numeric(row.amount),
      currency: row.currency,
      fxRate: numeric(row.fxRate),
      amountBase: numeric(new D(row.amount).times(new D(row.fxRate))),
      markup: row.markup,
      partner: ledgerParty(seed, row.party),
      sourceKind: null,
    })
  }

  /*
    The demurrage, taken straight off the clock rather than restated.

    `clocksFor` decides how many days are chargeable and what they cost, and
    the job file prints that figure in the free-time card three cards above
    this one. A ledger line stating its own number would be the one place on
    the screen where the same fact appears twice and could differ.
  */
  for (const clock of clocksFor(seed, now)) {
    if (!clock.chargeLineWritten || clock.chargeableDays <= 0) continue
    const days = new D(clock.chargeableDays)
    const accrued = new D(clock.accrued.amount)
    rows.push({
      jobSeq: seed.seq,
      // The three clock kinds are three charge codes of the same name.
      charge: clock.kind,
      quantity: numeric(days),
      rate: numeric(accrued.div(days)),
      amount: numeric(accrued),
      currency: clock.accrued.currency,
      fxRate: numeric('1'),
      amountBase: numeric(accrued),
      markup: '1.00',
      partner: ledgerParty(seed, 'carrier'),
      sourceKind: 'free_time_clock',
    })
  }

  return rows
}

/** Every match against one job's charge lines, by charge code. */
function matchesAgainst(jobSeq: number, charge: ChargeKey): BillLineSeed[] {
  return BILL_LINE_SEEDS.filter((line) => line.job === jobSeq && line.charge === charge)
}

/**
 * The margin floor both entities trade to — `FR-FN-05`.
 *
 * A branch column in the real system, and one figure here because both
 * branches of this forwarder are the same business. It is what decides whether
 * the P&L card shows its red band, so it belongs beside the ledger rather than
 * in `pilotBranches`, which is the administration screen's shape and does not
 * carry it.
 */
const MARGIN_FLOOR_PERCENT = '12.000000'

/**
 * Serves `getJobLedger` — the lines, before `jobMargin` reduces them.
 *
 * Cost lines first and revenue after, which is the query's `order by
 * direction` and not a presentation choice: the card reads them in that order
 * and the two modes have to agree about it.
 *
 * `isAccrual` is `matchCount === 0`, and that is the whole meaning of the
 * "still accrued" figure on the card: a cost stands on our own estimate until
 * a supplier has billed for it and somebody has matched the two. A fixture
 * that flagged every cost as an accrual would make that column equal to the
 * cost column on every job, which says nothing.
 */
export function pilotJobLedger(jobId: string, now = Date.now()): JobLedgerRows | undefined {
  const seed = JOB_SEEDS.find((s) => `job-${s.seq}` === jobId || String(s.seq) === jobId)
  if (!seed) return undefined

  const summary = jobSummary(seed, now)
  const home = branch(seed.branch)
  const customer = CUSTOMERS[seed.customer]!
  const accruals = jobAccruals(seed, now)

  const costs = accruals.map((accrual, index): LedgerLineRow => {
    const claims = matchesAgainst(seed.seq, accrual.charge)
    return {
      id: chargeLineId(seed.seq, accrual.charge, 'cost'),
      direction: 'cost',
      chargeTypeId: `charge-${accrual.charge}`,
      chargeTypeName: chargeName(accrual.charge),
      description: null,
      basis: chargeBasis(accrual.charge),
      quantity: accrual.quantity,
      rate: accrual.rate,
      amount: accrual.amount,
      currency: accrual.currency,
      amountBase: accrual.amountBase,
      baseCurrency: home.currency,
      fxRate: accrual.fxRate,
      counterpartyName: accrual.partner === null ? null : partner(accrual.partner).en,
      isAccrual: claims.length === 0,
      sourceKind: accrual.sourceKind,
      // A cost is never billed to a customer; only the revenue beside it is.
      isBilled: false,
      matchedAmount: sum(claims.map((claim) => claim.billed)),
      matchCount: claims.length,
      createdAt: hours(now, -(seed.seq % 30) - 24 - index),
    }
  })

  const revenues = accruals.map((accrual, index): LedgerLineRow => {
    const rate = new D(accrual.amountBase).times(new D(accrual.markup))
    return {
      id: chargeLineId(seed.seq, accrual.charge, 'revenue'),
      direction: 'revenue',
      chargeTypeId: `charge-${accrual.charge}`,
      chargeTypeName: chargeName(accrual.charge),
      description: null,
      basis: chargeBasis(accrual.charge),
      /*
        Priced as one line at the branch's own currency, not as the quantity
        and rate the cost carries.

        The sell side of a job is priced against the customer's quotation, and
        a dollar cost is sold in dinars — carrying the buy quantity across
        would make the two columns look like the same line converted, which is
        precisely what a forwarder does not want a customer to be able to do.
      */
      quantity: numeric('1'),
      rate: numeric(rate),
      amount: numeric(rate),
      currency: home.currency,
      amountBase: numeric(rate),
      baseCurrency: home.currency,
      fxRate: numeric('1'),
      counterpartyName: customer.en,
      isAccrual: false,
      sourceKind: accrual.sourceKind,
      // Invoiced once the shipment has been delivered, which is when a
      // forwarder bills. Until then the revenue is priced and not yet raised.
      isBilled: seed.done >= 6,
      matchedAmount: numeric('0'),
      matchCount: 0,
      createdAt: hours(now, -(seed.seq % 30) - 12 - index),
    }
  })

  return {
    jobId: summary.id,
    jobReference: summary.reference,
    baseCurrency: home.currency,
    marginFloorPercent: MARGIN_FLOOR_PERCENT,
    lines: [...costs, ...revenues],
  }
}

/** A charge type's basis, from the row an administrator edits. */
function chargeBasis(key: ChargeKey): ChargeBasis {
  return CHARGE_TYPE_ROWS.find((row) => row.key === key)!.basis
}

/**
 * Serves `listMatchCandidates` — our cost lines, as the matching dialog offers
 * them.
 *
 * The partner filter is the query's and includes lines with no counterparty
 * recorded, for the reason its comment gives: an unattributed cost is exactly
 * the sort of line that most needs matching, so narrowing it away would hide
 * the ones that matter.
 */
export function pilotMatchCandidates(
  filters: { readonly jobId?: string; readonly partnerId?: string } = {},
  now = Date.now(),
): MatchCandidateRow[] {
  const rows: MatchCandidateRow[] = []

  for (const seed of JOB_SEEDS) {
    const jobId = `job-${seed.seq}`
    if (filters.jobId && filters.jobId !== jobId) continue

    const summary = jobSummary(seed, now)
    for (const accrual of jobAccruals(seed, now)) {
      const counterparty = accrual.partner === null ? null : partnerId(accrual.partner)
      if (filters.partnerId && counterparty !== null && counterparty !== filters.partnerId) continue

      rows.push({
        id: chargeLineId(seed.seq, accrual.charge, 'cost'),
        jobId,
        jobReference: summary.reference,
        chargeTypeId: `charge-${accrual.charge}`,
        chargeTypeName: chargeName(accrual.charge),
        description: null,
        amount: accrual.amount,
        currency: accrual.currency,
        matchedAmount: sum(matchesAgainst(seed.seq, accrual.charge).map((line) => line.billed)),
        counterpartyName: accrual.partner === null ? null : partner(accrual.partner).en,
      })
    }
  }

  // `order by charge_types.sort_order` — the array's own order above, so an
  // agent's ocean freight sits next to ours rather than three rows away.
  const order = CHARGE_TYPE_ROWS.map((row) => `charge-${row.key}`)
  return rows
    .sort((a, b) => order.indexOf(a.chargeTypeId) - order.indexOf(b.chargeTypeId))
    .slice(0, 300)
}

// --- one supplier bill, opened ----------------------------------------------

/** `supplier_invoice_status`. Every value is a key under `payables.statuses`. */
const SUPPLIER_INVOICE_STATUSES: readonly SupplierBillRow['status'][] = [
  'received',
  'approved',
  'part_paid',
  'paid',
  'disputed',
  'void',
]

/**
 * Why a bill is in the state it is in, in the words somebody typed.
 *
 * Only the disputed one has anything to say, and that is the point of the
 * field: `disputed` is a state rather than a flag precisely so the answer to
 * *"why has this not been paid"* is on the record instead of in a mailbox.
 */
const BILL_NOTES: Record<
  number,
  { readonly notes: string | null; readonly dispute: string | null }
> = {
  8837: {
    notes: 'Agent asked to re-issue against the agreed detention days.',
    dispute:
      'Six days of detention billed against two accrued, and a terminal storage line for a terminal we did not engage. Held pending their explanation.',
  },
  8841: {
    notes: 'GRI landed between booking and invoice — origin desk asked to confirm.',
    dispute: null,
  },
}

/**
 * Serves `getSupplierInvoice` — the bill, its lines, and its matches.
 *
 * The header comes from `pilotSupplierInvoices`, so every figure on this page
 * is the figure the payables register showed a second earlier. The lines are
 * `BILL_LINE_SEEDS` and the matches are those of them that name a job, joined
 * to that job's own charge line — which is what lets `compareToAccrual` run
 * over the real pair rather than over a stated variance.
 */
export function pilotSupplierInvoice(id: string, now = Date.now()): SupplierBillRows | undefined {
  const row = pilotSupplierInvoices(now).find((candidate) => candidate.id === id)
  if (!row) return undefined

  const seq = Number(id.replace('sup-', ''))
  const seed = SUPPLIER_INVOICE_SEEDS.find((candidate) => candidate.seq === seq)!
  const partnerRow = pilotPartner(row.partnerId, now)!
  const words = BILL_NOTES[seq] ?? { notes: null, dispute: null }

  const lineSeeds = BILL_LINE_SEEDS.filter((line) => line.bill === seq)
  const lines = lineSeeds.map((line, index): SupplierBillLineRow => ({
    id: `supl-${seq}-${index + 1}`,
    description: line.description,
    chargeTypeId: line.charge === null ? null : `charge-${line.charge}`,
    chargeTypeName: line.charge === null ? null : chargeName(line.charge),
    /*
      No charge-type tolerance in the pilot, and that is not a gap.

      `resolveTolerance` is specific-beats-general with no blending: a partner
      who has a limit configured is held to it on every code. The carriers here
      are allowed 1% and the agents 2.5%, which is the arrangement the partner
      file states, and a charge-type row set as well would only ever be the one
      that lost.
    */
    tolerancePercent: null,
    toleranceAbsolute: null,
    jobId: line.job === null ? null : `job-${line.job}`,
    jobReference: line.job === null ? null : jobSummary(jobSeed(line.job), now).reference,
    quantity: numeric(line.quantity),
    unitPrice: numeric(new D(line.billed).div(new D(line.quantity))),
    amount: numeric(line.billed),
    // Kuwait charges no VAT and every bill here is bought by the Kuwait
    // entity, so the tax column is zero throughout rather than absent.
    taxAmount: numeric('0'),
  }))

  const matches: SupplierBillMatchRow[] = []
  lineSeeds.forEach((line, index) => {
    if (line.charge === null || line.job === null) return
    const seedJob = jobSeed(line.job)
    const accrual = jobAccruals(seedJob, now).find((row_) => row_.charge === line.charge)
    if (accrual === undefined) return

    matches.push({
      id: `supm-${seq}-${index + 1}`,
      lineId: `supl-${seq}-${index + 1}`,
      chargeLineId: chargeLineId(line.job, line.charge, 'cost'),
      // What the match claims off the supplier's line, in the supplier's
      // currency — the whole line, which is the ordinary case.
      claimed: numeric(line.billed),
      jobId: `job-${line.job}`,
      jobReference: jobSummary(seedJob, now).reference,
      chargeTypeName: chargeName(line.charge),
      accruedBase: accrual.amountBase,
      accruedAmount: accrual.amount,
      accruedCurrency: accrual.currency,
    })
  })

  const approved = ['approved', 'part_paid', 'paid'].includes(row.status)

  return {
    bill: {
      id: row.id,
      reference: row.reference,
      branchId: branch('KWI').id,
      partnerId: row.partnerId,
      partnerName: row.partnerName,
      partnerTolerancePercent: partnerRow.varianceTolerancePercent,
      partnerToleranceAbsolute: partnerRow.varianceToleranceAbsolute,
      status: oneOf(SUPPLIER_INVOICE_STATUSES, row.status, 'supplier invoice status'),
      currency: row.currency,
      baseCurrency: row.baseCurrency,
      // Nothing on this board is taxed, so the subtotal is the total. Stated
      // as a subtraction anyway: a bill with VAT on it would break a constant.
      subtotal: minus(row.total, numeric('0')),
      taxAmount: numeric('0'),
      total: row.total,
      amountPaid: row.amountPaid,
      fxRate: numeric(seed.fxRate),
      invoiceDate: row.invoiceDate,
      dueOn: row.dueOn,
      assetId: null,
      varianceAcceptedReason: null,
      disputeReason: words.dispute,
      notes: words.notes,
      approvedAt: approved ? at(now, -seed.dated + 2, 10) : null,
      settlementId: null,
    },
    lines,
    matches,
  }
}

/** The job seed behind a sequence number, which every reference above is one of. */
function jobSeed(seq: number): JobSeed {
  return JOB_SEEDS.find((seed) => seed.seq === seq)!
}

// --- the agent current account ---------------------------------------------

/**
 * The invoices we raise *on* the two agents we also bill.
 *
 * Held apart from `INVOICE_SEEDS` on purpose, and the reason is that list's
 * own: it is the receivables *register's* dataset, `receivablesAgeing` sums
 * balances across currencies and labels the total with whichever it finds
 * first, and an open dollar invoice dropped into it would put dollars into a
 * Kuwaiti dinar total. These are raised in each agent's settlement currency —
 * netting a dollar payable against a dinar receivable is not netting — so they
 * belong to the account screen and nowhere else.
 *
 * There is one overdue on each side, because an ageing chart where everything
 * sits in `current` demonstrates that the chart renders and nothing else.
 */
interface AgentInvoiceSeed {
  readonly seq: number
  readonly partner: PartnerKey
  readonly branch: BranchCode
  readonly total: string
  readonly paid: string
  /** Days ago it was issued, and the terms it was issued on. */
  readonly issued: number
  readonly termsDays: number
}

const AGENT_INVOICE_SEEDS: readonly AgentInvoiceSeed[] = [
  {
    seq: 5041,
    partner: 'everbright',
    branch: 'KWI',
    total: '1240.00',
    paid: '0',
    issued: 22,
    termsDays: 45,
  },
  {
    seq: 5036,
    partner: 'everbright',
    branch: 'KWI',
    total: '780.00',
    paid: '0',
    issued: 53,
    termsDays: 45,
  },
  {
    seq: 3082,
    partner: 'gac',
    branch: 'DXB',
    total: '3150.00',
    paid: '0',
    issued: 25,
    termsDays: 45,
  },
  {
    seq: 3077,
    partner: 'gac',
    branch: 'DXB',
    total: '1420.00',
    paid: '0',
    issued: 50,
    termsDays: 45,
  },
]

/** The bill statuses the account is drawn from — anything still open either way. */
const ACCOUNT_BILL_STATUSES = ['received', 'approved', 'part_paid', 'disputed']

/**
 * Serves `getPartnerAccount` — the entries, before `core` nets and ages them.
 *
 * Both sides are filtered to the settlement currency, which is the query's own
 * filter and not a simplification: an account netted across currencies is an
 * account nobody can settle. Documents already claimed by a settlement are
 * absent for the same reason they are excluded there — they have been dealt
 * with, and showing them again is how the same invoice gets netted twice.
 */
export function pilotPartnerAccount(id: string, now = Date.now()): PartnerAccountRows | undefined {
  const seed = PARTNERS.find((p) => partnerId(p.id) === id)
  if (!seed) return undefined

  const currency =
    ('settlementCurrency' in seed ? (seed.settlementCurrency as string) : null) ??
    seed.currency ??
    'KWD'
  const customerId_ =
    'settlementCustomer' in seed ? customerId(seed.settlementCustomer as number) : null

  const ours: StatementEntryRow[] = AGENT_INVOICE_SEEDS.filter(
    (row) => row.partner === seed.id && customerId_ !== null,
  ).map((row) => ({
    id: `agentinv-${row.seq}`,
    kind: 'invoice',
    date: at(now, -row.issued, 11),
    reference: `${row.branch}-${String(row.seq).padStart(6, '0')}`,
    description: 'Invoice',
    amount: numeric(row.total),
    outstanding: minus(numeric(row.total), numeric(row.paid)),
    dueOn: new Date(Date.parse(day(now, -row.issued + row.termsDays))),
  }))

  const theirs: StatementEntryRow[] = pilotSupplierInvoices(now, { partnerId: id })
    .filter((row) => row.currency === currency && ACCOUNT_BILL_STATUSES.includes(row.status))
    .map((row) => ({
      id: row.id,
      kind: 'bill',
      date: new Date(Date.parse(row.invoiceDate)),
      reference: row.reference,
      description: 'Supplier invoice',
      amount: row.total,
      outstanding: minus(row.total, row.amountPaid),
      dueOn: row.dueOn === null ? null : new Date(Date.parse(row.dueOn)),
    }))

  return {
    partnerId: id,
    partnerName: seed.en,
    currency,
    customerId: customerId_,
    entries: [...ours, ...theirs],
  }
}

// --- one settlement, opened -------------------------------------------------

/**
 * What each monthly set-off claimed.
 *
 * The lines sum to the two totals `pilotSettlements` already put on the
 * register row — invoices to `receivableTotal`, bills to `payableTotal` —
 * which is the whole discipline of this section: the reader clicked that row a
 * second ago and the documents behind it have to add up to what it said.
 *
 * They are documents of the settled period rather than of the live book. An
 * agreed statement claims its documents and closes them, which is exactly why
 * `getPartnerAccount` above excludes anything a settlement has taken — so the
 * registers, which draw the open book, do not carry these and should not.
 */
interface SettlementLineSeed {
  readonly settlement: number
  readonly kind: 'invoice' | 'bill'
  readonly seq: number
  readonly reference: string
  readonly amount: string
}

const SETTLEMENT_LINE_SEEDS: readonly SettlementLineSeed[] = [
  { settlement: 119, kind: 'invoice', seq: 5012, reference: 'KWI-005012', amount: '1900.00' },
  { settlement: 119, kind: 'invoice', seq: 5016, reference: 'KWI-005016', amount: '1250.00' },
  { settlement: 119, kind: 'bill', seq: 8802, reference: 'EBL-SH-4402', amount: '3100.00' },
  { settlement: 119, kind: 'bill', seq: 8818, reference: 'EBL-SH-4418', amount: '2140.00' },

  { settlement: 118, kind: 'invoice', seq: 3402, reference: 'DXB-003402', amount: '5300.00' },
  { settlement: 118, kind: 'invoice', seq: 3417, reference: 'DXB-003417', amount: '3500.00' },
  { settlement: 118, kind: 'bill', seq: 8720, reference: 'GAC-AE-88120', amount: '4100.00' },
  { settlement: 118, kind: 'bill', seq: 8755, reference: 'GAC-AE-88155', amount: '2150.00' },

  { settlement: 117, kind: 'invoice', seq: 4980, reference: 'KWI-004980', amount: '2600.00' },
  { settlement: 117, kind: 'invoice', seq: 4991, reference: 'KWI-004991', amount: '1600.00' },
  { settlement: 117, kind: 'bill', seq: 8660, reference: 'EBL-SH-4360', amount: '3900.00' },
  { settlement: 117, kind: 'bill', seq: 8672, reference: 'EBL-SH-4372', amount: '2910.00' },
]

/** What was written on the statement when it was drawn. */
const SETTLEMENT_NOTES: Record<number, string | null> = {
  119: 'Draft for the current period — still moving as documents land.',
  118: 'Agreed on their statement of the same period. Residual to follow by transfer.',
  117: 'Closed. Residual paid against their October statement.',
}

/**
 * Serves `getSettlement`.
 *
 * Every header figure is taken from the register row rather than restated, and
 * the arithmetic that produced it — the offset, the residual and its direction
 * — ran once, in `pilotSettlements`, against `settlement.ts`'s own rules.
 */
export function pilotSettlement(id: string, now = Date.now()): SettlementDetail | undefined {
  const row = pilotSettlements(now).find((candidate) => candidate.id === id)
  if (!row) return undefined

  const seq = Number(id.replace('settle-', ''))
  const seed = SETTLEMENT_SEEDS.find((candidate) => candidate.seq === seq)!

  return {
    ...row,
    branchId: branch(seed.branch).id,
    notes: SETTLEMENT_NOTES[seq] ?? null,
    voidReason: null,
    lines: SETTLEMENT_LINE_SEEDS.filter((line) => line.settlement === seq)
      .map((line): SettlementLineRow => ({
        id: `setl-${seq}-${line.seq}`,
        kind: line.kind,
        reference: line.reference,
        amount: numeric(line.amount),
        // Nothing here is claimed in part: a set-off that half-claims an
        // invoice leaves a balance neither side can explain a month later.
        isFull: true,
        documentId: `${line.kind === 'invoice' ? 'inv' : 'sup'}-${line.seq}`,
      }))
      // `order by kind` — our invoices, then theirs.
      .sort((a, b) => a.kind.localeCompare(b.kind)),
  }
}

// --- one consolidation, opened ---------------------------------------------

/**
 * The houses under each master, and the cargo figures the split is made on.
 *
 * One house apiece, and that is a statement rather than a shortcut. A house is
 * a *job*, the manifest links to it, and a master carrying houses the board
 * does not draw would put three links on this page that resolve to nothing —
 * which is a worse answer than a small consolidation. The board holds one
 * groupage shipment on each of these lanes, so each master holds one, and
 * `pilotConsolidations` counts these rows rather than stating a number beside
 * them: the register's house count and this page's house list are the same
 * fact and cannot be allowed to differ.
 *
 * The volumes and weights are `job_cargo` sums in the real query, which is a
 * table the pilot does not draw — `listJobCargo` returns nothing. They are
 * authored here because the allocation basis reads them, and a master whose
 * houses all measure zero is one `allocateConsolCharge` refuses to split.
 */
interface ConsolidationHouseSeed {
  readonly consolidation: number
  readonly job: number
  readonly packages: number
  readonly grossWeightKg: string
  readonly volumeCbm: string
}

const CONSOLIDATION_HOUSE_SEEDS: readonly ConsolidationHouseSeed[] = [
  { consolidation: 441, job: 1047, packages: 86, grossWeightKg: '4180.000', volumeCbm: '12.400' },
  { consolidation: 438, job: 1038, packages: 142, grossWeightKg: '6820.000', volumeCbm: '18.600' },
  { consolidation: 442, job: 1049, packages: 24, grossWeightKg: '1840.000', volumeCbm: '6.200' },
]

/**
 * What the master itself cost, and whether it has been split yet.
 *
 * The unallocated ones are the number the consolidation register exists to
 * surface: a master cost raised and not yet pushed down onto the houses is a
 * cost sitting on nobody's P&L, and it stays invisible until somebody closes
 * the month. `441` carries two of them.
 */
interface ConsolChargeSeed {
  readonly consolidation: number
  readonly charge: ChargeKey
  readonly party: PartnerKey
  readonly amount: string
  readonly basis: ConsolidationChargeRow['allocationBasis']
  /** Days ago it was split across the houses, or null while it still is not. */
  readonly allocated: number | null
}

const CONSOL_CHARGE_SEEDS: readonly ConsolChargeSeed[] = [
  {
    consolidation: 441,
    charge: 'ocean_freight',
    party: 'one',
    amount: '1450.000',
    basis: 'volume',
    allocated: null,
  },
  {
    consolidation: 441,
    charge: 'thc_destination',
    party: 'kpa',
    amount: '240.000',
    basis: 'volume',
    allocated: null,
  },
  {
    consolidation: 441,
    charge: 'documentation',
    party: 'one',
    amount: '60.000',
    basis: 'equal',
    allocated: 4,
  },

  {
    consolidation: 438,
    charge: 'ocean_freight',
    party: 'one',
    amount: '1980.000',
    basis: 'volume',
    allocated: 10,
  },
  {
    consolidation: 438,
    charge: 'thc_destination',
    party: 'kpa',
    amount: '320.000',
    basis: 'gross_weight',
    allocated: 10,
  },

  {
    consolidation: 442,
    charge: 'air_freight',
    party: 'ek',
    amount: '980.000',
    basis: 'chargeable_weight',
    allocated: null,
  },
  {
    consolidation: 442,
    charge: 'documentation',
    party: 'ek',
    amount: '45.000',
    basis: 'equal',
    allocated: 1,
  },
]

/** The houses of one master, as `getConsolidation` reads them. */
function consolidationHouses(seq: number, now: number): ConsolidationHouseRow[] {
  return CONSOLIDATION_HOUSE_SEEDS.filter((house) => house.consolidation === seq)
    .map((house): ConsolidationHouseRow => {
      const seed = jobSeed(house.job)
      const detail = jobDetail(seed, now)
      return {
        jobId: detail.id,
        reference: detail.reference,
        houseBillNumber: detail.houseBillNumber,
        customerName: detail.customerName,
        status: detail.status,
        packages: house.packages,
        grossWeightKg: numeric(house.grossWeightKg),
        volumeCbm: numeric(house.volumeCbm),
        chargeableWeightKg:
          detail.chargeableWeightKg === null ? null : numeric(String(detail.chargeableWeightKg)),
      }
    })
    .sort((a, b) => a.reference.localeCompare(b.reference))
}

/** The master costs on one consolidation, cost side first, as the query orders them. */
function consolidationCharges(seq: number, now: number): ConsolidationChargeRow[] {
  const home = branch(CONSOLIDATION_SEEDS.find((row) => row.seq === seq)!.branch)
  return CONSOL_CHARGE_SEEDS.filter((charge) => charge.consolidation === seq).map(
    (charge, index): ConsolidationChargeRow => ({
      id: `consolchg-${seq}-${index + 1}`,
      // Every master line here is a cost. Revenue on a groupage master is
      // raised on the houses, which is what the allocation puts there.
      direction: 'cost',
      chargeTypeName: chargeName(charge.charge),
      description: null,
      amount: numeric(charge.amount),
      currency: home.currency,
      amountBase: numeric(charge.amount),
      baseCurrency: home.currency,
      allocationBasis: charge.basis,
      allocatedAt: charge.allocated === null ? null : at(now, -charge.allocated, 10),
      counterpartyName: partner(charge.party).en,
      shareCount:
        charge.allocated === null
          ? 0
          : CONSOLIDATION_HOUSE_SEEDS.filter((house) => house.consolidation === seq).length,
    }),
  )
}

/** How many master costs on one consolidation are still unsplit. */
function consolidationUnallocated(seq: number): number {
  return CONSOL_CHARGE_SEEDS.filter(
    (charge) => charge.consolidation === seq && charge.allocated === null,
  ).length
}

/**
 * Serves `getConsolidation` — the master's row and the two lists under it.
 *
 * The totals are not here: the query reduces the houses itself, and letting it
 * do so in both modes is what stops a fixture's stated volume drifting from
 * the houses it lists.
 */
export function pilotConsolidation(
  id: string,
  now = Date.now(),
): ConsolidationDetailRows | undefined {
  const row = pilotConsolidations(now, {}).find((candidate) => candidate.id === id)
  if (!row) return undefined

  const seq = Number(id.replace('consol-', ''))
  const seed = CONSOLIDATION_SEEDS.find((candidate) => candidate.seq === seq)!
  const carrier: PartnerKey = seed.mode === 'air' ? 'ek' : 'one'

  return {
    row: {
      id: row.id,
      branchId: branch(seed.branch).id,
      reference: row.reference,
      status: row.status,
      mode: row.mode,
      tradeDirection: row.tradeDirection,
      masterBillNumber: row.masterBillNumber,
      bookingNumber: `BKG${String(seq * 13).padStart(7, '0')}`,
      vesselName: row.vesselName,
      voyageNumber: row.voyageNumber,
      flightNumber: row.flightNumber,
      originName: row.originName,
      destinationName: row.destinationName,
      etd: row.etd,
      eta: row.eta,
      closedAt: seed.status === 'closed' ? at(now, seed.eta + 2, 15) : null,
      notes: null,
      carrierName: partner(carrier).en,
      // Nobody is co-loading on this board. Modelled as absent rather than as
      // the carrier again: a co-loader is another forwarder's box on our
      // master, and saying so falsely is worse than saying nothing.
      coloadPartnerName: null,
    },
    houses: consolidationHouses(seq, now),
    charges: consolidationCharges(seq, now),
  }
}

/**
 * Serves `listAttachableJobs` — what could still join this master.
 *
 * The query's filters, restated: the same branch, the same mode, no master of
 * its own, and neither closed nor cancelled. The branch match is not a nicety
 * — a trigger refuses a cross-branch house, because a Dubai house allocated a
 * share of a Kuwait master cost lands in the wrong entity's books.
 */
export function pilotAttachableJobs(
  consolidationId: string,
  now = Date.now(),
): { readonly id: string; readonly label: string }[] {
  const seq = Number(consolidationId.replace('consol-', ''))
  const seed = CONSOLIDATION_SEEDS.find((candidate) => candidate.seq === seq)
  if (seed === undefined) return []

  const housed = new Set(CONSOLIDATION_HOUSE_SEEDS.map((house) => house.job))

  return JOB_SEEDS.filter(
    (job) =>
      job.branch === seed.branch &&
      job.mode === seed.mode &&
      !housed.has(job.seq) &&
      job.status !== 'closed' &&
      job.status !== 'completed' &&
      job.status !== 'cancelled',
  )
    .map((job) => {
      const summary = jobSummary(job, now)
      return { id: summary.id, label: `${summary.reference} — ${summary.customerName}` }
    })
    .sort((a, b) => b.label.localeCompare(a.label))
}

// --- what a model read off the mail — features/enquiries/proposals.ts -------

/**
 * The extraction queue on the enquiry that arrived by email — `AI-05`.
 *
 * One enquiry carries proposals and the rest do not, which is the shape of a
 * real queue: `enquiry-extract.ts` runs on inbound mail, so a portal enquiry
 * somebody typed has nothing to propose, and the panel renders nothing at all
 * where nothing is pending rather than a permanent empty card.
 *
 * Every row leads with its evidence because that is the feature: confirming
 * *"2 × 40HC, from line 3"* is a different and much faster job than confirming
 * `sea_fcl` against a screen of email. `mode` is the one row whose target was
 * already filled — the accept path refuses to overwrite typing, and a
 * coordinator seeing that badge should expect the refusal rather than meet it.
 *
 * The confidences are `numeric(5,4)`, and they are an ordering hint rather
 * than a probability. Nothing in the product multiplies by them.
 */
interface ProposalSeed {
  readonly field: string
  readonly value: string
  readonly confidence: string
  readonly evidence: string | null
  readonly targetWasEmpty: boolean
}

const PROPOSAL_ENQUIRY = 318

const PROPOSAL_SEEDS: readonly ProposalSeed[] = [
  {
    field: 'mode',
    value: 'sea_fcl',
    confidence: '0.9400',
    evidence: 'we have 2 x 40’HC of steel coils to move',
    targetWasEmpty: false,
  },
  {
    field: 'origin',
    value: 'Ningbo',
    confidence: '0.9100',
    evidence: 'ex Ningbo, cargo ready at the mill',
    targetWasEmpty: true,
  },
  {
    field: 'destination',
    value: 'Shuwaikh',
    confidence: '0.8800',
    evidence: 'delivered to our yard in Shuwaikh',
    targetWasEmpty: true,
  },
  {
    field: 'commodity',
    value: 'Steel coils',
    confidence: '0.8600',
    evidence: '2 x 40’HC of steel coils',
    targetWasEmpty: true,
  },
  {
    field: 'grossWeightKg',
    value: '38400',
    confidence: '0.7900',
    evidence: 'gross 38,400 kgs in total',
    targetWasEmpty: true,
  },
  {
    field: 'incoterm',
    value: 'CFR',
    confidence: '0.6700',
    // The one row with nothing quoted behind it — the panel says so, and says
    // to check the mail before accepting. `evidence` is required-but-nullable
    // in the schema precisely so this case cannot be hidden.
    evidence: null,
    targetWasEmpty: true,
  },
]

/** Serves `enquiryProposals`, oldest first — the query's `order by created_at`. */
export function pilotEnquiryProposals(enquiryId: string): EnquiryProposalRow[] {
  if (enquiryId !== `enq-${PROPOSAL_ENQUIRY}`) return []

  return PROPOSAL_SEEDS.map((seed, index) => ({
    id: `prop-${PROPOSAL_ENQUIRY}-${index + 1}`,
    field: seed.field,
    value: seed.value,
    confidence: seed.confidence,
    evidence: seed.evidence,
    targetWasEmpty: seed.targetWasEmpty,
    model: 'claude-sonnet-4-5',
    promptVersion: 'enquiry-extract@4',
  }))
}
