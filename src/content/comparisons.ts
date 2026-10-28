/**
 * The comparison pages, as data.
 *
 * Four pages that are the same argument with different contents, so they are
 * one component (`src/components/compare/ComparisonPage.tsx`) and this table
 * rather than four documents that drift. The editorial rule they follow is the
 * one `/compare/` states: no tick-and-cross grid about somebody else's
 * product. A grid is a snapshot of another company's roadmap that starts
 * decaying the day it is published, and the person it misleads is the buyer.
 *
 * So there is no `features: { us: true, them: false }` anywhere below, and no
 * field that could hold one. What each page carries instead:
 *
 *   - `theirPitch`: what the vendor says about itself, read off the page in
 *     `source` on the date in `checked`, and printed with both. A claim with a
 *     date on it goes stale visibly, which a grid never does.
 *   - `pickThem`: the case for the other product, written to be true. A
 *     comparison that cannot name a reader who should buy the other thing is
 *     an advertisement.
 *   - `pickUs`: mechanisms, each one checkable in the demo.
 *   - `ask`: the questions to put to both vendors. `ours` is our answer;
 *     `tell` is what a good answer sounds like from anybody, us included. It
 *     replaced a blank column for the reader to fill in on the call, which on a
 *     screen read as content that had failed to load.
 *
 * Every `theirPitch` was read off the vendor's own page, not recalled. The
 * first pass was written from memory and got all three wrong in the same way:
 * Logistaas publishes "80+ countries" and offices in Amman and London, not "the
 * Middle East, Africa and Asia"; DP World calls CARGOES Runner an ERP for small
 * and medium-sized forwarders, not a "cloud logistics platform"; CargoWise's
 * front page does not mention an implementation-partner network. Cite what you
 * read. `cargoes.com` refuses non-browser requests with a 403, so the CARGOES
 * Runner source is DP World's own product page, where it was actually read.
 *
 * `h1` and `meta` lead with the phrase a buyer searches ("CargoSharks vs
 * CargoWise", "CargoWise alternative"); `title` is the short name the related
 * links on the market pages print under "vs CargoWise".
 */

import type { Bi } from '@/content/copy'

export interface Comparison {
  /** URL segment under `/compare/`. */
  slug: string
  /** The other thing, as a person would say it. */
  name: string
  /** For the mega menu. */
  short: string
  /** `null` where there is no vendor: a spreadsheet has nobody to misquote. */
  source: string | null
  /** ISO date somebody last read `source`. Rendered, on purpose. */
  checked: string | null
  /** The search phrase first. */
  h1: Bi
  /** English only, like the pages. Title ≤ 60 characters, description ≤ 155. */
  meta: { title: string; description: string }
  /** Short, for related-link cards elsewhere on the site. */
  title: Bi
  lede: Bi
  theirPitch: Bi
  pickThem: { heading: Bi; points: Bi[] }
  pickUs: { heading: Bi; points: Bi[] }
  ask: { question: Bi; ours: Bi; tell: Bi }[]
}

/** Shared by three of the four pages, so the wording cannot drift between them. */
const OUR_POINTS: Bi[] = [
  {
    en: 'Arabic and English are one build, checked for parity on every change, and every document the system issues exists in both.',
    ar: 'العربية والإنجليزية بناء واحد، يُتحقق من تطابقهما مع كل تعديل، وكل مستند يصدره النظام موجود باللغتين.',
  },
  {
    en: 'The dinar keeps its three decimal places from the database to the printed invoice. Money is decimal end to end and never a floating-point number.',
    ar: 'الدينار يحتفظ بخاناته العشرية الثلاث من قاعدة البيانات إلى الفاتورة المطبوعة. الحساب عشري من طرف إلى طرف، ولا رقم عائم في أي موضع.',
  },
  {
    en: 'Separation between branches and entities is a row-level policy in the database on every table. A query written wrong returns nothing rather than somebody else’s shipments.',
    ar: 'الفصل بين الفروع والكيانات سياسة على مستوى الصف في قاعدة البيانات على كل جدول. والاستعلام المكتوب خطأً يعيد لا شيء، لا شحنات غيركم.',
  },
  {
    en: 'Nothing is deleted. A database trigger stamps every change with who made it and when, and a superseded row is marked superseded and kept.',
    ar: 'لا يُحذف شيء. مُشغِّل في قاعدة البيانات يختم كل تغيير بمن أجراه ومتى، والسطر المستبدَل يُعلَّم بأنه مستبدَل ويبقى.',
  },
  {
    en: 'You can open all of it now, on seeded data, with a sign-in for you, your customer and your agent, without talking to anybody.',
    ar: 'يمكنكم فتحه كاملاً الآن على بيانات مُعدّة، بحساب لكم ولعميلكم ولوكيلكم، دون التحدث إلى أحد.',
  },
]

