import type { Bi } from '@/content/copy'

/**
 * The home page's copy, in the order the page reads.
 *
 * The page used to be written as a series of observations ("Arabic is not a
 * translation layer", "The parts a forwarder opens every day") and it read like
 * engineering notes: true, and nothing a forwarder would say out loud. It is
 * rewritten in the buyer's own words now. The problem comes first, in the three
 * shapes an owner of a Gulf desk recognises; each desk's section opens with what
 * that desk gets and only then says how; and every claim is one that
 * `scripts/blog/product-facts.md` allows. Nothing here names a customer, quotes
 * a saving or prints a price, because there are none to quote yet.
 *
 * `icon` fields are keys, not components, for the reason `copy.ts` gives: this
 * file is imported by client and server components alike and holds nothing but
 * content.
 */

export const heroCopy = {
  badge: {
    en: 'Built in Kuwait for Gulf forwarders and customs brokers',
    ar: 'صُنع في الكويت لشركات الشحن والتخليص الجمركي في الخليج',
  },
  /** Three parts so the middle one can carry the colour. */
  title: {
    en: ['Freight software ', 'built for the Gulf', ', not translated for it.'],
    ar: ['برنامج شحن ', 'صُنع للخليج', '، لا مترجَمٌ إليه.'],
  },
  body: {
    en: 'Quotes, shipments, customs, documents and invoices on one job file your whole team works from, in Arabic and English, with every dinar kept to three decimals.',
    ar: 'عروض الأسعار والشحنات والتخليص والمستندات والفواتير على سجل واحد لكل شحنة يعمل منه فريقكم كله، بالعربية والإنجليزية، وكل دينار محفوظ بخاناته العشرية الثلاث.',
  },
  primary: { en: 'Ask for a 15-day pilot', ar: 'اطلبوا تجربة لمدة 15 يوماً' },
  secondary: { en: 'Open the live demo', ar: 'افتحوا النسخة التجريبية' },
  points: [
    { en: 'Live demo, no sign-up', ar: 'نسخة تجريبية بلا تسجيل' },
    { en: 'Arabic and English throughout', ar: 'بالعربية والإنجليزية بالكامل' },
    { en: 'Sea, air, road and courier', ar: 'بحري وجوي وبري وبريد سريع' },
  ] satisfies Bi[],
}

export const pains = {
  eyebrow: { en: 'Sound familiar?', ar: 'هل يبدو هذا مألوفاً؟' },
  title: {
    en: 'Most Gulf desks still run on email, WhatsApp and spreadsheets.',
    ar: 'معظم مكاتب الشحن في الخليج ما زالت تعمل بالبريد وواتساب وجداول البيانات.',
  },
  sub: {
    en: 'It works until the busy week. Then the same three things go wrong.',
    ar: 'ينجح ذلك حتى يأتي الأسبوع المزدحم، ثم تتكرر الأخطاء الثلاثة نفسها.',
  },
  cards: [
    {
      icon: 'inbox',
      title: { en: 'Quotes wait in someone’s inbox', ar: 'عروض الأسعار تنتظر في بريد أحدهم' },
      body: {
        en: 'Enquiries arrive by email and WhatsApp, the rates sit in a spreadsheet, and the customer hears back tomorrow from whoever remembered.',
        ar: 'تصل الاستفسارات بالبريد وواتساب، والأسعار في جدول بيانات، فيصل الرد إلى العميل غداً ممن تذكّر.',
      },
    },
    {
      icon: 'clock',
      title: { en: 'Demurrage turns up six weeks late', ar: 'الأرضيات تظهر بعد ستة أسابيع' },
      body: {
        en: 'Nobody started the free-time clock, so the cost arrives on a supplier invoice after the customer has already been billed.',
        ar: 'لم يشغّل أحد عدّاد وقت السماح، فتصل التكلفة على فاتورة المورّد بعد أن فوترتم العميل.',
      },
    },
    {
      icon: 'copy',
      title: { en: 'One shipment, typed three times', ar: 'شحنة واحدة تُكتب ثلاث مرات' },
      body: {
        en: 'Operations, documents and accounts each keep their own copy, so a corrected weight never reaches the invoice.',
        ar: 'للعمليات والمستندات والحسابات نسخة لكلٍّ منها، فلا يصل الوزن المصحَّح إلى الفاتورة أبداً.',
      },
    },
  ],
  answer: {
    en: 'CargoSharks puts the whole job on one file, so each of these is caught on the day it happens.',
    ar: 'يضع CargoSharks الشحنة كلها على سجل واحد، فيُكتشف كل خطأ من هذه يوم يحدث.',
  },
}

