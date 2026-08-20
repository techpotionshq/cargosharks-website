/**
 * The default notification templates — FR-NT-01, FR-NT-03.
 *
 * `notification_templates` was empty. Not sparse — empty: the seed created
 * currencies, charge types, milestones, exception codes, document types,
 * calendars, roles and the permission matrix, and not one template row. So
 * even with a working mail adapter, every send would have resolved no template
 * and been recorded as `failed`, per recipient, for ever.
 *
 * ## These are defaults, and they are meant to be edited
 *
 * `branch_id` is null on every row here, which is what makes them the fallback
 * (§7.4). FR-NT-03 requires an administrator to change wording without a
 * developer, and the mechanism for that is a row with a branch on it, which
 * wins over the row below. Nothing here is compiled into the application, and
 * that is the whole design: *configuration is rows, not classes*.
 *
 * ## The Arabic is not a translation of the English
 *
 * It is the same message written in Arabic. A freight company's Arabic
 * correspondence does not read like English with the words swapped — the
 * register is more formal, the customer is addressed in the plural, and the
 * sentence order differs. Machine-translating the English column would produce
 * something a Kuwaiti customer can tell was machine-translated, which is worse
 * than sending English.
 *
 * ## Why `{{recipientName}}` follows "Hello" with no comma
 *
 * `renderTemplate` substitutes a missing field with an empty string, and a
 * customer contact who is not matched to a name has none. "Hello Ahmed" and
 * "Hello" both read correctly; "Dear {{recipientName}}," becomes "Dear ,"
 * which reads as a broken mail merge — which is exactly what it is.
 */

export interface NotificationTemplateSeed {
  readonly eventKey: string
  readonly channel: 'email'
  readonly locale: 'en' | 'ar'
  readonly subject: string
  readonly body: string
}