/** Also shared: the questions are the same whoever you are asking. */
const SHARED_ASKS: { question: Bi; ours: Bi; tell: Bi }[] = [
  {
    question: {
      en: 'Is the Arabic a translation layer, or the same build?',
      ar: 'هل العربية طبقة ترجمة أم أنها البناء نفسه؟',
    },
    ours: {
      en: 'The same build. Right-to-left is part of the layout, and a build check fails if a string exists in one language and not the other. Open the demo, press the language switch, and look at a delivery order.',
      ar: 'البناء نفسه. الاتجاه من اليمين إلى اليسار جزء من بنية التصميم، ويفشل الفحص إن وُجد نص بلغة دون الأخرى. افتحوا النسخة التجريبية واضغطوا مبدّل اللغة وانظروا إلى أمر تسليم.',
    },
    tell: {
      en: 'A good answer names a mechanism: a parity check that fails a build, one catalogue for both languages, right-to-left in the layout. A weak one is “yes, we support Arabic” and a screenshot. Ask to see a printed delivery order; that is where an added-on language shows first.',
      ar: 'الجواب الجيد يسمّي آلية: فحص تطابق يُفشل البناء، وفهرس واحد للغتين، واتجاه من اليمين إلى اليسار في بنية التصميم. والجواب الضعيف هو «نعم، ندعم العربية» مع لقطة شاشة. اطلبوا أمر تسليم مطبوعاً؛ هناك تظهر اللغة المضافة أولاً.',
    },
  },
  {
    question: {
      en: 'How many decimal places does an invoice in Kuwaiti dinars carry?',
      ar: 'كم خانة عشرية تحملها فاتورة بالدينار الكويتي؟',
    },
    ours: {
      en: 'Three, everywhere, because the dinar has three. It is the fastest way to find out whether a system was built for dollars and adapted.',
      ar: 'ثلاث، في كل موضع، لأن للدينار ثلاثاً. وهذه أسرع طريقة لمعرفة ما إذا كان النظام قد بُني للدولار ثم كُيِّف.',
    },
    tell: {
      en: '“Three” should come back at once and without conditions. Hesitation, or “it is configurable”, usually means money is a floating-point number somewhere and the decimals are a display setting, which is fine until a rounding difference lands on a reconciliation.',
      ar: '«ثلاث» ينبغي أن تأتي فوراً وبلا شروط. والتردد، أو «هذا قابل للضبط»، يعني غالباً أن المال رقم عائم في مكان ما وأن الخانات إعداد عرض، وهذا مقبول إلى أن يظهر فرق تقريب في مطابقة.',
    },
  },
  {
    question: {
      en: 'Whose database is it, and can I have a copy of my data without asking?',
      ar: 'قاعدة البيانات لمن، وهل يمكنني أخذ نسخة من بياناتي دون طلب؟',
    },
    ours: {
      en: 'Yours: a PostgreSQL database in your own instance, shared with no other customer. An export in an open format is yours any day at no charge. Today we assemble it for you; a single self-service export action is specified and not yet built. Source escrow is available on request.',
      ar: 'لكم: قاعدة بيانات PostgreSQL في نسختكم الخاصة، لا يشارككم فيها عميل آخر. والتصدير بصيغة مفتوحة حقكم في أي يوم وبلا رسوم. نجمعه لكم اليوم؛ أما إجراء التصدير الذاتي بخطوة واحدة فمحدَّد ولم يُبنَ بعد. وإيداع الشيفرة المصدرية متاح عند الطلب.',
    },
    tell: {
      en: 'Listen for a named engine and an export you can trigger yourself. “We can arrange an extract” is a different answer from “here is the button”, and the difference is what leaving costs you in three years. Hold us to the same test.',
      ar: 'أنصتوا إلى اسم محرّك قاعدة بيانات وتصدير تشغّلونه بأنفسكم. «يمكننا ترتيب استخراج» جواب مختلف عن «هذا هو الزر»، والفرق بينهما هو كلفة المغادرة بعد ثلاث سنوات. وطبّقوا علينا الاختبار نفسه.',
    },
  },
  {
    question: {
      en: 'What does it cost when volume doubles?',
      ar: 'ما التكلفة إذا تضاعف الحجم؟',
    },
    ours: {
      en: 'Ask every vendor this, in writing. Per-shipment and per-transaction pricing is normal in this category, but it is a different shape of bill from a flat one, and the difference shows up in year two rather than at signature.',
      ar: 'اسألوا كل مورّد هذا، كتابةً. التسعير بالشحنة أو بالعملية معتاد في هذا المجال، لكنه شكل فاتورة مختلف عن الثابت، والفرق يظهر في السنة الثانية لا عند التوقيع.',
    },
    tell: {
      en: 'Any pricing shape is defensible; a refusal to put the shape in writing is not. Ask for the figure at twice and five times today’s volume, in the contract rather than on a call, and ask us the same way.',
      ar: 'أي شكل تسعير يمكن الدفاع عنه؛ أما رفض كتابة الشكل فلا. اطلبوا الرقم عند ضعف الحجم الحالي وخمسة أضعافه، في العقد لا في مكالمة، واسألونا بالطريقة نفسها.',
    },
  },
  {
    question: {
      en: 'Can I see it working, today, without a call?',
      ar: 'هل يمكنني رؤيته يعمل، اليوم، دون مكالمة؟',
    },
    ours: {
      en: 'Yes: demo.cargosharks.com, with no sign-up. This question separates vendors more reliably than any feature question, which is why it is last.',
      ar: 'نعم: demo.cargosharks.com، بلا تسجيل. وهذا السؤال يفرز المورّدين أكثر من أي سؤال عن المزايا، ولذلك جاء أخيراً.',
    },
    tell: {
      en: 'Yes and no are both legitimate. A demo that needs a discovery call first is a sales process, and also a reliable measure of how long onboarding will take to start.',
      ar: 'نعم ولا كلاهما مشروع. والنسخة التجريبية التي تتطلب مكالمة استكشاف أولاً عملية بيع، وهي أيضاً مقياس موثوق لكم سيستغرق بدء الإعداد.',
    },
  },
]

