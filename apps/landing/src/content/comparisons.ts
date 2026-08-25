/**
 * The comparison pages, as data.
 *
 * Four pages that are the same page with different contents, so they are one
 * component and a table rather than four hand-written documents that drift.
 * `/compare/` §03 already sets the editorial rule these follow, and it is worth
 * restating here because it is the whole design of this file:
 *
 *   > We do not publish claims about other people's products. […] A grid is a
 *   > snapshot of somebody else's roadmap. Every entry in it starts decaying
 *   > the day it is published, and the thing about a decayed competitive claim
 *   > is that the person it misleads is your prospect and the person who looks
 *   > foolish is you.
 *
 * So there is no `features: { us: true, them: false }` anywhere below, and
 * there is no field that could hold one. What each page carries instead:
 *
 *   - `theirPitch` — **what the vendor says about itself**, in one or two
 *     sentences, with `source` pointing at the page it was read from and
 *     `checked` recording the day somebody read it. Positioning rather than
 *     features, because positioning is what a vendor states plainly and
 *     features are what a grid gets wrong.
 *   - `pickThem` — the case *for* the other product, written to be true. A
 *     comparison page that cannot name a reader who should buy the other thing
 *     is an advertisement wearing a comparison's clothes, and a forwarder
 *     evaluating three systems can tell in one paragraph.
 *   - `pickUs` — mechanisms, each checkable in the demo or this repository.
 *   - `ask` — the questions to put to both vendors, with our answer already
 *     written. Somebody who takes this list to a CargoWise call and gets a
 *     better answer than ours should buy CargoWise; that is what makes the list
 *     worth publishing.
 *
 * `checked` is a real date and it is meant to go stale visibly. A page that
 * says when it was last read is a page a reader can discount for themselves,
 * which is the honest version of a claim about somebody else.
 */

import type { Bi } from '@/content/copy'

export interface Comparison {
  /** URL segment under `/compare/`. */
  slug: string
  /** The other thing, as a person would say it. */
  name: string
  /** For the page title and the mega menu. */
  short: string
  /** `null` where there is no vendor — a spreadsheet has nobody to misquote. */
  source: string | null
  /** ISO date somebody last read `source`. Rendered, on purpose. */
  checked: string | null
  title: Bi
  lede: Bi
  theirPitch: Bi
  pickThem: { heading: Bi; points: Bi[] }
  pickUs: { heading: Bi; points: Bi[] }
  ask: { question: Bi; ours: Bi }[]
}

/** Shared by three of the four pages, so the wording cannot drift between them. */
const OUR_POINTS: Bi[] = [
  {
    en: 'Arabic and English are the same build, checked for parity on every commit — 2,709 interface strings in both, and every document the system issues exists in each.',
    ar: 'العربية والإنجليزية بناء واحد، يُتحقق من تطابقهما مع كل تعديل — 2,709 نص واجهة باللغتين، وكل مستند يصدره النظام موجود بكليهما.',
  },
  {
    en: 'The dinar keeps three decimal places from the database to the printed invoice. Money is decimal end to end and never a floating-point number.',
    ar: 'الدينار يحتفظ بخاناته العشرية الثلاث من قاعدة البيانات إلى الفاتورة المطبوعة. الحساب عشري من طرف إلى طرف، ولا رقم عائم في أي موضع.',
  },
  {
    en: 'Separation between branches and entities is a row-level policy in the database, not a filter in the application — 197 of them. A query written wrong returns nothing rather than somebody else’s shipments.',
    ar: 'الفصل بين الفروع والكيانات سياسة على مستوى الصف في قاعدة البيانات لا مرشّح في التطبيق — 197 سياسة. والاستعلام المكتوب خطأً يعيد لا شيء، لا شحنات غيركم.',
  },
  {
    en: 'Nothing is deleted. Every change is stamped with who made it and when, by 80 audit triggers, and a superseded row is marked superseded and stays.',
    ar: 'لا يُحذف شيء. كل تغيير مختوم بمن أجراه ومتى، عبر 80 مُشغِّل تدقيق، والسطر المستبدَل يُعلَّم بأنه مستبدَل ويبقى.',
  },
  {
    en: 'You can open the whole thing right now, on seeded data, with a sign-in for you, your customer and your agent, without talking to anybody.',
    ar: 'يمكنكم فتحه كاملاً الآن على بيانات مُعدّة، بحساب لكم ولعميلكم ولوكيلكم، دون التحدث إلى أحد.',
  },
]

