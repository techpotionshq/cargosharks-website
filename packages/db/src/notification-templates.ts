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

import { sql } from 'drizzle-orm'
import type { Tx } from './actor'
import { notificationTemplates } from './schema/index'

export interface NotificationTemplateSeed {
  readonly eventKey: string
  readonly channel: 'email' | 'in_app' | 'whatsapp'
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

/**
 * The same event, worded for the topbar bell instead of a customer's inbox.
 *
 * In-app notifications are read by the person they are *about*, in a panel that
 * already shows who is signed in — so they carry no "Hello {{recipientName}}"
 * and no "{{senderName}}" sign-off. Those are the grammar of a letter to
 * someone else, and repeating them in a self-addressed alert reads as a mail
 * merge that escaped. The body is one sentence, because the reader is three
 * feet from the record and one click from opening it.
 *
 * Only the internal events get one — `notification-dispatch` never fans a
 * customer-audience event to `in_app`, because a customer has no bell to read
 * it. So there is deliberately no in-app row here for `quote.sent`,
 * `invoice.issued` and their kind, and the coverage test only requires the
 * `email` channel for every event for the same reason.
 */
function ia(
  eventKey: string,
  locale: 'en' | 'ar',
  subject: string,
  body: string,
): NotificationTemplateSeed {
  return { eventKey, channel: 'in_app', locale, subject, body: body.trim() }
}

/**
 * A chat message, for the channel the intake agent answers WhatsApp on.
 *
 * One short paragraph and a dash-signature, because a WhatsApp message that
 * opens "Hello" and closes with a letterhead reads as a mail merge pasted into
 * a chat. The subject is required by the table's shape and by the template
 * editor, and is never shown to the customer.
 */
function wa(
  eventKey: string,
  locale: 'en' | 'ar',
  subject: string,
  body: string,
): NotificationTemplateSeed {
  return { eventKey, channel: 'whatsapp', locale, subject, body: body.trim() }
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

  // --- enquiry.received (customer) ------------------------------------------
  t(
    'enquiry.received',
    'en',
    'We have your enquiry {{reference}}',
    `
Hello {{recipientName}}

Thank you — we have received your enquiry and logged it as {{reference}}.

Our team is reviewing it and will come back to you shortly. Please quote this
reference in any reply.

{{senderName}}
`,
  ),
  t(
    'enquiry.received',
    'ar',
    'استلمنا استفسارك {{reference}}',
    `
مرحباً {{recipientName}}

شكراً لك، لقد استلمنا استفسارك وسجّلناه برقم {{reference}}.

يقوم فريقنا بمراجعته وسيعود إليك قريباً. يُرجى ذكر هذا الرقم في أي مراسلة.

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

    The day count is worded by the worker (`runsOut`, `runsOutAr`), past or
    future with the plural each language needs: "ran out 5 days ago", "ينتهي
    خلال يومين". `{{daysRemaining}}` stopped at zero, so a clock entered after
    its free time had lapsed read "in 0 day(s)" (N7). The charge kind arrives
    worded in each language too, and the per-diem at its currency's decimals.
  */
  t(
    'free_time.expiring',
    'en',
    '{{reference}}: free time on {{containerNo}} {{runsOut}}, then {{kind}} at {{perDiem}} {{currency}} a day',
    `
Hello {{recipientName}}

Free time on container {{containerNo}} ({{reference}}) {{runsOut}}; the last free
day is {{expiresOn}}.

After that the {{kind}} clock charges {{perDiem}} {{currency}} per day, and the
charge is ours until the container moves.

{{senderName}}
`,
  ),
  t(
    'free_time.expiring',
    'ar',
    '{{reference}}: وقت السماح للحاوية {{containerNo}} {{runsOutAr}}، ثم {{kindAr}} بواقع {{perDiem}} {{currency}} يومياً',
    `
مرحباً {{recipientName}}

وقت السماح للحاوية {{containerNo}} ({{reference}}) {{runsOutAr}}، وآخر يوم مجاني هو
{{expiresOn}}.

وبعد ذلك يبدأ احتساب {{kindAr}} بواقع {{perDiem}} {{currency}} عن كل يوم، وتقع هذه
التكلفة علينا إلى أن تتحرك الحاوية.

{{senderName}}
`,
  ),

  /*
    credit_note.issued and payment.received (customer).

    Both close with what is still owed, because that is the number a customer
    acts on: a reduction or a receipt that does not say where the account now
    stands sends them to the statement to work it out.
  */
  t(
    'credit_note.issued',
    'en',
    'Credit note {{seriesNo}} against invoice {{invoiceSeriesNo}}',
    `
Hello {{recipientName}}

We have issued credit note {{seriesNo}} for {{total}} {{currency}} against invoice
{{invoiceSeriesNo}}.

The amount still due on invoice {{invoiceSeriesNo}} is now {{outstanding}} {{currency}}.

{{senderName}}
`,
  ),
  t(
    'credit_note.issued',
    'ar',
    'إشعار دائن {{seriesNo}} على الفاتورة {{invoiceSeriesNo}}',
    `
مرحباً {{recipientName}}

أصدرنا لكم إشعاراً دائناً رقم {{seriesNo}} بمبلغ {{total}} {{currency}} على الفاتورة
{{invoiceSeriesNo}}.

وأصبح المبلغ المستحق على الفاتورة {{invoiceSeriesNo}} الآن {{outstanding}} {{currency}}.

{{senderName}}
`,
  ),
  t(
    'payment.received',
    'en',
    'Payment received for invoice {{seriesNo}}',
    `
Hello {{recipientName}}

Thank you. We have received {{amount}} {{currency}} on {{receivedOn}} and set it
against invoice {{seriesNo}}.

The amount still due on invoice {{seriesNo}} is now {{outstanding}} {{currency}}.

{{senderName}}
`,
  ),
  t(
    'payment.received',
    'ar',
    'استلام دفعة للفاتورة {{seriesNo}}',
    `
مرحباً {{recipientName}}

شكراً لكم. استلمنا مبلغ {{amount}} {{currency}} بتاريخ {{receivedOn}} وخصمناه من
الفاتورة {{seriesNo}}.

وأصبح المبلغ المستحق على الفاتورة {{seriesNo}} الآن {{outstanding}} {{currency}}.

{{senderName}}
`,
  ),

  /*
    supplier_invoice.variance_flagged (internal) — FR-FN-09.

    The subject carries the partner and the total, because this lands in
    finance's inbox beside the day's other mail and the decision — query it or
    approve it — is made from the subject or not at all. Over-billing only; the
    review screen shows the rest.
  */
  t(
    'supplier_invoice.variance_flagged',
    'en',
    'Over-billed: {{partnerName}} on {{jobReference}} — {{totalVariance}} {{currency}}',
    `
Hello {{recipientName}}

Supplier invoice {{reference}} from {{partnerName}}, on job {{jobReference}}, has
{{flaggedCount}} line(s) billed over what the job accrued — {{totalVariance}}
{{currency}} in total.

The largest is {{worstDescription}}, over by {{worstVariance}} {{currency}}.

Review it in Qabandi before it is approved for payment.

{{senderName}}
`,
  ),
  t(
    'supplier_invoice.variance_flagged',
    'ar',
    'فاتورة مورّد أعلى من المستحق: {{partnerName}} على {{jobReference}} — {{totalVariance}} {{currency}}',
    `
مرحباً {{recipientName}}

فاتورة المورّد {{reference}} من {{partnerName}}، على الشحنة {{jobReference}}، تتضمن
{{flaggedCount}} بنداً محتسباً بأعلى مما استحق على الشحنة — بإجمالي فرق قدره
{{totalVariance}} {{currency}}.

أكبرها {{worstDescription}}، بزيادة قدرها {{worstVariance}} {{currency}}.

يرجى مراجعتها في نظام قبندي قبل اعتمادها للدفع.

{{senderName}}
`,
  ),

  /*
    rate_request.late_reply (internal) — FR-RT-10.

    The subject names the agent and the enquiry, because the decision — does
    the new figure matter — starts from knowing whose mail it is and about
    what. The request itself is untouched; this only says there is something
    to read.
  */
  t(
    'rate_request.late_reply',
    'en',
    'Another rate reply from {{partnerName}} on {{reference}}',
    `
Hello {{recipientName}}

{{partnerName}} has written again about the rate request on {{reference}}. That
request had already been read or decided, so the new mail has been filed on the
enquiry but not read into the request, and nothing about the award has changed.

Open the enquiry to read it and decide whether it changes anything.

{{senderName}}
`,
  ),
  t(
    'rate_request.late_reply',
    'ar',
    'رد آخر على طلب السعر من {{partnerName}} بخصوص {{reference}}',
    `
مرحباً {{recipientName}}

أرسل {{partnerName}} رسالة جديدة بشأن طلب السعر الخاص بـ {{reference}}. وقد سبقت
قراءة هذا الطلب أو البتّ فيه، لذا حُفظت الرسالة الجديدة على الاستفسار دون إدخالها
في الطلب، ولم يتغيّر شيء في الترسية.

يرجى فتح الاستفسار لقراءتها وتقرير ما إذا كانت تغيّر شيئاً.

{{senderName}}
`,
  ),

  /*
    The intake agent — FR-EQ-02.

    One sentence per line, unlike the letters above: `{{missing}}` grows with
    what is missing, and a hand-wrapped line that breaks just before it leaves
    the list dangling on a line of its own in a plain-text mail client.

    `intake.clarify` and `intake.confirm` go to whoever wrote in, on the channel
    they wrote on, at most once each per window — the turn worker owns those
    rules (`intake-turn.ts`) and the loop breakers with them. The wording asks
    for exactly what is missing and promises nothing the desk has not decided:
    "we will come back with a quotation", never a time.
  */
  t(
    'intake.clarify',
    'en',
    '{{reference}}: a few details so we can quote',
    `
Hello {{recipientName}}

Thank you for your enquiry, which we have logged as {{reference}}.

To prepare your quotation we still need {{missing}}.

A short reply with these is all we need.

{{senderName}}
`,
  ),
  t(
    'intake.clarify',
    'ar',
    '{{reference}}: بعض التفاصيل لإعداد عرض السعر',
    `
مرحباً {{recipientName}}

شكراً لاستفسارك، وقد سجّلناه برقم {{reference}}.

لإعداد عرض السعر نحتاج أيضاً إلى {{missing}}.

يكفينا ردّ قصير بهذه التفاصيل.

{{senderName}}
`,
  ),
  wa(
    'intake.clarify',
    'en',
    'Details needed for {{reference}}',
    'Thank you — to prepare your quotation ({{reference}}) we still need {{missing}}. — {{senderName}}',
  ),
  wa(
    'intake.clarify',
    'ar',
    'تفاصيل مطلوبة للطلب {{reference}}',
    'شكراً لك. لإعداد عرض السعر ({{reference}}) نحتاج أيضاً إلى {{missing}}. — {{senderName}}',
  ),
  t(
    'intake.confirm',
    'en',
    '{{reference}}: we have everything we need',
    `
Hello {{recipientName}}

Thank you — we have everything we need for your enquiry {{reference}}.

Our team will come back to you with a quotation. Please quote this reference in any reply.

{{senderName}}
`,
  ),
  t(
    'intake.confirm',
    'ar',
    '{{reference}}: وصلتنا كل التفاصيل',
    `
مرحباً {{recipientName}}

شكراً لك، وصلتنا كل التفاصيل اللازمة لاستفسارك {{reference}}.

سيعود إليك فريقنا بعرض السعر. يُرجى ذكر هذا الرقم في أي مراسلة.

{{senderName}}
`,
  ),
  wa(
    'intake.confirm',
    'en',
    'Enquiry {{reference}} complete',
    'Thank you — we have everything we need for {{reference}}. Our team will come back to you with a quotation. — {{senderName}}',
  ),
  wa(
    'intake.confirm',
    'ar',
    'اكتمل الطلب {{reference}}',
    'شكراً لك، وصلتنا كل التفاصيل اللازمة للطلب {{reference}}. سيعود إليك فريقنا بعرض السعر. — {{senderName}}',
  ),
  t(
    'intake.handoff',
    'en',
    'Enquiry {{reference}} needs a person',
    `
Hello {{recipientName}}

The intake agent has asked the customer on {{reference}} for the missing details
as many times as it is allowed to, and still lacks {{missing}}. It has stopped
writing to them.

Please pick the enquiry up.

{{senderName}}
`,
  ),
  t(
    'intake.handoff',
    'ar',
    'الاستفسار {{reference}} يحتاج إلى متابعة شخصية',
    `
مرحباً {{recipientName}}

طلب مساعد الاستقبال من العميل في {{reference}} التفاصيل الناقصة بالعدد المسموح به،
وما زال ينقصه {{missingAr}}. وقد توقّف عن مراسلته.

يرجى متابعة الاستفسار.

{{senderName}}
`,
  ),
  ia(
    'intake.handoff',
    'en',
    'Enquiry {{reference}} needs a person',
    'The intake agent has stopped asking the customer and still lacks {{missing}}.',
  ),
  ia(
    'intake.handoff',
    'ar',
    'الاستفسار {{reference}} يحتاج إلى متابعة شخصية',
    'توقّف مساعد الاستقبال عن مراسلة العميل وما زال ينقصه {{missingAr}}.',
  ),

  /*
    partner.mail_filed (internal) — a supplier's mail that is not a bill and not
    an enquiry. The subject is theirs, quoted, so the reader can tell a rate
    notice from a complaint before opening anything.
  */
  t(
    'partner.mail_filed',
    'en',
    'Mail from {{partnerName}}: {{subject}}',
    `
Hello {{recipientName}}

{{partnerName}} has written to the intake mailbox ("{{subject}}"). It is a
supplier, so the mail was not opened as a customer enquiry, and it carried no
bill to read.

Please read it in the mailbox and act on it if it needs anything.

{{senderName}}
`,
  ),
  t(
    'partner.mail_filed',
    'ar',
    'رسالة من {{partnerName}}: {{subject}}',
    `
مرحباً {{recipientName}}

كتب {{partnerName}} إلى صندوق الاستقبال ("{{subject}}"). ولأنه مورّد، لم تُفتح
الرسالة كاستفسار عميل، ولم تتضمن فاتورة لقراءتها.

يرجى قراءتها في صندوق البريد واتخاذ ما يلزم.

{{senderName}}
`,
  ),
  ia(
    'partner.mail_filed',
    'en',
    'Mail from {{partnerName}}: {{subject}}',
    'A supplier wrote to the intake mailbox with no bill attached; read it in the mailbox.',
  ),
  ia(
    'partner.mail_filed',
    'ar',
    'رسالة من {{partnerName}}: {{subject}}',
    'كتب مورّد إلى صندوق الاستقبال دون فاتورة مرفقة؛ يرجى قراءتها في صندوق البريد.',
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

  // --- quote.accepted / quote.declined (internal) ---------------------------
  // The customer's answer from the portal, to the branch that priced it.
  t(
    'quote.accepted',
    'en',
    'Quotation {{reference}} accepted by {{customer}}',
    `
Hello {{recipientName}}

{{customer}} accepted quotation {{reference}} on the customer portal.

Total: {{total}} {{currency}}

Open the quotation in Qabandi to book the shipment.

{{senderName}}
`,
  ),
  t(
    'quote.accepted',
    'ar',
    'قبل {{customerAr}} عرض السعر {{reference}}',
    `
مرحباً {{recipientName}}

قبل {{customerAr}} عرض السعر {{reference}} عبر بوابة العملاء.

الإجمالي: {{total}} {{currency}}

افتح عرض السعر في نظام قبندي لحجز الشحنة.

{{senderName}}
`,
  ),
  t(
    'quote.declined',
    'en',
    'Quotation {{reference}} declined by {{customer}}',
    `
Hello {{recipientName}}

{{customer}} declined quotation {{reference}} on the customer portal.

Total: {{total}} {{currency}}
Reason given: {{reason}}

{{senderName}}
`,
  ),
  t(
    'quote.declined',
    'ar',
    'رفض {{customerAr}} عرض السعر {{reference}}',
    `
مرحباً {{recipientName}}

رفض {{customerAr}} عرض السعر {{reference}} عبر بوابة العملاء.

الإجمالي: {{total}} {{currency}}
السبب المذكور: {{reason}}

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

  // ==========================================================================
  // In-app — the six internal events, worded for the topbar bell (see `ia`).
  //
  // Subjects are the headline the bell shows collapsed; bodies are the one line
  // it shows open. No greeting, no signature — this is read by the person it is
  // about. Each uses a subset of the event's fields; the email row above still
  // uses the rest, so no declared field goes unused.
  // ==========================================================================

  // --- enquiry.created ------------------------------------------------------
  ia(
    'enquiry.created',
    'en',
    'New enquiry {{reference}}',
    'Received and waiting for an owner. Open it to assign it and start the response clock.',
  ),
  ia(
    'enquiry.created',
    'ar',
    'استفسار جديد {{reference}}',
    'تم استلامه وينتظر الإسناد. افتحه لإسناده وبدء احتساب زمن الاستجابة.',
  ),

  // --- quote.accepted / quote.declined --------------------------------------
  ia(
    'quote.accepted',
    'en',
    '{{customer}} accepted {{reference}}',
    'Accepted on the portal for {{total}} {{currency}}. Open it to book the shipment.',
  ),
  ia(
    'quote.accepted',
    'ar',
    'قبل {{customerAr}} العرض {{reference}}',
    'تم القبول عبر البوابة بقيمة {{total}} {{currency}}. افتحه لحجز الشحنة.',
  ),
  ia(
    'quote.declined',
    'en',
    '{{customer}} declined {{reference}}',
    'Declined on the portal. Reason given: {{reason}}',
  ),
  ia(
    'quote.declined',
    'ar',
    'رفض {{customerAr}} العرض {{reference}}',
    'تم الرفض عبر البوابة. السبب المذكور: {{reason}}',
  ),

  // --- enquiry.sla_breached -------------------------------------------------
  ia(
    'enquiry.sla_breached',
    'en',
    'Overdue first response — {{reference}}',
    'Past the agreed time for a first response and still unanswered. It needs a reply now.',
  ),
  ia(
    'enquiry.sla_breached',
    'ar',
    'تأخر الرد الأول — {{reference}}',
    'تجاوز المدة المتفق عليها للرد الأول ولم يُرد عليه بعد. يحتاج إلى رد الآن.',
  ),

  // --- free_time.expiring ---------------------------------------------------
  ia(
    'free_time.expiring',
    'en',
    '{{reference}}: free time on {{containerNo}} {{runsOut}}',
    'Last free day {{expiresOn}}. After that {{kind}} at {{perDiem}} {{currency}} per day, ours until the container moves.',
  ),
  ia(
    'free_time.expiring',
    'ar',
    '{{reference}}: وقت السماح للحاوية {{containerNo}} {{runsOutAr}}',
    'آخر يوم مجاني {{expiresOn}}، وبعده {{kindAr}} بواقع {{perDiem}} {{currency}} عن كل يوم، وتقع علينا حتى تتحرك الحاوية.',
  ),

  // --- rate_card.expiring ---------------------------------------------------
  ia(
    'rate_card.expiring',
    'en',
    '{{count}} rate card(s) lapse within {{horizonDays}} days',
    'The first lapses on {{soonest}}. Renew before a lane is quoted from memory.',
  ),
  ia(
    'rate_card.expiring',
    'ar',
    'انتهاء صلاحية {{count}} من بطاقات الأسعار خلال {{horizonDays}} يوماً',
    'أولها بتاريخ {{soonest}}. جدّدها قبل أن يُسعَّر أي خط بالتقدير.',
  ),

  // --- exception.opened -----------------------------------------------------
  ia(
    'exception.opened',
    'en',
    '{{severity}} exception on {{reference}}',
    '{{description}} — on the exception register, resolution clock running.',
  ),
  ia(
    'exception.opened',
    'ar',
    'استثناء بدرجة {{severity}} على {{reference}}',
    '{{description}} — مُدرج في سجل الاستثناءات وبدأ احتساب مدة المعالجة.',
  ),

  // --- rate_request.late_reply ---------------------------------------------
  ia(
    'rate_request.late_reply',
    'en',
    'Another reply from {{partnerName}} on {{reference}}',
    'The request was already read or decided, so the new mail is filed but not read into it. Open the enquiry to decide whether it changes anything.',
  ),
  ia(
    'rate_request.late_reply',
    'ar',
    'رد آخر من {{partnerName}} على {{reference}}',
    'سبق قراءة طلب السعر أو البتّ فيه، لذا حُفظت الرسالة الجديدة دون إدخالها في الطلب. افتح الاستفسار لتقرر إن كانت تغيّر شيئاً.',
  ),

  // --- supplier_invoice.variance_flagged ------------------------------------
  ia(
    'supplier_invoice.variance_flagged',
    'en',
    'Over-billed: {{partnerName}} — {{totalVariance}} {{currency}}',
    '{{reference}} on {{jobReference}}: {{flaggedCount}} line(s) over accrual. Review before it is approved for payment.',
  ),
  ia(
    'supplier_invoice.variance_flagged',
    'ar',
    'فاتورة أعلى من المستحق: {{partnerName}} — {{totalVariance}} {{currency}}',
    '{{reference}} على {{jobReference}}: {{flaggedCount}} بنداً أعلى من المستحق. راجعها قبل اعتمادها للدفع.',
  ),
]

/**
 * Bring the default templates in the database up to the copy above.
 *
 * The seed used to be the only writer, and a deployment runs migrations, not
 * the seed. So an event added after a database was seeded (the portal's
 * quotation decisions, the credit note and receipt notices) had no template
 * there, and the dispatcher failed every delivery of it with "no template".
 * The service now calls this at boot, so every deploy carries its own copy.
 *
 * Same upsert, same reasoning as the seed: these rows are vendor copy, and
 * only the default (`branch_id` null) row is written. An administrator's
 * wording lives on a branch row, which this never matches.
 */
export async function syncNotificationTemplates(tx: Tx): Promise<number> {
  await tx
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
      set: { subject: sql`excluded.subject`, body: sql`excluded.body`, updatedAt: new Date() },
    })
  return NOTIFICATION_TEMPLATES.length
}
