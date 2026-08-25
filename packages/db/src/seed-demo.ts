/**
 * A working dataset for a *customer's own* instance — `pnpm db:seed-demo`.
 *
 * `seed.ts` loads the *reference* data a deployment cannot run without:
 * currencies, incoterms, charge types, roles, permissions. This loads the
 * operational data a deployment cannot be *evaluated* without — real ports,
 * real lanes, enquiries at every stage, shipments mid-journey, invoices partly
 * paid, containers accruing demurrage right now.
 *
 * ## Who this is for, and how it differs from the pilot fixtures
 *
 * This runs when a new customer's instance is stood up, so it can be shown to
 * them with their branding on it before their own records land. It needs a
 * database and it is seen inside one engagement.
 *
 * `apps/web/src/lib/pilot/fixtures.ts` is the other dataset and the other
 * audience: one forwarder, permanently, on a public URL, with no database at
 * all. The two are deliberately not merged — that would either put a customer's
 * instance on a public URL or make the public demo need PostgreSQL.
 *
 * Everything a company is named here is invented, and built from Gulf place
 * names so it reads naturally without being anybody. This file listed ten real
 * Kuwaiti and Emirati companies as customers until that was noticed, which is a
 * poor thing to show somebody about how their own data will be handled.
 * Carriers and terminals stay real: they are the trade's vocabulary rather than
 * a claimed relationship.
 *
 * Two reasons that is worth a file this long rather than clicking through the
 * forms:
 *
 *   1. **An empty product is untestable.** Every register, every chart and
 *      every empty state reads zero on a fresh database, so nothing on the
 *      board can be judged — including whether the board is right.
 *   2. **The interesting states are the hard ones to reach by hand.** An
 *      enquiry that breached its SLA four hours ago, a container three days
 *      past free time, an invoice paid to 60% — each takes a dozen clicks and
 *      a clock you cannot move. Here they are three lines.
 *
 * Everything is anchored to *now* rather than to fixed dates, so the dataset
 * is still meaningful next month: an ETA is "in four days", not 2026-03-01.
 *
 * Idempotent by construction. Every insert is keyed on a natural key with
 * `onConflictDoNothing` or an explicit existence check, and the whole demo is
 * removable with `--reset`, which deletes only rows this file created.
 */

import { and, eq, sql } from 'drizzle-orm'
import { loadEnv } from './env'
import { createDatabase } from './client'
import { systemActor, withActor } from './actor'
import {
  assets,
  branches,
  chargeLines,
  chargeTypes,
  commodities,
  countries,
  customerContacts,
  customers,
  customsStages,
  documentTypes,
  documents,
  enquiries,
  equipment,
  exceptionCodes,
  exceptions,
  freeTimeClocks,
  invoiceLines,
  invoices,
  jobMilestones,
  jobPartners,
  jobs,
  locations,
  partnerSettlementLines,
  partnerSettlements,
  partners,
  paymentAllocations,
  payments,
  principals,
  quoteLines,
  quotes,
  rateCardLines,
  rateCards,
  supplierInvoiceLines,
  supplierInvoiceMatches,
  supplierInvoices,
  workingCalendars,
} from './schema/index'

loadEnv()

// --- time helpers ----------------------------------------------------------

const NOW = new Date()
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Hours from now, signed. `at(-4)` is four hours ago. */
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR)
/** Days from now, signed. */
const days = (count: number) => new Date(NOW.getTime() + count * DAY)
/** A `date` column wants `YYYY-MM-DD`, never a Date in the server's zone. */
const isoDay = (date: Date) => date.toISOString().slice(0, 10)

// --- the world -------------------------------------------------------------

/**
 * Real ports, with real UN/LOCODEs.
 *
 * Invented placeholders are a false economy in a demo: an operator reads
 * "KWSWK Shuwaikh" and knows immediately whether the lane makes sense, and
 * reads "PORT-01" and learns nothing. The coordinates are genuine so a map
 * view has somewhere to put them.
 */
const COUNTRIES = [
  ['KW', 'Kuwait', 'الكويت'],
  ['AE', 'United Arab Emirates', 'الإمارات العربية المتحدة'],
  ['SA', 'Saudi Arabia', 'المملكة العربية السعودية'],
  ['QA', 'Qatar', 'قطر'],
  ['CN', 'China', 'الصين'],
  ['IN', 'India', 'الهند'],
  ['SG', 'Singapore', 'سنغافورة'],
  ['NL', 'Netherlands', 'هولندا'],
  ['DE', 'Germany', 'ألمانيا'],
  ['TR', 'Türkiye', 'تركيا'],
  ['US', 'United States', 'الولايات المتحدة'],
  ['GB', 'United Kingdom', 'المملكة المتحدة'],
  ['DK', 'Denmark', 'الدنمارك'],
  ['CH', 'Switzerland', 'سويسرا'],
  ['FR', 'France', 'فرنسا'],
] as const

const PLACES = [
  ['KWSWK', 'Shuwaikh Port', 'ميناء الشويخ', 'KW', 'seaport', 29.35, 47.93],
  ['KWSAA', 'Shuaiba Port', 'ميناء الشعيبة', 'KW', 'seaport', 29.03, 48.15],
  ['KWDOH', 'Doha Port', 'ميناء الدوحة', 'KW', 'seaport', 29.36, 47.81],
  ['KWKWI', 'Kuwait International Airport', 'مطار الكويت الدولي', 'KW', 'airport', 29.23, 47.97],
  ['AEJEA', 'Jebel Ali', 'جبل علي', 'AE', 'seaport', 25.01, 55.06],
  ['AEDXB', 'Dubai International Airport', 'مطار دبي الدولي', 'AE', 'airport', 25.25, 55.36],
  ['AESHJ', 'Sharjah Port', 'ميناء الشارقة', 'AE', 'seaport', 25.36, 55.39],
  ['CNSHA', 'Shanghai', 'شنغهاي', 'CN', 'seaport', 31.23, 121.47],
  ['CNNGB', 'Ningbo', 'نينغبو', 'CN', 'seaport', 29.87, 121.55],
  ['CNSZX', 'Shenzhen', 'شنتشن', 'CN', 'seaport', 22.54, 114.06],
  ['SGSIN', 'Singapore', 'سنغافورة', 'SG', 'seaport', 1.29, 103.85],
  ['INNSA', 'Nhava Sheva', 'نهافا شيفا', 'IN', 'seaport', 18.95, 72.95],
  ['NLRTM', 'Rotterdam', 'روتردام', 'NL', 'seaport', 51.92, 4.48],
  ['DEHAM', 'Hamburg', 'هامبورغ', 'DE', 'seaport', 53.55, 9.99],
  ['TRMER', 'Mersin', 'مرسين', 'TR', 'seaport', 36.8, 34.63],
  ['SAJED', 'Jeddah Islamic Port', 'ميناء جدة الإسلامي', 'SA', 'seaport', 21.48, 39.18],
  ['SADMM', 'Dammam', 'الدمام', 'SA', 'seaport', 26.5, 50.2],
  ['QADOH', 'Hamad Port', 'ميناء حمد', 'QA', 'seaport', 25.02, 51.6],
  ['USNYC', 'New York', 'نيويورك', 'US', 'seaport', 40.69, -74.04],
  ['GBFXT', 'Felixstowe', 'فيليكستو', 'GB', 'seaport', 51.95, 1.31],
  ['KWABD', 'Abdali Border', 'منفذ العبدلي', 'KW', 'border', 30.05, 47.7],
  ['KWNWS', 'Nuwaiseeb Border', 'منفذ النويصيب', 'KW', 'border', 28.55, 48.4],
] as const

const GOODS = [
  ['ELEC', 'Electronics and appliances', 'إلكترونيات وأجهزة', '8517', false, false],
  ['FOOD', 'Foodstuffs, ambient', 'مواد غذائية', '2106', false, false],
  ['CHIL', 'Chilled foodstuffs', 'مواد غذائية مبردة', '0406', false, true],
  ['BLDG', 'Building materials', 'مواد بناء', '6810', false, false],
  ['AUTO', 'Vehicle parts', 'قطع غيار مركبات', '8708', false, false],
  ['TXTL', 'Textiles and garments', 'منسوجات وملابس', '6109', false, false],
  ['CHEM', 'Industrial chemicals', 'كيماويات صناعية', '2811', true, false],
  ['PHRM', 'Pharmaceuticals', 'مستحضرات صيدلانية', '3004', false, true],
  ['MACH', 'Machinery', 'آلات ومعدات', '8479', false, false],
  ['FURN', 'Furniture', 'أثاث', '9403', false, false],
] as const

