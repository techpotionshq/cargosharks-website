/**
 * The words a person uses for the codes the database stores — for the assistant.
 *
 * A tool result carries `status: "in_transit"`, and a model shown only that
 * repeats it: the Arabic answer in a live run had a table column of raw
 * `in_transit` under Arabic headings. So each result carries the label beside
 * the code (`statusLabel: "قيد النقل"`), in the language the answer is being
 * written in, and the prompt says to show the label.
 *
 * These are the web catalogue's own words (`apps/web/messages`, the namespaces
 * named on each vocabulary), copied because `core` imports nothing and the
 * service does not import the web app. They cannot drift quietly:
 * `apps/web/src/features/assistant/labels.test.ts` fails if a word here differs
 * from the catalogue's, or if the catalogue gains a code this lacks.
 */

export type LabelLanguage = 'en' | 'ar'

type Vocabulary = Readonly<Record<string, { readonly en: string; readonly ar: string }>>

/** Each vocabulary, and the catalogue namespace it mirrors. */
export const LABEL_SOURCES = {
  jobStatus: 'job.statuses',
  enquiryStatus: 'enquiry.statuses',
  quoteStatus: 'quotes.statuses',
  invoiceStatus: 'invoices.statuses',
  customsStatus: 'job.customsStatuses',
  severity: 'exceptions.severities',
  clockKind: 'freeTime.kinds',
  mode: 'mode',
  direction: 'direction',
} as const

export type LabelVocabulary = keyof typeof LABEL_SOURCES

export const LABELS: Readonly<Record<LabelVocabulary, Vocabulary>> = {
  jobStatus: {
    draft: { en: 'Draft', ar: 'مسودة' },
    booked: { en: 'Booked', ar: 'محجوزة' },
    in_transit: { en: 'In transit', ar: 'قيد النقل' },
    arrived: { en: 'Arrived', ar: 'وصلت' },
    customs: { en: 'Customs', ar: 'في الجمارك' },
    delivered: { en: 'Delivered', ar: 'سُلمت' },
    completed: { en: 'Completed', ar: 'مكتملة' },
    closed: { en: 'Closed', ar: 'مغلقة' },
    on_hold: { en: 'On hold', ar: 'متوقفة' },
    cancelled: { en: 'Cancelled', ar: 'ملغاة' },
  },
  enquiryStatus: {
    new: { en: 'New', ar: 'جديد' },
    assigned: { en: 'Assigned', ar: 'مُسند' },
    rating: { en: 'Rating', ar: 'قيد التسعير' },
    quoted: { en: 'Quoted', ar: 'تم التسعير' },
    won: { en: 'Won', ar: 'مقبول' },
    lost: { en: 'Lost', ar: 'مرفوض' },
    cancelled: { en: 'Cancelled', ar: 'ملغي' },
    expired: { en: 'Expired', ar: 'منتهي' },
  },
  quoteStatus: {
    draft: { en: 'Draft', ar: 'مسودة' },
    sent: { en: 'Sent', ar: 'مُرسل' },
    accepted: { en: 'Accepted', ar: 'مقبول' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    expired: { en: 'Expired', ar: 'منتهي' },
    superseded: { en: 'Superseded', ar: 'ملغى' },
    revised: { en: 'Revised', ar: 'مُعدّل' },
  },
  invoiceStatus: {
    draft: { en: 'Draft', ar: 'مسودة' },
    issued: { en: 'Issued', ar: 'صادرة' },
    paid: { en: 'Paid', ar: 'مدفوعة' },
    part_paid: { en: 'Part paid', ar: 'مدفوعة جزئياً' },
    void: { en: 'Void', ar: 'ملغاة' },
    overdue: { en: 'Overdue', ar: 'متأخرة' },
    approved: { en: 'Approved', ar: 'معتمدة' },
    credited: { en: 'Credited', ar: 'مقيدة دائنًا' },
  },
  customsStatus: {
    not_started: { en: 'Not started', ar: 'لم تبدأ' },
    documents_pending: { en: 'Documents pending', ar: 'بانتظار المستندات' },
    declaration_filed: { en: 'Declaration filed', ar: 'قُدّم البيان' },
    assessed: { en: 'Assessed', ar: 'تم التقييم' },
    duty_paid: { en: 'Duty paid', ar: 'سُددت الرسوم' },
    inspection: { en: 'Inspection', ar: 'تفتيش' },
    released: { en: 'Released', ar: 'أُفرج عنها' },
    held: { en: 'Held', ar: 'محتجزة' },
  },
  severity: {
    low: { en: 'Low', ar: 'منخفضة' },
    medium: { en: 'Medium', ar: 'متوسطة' },
    high: { en: 'High', ar: 'عالية' },
    critical: { en: 'Critical', ar: 'حرجة' },
  },
  clockKind: {
    demurrage: { en: 'Demurrage', ar: 'أرضيات' },
    detention: { en: 'Detention', ar: 'تأخير' },
    storage: { en: 'Storage', ar: 'تخزين' },
  },
  mode: {
    sea_fcl: { en: 'Sea FCL', ar: 'بحري حاوية كاملة' },
    sea_lcl: { en: 'Sea LCL', ar: 'بحري بضاعة مجمعة' },
    air: { en: 'Air', ar: 'جوي' },
    land: { en: 'Land', ar: 'بري' },
    courier: { en: 'Courier', ar: 'بريد سريع' },
  },
  direction: {
    import: { en: 'Import', ar: 'استيراد' },
    export: { en: 'Export', ar: 'تصدير' },
    cross_trade: { en: 'Cross trade', ar: 'تجارة عابرة' },
  },
}

/** The label for a code, or undefined for one the vocabulary does not hold. */
export function labelFor(
  vocabulary: LabelVocabulary,
  code: string,
  language: LabelLanguage,
): string | undefined {
  return LABELS[vocabulary][code]?.[language]
}

/**
 * A tool result with a `<key>Label` beside every coded value `spec` names.
 *
 * `spec` maps a path of object keys — array positions skipped, so
 * `rows.status` is the status of every row — to its vocabulary. A code the
 * vocabulary does not hold gets no label rather than a guessed one; the model
 * then has the code alone, which is the old behaviour and never a wrong word.
 */
export function withLabels(
  value: unknown,
  spec: Readonly<Record<string, LabelVocabulary>>,
  language: LabelLanguage,
  path = '',
): unknown {
  if (Array.isArray(value)) return value.map((item) => withLabels(item, spec, language, path))
  if (value === null || typeof value !== 'object' || value instanceof Date) return value

  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const at = path ? `${path}.${key}` : key
    out[key] = withLabels(inner, spec, language, at)
    const vocabulary = spec[at]
    if (vocabulary && typeof inner === 'string') {
      const label = labelFor(vocabulary, inner, language)
      if (label) out[`${key}Label`] = label
    }
  }
  return out
}
