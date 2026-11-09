import type { Metadata } from 'next'
import type { Bi, Lang } from '@/content/copy'

/**
 * `/pricing/` and `/ar/pricing/` — how a quote is built, and the form that asks
 * for one.
 *
 * **No prices and no tiers.** The packages are internal; a figure on this page
 * would be wrong for most of the forwarders reading it, and a tier table invites
 * comparing one before the call that would explain it. What the page publishes
 * instead is the shape of the bill and what moves it, so a visitor can tell what
 * kind of number to expect, and then asks for the number.
 *
 * **The demo runs on sample data**, not the visitor's. The demo call walks
 * through the software on the seeded dataset and spends the rest of its time on
 * the visitor's requirements; the quote is built from those. Nothing here
 * promises "your lanes, your documents", which the demo cannot do.
 *
 * Onboarding is agreed in the quote as part of the package. It is never called
 * free here, and there is no pilot and no trial: the live demo is open to
 * anyone, the meetings before a decision cost nothing.
 */

export const pricingPath = (lang: Lang) => (lang === 'ar' ? '/ar/pricing/' : '/pricing/')

/** Where every "Get a quote" on the site points: the form, on this page. */
export const quotePath = (lang: Lang) => `${pricingPath(lang)}#quote`

export const pricingMeta = {
  title: {
    en: 'Pricing: quoted for your operation | CargoSharks',
    ar: 'الأسعار: عرض سعر يناسب عملكم | CargoSharks',
  },
  description: {
    en: 'How CargoSharks is priced: setup and onboarding, then a monthly or yearly subscription set by your branches, users and features. Never per shipment. Tell us about your operation and get a quote.',
    ar: 'كيف تُسعَّر CargoSharks: الإعداد والتأهيل، ثم اشتراك شهري أو سنوي يحدده عدد فروعكم ومستخدميكم والمزايا التي تحتاجونها. لا تسعير لكل شحنة. أخبرونا عن عملكم واطلبوا عرض سعر.',
  },
} satisfies Record<string, Bi>

