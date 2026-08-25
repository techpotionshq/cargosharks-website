/**
 * Every word on both pages, in one file.
 *
 * The English and the Arabic sit next to each other on purpose. The previous
 * site kept them in two hand-maintained HTML files, and the predictable thing
 * happened: a correction landed in one and not the other, and for a while the
 * two languages made different claims about the same product. Here a missing
 * translation is a type error.
 *
 * **The Arabic is written, not translated.** Most of it is carried over
 * verbatim from the previous site's `ar.html`, which took its vocabulary from
 * the product's own `apps/web/messages/ar.json` so that a prospect reads
 * «بوليصة الشحن الفرعية» here and sees the same string on the document the
 * demo issues. Where a line differs from the English it is because the Arabic
 * question is a different question — see `bilingual.body` and `faqNote`.
 *
 * Claims are load-bearing. `docs/marketing/README.md` sets the rule the whole
 * document set is written under — nothing is claimed that the working tree
 * does not do — and the figures below are the ones `apps/landing/README.md`
 * records a way to re-check.
 */

export type Lang = 'en' | 'ar'

/** One string per language. The type is the parity check. */
export type Bi = { en: string; ar: string }

export const DEMO_URL = 'https://demo.cargosharks.com'
export const CONTACT_EMAIL = 'hello@cargosharks.com'

export const nav: { href: string; label: Bi }[] = [
  { href: '/what-we-do/', label: { en: 'What we do', ar: 'ماذا نفعل' } },
  { href: '/compare/', label: { en: 'How we compare', ar: 'كيف نقارن' } },
]

export const hero = {
  /** Split so the line breaks are a design decision rather than the browser's. */
  title: {
    en: ['From enquiry', 'to invoice,', 'one file.'],
    ar: ['من الاستفسار', 'إلى الفاتورة،', 'سجل واحد.'],
  },
  /**
   * Two lines, not five.
   *
   * This ran to a forty-word sentence listing seven stages, under a mono eyebrow
   * reading "KUWAIT · SEA, AIR, ROAD, RAIL, COURIER" with a pulsing dot beside
   * it. The list is what the page below is for; the eyebrow was the house style
   * of every generated landing page in the category. Both are gone. What is
   * left is the sentence a forwarder would use.
   */
  body: {
    en: 'Quote, book, clear and invoice a shipment without ever keying it into a second system.',
    ar: 'سعّروا الشحنة واحجزوها وخلّصوها وفوتروها، دون إدخال بياناتها مرة أخرى في أي نظام آخر.',
  },
  /**
   * The line above the headline.
   *
   * It was a glass pill with a pulsing green dot reading "The live demo is
   * open · no sign-up". A pill with a pulsing dot is the single most recognisable
   * component of a generated landing page, and this one was also making the
   * page's most important offer in its smallest, most decorative element.
   * The offer moved to the button, where it can be clicked, and what is left
   * here is what an eyebrow is for: where this thing is from and what it covers.
   */
  eyebrow: {
    en: 'Kuwait · sea, air, road, rail, courier',
    ar: 'الكويت · بحري وجوي وبري وسككي وبريد سريع',
  },
  primary: { en: 'Open the live demo', ar: 'افتحوا النسخة التجريبية' },
  secondary: { en: 'See what it does', ar: 'اطّلعوا على ما يفعله' },
  /**
   * The caption under the product frame — one live figure, in mono, in small
   * type. See `Hero.tsx` for why it is a caption rather than the chip it was.
   */
  tickerLabel: { en: 'Accruing right now on one box in Shuwaikh:', ar: 'يجري الآن على حاوية واحدة في الشويخ:' },
  tickerRef: { en: '· MSKU 704 118 2 · 131 days past free time', ar: '· MSKU 704 118 2 · 131 يوماً بعد وقت السماح' },
}