export const desks = {
  eyebrow: { en: 'How it works', ar: 'كيف يعمل' },
  title: {
    en: 'One file, from the first enquiry to the paid invoice.',
    ar: 'سجل واحد، من أول استفسار إلى الفاتورة المسدَّدة.',
  },
  sub: {
    en: 'Commercial, operations and finance work the same shipment, so nothing is keyed in twice.',
    ar: 'التجاري والعمليات والمالية يعملون على الشحنة نفسها، فلا يُدخَل شيء مرتين.',
  },
  /** `shot` is the file in `public/pic/screens`; the Arabic page appends `-ar`. */
  rows: [
    {
      shot: 'enquiries',
      icon: 'commercial',
      desk: { en: 'Commercial', ar: 'التجاري' },
      title: {
        en: 'Quote the same day, from the right rate.',
        ar: 'سعّروا في اليوم نفسه، ومن السعر الصحيح.',
      },
      body: {
        en: 'Enquiries from email and WhatsApp land in one queue, each with an owner and a deadline. Your team prices from the rate card that is current for that lane, mode and carrier, and sees the margin before the quote goes out.',
        ar: 'تصل الاستفسارات من البريد وواتساب إلى قائمة واحدة، لكلٍّ منها مسؤول ومهلة. ويسعّر فريقكم من بطاقة الأسعار السارية لذلك المسار والوسيلة والناقل، ويرى الهامش قبل أن يخرج العرض.',
      },
      points: [
        { en: 'One queue for every branch', ar: 'قائمة واحدة لكل الفروع' },
        {
          en: 'Rate requests to overseas partners when no card covers the route',
          ar: 'طلبات أسعار إلى الشركاء في الخارج حين لا تغطّي أي بطاقة المسار',
        },
        { en: 'Buy, sell and margin on one screen', ar: 'الشراء والبيع والهامش على شاشة واحدة' },
      ],
      link: {
        href: '/freight-quotation-software/',
        hrefAr: '/ar/freight-quotation-software/',
        label: { en: 'More on quotations', ar: 'المزيد عن عروض الأسعار' },
      },
    },
    {
      shot: 'jobs',
      icon: 'operations',
      desk: { en: 'Operations', ar: 'العمليات' },
      title: {
        en: 'Know where every shipment is, before the customer asks.',
        ar: 'اعرفوا أين كل شحنة، قبل أن يسأل العميل.',
      },
      body: {
        en: 'Booking, containers, milestones, customs status and documents sit on one job. Planned, revised and actual times are all kept, and the board puts the shipments that need you first.',
        ar: 'الحجز والحاويات والمراحل وحالة التخليص والمستندات على سجل واحد. الأوقات المخططة والمعدّلة والفعلية محفوظة كلها، واللوحة تضع أولاً الشحنات التي تحتاجكم.',
      },
      points: [
        { en: 'A free-time clock on every container', ar: 'عدّاد وقت سماح على كل حاوية' },
        {
          en: 'Documents issued from the job, in Arabic or English',
          ar: 'مستندات تصدر من سجل الشحنة، بالعربية أو الإنجليزية',
        },
        {
          en: 'A tracking portal your customers check themselves',
          ar: 'بوابة تتبّع يراجعها عملاؤكم بأنفسهم',
        },
      ],
      link: {
        href: '/customs-clearance-software/',
        hrefAr: '/ar/customs-clearance-software/',
        label: { en: 'More on customs clearance', ar: 'المزيد عن التخليص الجمركي' },
      },
    },
    {
      shot: 'finance',
      icon: 'finance',
      desk: { en: 'Finance', ar: 'المالية' },
      title: {
        en: 'Bill every charge, down to the fils.',
        ar: 'فوتروا كل بند، حتى آخر فلس.',
      },
      body: {
        en: 'Costs land against the job as they happen. Supplier invoices are matched to what you accrued, the difference shows before anyone approves it, and the dinar keeps all three decimals.',
        ar: 'تُقيَّد التكاليف على الشحنة حين تحدث. وتُطابَق فواتير المورّدين مع المستحق، ويظهر الفرق قبل أن يعتمده أحد، ويحتفظ الدينار بخاناته الثلاث.',
      },
      points: [
        { en: 'Supplier invoices matched line by line', ar: 'مطابقة فواتير المورّدين بنداً ببند' },
        {
          en: 'Receivables by age, against the credit limit',
          ar: 'الذمم المدينة حسب التقادم، مقابل الحد الائتماني',
        },
        {
          en: 'A journal export your accountant imports',
          ar: 'تصدير قيود يستوردها محاسبكم',
        },
      ],
      link: {
        href: '/freight-invoicing-software/',
        hrefAr: '/ar/freight-invoicing-software/',
        label: { en: 'More on invoicing', ar: 'المزيد عن الفوترة' },
      },
    },
  ],
  extrasTitle: { en: 'Also on every job', ar: 'وأيضاً على كل شحنة' },
  extras: [
    {
      icon: 'chat',
      title: { en: 'WhatsApp and email', ar: 'واتساب والبريد' },
      body: {
        en: 'Enquiries from both channels arrive in the same queue.',
        ar: 'الاستفسارات من القناتين تصل إلى القائمة نفسها.',
      },
    },
    {
      icon: 'portal',
      title: { en: 'Customer and agent portals', ar: 'بوابات للعملاء والوكلاء' },
      body: {
        en: 'Customers follow their own shipments, and overseas partners work in a portal of their own.',
        ar: 'يتابع العملاء شحناتهم بأنفسهم، ويعمل الشركاء في الخارج من بوابة خاصة بهم.',
      },
    },
    {
      icon: 'modes',
      title: { en: 'Every mode', ar: 'كل وسائل النقل' },
      body: {
        en: 'Sea FCL and LCL, air, road and courier on the same kind of file.',
        ar: 'بحري بحاوية كاملة أو مجمّعة، وجوي وبري وبريد سريع على السجل نفسه.',
      },
    },
    {
      icon: 'branches',
      title: { en: 'Branches kept apart', ar: 'فروع منفصلة' },
      body: {
        en: 'Staff see only the branches they work for, enforced by the database itself.',
        ar: 'يرى الموظفون الفروع التي يعملون لها فقط، وقاعدة البيانات نفسها تفرض ذلك.',
      },
    },
    {
      icon: 'history',
      title: { en: 'A full history', ar: 'تاريخ كامل' },
      body: {
        en: 'Every change records who made it and when. Nothing is ever deleted.',
        ar: 'كل تغيير يسجّل من أجراه ومتى، ولا يُحذف شيء أبداً.',
      },
    },
    {
      icon: 'tax',
      title: { en: 'Tax on every line', ar: 'الضريبة على كل بند' },
      body: {
        en: 'Each invoice line carries its own tax treatment and rate.',
        ar: 'كل بند في الفاتورة يحمل معاملته الضريبية ونسبتها.',
      },
    },
  ],
}