export const pricing = {
  crumb: { en: 'Pricing', ar: 'الأسعار' },
  title: {
    en: 'Priced for your operation, and quoted in writing.',
    ar: 'سعر يناسب عملكم، وعرض مكتوب.',
  },
  lede: {
    en: 'There is no price list, because no two forwarders are the same project. One office on spreadsheets and five branches across three countries need different things. Tell us about yours, and the quote that follows says what it costs and what is in it.',
    ar: 'لا توجد قائمة أسعار، لأنه لا توجد شركتا شحن متشابهتان. مكتب واحد يعمل على جداول البيانات، وخمسة فروع في ثلاث دول، يحتاجان أشياء مختلفة. أخبرونا عن عملكم، ويأتيكم بعدها عرض يبيّن التكلفة وما تشمله.',
  },
  quote: { en: 'Get a quote', ar: 'اطلبوا عرض سعر' },
  tryDemo: { en: 'Try the demo', ar: 'جرّبوا النسخة التجريبية' },
  /** Beside the masthead's two buttons, the three facts asked first. */
  facts: [
    { en: 'Never per shipment', ar: 'لا تسعير لكل شحنة' },
    { en: 'Monthly or yearly', ar: 'شهرياً أو سنوياً' },
    { en: 'Free demo call', ar: 'اتصال تعريفي مجاني' },
  ],

  steps: {
    title: { en: 'From this form to a quote', ar: 'من هذا النموذج إلى عرض السعر' },
    lede: {
      en: 'Four steps, and the first two cost you nothing but a few minutes.',
      ar: 'أربع خطوات، ولا تكلّفكم الأوليان سوى بضع دقائق.',
    },
    items: [
      {
        title: { en: 'Fill in the form', ar: 'املؤوا النموذج' },
        body: {
          en: 'Two minutes. Only your name, company and work email are required.',
          ar: 'دقيقتان. المطلوب فقط الاسم والشركة وبريد العمل.',
        },
      },
      {
        title: { en: 'We reply and book a call', ar: 'نرد ونحدد اتصالاً' },
        body: {
          en: 'A person replies within one working day, in Arabic or English. You can also pick a time straight after sending.',
          ar: 'يرد عليكم شخصٌ خلال يوم عمل واحد، بالعربية أو الإنجليزية. ويمكنكم أيضاً اختيار موعد فور الإرسال.',
        },
      },
      {
        title: { en: 'A free demo call', ar: 'اتصال تعريفي مجاني' },
        body: {
          en: 'We walk you through the software on sample data, then go over how you work: your branches, your documents, your e-invoicing.',
          ar: 'نعرض عليكم البرنامج على بيانات نموذجية، ثم نستعرض طريقة عملكم: فروعكم، ومستنداتكم، وفوترتكم الإلكترونية.',
        },
      },
      {
        title: { en: 'Your quote, in writing', ar: 'عرض السعر، مكتوباً' },
        body: {
          en: 'Built from those requirements: setup and onboarding, the subscription, and what is in each. Then onboarding, then live.',
          ar: 'مبني على تلك المتطلبات: الإعداد والتأهيل، والاشتراك، وما يشمله كل منهما. ثم التأهيل، ثم التشغيل.',
        },
      },
    ],
  },

  bill: {
    title: { en: 'What you pay for', ar: 'ما تدفعون مقابله' },
    lede: {
      en: 'Every quote has the same parts, so two quotes can be compared line by line.',
      ar: 'لكل عرض الأجزاء نفسها، فتُقارَن العروض بنداً ببند.',
    },
    items: [
      {
        icon: 'setup',
        title: { en: 'Setup and onboarding', ar: 'الإعداد والتأهيل' },
        body: {
          en: 'Your deployment, your letterhead on every document, your rate cards, customers and templates brought in, e-invoicing set up, and your team trained. Agreed in the quote, as part of your package.',
          ar: 'منظومتكم، وترويستكم على كل مستند، واستيراد جداول أسعاركم وعملائكم وقوالبكم، وإعداد الفوترة الإلكترونية، وتدريب فريقكم. يُتفق عليه في العرض، ضمن باقتكم.',
        },
      },
      {
        icon: 'subscription',
        title: { en: 'The subscription', ar: 'الاشتراك' },
        body: {
          en: 'Monthly or yearly, and yearly costs less. Set by your branches, your users and the features you need, never by how many shipments you move, so a busy month costs what a quiet one does.',
          ar: 'شهرياً أو سنوياً، والسنوي أقل تكلفة. يحدده عدد فروعكم ومستخدميكم والمزايا التي تحتاجونها، لا عدد الشحنات، فالشهر المزدحم يكلّف ما يكلّفه الشهر الهادئ.',
        },
      },
      {
        icon: 'thirdParty',
        title: { en: 'Third parties, at cost', ar: 'الأطراف الأخرى، بسعر التكلفة' },
        body: {
          en: 'What another company bills for, such as an e-invoicing provider or WhatsApp messages, is passed through at what it costs us, itemised, or billed to your own account.',
          ar: 'ما تفوتره شركة أخرى، مثل مزوّد الفوترة الإلكترونية أو رسائل واتساب، يُمرَّر بسعر تكلفته علينا مفصّلاً، أو يُفوتر على حسابكم مباشرة.',
        },
      },
    ] as const,
    footnote: {
      en: 'Contract length is agreed in the quote.',
      ar: 'مدة العقد يُتفق عليها في العرض.',
    },
  },

  drivers: {
    title: { en: 'What moves the price', ar: 'ما الذي يغيّر السعر' },
    lede: {
      en: 'The questions a quote is built from. The form asks some of them, so the call can start on the rest.',
      ar: 'الأسئلة التي يُبنى عليها العرض. يسأل النموذج عن بعضها، لتبدأ المكالمة من البقية.',
    },
    head: [
      { en: 'Question', ar: 'السؤال' },
      { en: 'Why it matters', ar: 'لماذا يهم' },
    ],
    rows: [
      [
        { en: 'Branches and legal entities', ar: 'الفروع والكيانات القانونية' },
        {
          en: 'Each entity has its own currency, VAT, invoice numbering and letterhead, and is set up on its own.',
          ar: 'لكل كيان عملته وضريبته وتسلسل فواتيره وترويسته، ويُعدّ كل منها على حدة.',
        },
      ],
      [
        { en: 'People who sign in', ar: 'من يسجّلون الدخول' },
        {
          en: 'Your own staff. Your customers on the portal and your agents answering rate requests sign in free.',
          ar: 'موظفوكم فقط. عملاؤكم على البوابة ووكلاؤكم الذين يردّون على طلبات التسعير يدخلون مجاناً.',
        },
      ],
      [
        { en: 'The features you need', ar: 'المزايا التي تحتاجونها' },
        {
          en: 'Everything in the next section is in every subscription; what can be added is quoted only if you want it.',
          ar: 'كل ما في القسم التالي موجود في كل اشتراك، وما يمكن إضافته يُسعَّر فقط إن أردتموه.',
        },
      ],
      [
        { en: 'E-invoicing', ar: 'الفوترة الإلكترونية' },
        {
          en: 'Saudi ZATCA and UAE e-invoicing are set up for each entity that invoices there.',
          ar: 'تُعدّ فوترة زاتكا السعودية والفوترة الإلكترونية الإماراتية لكل كيان يُصدر فواتيره هناك.',
        },
      ],
      [
        { en: 'What you are moving from', ar: 'من أي نظام تنتقلون' },
        {
          en: 'A clean export from another system comes in quickly; years of spreadsheets need cleaning first.',
          ar: 'البيانات المصدّرة بشكل منظم من نظام آخر تُستورد بسرعة، أما سنوات من جداول البيانات فتحتاج إلى تنظيف أولاً.',
        },
      ],
      [
        { en: 'Where it is hosted', ar: 'أين تُستضاف' },
        {
          en: 'On our cloud, or in your own account and region where your data has to stay in-country.',
          ar: 'على سحابتنا، أو في حسابكم وفي المنطقة التي تختارونها حين يجب أن تبقى بياناتكم داخل البلد.',
        },
      ],
    ] as [Bi, Bi][],
  },

  scope: {
    title: { en: 'What is in it', ar: 'ماذا يشمل' },
    lede: {
      en: 'The same product for everyone. What changes is how much of the work it does for you.',
      ar: 'المنتج نفسه للجميع. ما يتغيّر هو مقدار العمل الذي يؤديه عنكم.',
    },
    included: {
      title: { en: 'In every subscription', ar: 'في كل اشتراك' },
      items: [
        { en: 'Enquiries, rate cards and quotations', ar: 'الاستفسارات وجداول الأسعار وعروض الأسعار' },
        {
          en: 'Jobs, milestones and documents, in Arabic and English',
          ar: 'الملفات والمراحل والمستندات، بالعربية والإنجليزية',
        },
        { en: 'Invoicing and job costing', ar: 'الفوترة وتكلفة كل ملف' },
        { en: 'Customer portal and shipment tracking', ar: 'بوابة العملاء وتتبّع الشحنات' },
        { en: 'Agent portal and rate requests', ar: 'بوابة الوكلاء وطلبات التسعير' },
        { en: 'Export to your accounting system', ar: 'التصدير إلى نظامكم المحاسبي' },
      ],
    },
    added: {
      title: { en: 'Added when you need it', ar: 'يُضاف عند الحاجة' },
      items: [
        {
          en: 'Saudi ZATCA and UAE e-invoicing, per entity',
          ar: 'فوترة زاتكا السعودية والفوترة الإلكترونية الإماراتية، لكل كيان',
        },
        {
          en: 'The AI assistant, and documents read for you',
          ar: 'المساعد الذكي، وقراءة المستندات عنكم',
        },
        {
          en: 'Emails turned into enquiries automatically',
          ar: 'تحويل الرسائل الواردة إلى استفسارات تلقائياً',
        },
        {
          en: 'Automations: rate requests sent to agents, quotes drafted',
          ar: 'الأتمتة: إرسال طلبات التسعير للوكلاء، وتجهيز مسودات العروض',
        },
        { en: 'WhatsApp with your customers', ar: 'واتساب مع عملائكم' },
        { en: 'Carrier tracking', ar: 'التتبّع لدى الخطوط الملاحية' },
      ],
    },
  },

  form: {
    title: { en: 'Get a quote', ar: 'اطلبوا عرض سعر' },
    lede: {
      en: 'Two minutes. Only your name, company and work email are required; the rest helps the first call be about your operation rather than a questionnaire.',
      ar: 'دقيقتان. المطلوب فقط الاسم والشركة وبريد العمل، والباقي يجعل الاتصال الأول عن عملكم لا عن استبيان.',
    },
    after: {
      en: 'A person reads every request and replies within one working day. Nothing is emailed to you automatically, and your details are used only to answer you.',
      ar: 'يقرأ شخصٌ كل طلب ويرد خلال يوم عمل واحد. لا يُرسل إليكم بريد تلقائي، وتُستخدم بياناتكم فقط للرد عليكم.',
    },
    selfServe: {
      en: 'Rather look first? The demo is open, with no sign-up.',
      ar: 'تفضّلون الاطلاع أولاً؟ النسخة التجريبية مفتوحة، بلا تسجيل.',
    },
  },

  faqTitle: { en: 'Questions about pricing', ar: 'أسئلة عن الأسعار' },
  faq: [
    {
      q: { en: 'Why is there no price list?', ar: 'لماذا لا توجد قائمة أسعار؟' },
      a: {
        en: 'Because a single forwarder with one office and a group with five entities across three countries need different setups, and a published figure would be wrong for most readers. The quote says exactly what you pay and for what.',
        ar: 'لأن شركة شحن بمكتب واحد ومجموعة من خمسة كيانات في ثلاث دول تحتاجان إعداداً مختلفاً، وأي رقم منشور سيكون خاطئاً لأغلب القرّاء. ويبيّن العرض بالضبط ما تدفعونه ومقابل ماذا.',
      },
    },
    {
      q: { en: 'Is it priced per shipment?', ar: 'هل التسعير لكل شحنة؟' },
      a: {
        en: 'No. The subscription is set by branches, users and features. A busy month costs what a quiet one does.',
        ar: 'لا. يحدد الاشتراكَ عددُ الفروع والمستخدمين والمزايا. الشهر المزدحم يكلّف ما يكلّفه الشهر الهادئ.',
      },
    },
    {
      q: {
        en: 'Are our customers and agents charged as users?',
        ar: 'هل يُحتسب عملاؤنا ووكلاؤنا مستخدمين؟',
      },
      a: {
        en: 'No. Customers on the portal and agents answering your rate requests sign in free. Only your own staff count.',
        ar: 'لا. العملاء على البوابة والوكلاء الذين يردّون على طلبات التسعير يدخلون مجاناً. ويُحتسب موظفوكم فقط.',
      },
    },
    {
      q: { en: 'Is e-invoicing included?', ar: 'هل الفوترة الإلكترونية مشمولة؟' },
      a: {
        en: 'Saudi ZATCA and UAE e-invoicing are part of the product and are set up for each entity that needs them. Where an authority requires an accredited provider, its fees are passed through at cost.',
        ar: 'فوترة زاتكا السعودية والفوترة الإلكترونية الإماراتية جزء من المنتج، وتُعدّ لكل كيان يحتاجها. وحيث تشترط الجهة مزوّداً معتمداً، تُمرَّر رسومه بسعر التكلفة.',
      },
    },
    {
      q: { en: 'Can we try it before we talk?', ar: 'هل نستطيع تجربته قبل التواصل؟' },
      a: {
        en: 'Yes. The demo is the real software on sample data, open to anyone with no sign-up. The demo call is free too.',
        ar: 'نعم. النسخة التجريبية هي البرنامج نفسه على بيانات نموذجية، ومفتوحة للجميع بلا تسجيل. والاتصال التعريفي مجاني أيضاً.',
      },
    },
    {
      q: { en: 'How long is the contract?', ar: 'ما مدة العقد؟' },
      a: {
        en: 'It is agreed in the quote, along with whether you pay monthly or yearly.',
        ar: 'يُتفق عليها في العرض، مع اختيار الدفع شهرياً أو سنوياً.',
      },
    },
  ],

}