const PARTNERS = [
  ['MAERSK', 'carrier', 'Maersk Line', 'DK', 'USD', 30],
  ['MSC', 'carrier', 'Mediterranean Shipping Company', 'CH', 'USD', 30],
  ['CMACGM', 'carrier', 'CMA CGM', 'FR', 'USD', 30],
  ['HAPAG', 'carrier', 'Hapag-Lloyd', 'DE', 'USD', 30],
  ['EK', 'carrier', 'Emirates SkyCargo', 'AE', 'AED', 21],
  ['KAC', 'carrier', 'Kuwait Airways Cargo', 'KW', 'KWD', 21],
  ['SHACO', 'agent', 'Shanghai Ocean Logistics', 'CN', 'USD', 45],
  ['RTMAG', 'agent', 'Rotterdam Forwarding BV', 'NL', 'EUR', 45],
  ['INDAG', 'agent', 'Mumbai Freight Services', 'IN', 'USD', 45],
  ['ALSHA', 'broker', 'Al-Shamali Customs Clearance', 'KW', 'KWD', 15],
  ['GULFB', 'broker', 'Gulf Bridge Clearing', 'AE', 'AED', 15],
  ['AHMTRN', 'haulier', 'Ahmadi Transport Company', 'KW', 'KWD', 30],
  ['DESERT', 'haulier', 'Desert Line Trucking', 'AE', 'AED', 30],
  ['KPA', 'terminal', 'Kuwait Ports Authority', 'KW', 'KWD', 0],
  ['DPW', 'terminal', 'DP World Jebel Ali', 'AE', 'AED', 0],
] as const

const CUSTOMERS = [
  ['JAHRAIN', 'Jahra Industries', 'صناعات الجهراء', 'KW', 'KWI', 45, '75000'],
  ['SALTEL', 'Salmiya Telecom', 'الساليمية للاتصالات', 'KW', 'KWI', 60, '120000'],
  ['SABPET', 'Sabahiya Petroleum', 'شركة الصباحية للبترول', 'KW', 'KWI', 60, '250000'],
  ['RUMRET', 'Rumaithiya Retail Trading', 'الرميثية للتجارة', 'KW', 'KWI', 30, '50000'],
  ['FINPET', 'Fintas Petrochemical', 'الفنطاس للبتروكيماويات', 'KW', 'KWI', 45, '90000'],
  ['ARDHLD', 'Ardiya Holding', 'مجموعة العارضية', 'KW', 'KWI', 30, '60000'],
  ['SULLOG', 'Sulaibiya Logistics', 'الصليبية للخدمات اللوجستية', 'KW', 'KWI', 30, '40000'],
  ['MIRPRP', 'Mirdif Properties', 'مرديف العقارية', 'AE', 'DXB', 45, '150000'],
  ['DEIRET', 'Deira Retail Group', 'مجموعة ديرة للتجزئة', 'AE', 'DXB', 45, '110000'],
  ['JUMEXP', 'Jumeirah Express', 'جميرا إكسبريس', 'AE', 'DXB', 30, '35000'],
] as const

const CONTACTS = [
  [
    'JAHRAIN',
    'Yousef Al-Mutairi',
    'يوسف المطيري',
    'yousef.almutairi@jahraind.test',
    'Logistics Manager',
  ],
  ['SALTEL', 'Dana Al-Sabah', 'دانة الصباح', 'dana.alsabah@saltel.test', 'Procurement Lead'],
  ['SABPET', 'Faisal Al-Otaibi', 'فيصل العتيبي', 'faisal.alotaibi@sabpet.test', 'Supply Chain'],
  ['RUMRET', 'Maryam Al-Hajri', 'مريم الهاجري', 'maryam.alhajri@rumret.test', 'Import Coordinator'],
  ['MIRPRP', 'Rashid Al-Nuaimi', 'راشد النعيمي', 'rashid@mirprp.test', 'Head of Procurement'],
  ['DEIRET', 'Layla Haddad', 'ليلى حداد', 'layla.haddad@deiret.test', 'Logistics Director'],
] as const

/**
 * The shipments.
 *
 * Chosen to cover every status the board can render and every alarm it can
 * raise, rather than to look tidy: one held at customs, one accruing
 * demurrage, one delivered and awaiting payment, one cancelled. A demo where
 * everything is green proves only that green renders.
 */
const SHIPMENTS = [
  {
    ref: 'KWI-JOB-0001',
    branch: 'KWI',
    customer: 'JAHRAIN',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'CNSHA',
    destination: 'KWSWK',
    goods: 'ELEC',
    status: 'in_transit',
    incoterm: 'FOB',
    carrier: 'MAERSK',
    agent: 'SHACO',
    vessel: 'MAERSK KOWLOON',
    voyage: '441E',
    etdDays: -12,
    etaDays: 4,
    weight: '18400.000',
    volume: '58.000',
    pieces: 420,
    containers: 2,
    mbl: 'MAEU241188345',
    hbl: 'QBD-HBL-24001',
  },
  {
    ref: 'KWI-JOB-0002',
    branch: 'KWI',
    customer: 'RUMRET',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'NLRTM',
    destination: 'KWSWK',
    goods: 'CHIL',
    status: 'arrived',
    incoterm: 'CIF',
    carrier: 'MSC',
    agent: 'RTMAG',
    vessel: 'MSC ALTAIR',
    voyage: '218W',
    etdDays: -32,
    etaDays: -9,
    ataDays: -9,
    weight: '22100.000',
    volume: '62.000',
    pieces: 980,
    containers: 1,
    mbl: 'MSCU2410099',
    hbl: 'QBD-HBL-24002',
    // Landed nine days ago against five free days, so four chargeable
    // days have accrued — this is the row the demurrage tile is counting.
    demurrage: { freeDays: 5, startedDaysAgo: 9, perDiem: '28.000' },
  },
  {
    ref: 'KWI-JOB-0003',
    branch: 'KWI',
    customer: 'SALTEL',
    mode: 'air',
    direction: 'import',
    origin: 'CNSZX',
    destination: 'KWKWI',
    goods: 'ELEC',
    status: 'customs',
    incoterm: 'EXW',
    carrier: 'EK',
    broker: 'ALSHA',
    flight: 'EK9862',
    etdDays: -3,
    etaDays: -1,
    ataDays: -1,
    weight: '2850.000',
    volume: '14.000',
    pieces: 96,
    mbl: '176-88214590',
    hbl: 'QBD-HBL-24003',
    customs: { status: 'held', inspection: true, duty: '1840.500' },
    exception: {
      code: 'inspection_hold',
      severity: 'high',
      daysAgo: 1,
      note: 'Held for physical inspection — declared value queried by customs.',
    },
  },
  {
    ref: 'KWI-JOB-0004',
    branch: 'KWI',
    customer: 'ARDHLD',
    mode: 'sea_lcl',
    direction: 'import',
    origin: 'INNSA',
    destination: 'KWSWK',
    goods: 'FOOD',
    status: 'in_transit',
    incoterm: 'FOB',
    carrier: 'CMACGM',
    agent: 'INDAG',
    vessel: 'CMA CGM NABUCCO',
    voyage: '0PG3R',
    etdDays: -8,
    etaDays: 6,
    weight: '9600.000',
    volume: '31.000',
    pieces: 310,
    mbl: 'CMAU9911234',
    hbl: 'QBD-HBL-24004',
  },
  {
    ref: 'KWI-JOB-0005',
    branch: 'KWI',
    customer: 'SABPET',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'DEHAM',
    destination: 'KWSAA',
    goods: 'MACH',
    status: 'delivered',
    incoterm: 'CFR',
    carrier: 'HAPAG',
    broker: 'ALSHA',
    haulier: 'AHMTRN',
    vessel: 'HAMBURG BAY',
    voyage: '112E',
    etdDays: -40,
    etaDays: -12,
    ataDays: -12,
    weight: '31500.000',
    volume: '76.000',
    pieces: 18,
    containers: 3,
    mbl: 'HLCU2409981',
    hbl: 'QBD-HBL-24005',
    customs: { status: 'released', duty: '4210.000' },
    invoice: { total: '8940.500', paid: '5000.000', dueDays: -4 },
  },
  {
    ref: 'KWI-JOB-0006',
    branch: 'KWI',
    customer: 'FINPET',
    mode: 'sea_fcl',
    direction: 'export',
    origin: 'KWSHU',
    destination: 'CNNGB',
    goods: 'CHEM',
    status: 'booked',
    incoterm: 'FOB',
    carrier: 'MAERSK',
    vessel: 'MAERSK SENTOSA',
    voyage: '336W',
    etdDays: 5,
    etaDays: 27,
    weight: '24000.000',
    volume: '60.000',
    pieces: 40,
    containers: 2,
    exception: {
      code: 'doc_missing',
      severity: 'medium',
      daysAgo: 4,
      note: 'Dangerous goods declaration not yet received from the shipper.',
    },
  },
  {
    ref: 'KWI-JOB-0007',
    branch: 'KWI',
    customer: 'SULLOG',
    mode: 'land',
    direction: 'import',
    origin: 'SADMM',
    destination: 'KWSWK',
    goods: 'BLDG',
    status: 'in_transit',
    incoterm: 'DAP',
    haulier: 'AHMTRN',
    etdDays: -1,
    etaDays: 1,
    weight: '26000.000',
    volume: '48.000',
    pieces: 620,
    exception: {
      code: 'delay_vessel',
      severity: 'low',
      daysAgo: 6,
      note: 'Queue at Nuwaiseeb border, driver reports a four-hour wait.',
    },
  },
  {
    ref: 'DXB-JOB-0001',
    branch: 'DXB',
    customer: 'MIRPRP',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'CNSHA',
    destination: 'AEJEA',
    goods: 'FURN',
    status: 'in_transit',
    incoterm: 'FOB',
    carrier: 'MSC',
    agent: 'SHACO',
    vessel: 'MSC GAIA',
    voyage: '509E',
    etdDays: -14,
    etaDays: 3,
    weight: '19800.000',
    volume: '110.000',
    pieces: 540,
    containers: 4,
    mbl: 'MSCU2410455',
    hbl: 'QBD-HBL-24008',
  },
  {
    ref: 'DXB-JOB-0002',
    branch: 'DXB',
    customer: 'DEIRET',
    mode: 'air',
    direction: 'import',
    origin: 'GBFXT',
    destination: 'AEDXB',
    goods: 'PHRM',
    status: 'arrived',
    incoterm: 'DAP',
    carrier: 'EK',
    broker: 'GULFB',
    flight: 'EK008',
    etdDays: -2,
    etaDays: 0,
    ataDays: 0,
    weight: '1240.000',
    volume: '7.000',
    pieces: 34,
    customs: { status: 'declaration_filed' },
  },
  {
    ref: 'DXB-JOB-0003',
    branch: 'DXB',
    customer: 'JUMEXP',
    mode: 'sea_lcl',
    direction: 'export',
    origin: 'AEJEA',
    destination: 'QADOH',
    goods: 'TXTL',
    status: 'completed',
    incoterm: 'FCA',
    carrier: 'CMACGM',
    vessel: 'CMA CGM DUTCH',
    voyage: '221S',
    etdDays: -22,
    etaDays: -16,
    ataDays: -16,
    weight: '4300.000',
    volume: '18.000',
    pieces: 210,
    invoice: { total: '3120.000', paid: '3120.000', dueDays: -8 },
  },
  {
    ref: 'DXB-JOB-0004',
    branch: 'DXB',
    customer: 'MIRPRP',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'TRMER',
    destination: 'AEJEA',
    goods: 'BLDG',
    status: 'on_hold',
    incoterm: 'CIF',
    carrier: 'MSC',
    vessel: 'MSC ANNA',
    voyage: '774W',
    etdDays: -9,
    etaDays: 8,
    weight: '27400.000',
    volume: '65.000',
    pieces: 88,
    containers: 2,
    exception: {
      code: 'payment_hold',
      severity: 'critical',
      daysAgo: 9,
      note: 'Customer asked to hold delivery — site not ready to receive.',
    },
  },
] as const