/**
 * Before and after, rather than us against named rivals.
 *
 * A grid of ticks against CargoWise and Logistaas would need a source for every
 * cell, and those live on `/compare/` where they can carry one. What every
 * reader can check against their own desk is the left column.
 */
export const versus = {
  eyebrow: { en: 'Before and after', ar: 'قبل وبعد' },
  title: {
    en: 'The same desk, the same people, one system.',
    ar: 'المكتب نفسه، والفريق نفسه، ونظام واحد.',
  },
  before: { en: 'Email and spreadsheets', ar: 'البريد وجداول البيانات' },
  after: { en: 'With CargoSharks', ar: 'مع CargoSharks' },
  rows: [
    {
      topic: { en: 'A new enquiry', ar: 'استفسار جديد' },
      before: {
        en: 'Sits in one person’s inbox',
        ar: 'يبقى في بريد شخص واحد',
      },
      after: {
        en: 'In a shared queue, with an owner and a deadline',
        ar: 'في قائمة مشتركة، له مسؤول ومهلة',
      },
    },
    {
      topic: { en: 'Pricing', ar: 'التسعير' },
      before: {
        en: 'Whichever spreadsheet is newest',
        ar: 'من أحدث جدول بيانات وُجد',
      },
      after: {
        en: 'The card that is current for the lane, mode and carrier',
        ar: 'البطاقة السارية للمسار والوسيلة والناقل',
      },
    },
    {
      topic: { en: 'Free time', ar: 'وقت السماح' },
      before: {
        en: 'Found on the supplier invoice',
        ar: 'يُكتشف على فاتورة المورّد',
      },
      after: {
        en: 'Counted from the milestone, charge line written to the job',
        ar: 'يُحسب من المرحلة، ويُكتب بند التكلفة على الشحنة',
      },
    },
    {
      topic: { en: 'Documents', ar: 'المستندات' },
      before: {
        en: 'Retyped into a Word template',
        ar: 'يُعاد كتابتها في قالب Word',
      },
      after: {
        en: 'Issued from the job, in Arabic or English',
        ar: 'تصدر من الشحنة، بالعربية أو الإنجليزية',
      },
    },
    {
      topic: { en: '“Where is my cargo?”', ar: '«أين بضاعتي؟»' },
      before: {
        en: 'A phone call, then a search',
        ar: 'اتصال هاتفي، ثم بحث',
      },
      after: {
        en: 'The customer checks the tracking portal',
        ar: 'يراجع العميل بوابة التتبّع',
      },
    },
    {
      topic: { en: 'The invoice', ar: 'الفاتورة' },
      before: {
        en: 'Built from memory and old emails',
        ar: 'تُبنى من الذاكرة ورسائل قديمة',
      },
      after: {
        en: 'Built from the costs already on the job',
        ar: 'تُبنى من التكاليف المقيّدة على الشحنة',
      },
    },
  ],
  compare: {
    en: 'Weighing it against CargoWise or Logistaas? See how we compare',
    ar: 'تقارنونه بـ CargoWise أو Logistaas؟ اطّلعوا على المقارنة (بالإنجليزية)',
  },
}