/**
 * The claims about us, and how a buyer checks each one in the demo.
 *
 * This table used to print the SQL that re-counts each figure (`select
 * count(*) from pg_policies …`) beside counts typed in by hand: 197 policies,
 * 80 audit triggers, 2,727 strings. A buyer cannot run SQL against our
 * database, and a typed count goes stale on the next migration without
 * anybody noticing. Every row is now something a person can do in the demo in
 * a minute or two, and the only numbers left are ones that do not move: the
 * modes, the dinar's decimals, the minutes.
 */
export const facts: { claim: Bi; check: Bi }[] = [
  {
    claim: { en: 'Five transport modes', ar: 'خمس وسائل شحن' },
    check: {
      en: 'Start an enquiry in the demo. The mode selector offers sea (FCL and LCL), air, road, rail and courier.',
      ar: 'ابدؤوا استفساراً في النسخة التجريبية. مُنتقي الوسيلة يعرض البحري (حاوية كاملة وبضاعة مجمعة) والجوي والبري والسككي والبريد السريع.',
    },
  },
  {
    claim: { en: 'Three decimals on every dinar', ar: 'ثلاث خانات عشرية لكل دينار' },
    check: {
      en: 'Open any invoice in the demo. A system built for dollars and adapted shows two.',
      ar: 'افتحوا أي فاتورة في النسخة التجريبية. النظام المبني للدولار ثم المكيَّف يُظهر خانتين.',
    },
  },
  {
    claim: { en: 'Separation enforced by the database', ar: 'فصل تفرضه قاعدة البيانات' },
    check: {
      en: 'Sign in to the demo as the customer contact and try to open the operations board. Other customers’ shipments are not hidden behind a filter; they are never returned.',
      ar: 'ادخلوا النسخة التجريبية بحساب العميل وحاولوا فتح لوحة العمليات. شحنات العملاء الآخرين لا يخفيها مرشّح؛ بل لا تُعاد أصلاً.',
    },
  },
  {
    claim: { en: 'Changes kept, nothing deleted', ar: 'التغييرات محفوظة ولا يُحذف شيء' },
    check: {
      en: 'Revise a milestone on a demo job. The planned time stays beside the revised one instead of being overwritten.',
      ar: 'عدّلوا مرحلة على شحنة في النسخة التجريبية. يبقى الموعد المخطط إلى جانب المعدَّل بدل أن يُكتب فوقه.',
    },
  },
  {
    claim: { en: 'Arabic and English, one build', ar: 'العربية والإنجليزية، بناء واحد' },
    check: {
      en: 'Press the language switch and issue a document. The layout, the figures and the document all turn right-to-left, with no English label left behind.',
      ar: 'اضغطوا مبدّل اللغة وأصدروا مستنداً. تنقلب الواجهة والأرقام والمستند من اليمين إلى اليسار، بلا تسمية إنجليزية متبقية.',
    },
  },
  {
    claim: { en: 'About ten minutes for all of it', ar: 'نحو عشر دقائق لكل ما سبق' },
    check: {
      en: 'No sign-up and no call. The whole page rests on that.',
      ar: 'بلا تسجيل وبلا مكالمة. وعلى هذا تقوم الصفحة كلها.',
    },
  },
]