/** Also shared: the questions are the same questions whoever you are asking. */
const SHARED_ASKS: { question: Bi; ours: Bi }[] = [
  {
    question: {
      en: 'Is the Arabic a translation layer, or is it the same build?',
      ar: 'هل العربية طبقة ترجمة أم أنها البناء نفسه؟',
    },
    ours: {
      en: 'The same build. Right-to-left is in the layout rather than added on top of it, and `pnpm lint` fails if a string exists in one language and not the other. Open the demo, press the language switch, and look at a delivery order.',
      ar: 'البناء نفسه. الاتجاه من اليمين إلى اليسار في بنية التصميم لا مضافاً إليه، ويفشل الفحص إن وُجد نص بلغة دون الأخرى. افتحوا النسخة التجريبية واضغطوا مبدّل اللغة وانظروا إلى أمر تسليم.',
    },
  },
  {
    question: {
      en: 'How many decimal places does an invoice in Kuwaiti dinars carry?',
      ar: 'كم خانة عشرية تحملها فاتورة بالدينار الكويتي؟',
    },
    ours: {
      en: 'Three, everywhere, because the dinar has three. This is the single fastest way to find out whether a system was built for dollars and adapted.',
      ar: 'ثلاث، في كل موضع، لأن للدينار ثلاثاً. وهذه أسرع طريقة لمعرفة ما إذا كان النظام قد بُني للدولار ثم كُيِّف.',
    },
  },
  {
    question: {
      en: 'Whose database is it, and can I have a copy of my data on a Tuesday afternoon without asking?',
      ar: 'قاعدة البيانات لمن، وهل يمكنني أخذ نسخة من بياناتي بعد ظهر الثلاثاء دون طلب؟',
    },
    ours: {
      en: 'PostgreSQL, and yes. The tenancy rules are in the schema rather than in our application, which is also what makes the answer to the first half of that question boring.',
      ar: 'PostgreSQL، ونعم. قواعد الفصل بين المستأجرين في بنية القاعدة لا في تطبيقنا، وهو أيضاً ما يجعل جواب الشطر الأول ممِلاً.',
    },
  },
  {
    question: {
      en: 'What does it cost when volume doubles?',
      ar: 'ما التكلفة إذا تضاعف الحجم؟',
    },
    ours: {
      en: 'Ask every vendor this and ask for the answer in writing. Per-shipment and per-transaction pricing is normal in this category and is not a trick — but it is a different shape of bill from a flat one, and the difference shows up in year two rather than at signature.',
      ar: 'اسألوا كل مورّد هذا واطلبوا الجواب مكتوباً. التسعير بالشحنة أو بالعملية معتاد في هذا المجال وليس حيلة — لكنه شكل فاتورة مختلف عن الثابت، والفرق يظهر في السنة الثانية لا عند التوقيع.',
    },
  },
  {
    question: {
      en: 'Can I see it working, today, without a call?',
      ar: 'هل يمكنني رؤيته يعمل، اليوم، دون مكالمة؟',
    },
    ours: {
      en: 'Yes — demo.cargosharks.com, no sign-up. We think this question separates vendors more reliably than any feature question, which is why it is last.',
      ar: 'نعم — demo.cargosharks.com، بلا تسجيل. ونرى أن هذا السؤال يفرز المورّدين أكثر من أي سؤال عن المزايا، ولذلك جاء أخيراً.',
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
    title: {
      en: 'CargoSharks and CargoWise',
      ar: 'CargoSharks و CargoWise',
    },
    lede: {
      en: 'The two are not the same size of thing, and pretending otherwise would waste your afternoon. Here is what each one is for, where CargoWise is the better answer, and the questions worth putting to both of us.',
      ar: 'ليسا شيئاً واحداً في الحجم، والتظاهر بغير ذلك يضيّع وقتكم. هنا ما كل واحد منهما له، وأين يكون CargoWise الجواب الأفضل، والأسئلة التي تستحق أن تُطرح علينا معاً.',
    },
    theirPitch: {
      en: 'CargoWise describes itself as a single global platform for logistics execution, from WiseTech Global, aimed at forwarders operating across many countries with deep customs coverage and a large implementation-partner network.',
      ar: 'يصف CargoWise نفسه بأنه منصة عالمية واحدة لتنفيذ الخدمات اللوجستية، من WiseTech Global، موجَّهة إلى وكلاء يعملون في دول كثيرة، بتغطية جمركية عميقة وشبكة شركاء تنفيذ واسعة.',
    },
    pickThem: {
      heading: { en: 'Pick CargoWise if', ar: 'اختاروا CargoWise إذا' },
      points: [
        {
          en: 'You clear customs in a dozen countries and need the filing coverage that comes with a platform of that size. This is the strongest single reason and we are not going to argue with it.',
          ar: 'كنتم تخلّصون جمركياً في عشر دول أو أكثر وتحتاجون تغطية التقديم التي تأتي مع منصة بهذا الحجم. هذا أقوى سبب منفرد ولن نجادل فيه.',
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
      heading: { en: 'Pick us if', ar: 'اختارونا إذا' },
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
    title: {
      en: 'CargoSharks and Logistaas',
      ar: 'CargoSharks و Logistaas',
    },
    lede: {
      en: 'The closest comparison on this list: cloud freight software, sold to forwarders our size, active in this region. So the differences are narrow and specific, which makes them worth writing down properly.',
      ar: 'أقرب مقارنة في هذه القائمة: برنامج شحن سحابي يُباع لوكلاء بحجمنا، وناشط في هذه المنطقة. لذا فالفروق ضيقة ومحددة، وهو ما يجعل كتابتها بدقة أمراً يستحق.',
    },
    theirPitch: {
      en: 'Logistaas describes itself as cloud software for freight forwarders and customs brokers, covering quotations, operations and accounting, with customers across the Middle East, Africa and Asia.',
      ar: 'يصف Logistaas نفسه بأنه برنامج سحابي لوكلاء الشحن والمخلّصين الجمركيين، يغطي عروض الأسعار والعمليات والمحاسبة، بعملاء في الشرق الأوسط وأفريقيا وآسيا.',
    },
    pickThem: {
      heading: { en: 'Pick Logistaas if', ar: 'اختاروا Logistaas إذا' },
      points: [
        {
          en: 'You want a vendor with years of live customers behind them. We are in pilot. That is a real difference and it is the one we would weigh most heavily in your position.',
          ar: 'أردتم مورّداً وراءه سنوات من العملاء العاملين. نحن في مرحلة تجريبية. هذا فرق حقيقي، وهو ما كنا سنرجّحه أكثر لو كنا مكانكم.',
        },
        {
          en: 'You need a module we have not built. Our boundary is published on /what-we-do/ §07 — no warehouse module, no purchase-order management, no native mobile app.',
          ar: 'احتجتم وحدة لم نبنِها. حدودنا منشورة في /what-we-do/ §07 — لا وحدة مستودعات، ولا إدارة أوامر شراء، ولا تطبيق جوال أصلي.',
        },
      ],
    },
    pickUs: {
      heading: { en: 'Pick us if', ar: 'اختارونا إذا' },
      points: OUR_POINTS,
    },
    ask: SHARED_ASKS,
  },
  {
    slug: 'cargoes-runner',
    name: 'CARGOES Runner',
    short: 'CARGOES Runner',
    source: 'https://www.cargoes.com/',
    checked: '2026-08-25',
    title: {
      en: 'CargoSharks and CARGOES Runner',
      ar: 'CargoSharks و CARGOES Runner',
    },
    lede: {
      en: 'A DP World product, which is the fact that matters most about it and has nothing to do with software. Here is what that buys you, and where a smaller independent system is the better answer.',
      ar: 'منتج من DP World، وهذه أهم حقيقة عنه ولا علاقة لها بالبرمجيات. هنا ما يشتريه لكم ذلك، وأين يكون النظام المستقل الأصغر جواباً أفضل.',
    },
    theirPitch: {
      en: 'CARGOES Runner is part of DP World’s CARGOES suite and is described as a cloud logistics platform for freight forwarders and small logistics businesses.',
      ar: 'CARGOES Runner جزء من مجموعة CARGOES التابعة لـ DP World، ويوصف بأنه منصة لوجستية سحابية لوكلاء الشحن وشركات اللوجستيات الصغيرة.',
    },
    pickThem: {
      heading: { en: 'Pick CARGOES Runner if', ar: 'اختاروا CARGOES Runner إذا' },
      points: [
        {
          en: 'Your volume runs through DP World terminals and you want the platform that sits closest to them.',
          ar: 'كان حجمكم يمرّ عبر محطات DP World وأردتم المنصة الأقرب إليها.',
        },
        {
          en: 'The backing of a group that size is itself part of what you are buying. That is a legitimate reason to choose a vendor and we would say so on a call.',
          ar: 'كان دعم مجموعة بهذا الحجم جزءاً مما تشترونه. هذا سبب مشروع لاختيار مورّد، وسنقوله في مكالمة.',
        },
      ],
    },
    pickUs: {
      heading: { en: 'Pick us if', ar: 'اختارونا إذا' },
      points: OUR_POINTS,
    },
    ask: SHARED_ASKS,
  },
  {
    slug: 'spreadsheets',
    name: 'spreadsheets and email',
    short: 'Spreadsheets',
    // No vendor, so nobody to quote and nothing to go stale. This is the one
    // page on the site that can be direct about the alternative, because the
    // alternative is a working method rather than somebody's product.
    source: null,
    checked: null,
    title: {
      en: 'CargoSharks and the spreadsheet',
      ar: 'CargoSharks وجدول البيانات',
    },
    lede: {
      en: 'The real incumbent, and the one alternative here we can be blunt about — a spreadsheet has no vendor to misrepresent. It is also better than most software at several things, which is why it is still winning.',
      ar: 'المنافس الحقيقي، والبديل الوحيد هنا الذي يمكننا الحديث عنه بصراحة — فجدول البيانات ليس له مورّد نسيء تمثيله. وهو أيضاً أفضل من معظم البرمجيات في أمور عدة، ولهذا ما زال يفوز.',
    },
    theirPitch: {
      en: 'A rate sheet in Excel, enquiries in four mailboxes, a WhatsApp group per customer and a shared drive of PDFs. Nobody chose this. It accumulated, and it works.',
      ar: 'جدول أسعار في Excel، واستفسارات في أربعة صناديق بريد، ومجموعة واتساب لكل عميل، ومجلد مشترك من ملفات PDF. لم يخترها أحد. تراكمت، وهي تعمل.',
    },
    pickThem: {
      heading: { en: 'Keep the spreadsheet if', ar: 'أبقوا على جدول البيانات إذا' },
      points: [
        {
          en: 'You move a handful of shipments a month. Below some volume the overhead of any system is larger than the problem it solves, and anyone who tells you otherwise is selling.',
          ar: 'كنتم تحرّكون بضع شحنات في الشهر. تحت حجم معيّن تكون كلفة أي نظام أكبر من المشكلة التي يحلّها، ومن يقول غير ذلك فإنما يبيع.',
        },
        {
          en: 'One person does the whole job end to end and it is all in their head. The thing a file replaces is a handover, and you do not have one.',
          ar: 'كان شخص واحد يؤدي العمل كله من طرف إلى طرف وكله في رأسه. فما يستبدله السجل هو التسليم بين الأشخاص، وأنتم لا تسلّمون.',
        },
        {
          en: 'Nothing has ever surfaced weeks late on a supplier invoice. If that is genuinely true, the case below does not apply to you.',
          ar: 'لم يظهر لديكم قط شيء متأخراً أسابيع على فاتورة مورّد. إن صحّ هذا فعلاً، فما دونه لا ينطبق عليكم.',
        },
      ],
    },
    pickUs: {
      heading: { en: 'The three places it breaks', ar: 'المواضع الثلاثة التي ينكسر فيها' },
      points: [
        {
          en: 'A clock nobody starts. Free time runs out, the counter is somebody’s job and it is nobody’s job, and it surfaces weeks later on a supplier invoice. A file that knows the discharge milestone starts the clock itself and writes the charge line as it runs.',
          ar: 'عدّاد لا يشغّله أحد. ينتهي وقت السماح، وتشغيل العدّاد مهمة أحدهم وليس مهمة أحد، فيظهر بعد أسابيع على فاتورة مورّد. أما السجل الذي يعرف مرحلة التفريغ فيشغّل العدّاد بنفسه ويكتب بند التكلفة وهو يعمل.',
        },
        {
          en: 'Two people, one rate. Rate cards in a shared workbook overlap, and the version that goes out is whichever one the person quoting had open. In a schema two cards cannot cover one lane at one time.',
          ar: 'شخصان وسعر واحد. بطاقات الأسعار في مصنّف مشترك تتداخل، والنسخة التي تخرج هي التي كانت مفتوحة أمام من يسعّر. أما في بنية القاعدة فلا يمكن لبطاقتين تغطية مسار واحد في وقت واحد.',
        },
        {
          en: 'Nobody can say who changed it. A spreadsheet has one truth and no history, so the question of when a date moved and who moved it has no answer at all — where a file with 80 audit triggers has a boring one.',
          ar: 'لا أحد يستطيع القول من غيّره. لجدول البيانات حقيقة واحدة بلا تاريخ، فسؤال متى تغيّر التاريخ ومن غيّره لا جواب له البتة — بينما لسجل فيه 80 مُشغِّل تدقيق جواب ممِل.',
        },
      ],
    },
    ask: SHARED_ASKS,
  },
]

export const compareIndex = {
  eyebrow: { en: 'Comparisons', ar: 'المقارنات' },
  title: {
    en: 'The three systems you are probably looking at, and the one you already use.',
    ar: 'الأنظمة الثلاثة التي تنظرون إليها غالباً، والنظام الذي تستخدمونه أصلاً.',
  },
  body: {
    en: 'One page each. None of them contains a tick-and-cross grid, for the reasons on this page — every one instead says what the other vendor states about itself, where that vendor is the better answer, and the questions worth asking both of us.',
    ar: 'صفحة لكل واحد. لا تحتوي أي منها جدول علامات صح وخطأ، للأسباب المذكورة في هذه الصفحة — بل تقول كل صفحة ما يذكره المورّد الآخر عن نفسه، وأين يكون هو الجواب الأفضل، والأسئلة التي تستحق أن تُطرح علينا معاً.',
  },
}