/**
 * The enquiry pipeline.
 *
 * `slaHours` is the *offset from now* of the reply deadline, so a negative
 * value with no reply recorded is an enquiry that has already breached — the
 * number the board leads with. Fixing that state into the data is the only way
 * to know the board actually renders it.
 */
const ENQUIRIES = [
  {
    branch: 'KWI',
    customer: 'JAHRAIN',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'CNSHA',
    destination: 'KWSWK',
    goods: 'ELEC',
    status: 'new',
    createdHours: -6,
    slaHours: -2,
    channel: 'email',
    weight: '16000.000',
    pieces: 380,
    notes: 'Two 40ft containers of consumer electronics, monthly repeat if the rate works.',
  },
  {
    branch: 'KWI',
    customer: 'SALTEL',
    mode: 'air',
    direction: 'import',
    origin: 'CNSZX',
    destination: 'KWKWI',
    goods: 'ELEC',
    status: 'new',
    createdHours: -9,
    slaHours: -5,
    channel: 'whatsapp',
    weight: '900.000',
    pieces: 22,
    notes: 'Urgent — network equipment needed on site by month end.',
  },
  {
    branch: 'KWI',
    customer: 'RUMRET',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'NLRTM',
    destination: 'KWSWK',
    goods: 'CHIL',
    status: 'assigned',
    createdHours: -20,
    slaHours: 3,
    channel: 'email',
    weight: '21000.000',
    pieces: 900,
  },
  {
    branch: 'KWI',
    customer: 'ARDHLD',
    mode: 'sea_lcl',
    direction: 'import',
    origin: 'INNSA',
    destination: 'KWSWK',
    goods: 'FOOD',
    status: 'quoted',
    createdHours: -52,
    slaHours: -46,
    respondedHours: -48,
    channel: 'portal',
    weight: '8200.000',
    volume: '26.000',
  },
  {
    branch: 'KWI',
    customer: null,
    contactName: 'Ahmed Darwish',
    contactEmail: 'ahmed.darwish@newtrader.test',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'CNNGB',
    destination: 'KWSWK',
    goods: 'FURN',
    status: 'new',
    createdHours: -2,
    slaHours: 2,
    channel: 'email',
    weight: '12000.000',
    notes: 'New enquiry from a company we have not shipped for before.',
  },
  {
    branch: 'KWI',
    customer: 'SABPET',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'DEHAM',
    destination: 'KWSAA',
    goods: 'MACH',
    status: 'won',
    createdHours: -900,
    slaHours: -896,
    respondedHours: -898,
    channel: 'email',
  },
  {
    branch: 'KWI',
    customer: 'SULLOG',
    mode: 'land',
    direction: 'import',
    origin: 'SADMM',
    destination: 'KWSWK',
    goods: 'BLDG',
    status: 'lost',
    createdHours: -400,
    slaHours: -396,
    respondedHours: -398,
    channel: 'phone',
    lostReason: 'Customer went with a cheaper trucking quote from a local operator.',
  },
  {
    branch: 'DXB',
    customer: 'MIRPRP',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'CNSHA',
    destination: 'AEJEA',
    goods: 'FURN',
    status: 'rating',
    createdHours: -14,
    slaHours: 6,
    channel: 'email',
    weight: '19000.000',
    pieces: 500,
  },
  {
    branch: 'DXB',
    customer: 'DEIRET',
    mode: 'air',
    direction: 'import',
    origin: 'GBFXT',
    destination: 'AEDXB',
    goods: 'PHRM',
    status: 'quoted',
    createdHours: -70,
    slaHours: -64,
    respondedHours: -66,
    channel: 'email',
    weight: '1100.000',
  },
  {
    branch: 'DXB',
    customer: 'JUMEXP',
    mode: 'sea_lcl',
    direction: 'export',
    origin: 'AEJEA',
    destination: 'QADOH',
    goods: 'TXTL',
    status: 'won',
    createdHours: -600,
    slaHours: -596,
    respondedHours: -598,
    channel: 'portal',
  },
  {
    branch: 'DXB',
    customer: 'DEIRET',
    mode: 'sea_fcl',
    direction: 'import',
    origin: 'SGSIN',
    destination: 'AEJEA',
    goods: 'AUTO',
    status: 'new',
    createdHours: -30,
    slaHours: -24,
    channel: 'email',
    weight: '15500.000',
    notes: 'Awaiting a rate from our Singapore agent before we can quote.',
  },
  {
    branch: 'DXB',
    customer: 'MIRPRP',
    mode: 'land',
    direction: 'export',
    origin: 'AEJEA',
    destination: 'SAJED',
    goods: 'BLDG',
    status: 'assigned',
    createdHours: -40,
    slaHours: 8,
    channel: 'walk_in',
    weight: '24000.000',
  },
] as const