/**
 * The closing band on the home page, where the full form used to be. Its id
 * stays `demo`: posts in the CMS and links elsewhere still say `/#demo`, and
 * they should land on a way to ask for a quote rather than the top of the page.
 */
export const quoteBand = {
  title: {
    en: 'Tell us about your operation, and get a quote.',
    ar: 'أخبرونا عن عملكم، واطلبوا عرض سعر.',
  },
  body: {
    en: 'No price list: a quote built from your branches, users and features, after a free demo call. Never per shipment.',
    ar: 'لا قائمة أسعار: عرض مبني على فروعكم ومستخدميكم والمزايا التي تحتاجونها، بعد اتصال تعريفي مجاني. لا تسعير لكل شحنة.',
  },
  howPricing: { en: 'How pricing works', ar: 'كيف نسعّر' },
} satisfies Record<string, Bi>

/**
 * Metadata for either language. Both are declared under `alternates`, which is
 * what emits the `hreflang` pair, and `openGraph` is set in full because Next
 * merges metadata shallowly and would otherwise inherit the home page's.
 */
export function pricingMetadata(lang: Lang): Metadata {
  const path = pricingPath(lang)
  return {
    title: pricingMeta.title[lang],
    description: pricingMeta.description[lang],
    alternates: {
      canonical: path,
      languages: { en: pricingPath('en'), ar: pricingPath('ar'), 'x-default': pricingPath('en') },
    },
    openGraph: {
      type: 'website',
      locale: lang,
      alternateLocale: lang === 'ar' ? 'en' : 'ar',
      siteName: 'CargoSharks',
      title: pricingMeta.title[lang],
      description: pricingMeta.description[lang],
      url: path,
      images: [
        {
          url:
            lang === 'ar' ? '/pic/screens/app-dashboard-ar.webp' : '/pic/screens/app-dashboard.webp',
        },
      ],
    },
  }
}