/**
 * The proof strip.
 *
 * Every figure here is checkable, and `apps/landing/README.md` records how.
 * That is the difference between this band and the "10x faster" band on every
 * other site in the category: these are counts of things in the repository, so
 * they can only be wrong by going stale, and going stale is a thing a person
 * can be asked to check.
 */
export const proof: { value: string; label: Bi }[] = [
  { value: '5', label: { en: 'transport modes', ar: 'وسائل شحن' } },
  { value: '197', label: { en: 'row-level policies', ar: 'سياسة أمان على مستوى الصف' } },
  { value: '80', label: { en: 'audit triggers', ar: 'مُشغِّل تدقيق' } },
  { value: '2,709', label: { en: 'strings, EN + AR', ar: 'نص واجهة بالعربية والإنجليزية' } },
  { value: '3', label: { en: 'decimals on every dinar', ar: 'خانات عشرية لكل دينار' } },
]

/**
 * The three-step sequence.
 *
 * `shot` is the file in `public/pic/screens`; the Arabic page appends `-ar`,
 * because the sidebar crop is a logical property and takes its bite out of the
 * wrong edge on a left-to-right capture shown in a right-to-left document.
 */
/**
 * `icon` is a key, not a component. `copy.ts` is imported by client and server
 * components alike and holds nothing but content; the mapping to Phosphor lives
 * in `Work.tsx`, so this file stays a data file and swapping icon sets is one
 * edit rather than sixty.
 */
/**
 * `desk` is the tab label and `title` is the claim.
 *
 * The section used to pin a frame and dim two of three stages as the reader
 * scrolled past them, which meant the only way to see stage three was to scroll
 * through stages one and two. A tab says which desk you are looking at in one
 * word and lets a finance buyer go straight to finance — and one word is all
 * that fits in a tab, which is why it is a separate string rather than a
 * truncation of the title.
 */
export const steps: {
  n: string
  shot: string
  icon: string
  desk: Bi
  title: Bi
  body: Bi
  points: Bi[]
}[] = [
  {
    n: '01',
    shot: 'enquiries',
    icon: 'commercial',
    desk: { en: 'Commercial', ar: 'التجاري' },
    title: {
      en: 'The enquiry arrives as an email. It leaves as a quote.',
      ar: 'يصل الاستفسار بريداً إلكترونياً، ويخرج عرض سعر.',
    },
    body: {
      en: 'Mail lands in a shared box, is read, and becomes a structured enquiry with a shipper, a lane and a mode. It is priced off the rate cards you loaded where they cover the route, and sent to agents where they do not.',
      ar: 'يصل البريد إلى صندوق مشترك، فيُقرأ ويصير استفساراً منظَّماً له شاحن ومسار ووسيلة. يُسعَّر من بطاقات أسعاركم متى غطّت المسار، ويُرسل إلى الوكلاء متى لم تغطّه.',
    },
    points: [
      { en: 'One queue for every branch, one owner and one deadline per line.', ar: 'قائمة واحدة لكل الفروع، ولكل سطر مسؤول ومهلة.' },
      { en: 'Rate cards by lane, mode and carrier. Two cannot overlap on one route.', ar: 'بطاقات حسب المسار والوسيلة والناقل. والتداخل على مسار واحد غير ممكن.' },
      { en: 'Buy, sell and margin are on the screen before the quote goes out.', ar: 'الشراء والبيع والهامش على الشاشة قبل خروج العرض.' },
    ],
  },
  {
    n: '02',
    shot: 'jobs',
    icon: 'operations',
    desk: { en: 'Operations', ar: 'العمليات' },
    title: {
      en: 'One job file, and everything hangs off it.',
      ar: 'سجل واحد للشحنة، وكل شيء معلَّق عليه.',
    },
    body: {
      en: 'Booking, containers, milestones, customs status, documents and exceptions live on the same file. Every change is stamped with who made it and when, and nothing is ever deleted — a superseded row is marked superseded and stays.',
      ar: 'الحجز والحاويات والمراحل وحالة التخليص والمستندات والحالات الاستثنائية على السجل نفسه. كل تغيير مختوم بمن أجراه ومتى، ولا يُحذف شيء — بل يُعلَّم السطر المستبدَل بأنه مستبدَل ويبقى.',
    },
    points: [
      { en: 'Planned, revised and actual are all three kept, not overwritten.', ar: 'المخطط والمعدّل والفعلي — الثلاثة محفوظة، لا يُكتب أحدها فوق الآخر.' },
      { en: 'A free-time clock per container, writing its own cost line.', ar: 'عدّاد وقت سماح لكل حاوية، يكتب بند تكلفته بنفسه.' },
      { en: 'The board sorts by exception, oldest first, before the customer calls.', ar: 'اللوحة ترتِّب حسب الحالات الاستثنائية، الأقدم أولاً، قبل أن يتصل العميل.' },
    ],
  },
  {
    n: '03',
    shot: 'finance',
    icon: 'finance',
    desk: { en: 'Finance', ar: 'المالية' },
    title: {
      en: 'Costs land against the job before the invoice does.',
      ar: 'التكاليف تُقيَّد على الشحنة قبل أن تصدر الفاتورة.',
    },
    body: {
      en: 'What you accrued and what the supplier actually billed are compared line by line, and the variance is a number on the screen before anyone approves it. Money is decimal end to end, and the dinar keeps its three places.',
      ar: 'ما استحق على الشحنة وما فوتره المورّد فعلاً يُطابَقان بنداً ببند، والفرق رقم على الشاشة قبل أن يعتمده أحد. الحساب عشري من طرف إلى طرف، والدينار يحتفظ بخاناته الثلاث.',
    },
    points: [
      { en: 'Supplier invoices matched to the accrual, variance shown before approval.', ar: 'فواتير المورّدين تُطابَق مع المستحق، والفرق يظهر قبل الاعتماد.' },
      { en: 'Receivables by age, with the credit limit that was actually set.', ar: 'الذمم المدينة حسب التقادم، مع الحد الائتماني المعتمد فعلاً.' },
      { en: 'Documents issued in both languages from the shipment’s own data.', ar: 'المستندات تصدر باللغتين من بيانات الشحنة نفسها.' },
    ],
  },
]

