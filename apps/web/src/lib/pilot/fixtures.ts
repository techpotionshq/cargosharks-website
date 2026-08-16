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

import type {
  ClockView,
  DocumentView,
  EnquirySummary,
  ExceptionView,
  JobDetail,
  JobSummary,
  MilestoneView,
  Mode,
  OpsOverview,
  PortalShipment,
  QuoteComparison,
  TrackingResult,
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

// --- reference data --------------------------------------------------------

const PORTS = {
  KWSWK: { en: 'Shuwaikh', ar: 'الشويخ' },
  KWSAA: { en: 'Shuaiba', ar: 'الشعيبة' },
  KWKWI: { en: 'Kuwait International', ar: 'مطار الكويت الدولي' },
  AEJEA: { en: 'Jebel Ali', ar: 'جبل علي' },
  AEDXB: { en: 'Dubai International', ar: 'مطار دبي الدولي' },
  CNNGB: { en: 'Ningbo', ar: 'نينغبو' },
  CNSHA: { en: 'Shanghai', ar: 'شنغهاي' },
  INNSA: { en: 'Nhava Sheva', ar: 'نهافا شيفا' },
  NLRTM: { en: 'Rotterdam', ar: 'روتردام' },
  DEHAM: { en: 'Hamburg', ar: 'هامبورغ' },
  SAJED: { en: 'Jeddah', ar: 'جدة' },
  TRIST: { en: 'Istanbul', ar: 'إسطنبول' },
} as const

type PortCode = keyof typeof PORTS

/** Stand-in customers — replaced by the client's own list on day 3. */
const CUSTOMERS = [
  { en: 'Gulf Steel Industries', ar: 'صناعات الخليج للحديد' },
  { en: 'Al-Mulla Trading Co.', ar: 'شركة الملا التجارية' },
  { en: 'Kuwait Food Company', ar: 'شركة الكويت للأغذية' },
  { en: 'Boubyan Petrochemicals', ar: 'بوبيان للبتروكيماويات' },
  { en: 'Alghanim Electronics', ar: 'الغانم للإلكترونيات' },
  { en: 'Emirates Building Systems', ar: 'أنظمة البناء الإماراتية' },
  { en: 'Al-Sayer Automotive', ar: 'الساير للسيارات' },
  { en: 'Ministry of Public Works', ar: 'وزارة الأشغال العامة' },
  { en: 'Kirby Building Systems', ar: 'كيربي لأنظمة البناء' },
  { en: 'Gulf Cables & Electrical', ar: 'الخليج للكابلات والصناعات الكهربائية' },
] as const

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

const DOCUMENT_TYPES = [
  ['bill_of_lading', 'Bill of Lading', 'بوليصة الشحن'],
  ['commercial_invoice', 'Commercial Invoice', 'الفاتورة التجارية'],
  ['packing_list', 'Packing List', 'قائمة التعبئة'],
  ['certificate_of_origin', 'Certificate of Origin', 'شهادة المنشأ'],
  ['delivery_order', 'Delivery Order', 'إذن التسليم'],
  ['customs_declaration', 'Customs Declaration', 'البيان الجمركي'],
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
  { seq: 1041, branch: 'KWI', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 0, origin: 'CNNGB', destination: 'KWSWK', status: 'customs', done: 4, etaOffset: -6, transitDays: 24, containers: 3, customs: 'held', owner: 0 },
  { seq: 1039, branch: 'KWI', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 2, origin: 'INNSA', destination: 'KWSWK', status: 'arrived', done: 3, etaOffset: -1, transitDays: 9, containers: 2, customs: 'documents_pending', owner: 1 },
  { seq: 1044, branch: 'KWI', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 4, origin: 'CNSHA', destination: 'KWSWK', status: 'in_transit', done: 2, etaOffset: 5, transitDays: 26, containers: 4, owner: 0 },
  { seq: 1046, branch: 'KWI', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 9, origin: 'CNNGB', destination: 'KWSAA', status: 'in_transit', done: 2, etaOffset: 9, transitDays: 25, containers: 2, owner: 2 },
  { seq: 1047, branch: 'KWI', template: 'sea_import', mode: 'sea_lcl', direction: 'import', customer: 1, origin: 'TRIST', destination: 'KWSWK', status: 'in_transit', done: 2, etaOffset: 3, transitDays: 14, containers: 1, owner: 1 },
  { seq: 1035, branch: 'KWI', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 8, origin: 'NLRTM', destination: 'KWSWK', status: 'delivered', done: 6, etaOffset: -12, transitDays: 28, containers: 2, customs: 'released', owner: 3 },
  { seq: 1033, branch: 'KWI', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 3, origin: 'DEHAM', destination: 'KWSWK', status: 'completed', done: 7, etaOffset: -19, transitDays: 30, containers: 1, customs: 'released', owner: 0 },
  { seq: 1048, branch: 'KWI', template: 'sea_export', mode: 'sea_fcl', direction: 'export', customer: 3, origin: 'KWSWK', destination: 'INNSA', status: 'booked', done: 1, etaOffset: 14, transitDays: 11, containers: 2, owner: 4 },
  { seq: 1045, branch: 'KWI', template: 'sea_export', mode: 'sea_fcl', direction: 'export', customer: 0, origin: 'KWSWK', destination: 'SAJED', status: 'in_transit', done: 4, etaOffset: 2, transitDays: 6, containers: 3, owner: 2 },
  { seq: 1042, branch: 'KWI', template: 'air_export', mode: 'air', direction: 'export', customer: 7, origin: 'KWKWI', destination: 'DEHAM', status: 'in_transit', done: 3, etaOffset: 1, transitDays: 2, containers: 0, owner: 1 },
  { seq: 1043, branch: 'KWI', template: 'air_export', mode: 'air', direction: 'export', customer: 4, origin: 'KWKWI', destination: 'NLRTM', status: 'delivered', done: 6, etaOffset: -3, transitDays: 2, containers: 0, owner: 1 },
  { seq: 1049, branch: 'KWI', template: 'air_export', mode: 'air', direction: 'export', customer: 6, origin: 'KWKWI', destination: 'TRIST', status: 'booked', done: 1, etaOffset: 4, transitDays: 1, containers: 0, owner: 4 },
  { seq: 1036, branch: 'KWI', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 6, origin: 'CNSHA', destination: 'KWSWK', status: 'customs', done: 4, etaOffset: -4, transitDays: 27, containers: 2, customs: 'inspection', owner: 3 },
  { seq: 1038, branch: 'KWI', template: 'sea_import', mode: 'sea_lcl', direction: 'import', customer: 5, origin: 'INNSA', destination: 'KWSWK', status: 'delivered', done: 6, etaOffset: -8, transitDays: 10, containers: 1, customs: 'released', owner: 2 },
  { seq: 2018, branch: 'DXB', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 5, origin: 'CNNGB', destination: 'AEJEA', status: 'in_transit', done: 2, etaOffset: 6, transitDays: 21, containers: 5, owner: 4 },
  { seq: 2019, branch: 'DXB', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 8, origin: 'INNSA', destination: 'AEJEA', status: 'arrived', done: 3, etaOffset: -2, transitDays: 7, containers: 3, customs: 'declaration_filed', owner: 4 },
  { seq: 2016, branch: 'DXB', template: 'sea_export', mode: 'sea_fcl', direction: 'export', customer: 5, origin: 'AEJEA', destination: 'KWSWK', status: 'in_transit', done: 4, etaOffset: 1, transitDays: 5, containers: 2, owner: 2 },
  { seq: 2020, branch: 'DXB', template: 'air_export', mode: 'air', direction: 'export', customer: 4, origin: 'AEDXB', destination: 'KWKWI', status: 'booked', done: 1, etaOffset: 3, transitDays: 1, containers: 0, owner: 3 },
  { seq: 2014, branch: 'DXB', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 9, origin: 'CNSHA', destination: 'AEJEA', status: 'completed', done: 7, etaOffset: -16, transitDays: 22, containers: 4, customs: 'released', owner: 4 },
  { seq: 1050, branch: 'KWI', template: 'sea_import', mode: 'sea_fcl', direction: 'import', customer: 1, origin: 'CNNGB', destination: 'KWSWK', status: 'draft', done: 0, etaOffset: 21, transitDays: 25, containers: 2, owner: 0 },
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
    customerReference: `PO-${2026}-${String(seed.seq * 3).padStart(4, '0')}`,
    masterBillNumber:
      seed.mode === 'air'
        ? `176-${String(seed.seq * 7).padStart(8, '0')}`
        : `${CARRIERS[seed.seq % CARRIERS.length]!.replace(/[^A-Z]/g, '').slice(0, 4) || 'ONEY'}KWI${seed.seq}00`,
    houseBillNumber: `AQP${seed.branch}${String(seed.seq).padStart(6, '0')}`,
    bookingNumber: `BKG${String(seed.seq * 11).padStart(7, '0')}`,
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
    customsNote:
      seed.customs === 'held'
        ? 'Held by Kuwait General Administration of Customs pending origin certificate attestation.'
        : seed.customs === 'inspection'
          ? 'Physical inspection scheduled — yard 4.'
          : null,
  }
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
  { seq: 318, branch: 'KWI', status: 'new', channel: 'email', mode: 'sea_fcl', customer: 0, origin: 'CNNGB', destination: 'KWSWK', owner: null, age: 26, sla: 24 },
  { seq: 319, branch: 'KWI', status: 'new', channel: 'portal', mode: 'air', customer: 4, origin: 'KWKWI', destination: 'DEHAM', owner: null, age: 21, sla: 24 },
  { seq: 317, branch: 'KWI', status: 'assigned', channel: 'whatsapp', mode: 'sea_fcl', customer: 2, origin: 'INNSA', destination: 'KWSWK', owner: 1, age: 30, sla: 24 },
  { seq: 320, branch: 'KWI', status: 'rating', channel: 'email', mode: 'sea_lcl', customer: 9, origin: 'TRIST', destination: 'KWSWK', owner: 2, age: 6, sla: 24 },
  { seq: 321, branch: 'KWI', status: 'new', channel: 'phone', mode: 'sea_fcl', customer: 8, origin: 'CNSHA', destination: 'KWSAA', owner: null, age: 3, sla: 24 },
  { seq: 316, branch: 'KWI', status: 'quoted', channel: 'email', mode: 'sea_fcl', customer: 3, origin: 'KWSWK', destination: 'INNSA', owner: 0, age: 34, sla: 24, respondedAfter: 2, sell: 1840, margin: 18.5 },
  { seq: 315, branch: 'KWI', status: 'quoted', channel: 'portal', mode: 'air', customer: 7, origin: 'KWKWI', destination: 'NLRTM', owner: 1, age: 46, sla: 24, respondedAfter: 1, sell: 3260, margin: 22.4 },
  { seq: 314, branch: 'KWI', status: 'won', channel: 'email', mode: 'sea_fcl', customer: 0, origin: 'CNNGB', destination: 'KWSWK', owner: 0, age: 62, sla: 24, respondedAfter: 3, sell: 4720, margin: 16.2 },
  { seq: 313, branch: 'DXB', status: 'quoted', channel: 'email', mode: 'sea_fcl', customer: 5, origin: 'CNNGB', destination: 'AEJEA', owner: 4, age: 40, sla: 24, respondedAfter: 5, sell: 2980, margin: 14.8 },
  { seq: 322, branch: 'DXB', status: 'assigned', channel: 'email', mode: 'sea_fcl', customer: 8, origin: 'INNSA', destination: 'AEJEA', owner: 4, age: 12, sla: 24 },
  { seq: 323, branch: 'DXB', status: 'new', channel: 'portal', mode: 'air', customer: 4, origin: 'AEDXB', destination: 'KWKWI', owner: null, age: 2, sla: 24 },
  { seq: 312, branch: 'KWI', status: 'lost', channel: 'email', mode: 'sea_fcl', customer: 6, origin: 'DEHAM', destination: 'KWSWK', owner: 3, age: 96, sla: 24, respondedAfter: 28, sell: 3110, margin: 11.2 },
  { seq: 311, branch: 'KWI', status: 'won', channel: 'whatsapp', mode: 'sea_lcl', customer: 1, origin: 'INNSA', destination: 'KWSWK', owner: 2, age: 120, sla: 24, respondedAfter: 4, sell: 980, margin: 24.1 },
  { seq: 324, branch: 'KWI', status: 'rating', channel: 'email', mode: 'sea_fcl', customer: 5, origin: 'CNNGB', destination: 'KWSWK', owner: 0, age: 9, sla: 24 },
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
          { chargeCode: 'ocean_freight', nameEn: 'Ocean Freight', nameAr: 'أجرة الشحن البحري', basis: 'per_container', quantity: 1, buyRate: 980, sellRate: 1180, amount: { amount: 1180, currency: 'KWD' } },
          { chargeCode: 'thc_origin', nameEn: 'Terminal Handling — Origin', nameAr: 'مناولة المحطة - المنشأ', basis: 'per_container', quantity: 1, buyRate: 118, sellRate: 145, amount: { amount: 145, currency: 'KWD' } },
          { chargeCode: 'thc_destination', nameEn: 'Terminal Handling — Destination', nameAr: 'مناولة المحطة - الوجهة', basis: 'per_container', quantity: 1, buyRate: 132, sellRate: 168, amount: { amount: 168, currency: 'KWD' } },
          { chargeCode: 'documentation', nameEn: 'Documentation', nameAr: 'رسوم المستندات', basis: 'flat', quantity: 1, buyRate: 22, sellRate: 45, amount: { amount: 45, currency: 'KWD' } },
          { chargeCode: 'delivery_order', nameEn: 'Delivery Order', nameAr: 'إذن التسليم', basis: 'flat', quantity: 1, buyRate: 32, sellRate: 42, amount: { amount: 42, currency: 'KWD' } },
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
          { chargeCode: 'ocean_freight', nameEn: 'Ocean Freight', nameAr: 'أجرة الشحن البحري', basis: 'per_container', quantity: 1, buyRate: 1050, sellRate: 1275, amount: { amount: 1275, currency: 'KWD' } },
          { chargeCode: 'thc_origin', nameEn: 'Terminal Handling — Origin', nameAr: 'مناولة المحطة - المنشأ', basis: 'per_container', quantity: 1, buyRate: 126, sellRate: 155, amount: { amount: 155, currency: 'KWD' } },
          { chargeCode: 'thc_destination', nameEn: 'Terminal Handling — Destination', nameAr: 'مناولة المحطة - الوجهة', basis: 'per_container', quantity: 1, buyRate: 132, sellRate: 168, amount: { amount: 168, currency: 'KWD' } },
          { chargeCode: 'documentation', nameEn: 'Documentation', nameAr: 'رسوم المستندات', basis: 'flat', quantity: 1, buyRate: 22, sellRate: 45, amount: { amount: 45, currency: 'KWD' } },
          { chargeCode: 'delivery_order', nameEn: 'Delivery Order', nameAr: 'إذن التسليم', basis: 'flat', quantity: 1, buyRate: 32, sellRate: 47, amount: { amount: 47, currency: 'KWD' } },
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
          { chargeCode: 'ocean_freight', nameEn: 'Ocean Freight', nameAr: 'أجرة الشحن البحري', basis: 'per_container', quantity: 1, buyRate: 890, sellRate: 1050, amount: { amount: 1050, currency: 'KWD' } },
          { chargeCode: 'thc_origin', nameEn: 'Terminal Handling — Origin', nameAr: 'مناولة المحطة - المنشأ', basis: 'per_container', quantity: 1, buyRate: 118, sellRate: 145, amount: { amount: 145, currency: 'KWD' } },
          { chargeCode: 'thc_destination', nameEn: 'Terminal Handling — Destination', nameAr: 'مناولة المحطة - الوجهة', basis: 'per_container', quantity: 1, buyRate: 132, sellRate: 168, amount: { amount: 168, currency: 'KWD' } },
          { chargeCode: 'documentation', nameEn: 'Documentation', nameAr: 'رسوم المستندات', basis: 'flat', quantity: 1, buyRate: 6, sellRate: 15, amount: { amount: 15, currency: 'KWD' } },
          { chargeCode: 'delivery_order', nameEn: 'Delivery Order', nameAr: 'إذن التسليم', basis: 'flat', quantity: 1, buyRate: 32, sellRate: 42, amount: { amount: 42, currency: 'KWD' } },
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
      value: current.value + 480 + (job.containerCount * 640),
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
    return { label: day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), value: base }
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
