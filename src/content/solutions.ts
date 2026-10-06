import type { Bi } from '@/content/copy'
import { solutionNav, solutionPath, type SolutionNav } from '@/content/solution-nav'

/**
 * The landing pages a stranger arrives on from search, as data.
 *
 * Ten pages answering ten questions a Gulf forwarder actually types: by market
 * ("freight forwarding software UAE", «برنامج شحن الكويت») and by job
 * ("freight quotation software", "WhatsApp for freight forwarders", «برنامج
 * تخليص جمركي»), plus one explainer for the UAE e-invoicing mandate. They are
 * one component and this table for the same reason the comparison pages are:
 * the shape of the honesty has to be the same on all of them, and a shape kept
 * in step by hand is a shape that drifts.
 *
 * **They do not compete with the pages already here.** `/compare/*` answers a
 * competitor's name; `/what-we-do/` answers "what is this product". These
 * answer a market or a task, and each links to the other two kinds rather than
 * repeating them.
 *
 * Every page has the same three obligations, and the type makes them fields
 * rather than habits:
 *
 *   - `limits`: what the product does not do for this reader, on the same page
 *     as the claims. It is the section that makes the rest believable, and on
 *     the Saudi and e-invoicing pages it is the first thing the reader needs.
 *   - `faq`: questions with answers that are on the page in readable text.
 *     `FaqSchema` marks up exactly these strings and nothing else, because a
 *     marked-up answer the visitor cannot see is cloaking.
 *   - `related`: the pages a reader of this one goes to next. Internal links
 *     are how a search engine learns the site is one argument rather than ten.
 *
 * **Claims are the same claims the sales set makes**, and no more:
 * `docs/marketing/sales/website-copy.md` and its "What is not in it" section
 * are the source, re-checked against the tree (`pnpm q find whatsapp`,
 * `apps/service/src/adapters/einvoice.ts`, `packages/core/src/notifications.ts`,
 * `apps/web/src/features/tracking/queries.ts`). When one of those changes, the
 * limit here changes with it.
 *
 * **No em dashes, in either language.** The website copy sets that rule for the
 * whole site; these pages were written to it from the start.
 *
 * The Arabic is written rather than translated, and takes its nouns from
 * `apps/web/messages/ar.json` («بوليصة الشحن الفرعية», «أمر التسليم»,
 * «وقت السماح», «الأرضيات», «المخلّص الجمركي») so a prospect reads here the
 * word the product prints. It has not been read by a native reviewer yet, the
 * same open item `apps/landing/README.md` records for the home page.
 */

export type SolutionFigure =
  'chargeable' | 'waffle' | 'accrual' | 'milestones' | 'minor' | 'layered' | 'own' | 'duty'

export interface Solution {
  slug: string
  group: SolutionNav['group']
  /** The header panel and the related-links cards; from `solution-nav.ts`. */
  nav: { label: Bi; blurb: Bi }
  /** `<title>` and meta description. Under ~60 and ~160 characters. */
  meta: { title: Bi; description: Bi }
  kicker: Bi
  /** The one H1. */
  title: Bi
  lede: Bi
  sections: {
    eyebrow: Bi
    heading: Bi
    lead?: Bi
    points?: { label: Bi; body: Bi }[]
    /** A two-column table, for the dates on the e-invoicing page. */
    table?: { head: [Bi, Bi, Bi]; rows: [Bi, Bi, Bi][] }
  }[]
  /**
   * A real capture from `public/pic/screens/`. `noAr` for the two captures that
   * are already language-specific (`english`, `arabic`) and have no twin.
   */
  shot?: { file: string; alt: Bi; look: Bi; noAr?: boolean }
  /** A drawn figure the existing pages already carry, reused where it argues this page's point. */
  figure?: SolutionFigure
  limits: { heading: Bi; lead: Bi; items: { label: Bi; body: Bi }[] }
  /** Dated sources, printed. Only the explainer has them, and it needs them. */
  sources?: { label: string; url: string }[]
  checked?: string
  faq: { q: Bi; a: Bi }[]
  /** Slugs from this file, or a site path such as `/compare/cargowise/`. */
  related: string[]
}

/** Limits that recur, written once so the wording cannot drift between pages. */
const LIMIT = {
  einvoice: {
    label: { en: 'E-invoicing transmission', ar: 'إرسال الفواتير الإلكترونية' },
    body: {
      en: 'Not shipped for the UAE or Saudi Arabia. Invoices carry tax treatment and rate per line, and the hand-off to an accredited provider is built but not switched on. Generating the mandated document is on the roadmap with no ship date.',
      ar: 'غير متاح بعد للإمارات أو السعودية. الفواتير تحمل المعالجة الضريبية والنسبة لكل بند، والربط مع المزوّد المعتمد مبنيّ لكنه غير مفعّل. أما إنشاء المستند بالصيغة المطلوبة فعلى خطة التطوير دون موعد إطلاق.',
    },
  },
  customsFiling: {
    label: { en: 'Customs filing', ar: 'تقديم البيانات الجمركية' },
    body: {
      en: 'Declarations are not filed to customs systems, including MicroClear in Kuwait. Declarations, duty and the clearance clock are tracked, and your broker files.',
      ar: 'لا تُقدَّم البيانات إلى أنظمة الجمارك، ومنها مايكروكلير في الكويت. البيان والرسوم ومهلة التخليص تُتابَع في النظام، ومخلّصكم هو من يقدّم.',
    },
  },
  carrierTracking: {
    label: { en: 'Live carrier tracking', ar: 'التتبع المباشر من الناقل' },
    body: {
      en: 'Built for Maersk, Hapag-Lloyd and CMA CGM, and it runs on your own carrier API credentials. Until you hold them, milestones are entered by your team.',
      ar: 'مبنيّ لميرسك وهاباغ لويد وسي إم إيه سي جي إم، ويعمل ببيانات الربط الخاصة بكم لدى الناقل. وإلى أن تحصلوا عليها، يُدخل فريقكم المراحل بنفسه.',
    },
  },
  accounting: {
    label: { en: 'Accounting connectors', ar: 'الربط مع برامج المحاسبة' },
    body: {
      en: 'No direct connector to a specific accounting package in this release. A journal of the period’s invoices, receipts, supplier bills and payments exports in a form your accountant can import.',
      ar: 'لا ربط مباشر مع برنامج محاسبة بعينه في هذا الإصدار. يُصدَّر قيد يومية بفواتير الفترة ومقبوضاتها وفواتير المورّدين والمدفوعات بصيغة يستوردها محاسبكم.',
    },
  },
  whatsappWindow: {
    label: { en: 'WhatsApp outside 24 hours', ar: 'واتساب بعد 24 ساعة' },
    body: {
      en: 'Your team replies within the 24 hours Meta allows after the customer’s last message. Starting a conversation after that needs Meta-approved templates, which are not sent yet.',
      ar: 'يردّ فريقكم خلال الأربع والعشرين ساعة التي تسمح بها Meta بعد آخر رسالة من العميل. وبدء محادثة بعدها يحتاج قوالب معتمدة من Meta، وهذه لا تُرسل بعد.',
    },
  },
}

/** A row as written below; `solution()` adds its menu entry from `solution-nav.ts`. */
type Row = Omit<Solution, 'group' | 'nav'>