export const work = {
  eyebrow: { en: 'The cycle', ar: 'دورة العمل' },
  title: {
    en: 'Three desks, one file.',
    ar: 'ثلاثة مكاتب، وسجل واحد.',
  },
  sub: {
    en: 'Commercial, operations and finance work the same shipment. Nothing is re-keyed between them and nothing leaves the file.',
    ar: 'التجاري والعمليات والمالية يعملون على الشحنة نفسها. لا يُعاد إدخال شيء بينهم، ولا يخرج من السجل شيء.',
  },
}

/**
 * The five modes, as a strip under the hero.
 *
 * `proof` already counts them — "5 transport modes" — and a count is a claim a
 * reader has to take on trust. Naming them costs one line and settles the
 * question a forwarder is actually asking, which is not *how many* but *is mine
 * one of them*. An air-only broker reading "5" scrolls on; the same broker
 * reading "Air" does not.
 *
 * `key` maps to a Phosphor glyph in `Modes.tsx`, the same split `steps.icon`
 * uses and for the same reason: this file stays data.
 */
export const modes: { key: string; label: Bi }[] = [
  { key: 'sea', label: { en: 'Sea', ar: 'بحري' } },
  { key: 'air', label: { en: 'Air', ar: 'جوي' } },
  { key: 'road', label: { en: 'Road', ar: 'بري' } },
  { key: 'rail', label: { en: 'Rail', ar: 'سككي' } },
  { key: 'courier', label: { en: 'Courier', ar: 'بريد سريع' } },
]

export const modesNote = {
  en: 'One file, whichever way the cargo moves',
  ar: 'سجل واحد، مهما تحرّكت البضاعة',
}