type Tx = Parameters<Parameters<typeof withActor>[1]>[0]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedDemo(tx: any, reset: boolean): Promise<void> {
  if (reset) {
    console.log('  removing existing demo rows…')
    /**
     * Order matters: children first, since the schema has no cascade on the
     * links that matter. Anything not created here is left alone.
     *
     * This runs as the **migrator** role, not `app_user`. `app_user` holds no
     * `DELETE` on any table in the schema — that is deliberate and it is the
     * mechanism behind §5.5: records are deactivated, never removed, so the
     * audit trail cannot be edited by the application that wrote it. A reset
     * is a development affordance and therefore needs the owning role.
     */
    await tx.execute(sql`
      /*
        Notifications and messages first: both hold foreign keys to enquiries
        and jobs, and the outbox in particular fills up as soon as anybody
        uses the app — the first enquiry created through the dialog is enough
        to make a reset fail on a constraint.
      */
      delete from notification_deliveries;
      delete from notification_outbox;
      delete from message_attachments;
      delete from messages;
      /*
        The buy side, before the ledger it points at.

        supplier_invoice_matches holds a charge line, and a settlement holds
        the bills it consumed while those bills hold the settlement back -- so
        the link is broken first and the two ends removed in order. Deleting
        charge_lines before the matches fails on the constraint.
      */
      delete from partner_settlement_lines;
      update supplier_invoices set settlement_id = null;
      delete from partner_settlements;
      delete from supplier_invoice_matches;
      delete from supplier_invoice_lines;
      delete from supplier_payment_allocations;
      delete from supplier_invoices;
      /*
        Children of the jobs, invoices and documents removed below.

        None of these were listed, because none of them had rows while this
        file was the only thing that ever wrote to the database. The moment
        somebody uses the application — captures cargo, names a shipper, asks
        the assistant — a reset fails on a foreign key instead, which is the
        opposite of what a reset is for.
      */
      delete from credit_overrides;
      delete from ai_invocations;
      delete from consol_allocation_shares;
      delete from pod_photos;
      delete from proof_of_delivery;
      delete from job_cargo;
      delete from job_parties;
      -- Before charge_lines: a clock that has written its own demurrage charge
      -- points at the line it wrote. Harmless while this file made no charge
      -- lines and a constraint violation the moment it did.
      delete from free_time_clocks;
      delete from charge_lines;
      delete from rate_requests;
      delete from payment_allocations;
      delete from payments;
      delete from invoice_lines;
      delete from invoices;
      delete from exceptions;
      delete from customs_stages;
      delete from documents;
      delete from equipment;
      -- Posted exports hold the CSV they produced, so they go before the
      -- assets and after the ledger rows that name the export.
      delete from accounting_exports;
      delete from partner_compliance;
      -- Assets outlive the documents that point at them, and the storage key
      -- is unique, so a reseed collides on a key it created last time.
      delete from assets;
      delete from job_partners;
      delete from job_milestones;
      delete from jobs;
      delete from quote_lines;
      delete from quotes;
      delete from enquiries;
      delete from rate_card_lines;
      delete from rate_cards;
      delete from customer_contacts;
      /*
        Customers and partners are deliberately left standing.

        The obvious next line is a delete of both -- a rename changes the
        natural key, onConflictDoNothing then inserts rather than updates, and
        an existing instance ends up with twenty customers instead of ten. That
        was tried, and it is the wrong trade.

        Twenty tables hang off these two, and they are not demo data:
        principals (a customer's portal logins), customer_branch_terms,
        credit_overrides, api_keys, webhook_endpoints. A reset that reaches
        them is deleting identity and configuration to tidy up a fixture, and
        it fails outright on any database where somebody has actually used the
        application.

        So a renamed code leaves its old row behind, and that is the honest
        cost. Clear those by hand on the rare occasion it matters; every other
        table here is genuinely this file's to remove.
      */
    `)
  }

  // --- branches, and the people who work in them --------------------------

  /*
    The demo dataset creates the two branches it references.

    Every seed below writes `branch_id` resolved from `KWI` or `DXB` by code.
    On a fresh deployment `branches` is empty — `db:seed` loads reference data
    and a branch is not reference data — so the lookup returned undefined and
    the first insert died on a `not null` violation, which read as a bug in the
    demo data rather than a missing prerequisite.
    
    Created here rather than demanded of the operator because this file is a
    self-contained evaluation dataset: `pnpm db:seed-demo` should produce a
    working instance from a migrated database and nothing else. A real
    deployment names its own entities with `pnpm db:create-branch`.
  */
  const [calendarRow] = await tx
    .select({ id: workingCalendars.id })
    .from(workingCalendars)
    .where(eq(workingCalendars.key, 'kuwait'))
    .limit(1)

  if (calendarRow) {
    await tx
      .insert(branches)
      .values([
        {
          code: 'KWI',
          legalNameEn: 'Al-Qabandi & Partners Co.',
          legalNameAr: 'شركة القبندي وشركاه',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'KWI',
          calendarId: calendarRow.id,
          timeZone: 'Asia/Kuwait',
        },
        {
          code: 'DXB',
          legalNameEn: 'Al-Qabandi Logistics FZE',
          legalNameAr: 'القبندي للخدمات اللوجستية',
          country: 'AE',
          baseCurrency: 'AED',
          invoiceSeries: 'DXB',
          calendarId: calendarRow.id,
          timeZone: 'Asia/Dubai',
        },
      ])
      .onConflictDoNothing()
  }

  const branchRows = await tx.select({ id: branches.id, code: branches.code }).from(branches)
  const branchBy = new Map<string, string>(
    branchRows.map((row: { id: string; code: string }) => [row.code, row.id]),
  )

  const staff = await tx
    .select({ id: principals.id, email: principals.email })
    .from(principals)
    .where(eq(principals.type, 'internal'))
  const owner = (index: number): string | null => {
    const usable = staff.filter((p: { email: string }) => !p.email.endsWith('@qabandi.internal'))
    return usable.length ? usable[index % usable.length].id : null
  }

  // --- countries ----------------------------------------------------------
  //
  // The base seed ships the ten this operator trades with most. The demo lanes
  // reach further than that, and a location's `country_code` is a real foreign
  // key — so the countries the lanes need are inserted first rather than
  // letting the place inserts fail on a constraint.

  await tx
    .insert(countries)
    .values(COUNTRIES.map(([code, nameEn, nameAr]) => ({ code, nameEn, nameAr })))
    .onConflictDoNothing()

  // --- places -------------------------------------------------------------

  await tx
    .insert(locations)
    .values(
      PLACES.map(([unlocode, nameEn, nameAr, country, kind, lat, lon]) => ({
        unlocode,
        nameEn,
        nameAr,
        countryCode: country,
        kind,
        latitude: String(lat),
        longitude: String(lon),
      })),
    )
    .onConflictDoNothing()

  const placeRows = await tx
    .select({ id: locations.id, unlocode: locations.unlocode })
    .from(locations)
  const place = new Map<string, string>(
    placeRows
      .filter((row: { unlocode: string | null }) => row.unlocode)
      .map((row: { id: string; unlocode: string }) => [row.unlocode, row.id]),
  )

  // --- goods --------------------------------------------------------------

  await tx
    .insert(commodities)
    .values(
      GOODS.map(([code, nameEn, nameAr, hsCode, dangerous, temperature]) => ({
        code,
        nameEn,
        nameAr,
        hsCode,
        isDangerous: dangerous,
        requiresTemperatureControl: temperature,
      })),
    )
    .onConflictDoNothing()

  const goodsRows = await tx
    .select({ id: commodities.id, code: commodities.code })
    .from(commodities)
  const goods = new Map<string, string>(
    goodsRows.map((row: { id: string; code: string }) => [row.code, row.id]),
  )

  // --- the network --------------------------------------------------------

  await tx
    .insert(partners)
    .values(
      PARTNERS.map(([code, type, legalNameEn, country, currency, terms]) => ({
        code,
        type,
        legalNameEn,
        countryCode: country,
        currency,
        paymentTermsDays: terms,
      })),
    )
    .onConflictDoNothing()

  const partnerRows = await tx.select({ id: partners.id, code: partners.code }).from(partners)
  const partner = new Map<string, string>(
    partnerRows.map((row: { id: string; code: string }) => [row.code, row.id]),
  )

  // --- customers ----------------------------------------------------------

  await tx
    .insert(customers)
    .values(
      CUSTOMERS.map(([code, legalNameEn, legalNameAr, country, branch]) => ({
        code,
        legalNameEn,
        legalNameAr,
        countryCode: country,
        primaryBranchId: branchBy.get(branch)!,
      })),
    )
    .onConflictDoNothing()

  const customerRows = await tx.select({ id: customers.id, code: customers.code }).from(customers)
  const customer = new Map<string, string>(
    customerRows.map((row: { id: string; code: string }) => [row.code, row.id]),
  )

  for (const [code, nameEn, nameAr, email, role] of CONTACTS) {
    const customerId = customer.get(code)
    if (!customerId) continue
    const [existing] = await tx
      .select({ id: customerContacts.id })
      .from(customerContacts)
      .where(and(eq(customerContacts.customerId, customerId), eq(customerContacts.email, email)))
      .limit(1)
    if (existing) continue
    await tx
      .insert(customerContacts)
      .values({ customerId, nameEn, nameAr, email, role, isPrimary: true })
  }

  // --- a buying rate card, so quoting has something to price against ------

  const chargeRows = await tx
    .select({ id: chargeTypes.id, key: chargeTypes.key, currency: chargeTypes.defaultCurrency })
    .from(chargeTypes)
  const anyCharge = chargeRows.slice(0, 6)

  const [existingCard] = await tx.select({ id: rateCards.id }).from(rateCards).limit(1)
  if (!existingCard && anyCharge.length) {
    const validFrom = isoDay(days(-30))
    const validTo = isoDay(days(90))

    for (const [origin, destination] of [
      ['CNSHA', 'KWSWK'],
      ['NLRTM', 'KWSWK'],
      ['INNSA', 'KWSWK'],
      ['CNSHA', 'AEJEA'],
    ] as const) {
      for (const direction of ['buy', 'sell'] as const) {
        const [card] = await tx
          .insert(rateCards)
          .values({
            direction,
            branchId: branchBy.get(destination.startsWith('KW') ? 'KWI' : 'DXB')!,
            partnerId: direction === 'buy' ? partner.get('MAERSK')! : null,
            mode: 'sea_fcl',
            tradeDirection: 'import',
            originId: place.get(origin)!,
            destinationId: place.get(destination)!,
            // `daterange` is the authoritative window; the two date columns
            // mirror it for indexing and for the UI. Postgres enforces the
            // no-overlap constraint on the range, not on the pair.
            validity: sql`daterange(${validFrom}::date, ${validTo}::date, '[)')`,
            validFrom,
            validTo,
            currency: 'USD',
          })
          .returning({ id: rateCards.id })

        // Sell sits above buy by a margin that varies by charge, which is what
        // makes the margin column on the quote register interesting.
        const uplift = direction === 'sell' ? 1.28 : 1
        await tx.insert(rateCardLines).values(
          anyCharge.map((row: { id: string }, index: number) => ({
            rateCardId: card!.id,
            chargeTypeId: row.id,
            basis: (['per_container', 'flat', 'per_kg'] as const)[index % 3],
            rate: String(Math.round([850, 120, 340, 95, 210, 75][index]! * uplift)),
            currency: 'USD',
            containerType: index % 3 === 0 ? '40HC' : null,
            sortOrder: index,
          })),
        )
      }
    }
  }

  // --- enquiries ----------------------------------------------------------

  let enquirySeq = 0
  const enquiryIds: { id: string; customerCode: string | null; branch: string }[] = []

  for (const spec of ENQUIRIES) {
    enquirySeq += 1
    const year = NOW.getUTCFullYear()
    const reference = `${spec.branch}-ENQ-${year}-${String(enquirySeq).padStart(5, '0')}`

    const [existing] = await tx
      .select({ id: enquiries.id })
      .from(enquiries)
      .where(eq(enquiries.reference, reference))
      .limit(1)
    if (existing) {
      enquiryIds.push({ id: existing.id, customerCode: spec.customer, branch: spec.branch })
      continue
    }

    const createdAt = at(spec.createdHours)
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference,
        branchId: branchBy.get(spec.branch)!,
        customerId: spec.customer ? customer.get(spec.customer)! : null,
        contactName: 'contactName' in spec ? spec.contactName : null,
        contactEmail: 'contactEmail' in spec ? spec.contactEmail : null,
        ownerId: spec.status === 'new' ? null : owner(enquirySeq),
        status: spec.status,
        channel: spec.channel,
        mode: spec.mode,
        tradeDirection: spec.direction,
        originId: place.get(spec.origin)!,
        destinationId: place.get(spec.destination)!,
        commodityId: goods.get(spec.goods)!,
        incoterm: 'FOB',
        readyOn: isoDay(days(7)),
        grossWeightKg: 'weight' in spec ? spec.weight : null,
        volumeCbm: 'volume' in spec ? spec.volume : null,
        pieces: 'pieces' in spec ? spec.pieces : null,
        notes: 'notes' in spec ? spec.notes : null,
        slaStartedAt: createdAt,
        slaDueAt: at(spec.slaHours),
        firstRespondedAt: 'respondedHours' in spec ? at(spec.respondedHours) : null,
        closedAt: ['won', 'lost'].includes(spec.status) ? at(spec.createdHours + 24) : null,
        lostReason: 'lostReason' in spec ? spec.lostReason : null,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: enquiries.id })

    enquiryIds.push({ id: row!.id, customerCode: spec.customer, branch: spec.branch })

    // A quotation on every enquiry that got as far as being priced. The
    // margin is baked into `priced_snapshot` at this moment and never
    // recomputed — that immutability is the rule the register depends on.
    if (['quoted', 'won', 'lost'].includes(spec.status)) {
      const cost = 2400 + enquirySeq * 180
      const sell = Math.round(cost * (1.14 + (enquirySeq % 5) * 0.045))
      const [quote] = await tx
        .insert(quotes)
        .values({
          reference: `${spec.branch}-QUO-${year}-${String(enquirySeq).padStart(5, '0')}`,
          enquiryId: row!.id,
          branchId: branchBy.get(spec.branch)!,
          version: 1,
          status: spec.status === 'won' ? 'accepted' : spec.status === 'lost' ? 'rejected' : 'sent',
          currency: 'USD',
          totalSell: String(sell),
          totalCost: String(cost),
          validUntil: isoDay(days(spec.status === 'quoted' ? 12 : -5)),
          pricedSnapshot: {
            pricedAt: at(spec.createdHours + 2).toISOString(),
            marginPct: Number((((sell - cost) / sell) * 100).toFixed(2)),
          },
          preparedById: owner(enquirySeq),
          sentAt: at(spec.createdHours + 2),
          decidedAt: spec.status === 'quoted' ? null : at(spec.createdHours + 30),
          createdAt: at(spec.createdHours + 1),
        })
        .returning({ id: quotes.id })

      if (anyCharge.length) {
        await tx.insert(quoteLines).values(
          anyCharge.slice(0, 4).map((row2: { id: string }, index: number) => {
            const rate = [980, 145, 380, 110][index]!
            return {
              quoteId: quote!.id,
              chargeTypeId: row2.id,
              description: null,
              basis: (['per_container', 'flat', 'per_kg', 'flat'] as const)[index]!,
              quantity: '1',
              rate: String(rate),
              amount: String(rate),
              currency: 'USD',
              sortOrder: index,
            }
          }),
        )
      }
    }
  }

  // --- shipments ----------------------------------------------------------

  const exceptionCodeRows = await tx
    .select({ id: exceptionCodes.id, code: exceptionCodes.code })
    .from(exceptionCodes)
  /**
   * Loud rather than silent on a missing code.
   *
   * This used to fall back to the first row, and the result was every demo
   * exception rendering as "Vessel delay" — the data looked plausible and was
   * wrong, which is the worst way for a seed to fail.
   */
  const exceptionCode = (preferred: string): string => {
    const match = exceptionCodeRows.find((row: { code: string }) => row.code === preferred)
    if (!match) {
      throw new Error(
        `exception code "${preferred}" is not seeded — run \`pnpm db:seed\` first. ` +
          `Available: ${exceptionCodeRows.map((r: { code: string }) => r.code).join(', ')}`,
      )
    }
    return match.id
  }

  const MILESTONES = [
    ['BOOKED', 'Booking confirmed', 'تأكيد الحجز', -20],
    ['LOADED', 'Loaded at origin', 'التحميل في المنشأ', -14],
    ['SAILED', 'Departed origin', 'المغادرة من المنشأ', -12],
    ['ARRIVED', 'Arrived at destination', 'الوصول إلى الوجهة', 4],
    ['CLEARED', 'Customs cleared', 'التخليص الجمركي', 6],
    ['DELIVERED', 'Delivered to consignee', 'التسليم للمرسل إليه', 8],
  ] as const

  const doneThrough: Record<string, number> = {
    draft: 0,
    booked: 1,
    in_transit: 3,
    arrived: 4,
    customs: 4,
    delivered: 6,
    completed: 6,
    closed: 6,
    on_hold: 3,
    cancelled: 1,
  }

  for (const spec of SHIPMENTS) {
    const [existing] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.reference, spec.ref))
      .limit(1)
    if (existing) continue

    const branchId = branchBy.get(spec.branch)!
    const originId = place.get(spec.origin) ?? place.get('KWSWK')!
    const destinationId = place.get(spec.destination) ?? place.get('KWSWK')!

    const [job] = await tx
      .insert(jobs)
      .values({
        reference: spec.ref,
        branchId,
        customerId: customer.get(spec.customer)!,
        status: spec.status,
        mode: spec.mode,
        tradeDirection: spec.direction,
        ownerId: owner(SHIPMENTS.indexOf(spec)),
        originId,
        destinationId,
        commodityId: goods.get(spec.goods)!,
        incoterm: spec.incoterm,
        masterBillNumber: 'mbl' in spec ? spec.mbl : null,
        houseBillNumber: 'hbl' in spec ? spec.hbl : null,
        vesselName: 'vessel' in spec ? spec.vessel : null,
        voyageNumber: 'voyage' in spec ? spec.voyage : null,
        flightNumber: 'flight' in spec ? spec.flight : null,
        etd: days(spec.etdDays),
        eta: days(spec.etaDays),
        atd: spec.etdDays < 0 ? days(spec.etdDays) : null,
        ata: 'ataDays' in spec ? days(spec.ataDays) : null,
        grossWeightKg: spec.weight,
        volumeCbm: 'volume' in spec ? spec.volume : null,
        pieces: 'pieces' in spec ? spec.pieces : null,
        createdAt: days(spec.etdDays - 6),
      })
      .returning({ id: jobs.id })

    const jobId = job!.id
    const completed = doneThrough[spec.status] ?? 0

    await tx.insert(jobMilestones).values(
      MILESTONES.map(([code, nameEn, nameAr, offset], index) => ({
        jobId,
        code,
        nameEn,
        nameAr,
        seq: index + 1,
        plannedAt: days(spec.etdDays + offset + 12),
        actualAt: index < completed ? days(spec.etdDays + offset + 12) : null,
        customerVisible: true,
      })),
    )

    // Who moved it. The role string is what the job file groups by.
    const links: { partner: string; role: string }[] = []
    if ('carrier' in spec && spec.carrier) links.push({ partner: spec.carrier, role: 'carrier' })
    if ('agent' in spec && spec.agent) links.push({ partner: spec.agent, role: 'origin_agent' })
    if ('broker' in spec && spec.broker)
      links.push({ partner: spec.broker, role: 'customs_broker' })
    if ('haulier' in spec && spec.haulier) links.push({ partner: spec.haulier, role: 'haulier' })
    if (links.length) {
      await tx.insert(jobPartners).values(
        links.map((link) => ({
          jobId,
          branchId,
          partnerId: partner.get(link.partner)!,
          role: link.role,
        })),
      )
    }

    if ('containers' in spec && spec.containers) {
      await tx.insert(equipment).values(
        Array.from({ length: spec.containers }, (_, index) => ({
          jobId,
          containerNo: `${['MSKU', 'MSCU', 'CMAU', 'HLXU'][index % 4]}${
            4_000_000 + SHIPMENTS.indexOf(spec) * 1000 + index
          }`,
          containerType: index % 2 === 0 ? '40HC' : '20GP',
          sealNo: `SL${900_000 + index}`,
          grossWeightKg: '26000.000',
          dischargedAt: 'ataDays' in spec ? days(spec.ataDays) : null,
        })),
      )
    }

    if ('customs' in spec && spec.customs) {
      await tx.insert(customsStages).values({
        jobId,
        status: spec.customs.status,
        declarationType: spec.direction === 'import' ? 'import' : 'export',
        declarationNo: `KWD-${2_400_000 + SHIPMENTS.indexOf(spec)}`,
        filedAt: 'ataDays' in spec ? days(spec.ataDays) : null,
        dutyAmount: 'duty' in spec.customs ? spec.customs.duty : null,
        dutyCurrency: 'duty' in spec.customs ? 'KWD' : null,
        inspectionRequired: 'inspection' in spec.customs ? spec.customs.inspection : false,
        releasedAt: spec.customs.status === 'released' ? days(spec.etaDays + 2) : null,
        brokerPartnerId: 'broker' in spec && spec.broker ? partner.get(spec.broker)! : null,
        // The clearance window that closes first is the one the register
        // sorts by, so give the held entries a deadline in the past.
        slaDueAt: spec.customs.status === 'held' ? at(-18) : days(spec.etaDays + 3),
      })
    }

    if ('exception' in spec && spec.exception) {
      await tx.insert(exceptions).values({
        jobId,
        exceptionCodeId: exceptionCode(spec.exception.code),
        severity: spec.exception.severity,
        ownerId: owner(SHIPMENTS.indexOf(spec)),
        description: spec.exception.note,
        openedAt: days(-spec.exception.daysAgo),
        dueAt: days(-spec.exception.daysAgo + 2),
        customerVisible: spec.exception.severity !== 'low',
      })
    }

    if ('demurrage' in spec && spec.demurrage) {
      const startsOn = days(-spec.demurrage.startedDaysAgo)
      const accruedDays = Math.max(0, spec.demurrage.startedDaysAgo - spec.demurrage.freeDays)
      await tx.insert(freeTimeClocks).values({
        jobId,
        kind: 'demurrage',
        freeDays: spec.demurrage.freeDays,
        startsOn: isoDay(startsOn),
        perDiem: spec.demurrage.perDiem,
        currency: 'KWD',
        dayBasis: 'calendar',
        counterpartyId: 'carrier' in spec && spec.carrier ? partner.get(spec.carrier)! : null,
        accruedDays,
        accruedAmount: String(accruedDays * Number(spec.demurrage.perDiem)),
        lastAccruedAt: NOW,
      })
    }

    if ('invoice' in spec && spec.invoice) {
      const total = Number(spec.invoice.total)
      const paid = Number(spec.invoice.paid)
      const subtotal = Math.round(total / 1.05)
      const [invoice] = await tx
        .insert(invoices)
        .values({
          branchId,
          customerId: customer.get(spec.customer)!,
          seriesNo: `${spec.branch}-INV-${NOW.getUTCFullYear()}-${String(
            SHIPMENTS.indexOf(spec) + 1,
          ).padStart(5, '0')}`,
          status: paid >= total ? 'paid' : paid > 0 ? 'part_paid' : 'issued',
          currency: 'KWD',
          subtotal: String(subtotal),
          taxAmount: String(total - subtotal),
          total: String(total),
          amountPaid: String(paid),
          taxTreatment: 'standard',
          taxRatePercent: '5',
          issuedAt: days(spec.invoice.dueDays - 30),
          dueOn: isoDay(days(spec.invoice.dueDays)),
          issuedById: owner(1),
        })
        .returning({ id: invoices.id })

      if (anyCharge.length) {
        await tx.insert(invoiceLines).values(
          anyCharge.slice(0, 3).map((row: { id: string }, index: number) => {
            const amount = Math.round((subtotal / 3) * 100) / 100
            /*
              Line tax has to be set, not left at its zero default.

              The header's tax came from the invoice-level calculation while
              every line said "—", so the detail page showed a document whose
              lines did not compose its own total. The header is right; the
              lines were the ones lying.
            */
            const lineTax = Math.round(amount * 0.05 * 1000) / 1000
            return {
              invoiceId: invoice!.id,
              chargeTypeId: row.id,
              descriptionEn: ['Ocean freight', 'Terminal handling', 'Customs clearance'][index]!,
              quantity: '1',
              unitPrice: String(amount),
              amount: String(amount),
              taxAmount: String(lineTax),
              isTaxable: true,
              sortOrder: index,
            }
          }),
        )
      }

      if (paid > 0) {
        const [payment] = await tx
          .insert(payments)
          .values({
            branchId,
            customerId: customer.get(spec.customer)!,
            amount: String(paid),
            currency: 'KWD',
            receivedOn: isoDay(days(spec.invoice.dueDays - 2)),
            method: 'bank_transfer',
            reference: `TT-${700_000 + SHIPMENTS.indexOf(spec)}`,
            recordedById: owner(2),
          })
          .returning({ id: payments.id })

        await tx.insert(paymentAllocations).values({
          paymentId: payment!.id,
          invoiceId: invoice!.id,
          amount: String(paid),
        })
      }
    }
  }

  // --- documents -----------------------------------------------------------
  //
  // A document row needs an `asset_id`, and an asset is a file in object
  // storage. The demo has no storage, so each asset is a *record of a file*
  // with a storage key that resolves to nothing — enough for the register,
  // the version chain and the release state to be real, and honest about the
  // bytes not existing. Downloading one is the only thing that will not work.

  const documentTypeRows = await tx
    .select({ id: documentTypes.id, code: documentTypes.code })
    .from(documentTypes)
  const documentType = new Map<string, string>(
    documentTypeRows.map((row: { id: string; code: string }) => [row.code, row.id]),
  )

  const shipped = await tx
    .select({
      id: jobs.id,
      reference: jobs.reference,
      branchId: jobs.branchId,
      status: jobs.status,
    })
    .from(jobs)

  /** Which paperwork exists depends on how far the shipment has actually got. */
  const PAPERWORK: Record<string, string[]> = {
    booked: ['invoice_commercial', 'packing_list'],
    in_transit: ['invoice_commercial', 'packing_list', 'hbl', 'mbl'],
    arrived: ['invoice_commercial', 'packing_list', 'hbl', 'mbl', 'certificate_origin'],
    customs: ['invoice_commercial', 'packing_list', 'hbl', 'mbl', 'customs_declaration'],
    delivered: [
      'invoice_commercial',
      'packing_list',
      'hbl',
      'mbl',
      'customs_declaration',
      'delivery_order',
    ],
    completed: [
      'invoice_commercial',
      'packing_list',
      'hbl',
      'mbl',
      'customs_declaration',
      'delivery_order',
    ],
    on_hold: ['invoice_commercial', 'packing_list', 'hbl'],
  }

  for (const job of shipped as {
    id: string
    reference: string
    branchId: string
    status: string
  }[]) {
    const codes = PAPERWORK[job.status] ?? []
    for (const [index, code] of codes.entries()) {
      const typeId = documentType.get(code)
      if (!typeId) continue

      const [existing] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.jobId, job.id), eq(documents.documentTypeId, typeId)))
        .limit(1)
      if (existing) continue

      const fileName = `${job.reference}-${code}.pdf`
      const [asset] = await tx
        .insert(assets)
        .values({
          branchId: job.branchId,
          storageKey: `demo/${job.reference}/${code}.pdf`,
          fileName,
          contentType: 'application/pdf',
          byteSize: String(48_000 + index * 9_000),
          uploadedById: owner(index),
        })
        .returning({ id: assets.id })

      await tx.insert(documents).values({
        jobId: job.id,
        documentTypeId: typeId,
        assetId: asset!.id,
        version: 1,
        // A house bill is released to the customer; a commercial invoice from
        // the shipper is filed but never "released" by us.
        releasedAt: ['hbl', 'delivery_order'].includes(code) ? days(-2) : null,
        releasedById: ['hbl', 'delivery_order'].includes(code) ? owner(0) : null,
        authorId: owner(index),
      })
    }
  }

  // An unallocated payment — money received that no ledger line closes yet.
  // It is the single most common real-world finance state and the one the
  // payments register exists to surface.
  const [orphan] = await tx.select({ id: payments.id }).from(payments).limit(1)
  if (orphan) {
    const [existing] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.reference, 'TT-UNALLOCATED'))
      .limit(1)
    if (!existing) {
      await tx.insert(payments).values({
        branchId: branchBy.get('KWI')!,
        customerId: customer.get('JAHRAIN')!,
        amount: '2500.000',
        currency: 'KWD',
        receivedOn: isoDay(days(-2)),
        method: 'cheque',
        reference: 'TT-UNALLOCATED',
        notes: 'Received on account — customer has not said which invoices it settles.',
        recordedById: owner(0),
      })
    }
  }

  // --- the buy side ---------------------------------------------------------

  /*
    Supplier bills, and the accruals they are matched against.

    This dataset had no buy side at all: eighty-six invoices out and nothing
    coming in, so `/payables` and `/settlements` were empty boards and the
    margin on every shipment was pure revenue. A forwarder looking at that sees
    a product that has only ever billed and never bought.

    The accrual comes first and it is not decoration. `listSupplierInvoices`
    computes variance as *billed minus matched*, so a bill with nothing to
    match against reports its whole value as a discrepancy — every row in the
    review queue, which is the same as no queue at all. Seeding the cost line
    the bill answers is what makes the number mean anything.

    `accrued` is therefore what we thought it would cost, and `amount` is what
    they billed. Equal on most lines, deliberately not on two:

      - `KWI-JOB-0004` freight is 40 KWD over its accrual — one line in the
        review queue, with a reason somebody has to accept or dispute.
      - `KWI-JOB-0007` carries a line we never accrued at all, which is the
        state the matching screen exists for: an agent's charge nobody booked,
        against a job it may or may not belong to.
  */
  const BILLS = [
    {
      job: 'KWI-JOB-0001',
      partner: 'MAERSK',
      reference: 'MAEU-8841273',
      status: 'approved' as const,
      daysAgo: 26,
      termsDays: 30,
      lines: [
        { description: 'OCEAN FREIGHT SHA/KWI 1X40HC', amount: 980, accrued: 980 },
        { description: 'B/L RELEASE FEE', amount: 45, accrued: 45 },
      ],
    },
    {
      job: 'KWI-JOB-0002',
      partner: 'ALSHA',
      reference: 'ASC-2026-0412',
      status: 'part_paid' as const,
      paid: 60,
      daysAgo: 19,
      termsDays: 15,
      lines: [{ description: 'CUSTOMS CLEARANCE — IMPORT', amount: 120, accrued: 120 }],
    },
    {
      job: 'KWI-JOB-0004',
      partner: 'MSC',
      reference: 'MSCU-5510388',
      status: 'received' as const,
      daysAgo: 6,
      termsDays: 30,
      lines: [
        // Billed over the accrual. The variance is the point of the row.
        { description: 'OCEAN FREIGHT + BAF', amount: 1240, accrued: 1200 },
        { description: 'TERMINAL HANDLING ORIGIN', amount: 85, accrued: 85 },
      ],
    },
    {
      job: 'KWI-JOB-0005',
      partner: 'AHMTRN',
      reference: 'ATC-99120',
      status: 'paid' as const,
      paid: 165,
      daysAgo: 41,
      termsDays: 30,
      lines: [{ description: 'HAULAGE SHUWAIKH — SHUAIBA', amount: 165, accrued: 165 }],
    },
    {
      job: 'KWI-JOB-0007',
      partner: 'SHACO',
      reference: 'SOL/26/1188',
      status: 'received' as const,
      daysAgo: 3,
      termsDays: 45,
      lines: [
        { description: 'ORIGIN DOC FEE', amount: 35, accrued: 35 },
        // Nothing accrued this. It is the queue the matching screen is for.
        { description: 'EXPORT CUSTOMS — SHANGHAI', amount: 70, accrued: null },
      ],
    },
    {
      job: 'KWI-JOB-0003',
      partner: 'KPA',
      reference: 'KPA-STG-44219',
      status: 'disputed' as const,
      daysAgo: 12,
      termsDays: 0,
      dispute: 'Storage charged from arrival; free time ran to the 14th. Evidence sent.',
      lines: [{ description: 'STORAGE 6 DAYS', amount: 210, accrued: 90 }],
    },
  ]

  const jobByRef = new Map<string, { id: string; branchId: string }>(
    (
      await tx
        .select({ id: jobs.id, reference: jobs.reference, branchId: jobs.branchId })
        .from(jobs)
    ).map((row: { id: string; reference: string; branchId: string }) => [
      row.reference,
      { id: row.id, branchId: row.branchId },
    ]),
  )

  /** A charge type to hang a cost on. Their vocabulary is on the bill line. */
  const costCharge = anyCharge[0]?.id ?? null

  for (const bill of BILLS) {
    const job = jobByRef.get(bill.job)
    const partnerId = partner.get(bill.partner)
    if (!job || !partnerId || !costCharge) continue

    const [existing] = await tx
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(
        and(
          eq(supplierInvoices.partnerId, partnerId),
          eq(supplierInvoices.reference, bill.reference),
        ),
      )
      .limit(1)
    if (existing) continue

    const subtotal = bill.lines.reduce((sum, line) => sum + line.amount, 0)
    const invoiceDate = days(-bill.daysAgo)

    const [supplier] = await tx
      .insert(supplierInvoices)
      .values({
        branchId: job.branchId,
        partnerId,
        reference: bill.reference,
        status: bill.status,
        currency: 'KWD',
        subtotal: String(subtotal),
        taxAmount: '0',
        total: String(subtotal),
        amountPaid: String('paid' in bill ? (bill.paid ?? 0) : 0),
        invoiceDate: isoDay(invoiceDate),
        dueOn: isoDay(days(-bill.daysAgo + bill.termsDays)),
        receivedAt: invoiceDate,
        // Approval is a separate act from capture, so only the bills past it
        // carry an approver — `received` and `disputed` deliberately do not.
        approvedById: ['approved', 'part_paid', 'paid'].includes(bill.status) ? owner(1) : null,
        approvedAt: ['approved', 'part_paid', 'paid'].includes(bill.status)
          ? days(-bill.daysAgo + 2)
          : null,
        disputedAt: bill.status === 'disputed' ? days(-bill.daysAgo + 1) : null,
        disputeReason: 'dispute' in bill ? (bill.dispute ?? null) : null,
      })
      .returning({ id: supplierInvoices.id })

    let sortOrder = 0
    for (const line of bill.lines) {
      const [billLine] = await tx
        .insert(supplierInvoiceLines)
        .values({
          supplierInvoiceId: supplier!.id,
          branchId: job.branchId,
          jobId: job.id,
          description: line.description,
          quantity: '1',
          unitPrice: String(line.amount),
          amount: String(line.amount),
          sortOrder: sortOrder++,
        })
        .returning({ id: supplierInvoiceLines.id })

      if (line.accrued === null) continue

      /*
        The cost we booked before their document arrived.

        `is_accrual` is what distinguishes a figure we estimated from one we
        agreed, and the job P&L reads it as "still accrued" until a bill is
        matched to it — which is exactly what happens on the next statement.
      */
      const [chargeLine] = await tx
        .insert(chargeLines)
        .values({
          jobId: job.id,
          branchId: job.branchId,
          direction: 'cost',
          chargeTypeId: costCharge,
          description: line.description,
          basis: 'flat',
          quantity: '1',
          rate: String(line.accrued),
          amount: String(line.accrued),
          currency: 'KWD',
          amountBase: String(line.accrued),
          baseCurrency: 'KWD',
          counterpartyPartnerId: partnerId,
          isAccrual: true,
          sourceKind: 'demo_seed',
        })
        .returning({ id: chargeLines.id })

      await tx.insert(supplierInvoiceMatches).values({
        supplierInvoiceLineId: billLine!.id,
        chargeLineId: chargeLine!.id,
        branchId: job.branchId,
        // What the match claims of the supplier line — never more than the
        // accrual it answers. The variance is the difference, and it is meant
        // to be visible rather than absorbed here.
        amount: String(Math.min(line.amount, line.accrued)),
        matchedById: owner(1),
      })
    }
  }

  // --- a set-off, which needs a counterparty that is both ---------------------

  /*
    An agent we buy from and also bill.

    A settlement nets what they owe us against what we owe them, so it cannot
    be demonstrated with a partner who is only ever paid. Shanghai Ocean
    Logistics is the origin agent on the China lane *and* a customer of ours
    for the cross-trade shipments they hand us — which is the ordinary
    arrangement between two forwarders, and the only shape in which a set-off
    means anything.

    Registered as its own customer row rather than by pointing `customers` at a
    partner: they are two relationships with two credit positions and two sets
    of terms, and the day one of them is disputed is the day that distinction
    earns itself.
  */
  await tx
    .insert(customers)
    .values({
      code: 'SHALOG',
      legalNameEn: 'Shanghai Ocean Logistics',
      legalNameAr: 'شنغهاي أوشن للخدمات اللوجستية',
      countryCode: 'CN',
      primaryBranchId: branchBy.get('KWI')!,
    })
    .onConflictDoNothing()

  const [agentCustomer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.code, 'SHALOG'))
    .limit(1)

  const agentPartner = partner.get('SHACO')

  if (agentCustomer && agentPartner) {
    const [already] = await tx
      .select({ id: partnerSettlements.id })
      .from(partnerSettlements)
      .where(eq(partnerSettlements.reference, 'SET-KWI-2026-0001'))
      .limit(1)

    if (!already) {
      const branchId = branchBy.get('KWI')!

      // Two cross-trade invoices out to them.
      const receivables = []
      for (const [index, amount] of [420, 380].entries()) {
        const [invoice] = await tx
          .insert(invoices)
          .values({
            branchId,
            customerId: agentCustomer.id,
            seriesNo: `KWI-INV-${NOW.getUTCFullYear()}-9000${index + 1}`,
            status: 'issued',
            currency: 'KWD',
            subtotal: String(amount),
            taxAmount: '0',
            total: String(amount),
            amountPaid: '0',
            taxTreatment: 'zero_rated',
            taxRatePercent: '0',
            issuedAt: days(-40 + index * 6),
            dueOn: isoDay(days(-40 + index * 6 + 45)),
            issuedById: owner(1),
            notes: 'Cross-trade handling, billed to the origin agent.',
          })
          .returning({ id: invoices.id, total: invoices.total })
        receivables.push(invoice!)
      }

      // Their bills to us, the two the statement claims.
      const payablesToNet = await tx
        .select({ id: supplierInvoices.id, total: supplierInvoices.total })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.partnerId, agentPartner))

      const receivableTotal = receivables.reduce((sum, row) => sum + Number(row.total), 0)
      const payableTotal = payablesToNet.reduce(
        (sum: number, row: { total: string }) => sum + Number(row.total),
        0,
      )
      const offset = Math.min(receivableTotal, payableTotal)
      const residual = Math.abs(receivableTotal - payableTotal)

      const [settlement] = await tx
        .insert(partnerSettlements)
        .values({
          reference: 'SET-KWI-2026-0001',
          branchId,
          partnerId: agentPartner,
          status: 'agreed',
          currency: 'KWD',
          periodFrom: isoDay(days(-60)),
          periodTo: isoDay(days(-1)),
          receivableTotal: String(receivableTotal),
          payableTotal: String(payableTotal),
          offsetAmount: String(offset),
          residualAmount: String(residual),
          /*
            Which way the remainder moves, stated rather than inferred from a
            sign. `residual_amount` is always positive and the direction is its
            own column, because "they owe us 380" and "we owe them 380" are
            different sentences and a minus sign is a poor way to say which.
          */
          residualDirection:
            receivableTotal > payableTotal
              ? 'they_owe_us'
              : receivableTotal < payableTotal
                ? 'we_owe_them'
                : 'square',
          agreedAt: days(-1),
          agreedById: owner(1),
          notes: 'Netted against the January statement; residual on the next remittance.',
        })
        .returning({ id: partnerSettlements.id })

      for (const invoice of receivables) {
        await tx.insert(partnerSettlementLines).values({
          settlementId: settlement!.id,
          branchId,
          kind: 'invoice',
          invoiceId: invoice.id,
          amount: invoice.total,
          isFull: true,
        })
      }

      for (const bill of payablesToNet as { id: string; total: string }[]) {
        await tx.insert(partnerSettlementLines).values({
          settlementId: settlement!.id,
          branchId,
          kind: 'bill',
          supplierInvoiceId: bill.id,
          amount: bill.total,
          isFull: true,
        })
        // A bill consumed by a set-off was not paid, and says so.
        await tx
          .update(supplierInvoices)
          .set({ settlementId: settlement!.id })
          .where(eq(supplierInvoices.id, bill.id))
      }
    }
  }
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset')

  /**
   * A reset needs the migrator; a plain seed does not.
   *
   * Writing through `app_user` on the normal path is not pedantry — it is the
   * only way this script proves that every row it creates is one the
   * *application* could have created. A seed that quietly runs as the owner
   * can insert rows no RLS policy would allow, and the first sign of it is a
   * screen that renders in development and is empty in production.
   */
  const url = reset
    ? (process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL)
    : process.env.DATABASE_URL

  if (!url) throw new Error('DATABASE_URL is not set.')
  if (reset && !process.env.MIGRATION_DATABASE_URL) {
    throw new Error(
      '--reset needs MIGRATION_DATABASE_URL: app_user holds no DELETE on any table (§5.5).',
    )
  }

  const database = createDatabase({ connectionString: url, max: 1 })

  console.log(reset ? 'Reseeding demo data…' : 'Seeding demo data…')
  await withActor(systemActor(), (tx: Tx) => seedDemo(tx, reset), database)

  const counts = await withActor(
    systemActor(),
    async (tx: Tx) =>
      tx.execute(sql`
        select (select count(*) from locations)::int  as places,
               (select count(*) from partners)::int   as partners,
               (select count(*) from customers)::int  as customers,
               (select count(*) from enquiries)::int  as enquiries,
               (select count(*) from quotes)::int     as quotes,
               (select count(*) from jobs)::int       as shipments,
               (select count(*) from exceptions)::int as exceptions,
               (select count(*) from invoices)::int   as invoices,
               (select count(*) from supplier_invoices)::int  as bills,
               (select count(*) from partner_settlements)::int as settlements
      `),
    database,
  )

  console.table((counts as { rows: unknown[] }).rows[0])
  console.log('\nDone. Sign in and the board has something to show.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