export const comparisons: Comparison[] = [
  {
    slug: 'cargowise',
    name: 'CargoWise',
    short: 'CargoWise',
    source: 'https://www.cargowise.com/',
    checked: '2026-08-25',
    h1: {
      en: 'CargoSharks vs CargoWise: a CargoWise alternative for Gulf forwarders',
      ar: 'CargoSharks مقابل CargoWise: بديل لـ CargoWise لوكلاء الشحن في الخليج',
    },
    meta: {
      title: 'CargoSharks vs CargoWise: a CargoWise alternative',
      description:
        'CargoSharks vs CargoWise for Gulf forwarders: what CargoWise says about itself, when it is the better choice, and the questions to ask both vendors.',
    },
    title: {
      en: 'CargoSharks and CargoWise',
      ar: 'CargoSharks و CargoWise',
    },
    lede: {
      en: 'The two are not the same size of thing. Here is what each is for, where CargoWise is the better answer, and the questions worth putting to both of us.',
      ar: 'ليسا شيئاً واحداً في الحجم. هنا ما كل واحد منهما له، وأين يكون CargoWise الجواب الأفضل، والأسئلة التي تستحق أن تُطرح علينا معاً.',
    },
    theirPitch: {
      en: 'WiseTech Global’s CargoWise calls itself “the platform that powers global logistics”: “a single intelligent system” on “a single global database” that “unifies your end-to-end supply chain”, quoting 193 countries, 30 languages and 162 currencies. It addresses forwarders, customs brokers, warehouse operators, carriers and drayage operators from the same platform.',
      ar: 'يصف CargoWise، من WiseTech Global، نفسه بأنه «المنصة التي تشغّل الخدمات اللوجستية عالمياً»: «نظام ذكي واحد» على «قاعدة بيانات عالمية واحدة» يوحّد سلسلة التوريد من طرف إلى طرف، ويذكر 193 دولة و30 لغة و162 عملة. ويخاطب وكلاء الشحن والمخلّصين ومشغّلي المستودعات والناقلين من المنصة نفسها.',
    },
    pickThem: {
      heading: { en: 'Pick CargoWise if', ar: 'اختاروا CargoWise إذا' },
      points: [
        {
          en: 'You clear customs in a dozen countries and need the coverage of a platform quoting 193 of them. This is the strongest single reason to pick CargoWise.',
          ar: 'كنتم تخلّصون جمركياً في عشر دول أو أكثر وتحتاجون تغطية منصة تذكر 193 دولة. هذا أقوى سبب منفرد لاختيار CargoWise.',
        },
        {
          en: 'Your customers, agents or parent company already run it and the integration is the point.',
          ar: 'كان عملاؤكم أو وكلاؤكم أو الشركة الأم يشغّلونه أصلاً، وكان التكامل هو الغاية.',
        },
        {
          en: 'You have the implementation budget and an internal owner for it. A platform of that scope repays configuration, and configuration takes somebody’s year.',
          ar: 'كانت لديكم ميزانية تنفيذ ومسؤول داخلي له. منصة بهذا الاتساع تكافئ الضبط، والضبط يستغرق سنة من عمل أحدهم.',
        },
      ],
    },
    pickUs: {
      heading: { en: 'Pick CargoSharks if', ar: 'اختاروا CargoSharks إذا' },
      points: OUR_POINTS,
    },
    ask: SHARED_ASKS,
  },
  {
    slug: 'logistaas',
    name: 'Logistaas',
    short: 'Logistaas',
    source: 'https://www.logistaas.com/',
    checked: '2026-08-25',
    h1: {
      en: 'CargoSharks vs Logistaas: a Logistaas alternative built in Kuwait',
      ar: 'CargoSharks مقابل Logistaas: بديل لـ Logistaas بُني في الكويت',
    },
    meta: {
      title: 'CargoSharks vs Logistaas: a Logistaas alternative',
      description:
        'CargoSharks vs Logistaas: two cloud freight systems for forwarders the same size. Where Logistaas is the better choice, where we are, and what to ask both.',
    },
    title: {
      en: 'CargoSharks and Logistaas',
      ar: 'CargoSharks و Logistaas',
    },
    lede: {
      en: 'The closest comparison on this list: cloud freight software, sold to forwarders our size, active in this region. The differences are narrow and specific, so they are written down precisely.',
      ar: 'أقرب مقارنة في هذه القائمة: برنامج شحن سحابي يُباع لوكلاء بحجمنا، وناشط في هذه المنطقة. الفروق ضيقة ومحددة، ولذلك كُتبت بدقة.',
    },
    theirPitch: {
      en: 'Logistaas calls itself a transportation management system and “freight forwarding software of the future”, and says forwarders in more than 80 countries use it. It names modules for sales and pricing, operations, finance, accounting and a customer portal, and it publishes offices in Amman and London.',
      ar: 'يصف Logistaas نفسه بأنه نظام لإدارة النقل و«برنامج الشحن الذي يمثّل المستقبل»، ويقول إن وكلاء في أكثر من 80 دولة يستخدمونه. ويسمّي وحدات للمبيعات والتسعير والعمليات والمالية والمحاسبة وبوابة للعملاء، وينشر مكتبين في عمّان ولندن.',
    },
    pickThem: {
      heading: { en: 'Pick Logistaas if', ar: 'اختاروا Logistaas إذا' },
      points: [
        {
          en: 'You want a vendor with many live customers behind it: they say forwarders in more than 80 countries use it. We are a newer product with far fewer customers, and in your position we would weigh that most heavily.',
          ar: 'أردتم مورّداً وراءه عملاء عاملون كثيرون: يقولون إن وكلاء في أكثر من 80 دولة يستخدمونه. نحن منتج أحدث وعملاؤنا أقل بكثير، ولو كنا مكانكم لرجّحنا هذا أكثر من غيره.',
        },
        {
          en: 'You need a module we have not built. Our boundary is published on the What we do page: no warehouse module, no purchase-order management, no native mobile app.',
          ar: 'احتجتم وحدة لم نبنِها. حدودنا منشورة في صفحة «ماذا نفعل»: لا وحدة مستودعات، ولا إدارة أوامر شراء، ولا تطبيق جوال أصلي.',
        },
      ],
    },
    pickUs: {
      heading: { en: 'Pick CargoSharks if', ar: 'اختاروا CargoSharks إذا' },
      points: OUR_POINTS,
    },
    ask: SHARED_ASKS,
  },
  {
    slug: 'cargoes-runner',
    name: 'CARGOES Runner',
    short: 'CARGOES Runner',
    source: 'https://www.dpworld.com/smart-trade/freight-forwarding-erp',
    checked: '2026-08-25',
    h1: {
      en: 'CargoSharks vs CARGOES Runner: an independent alternative to DP World’s ERP',
      ar: 'CargoSharks مقابل CARGOES Runner: بديل مستقل عن نظام DP World',
    },
    meta: {
      title: 'CargoSharks vs CARGOES Runner: an independent alternative',
      description:
        'CargoSharks vs CARGOES Runner, DP World’s ERP for forwarders: when a group that size is the reason to pick it, and where an independent system fits.',
    },
    title: {
      en: 'CargoSharks and CARGOES Runner',
      ar: 'CargoSharks و CARGOES Runner',
    },
    lede: {
      en: 'A DP World product, which is the fact that matters most about it and has nothing to do with software. Here is what that buys you, and where a smaller independent system is the better answer.',
      ar: 'منتج من DP World، وهذه أهم حقيقة عنه ولا علاقة لها بالبرمجيات. هنا ما يشتريه لكم ذلك، وأين يكون النظام المستقل الأصغر جواباً أفضل.',
    },
    theirPitch: {
      en: 'DP World describes CARGOES Runner as an ERP built from the ground up for small and medium-sized freight forwarders, aimed at back-office operations: quotations against your own tariff, quote-to-ship, digital invoicing and margin analytics, with an integrated ocean sailing-schedule search.',
      ar: 'تصف DP World منتج CARGOES Runner بأنه نظام تخطيط موارد بُني من الأساس لوكلاء الشحن الصغار والمتوسطين، موجَّه إلى عمليات المكتب الخلفي: تسعير من تعرفتكم، ومن العرض إلى الشحن، وفوترة رقمية وتحليلات هوامش، مع بحث مدمج في جداول الإبحار.',
    },
    pickThem: {
      heading: { en: 'Pick CARGOES Runner if', ar: 'اختاروا CARGOES Runner إذا' },
      points: [
        {
          en: 'Your volume runs through DP World terminals and you want the platform that sits closest to them.',
          ar: 'كان حجمكم يمرّ عبر محطات DP World وأردتم المنصة الأقرب إليها.',
        },
        {
          en: 'The backing of a group that size is part of what you are buying. That is a legitimate reason to choose a vendor, and we would say so on a call.',
          ar: 'كان دعم مجموعة بهذا الحجم جزءاً مما تشترونه. هذا سبب مشروع لاختيار مورّد، وسنقوله في مكالمة.',
        },
      ],
    },
    pickUs: {
      heading: { en: 'Pick CargoSharks if', ar: 'اختاروا CargoSharks إذا' },
      points: OUR_POINTS,
    },
    ask: SHARED_ASKS,
  },
  {
    slug: 'spreadsheets',
    name: 'spreadsheets and email',
    short: 'Spreadsheets',
    // No vendor, so nobody to quote and nothing to go stale. This is the one
    // page that can be direct about the alternative, because the alternative
    // is a working method rather than somebody's product.
    source: null,
    checked: null,
    h1: {
      en: 'Freight forwarding software vs Excel: the three places a spreadsheet breaks',
      ar: 'برنامج الشحن مقابل Excel: المواضع الثلاثة التي ينكسر فيها جدول البيانات',
    },
    meta: {
      title: 'Freight forwarding software vs Excel: where it breaks',
      description:
        'When a spreadsheet and a shared mailbox are still right for a forwarder, and the three moments they stop being right: rates, free time and history.',
    },
    title: {
      en: 'CargoSharks and the spreadsheet',
      ar: 'CargoSharks وجدول البيانات',
    },
    lede: {
      en: 'The real incumbent, and the one alternative here we can be blunt about: a spreadsheet has no vendor to misrepresent. It is also better than most software at several things, which is why it is still winning.',
      ar: 'المنافس الحقيقي، والبديل الوحيد هنا الذي يمكننا الحديث عنه بصراحة: فجدول البيانات ليس له مورّد نسيء تمثيله. وهو أيضاً أفضل من معظم البرمجيات في أمور عدة، ولهذا ما زال يفوز.',
    },
    theirPitch: {
      en: 'A rate sheet in Excel, enquiries in four mailboxes, a WhatsApp group per customer and a shared drive of PDFs. Nobody chose this. It accumulated, and it works.',
      ar: 'جدول أسعار في Excel، واستفسارات في أربعة صناديق بريد، ومجموعة واتساب لكل عميل، ومجلد مشترك من ملفات PDF. لم يخترها أحد. تراكمت، وهي تعمل.',
    },
    pickThem: {
      heading: { en: 'Keep the spreadsheet if', ar: 'أبقوا على جدول البيانات إذا' },
      points: [
        {
          en: 'You move a handful of shipments a month. Below some volume the overhead of any system is larger than the problem it solves.',
          ar: 'كنتم تحرّكون بضع شحنات في الشهر. تحت حجم معيّن تكون كلفة أي نظام أكبر من المشكلة التي يحلّها.',
        },
        {
          en: 'One person does the whole job end to end and it is all in their head. What a system replaces is a handover, and you do not have one.',
          ar: 'كان شخص واحد يؤدي العمل كله من طرف إلى طرف وكله في رأسه. فما يستبدله النظام هو التسليم بين الأشخاص، وأنتم لا تسلّمون.',
        },
        {
          en: 'Nothing has ever surfaced weeks late on a supplier invoice. If that is true, the case below does not apply to you.',
          ar: 'لم يظهر لديكم قط شيء متأخراً أسابيع على فاتورة مورّد. إن صحّ هذا، فما دونه لا ينطبق عليكم.',
        },
      ],
    },
    // The case for a system is the three moments in `comparison-leads.ts`,
    // each with what happens on a file instead; repeating them here as a
    // second list is what made the old page say everything twice.
    pickUs: {
      heading: { en: 'What a system does instead', ar: 'ما يفعله النظام بدلاً من ذلك' },
      points: [],
    },
    ask: SHARED_ASKS,
  },
]