/**
 * The capability grid.
 *
 * The page had no section between "here are three desks" and "here is a
 * demurrage clock", which left the specific questions a buyer arrives with —
 * does it hold my rate cards, does it print my documents, who can see my rows —
 * answered nowhere on the home page. They were answered on `/what-we-do/`,
 * which is a page nobody reaches before they have decided the product is
 * plausible.
 *
 * Five cards, each one a mechanism rather than a benefit. `art` names the
 * illustration in `Illustrations.tsx`; two cards carry one and three do not,
 * because a drawing on every card is wallpaper and a drawing on the two cards
 * whose claim is *structural* is an explanation.
 */
export const capabilities = {
  eyebrow: { en: 'Under the file', ar: 'داخل السجل' },
  title: {
    en: 'The parts a forwarder opens every day.',
    ar: 'الأجزاء التي يفتحها الوكيل كل يوم.',
  },
  sub: {
    en: 'Not a feature list. Five mechanisms, each one a thing the database enforces rather than a thing the interface asks nicely for.',
    ar: 'ليست قائمة مزايا. خمس آليات، كل واحدة تفرضها قاعدة البيانات لا واجهة تطلبها بلطف.',
  },
  cards: [
    {
      key: 'lane',
      span: 'wide',
      icon: 'route',
      title: { en: 'Every leg on one timeline', ar: 'كل مرحلة على خط زمني واحد' },
      body: {
        en: 'Pickup, gate-in, sailing, discharge, customs and delivery sit on the same file with planned, revised and actual times kept side by side. Nothing overwrites anything, so the question of when a date moved and who moved it always has an answer.',
        ar: 'الاستلام والدخول والإبحار والتفريغ والتخليص والتسليم على السجل نفسه، والوقت المخطط والمعدّل والفعلي محفوظة جنباً إلى جنب. لا يُكتب شيء فوق شيء، فسؤال متى تغيّر التاريخ ومن غيّره له جواب دائماً.',
      },
    },
    {
      key: 'money',
      span: 'half',
      icon: 'money',
      title: { en: 'Three decimals, all the way down', ar: 'ثلاث خانات عشرية، من الطرف إلى الطرف' },
      body: {
        en: 'The dinar has three decimal places. Money is decimal in the database, decimal in the engines and a string on the wire — never a floating-point number, and never rounded to two on its way to a screen.',
        ar: 'للدينار ثلاث خانات عشرية. الحساب عشري في قاعدة البيانات وفي المحرّكات، ونص على الشبكة — لا رقم عائم، ولا تقريب إلى خانتين في طريقه إلى الشاشة.',
      },
    },
    {
      key: 'rates',
      span: 'half',
      icon: 'rates',
      title: { en: 'Rate cards that cannot collide', ar: 'بطاقات أسعار لا تتصادم' },
      body: {
        en: 'Priced by lane, mode and carrier, with validity dates. Two cards cannot cover one route at one time — the constraint is in the schema, so it is not a rule somebody remembers.',
        ar: 'التسعير حسب المسار والوسيلة والناقل، بتواريخ صلاحية. ولا يمكن لبطاقتين أن تغطّيا مساراً واحداً في وقت واحد — القيد في بنية القاعدة، لا قاعدة يتذكّرها أحد.',
      },
    },
    {
      key: 'docs',
      span: 'half',
      icon: 'docs',
      title: { en: 'Documents from the shipment’s own data', ar: 'مستندات من بيانات الشحنة نفسها' },
      body: {
        en: 'House bill, air waybill, delivery order, packing list, manifest and the customs pack — issued in Arabic or English from the file, not retyped into a template.',
        ar: 'بوليصة الشحن الفرعية وبوليصة الشحن الجوي وأمر التسليم وقائمة التعبئة والبيان وحزمة التخليص — تصدر بالعربية أو الإنجليزية من السجل، لا تُكتب من جديد في قالب.',
      },
    },
    {
      key: 'tenancy',
      span: 'half',
      icon: 'tenancy',
      title: { en: 'Your rows, and only your rows', ar: 'صفوفكم، وصفوفكم وحدها' },
      body: {
        en: 'Branch and entity separation is a row-level policy in the database, not a filter in the application. A query written wrong returns nothing rather than somebody else’s shipments.',
        ar: 'الفصل بين الفروع والكيانات سياسة على مستوى الصف في قاعدة البيانات، لا مرشّح في التطبيق. والاستعلام المكتوب خطأً يعيد لا شيء، لا شحنات غيركم.',
      },
    },
  ],
}

