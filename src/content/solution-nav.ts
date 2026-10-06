import type { Bi } from '@/content/copy'

/**
 * The landing pages' slugs, groups and menu labels, apart from their content.
 *
 * Split out of `solutions.ts` for the size of the browser bundle. The header
 * is a client component and reads `copy.ts`, which builds the Solutions panel
 * from this list; importing `solutions.ts` there would ship every word of ten
 * pages in two languages to every visitor's browser so that a menu could show
 * twenty short labels. `solutions.ts` reads its labels from here, so there is
 * still one list.
 */

export interface SolutionNav {
  slug: string
  group: 'market' | 'job'
  label: Bi
  blurb: Bi
}

export const solutionNav: SolutionNav[] = [
  {
    slug: 'freight-forwarding-software-uae',
    group: 'market',
    label: { en: 'For the UAE', ar: 'للإمارات' },
    blurb: {
      en: 'Dubai, Jebel Ali and Abu Dhabi desks, AED and Arabic',
      ar: 'لمكاتب دبي وجبل علي وأبوظبي، بالدرهم وبالعربية',
    },
  },
  {
    slug: 'freight-forwarding-software-kuwait',
    group: 'market',
    label: { en: 'For Kuwait', ar: 'للكويت' },
    blurb: {
      en: 'Built in Kuwait, three decimals on every dinar',
      ar: 'بُني في الكويت، وثلاث خانات لكل دينار',
    },
  },
  {
    slug: 'freight-forwarding-software-saudi-arabia',
    group: 'market',
    label: { en: 'For Saudi Arabia', ar: 'للسعودية' },
    blurb: {
      en: 'What works for a Saudi forwarder, and the ZATCA answer',
      ar: 'ما يصلح لشركة شحن سعودية، وجواب سؤال زاتكا',
    },
  },
  {
    slug: 'freight-quotation-software',
    group: 'job',
    label: { en: 'Quotes and rates', ar: 'التسعير وعروض الأسعار' },
    blurb: {
      en: 'Rate cards, chargeable weight, agent rates, margin',
      ar: 'بطاقات الأسعار والوزن الخاضع للأجرة وأسعار الوكلاء والهامش',
    },
  },
  {
    slug: 'whatsapp-for-freight-forwarders',
    group: 'job',
    label: { en: 'WhatsApp enquiries', ar: 'استفسارات واتساب' },
    blurb: {
      en: 'Your business numbers, in the enquiry queue',
      ar: 'أرقامكم التجارية، داخل قائمة الاستفسارات',
    },
  },
  {
    slug: 'customs-clearance-software',
    group: 'job',
    label: { en: 'Customs clearance', ar: 'التخليص الجمركي' },
    blurb: {
      en: 'Every declaration, ordered by the deadline that closes first',
      ar: 'كل بيان، مرتب حسب المهلة الأقرب',
    },
  },
  {
    slug: 'shipment-tracking-portal',
    group: 'job',
    label: { en: 'Tracking and portal', ar: 'التتبع وبوابة العملاء' },
    blurb: {
      en: 'What your customers see, under your brand',
      ar: 'ما يراه عملاؤكم، تحت علامتكم',
    },
  },
  {
    slug: 'freight-invoicing-software',
    group: 'job',
    label: { en: 'Invoicing and supplier bills', ar: 'الفوترة وفواتير المورّدين' },
    blurb: {
      en: 'Job costing, bill matching, receivables',
      ar: 'تكاليف الشحنة ومطابقة الفواتير والذمم',
    },
  },
  {
    slug: 'arabic-freight-documents',
    group: 'job',
    label: { en: 'Arabic documents', ar: 'المستندات بالعربية' },
    blurb: {
      en: 'Bill of lading and delivery order, from the job',
      ar: 'بوليصة الشحن وأمر التسليم، من الشحنة',
    },
  },
  {
    slug: 'uae-e-invoicing-freight-forwarders',
    group: 'job',
    label: { en: 'UAE e-invoicing guide', ar: 'دليل الفوترة الإلكترونية في الإمارات' },
    blurb: {
      en: 'PINT AE, ASPs and the deadlines, for forwarders',
      ar: 'PINT AE ومزوّدو الخدمة والمواعيد، لشركات الشحن',
    },
  },
]

/** The path of a solution page in a language. Arabic twins live under `/ar/`. */
export function solutionPath(slug: string, lang: 'en' | 'ar'): string {
  return lang === 'ar' ? `/ar/${slug}/` : `/${slug}/`
}