export const pilotSteps = {
  title: { en: 'How the pilot works', ar: 'كيف تسير التجربة' },
  steps: [
    {
      title: { en: 'Tell us about your desk', ar: 'أخبرونا عن مكتبكم' },
      body: {
        en: 'A person reads the form and replies with what a pilot on your data involves.',
        ar: 'يقرأ شخصٌ الطلب ويرد عليكم بما تتضمنه تجربة على بياناتكم.',
      },
    },
    {
      title: { en: 'We load your data', ar: 'نحمّل بياناتكم' },
      body: {
        en: 'Your rate cards, customers and lanes go in before your team starts.',
        ar: 'أسعاركم وعملاؤكم وخطوطكم تُحمَّل قبل أن يبدأ فريقكم.',
      },
    },
    {
      title: { en: 'Your team runs real jobs', ar: 'فريقكم يعمل على شحنات حقيقية' },
      body: {
        en: 'Fifteen days, in both languages, with nothing to install. Your data stays yours.',
        ar: 'خمسة عشر يوماً، باللغتين، بلا شيء لتثبيته. وبياناتكم تبقى ملككم.',
      },
    },
  ],
}

export const faq = {
  eyebrow: { en: 'Questions', ar: 'أسئلة' },
  title: { en: 'What forwarders ask first.', ar: 'ما تسأل عنه شركات الشحن أولاً.' },
  more: {
    en: 'Something else? Write to us and a person will answer.',
    ar: 'سؤال آخر؟ راسلونا وسيجيبكم شخص.',
  },
  items: [
    {
      q: { en: 'Is the Arabic version complete?', ar: 'هل النسخة العربية كاملة؟' },
      a: {
        en: 'Yes. Every screen, document and email template exists in Arabic and English, laid out right to left from the start. Each user picks their language, and any document can be issued in either.',
        ar: 'نعم. كل شاشة ومستند وقالب بريد موجود بالعربية والإنجليزية، ومصمَّم من اليمين إلى اليسار من البداية. يختار كل مستخدم لغته، ويمكن إصدار أي مستند بأيٍّ من اللغتين.',
      },
    },
    {
      q: {
        en: 'Can we look at it before talking to anyone?',
        ar: 'هل يمكننا رؤيته قبل التحدث مع أحد؟',
      },
      a: {
        en: 'Yes. The live demo opens without sign-up, with sample shipments and sign-ins for a staff member, a customer and an overseas agent.',
        ar: 'نعم. النسخة التجريبية تفتح بلا تسجيل، ببيانات شحنات نموذجية وحسابات لموظف وعميل ووكيل في الخارج.',
      },
    },
    {
      q: {
        en: 'Which countries and modes does it cover?',
        ar: 'ما الدول ووسائل النقل التي يغطيها؟',
      },
      a: {
        en: 'It is built for forwarders and customs brokers in Kuwait, the UAE and Saudi Arabia, across sea FCL and LCL, air, road and courier.',
        ar: 'صُمّم لشركات الشحن والتخليص في الكويت والإمارات والسعودية، للشحن البحري بحاوية كاملة أو مجمّعة، والجوي والبري والبريد السريع.',
      },
    },
    {
      q: {
        en: 'Does it issue UAE or ZATCA e-invoices?',
        ar: 'هل يصدر فواتير إلكترونية للإمارات أو لهيئة الزكاة (ZATCA)؟',
      },
      a: {
        en: 'Not today. Every invoice line carries its tax treatment and rate, and the journal export hands the period to your accounting system or accredited provider, which issues the e-invoice.',
        ar: 'ليس حالياً. كل بند في الفاتورة يحمل معاملته الضريبية ونسبتها، وتصدير القيود ينقل الفترة إلى نظامكم المحاسبي أو المزوّد المعتمد الذي يصدر الفاتورة الإلكترونية.',
      },
    },
    {
      q: {
        en: 'Does it connect to our accounting software?',
        ar: 'هل يرتبط ببرنامجنا المحاسبي؟',
      },
      a: {
        en: 'There is no direct connector in this release. Invoices, receipts, supplier bills and payments export as a journal your accountant imports.',
        ar: 'لا يوجد رابط مباشر في هذا الإصدار. الفواتير والمقبوضات وفواتير المورّدين والمدفوعات تُصدَّر قيوداً يستوردها محاسبكم.',
      },
    },
    {
      q: { en: 'Where does our data live?', ar: 'أين تُحفظ بياناتنا؟' },
      a: {
        en: 'Each company runs on its own instance and database. Staff see only the branches they work for, and every change is recorded with who made it and when.',
        ar: 'لكل شركة نسختها وقاعدة بياناتها الخاصة. يرى الموظفون الفروع التي يعملون لها فقط، ويُسجَّل كل تغيير مع من أجراه ومتى.',
      },
    },
  ],
}