/**
 * The free-time calculator.
 *
 * The one section on this page that is not an argument. A reader moves a
 * number, and a number they recognise as their own comes back — which is worth
 * more than any sentence on the site, because they did the arithmetic and
 * therefore believe it.
 *
 * **It does not claim a saving, and that is deliberate.** Every calculator in
 * this category ends with "you would save 23% with us", a figure nobody can
 * check and which this product has no pilot data to support. `docs/marketing`
 * sets the rule the whole document set is written under — nothing is claimed
 * that the working tree does not do — so the output here is the reader's own
 * exposure, full stop, and `note` says plainly that the software does not make
 * it smaller. What it does is make it arrive as a charge you raised on the day
 * it started rather than as a supplier invoice six weeks later, which is a
 * claim about the code and is true.
 *
 * The defaults are a mid-size Kuwaiti forwarder, and every one of them is a
 * number a reader will immediately want to change. That is the point of them:
 * a field somebody edits is a field they have read.
 */
export const calculator = {
  eyebrow: { en: 'Free time calculator', ar: 'حاسبة وقت السماح' },
  title: {
    en: 'What is free time costing you?',
    ar: 'كم يكلّفكم وقت السماح؟',
  },
  sub: {
    en: 'Four numbers off your own board. Nothing is sent anywhere — the arithmetic happens in this page.',
    ar: 'أربعة أرقام من لوحتكم. لا يُرسل شيء إلى أي مكان — الحساب يجري داخل هذه الصفحة.',
  },
  fields: [
    {
      key: 'boxes',
      value: 40,
      min: 1,
      max: 400,
      step: 1,
      label: { en: 'Containers a month', ar: 'حاوية في الشهر' },
    },
    {
      key: 'overrun',
      value: 18,
      min: 1,
      max: 100,
      step: 1,
      label: { en: 'Share that overrun free time', ar: 'نسبة ما يتجاوز وقت السماح' },
      unit: { en: '%', ar: '٪' },
    },
    {
      key: 'days',
      value: 6,
      min: 1,
      max: 60,
      step: 1,
      label: { en: 'Average days over', ar: 'متوسط الأيام الزائدة' },
    },
    {
      key: 'rate',
      value: 32,
      min: 1,
      max: 400,
      step: 1,
      label: { en: 'Demurrage a day', ar: 'الأرضيات في اليوم' },
      unit: { en: 'KWD', ar: 'د.ك' },
    },
  ],
  /**
   * The currency, as a word, in each language.
   *
   * It was the literal `KWD` in the component. Every other figure on this site
   * writes the dinar the way the reader's own invoices do — `leak.line` has
   * `32.000 د.ك / يوم` — so an Arabic page showing `KWD 16,588.800` was the
   * one place the site slipped back into English for a unit, in the section
   * whose whole subject is money.
   */
  currency: { en: 'KWD', ar: 'د.ك' },
  resultLabel: { en: 'On the clock every year', ar: 'على العدّاد كل سنة' },
  monthLabel: { en: 'A month', ar: 'في الشهر' },
  boxesLabel: { en: 'Boxes it happens to', ar: 'حاويات يقع عليها' },
  boxesUnit: { en: 'a year', ar: 'في السنة' },
  note: {
    en: 'CargoSharks does not make this number smaller. It makes it arrive on the day the clock starts instead of six weeks later on a supplier invoice — as a charge line you raised, against the job that caused it, with the milestone that started it on the same screen.',
    ar: 'لا يصغّر CargoSharks هذا الرقم. بل يجعله يصل يوم يبدأ العدّاد لا بعد ستة أسابيع على فاتورة مورّد — بنداً كتبتموه أنتم، على الشحنة التي سبّبته، والمرحلة التي بدأ عندها على الشاشة نفسها.',
  },
}