const rows: Row[] = [
  // ─────────────────────────────────────────────────────────────── UAE ──
  {
    slug: 'freight-forwarding-software-uae',
    meta: {
      title: {
        en: 'Freight forwarding software for the UAE | CargoSharks',
        ar: 'برنامج شحن لشركات الشحن في الإمارات | CargoSharks',
      },
      description: {
        en: 'Enquiry to invoice on one record for UAE forwarders: WhatsApp and email intake, quotes from your rate cards, Arabic documents and AED invoicing.',
        ar: 'من الاستفسار إلى الفاتورة في سجل واحد لشركات الشحن في الإمارات: استقبال واتساب والبريد، وعروض أسعار من بطاقاتكم، ومستندات بالعربية، وفوترة بالدرهم.',
      },
    },
    kicker: { en: 'For forwarders in the UAE', ar: 'لشركات الشحن في الإمارات' },
    title: {
      en: 'Freight forwarding software for forwarders in the UAE',
      ar: 'نظام إدارة الشحن لشركات الشحن في الإمارات',
    },
    lede: {
      en: 'CargoSharks runs a forwarder’s day on one record: the enquiry from WhatsApp or email, the quote from your own rate cards, the job file, the documents and the invoice. It is built in Arabic and English at the same time, and this page says which UAE requirements it does not handle yet.',
      ar: 'يدير CargoSharks يوم شركة الشحن على سجل واحد: الاستفسار من واتساب أو البريد، وعرض السعر من بطاقات أسعاركم، وملف الشحنة، والمستندات، والفاتورة. بُني بالعربية والإنجليزية معاً، وهذه الصفحة تقول بوضوح أي متطلبات إماراتية لا يغطيها بعد.',
    },
    sections: [
      {
        eyebrow: { en: '01 · The desk', ar: '01 · المكتب' },
        heading: {
          en: 'What a Dubai or Abu Dhabi desk works from',
          ar: 'ما يعمل عليه مكتب في دبي أو أبوظبي',
        },
        lead: {
          en: 'The same software runs every branch, and each branch sees only its own rows. A group with an office in Jebel Ali and another in Kuwait runs one system, not two.',
          ar: 'البرنامج نفسه يعمل في كل الفروع، وكل فرع يرى صفوفه وحدها. فالمجموعة التي لها مكتب في جبل علي وآخر في الكويت تعمل على نظام واحد لا نظامين.',
        },
        points: [
          {
            label: { en: 'One enquiry queue.', ar: 'قائمة استفسارات واحدة.' },
            body: {
              en: 'WhatsApp messages to a branch’s business number and emails to its mailbox land in one list, each with an owner and a response deadline.',
              ar: 'رسائل واتساب إلى رقم الفرع التجاري ورسائل البريد إلى صندوقه تصل إلى قائمة واحدة، لكل استفسار مسؤول ومهلة للرد.',
            },
          },
          {
            label: { en: 'Quotes from your own rates.', ar: 'عروض أسعار من أسعاركم.' },
            body: {
              en: 'Buy and sell rate cards by lane, mode and carrier for sea FCL, sea LCL, air, land and courier, with chargeable weight worked out per mode and the margin on screen before the quote goes out.',
              ar: 'بطاقات أسعار الشراء والبيع حسب المسار والوسيلة والناقل، للبحري بحاوية كاملة وبالتجميع والجوي والبري والبريد السريع، مع الوزن الخاضع للأجرة محسوباً لكل وسيلة والهامش ظاهراً قبل إرسال العرض.',
            },
          },
          {
            label: { en: 'The job file.', ar: 'ملف الشحنة.' },
            body: {
              en: 'Milestones kept as planned, revised and actual, containers and seals, customs status, documents and exceptions on the same record. Demurrage, detention and storage clocks run per container and write their own charge lines.',
              ar: 'المراحل محفوظة بالمخطط والمعدّل والفعلي، والحاويات والأختام، وحالة التخليص، والمستندات والاستثناءات على السجل نفسه. وعدّادات الأرضيات والتأخير والتخزين تعمل لكل حاوية وتكتب بنود تكلفتها بنفسها.',
            },
          },
          {
            label: { en: 'Documents in Arabic or English.', ar: 'مستندات بالعربية أو الإنجليزية.' },
            body: {
              en: 'House bill of lading, air waybill, delivery order, packing list, customs pack and consolidation manifest, generated from the job data under the issuing branch’s name.',
              ar: 'بوليصة الشحن الفرعية وبوليصة الشحن الجوي وأمر التسليم وقائمة التعبئة وحزمة التخليص وبيان التجميع، تصدر من بيانات الشحنة باسم الفرع المُصدِر.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · Money', ar: '02 · المال' },
        heading: {
          en: 'Dirhams, dollars and dinars on the same job',
          ar: 'الدرهم والدولار والدينار على الشحنة نفسها',
        },
        lead: {
          en: 'A Gulf forwarder buys in dollars and sells in dirhams, and a group may invoice from more than one entity. The ledger was built for that rather than adjusted to it.',
          ar: 'شركة الشحن الخليجية تشتري بالدولار وتبيع بالدرهم، وقد تُصدر المجموعة فواتيرها من أكثر من كيان. والدفاتر بُنيت لذلك من البداية لا عُدّلت لاحقاً.',
        },
        points: [
          {
            label: { en: 'Per entity, per currency.', ar: 'لكل كيان ولكل عملة.' },
            body: {
              en: 'Invoices are raised by the entity that earned them, in its own currency. Every charge line keeps its own exchange rate and the moment it was taken, so a quote priced in dollars and invoiced in dirhams still reconciles months later.',
              ar: 'تصدر الفاتورة من الكيان الذي استحقها وبعملته. وكل بند يحتفظ بسعر صرفه ولحظة أخذه، فعرض السعر المسعّر بالدولار والمفوتر بالدرهم يبقى قابلاً للمطابقة بعد أشهر.',
            },
          },
          {
            label: { en: 'Tax per line.', ar: 'الضريبة لكل بند.' },
            body: {
              en: 'Each line carries its own tax treatment (standard, zero-rated, exempt, out of scope or reverse charge) and rate, because a forwarding invoice mixes them.',
              ar: 'كل بند يحمل معالجته الضريبية (قياسية أو صفرية أو معفاة أو خارج النطاق أو احتساب عكسي) ونسبته، لأن فاتورة الشحن تخلط بينها.',
            },
          },
          {
            label: { en: 'Decimal throughout.', ar: 'حساب عشري من طرف إلى طرف.' },
            body: {
              en: 'Money is never a floating-point number, and it rounds per currency at the line. That matters most in Kuwait, where the dinar has three decimals, and it is the same code in Dubai.',
              ar: 'المال لا يُحسب أبداً بأرقام تقريبية، ويُقرَّب حسب العملة عند البند. وهذا أهم ما يكون في الكويت حيث للدينار ثلاث خانات عشرية، وهو الكود نفسه في دبي.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '03 · Ownership', ar: '03 · الملكية' },
        heading: {
          en: 'Your database, in the region you choose',
          ar: 'قاعدة بياناتكم، في المنطقة التي تختارونها',
        },
        lead: {
          en: 'One deployment per customer, with your own database rather than a shared table with a customer column in it. Hosting in the UAE, Saudi Arabia or the EU is part of the offer, and your brand is on every screen and document instead of ours.',
          ar: 'نشر مستقل لكل عميل، بقاعدة بيانات خاصة به لا جدول مشترك فيه عمود للعميل. والاستضافة في الإمارات أو السعودية أو الاتحاد الأوروبي جزء من العرض، وعلامتكم التجارية على كل شاشة ومستند بدل علامتنا.',
        },
      },
    ],
    shot: {
      file: 'app-dashboard',
      alt: {
        en: 'The CargoSharks dashboard: four figures, a map of live shipments and the assistant panel',
        ar: 'لوحة معلومات CargoSharks: أربعة أرقام وخريطة للشحنات الجارية ولوحة المساعد',
      },
      look: {
        en: 'The first screen after sign-in, from the running demo. Switch it to Arabic from the sidebar and the whole layout turns right to left, not just the words.',
        ar: 'أول شاشة بعد الدخول، من النسخة التجريبية العاملة. حوّلوها إلى العربية من الشريط الجانبي فينقلب التصميم كله من اليمين إلى اليسار، لا الكلمات وحدها.',
      },
    },
    limits: {
      heading: { en: 'What it does not do in the UAE yet', ar: 'ما لا يفعله في الإمارات بعد' },
      lead: {
        en: 'Read this before the demo rather than after it.',
        ar: 'اقرؤوا هذا قبل النسخة التجريبية لا بعدها.',
      },
      items: [
        LIMIT.einvoice,
        {
          label: { en: 'Advance cargo filing (MPCI)', ar: 'التصريح المسبق عن البضائع (MPCI)' },
          body: {
            en: 'UAE pre-load cargo information filing is not supported.',
            ar: 'تقديم معلومات البضائع قبل التحميل في الإمارات غير مدعوم.',
          },
        },
        {
          label: { en: 'Customs filing', ar: 'تقديم البيانات الجمركية' },
          body: {
            en: 'Declarations are not filed to the UAE customs systems. They are tracked on the job with their status, duty and deadline, and your broker files.',
            ar: 'لا تُقدَّم البيانات إلى أنظمة الجمارك الإماراتية. تُتابَع على الشحنة بحالتها ورسومها ومهلتها، ومخلّصكم هو من يقدّم.',
          },
        },
        LIMIT.carrierTracking,
        LIMIT.accounting,
      ],
    },
    faq: [
      {
        q: {
          en: 'Is CargoSharks ready for UAE e-invoicing?',
          ar: 'هل CargoSharks جاهز للفوترة الإلكترونية في الإمارات؟',
        },
        a: {
          en: 'Not yet. Invoices already carry tax treatment and rate per line and the hand-off to an accredited service provider is built, but generating the PINT AE document and transmitting it is on the roadmap with no ship date. The UAE e-invoicing guide on this site sets out the deadlines and what to do in the meantime.',
          ar: 'ليس بعد. الفواتير تحمل المعالجة الضريبية والنسبة لكل بند، والربط مع مزوّد الخدمة المعتمد مبنيّ، لكن إنشاء مستند PINT AE وإرساله على خطة التطوير دون موعد إطلاق. ودليل الفوترة الإلكترونية في هذا الموقع يشرح المواعيد وما يمكن فعله حتى ذلك الحين.',
        },
      },
      {
        q: {
          en: 'Can we invoice in AED and quote in USD?',
          ar: 'هل نستطيع الفوترة بالدرهم والتسعير بالدولار؟',
        },
        a: {
          en: 'Yes. Each charge line stores its own currency, exchange rate and the moment the rate was taken, and each entity invoices in its own currency.',
          ar: 'نعم. كل بند يحفظ عملته وسعر الصرف ولحظة أخذه، وكل كيان يُصدر فواتيره بعملته.',
        },
      },
      {
        q: { en: 'Where is our data hosted?', ar: 'أين تُستضاف بياناتنا؟' },
        a: {
          en: 'In your own database, in the UAE, Saudi Arabia or the EU, chosen by you and written into the contract. Hosting in Kuwait or in your own cloud account is quoted separately.',
          ar: 'في قاعدة بيانات خاصة بكم، في الإمارات أو السعودية أو الاتحاد الأوروبي، باختياركم ومكتوبة في العقد. والاستضافة في الكويت أو في حسابكم السحابي الخاص تُسعَّر منفصلة.',
        },
      },
      {
        q: { en: 'Does it work in Arabic?', ar: 'هل يعمل بالعربية؟' },
        a: {
          en: 'Every screen, document and email template exists in Arabic and English, more than 4,000 interface strings kept in sync, with right-to-left built into the layout.',
          ar: 'كل شاشة ومستند وقالب بريد موجود بالعربية والإنجليزية، أكثر من 4,000 نص واجهة متطابقة، والاتجاه من اليمين إلى اليسار جزء من بنية التصميم.',
        },
      },
      {
        q: {
          en: 'Can we try it before talking to anyone?',
          ar: 'هل نستطيع تجربته قبل التحدث مع أحد؟',
        },
        a: {
          en: 'Yes. The live demo is the real software on seeded data, with sign-ins for you, your customer and your agent, and no sign-up.',
          ar: 'نعم. النسخة التجريبية هي البرنامج نفسه على بيانات مُعدّة، بحسابات لكم ولعميلكم ولوكيلكم، وبلا تسجيل.',
        },
      },
    ],
    related: [
      'uae-e-invoicing-freight-forwarders',
      'whatsapp-for-freight-forwarders',
      'freight-quotation-software',
      'freight-forwarding-software-kuwait',
      '/compare/cargoes-runner/',
    ],
  },

  // ──────────────────────────────────────────────────────────── Kuwait ──
  {
    slug: 'freight-forwarding-software-kuwait',
    meta: {
      title: {
        en: 'Freight forwarding software for Kuwait | CargoSharks',
        ar: 'برنامج شحن وتخليص لشركات الشحن في الكويت | CargoSharks',
      },
      description: {
        en: 'Freight software built in Kuwait: enquiries, quotes, job files, customs tracking, Arabic documents and invoices that keep all three decimals of the dinar.',
        ar: 'نظام إدارة شحن بُني في الكويت: الاستفسارات وعروض الأسعار وملفات الشحنات ومتابعة التخليص ومستندات بالعربية وفواتير تحتفظ بخانات الدينار الثلاث.',
      },
    },
    kicker: { en: 'Built in Kuwait', ar: 'بُني في الكويت' },
    title: {
      en: 'Freight forwarding software built in Kuwait, for Kuwaiti forwarders',
      ar: 'برنامج شحن بُني في الكويت لشركات الشحن الكويتية',
    },
    lede: {
      en: 'CargoSharks was built with a Kuwaiti forwarder, on their own operation. It knows that a dinar has three decimals, that a box sitting in Shuwaikh past its free days is money, and that a delivery order goes out in Arabic.',
      ar: 'بُني CargoSharks مع شركة شحن كويتية، على عملياتها الفعلية. يعرف أن للدينار ثلاث خانات عشرية، وأن حاوية تتجاوز أيام السماح في الشويخ مالٌ يضيع، وأن أمر التسليم يخرج بالعربية.',
    },
    sections: [
      {
        eyebrow: { en: '01 · The dinar', ar: '01 · الدينار' },
        heading: {
          en: 'Three decimals, all the way down',
          ar: 'ثلاث خانات عشرية، من الطرف إلى الطرف',
        },
        lead: {
          en: 'Most software rounds money to two decimals somewhere between the database and the screen. In Kuwait the third decimal is real money, and a system that drops it produces invoices that do not add up to their own lines.',
          ar: 'معظم البرامج تقرّب المال إلى خانتين في مكان ما بين قاعدة البيانات والشاشة. وفي الكويت الخانة الثالثة مالٌ حقيقي، والنظام الذي يُسقطها يُصدر فواتير لا يساوي مجموعها بنودها.',
        },
        points: [
          {
            label: { en: 'Stored in full.', ar: 'يُحفظ كاملاً.' },
            body: {
              en: 'Every amount is a decimal with six places in the database and is rounded per currency at the line, so KWD keeps three and USD keeps two.',
              ar: 'كل مبلغ رقم عشري بست خانات في قاعدة البيانات، ويُقرَّب حسب العملة عند البند، فيحتفظ الدينار بثلاث والدولار باثنتين.',
            },
          },
          {
            label: { en: 'Split to the fils.', ar: 'يُوزَّع حتى الفلس.' },
            body: {
              en: 'A master’s cost shared across its houses is allocated so that the shares add back to the master exactly, to the last fils.',
              ar: 'تكلفة البوليصة الرئيسية الموزعة على البوالص الفرعية تُقسم بحيث يعود مجموع الحصص إليها تماماً، حتى آخر فلس.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · The yard', ar: '02 · الساحة' },
        heading: {
          en: 'Free time that counts itself, in Shuwaikh and Shuaiba',
          ar: 'وقت سماح يعدّ نفسه، في الشويخ والشعيبة',
        },
        lead: {
          en: 'Demurrage, detention and storage clocks start from the milestone that starts free time, per container, against the carrier’s free days. When free time runs out the clock writes its own charge line against the job, at the right per-day rate.',
          ar: 'عدّادات الأرضيات والتأخير والتخزين تبدأ من المرحلة التي يبدأ عندها وقت السماح، لكل حاوية، مقابل أيام السماح لدى الناقل. وحين ينتهي وقت السماح يكتب العدّاد بند التكلفة بنفسه على الشحنة، بالتعرفة اليومية الصحيحة.',
        },
      },
      {
        eyebrow: { en: '03 · The day', ar: '03 · اليوم' },
        heading: {
          en: 'Enquiry to paid invoice, on one file',
          ar: 'من الاستفسار إلى الفاتورة المسدَّدة، على سجل واحد',
        },
        points: [
          {
            label: { en: 'Enquiries.', ar: 'الاستفسارات.' },
            body: {
              en: 'From WhatsApp, email, the web form and the phone, in one queue across every branch, with an owner and a response clock.',
              ar: 'من واتساب والبريد ونموذج الموقع والهاتف، في قائمة واحدة لكل الفروع، لكل منها مسؤول وعدّاد للرد.',
            },
          },
          {
            label: { en: 'Customs.', ar: 'التخليص.' },
            body: {
              en: 'Declarations ordered by the clearance deadline that closes first, with type, number, status, duty and broker, and a duty estimate from the tariff table before the declaration goes in.',
              ar: 'البيانات مرتبة حسب مهلة التخليص الأقرب، بنوعها ورقمها وحالتها ورسومها ومخلّصها، مع تقدير للرسوم من جدول التعرفة قبل تقديم البيان.',
            },
          },
          {
            label: { en: 'Documents.', ar: 'المستندات.' },
            body: {
              en: 'House bill of lading, delivery order, packing list and customs pack in Arabic or English, numbered from the branch’s own series.',
              ar: 'بوليصة الشحن الفرعية وأمر التسليم وقائمة التعبئة وحزمة التخليص بالعربية أو الإنجليزية، مرقّمة من تسلسل الفرع نفسه.',
            },
          },
          {
            label: { en: 'Finance.', ar: 'المالية.' },
            body: {
              en: 'Supplier bills matched to what the job accrued, receivables by age, and a credit check against the customer’s limit when a shipment is booked.',
              ar: 'فواتير المورّدين تُطابَق مع ما استحق على الشحنة، والذمم المدينة حسب التقادم، وفحص الحد الائتماني للعميل عند حجز الشحنة.',
            },
          },
        ],
      },
    ],
    figure: 'minor',
    shot: {
      file: 'jobs',
      alt: {
        en: 'The operations board: live shipments ordered by exception, oldest first',
        ar: 'لوحة العمليات: الشحنات الجارية مرتبة حسب الاستثناءات، الأقدم أولاً',
      },
      look: {
        en: 'The board orders live shipments by what has gone wrong, oldest first, on the principle that the one nobody has looked at is the one the process missed.',
        ar: 'ترتّب اللوحة الشحنات الجارية حسب ما تعثّر فيها، الأقدم أولاً، على مبدأ أن الشحنة التي لم ينظر فيها أحد هي التي فاتت الإجراءات.',
      },
    },
    limits: {
      heading: { en: 'What it does not do', ar: 'ما لا يفعله' },
      lead: {
        en: 'The same list we give in the first meeting.',
        ar: 'القائمة نفسها التي نقدّمها في أول اجتماع.',
      },
      items: [
        LIMIT.customsFiling,
        LIMIT.carrierTracking,
        LIMIT.whatsappWindow,
        {
          label: { en: 'Native mobile apps', ar: 'تطبيقات الجوال' },
          body: {
            en: 'There are none. Proof of delivery already works from a phone browser, with signature, photographs, recipient and location.',
            ar: 'لا توجد. إثبات التسليم يعمل من متصفح الهاتف، بالتوقيع والصور واسم المستلم والموقع.',
          },
        },
        LIMIT.accounting,
      ],
    },
    faq: [
      {
        q: {
          en: 'Do you file declarations on MicroClear?',
          ar: 'هل تقدّمون البيانات على مايكروكلير؟',
        },
        a: {
          en: 'No. MicroClear is not an API a forwarder can buy, so declarations are tracked rather than filed: type, number, status, duty, broker and clearance deadline, with a duty estimate before filing. Your broker files as today.',
          ar: 'لا. مايكروكلير ليس واجهة ربط تستطيع شركة الشحن شراءها، لذلك تُتابَع البيانات ولا تُقدَّم: النوع والرقم والحالة والرسوم والمخلّص ومهلة التخليص، مع تقدير للرسوم قبل التقديم. ويقدّم مخلّصكم كما يفعل اليوم.',
        },
      },
      {
        q: {
          en: 'Does it keep the third decimal of the dinar?',
          ar: 'هل يحتفظ بالخانة الثالثة للدينار؟',
        },
        a: {
          en: 'Yes, everywhere. Money is decimal from the database to the PDF and rounds per currency at the line, so a KWD invoice shows and adds up in fils.',
          ar: 'نعم، في كل مكان. المال عشري من قاعدة البيانات إلى ملف PDF ويُقرَّب حسب العملة عند البند، ففاتورة الدينار تظهر وتُجمع بالفلس.',
        },
      },
      {
        q: { en: 'Can our data stay in Kuwait?', ar: 'هل يمكن أن تبقى بياناتنا في الكويت؟' },
        a: {
          en: 'Yes, if it must. Hosting in Kuwait is quoted separately; the UAE, Saudi Arabia and the EU are included. Either way it is your own database, not a shared one.',
          ar: 'نعم، إن لزم ذلك. الاستضافة في الكويت تُسعَّر منفصلة، والإمارات والسعودية والاتحاد الأوروبي مشمولة. وفي كل الأحوال هي قاعدة بيانات خاصة بكم لا مشتركة.',
        },
      },
      {
        q: {
          en: 'Can our customers track their shipments?',
          ar: 'هل يستطيع عملاؤنا تتبع شحناتهم؟',
        },
        a: {
          en: 'Yes. A public tracking page needs a reference and a second identifier and no account, and a customer portal shows their shipments, released documents, quotations and invoices, both in Arabic.',
          ar: 'نعم. صفحة تتبع عامة تحتاج رقم الشحنة ومعرّفاً ثانياً ولا تحتاج حساباً، وبوابة للعملاء تعرض شحناتهم ومستنداتهم المُفرج عنها وعروض الأسعار والفواتير، وكلاهما بالعربية.',
        },
      },
      {
        q: { en: 'How long does it take to start?', ar: 'كم يستغرق البدء؟' },
        a: {
          en: 'Weeks, not quarters. A paid pilot runs on your real enquiries and rate card for 60 days for one office, and becomes your live system if you go ahead.',
          ar: 'أسابيع لا أشهر. التجربة المدفوعة تعمل على استفساراتكم الحقيقية وبطاقة أسعاركم لمدة 60 يوماً لمكتب واحد، وتصبح نظامكم الفعلي إن قررتم المتابعة.',
        },
      },
    ],
    related: [
      'customs-clearance-software',
      'arabic-freight-documents',
      'freight-invoicing-software',
      'freight-forwarding-software-uae',
      '/compare/spreadsheets/',
    ],
  },

  // ────────────────────────────────────────────────────── Saudi Arabia ──
  {
    slug: 'freight-forwarding-software-saudi-arabia',
    meta: {
      title: {
        en: 'Freight forwarding software for Saudi Arabia | CargoSharks',
        ar: 'برنامج شحن لشركات الشحن في السعودية | CargoSharks',
      },
      description: {
        en: 'Arabic-first freight software for Saudi forwarders, with SAR, hosting in the Kingdom and a plain answer on ZATCA: it does not issue Phase 2 e-invoices.',
        ar: 'نظام شحن عربي أولاً لشركات الشحن في الدمام وجدة والرياض، بالريال واستضافة في السعودية، وجواب واضح عن زاتكا: فواتير المرحلة الثانية لا تصدر منه.',
      },
    },
    kicker: { en: 'For forwarders in Saudi Arabia', ar: 'لشركات الشحن في السعودية' },
    title: {
      en: 'Freight forwarding software for Saudi forwarders, and what it does not do yet',
      ar: 'برنامج شحن لشركات الشحن السعودية، وما لا يفعله بعد',
    },
    lede: {
      en: 'The answer to the first question comes first: CargoSharks does not issue ZATCA Phase 2 e-invoices. What it does do is run enquiries, quotes, job files, documents and job costing in Arabic first, in riyals, on a database hosted in Saudi Arabia if you choose.',
      ar: 'جواب السؤال الأول أولاً: CargoSharks لا يُصدر فواتير إلكترونية للمرحلة الثانية من زاتكا. أما ما يفعله فهو إدارة الاستفسارات وعروض الأسعار وملفات الشحنات والمستندات وتكاليف الشحنات، بالعربية أولاً، وبالريال، على قاعدة بيانات مستضافة في السعودية إن اخترتم.',
    },
    sections: [
      {
        eyebrow: { en: '01 · ZATCA', ar: '01 · زاتكا' },
        heading: { en: 'The ZATCA question, answered plainly', ar: 'سؤال زاتكا، بجواب واضح' },
        lead: {
          en: 'Under Phase 2, a tax invoice is a structured XML document with a QR code and a cryptographic stamp, integrated with ZATCA’s Fatoora platform. CargoSharks does not generate that document. Each invoice line already carries its tax treatment and rate, so the data is in the right shape, but the Saudi format and the integration are not built and have no ship date.',
          ar: 'في المرحلة الثانية تكون الفاتورة الضريبية مستند XML منظّماً برمز QR وختم تشفيري، مرتبطاً بمنصة فاتورة لدى زاتكا. CargoSharks لا يُنشئ هذا المستند. كل بند في الفاتورة يحمل معالجته الضريبية ونسبته، فالبيانات بالشكل الصحيح، لكن الصيغة السعودية والربط غير مبنيين ولا موعد لإطلاقهما.',
        },
        points: [
          {
            label: { en: 'What that means in practice.', ar: 'ماذا يعني ذلك عملياً.' },
            body: {
              en: 'Tax invoices keep coming from your ZATCA-compliant system. CargoSharks can run everything before the invoice and the costing behind it, and exports a journal of the period your accountant can import.',
              ar: 'تبقى الفواتير الضريبية صادرة من نظامكم المتوافق مع زاتكا. ويستطيع CargoSharks إدارة كل ما قبل الفاتورة والتكاليف خلفها، ويُصدّر قيد يومية للفترة يستورده محاسبكم.',
            },
          },
          {
            label: { en: 'Who that suits.', ar: 'لمن يناسب ذلك.' },
            body: {
              en: 'A forwarder whose pain is the enquiry, the quote and the job file. A forwarder who needs one system that also issues the tax invoice should not buy this yet.',
              ar: 'شركة شحن مشكلتها في الاستفسار وعرض السعر وملف الشحنة. أما من يحتاج نظاماً واحداً يُصدر الفاتورة الضريبية أيضاً فلا ينبغي له أن يشتري هذا الآن.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · What works', ar: '02 · ما يعمل' },
        heading: {
          en: 'What a Saudi desk can use today',
          ar: 'ما يستطيع مكتب سعودي استخدامه اليوم',
        },
        points: [
          {
            label: { en: 'Arabic first.', ar: 'العربية أولاً.' },
            body: {
              en: 'Every screen, document and email template in Arabic and English, laid out right to left rather than mirrored. When a customer writes in Arabic, the assistant answers in Arabic.',
              ar: 'كل شاشة ومستند وقالب بريد بالعربية والإنجليزية، بتصميم من اليمين إلى اليسار لا معكوس. وحين يكتب العميل بالعربية يردّ المساعد بالعربية.',
            },
          },
          {
            label: { en: 'Enquiries and quotes.', ar: 'الاستفسارات وعروض الأسعار.' },
            body: {
              en: 'WhatsApp and email in one queue with a clock, quotes priced from your own rate cards, and rate requests to your agents read back into rates you can price from.',
              ar: 'واتساب والبريد في قائمة واحدة بعدّاد للرد، وعروض أسعار من بطاقات أسعاركم، وطلبات أسعار إلى وكلائكم تُقرأ ردودها أسعاراً يمكن التسعير منها.',
            },
          },
          {
            label: { en: 'Riyals and dollars.', ar: 'الريال والدولار.' },
            body: {
              en: 'SAR alongside every other currency, with each charge line keeping its own exchange rate and the moment it was taken.',
              ar: 'الريال إلى جانب العملات الأخرى، وكل بند يحتفظ بسعر صرفه ولحظة أخذه.',
            },
          },
          {
            label: { en: 'Hosted in the Kingdom.', ar: 'مستضاف في المملكة.' },
            body: {
              en: 'Your own database, hosted in Saudi Arabia if you choose, under your own brand.',
              ar: 'قاعدة بيانات خاصة بكم، مستضافة في السعودية إن اخترتم، تحت علامتكم التجارية.',
            },
          },
        ],
      },
    ],
    shot: {
      file: 'enquiries',
      alt: {
        en: 'The enquiry queue: every enquiry with an owner, a status and a response deadline',
        ar: 'قائمة الاستفسارات: كل استفسار بمسؤول وحالة ومهلة للرد',
      },
      look: {
        en: 'The enquiry queue in the demo, the part of the product a Saudi desk can put to work without touching how it invoices.',
        ar: 'قائمة الاستفسارات في النسخة التجريبية، وهي الجزء الذي يستطيع مكتب سعودي تشغيله دون المساس بطريقة فوترته.',
      },
    },
    limits: {
      heading: { en: 'What it does not do in Saudi Arabia', ar: 'ما لا يفعله في السعودية' },
      lead: {
        en: 'All of this is stated in the contract as well as here.',
        ar: 'كل هذا مكتوب في العقد كما هو مكتوب هنا.',
      },
      items: [
        {
          label: {
            en: 'ZATCA Phase 2 e-invoicing',
            ar: 'الفوترة الإلكترونية للمرحلة الثانية من زاتكا',
          },
          body: {
            en: 'No XML invoice, QR code, cryptographic stamp or Fatoora integration. On the roadmap with no ship date.',
            ar: 'لا فاتورة XML ولا رمز QR ولا ختم تشفيري ولا ربط مع منصة فاتورة. على خطة التطوير دون موعد إطلاق.',
          },
        },
        {
          label: { en: 'Customs filing', ar: 'تقديم البيانات الجمركية' },
          body: {
            en: 'Declarations are not filed to the Saudi customs platform. They are tracked on the job, and your broker files.',
            ar: 'لا تُقدَّم البيانات إلى منصة الجمارك السعودية. تُتابَع على الشحنة، ومخلّصكم هو من يقدّم.',
          },
        },
        LIMIT.carrierTracking,
        LIMIT.accounting,
      ],
    },
    faq: [
      {
        q: { en: 'Is CargoSharks ZATCA compliant?', ar: 'هل CargoSharks متوافق مع زاتكا؟' },
        a: {
          en: 'No. It does not generate Phase 2 e-invoices or integrate with Fatoora, and we do not claim otherwise. Keep issuing tax invoices from your compliant system.',
          ar: 'لا. لا يُنشئ فواتير المرحلة الثانية ولا يرتبط بمنصة فاتورة، ولا ندّعي غير ذلك. استمروا في إصدار الفواتير الضريبية من نظامكم المتوافق.',
        },
      },
      {
        q: {
          en: 'Then why would a Saudi forwarder use it?',
          ar: 'إذن لماذا تستخدمه شركة شحن سعودية؟',
        },
        a: {
          en: 'For the work before the invoice: WhatsApp and email enquiries in one queue, quotes from your own rates, job files with milestones and free-time clocks, and documents in Arabic. If that is where your time goes, it is worth a look; if it is not, it is not.',
          ar: 'للعمل الذي يسبق الفاتورة: استفسارات واتساب والبريد في قائمة واحدة، وعروض أسعار من أسعاركم، وملفات شحنات بمراحلها وعدّادات وقت السماح، ومستندات بالعربية. إن كان وقتكم يذهب هناك فهو يستحق النظر، وإلا فلا.',
        },
      },
      {
        q: { en: 'Can it be hosted in Saudi Arabia?', ar: 'هل يمكن استضافته في السعودية؟' },
        a: {
          en: 'Yes. Saudi Arabia is one of the included hosting regions, alongside the UAE and the EU.',
          ar: 'نعم. السعودية من مناطق الاستضافة المشمولة، إلى جانب الإمارات والاتحاد الأوروبي.',
        },
      },
      {
        q: { en: 'Does it handle SAR?', ar: 'هل يتعامل بالريال السعودي؟' },
        a: {
          en: 'Yes, as one currency among the others, with per-line exchange rates and decimal money throughout.',
          ar: 'نعم، كعملة بين العملات الأخرى، بسعر صرف لكل بند وحساب عشري في كل مكان.',
        },
      },
    ],
    related: [
      'uae-e-invoicing-freight-forwarders',
      'whatsapp-for-freight-forwarders',
      'arabic-freight-documents',
      'freight-quotation-software',
      '/compare/',
    ],
  },

  // ─────────────────────────────────────────────────────────── Quoting ──
  {
    slug: 'freight-quotation-software',
    meta: {
      title: {
        en: 'Freight quotation and rate management software | CargoSharks',
        ar: 'برنامج عروض أسعار الشحن وإدارة الأسعار | CargoSharks',
      },
      description: {
        en: 'Price freight quotes from your own rate cards, with chargeable weight per mode, accessorials, agent rate requests and the margin on screen before you send.',
        ar: 'سعّروا عروض الشحن من بطاقات أسعار الشراء والبيع الخاصة بكم، مع الوزن الخاضع للأجرة لكل وسيلة والرسوم الإضافية وطلبات أسعار الوكلاء والهامش قبل الإرسال.',
      },
    },
    kicker: { en: 'Quotation and rate management', ar: 'عروض الأسعار وإدارة الأسعار' },
    title: {
      en: 'Freight quotation software that prices from your own rate cards',
      ar: 'برنامج عروض أسعار الشحن يسعّر من بطاقات أسعاركم',
    },
    lede: {
      en: 'The forwarder who answers first often wins the job. CargoSharks prices an enquiry from the buy and sell cards you loaded, sends it to your agents where no card covers the lane, and shows buy, sell and margin before the quotation leaves.',
      ar: 'من يردّ أولاً يفوز بالشحنة في كثير من الأحيان. يسعّر CargoSharks الاستفسار من بطاقات الشراء والبيع التي حمّلتموها، ويرسله إلى وكلائكم حيث لا تغطي البطاقة المسار، ويُظهر الشراء والبيع والهامش قبل خروج العرض.',
    },
    sections: [
      {
        eyebrow: { en: '01 · Rate cards', ar: '01 · بطاقات الأسعار' },
        heading: { en: 'Rate cards that cannot collide', ar: 'بطاقات أسعار لا تتصادم' },
        points: [
          {
            label: { en: 'By lane, mode and carrier.', ar: 'حسب المسار والوسيلة والناقل.' },
            body: {
              en: 'Buy and sell cards with validity dates. Two cards cannot cover the same lane at the same time: the database refuses it, so it is not a rule somebody has to remember.',
              ar: 'بطاقات شراء وبيع بتواريخ صلاحية. ولا يمكن لبطاقتين أن تغطيا المسار نفسه في الوقت نفسه: قاعدة البيانات ترفض ذلك، فليست قاعدة يتذكرها أحد.',
            },
          },
          {
            label: {
              en: 'The lanes you are quoting blind.',
              ar: 'المسارات التي تسعّرونها دون أساس.',
            },
            body: {
              en: 'The rate-card screen names the lanes with no live buying rate on file and the cards that expire in the next thirty days.',
              ar: 'شاشة بطاقات الأسعار تسمّي المسارات التي لا سعر شراء سارياً لها، والبطاقات التي تنتهي خلال الثلاثين يوماً القادمة.',
            },
          },
          {
            label: { en: 'Accessorials from a catalogue.', ar: 'رسوم إضافية من دليل.' },
            body: {
              en: 'Fuel, insurance, dangerous goods and the rest come from a charge catalogue your administrator controls, each with its own basis: flat, per container, per kilo, per day, per unit or a percentage.',
              ar: 'الوقود والتأمين والبضائع الخطرة وغيرها تأتي من دليل رسوم يتحكم فيه مسؤول النظام، لكل منها أساس احتسابه: مبلغ مقطوع أو لكل حاوية أو لكل كيلو أو لكل يوم أو لكل وحدة أو نسبة مئوية.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · Chargeable weight', ar: '02 · الوزن الخاضع للأجرة' },
        heading: { en: 'Each mode calculated its own way', ar: 'كل وسيلة تُحسب بطريقتها' },
        lead: {
          en: 'Freight is billed on the greater of weight and volume, converted by a divisor that differs per mode, rounded to that mode’s increment and floored at its minimum. Air uses the IATA 6,000 divisor with a 45 kg minimum, LCL is weight or measure at one cubic metre to the tonne, and FCL is per container. Approximating one mode with another’s arithmetic is where a rate stops matching the invoice.',
          ar: 'يُحتسب الشحن على الأكبر من الوزن والحجم، محوَّلاً بمعامل يختلف حسب الوسيلة، ومقرَّباً إلى وحدة تلك الوسيلة، وبحد أدنى خاص بها. الجوي بمعامل IATA البالغ 6,000 وحد أدنى 45 كغ، والتجميع البحري وزنٌ أو حجم بمتر مكعب لكل طن، والحاوية الكاملة لكل حاوية. وحساب وسيلة بمعادلة أخرى هو حيث يتوقف السعر عن مطابقة الفاتورة.',
        },
      },
      {
        eyebrow: { en: '03 · Agents', ar: '03 · الوكلاء' },
        heading: { en: 'Rates from your agents, read for you', ar: 'أسعار وكلائكم، مقروءة لكم' },
        lead: {
          en: 'Where no card covers the lane, “Request rates” on the enquiry emails the agents who cover it. Each reply, whether a number in the body, a PDF tariff or a spreadsheet, is read into a rate, and the enquiry ranks the replies cheapest first in dinar for a one-click buy card. A card about to lapse can be re-requested before it does.',
          ar: 'حيث لا تغطي البطاقة المسار، يرسل زر «اطلب الأسعار» على الاستفسار بريداً إلى الوكلاء الذين يغطونه. وكل رد، سواء كان رقماً في نص الرسالة أو تعرفة PDF أو جدول بيانات، يُقرأ سعراً، ويرتّب الاستفسار الردود من الأرخص بالدينار لتصير بطاقة شراء بنقرة واحدة. والبطاقة التي توشك على الانتهاء يمكن طلب تجديدها قبل أن تنتهي.',
        },
      },
      {
        eyebrow: { en: '04 · The quotation', ar: '04 · عرض السعر' },
        heading: { en: 'From the margin to the award', ar: 'من الهامش إلى الترسية' },
        points: [
          {
            label: { en: 'Margin before sending.', ar: 'الهامش قبل الإرسال.' },
            body: {
              en: 'Buy, sell and margin side by side on every option, as a percentage, an amount or a target sell price.',
              ar: 'الشراء والبيع والهامش جنباً إلى جنب لكل خيار، كنسبة أو مبلغ أو سعر بيع مستهدف.',
            },
          },
          {
            label: { en: 'Under your name, in either language.', ar: 'باسمكم، بأي من اللغتين.' },
            body: {
              en: 'The quotation PDF carries your entity’s name, trading conditions, exclusions and a validity date, in Arabic or English. The assistant can draft the covering note; a person edits and sends it.',
              ar: 'ملف PDF لعرض السعر يحمل اسم كيانكم وشروط التعامل والاستثناءات وتاريخ الصلاحية، بالعربية أو الإنجليزية. ويستطيع المساعد صياغة رسالة التغطية، ويعدّلها شخص ويرسلها.',
            },
          },
          {
            label: { en: 'Revisions supersede.', ar: 'المراجعات تحلّ محل السابقة.' },
            body: {
              en: 'A revised quotation never overwrites the old one, so what the customer accepted is always recoverable.',
              ar: 'العرض المعدّل لا يُكتب فوق السابق أبداً، فما قبله العميل يبقى قابلاً للاسترجاع دائماً.',
            },
          },
          {
            label: { en: 'Accepted online.', ar: 'قبول عبر الإنترنت.' },
            body: {
              en: 'Your customer accepts or declines in the portal, or you record it for them. Accepting opens the job file with the rates attached, so what you sold is what you cost.',
              ar: 'يقبل عميلكم العرض أو يرفضه في البوابة، أو تسجّلون ذلك نيابة عنه. والقبول يفتح ملف الشحنة والأسعار مرفقة به، فما بعتموه هو ما تحسبون تكلفته.',
            },
          },
        ],
      },
    ],
    figure: 'chargeable',
    shot: {
      file: 'enquiries',
      alt: {
        en: 'The enquiry queue: every enquiry with an owner, a status and a response deadline',
        ar: 'قائمة الاستفسارات: كل استفسار بمسؤول وحالة ومهلة للرد',
      },
      look: {
        en: 'Every enquiry with an owner, a status and a deadline. How long you actually take to quote is measured here rather than estimated.',
        ar: 'كل استفسار بمسؤول وحالة ومهلة. والمدة التي تستغرقونها فعلاً لتقديم العرض تُقاس هنا ولا تُقدَّر.',
      },
    },
    limits: {
      heading: { en: 'What it does not do', ar: 'ما لا يفعله' },
      lead: {
        en: 'Prices come from cards you hold and replies from agents you work with.',
        ar: 'الأسعار تأتي من بطاقات تملكونها وردود وكلاء تتعاملون معهم.',
      },
      items: [
        {
          label: { en: 'Marketplace spot rates', ar: 'أسعار الأسواق الفورية' },
          body: {
            en: 'It does not pull spot rates from carrier or freight marketplace APIs.',
            ar: 'لا يجلب أسعاراً فورية من واجهات الناقلين أو أسواق الشحن.',
          },
        },
        {
          label: { en: 'Sending without a person', ar: 'الإرسال دون شخص' },
          body: {
            en: 'A quotation can be drafted automatically when that is switched on, but sending it stays a human act.',
            ar: 'يمكن صياغة العرض تلقائياً متى فُعّل ذلك، لكن إرساله يبقى فعلاً بشرياً.',
          },
        },
        LIMIT.whatsappWindow,
      ],
    },
    faq: [
      {
        q: {
          en: 'Can it price LCL by weight or measure?',
          ar: 'هل يسعّر التجميع البحري بالوزن أو الحجم؟',
        },
        a: {
          en: 'Yes. LCL is priced per cubic metre or weight-or-measure, the greater of cubic metres and metric tonnes at one cubic metre to the tonne, with a 1,000 kg minimum.',
          ar: 'نعم. يُسعَّر التجميع البحري بالمتر المكعب أو بالوزن أو الحجم، أيهما أكبر من الأمتار المكعبة والأطنان بمتر مكعب لكل طن، بحد أدنى 1,000 كغ.',
        },
      },
      {
        q: {
          en: 'What happens when no rate card covers a lane?',
          ar: 'ماذا يحدث حين لا تغطي أي بطاقة المسار؟',
        },
        a: {
          en: 'The enquiry sends a rate request to the agents who cover it, reads their replies into rates and ranks them, and you turn the one you want into a buy card with one click.',
          ar: 'يرسل الاستفسار طلب أسعار إلى الوكلاء الذين يغطون المسار، ويقرأ ردودهم أسعاراً ويرتّبها، وتحوّلون ما تريدون منها إلى بطاقة شراء بنقرة واحدة.',
        },
      },
      {
        q: {
          en: 'Can our customers accept a quote online?',
          ar: 'هل يستطيع عملاؤنا قبول العرض عبر الإنترنت؟',
        },
        a: {
          en: 'Yes, in the customer portal, in Arabic or English. Acceptance opens the job file with the buy and sell rates already attached.',
          ar: 'نعم، في بوابة العملاء، بالعربية أو الإنجليزية. والقبول يفتح ملف الشحنة وأسعار الشراء والبيع مرفقة به.',
        },
      },
      {
        q: { en: 'Does it quote automatically from WhatsApp?', ar: 'هل يسعّر تلقائياً من واتساب؟' },
        a: {
          en: 'It can draft one. When the automatic pieces are switched on, a complete enquiry on a covered lane is priced into a draft quotation against your house margin. A person reviews and sends it.',
          ar: 'يستطيع صياغة مسودة. متى فُعّلت الأجزاء التلقائية، يُسعَّر الاستفسار المكتمل على مسار مغطى في مسودة عرض وفق هامشكم المعتاد. ويراجعه شخص ويرسله.',
        },
      },
      {
        q: {
          en: 'Do the divisors have to match yours?',
          ar: 'هل يجب أن تطابق المعاملات ما لديكم؟',
        },
        a: {
          en: 'No. Divisors, increments and minimums are configuration rows an administrator edits, not values written into the code. An airline that changes its divisor is an edit, not a release.',
          ar: 'لا. المعاملات ووحدات التقريب والحدود الدنيا إعدادات يعدّلها مسؤول النظام، لا قيم مكتوبة في الكود. والناقل الجوي الذي يغيّر معامله يحتاج تعديلاً لا إصداراً جديداً.',
        },
      },
    ],
    related: [
      'whatsapp-for-freight-forwarders',
      'freight-invoicing-software',
      'shipment-tracking-portal',
      '/compare/logistaas/',
      '/compare/spreadsheets/',
    ],
  },

  // ────────────────────────────────────────────────────────── WhatsApp ──
  {
    slug: 'whatsapp-for-freight-forwarders',
    meta: {
      title: {
        en: 'WhatsApp enquiry intake for freight forwarders | CargoSharks',
        ar: 'استقبال استفسارات واتساب لشركات الشحن | CargoSharks',
      },
      description: {
        en: 'WhatsApp messages to your business numbers become enquiries with an owner and a clock. An assistant asks for what is missing and stops when your team replies.',
        ar: 'رسائل واتساب إلى أرقامكم التجارية تصبح استفسارات لها مسؤول وعدّاد. يسأل المساعد عن الناقص بلغة العميل، ويتوقف حين يردّ فريقكم.',
      },
    },
    kicker: { en: 'WhatsApp for freight forwarders', ar: 'واتساب لشركات الشحن' },
    title: {
      en: 'WhatsApp enquiries, in the same queue as your email',
      ar: 'استفسارات واتساب، في القائمة نفسها مع البريد',
    },
    lede: {
      en: 'In the Gulf, a large share of freight enquiries arrive on WhatsApp, on somebody’s phone, where nobody else can see them and nobody is timed. CargoSharks connects your WhatsApp business numbers to the enquiry queue, so a message becomes an enquiry with an owner, a deadline and the whole conversation attached.',
      ar: 'في الخليج يصل جزء كبير من استفسارات الشحن عبر واتساب، على هاتف أحدهم، حيث لا يراها غيره ولا يُقاس وقت الرد عليها. يربط CargoSharks أرقام واتساب التجارية بقائمة الاستفسارات، فتصبح الرسالة استفساراً له مسؤول ومهلة والمحادثة كاملة مرفقة به.',
    },
    sections: [
      {
        eyebrow: { en: '01 · Intake', ar: '01 · الاستقبال' },
        heading: { en: 'How a message becomes an enquiry', ar: 'كيف تصبح الرسالة استفساراً' },
        points: [
          {
            label: { en: 'Each number belongs to a branch.', ar: 'لكل رقم فرع.' },
            body: {
              en: 'A message to a business number becomes an enquiry for that number’s branch, exactly as an email to a branch mailbox does.',
              ar: 'الرسالة إلى رقم تجاري تصبح استفساراً لفرع ذلك الرقم، تماماً كما يحدث مع البريد إلى صندوق الفرع.',
            },
          },
          {
            label: { en: 'The sender is matched.', ar: 'المرسل يُعرَف.' },
            body: {
              en: 'The phone number is matched to a customer you already hold, and a follow-up message joins the enquiry it is about rather than opening a new one.',
              ar: 'يُطابَق رقم الهاتف مع عميل مسجّل لديكم، والرسالة اللاحقة تنضم إلى الاستفسار الذي تخصه بدل فتح استفسار جديد.',
            },
          },
          {
            label: { en: 'One queue, one clock.', ar: 'قائمة واحدة، وعدّاد واحد.' },
            body: {
              en: 'WhatsApp and email enquiries sit in the same list with an owner and a response deadline, so how long you take to answer is measured, whichever channel it came on.',
              ar: 'استفسارات واتساب والبريد في القائمة نفسها بمسؤول ومهلة للرد، فيُقاس وقت ردكم أياً كانت القناة.',
            },
          },
          {
            label: { en: 'Photos and PDFs are read.', ar: 'الصور وملفات PDF تُقرأ.' },
            body: {
              en: 'A packing list sent as a photo or a PDF is read with the conversation, not left as an attachment nobody opened.',
              ar: 'قائمة التعبئة المرسلة صورةً أو PDF تُقرأ مع المحادثة، ولا تبقى مرفقاً لم يفتحه أحد.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · The assistant', ar: '02 · المساعد' },
        heading: { en: 'An assistant that knows when to stay quiet', ar: 'مساعد يعرف متى يصمت' },
        lead: {
          en: 'Customers send an enquiry in five short messages. The assistant waits until they stop typing, two minutes by default on WhatsApp, then reads the whole conversation once.',
          ar: 'يرسل العملاء الاستفسار في خمس رسائل قصيرة. ينتظر المساعد حتى يتوقفوا عن الكتابة، دقيقتين افتراضياً على واتساب، ثم يقرأ المحادثة كاملة مرة واحدة.',
        },
        points: [
          {
            label: { en: 'Proposes, does not decide.', ar: 'يقترح ولا يقرّر.' },
            body: {
              en: 'What it understood (parties, lane, cargo, dates) is laid out as proposals your coordinator accepts or rejects.',
              ar: 'ما فهمه من أطراف ومسار وبضاعة وتواريخ يُعرض مقترحات يقبلها المنسق أو يرفضها.',
            },
          },
          {
            label: { en: 'Asks once, in their language.', ar: 'يسأل مرة، بلغة العميل.' },
            body: {
              en: 'If a weight or a ready date is missing, it asks the customer once, in the language they wrote in, and confirms once when the enquiry is complete.',
              ar: 'إن نقص الوزن أو تاريخ الجاهزية يسأل العميل مرة واحدة باللغة التي كتب بها، ويؤكد مرة واحدة حين يكتمل الاستفسار.',
            },
          },
          {
            label: { en: 'Goes quiet.', ar: 'يصمت.' },
            body: {
              en: 'The moment one of your people replies, including from the business number’s own inbox, it stops. It also ignores chit-chat and auto-replies, and records why it stayed silent.',
              ar: 'حالما يردّ أحد موظفيكم، حتى من صندوق الرقم التجاري نفسه، يتوقف. ويتجاهل الدردشة العابرة والردود الآلية، ويسجّل سبب صمته.',
            },
          },
          {
            label: { en: 'Off until you switch it on.', ar: 'معطّل حتى تفعّلوه.' },
            body: {
              en: 'It ships switched off, and you turn it on branch by branch.',
              ar: 'يأتي معطّلاً، وتفعّلونه فرعاً فرعاً.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '03 · The reply', ar: '03 · الرد' },
        heading: { en: 'From the thread to the quote', ar: 'من المحادثة إلى عرض السعر' },
        lead: {
          en: 'Your team reads the whole thread on the enquiry and replies to the customer from there, on the channel the customer used. The enquiry prices from your own rate cards like any other, so a WhatsApp enquiry and an emailed one end in the same quotation.',
          ar: 'يقرأ فريقكم المحادثة كاملة على الاستفسار ويردّ على العميل من هناك، على القناة التي استخدمها. ويُسعَّر الاستفسار من بطاقات أسعاركم كأي استفسار آخر، فينتهي استفسار واتساب والاستفسار البريدي إلى عرض السعر نفسه.',
        },
      },
    ],
    shot: {
      file: 'enquiries',
      alt: {
        en: 'The enquiry queue: every enquiry with an owner, a status and a response deadline',
        ar: 'قائمة الاستفسارات: كل استفسار بمسؤول وحالة ومهلة للرد',
      },
      look: {
        en: 'The queue a WhatsApp message lands in: the same list, the same owner and the same deadline as an emailed enquiry.',
        ar: 'القائمة التي تصل إليها رسالة واتساب: القائمة نفسها والمسؤول نفسه والمهلة نفسها كما في الاستفسار البريدي.',
      },
    },
    limits: {
      heading: { en: 'The limits, most of them Meta’s', ar: 'الحدود، ومعظمها من Meta' },
      lead: {
        en: 'WhatsApp is in the product for enquiries. This is what it does not do.',
        ar: 'واتساب موجود في المنتج للاستفسارات. وهذا ما لا يفعله.',
      },
      items: [
        LIMIT.whatsappWindow,
        {
          label: { en: 'WhatsApp notifications', ar: 'إشعارات واتساب' },
          body: {
            en: 'Shipment updates, document releases and invoice reminders go by email, not WhatsApp.',
            ar: 'تحديثات الشحنات والإفراج عن المستندات وتذكيرات الفواتير تُرسل بالبريد لا عبر واتساب.',
          },
        },
        {
          label: { en: 'Personal numbers', ar: 'الأرقام الشخصية' },
          body: {
            en: 'Only WhatsApp business numbers on Meta’s business platform can be connected, not a personal WhatsApp account on a phone.',
            ar: 'لا يُربط إلا أرقام واتساب للأعمال على منصة Meta للأعمال، لا حساب واتساب شخصي على هاتف.',
          },
        },
      ],
    },
    faq: [
      {
        q: { en: 'Does it answer our WhatsApp?', ar: 'هل يردّ على واتساب الخاص بنا؟' },
        a: {
          en: 'Yes, on the WhatsApp business numbers you connect, each bound to a branch. A customer’s message becomes an enquiry; the assistant asks for anything missing and stops the moment your team replies. It is off until you switch it on.',
          ar: 'نعم، على أرقام واتساب للأعمال التي تربطونها، كل رقم لفرع. تصبح رسالة العميل استفساراً، ويسأل المساعد عن الناقص ويتوقف حالما يردّ فريقكم. وهو معطّل حتى تفعّلوه.',
        },
      },
      {
        q: { en: 'Can it message a customer days later?', ar: 'هل يستطيع مراسلة العميل بعد أيام؟' },
        a: {
          en: 'No. Meta allows a free reply within 24 hours of the customer’s last message. Starting a conversation after that needs an approved template, which is not sent yet.',
          ar: 'لا. تسمح Meta بالرد المجاني خلال 24 ساعة من آخر رسالة للعميل. وبدء محادثة بعدها يحتاج قالباً معتمداً، وهذا لا يُرسل بعد.',
        },
      },
      {
        q: { en: 'Does the assistant reply in Arabic?', ar: 'هل يردّ المساعد بالعربية؟' },
        a: {
          en: 'It replies in the language the customer wrote in, Arabic or English.',
          ar: 'يردّ باللغة التي كتب بها العميل، العربية أو الإنجليزية.',
        },
      },
      {
        q: { en: 'Will it send quotes on its own?', ar: 'هل يرسل عروض الأسعار وحده؟' },
        a: {
          en: 'No. It can prepare a draft quotation when that is switched on, but a person reviews and sends every quotation.',
          ar: 'لا. يستطيع إعداد مسودة عرض متى فُعّل ذلك، لكن شخصاً يراجع كل عرض ويرسله.',
        },
      },
      {
        q: {
          en: 'Can several branches have their own numbers?',
          ar: 'هل يمكن أن يكون لكل فرع رقمه؟',
        },
        a: {
          en: 'Yes. Each business number is mapped to one branch, and that branch’s team sees and answers its enquiries.',
          ar: 'نعم. كل رقم تجاري مرتبط بفرع واحد، وفريق ذلك الفرع يرى استفساراته ويردّ عليها.',
        },
      },
    ],
    related: [
      'freight-quotation-software',
      'freight-forwarding-software-uae',
      'freight-forwarding-software-kuwait',
      'shipment-tracking-portal',
      '/compare/spreadsheets/',
    ],
  },

  // ─────────────────────────────────────────────────────────── Customs ──
  {
    slug: 'customs-clearance-software',
    meta: {
      title: {
        en: 'Customs clearance tracking software | CargoSharks',
        ar: 'برنامج تخليص جمركي لمتابعة البيانات | CargoSharks',
      },
      description: {
        en: 'Every customs declaration on one board, ordered by the deadline that closes first: status, duty, broker, holds, and a duty estimate before your broker files.',
        ar: 'تابعوا كل بيان جمركي حسب مهلة التخليص الأقرب: الحالة والرسوم والمخلّص والحجز والمعاينة، مع تقدير للرسوم قبل التقديم. ويبقى التقديم لدى مخلّصكم.',
      },
    },
    kicker: { en: 'Customs clearance', ar: 'التخليص الجمركي' },
    title: {
      en: 'Customs clearance tracking for forwarders and brokers',
      ar: 'متابعة التخليص الجمركي لشركات الشحن والمخلّصين',
    },
    lede: {
      en: 'A held container costs money every day it sits in the yard. CargoSharks puts every declaration on one board, ordered by the clearance deadline that closes first, so the next problem is at the top. It tracks clearance; it does not file to customs systems, and it says so.',
      ar: 'الحاوية المحجوزة تكلّف مالاً كل يوم تبقى فيه في الساحة. يضع CargoSharks كل البيانات على لوحة واحدة، مرتبة حسب مهلة التخليص الأقرب، فتكون المشكلة التالية في الأعلى. هو يتابع التخليص ولا يقدّم البيانات إلى أنظمة الجمارك، ويقول ذلك صراحة.',
    },
    sections: [
      {
        eyebrow: { en: '01 · The board', ar: '01 · اللوحة' },
        heading: {
          en: 'Every declaration, and the clock it runs against',
          ar: 'كل بيان، والعدّاد الذي يسابقه',
        },
        points: [
          {
            label: { en: 'Ordered by deadline.', ar: 'مرتبة حسب المهلة.' },
            body: {
              en: 'Not newest first and not by reference: by which clearance deadline expires soonest.',
              ar: 'لا الأحدث أولاً ولا حسب الرقم، بل حسب مهلة التخليص الأقرب انتهاءً.',
            },
          },
          {
            label: { en: 'Status through to release.', ar: 'الحالة حتى الإفراج.' },
            body: {
              en: 'Documents pending, declaration filed, assessed, duty paid, inspection, held, released, with declaration type and number, broker and duty on each row.',
              ar: 'بانتظار المستندات، ثم تقديم البيان، والتقييم، ودفع الرسوم، والمعاينة، والحجز، والإفراج، مع نوع البيان ورقمه والمخلّص والرسوم في كل سطر.',
            },
          },
          {
            label: { en: 'Holds on the board.', ar: 'الحجز على اللوحة.' },
            body: {
              en: 'Held and inspection-required are counted at the top, because those are the two that mean somebody must act.',
              ar: 'المحجوز وما يتطلب معاينة يُعدّان في الأعلى، لأنهما الحالتان اللتان تعنيان أن على أحد أن يتصرف.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · Duty', ar: '02 · الرسوم' },
        heading: {
          en: 'The duty estimate, before the declaration goes in',
          ar: 'تقدير الرسوم قبل تقديم البيان',
        },
        lead: {
          en: 'A duty estimate from the tariff table is on the job before filing, so the customer hears the number from you rather than from the assessment. The customs pack, a PDF in Arabic or English generated from the job, carries it.',
          ar: 'تقدير الرسوم من جدول التعرفة موجود على الشحنة قبل التقديم، فيسمع العميل الرقم منكم لا من التقييم. وتحمله حزمة التخليص، وهي ملف PDF بالعربية أو الإنجليزية يصدر من بيانات الشحنة.',
        },
      },
      {
        eyebrow: { en: '03 · The broker', ar: '03 · المخلّص' },
        heading: {
          en: 'A role for the broker, and only what it needs',
          ar: 'دور للمخلّص، وما يحتاجه فقط',
        },
        lead: {
          en: 'The customs broker role records and updates declarations, records duty paid and updates the shipment fields clearance depends on. It cannot price, invoice or close a job, which also means nothing else can go wrong under that account. Clearance milestones sit on the same job file as the free-time clocks, so a slow release shows up as the demurrage it is causing.',
          ar: 'دور المخلّص الجمركي يسجّل البيانات ويحدّثها، ويسجّل الرسوم المدفوعة، ويحدّث حقول الشحنة التي يعتمد عليها التخليص. ولا يستطيع التسعير أو الفوترة أو إغلاق الشحنة، فلا يمكن أن يتعطل شيء آخر تحت هذا الحساب. ومراحل التخليص على ملف الشحنة نفسه مع عدّادات وقت السماح، فيظهر الإفراج البطيء على حقيقته: أرضيات تتراكم.',
        },
      },
    ],
    figure: 'accrual',
    limits: {
      heading: { en: 'What it does not do', ar: 'ما لا يفعله' },
      lead: {
        en: 'We would rather say this than imply otherwise.',
        ar: 'نفضّل أن نقول هذا على أن نوحي بغيره.',
      },
      items: [
        {
          label: { en: 'Filing to customs systems', ar: 'التقديم إلى أنظمة الجمارك' },
          body: {
            en: 'Declarations are not filed to MicroClear in Kuwait, to the UAE customs systems or to the Saudi customs platform. Your broker files; the system tracks.',
            ar: 'لا تُقدَّم البيانات إلى مايكروكلير في الكويت ولا إلى أنظمة الجمارك الإماراتية ولا إلى منصة الجمارك السعودية. يقدّم مخلّصكم، ويتابع النظام.',
          },
        },
        {
          label: { en: 'Advance cargo filing (MPCI)', ar: 'التصريح المسبق عن البضائع (MPCI)' },
          body: {
            en: 'UAE pre-load cargo information filing is not supported.',
            ar: 'تقديم معلومات البضائع قبل التحميل في الإمارات غير مدعوم.',
          },
        },
        {
          label: { en: 'Tariff classification', ar: 'التصنيف الجمركي' },
          body: {
            en: 'The duty estimate uses the tariff table you hold. It does not classify goods for you.',
            ar: 'تقدير الرسوم يستخدم جدول التعرفة الموجود لديكم، ولا يصنّف البضائع نيابة عنكم.',
          },
        },
      ],
    },
    faq: [
      {
        q: { en: 'Do you file customs declarations?', ar: 'هل تقدّمون البيانات الجمركية؟' },
        a: {
          en: 'No. We track them across the whole clearance lifecycle (type, number, status, duty, broker and clearance deadline) and estimate the duty before the declaration goes in. We do not file to customs single windows, including MicroClear in Kuwait.',
          ar: 'لا. نتابعها طوال دورة التخليص (النوع والرقم والحالة والرسوم والمخلّص ومهلة التخليص) ونقدّر الرسوم قبل تقديم البيان. ولا نقدّم إلى منصات الجمارك الموحدة، ومنها مايكروكلير في الكويت.',
        },
      },
      {
        q: { en: 'Can an outside broker use it?', ar: 'هل يستطيع مخلّص خارجي استخدامه؟' },
        a: {
          en: 'Yes. The customs broker role is deliberately narrow: declarations, duty paid and the shipment fields clearance depends on, in the branches it is given.',
          ar: 'نعم. دور المخلّص الجمركي ضيق عن قصد: البيانات والرسوم المدفوعة وحقول الشحنة التي يعتمد عليها التخليص، في الفروع المسندة إليه.',
        },
      },
      {
        q: { en: 'How is the duty estimate worked out?', ar: 'كيف يُحسب تقدير الرسوم؟' },
        a: {
          en: 'From the tariff table held in the system, against the goods on the job, before the declaration is filed. It is an estimate; the assessment is the authority’s.',
          ar: 'من جدول التعرفة المحفوظ في النظام، على البضاعة المسجلة في الشحنة، قبل تقديم البيان. وهو تقدير، والتقييم للجهة الجمركية.',
        },
      },
      {
        q: {
          en: 'Does a customs hold affect demurrage?',
          ar: 'هل يؤثر الحجز الجمركي على الأرضيات؟',
        },
        a: {
          en: 'It is on the same file. The free-time clocks run per container regardless of customs status, so a container held past its free days writes its own charge line and you see both on one screen.',
          ar: 'هما على الملف نفسه. عدّادات وقت السماح تعمل لكل حاوية أياً كانت حالة التخليص، فالحاوية المحجوزة بعد أيام السماح تكتب بند تكلفتها بنفسها وترون الأمرين على شاشة واحدة.',
        },
      },
    ],
    related: [
      'freight-forwarding-software-kuwait',
      'arabic-freight-documents',
      'shipment-tracking-portal',
      'freight-invoicing-software',
      '/what-we-do/',
    ],
  },

  // ────────────────────────────────────────────────────────── Tracking ──
  {
    slug: 'shipment-tracking-portal',
    meta: {
      title: {
        en: 'Shipment tracking portal for your customers | CargoSharks',
        ar: 'بوابة تتبع الشحنات لعملائكم | CargoSharks',
      },
      description: {
        en: 'A public tracking page and customer portal under your brand, in Arabic and English: milestones, released documents, quotes to accept and invoices to pay.',
        ar: 'صفحة تتبع عامة وبوابة عملاء تحت علامتكم التجارية، بالعربية والإنجليزية: المراحل والمستندات المُفرج عنها وعروض الأسعار للقبول والفواتير للسداد.',
      },
    },
    kicker: { en: 'Tracking and the customer portal', ar: 'التتبع وبوابة العملاء' },
    title: {
      en: 'A tracking page and customer portal under your own brand',
      ar: 'صفحة تتبع وبوابة عملاء تحت علامتكم التجارية',
    },
    lede: {
      en: 'Your customers find out where their container is by ringing someone who has to go and find out. CargoSharks gives them a tracking page that needs no account and a portal for everything else, both in Arabic, both showing only what you have released.',
      ar: 'يعرف عملاؤكم مكان حاويتهم بالاتصال بشخص عليه أن يذهب ويبحث. يمنحهم CargoSharks صفحة تتبع لا تحتاج حساباً وبوابة لكل ما عدا ذلك، وكلاهما بالعربية، ولا يعرضان إلا ما أفرجتم عنه.',
    },
    sections: [
      {
        eyebrow: { en: '01 · Tracking', ar: '01 · التتبع' },
        heading: { en: 'A public tracking page, safely', ar: 'صفحة تتبع عامة، بأمان' },
        points: [
          {
            label: { en: 'Two identifiers.', ar: 'معرّفان.' },
            body: {
              en: 'A reference alone is guessable, so the page also asks for a bill of lading, booking, customer reference or container number from the same shipment. A wrong one looks exactly like a wrong reference.',
              ar: 'رقم الشحنة وحده يمكن تخمينه، لذلك تطلب الصفحة أيضاً رقم بوليصة أو حجز أو مرجع العميل أو رقم حاوية من الشحنة نفسها. والخطأ فيه يبدو تماماً كالخطأ في رقم الشحنة.',
            },
          },
          {
            label: { en: 'Only what is meant to be seen.', ar: 'لا يظهر إلا المقصود.' },
            body: {
              en: 'Released documents and customer-visible milestones only. Buy rates, margins, internal notes and drafts are never selected, rather than filtered out afterwards.',
              ar: 'المستندات المُفرج عنها والمراحل المتاحة للعميل فقط. أما أسعار الشراء والهوامش والملاحظات الداخلية والمسودات فلا تُستدعى أصلاً، لا تُحجب لاحقاً.',
            },
          },
          {
            label: { en: 'No account needed.', ar: 'بلا حساب.' },
            body: {
              en: 'Your customer can send the link to their own customer.',
              ar: 'يستطيع عميلكم إرسال الرابط إلى عميله.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · The portal', ar: '02 · البوابة' },
        heading: { en: 'Everything else, behind a sign-in', ar: 'كل ما عدا ذلك، بعد تسجيل الدخول' },
        points: [
          {
            label: { en: 'Quotations.', ar: 'عروض الأسعار.' },
            body: {
              en: 'Accept or decline online. Acceptance opens the job on your side with the rates attached.',
              ar: 'القبول أو الرفض عبر الإنترنت. والقبول يفتح الشحنة لديكم والأسعار مرفقة بها.',
            },
          },
          {
            label: { en: 'Shipments.', ar: 'الشحنات.' },
            body: {
              en: 'Their own shipments, milestones and released documents, and nobody else’s.',
              ar: 'شحناتهم ومراحلها ومستنداتها المُفرج عنها، دون شحنات غيرهم.',
            },
          },
          {
            label: { en: 'Invoices.', ar: 'الفواتير.' },
            body: {
              en: 'Their invoices and what they owe, so the balance question is answered before the call.',
              ar: 'فواتيرهم والمبالغ المستحقة عليهم، فيُجاب سؤال الرصيد قبل الاتصال.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '03 · Updates', ar: '03 · التحديثات' },
        heading: { en: 'Told, rather than asking', ar: 'يُبلَّغون بدل أن يسألوا' },
        lead: {
          en: 'Customers are emailed when a shipment is booked, when a milestone is reached, when the estimated arrival moves, when a document is released and when an invoice is issued or overdue, from templates in Arabic and English that your administrator edits. Milestones come from your team, kept as planned, revised and actual, or from Maersk, Hapag-Lloyd and CMA CGM once your own carrier credentials are connected.',
          ar: 'يتلقى العملاء بريداً حين تُحجز الشحنة، وحين تبلغ مرحلة، وحين يتغير موعد الوصول المتوقع، وحين يُفرج عن مستند، وحين تصدر فاتورة أو تتأخر، من قوالب بالعربية والإنجليزية يعدّلها مسؤول النظام. والمراحل يُدخلها فريقكم بالمخطط والمعدّل والفعلي، أو تأتي من ميرسك وهاباغ لويد وسي إم إيه سي جي إم متى رُبطت بيانات الناقل الخاصة بكم.',
        },
      },
      {
        eyebrow: { en: '04 · Your brand', ar: '04 · علامتكم' },
        heading: { en: 'No supplier badge anywhere', ar: 'لا شارة مورّد في أي مكان' },
        lead: {
          en: 'No colour, logo or company name is written into the product. The tracking page, the portal and every email carry your name, on your domain.',
          ar: 'لا لون ولا شعار ولا اسم شركة مكتوب في المنتج. صفحة التتبع والبوابة وكل رسالة بريد تحمل اسمكم، على نطاقكم.',
        },
      },
    ],
    figure: 'milestones',
    limits: {
      heading: { en: 'What it does not do', ar: 'ما لا يفعله' },
      lead: {
        en: 'The gaps a customer would notice.',
        ar: 'الثغرات التي قد يلاحظها العميل.',
      },
      items: [
        LIMIT.carrierTracking,
        {
          label: { en: 'WhatsApp updates', ar: 'تحديثات واتساب' },
          body: {
            en: 'Shipment updates go by email, not WhatsApp.',
            ar: 'تحديثات الشحنات تُرسل بالبريد لا عبر واتساب.',
          },
        },
        {
          label: { en: 'Native mobile apps', ar: 'تطبيقات الجوال' },
          body: {
            en: 'The portal and tracking page work in a phone browser; there is no app to install.',
            ar: 'البوابة وصفحة التتبع تعملان في متصفح الهاتف، ولا يوجد تطبيق للتثبيت.',
          },
        },
        {
          label: { en: 'Agent portal', ar: 'بوابة الوكلاء' },
          body: {
            en: 'The portal for your overseas agents is in delivery and not complete.',
            ar: 'بوابة وكلائكم في الخارج قيد التسليم ولم تكتمل بعد.',
          },
        },
      ],
    },
    faq: [
      {
        q: { en: 'Do customers need an account to track?', ar: 'هل يحتاج العملاء حساباً للتتبع؟' },
        a: {
          en: 'No. The tracking page needs the shipment reference and a second identifier from the same shipment, such as a container or bill of lading number. The portal, with quotations and invoices, needs a sign-in.',
          ar: 'لا. صفحة التتبع تحتاج رقم الشحنة ومعرّفاً ثانياً من الشحنة نفسها، مثل رقم الحاوية أو البوليصة. أما البوابة بعروض أسعارها وفواتيرها فتحتاج تسجيل دخول.',
        },
      },
      {
        q: { en: 'Is it in Arabic?', ar: 'هل هي بالعربية؟' },
        a: {
          en: 'Yes. The tracking page, the portal and the emails exist in Arabic and English, laid out right to left in Arabic.',
          ar: 'نعم. صفحة التتبع والبوابة ورسائل البريد موجودة بالعربية والإنجليزية، بتصميم من اليمين إلى اليسار بالعربية.',
        },
      },
      {
        q: { en: 'Is the tracking live from the carrier?', ar: 'هل التتبع مباشر من الناقل؟' },
        a: {
          en: 'It can be, for Maersk, Hapag-Lloyd and CMA CGM, once your own carrier API credentials are connected. Until then the milestones your team records are what the customer sees.',
          ar: 'يمكن ذلك مع ميرسك وهاباغ لويد وسي إم إيه سي جي إم متى رُبطت بيانات الناقل الخاصة بكم. وحتى ذلك الحين يرى العميل المراحل التي يسجلها فريقكم.',
        },
      },
      {
        q: { en: 'Can customers see our costs?', ar: 'هل يرى العملاء تكاليفنا؟' },
        a: {
          en: 'No. Buy rates, margins and internal notes are never selected for the customer’s view, and unreleased documents stay hidden until you release them.',
          ar: 'لا. أسعار الشراء والهوامش والملاحظات الداخلية لا تُستدعى أبداً لعرض العميل، والمستندات غير المُفرج عنها تبقى مخفية حتى تفرجوا عنها.',
        },
      },
      {
        q: { en: 'Can we try the tracking page?', ar: 'هل نستطيع تجربة صفحة التتبع؟' },
        a: {
          en: 'Yes. The demo carries the same tracking page, and its customer sign-in opens the portal as your customer would see it.',
          ar: 'نعم. النسخة التجريبية فيها صفحة التتبع نفسها، وحساب العميل فيها يفتح البوابة كما سيراها عميلكم.',
        },
      },
    ],
    related: [
      'arabic-freight-documents',
      'whatsapp-for-freight-forwarders',
      'freight-quotation-software',
      'freight-forwarding-software-uae',
      '/what-we-do/',
    ],
  },

  // ────────────────────────────────────────────────────────── Invoicing ──
  {
    slug: 'freight-invoicing-software',
    meta: {
      title: {
        en: 'Freight invoicing and supplier bill matching | CargoSharks',
        ar: 'برنامج فوترة الشحن ومطابقة فواتير المورّدين | CargoSharks',
      },
      description: {
        en: 'Invoice from the job’s own cost ledger, match supplier bills to what the job accrued before approval, and see receivables by age, per entity and currency.',
        ar: 'فوتروا من دفتر تكاليف الشحنة نفسه، وطابقوا فواتير المورّدين مع المستحق قبل الاعتماد، واطّلعوا على الذمم حسب التقادم. لكل كيان وعملة، وثلاث خانات للدينار.',
      },
    },
    kicker: { en: 'Freight invoicing', ar: 'فوترة الشحن' },
    title: {
      en: 'Freight invoicing that starts from the job’s own costs',
      ar: 'فوترة شحن تبدأ من تكاليف الشحنة نفسها',
    },
    lede: {
      en: 'Margin on a job is usually a number reconstructed at month-end from three sources that disagree. In CargoSharks, costs land against the job as they happen, supplier bills are matched to them before anyone approves, and the invoice is raised from the same ledger.',
      ar: 'هامش الشحنة عادة رقم يُعاد تركيبه آخر الشهر من ثلاثة مصادر لا تتفق. في CargoSharks تُقيَّد التكاليف على الشحنة حين تحدث، وتُطابَق فواتير المورّدين معها قبل أن يعتمدها أحد، وتصدر الفاتورة من الدفتر نفسه.',
    },
    sections: [
      {
        eyebrow: { en: '01 · Costing', ar: '01 · التكاليف' },
        heading: { en: 'Margin that is live, not annual', ar: 'هامش حيّ، لا سنوي' },
        points: [
          {
            label: { en: 'Every line against the job.', ar: 'كل بند على الشحنة.' },
            body: {
              en: 'Costs and revenue are recorded against the job, including the charge lines the free-time clocks write themselves.',
              ar: 'التكاليف والإيرادات تُقيَّد على الشحنة، ومنها بنود التكلفة التي تكتبها عدّادات وقت السماح بنفسها.',
            },
          },
          {
            label: { en: 'Unbilled revenue.', ar: 'الإيراد غير المفوتر.' },
            body: {
              en: 'What has been earned and not yet invoiced, by shipment, with one act to draft the invoice for it.',
              ar: 'ما استُحق ولم يُفوتر بعد، حسب الشحنة، مع إجراء واحد لصياغة فاتورته.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · Supplier bills', ar: '02 · فواتير المورّدين' },
        heading: {
          en: 'The argument with the agent, before the customer is invoiced',
          ar: 'النقاش مع الوكيل، قبل فوترة العميل',
        },
        points: [
          {
            label: { en: 'Read into lines.', ar: 'تُقرأ بنوداً.' },
            body: {
              en: 'An uploaded scan, or a bill emailed in by a partner you already know, is read into lines and matched against what the job accrued.',
              ar: 'الصورة الممسوحة المرفوعة، أو الفاتورة المرسلة بالبريد من شريك تعرفونه، تُقرأ بنوداً وتُطابَق مع ما استحق على الشحنة.',
            },
          },
          {
            label: { en: 'Variance on screen.', ar: 'الفرق على الشاشة.' },
            body: {
              en: 'The difference is a number on screen before anyone approves, and a line billed over the accrual tolerance raises an alert on its own.',
              ar: 'الفرق رقم على الشاشة قبل أن يعتمد أحد، والبند المفوتر فوق هامش التسامح مع المستحق يطلق تنبيهاً بنفسه.',
            },
          },
          {
            label: { en: 'Agents netted.', ar: 'حسابات الوكلاء بالصافي.' },
            body: {
              en: 'Agent accounts are netted period by period into one balance, rather than a receivable and a payable that never meet.',
              ar: 'حسابات الوكلاء تُصفّى فترة بفترة في رصيد واحد، بدل ذمة مدينة وأخرى دائنة لا تلتقيان.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '03 · Invoicing', ar: '03 · الفوترة' },
        heading: {
          en: 'Separated duties, per entity and currency',
          ar: 'مهام مفصولة، لكل كيان وعملة',
        },
        lead: {
          en: 'Invoices are raised per entity in the entity’s own currency, with tax treatment and rate per line, and move through draft, approved, issued, part-paid, paid and credited. Only Finance may issue, void or raise a credit note: an operations manager who can issue invoices is the segregation-of-duties failure an auditor asks about first.',
          ar: 'تصدر الفواتير لكل كيان بعملته، بمعالجة ضريبية ونسبة لكل بند، وتمر بمراحل المسودة والاعتماد والإصدار والسداد الجزئي والسداد والإشعار الدائن. ولا يُصدر الفاتورة أو يلغيها أو يُصدر إشعاراً دائناً إلا قسم المالية: فمدير العمليات القادر على إصدار الفواتير هو أول خلل في فصل المهام يسأل عنه المدقق.',
        },
      },
      {
        eyebrow: { en: '04 · Receivables', ar: '04 · الذمم المدينة' },
        heading: { en: 'What you are owed, and who to ring', ar: 'ما لكم، ومن تتصلون به' },
        lead: {
          en: 'Receivables grouped by age with the largest exposure first, receipts matched to invoices with a warning for unmatched money, and each customer’s standing checked against their credit limit when a shipment is booked. An override, when you give one, is recorded with who gave it and why. Customers see their own invoices and balance in the portal.',
          ar: 'الذمم المدينة مجمعة حسب التقادم والأكبر تعرضاً أولاً، والمقبوضات مطابقة مع الفواتير مع تنبيه للمبالغ غير المطابقة، ووضع كل عميل يُفحص مقابل حده الائتماني عند حجز الشحنة. والاستثناء، حين تمنحونه، يُسجَّل بمن منحه ولماذا. ويرى العملاء فواتيرهم ورصيدهم في البوابة.',
        },
      },
    ],
    figure: 'duty',
    shot: {
      file: 'finance',
      alt: {
        en: 'Receivables grouped by how late they are, largest exposure first',
        ar: 'الذمم المدينة مجمعة حسب تأخرها، والأكبر تعرضاً أولاً',
      },
      look: {
        en: 'Receivables in the demo, by age and largest exposure first: the screen that answers who to ring this morning.',
        ar: 'الذمم المدينة في النسخة التجريبية، حسب التقادم والأكبر تعرضاً أولاً: الشاشة التي تجيب عمّن تتصلون به هذا الصباح.',
      },
    },
    limits: {
      heading: { en: 'What it does not do', ar: 'ما لا يفعله' },
      lead: {
        en: 'Two gaps a finance team asks about early.',
        ar: 'ثغرتان يسأل عنهما فريق المالية مبكراً.',
      },
      items: [LIMIT.einvoice, LIMIT.accounting],
    },
    faq: [
      {
        q: { en: 'Can we keep our accounting package?', ar: 'هل نحتفظ ببرنامج المحاسبة لدينا؟' },
        a: {
          en: 'Yes. A journal of the period’s invoices, receipts, supplier bills and payments exports in a form your accountant can import. Posting it marks what it took, so nothing is exported twice.',
          ar: 'نعم. يُصدَّر قيد يومية بفواتير الفترة ومقبوضاتها وفواتير المورّدين والمدفوعات بصيغة يستوردها محاسبكم. وترحيله يعلّم ما شمله، فلا يُصدَّر شيء مرتين.',
        },
      },
      {
        q: { en: 'How are supplier bills matched?', ar: 'كيف تُطابَق فواتير المورّدين؟' },
        a: {
          en: 'The bill is read into lines and each line is compared with what the job accrued. The variance is shown before approval, and over-billing beyond the tolerance raises an alert.',
          ar: 'تُقرأ الفاتورة بنوداً ويُقارن كل بند بما استحق على الشحنة. ويظهر الفرق قبل الاعتماد، والفوترة الزائدة فوق هامش التسامح تطلق تنبيهاً.',
        },
      },
      {
        q: {
          en: 'Does it handle the Kuwaiti dinar properly?',
          ar: 'هل يتعامل مع الدينار الكويتي بشكل صحيح؟',
        },
        a: {
          en: 'Yes. Money is decimal throughout and rounds per currency at the line, so KWD keeps three decimal places on every invoice.',
          ar: 'نعم. المال عشري في كل مكان ويُقرَّب حسب العملة عند البند، فيحتفظ الدينار بثلاث خانات عشرية في كل فاتورة.',
        },
      },
      {
        q: {
          en: 'Can it issue UAE or Saudi e-invoices?',
          ar: 'هل يُصدر فواتير إلكترونية إماراتية أو سعودية؟',
        },
        a: {
          en: 'Not yet. Invoices carry tax treatment and rate per line, but the mandated e-invoice formats and their transmission are on the roadmap with no ship date.',
          ar: 'ليس بعد. الفواتير تحمل المعالجة الضريبية والنسبة لكل بند، لكن صيغ الفوترة الإلكترونية المطلوبة وإرسالها على خطة التطوير دون موعد إطلاق.',
        },
      },
      {
        q: { en: 'Who can issue an invoice?', ar: 'من يستطيع إصدار الفاتورة؟' },
        a: {
          en: 'Only the Finance role can issue, void or credit. Operations can see the job’s costs and margin but cannot issue.',
          ar: 'دور المالية وحده يستطيع الإصدار والإلغاء والإشعار الدائن. والعمليات ترى تكاليف الشحنة وهامشها لكنها لا تُصدر.',
        },
      },
    ],
    related: [
      'uae-e-invoicing-freight-forwarders',
      'freight-quotation-software',
      'freight-forwarding-software-kuwait',
      'customs-clearance-software',
      '/compare/spreadsheets/',
    ],
  },

  // ────────────────────────────────────────────────────────── Documents ──
  {
    slug: 'arabic-freight-documents',
    meta: {
      title: {
        en: 'Arabic bill of lading and delivery order | CargoSharks',
        ar: 'برنامج بوليصة شحن وأمر تسليم بالعربية | CargoSharks',
      },
      description: {
        en: 'Issue house bills of lading, air waybills, delivery orders and packing lists in Arabic or English from the shipment’s data, versioned and numbered per branch.',
        ar: 'أصدروا بوالص الشحن الفرعية وبوالص الشحن الجوي وأوامر التسليم وقوائم التعبئة وحزم التخليص بالعربية أو الإنجليزية من بيانات الشحنة نفسها، بإصدارات وترقيم لكل فرع.',
      },
    },
    kicker: { en: 'Freight documents in Arabic', ar: 'مستندات الشحن بالعربية' },
    title: {
      en: 'Freight documents in Arabic, issued from the shipment’s own data',
      ar: 'مستندات الشحن بالعربية، تصدر من بيانات الشحنة نفسها',
    },
    lede: {
      en: 'A coordinator issues several delivery orders a day, and in most offices every one is typed into Word. CargoSharks generates the house documents from the job file in Arabic or English, under the issuing branch’s name, so a document cannot disagree with the shipment it describes.',
      ar: 'يُصدر المنسق عدة أوامر تسليم يومياً، وفي معظم المكاتب يُكتب كل منها في وورد. يُنشئ CargoSharks مستندات الشحن الفرعية من ملف الشحنة بالعربية أو الإنجليزية، باسم الفرع المُصدِر، فلا يمكن أن يخالف المستند الشحنة التي يصفها.',
    },
    sections: [
      {
        eyebrow: { en: '01 · The set', ar: '01 · المجموعة' },
        heading: {
          en: 'The documents the job file writes itself',
          ar: 'المستندات التي يكتبها ملف الشحنة بنفسه',
        },
        points: [
          {
            label: { en: 'House bill of lading.', ar: 'بوليصة الشحن الفرعية.' },
            body: {
              en: 'The cargo description printed verbatim as the shipper declared it, originals as separate numbered sheets, the branch’s own terms on the reverse, an on-board notation a bank will accept, and a surrender stamp for telex release.',
              ar: 'وصف البضاعة مطبوع حرفياً كما صرّح به الشاحن، والأصول أوراق منفصلة مرقّمة، وشروط الفرع نفسه على الظهر، وتأشيرة الشحن على متن السفينة بصيغة يقبلها البنك، وختم التسليم للإفراج البرقي.',
            },
          },
          {
            label: { en: 'Delivery order.', ar: 'أمر التسليم.' },
            body: {
              en: 'With a validity date, seven days by default, and the release conditions printed every time: subject to payment of all charges, against surrender of the original bill.',
              ar: 'بتاريخ صلاحية، سبعة أيام افتراضياً، وشروط الإفراج مطبوعة في كل مرة: بعد سداد جميع الرسوم، ومقابل تسليم البوليصة الأصلية.',
            },
          },
          {
            label: { en: 'And the rest.', ar: 'وبقية المستندات.' },
            body: {
              en: 'House air waybill, packing list, customs pack with the duty estimate, and the consolidation manifest generated from the houses under a master.',
              ar: 'بوليصة الشحن الجوي الفرعية وقائمة التعبئة وحزمة التخليص مع تقدير الرسوم، وبيان التجميع الصادر من البوالص الفرعية تحت البوليصة الرئيسية.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '02 · Control', ar: '02 · الضبط' },
        heading: { en: 'A document cannot quietly change', ar: 'لا يتغير المستند بصمت' },
        points: [
          {
            label: { en: 'Numbered per branch.', ar: 'مرقّم لكل فرع.' },
            body: {
              en: 'Each document is numbered from the issuing branch’s own series. An unnumbered bill is watermarked as a draft, never quietly issued.',
              ar: 'كل مستند مرقّم من تسلسل الفرع المُصدِر. والبوليصة غير المرقّمة تحمل علامة مسودة، ولا تصدر بصمت أبداً.',
            },
          },
          {
            label: { en: 'Every issue is a version.', ar: 'كل إصدار نسخة.' },
            body: {
              en: 'Preview before issue. Reissuing makes a new version and the superseded one stays visible.',
              ar: 'معاينة قبل الإصدار. وإعادة الإصدار تُنشئ نسخة جديدة وتبقى النسخة السابقة ظاهرة.',
            },
          },
          {
            label: { en: 'Released per document.', ar: 'إفراج لكل مستند.' },
            body: {
              en: 'Released documents appear to the customer in the portal; drafts do not.',
              ar: 'المستندات المُفرج عنها تظهر للعميل في البوابة، والمسودات لا تظهر.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '03 · Language', ar: '03 · اللغة' },
        heading: { en: 'Arabic as a document, not a mirror', ar: 'العربية مستنداً، لا انعكاساً' },
        lead: {
          en: 'The Arabic documents use the same vocabulary as the Arabic interface, «بوليصة الشحن الفرعية» on the screen and on the paper, laid out right to left from the start. A mirrored English template reads as one in about four seconds.',
          ar: 'المستندات العربية تستخدم مفردات الواجهة العربية نفسها، «بوليصة الشحن الفرعية» على الشاشة وعلى الورق، بتصميم من اليمين إلى اليسار من البداية. فالقالب الإنجليزي المعكوس يُعرف خلال أربع ثوانٍ تقريباً.',
        },
      },
    ],
    figure: 'layered',
    shot: {
      file: 'arabic',
      noAr: true,
      alt: {
        en: 'The CargoSharks dashboard in Arabic, laid out right to left',
        ar: 'لوحة معلومات CargoSharks بالعربية، من اليمين إلى اليسار',
      },
      look: {
        en: 'The interface in Arabic. The documents issued from it use the same words.',
        ar: 'الواجهة بالعربية. والمستندات الصادرة منها تستخدم الكلمات نفسها.',
      },
    },
    limits: {
      heading: { en: 'What it does not issue', ar: 'ما لا يُصدره' },
      lead: {
        en: 'House documents are ours. Carrier documents are not.',
        ar: 'المستندات الفرعية لنا. ومستندات الناقل ليست لنا.',
      },
      items: [
        {
          label: { en: 'Master bills', ar: 'البوالص الرئيسية' },
          body: {
            en: 'A master bill is the carrier’s document, issued on the carrier’s stock. It is recorded on the job, not generated.',
            ar: 'البوليصة الرئيسية مستند الناقل، تصدر على نماذجه. تُسجَّل على الشحنة ولا تُنشأ.',
          },
        },
      ],
    },
    faq: [
      {
        q: {
          en: 'Can we issue a bill of lading in Arabic?',
          ar: 'هل نستطيع إصدار بوليصة شحن بالعربية؟',
        },
        a: {
          en: 'Yes. The house bill of lading, air waybill, delivery order, packing list, customs pack and manifest are generated in Arabic or English from the job data.',
          ar: 'نعم. بوليصة الشحن الفرعية وبوليصة الشحن الجوي وأمر التسليم وقائمة التعبئة وحزمة التخليص والبيان تصدر بالعربية أو الإنجليزية من بيانات الشحنة.',
        },
      },
      {
        q: { en: 'Whose letterhead is on them?', ar: 'ترويسة من تحمل؟' },
        a: {
          en: 'The issuing branch’s, with your entity’s name and your terms. There is no supplier name on any document.',
          ar: 'ترويسة الفرع المُصدِر، باسم كيانكم وشروطكم. ولا يظهر اسم المورّد على أي مستند.',
        },
      },
      {
        q: { en: 'What happens when a document is corrected?', ar: 'ماذا يحدث حين يُصحَّح مستند؟' },
        a: {
          en: 'It is reissued as a new version. The old version stays on the job, marked superseded, so what was sent can always be recovered.',
          ar: 'يُعاد إصداره نسخة جديدة. وتبقى النسخة القديمة على الشحنة معلّمة بأنها مستبدلة، فيمكن دائماً استرجاع ما أُرسل.',
        },
      },
      {
        q: { en: 'Does it support telex release?', ar: 'هل يدعم الإفراج البرقي؟' },
        a: {
          en: 'Yes. A surrendered bill prints no originals, and every copy carries the surrender stamp and date.',
          ar: 'نعم. البوليصة المسلَّمة لا تُطبع لها أصول، وكل نسخة تحمل ختم التسليم وتاريخه.',
        },
      },
    ],
    related: [
      'customs-clearance-software',
      'shipment-tracking-portal',
      'freight-forwarding-software-kuwait',
      'freight-forwarding-software-saudi-arabia',
      '/what-we-do/',
    ],
  },

  // ─────────────────────────────────────────────────── UAE e-invoicing ──
  {
    slug: 'uae-e-invoicing-freight-forwarders',
    meta: {
      title: {
        en: 'UAE e-invoicing for freight forwarders: PINT AE guide',
        ar: 'الفوترة الإلكترونية في الإمارات لشركات الشحن: دليل PINT AE',
      },
      description: {
        en: 'What UAE e-invoicing means for a freight forwarder: PINT AE over Peppol, accredited service providers, and the deadlines that start on 30 October 2026.',
        ar: 'ماذا تعني الفوترة الإلكترونية في الإمارات لشركة الشحن: صيغة PINT AE عبر Peppol، ومزوّدو الخدمة المعتمدون، والمواعيد بدءاً من 30 أكتوبر 2026.',
      },
    },
    kicker: { en: 'A guide for forwarders', ar: 'دليل لشركات الشحن' },
    title: {
      en: 'UAE e-invoicing for freight forwarders: what changes and when',
      ar: 'الفوترة الإلكترونية في الإمارات لشركات الشحن: ما الذي يتغير ومتى',
    },
    lede: {
      en: 'From 1 January 2027 the largest UAE businesses must issue B2B invoices as structured e-invoices exchanged through accredited service providers, and everyone else follows from 1 July 2027. This page sets out the dates, how the model works and what a forwarder should check now. It is a planning summary, not tax advice.',
      ar: 'اعتباراً من 1 يناير 2027 يجب على أكبر الشركات في الإمارات إصدار فواتير التعامل بين الشركات فواتير إلكترونية منظّمة تُتبادل عبر مزوّدي خدمة معتمدين، وتلحق بها البقية من 1 يوليو 2027. تعرض هذه الصفحة المواعيد وطريقة عمل النظام وما ينبغي لشركة الشحن مراجعته الآن. وهي ملخص للتخطيط لا استشارة ضريبية.',
    },
    sections: [
      {
        eyebrow: { en: '01 · The dates', ar: '01 · المواعيد' },
        heading: { en: 'Who must do what, and by when', ar: 'من يجب أن يفعل ماذا، ومتى' },
        lead: {
          en: 'Set by Ministerial Decision No. 244 of 2025. Decision No. 66 of 2026 moved the first appointment deadline from 31 July to 30 October 2026 and left the 1 January 2027 go-live where it was. A voluntary pilot with selected taxpayers began on 1 July 2026.',
          ar: 'حددها القرار الوزاري رقم 244 لسنة 2025. ونقل القرار رقم 66 لسنة 2026 أول موعد للتعيين من 31 يوليو إلى 30 أكتوبر 2026، وأبقى موعد التطبيق في 1 يناير 2027 كما هو. وبدأت مرحلة تجريبية مع دافعي ضرائب مختارين في 1 يوليو 2026.',
        },
        table: {
          head: [
            { en: 'Who', ar: 'الفئة' },
            { en: 'Appoint an ASP by', ar: 'تعيين مزوّد خدمة معتمد قبل' },
            { en: 'E-invoicing mandatory from', ar: 'الفوترة الإلكترونية إلزامية من' },
          ],
          rows: [
            [
              { en: 'Revenue of AED 50 million or more', ar: 'إيرادات 50 مليون درهم أو أكثر' },
              { en: '30 October 2026', ar: '30 أكتوبر 2026' },
              { en: '1 January 2027', ar: '1 يناير 2027' },
            ],
            [
              { en: 'Revenue below AED 50 million', ar: 'إيرادات أقل من 50 مليون درهم' },
              { en: '31 March 2027', ar: '31 مارس 2027' },
              { en: '1 July 2027', ar: '1 يوليو 2027' },
            ],
            [
              { en: 'Government entities in scope', ar: 'الجهات الحكومية المشمولة' },
              { en: '31 March 2027', ar: '31 مارس 2027' },
              { en: '1 October 2027', ar: '1 أكتوبر 2027' },
            ],
          ],
        },
      },
      {
        eyebrow: { en: '02 · The model', ar: '02 · النموذج' },
        heading: {
          en: 'Structured data, through accredited providers',
          ar: 'بيانات منظّمة، عبر مزوّدين معتمدين',
        },
        points: [
          {
            label: { en: 'PINT AE.', ar: 'PINT AE.' },
            body: {
              en: 'The invoice is a structured document in PINT AE, the UAE’s version of the Peppol International invoice specification, rather than a PDF. A PDF can still travel alongside as a readable copy.',
              ar: 'الفاتورة مستند منظّم بصيغة PINT AE، وهي النسخة الإماراتية من مواصفة فاتورة Peppol الدولية، لا ملف PDF. ويمكن أن يرافقها ملف PDF نسخةً مقروءة.',
            },
          },
          {
            label: { en: 'Five corners.', ar: 'خمسة أطراف.' },
            body: {
              en: 'The supplier sends through its accredited service provider (ASP) to the buyer’s ASP and on to the buyer, and the tax data is reported to the Federal Tax Authority on the way.',
              ar: 'يرسل المورّد عبر مزوّد الخدمة المعتمد لديه إلى مزوّد المشتري ثم إلى المشتري، وتُبلَّغ البيانات الضريبية إلى الهيئة الاتحادية للضرائب في الطريق.',
            },
          },
          {
            label: { en: 'B2B and B2G.', ar: 'بين الشركات ومع الحكومة.' },
            body: {
              en: 'The mandate covers business-to-business and business-to-government transactions, with certain exclusions. Business-to-consumer is not in the announced scope.',
              ar: 'يشمل الإلزام التعاملات بين الشركات ومع الجهات الحكومية، مع استثناءات محددة. أما التعامل مع المستهلكين فليس ضمن النطاق المعلن.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '03 · For a forwarder', ar: '03 · لشركة الشحن' },
        heading: { en: 'What to check before your date', ar: 'ما يجب مراجعته قبل موعدكم' },
        points: [
          {
            label: { en: 'Your band.', ar: 'فئتكم.' },
            body: {
              en: 'Work out which revenue band you are in. For a forwarder with AED 50 million or more, the provider has to be appointed by 30 October 2026.',
              ar: 'حددوا فئة إيراداتكم. فشركة الشحن التي تبلغ إيراداتها 50 مليون درهم أو أكثر يجب أن تعيّن مزوّدها قبل 30 أكتوبر 2026.',
            },
          },
          {
            label: { en: 'Tax per line, not per invoice.', ar: 'الضريبة لكل بند لا لكل فاتورة.' },
            body: {
              en: 'A forwarding invoice usually mixes treatments, for example international freight alongside standard-rated local charges and disbursements. Whatever produces the e-invoice has to know the treatment of every line.',
              ar: 'فاتورة الشحن تخلط عادة بين المعالجات، مثل الشحن الدولي إلى جانب رسوم محلية بالنسبة القياسية ومصاريف مدفوعة نيابة عن العميل. وأي نظام يُنشئ الفاتورة الإلكترونية يجب أن يعرف معالجة كل بند.',
            },
          },
          {
            label: { en: 'Buyer data.', ar: 'بيانات المشتري.' },
            body: {
              en: 'Customer tax registration numbers and Peppol identifiers have to be held and correct before the first invoice goes out.',
              ar: 'أرقام التسجيل الضريبي للعملاء ومعرّفات Peppol يجب أن تكون محفوظة وصحيحة قبل خروج أول فاتورة.',
            },
          },
          {
            label: { en: 'Credit notes too.', ar: 'والإشعارات الدائنة أيضاً.' },
            body: {
              en: 'Credit notes travel the same route, so the process that corrects an invoice has to produce a structured credit note, not a manual adjustment.',
              ar: 'الإشعارات الدائنة تسلك الطريق نفسه، فالإجراء الذي يصحح الفاتورة يجب أن ينتج إشعاراً دائناً منظّماً لا تعديلاً يدوياً.',
            },
          },
        ],
      },
      {
        eyebrow: { en: '04 · Where CargoSharks stands', ar: '04 · أين يقف CargoSharks' },
        heading: { en: 'On the roadmap, with no ship date', ar: 'على خطة التطوير، دون موعد إطلاق' },
        lead: {
          en: 'CargoSharks does not issue UAE e-invoices today, and we will not give a date we cannot keep. What exists: each invoice line already carries its tax treatment and rate, per entity and currency, and the hand-off to an accredited provider is built into the service but not switched on. What remains is generating the PINT AE document and connecting a contracted provider. We are not an ASP and do not plan to become one. Until it ships, issue e-invoices from your accounting system or your provider’s portal, and use the journal export to carry CargoSharks invoices into it.',
          ar: 'لا يُصدر CargoSharks فواتير إلكترونية إماراتية اليوم، ولن نعطي موعداً لا نستطيع الوفاء به. الموجود: كل بند في الفاتورة يحمل معالجته الضريبية ونسبته، لكل كيان وعملة، والربط مع مزوّد معتمد مبنيّ في الخدمة لكنه غير مفعّل. والمتبقي: إنشاء مستند PINT AE وربط مزوّد متعاقد معه. لسنا مزوّد خدمة معتمداً ولا ننوي أن نكون. وإلى أن يُطلق، أصدروا الفواتير الإلكترونية من نظامكم المحاسبي أو من بوابة مزوّدكم، واستخدموا تصدير القيود لنقل فواتير CargoSharks إليه.',
        },
      },
    ],
    sources: [
      {
        label:
          'UAE Ministry of Finance, announcement of the e-invoicing decisions and timelines (29 September 2025)',
        url: 'https://mof.gov.ae/en/news/ministry-of-finance-announces-the-issuance-of-two-ministerial-decisions-on-the-scope-of-obligations-and-the-timelines-for-implementing-the-electronic-invoicing-system-2/',
      },
      {
        label:
          'Ministerial Decision No. 66 of 2026, amending Decision No. 244 of 2025 (ASP deadline moved to 30 October 2026)',
        url: 'https://mof.gov.ae/wp-content/uploads/2026/05/Ministerial-Resolution-No.-66-of-2026-Amending-Certain-Provisions-of-Ministerial-Resolution-No.-244-of-2025-Regarding-the-Implementation-of-the-Electronic-Invoicing-System-En-20260514.pdf',
      },
    ],
    checked: '5 October 2026',
    limits: {
      heading: { en: 'What CargoSharks does not do here', ar: 'ما لا يفعله CargoSharks هنا' },
      lead: {
        en: 'Stated as plainly as the dates above.',
        ar: 'بالوضوح نفسه الذي كُتبت به المواعيد أعلاه.',
      },
      items: [
        {
          label: { en: 'PINT AE documents', ar: 'مستندات PINT AE' },
          body: {
            en: 'Not generated. On the roadmap with no ship date.',
            ar: 'لا تُنشأ. على خطة التطوير دون موعد إطلاق.',
          },
        },
        {
          label: { en: 'Transmission through an ASP', ar: 'الإرسال عبر مزوّد معتمد' },
          body: {
            en: 'The connection is built but not switched on, and no provider is contracted.',
            ar: 'الربط مبنيّ لكنه غير مفعّل، ولا يوجد مزوّد متعاقد معه.',
          },
        },
        {
          label: { en: 'Being an ASP', ar: 'أن نكون مزوّداً معتمداً' },
          body: {
            en: 'We are not one and will not be. You will always need your own accredited provider.',
            ar: 'لسنا كذلك ولن نكون. ستحتاجون دائماً إلى مزوّدكم المعتمد.',
          },
        },
      ],
    },
    faq: [
      {
        q: {
          en: 'When does UAE e-invoicing become mandatory for a freight forwarder?',
          ar: 'متى تصبح الفوترة الإلكترونية إلزامية على شركة الشحن في الإمارات؟',
        },
        a: {
          en: 'It depends on revenue. With AED 50 million or more, appoint an accredited service provider by 30 October 2026 and issue e-invoices from 1 January 2027. Below that, appoint by 31 March 2027 and start on 1 July 2027.',
          ar: 'حسب الإيرادات. من تبلغ إيراداته 50 مليون درهم أو أكثر يعيّن مزوّد خدمة معتمداً قبل 30 أكتوبر 2026 ويُصدر الفواتير الإلكترونية من 1 يناير 2027. ومن هو دون ذلك يعيّن قبل 31 مارس 2027 ويبدأ في 1 يوليو 2027.',
        },
      },
      {
        q: { en: 'What is PINT AE?', ar: 'ما هي صيغة PINT AE؟' },
        a: {
          en: 'The UAE’s specification for structured e-invoices, built on the Peppol International (PINT) invoice standard. In-scope invoices are exchanged in this format between accredited service providers.',
          ar: 'المواصفة الإماراتية للفواتير الإلكترونية المنظّمة، المبنية على معيار فاتورة Peppol الدولية (PINT). وتُتبادل الفواتير المشمولة بهذه الصيغة بين مزوّدي الخدمة المعتمدين.',
        },
      },
      {
        q: { en: 'What is an ASP?', ar: 'ما هو مزوّد الخدمة المعتمد؟' },
        a: {
          en: 'An accredited service provider approved by the Ministry of Finance to exchange e-invoices on the Peppol network and report them to the Federal Tax Authority. Every in-scope business must appoint one.',
          ar: 'مزوّد خدمة معتمد من وزارة المالية لتبادل الفواتير الإلكترونية على شبكة Peppol وإبلاغ الهيئة الاتحادية للضرائب بها. ويجب على كل منشأة مشمولة أن تعيّن واحداً.',
        },
      },
      {
        q: {
          en: 'Does CargoSharks support UAE e-invoicing?',
          ar: 'هل يدعم CargoSharks الفوترة الإلكترونية في الإمارات؟',
        },
        a: {
          en: 'Not yet. Invoices carry tax treatment and rate per line and the provider hand-off is built, but PINT AE generation and transmission are on the roadmap with no ship date. Until then, issue e-invoices from your accounting system or provider and use CargoSharks’ journal export.',
          ar: 'ليس بعد. الفواتير تحمل المعالجة الضريبية والنسبة لكل بند والربط مع المزوّد مبنيّ، لكن إنشاء PINT AE وإرسالها على خطة التطوير دون موعد إطلاق. وحتى ذلك الحين أصدروا الفواتير الإلكترونية من نظامكم المحاسبي أو مزوّدكم واستخدموا تصدير القيود من CargoSharks.',
        },
      },
      {
        q: { en: 'Is a PDF invoice still enough?', ar: 'هل تكفي فاتورة PDF؟' },
        a: {
          en: 'Not for in-scope transactions once your date arrives. The structured e-invoice exchanged through the providers is what counts; a PDF can still be sent as a readable copy.',
          ar: 'لا، للتعاملات المشمولة بعد حلول موعدكم. فالفاتورة الإلكترونية المنظّمة المتبادلة عبر المزوّدين هي المعتبرة، ويمكن إرسال ملف PDF نسخةً مقروءة.',
        },
      },
    ],
    related: [
      'freight-forwarding-software-uae',
      'freight-invoicing-software',
      'freight-forwarding-software-saudi-arabia',
      '/compare/cargoes-runner/',
    ],
  },
]

/**
 * Every page, in menu order, with its menu entry joined on. A slug in one list
 * and not the other is a build failure rather than a page that quietly has no
 * menu entry or no content.
 */
export const solutions: Solution[] = solutionNav.map((entry) => {
  const row = rows.find((candidate) => candidate.slug === entry.slug)
  if (!row)
    throw new Error(`solution-nav.ts names "${entry.slug}" but solutions.ts has no row for it`)
  return { ...row, group: entry.group, nav: { label: entry.label, blurb: entry.blurb } }
})
if (rows.length !== solutions.length) {
  throw new Error('solutions.ts has a row that solution-nav.ts does not list')
}

/** Lookup by slug. Every route reads its row through this. */
export function solution(slug: string): Solution {
  const found = solutions.find((entry) => entry.slug === slug)
  if (!found) throw new Error(`No solution page with slug "${slug}"`)
  return found
}

export { solutionPath }