function t(
  eventKey: string,
  locale: 'en' | 'ar',
  subject: string,
  body: string,
): NotificationTemplateSeed {
  return { eventKey, channel: 'email', locale, subject, body: body.trim() }
}

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplateSeed[] = [
  // --- enquiry.created (internal) -------------------------------------------
  t(
    'enquiry.created',
    'en',
    'New enquiry {{reference}}',
    `
Hello {{recipientName}}

Enquiry {{reference}} has been received and has no owner yet.

Open it in Qabandi to assign it and start the response clock.

{{senderName}}
`,
  ),
  t(
    'enquiry.created',
    'ar',
    'استفسار جديد {{reference}}',
    `
مرحباً {{recipientName}}

تم استلام الاستفسار {{reference}} ولم يُسنَد إلى مسؤول بعد.

افتحه في نظام قبندي لإسناده وبدء احتساب زمن الاستجابة.

{{senderName}}
`,
  ),

  // --- enquiry.sla_breached (internal) --------------------------------------
  t(
    'enquiry.sla_breached',
    'en',
    'Overdue: first response on enquiry {{reference}}',
    `
Hello {{recipientName}}

Enquiry {{reference}} has passed the agreed time for a first response and has
not been answered.

It needs a response now.

{{senderName}}
`,
  ),
  t(
    'enquiry.sla_breached',
    'ar',
    'متأخر: الرد الأول على الاستفسار {{reference}}',
    `
مرحباً {{recipientName}}

تجاوز الاستفسار {{reference}} المدة المتفق عليها للرد الأول ولم يتم الرد عليه.

يحتاج إلى رد الآن.

{{senderName}}
`,
  ),

  /*
    free_time.expiring (internal)

    The subject line carries the container and the day count, because this
    arrives in a coordinator's inbox alongside forty others and the decision —
    move it or pay — is made from the subject or not at all.

    `{{daysRemaining}}` is zero on the day free time runs out, and the wording
    has to survive that without reading like a bug. "0 day(s) remaining" is
    ugly but honest; a template that says "expires in 0 days" is worse.
  */
  t(
    'free_time.expiring',
    'en',
    '{{kind}} starts on {{containerNo}} in {{daysRemaining}} day(s) — {{reference}}',
    `
Hello {{recipientName}}

Free time on container {{containerNo}} ({{reference}}) runs out on {{expiresOn}} —
{{daysRemaining}} day(s) from today.

After that the {{kind}} clock charges {{perDiem}} {{currency}} per day, and the
charge is ours until the container moves.

{{senderName}}
`,
  ),
  t(
    'free_time.expiring',
    'ar',
    'بدء احتساب {{kind}} على الحاوية {{containerNo}} خلال {{daysRemaining}} يوم — {{reference}}',
    `
مرحباً {{recipientName}}

تنتهي الفترة المجانية للحاوية {{containerNo}} ({{reference}}) بتاريخ {{expiresOn}}،
أي خلال {{daysRemaining}} يوم من اليوم.

وبعد ذلك يبدأ احتساب {{kind}} بواقع {{perDiem}} {{currency}} عن كل يوم، وتقع هذه
التكلفة علينا إلى أن تتحرك الحاوية.

{{senderName}}
`,
  ),

  /*
    The rate-card digest (internal) — FR-RT-11.

    The body opens with the date it was compiled, because two digests can sit
    in one inbox — last night's and tonight's — and the difference between
    them is the only thing that tells a reader which one is still true.

    The subject carries the count and the first date, because that is the whole
    decision: eleven cards lapsing next month is a call to an agent this week,
    and one card lapsing in three days is a call this morning. The list arrives
    pre-rendered in `{{lanes}}` — the worker builds it, in both languages,
    because a template cannot loop and should not learn how.
  */
  t(
    'rate_card.expiring',
    'en',
    '{{count}} rate card(s) lapse within {{horizonDays}} days — first on {{soonest}}',
    `
Hello {{recipientName}}

As at {{asOf}}, {{count}} rate card(s) reach the end of their validity within
the next {{horizonDays}} days. The first lapses on {{soonest}}.

{{lanes}}

Renewed cards are already excluded. A lane with no live buying rate is quoted
from memory, and the difference turns up at month end.

{{senderName}}
`,
  ),
  t(
    'rate_card.expiring',
    'ar',
    'انتهاء صلاحية {{count}} من بطاقات الأسعار خلال {{horizonDays}} يوماً — أولها في {{soonest}}',
    `
مرحباً {{recipientName}}

بتاريخ {{asOf}}: تنتهي صلاحية {{count}} من بطاقات الأسعار خلال {{horizonDays}}
يوماً القادمة، وأولها بتاريخ {{soonest}}.

{{lanesAr}}

البطاقات التي تم تجديدها مستثناة من القائمة. والخط الذي لا تتوفر له بطاقة شراء
سارية يُسعَّر بالتقدير، ويظهر الفرق عند إقفال الشهر.

{{senderName}}
`,
  ),

  // --- quote.sent (customer) ------------------------------------------------
  t(
    'quote.sent',
    'en',
    'Quotation {{reference}}',
    `
Hello {{recipientName}}

Thank you for your enquiry. Our quotation {{reference}} is ready.

Total: {{total}} {{currency}}
Valid until: {{validUntil}}

The full quotation is on the customer portal. Please tell us if you would like
to proceed, or if anything needs to change.

{{senderName}}
`,
  ),
  t(
    'quote.sent',
    'ar',
    'عرض السعر {{reference}}',
    `
مرحباً {{recipientName}}

شكراً لاستفساركم. عرض السعر {{reference}} جاهز.

الإجمالي: {{total}} {{currency}}
صالح حتى: {{validUntil}}

تفاصيل العرض كاملة متاحة عبر بوابة العملاء. يرجى إبلاغنا في حال الموافقة على
المضي قدماً أو إذا كان هناك ما يستدعي التعديل.

{{senderName}}
`,
  ),

  // --- quote.expiring (customer) --------------------------------------------
  t(
    'quote.expiring',
    'en',
    'Quotation {{reference}} expires on {{validUntil}}',
    `
Hello {{recipientName}}

Our quotation {{reference}} is valid until {{validUntil}}, which is
{{daysRemaining}} days from today.

Rates move, and we would rather re-quote than let the offer lapse quietly.
Please tell us if you would like to proceed, or if you need a fresh price.

{{senderName}}
`,
  ),
  t(
    'quote.expiring',
    'ar',
    'ينتهي عرض السعر {{reference}} بتاريخ {{validUntil}}',
    `
مرحباً {{recipientName}}

عرض السعر {{reference}} صالح حتى {{validUntil}}، أي بعد {{daysRemaining}} يوماً
من اليوم.

الأسعار متغيرة، ونفضّل إعادة التسعير على أن ينتهي العرض دون إشعار. يرجى إبلاغنا
في حال الرغبة بالمضي قدماً أو الحاجة إلى تسعير جديد.

{{senderName}}
`,
  ),

  // --- job.created (customer) -----------------------------------------------
  t(
    'job.created',
    'en',
    'Shipment {{reference}} booked',
    `
Hello {{recipientName}}

Your shipment is booked. The reference is {{reference}} and the mode is
{{mode}}.

You can follow it on the customer portal, and we will write again as it reaches
each milestone.

{{senderName}}
`,
  ),
  t(
    'job.created',
    'ar',
    'تم حجز الشحنة {{reference}}',
    `
مرحباً {{recipientName}}

تم حجز شحنتكم. الرقم المرجعي {{reference}} ونوع الشحن {{mode}}.

يمكنكم متابعتها عبر بوابة العملاء، وسنوافيكم بالمستجدات عند كل مرحلة.

{{senderName}}
`,
  ),

  // --- job.milestone_reached (customer) -------------------------------------
  t(
    'job.milestone_reached',
    'en',
    '{{reference}}: {{milestone}}',
    `
Hello {{recipientName}}

Shipment {{reference}} has reached {{milestone}}, recorded at {{reachedAt}}.

The full history is on the customer portal.

{{senderName}}
`,
  ),
  t(
    'job.milestone_reached',
    'ar',
    '{{reference}}: {{milestoneAr}}',
    `
مرحباً {{recipientName}}

وصلت الشحنة {{reference}} إلى مرحلة {{milestoneAr}} بتاريخ {{reachedAt}}.

يمكنكم الاطلاع على السجل الكامل عبر بوابة العملاء.

{{senderName}}
`,
  ),

  // --- job.eta_changed (customer) -------------------------------------------
  t(
    'job.eta_changed',
    'en',
    '{{reference}}: arrival now {{eta}}',
    `
Hello {{recipientName}}

The estimated arrival of shipment {{reference}} has moved.

Previously: {{previousEta}}
Now: {{eta}}

If this affects your onward plans, tell us and we will look at the options.

{{senderName}}
`,
  ),
  t(
    'job.eta_changed',
    'ar',
    '{{reference}}: الوصول المتوقع {{eta}}',
    `
مرحباً {{recipientName}}

تغيّر الموعد المتوقع لوصول الشحنة {{reference}}.

الموعد السابق: {{previousEta}}
الموعد الحالي: {{eta}}

إذا كان لهذا أثر على ترتيباتكم اللاحقة، يرجى إبلاغنا لبحث الخيارات المتاحة.

{{senderName}}
`,
  ),

  // --- exception.opened (internal) ------------------------------------------
  t(
    'exception.opened',
    'en',
    '{{severity}} exception on {{reference}}',
    `
Hello {{recipientName}}

An exception has been raised on shipment {{reference}}.

Severity: {{severity}}
Detail: {{description}}

It is on the exception register and its resolution clock is running.

{{senderName}}
`,
  ),
  t(
    'exception.opened',
    'ar',
    'استثناء بدرجة {{severity}} على الشحنة {{reference}}',
    `
مرحباً {{recipientName}}

تم تسجيل استثناء على الشحنة {{reference}}.

الدرجة: {{severity}}
التفاصيل: {{description}}

الاستثناء مُدرج في سجل الاستثناءات وبدأ احتساب مدة المعالجة.

{{senderName}}
`,
  ),

  // --- document.released (customer) -----------------------------------------
  t(
    'document.released',
    'en',
    '{{documentType}} released for {{reference}}',
    `
Hello {{recipientName}}

The {{documentType}} for shipment {{reference}} has been released and is now
available to you on the customer portal.

{{senderName}}
`,
  ),
  t(
    'document.released',
    'ar',
    'تم إصدار {{documentTypeAr}} للشحنة {{reference}}',
    `
مرحباً {{recipientName}}

تم إصدار {{documentTypeAr}} الخاص بالشحنة {{reference}}، وهو متاح لكم الآن عبر
بوابة العملاء.

{{senderName}}
`,
  ),

  // --- invoice.issued (customer) --------------------------------------------
  t(
    'invoice.issued',
    'en',
    'Invoice {{seriesNo}}',
    `
Hello {{recipientName}}

Invoice {{seriesNo}} has been issued.

Amount: {{total}} {{currency}}
Due: {{dueOn}}

The invoice is available on the customer portal.

{{senderName}}
`,
  ),
  t(
    'invoice.issued',
    'ar',
    'الفاتورة {{seriesNo}}',
    `
مرحباً {{recipientName}}

تم إصدار الفاتورة {{seriesNo}}.

المبلغ: {{total}} {{currency}}
تاريخ الاستحقاق: {{dueOn}}

الفاتورة متاحة عبر بوابة العملاء.

{{senderName}}
`,
  ),

  // --- invoice.overdue (customer) -------------------------------------------
  t(
    'invoice.overdue',
    'en',
    'Invoice {{seriesNo}} is overdue',
    `
Hello {{recipientName}}

Invoice {{seriesNo}} was due on {{dueOn}} and is now {{daysOverdue}} days
overdue.

Amount outstanding: {{total}} {{currency}}

If payment has already been sent, please ignore this and let us know the
reference so that we can match it.

{{senderName}}
`,
  ),
  t(
    'invoice.overdue',
    'ar',
    'الفاتورة {{seriesNo}} متأخرة السداد',
    `
مرحباً {{recipientName}}

استحقت الفاتورة {{seriesNo}} بتاريخ {{dueOn}} وقد تأخر سدادها {{daysOverdue}}
يوماً.

المبلغ المستحق: {{total}} {{currency}}

إذا تم السداد مسبقاً، يرجى تجاهل هذه الرسالة وإفادتنا برقم الحوالة لمطابقتها.

{{senderName}}
`,
  ),
]