/**
 * The yard band.
 *
 * The demurrage section used to sit on flat navy, which is a strange surface
 * for the one claim on the page that is about a physical object standing in a
 * physical place costing money by the hour. It sits on a container yard now.
 * The photograph is doing an argument's work rather than decorating: the reader
 * is looking at the thing the counter is counting.
 */
export const yard = {
  quote: {
    en: 'Somewhere in Shuwaikh, a box is earning the terminal money.',
    ar: 'في مكان ما من الشويخ، حاوية تدرّ على المحطة مالاً.',
  },
}

export const bilingual = {
  eyebrow: { en: 'Language', ar: 'اللغة' },
  title: { en: 'Arabic is not a translation layer.', ar: 'مبنيّ باللغتين، لا مترجَم' },
  body: {
    en: 'Every screen, document and email template exists in both languages, checked for parity on every commit. Right-to-left is in the layout rather than added on top of it, so the quote your customer opens in Arabic reads the way an Arabic document should, because it was built that way rather than mirrored from the English.',
    ar: 'كل شاشة ومستند وقالب بريد موجود باللغتين، ويُتحقق من تطابقهما مع كل تعديل. والاتجاه من اليمين إلى اليسار في بنية التصميم لا مضافاً إليه، فعرض السعر الذي يفتحه عميلكم بالعربية يُقرأ كما ينبغي لمستند عربي أن يُقرأ، لأنه بُني هكذا لا لأنه عُكس عن الإنجليزية.',
  },
  aside: {
    en: 'Every product in this market was built in English and had Arabic added. You can tell in about four seconds, and so can your customer.',
    ar: 'كل منتج في هذا السوق بُني بالإنجليزية ثم أُضيفت إليه العربية. تعرفون ذلك خلال أربع ثوانٍ تقريباً، ويعرفه عميلكم كذلك.',
  },
  toggleHint: { en: 'Try it', ar: 'جرّبوه' },
}

/**
 * The demurrage beat, rebuilt around the thing the software actually produces.
 *
 * It was a seven-inch number floating on navy with two paragraphs beside it,
 * which is the "one big statistic" section every B2B page has and says nothing
 * about the product. What the product actually does with a running clock is
 * write a charge line, so the section shows a charge line: the container, the
 * milestone that started it, the rate, the days, and the total still climbing.
 * The figure is the same figure, doing a job.
 */
export const leak = {
  eyebrow: { en: 'Free time · running now', ar: 'وقت السماح · يجري الآن' },
  title: {
    en: 'The clock nobody starts is the one that costs you.',
    ar: 'العدّاد الذي لا يشغّله أحد هو الذي يكلّفكم.',
  },
  body: {
    en: 'A container goes past its free days and nothing happens, because starting a counter is somebody’s job and it is nobody’s job. It surfaces weeks later, on a supplier invoice, and by then the question is who was supposed to be watching.',
    ar: 'تتجاوز الحاوية أيام السماح ولا يحدث شيء، لأن تشغيل العدّاد مهمة أحدهم وليس مهمة أحد. ثم تظهر بعد أسابيع على فاتورة مورّد، ويصير السؤال: من كان يفترض به أن يراقب؟',
  },
  answer: {
    en: 'CargoSharks starts it from the milestone that starts free time, and writes the charge line itself as it runs.',
    ar: 'يشغّله CargoSharks من المرحلة التي يبدأ عندها وقت السماح، ويكتب بند التكلفة بنفسه وهو يعمل.',
  },
  /** The charge line. Every label here is one the product prints. */
  line: {
    container: 'MSKU 704 118 2',
    lane: { en: 'Shuwaikh · Sea FCL', ar: 'الشويخ · بحري بحاوية كاملة' },
    startedLabel: { en: 'Free time ended', ar: 'انتهى وقت السماح' },
    startedValue: { en: '14 Aug 2026 · discharge', ar: '14 أغسطس 2026 · التفريغ' },
    rateLabel: { en: 'Rate', ar: 'التعرفة' },
    rateValue: { en: 'KWD 32.000 / day', ar: '32.000 د.ك / يوم' },
    daysLabel: { en: 'Chargeable days', ar: 'الأيام الخاضعة' },
    daysValue: { en: '131 and counting', ar: '131 ويزيد' },
    totalLabel: { en: 'Accrued to now', ar: 'المستحق حتى الآن' },
    written: { en: 'Charge line written automatically', ar: 'يُكتب بند التكلفة تلقائياً' },
  },
}

/**
 * The close.
 *
 * It used to be a headline beside a card printing three email addresses and a
 * password — a credentials table as the last thing a prospect sees, which reads
 * as a support article rather than an invitation. The addresses are in the
 * demo's own sign-in screen where they are useful; here there is one thing to
 * do and one line explaining why it costs nothing to do it.
 */
export const cta = {
  eyebrow: { en: 'The demo is the build', ar: 'النسخة التجريبية هي المنتج نفسه' },
  title: {
    en: 'Judge it in ten minutes, not ten meetings.',
    ar: 'احكموا عليه في عشر دقائق، لا في عشرة اجتماعات.',
  },
  body: {
    en: 'It is the real software on a seeded dataset, with a sign-in for you, for your customer and for your agent. Nothing to install, nothing to uninstall, and nothing you do in it touches anything.',
    ar: 'هو البرنامج نفسه يعمل على بيانات مُعدّة، بحساب لكم، وحساب لعميلكم، وحساب لوكيلكم. لا شيء يُثبَّت ولا شيء يُزال، ولا يمسّ ما تفعلونه فيه شيئاً.',
  },
  primary: { en: 'Open the live demo', ar: 'افتحوا النسخة التجريبية' },
  secondary: { en: 'Ask for a 15-day pilot', ar: 'اطلبوا تجربة الخمسة عشر يوماً' },
  /** Three claims, each one checkable in the first thirty seconds. */
  points: [
    { en: 'No sign-up', ar: 'بلا تسجيل' },
    { en: 'Three roles', ar: 'ثلاثة حسابات' },
    { en: 'Arabic and English', ar: 'بالعربية والإنجليزية' },
  ],
}

export const footer = {
  note: {
    en: 'Built in Kuwait for forwarders and customs brokers in the Gulf.',
    ar: 'بُني في الكويت لشركات الشحن والتخليص في الخليج.',
  },
  columns: [
    {
      heading: { en: 'Product', ar: 'المنتج' },
      links: [
        { href: '/what-we-do/', label: { en: 'What we do', ar: 'ماذا نفعل' } },
        { href: '/compare/', label: { en: 'How we compare', ar: 'كيف نقارن' } },
        { href: '#demo', label: { en: 'Demo', ar: 'النسخة التجريبية' } },
      ],
    },
    {
      heading: { en: 'Legal', ar: 'القانوني' },
      links: [
        { href: '/privacy/', label: { en: 'Privacy', ar: 'الخصوصية' } },
        { href: '/terms/', label: { en: 'Terms', ar: 'الشروط' } },
        { href: '/dpa/', label: { en: 'Data processing', ar: 'معالجة البيانات' } },
      ],
    },
  ],
  rights: { en: 'All rights reserved.', ar: 'جميع الحقوق محفوظة.' },
}

/** The other language's home page, and what to call it in its own words. */
export const languageSwitch = {
  en: { href: '/ar/', label: 'العربية', hrefLang: 'ar' },
  ar: { href: '/', label: 'English', hrefLang: 'en' },
} as const
