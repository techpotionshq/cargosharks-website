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
 * Claims are load-bearing. The sales set is written under one rule — nothing is claimed that the working tree
 * does not do — and the figures below are the ones `apps/landing/README.md`
 * records a way to re-check.
 */

import { solutionNav, solutionPath } from '@/content/solution-nav'

export type Lang = 'en' | 'ar'

/** One string per language. The type is the parity check. */
export type Bi = { en: string; ar: string }

/**
 * A link's address for a reader of `lang`. Every link in `nav` and `footer` is
 * `href`, plus `hrefAr` where the page has an Arabic twin; this is the one
 * place that chooses between them.
 */
export function hrefFor(link: { href: string; hrefAr?: string }, lang: Lang): string {
  return lang === 'ar' && link.hrefAr ? link.hrefAr : link.href
}

function solutionLinks(group: 'market' | 'job') {
  return solutionNav
    .filter((entry) => entry.group === group)
    .map((entry) => ({
      href: solutionPath(entry.slug, 'en'),
      hrefAr: solutionPath(entry.slug, 'ar'),
      label: entry.label,
      blurb: entry.blurb,
    }))
}

export const DEMO_URL = 'https://demo.cargosharks.com'
/**
 * The mail domain and the mailboxes on it, never joined here: a whole address
 * in the source ends up whole in the HTML. `components/Email.tsx` joins them in
 * the browser.
 */
export const CONTACT_DOMAIN = 'cargosharks.com'
export type Mailbox = 'hello' | 'privacy' | 'security'

/**
 * The header's navigation, as two groups and a link.
 *
 * It was two flat links, which was right while there were seven pages. There
 * are eleven now — four comparison pages arrived — and a flat bar has two bad
 * answers to that: list all of them, or hide the new ones where nobody but a
 * search engine finds them. A panel is the third answer, and it is the one that
 * lets a page like `/compare/spreadsheets/` be reachable by a human.
 *
 * `blurb` is not decoration. A menu of eleven bare links is a sitemap; a line
 * of explanation under each turns it into a page in its own right, and it is
 * where a reader who does not yet know what they want actually decides.
 */
export const nav: {
  id: string
  label: Bi
  /** A group opens a panel; a plain `href` is a link and opens nothing. */
  href?: string
  /** The plain link's Arabic twin, where the page has one. */
  hrefAr?: string
  intro?: Bi
  /**
   * A path prefix whose pages light this group in the bar, for a group that
   * stands for a section rather than a page (Blog: every post under /blog/).
   */
  section?: string
  /**
   * The panel's left column.
   *
   * Photographs, not product captures. The site already shows the software in
   * five places and a sixth thumbnail of the same dashboard in a menu is
   * wallpaper — it tells a reader nothing they have not seen two screens up.
   * A picture of the trade does a different job: it says what the group is
   * about at a glance, in the one part of the panel where there is room.
   *
   * A photograph also has no language, which is why there is no `-ar` variant
   * to reach for here the way the captures need one.
   */
  image?: {
    src: string
    alt: Bi
    /** CSS `object-position` for the crop; the panel crops to the top by default. */
    position?: string
  }
  /**
   * `hrefAr` is the Arabic twin of a link, where the page has one. The
   * header sends an Arabic reader there and an English reader to `href`.
   */
  columns?: { heading: Bi; links: { href: string; hrefAr?: string; label: Bi; blurb: Bi }[] }[]
}[] = [
  {
    id: 'product',
    label: { en: 'Product', ar: 'المنتج' },
    image: {
      src: '/pic/photos/menu-port.webp',
      alt: {
        en: 'A container terminal from the air, ships alongside and cranes working',
        ar: 'محطة حاويات من الجو، والسفن راسية والرافعات تعمل',
      },
    },
    intro: {
      en: 'One file from enquiry to paid invoice, in Arabic and English, on a database that belongs to you.',
      ar: 'سجل واحد من الاستفسار إلى الفاتورة المسدَّدة، بالعربية والإنجليزية، على قاعدة بيانات تملكونها.',
    },
    columns: [
      {
        heading: { en: 'Overview', ar: 'نظرة عامة' },
        links: [
          {
            href: '/what-we-do/',
            label: { en: 'What we do', ar: 'ماذا نفعل' },
            blurb: {
              en: 'The whole product, explained from the beginning',
              ar: 'المنتج كاملاً، مشروحاً من البداية',
            },
          },
          {
            href: '/#work',
            label: { en: 'The three desks', ar: 'المكاتب الثلاثة' },
            blurb: {
              en: 'Commercial, operations and finance on one shipment',
              ar: 'التجاري والعمليات والمالية على شحنة واحدة',
            },
          },
          {
            href: '/#demo',
            label: { en: 'The live demo', ar: 'النسخة التجريبية' },
            blurb: {
              en: 'The real software on seeded data, no sign-up',
              ar: 'البرنامج نفسه على بيانات مُعدّة، بلا تسجيل',
            },
          },
        ],
      },
      {
        heading: { en: 'How it is built', ar: 'كيف بُني' },
        links: [
          {
            href: '/what-we-do/#bilingual',
            label: { en: 'Arabic and English', ar: 'بالعربية والإنجليزية' },
            blurb: {
              en: 'The same build, not a translation layer',
              ar: 'البناء نفسه، لا طبقة ترجمة',
            },
          },
          {
            href: '/dpa/',
            label: { en: 'Data and security', ar: 'البيانات والأمان' },
            blurb: {
              en: 'Where your rows live and who can read them',
              ar: 'أين تعيش صفوفكم ومن يستطيع قراءتها',
            },
          },
        ],
      },
    ],
  },
  {
    /*
      The landing pages, by market and by job, read from `solution-nav.ts` so a
      new page is one row there (and its content in `solutions.ts`) and appears here, in the sitemap and in the
      related links at once. Every one has an Arabic twin, which is why this is
      the one group whose links carry `hrefAr`.
    */
    id: 'solutions',
    label: { en: 'Solutions', ar: 'الحلول' },
    image: {
      src: '/pic/photos/ship-aerial.webp',
      alt: {
        en: 'A container ship at sea, seen from above',
        ar: 'سفينة حاويات في البحر، من الأعلى',
      },
    },
    intro: {
      en: 'The product, by the market you work in and the job in front of you. Each page says what it does not do as well as what it does.',
      ar: 'المنتج حسب السوق الذي تعملون فيه والمهمة التي أمامكم. كل صفحة تقول ما لا يفعله كما تقول ما يفعله.',
    },
    columns: [
      {
        heading: { en: 'By market', ar: 'حسب السوق' },
        links: solutionLinks('market'),
      },
      {
        heading: { en: 'By job', ar: 'حسب المهمة' },
        links: solutionLinks('job'),
      },
    ],
  },
  {
    id: 'inside',
    label: { en: 'Inside it', ar: 'داخله' },
    image: {
      src: '/pic/photos/menu-loading.webp',
      alt: {
        en: 'A reach stacker and quay cranes working a container yard',
        ar: 'رافعة حاويات ورافعات رصيف تعمل في ساحة حاويات',
      },
    },
    intro: {
      en: 'The parts a forwarder opens every day. Every link here goes to a section that describes a mechanism rather than a feature — something the database enforces, which means you can check it.',
      ar: 'الأجزاء التي يفتحها الوكيل كل يوم. كل رابط هنا يقود إلى قسم يصف آلية لا ميزة — شيئاً تفرضه قاعدة البيانات، أي أنه قابل للتحقق.',
    },
    columns: [
      {
        heading: { en: 'The work', ar: 'العمل' },
        links: [
          {
            href: '/what-we-do/#loop',
            label: { en: 'Enquiry to invoice', ar: 'من الاستفسار إلى الفاتورة' },
            blurb: { en: 'The whole loop, stage by stage', ar: 'الدورة كاملة، مرحلة مرحلة' },
          },
          {
            href: '/what-we-do/#modes',
            label: { en: 'Four transport modes', ar: 'أربع وسائل شحن' },
            blurb: {
              en: 'Sea, air, road and courier on one file',
              ar: 'بحري وجوي وبري وبريد سريع على سجل واحد',
            },
          },
          {
            href: '/what-we-do/#parts',
            label: { en: 'What is in the box', ar: 'ما في المنتج' },
            blurb: { en: 'Every module, and what each one does', ar: 'كل وحدة، وما تفعله' },
          },
        ],
      },
      {
        heading: { en: 'What it guarantees', ar: 'ما يضمنه' },
        links: [
          {
            href: '/privacy/#nodelete',
            label: { en: 'Nothing is deleted', ar: 'لا يُحذف شيء' },
            blurb: {
              en: 'Superseded rows stay, and say who moved them',
              ar: 'الصفوف المستبدَلة تبقى، وتقول من غيّرها',
            },
          },
          {
            href: '/what-we-do/#ownership',
            label: { en: 'Whose database it is', ar: 'قاعدة البيانات لمن' },
            blurb: {
              en: 'Yours, and you can have a copy today',
              ar: 'لكم، ويمكنكم أخذ نسخة اليوم',
            },
          },
          {
            href: '/what-we-do/#boundaries',
            label: { en: 'What we do not do', ar: 'ما لا نفعله' },
            blurb: {
              en: 'The boundary, published rather than discovered',
              ar: 'الحدود، منشورة لا مُكتشَفة',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'compare',
    label: { en: 'Compare', ar: 'المقارنات' },
    image: {
      src: '/pic/photos/menu-stack.webp',
      alt: {
        en: 'Stacked containers and lanes in a working terminal',
        ar: 'حاويات مرصوفة وممرات في محطة عاملة',
      },
    },
    intro: {
      en: 'No tick-and-cross grids. Each page says what the other vendor states about itself, where they are the better answer, and the questions worth asking both of us.',
      ar: 'بلا جداول علامات. كل صفحة تقول ما يذكره المورّد الآخر عن نفسه، وأين يكون هو الجواب الأفضل، والأسئلة التي تستحق أن تُطرح علينا معاً.',
    },
    columns: [
      {
        heading: { en: 'Against a system', ar: 'مقابل نظام' },
        links: [
          {
            href: '/compare/cargowise/',
            label: { en: 'vs CargoWise', ar: 'مقابل CargoWise' },
            blurb: {
              en: 'The enterprise platform, and when it wins',
              ar: 'المنصة المؤسسية، ومتى تفوز',
            },
          },
          {
            href: '/compare/logistaas/',
            label: { en: 'vs Logistaas', ar: 'مقابل Logistaas' },
            blurb: { en: 'The closest comparison on the list', ar: 'أقرب مقارنة في القائمة' },
          },
          {
            href: '/compare/cargoes-runner/',
            label: { en: 'vs CARGOES Runner', ar: 'مقابل CARGOES Runner' },
            blurb: {
              en: 'DP World’s platform for smaller forwarders',
              ar: 'منصة DP World للوكلاء الأصغر',
            },
          },
        ],
      },
      {
        heading: { en: 'Against how it is done now', ar: 'مقابل الطريقة الحالية' },
        links: [
          {
            href: '/compare/spreadsheets/',
            label: { en: 'vs spreadsheets', ar: 'مقابل جداول البيانات' },
            blurb: {
              en: 'The real incumbent, and where it breaks',
              ar: 'المنافس الحقيقي، وأين ينكسر',
            },
          },
          {
            href: '/compare/',
            label: { en: 'How we compare', ar: 'كيف نقارن' },
            blurb: {
              en: 'Three ways to run an operation, and who we are not for',
              ar: 'ثلاث طرق لإدارة العمل، ومن لسنا لهم',
            },
          },
        ],
      },
    ],
  },
  // A panel since posts arrive daily: the header lists the newest ones beside
  // these links, fetched when it opens (`/blog/latest.json`), so the menu is
  // current without a rebuild.
  {
    id: 'blog',
    label: { en: 'Blog', ar: 'المدونة' },
    section: '/blog/',
    // Shown only until a post with a cover is published: the panel uses the
    // newest post's cover in its place. A portrait shot with the containers in
    // its lower half, so the crop is anchored low; anchored at the top, as the
    // other panels are, it was a rectangle of sky.
    image: {
      src: '/pic/photos/containers-stack.webp',
      alt: {
        en: 'Shipping containers stacked high in a yard',
        ar: 'حاويات شحن مرصوفة عالياً في ساحة',
      },
      position: '50% 78%',
    },
    intro: {
      en: 'Quoting, customs, free time, documents and getting paid, written for the people who do the work.',
      ar: 'التسعير والتخليص ووقت السماح والمستندات والتحصيل، مكتوبة لمن يقوم بالعمل.',
    },
    columns: [
      {
        heading: { en: 'Browse', ar: 'تصفّحوا' },
        links: [
          {
            href: '/blog/',
            hrefAr: '/ar/blog/',
            label: { en: 'All posts', ar: 'كل المقالات' },
            blurb: {
              en: 'Every article, newest first',
              ar: 'كل المقالات، الأحدث أولاً',
            },
          },
          {
            href: '/#calculator',
            hrefAr: '/ar/#calculator',
            label: { en: 'Free time calculator', ar: 'حاسبة وقت السماح' },
            blurb: {
              en: 'What overruns cost your desk in a month',
              ar: 'ما تكلّفه التجاوزات مكتبكم في الشهر',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'trust',
    label: { en: 'Trust', ar: 'الثقة' },
    image: {
      src: '/pic/photos/containers-aerial.webp',
      alt: {
        en: 'Containers stacked in rows, seen from above',
        ar: 'حاويات مرصوفة صفوفاً، من الأعلى',
      },
    },
    intro: {
      en: 'Where your rows live, who can read them, and what we commit to in writing. The three legal documents are drafts under review and say so at the top of each.',
      ar: 'أين تعيش صفوفكم، ومن يستطيع قراءتها، وما نلتزم به كتابةً. الوثائق القانونية الثلاث مسوّدات قيد المراجعة، وتقول ذلك في صدر كل منها.',
    },
    columns: [
      {
        heading: { en: 'How it is secured', ar: 'كيف يُؤمَّن' },
        links: [
          {
            href: '/privacy/#roles',
            label: { en: 'Roles and access', ar: 'الأدوار والصلاحيات' },
            blurb: {
              en: 'Who sees which branch, enforced by the database itself',
              ar: 'من يرى أي فرع، مفروضاً في قاعدة البيانات نفسها',
            },
          },
          {
            href: '/privacy/#audit',
            label: { en: 'The audit trail', ar: 'أثر التدقيق' },
            blurb: { en: 'Every change stamped with who and when', ar: 'كل تغيير مختوم بمن ومتى' },
          },
        ],
      },
      {
        heading: { en: 'In writing', ar: 'كتابةً' },
        links: [
          {
            href: '/dpa/',
            label: { en: 'Data processing', ar: 'معالجة البيانات' },
            blurb: {
              en: 'What we process, where, and for how long',
              ar: 'ما نعالجه، وأين، وإلى متى',
            },
          },
          {
            href: '/privacy/',
            label: { en: 'Privacy', ar: 'الخصوصية' },
            blurb: {
              en: 'What leaves a visitor’s browser, enumerated',
              ar: 'ما يغادر متصفح الزائر، مُعدَّداً',
            },
          },
          {
            href: '/terms/',
            label: { en: 'Terms', ar: 'الشروط' },
            blurb: {
              en: 'The agreement, including what is not in it',
              ar: 'الاتفاق، بما في ذلك ما ليس فيه',
            },
          },
        ],
      },
    ],
  },
  {
    // A plain link, so the bar is not four dropdowns in a row — and because
    // the demo is the one thing on this site with nothing to explain.
    id: 'demo',
    href: '/#demo',
    label: { en: 'Demo', ar: 'النسخة التجريبية' },
  },
]

/** Flattened, for the places that want links rather than a menu. */
export const navLinks: { href: string; label: Bi }[] = nav.flatMap((item) =>
  item.href
    ? [{ href: item.href, label: item.label }]
    : (item.columns ?? []).flatMap((column) =>
        column.links
          // Anchors into the home page are menu affordances rather than pages,
          // so they are not links a sitemap or a mobile list should repeat.
          .filter((link) => !link.href.includes('#'))
          .map((link) => ({ href: link.href, label: link.label })),
      ),
)

export const hero = {
  /**
   * The search phrase leads, the promise follows.
   *
   * "From enquiry to invoice, one file." carried no word anybody searches for,
   * on the page with the most authority on the site. "Freight forwarding
   * software" is the query; "e-invoice" is the word Gulf buyers are asking
   * every vendor about, so it is the destination of the sentence.
   */
  title: {
    en: 'Freight forwarding software, from enquiry to e-invoice.',
    ar: 'برنامج إدارة الشحن، من الاستفسار إلى الفاتورة الإلكترونية.',
  },
  body: {
    en: 'Quote, book, clear and invoice every shipment on one file, in Arabic and English, with ZATCA and UAE e-invoicing built in. Made in Kuwait for forwarders across the GCC.',
    ar: 'سعّروا كل شحنة واحجزوها وخلّصوها وفوتروها على سجل واحد، بالعربية والإنجليزية، مع الفوترة الإلكترونية لزاتكا والإمارات مدمجة فيه. صُنع في الكويت لشركات الشحن في دول الخليج.',
  },
  primary: { en: 'Open the live demo', ar: 'افتحوا النسخة التجريبية' },
  secondary: { en: 'Book a demo call', ar: 'احجزوا اتصالاً تعريفياً' },
  /**
   * Under the buttons, as plain text: what a Gulf buyer checks for first. Not
   * pills — a row of badges under a hero is the template this page left.
   */
  facts: [
    { en: 'ZATCA Phase 2', ar: 'زاتكا المرحلة الثانية' },
    { en: 'UAE e-invoicing', ar: 'الفوترة الإلكترونية في الإمارات' },
    { en: 'Arabic and English', ar: 'العربية والإنجليزية' },
    { en: 'Sea, air, road, courier', ar: 'بحري وجوي وبري وبريد سريع' },
  ],
  /**
   * The caption under the product frame. The day count and the amount are
   * computed from `FREE_TIME_ENDED` in the browser, so the three figures on the
   * line can no longer disagree with each other or with today's date, which
   * the hard-coded "131 days" did.
   */
  tickerLabel: {
    en: 'Accruing right now on one box in Shuwaikh:',
    ar: 'يجري الآن على حاوية واحدة في الشويخ:',
  },
  tickerDays: { en: 'days past free time', ar: 'يوماً بعد وقت السماح' },
}

/**
 * When free time ran out on the demurrage example, and what it costs a day.
 * One date and one rate, so the hero caption and the charge line in `Leak`
 * cannot drift apart again.
 */
export const FREE_TIME_ENDED = '2026-08-14T00:00:00+03:00'
export const DEMURRAGE_PER_DAY = 32

/**
 * The facts strip under the hero.
 *
 * Facts a buyer can check in the demo, not outcomes: nothing here is a saving
 * or a speed-up, because there is no customer data behind one.
 */
export const proof: { value: string; label: Bi }[] = [
  { value: '1', label: { en: 'file from enquiry to paid invoice', ar: 'سجل من الاستفسار إلى الفاتورة المسدَّدة' } },
  { value: '0', label: { en: 'times a shipment is keyed in twice', ar: 'مرات إدخال الشحنة مرتين' } },
  { value: '2', label: { en: 'e-invoicing regimes: ZATCA and the UAE', ar: 'نظاما فوترة إلكترونية: زاتكا والإمارات' } },
  { value: '3', label: { en: 'decimals on every dinar', ar: 'خانات عشرية لكل دينار' } },
]

/**
 * The e-invoicing section, second on the home page and on the market pages.
 *
 * It is the first question Gulf forwarders ask a vendor now, so it is answered
 * near the top rather than in a FAQ. The example invoice is real VAT logic:
 * the categories, rates and exemption codes are the seed rows of the product's
 * `vat_rules` table for a Saudi branch billing an international move, and the
 * totals add up (6,400 + 850 + 600 + 3,200 = 11,050; VAT 90.00).
 */
export const einvoicing = {
  title: {
    en: 'ZATCA and UAE e-invoicing, built into the invoice',
    ar: 'الفوترة الإلكترونية لزاتكا والإمارات، مدمجة في الفاتورة',
  },
  lede: {
    en: 'The invoice your team raises from the job is the e-invoice. No second system, no export, and nothing re-keyed into a tax portal.',
    ar: 'الفاتورة التي يصدرها فريقكم من ملف الشحنة هي نفسها الفاتورة الإلكترونية. لا نظام ثانٍ ولا تصدير، ولا إعادة إدخال في بوابة ضريبية.',
  },
  points: [
    {
      label: { en: 'Saudi Arabia: ZATCA Phase 2', ar: 'السعودية: زاتكا المرحلة الثانية' },
      body: {
        en: 'Tax invoices, credit notes and debit notes go out as signed XML with the QR code, cleared with ZATCA as part of issuing.',
        ar: 'الفواتير الضريبية والإشعارات الدائنة والمدينة تصدر بصيغة XML موقّعة مع رمز QR، وتُعتمد لدى زاتكا كجزء من إصدارها.',
      },
    },
    {
      label: { en: 'UAE: e-invoicing', ar: 'الإمارات: الفوترة الإلكترونية' },
      body: {
        en: 'Invoices in the UAE’s PINT AE format, transmitted as soon as the invoice is issued.',
        ar: 'فواتير بصيغة PINT AE المعتمدة في الإمارات، تُرسل فور إصدار الفاتورة.',
      },
    },
    {
      label: { en: 'VAT decided per line', ar: 'ضريبة القيمة المضافة لكل بند' },
      body: {
        en: 'Each line’s VAT category, rate and exemption code comes from the charge, the branch’s country and whether the move is international, from rules your finance team can edit.',
        ar: 'فئة الضريبة ونسبتها ورمز الإعفاء لكل بند تُحدَّد من نوع الرسم ودولة الفرع وما إذا كانت الشحنة دولية، وفق قواعد يستطيع فريق المالية تعديلها.',
      },
    },
    {
      label: { en: 'Kuwait: unchanged', ar: 'الكويت: كما هي' },
      body: {
        en: 'Kuwaiti branches invoice as they do today, in dinars to three decimals.',
        ar: 'تُصدر فروع الكويت فواتيرها كما تفعل اليوم، بالدينار وبثلاث خانات عشرية.',
      },
    },
  ],
  example: {
    caption: {
      en: 'One invoice from a Dammam branch: a sea import from Shanghai, VAT decided line by line.',
      ar: 'فاتورة واحدة من فرع الدمام: شحنة استيراد بحرية من شنغهاي، والضريبة محددة بنداً بنداً.',
    },
    head: {
      charge: { en: 'Charge', ar: 'الرسم' },
      treatment: { en: 'VAT treatment', ar: 'المعالجة الضريبية' },
      amount: { en: 'Amount, SAR', ar: 'المبلغ، ر.س' },
      vat: { en: 'VAT, SAR', ar: 'الضريبة، ر.س' },
    },
    rows: [
      {
        charge: { en: 'Ocean freight', ar: 'الشحن البحري' },
        treatment: { en: 'Zero-rated · VATEX-SA-34-1', ar: 'نسبة صفرية · VATEX-SA-34-1' },
        amount: '6,400.00',
        vat: '0.00',
      },
      {
        charge: { en: 'Customs clearance', ar: 'التخليص الجمركي' },
        treatment: { en: 'Zero-rated · VATEX-SA-34-5', ar: 'نسبة صفرية · VATEX-SA-34-5' },
        amount: '850.00',
        vat: '0.00',
      },
      {
        charge: { en: 'Port storage', ar: 'التخزين في الميناء' },
        treatment: { en: 'Standard · 15%', ar: 'النسبة الأساسية · 15%' },
        amount: '600.00',
        vat: '90.00',
      },
      {
        charge: { en: 'Customs duty, paid for you', ar: 'الرسوم الجمركية المدفوعة عنكم' },
        treatment: { en: 'Out of scope', ar: 'خارج النطاق' },
        amount: '3,200.00',
        vat: '–',
      },
    ],
    total: { en: 'Total with VAT', ar: 'الإجمالي مع الضريبة' },
    totalAmount: '11,050.00',
    totalVat: '90.00',
    grand: '11,140.00',
    stamp: { en: 'Signed · QR · cleared', ar: 'موقّعة · QR · معتمدة' },
  },
  links: {
    uae: { en: 'UAE e-invoicing guide for forwarders', ar: 'دليل الفوترة الإلكترونية في الإمارات' },
    saudi: { en: 'Freight software for Saudi Arabia', ar: 'برنامج الشحن للسعودية' },
  },
}

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
      {
        en: 'One queue for every branch, one owner and one deadline per line.',
        ar: 'قائمة واحدة لكل الفروع، ولكل سطر مسؤول ومهلة.',
      },
      {
        en: 'Rate cards by lane, mode and carrier. Two cannot overlap on one route.',
        ar: 'بطاقات حسب المسار والوسيلة والناقل. والتداخل على مسار واحد غير ممكن.',
      },
      {
        en: 'Buy, sell and margin are on the screen before the quote goes out.',
        ar: 'الشراء والبيع والهامش على الشاشة قبل خروج العرض.',
      },
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
      {
        en: 'Planned, revised and actual are all three kept, not overwritten.',
        ar: 'المخطط والمعدّل والفعلي — الثلاثة محفوظة، لا يُكتب أحدها فوق الآخر.',
      },
      {
        en: 'A free-time clock per container, writing its own cost line.',
        ar: 'عدّاد وقت سماح لكل حاوية، يكتب بند تكلفته بنفسه.',
      },
      {
        en: 'The board sorts by exception, oldest first, before the customer calls.',
        ar: 'اللوحة ترتِّب حسب الحالات الاستثنائية، الأقدم أولاً، قبل أن يتصل العميل.',
      },
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
      {
        en: 'Supplier invoices matched to the accrual, variance shown before approval.',
        ar: 'فواتير المورّدين تُطابَق مع المستحق، والفرق يظهر قبل الاعتماد.',
      },
      {
        en: 'Receivables by age, with the credit limit that was actually set.',
        ar: 'الذمم المدينة حسب التقادم، مع الحد الائتماني المعتمد فعلاً.',
      },
      {
        en: 'Documents issued in both languages from the shipment’s own data.',
        ar: 'المستندات تصدر باللغتين من بيانات الشحنة نفسها.',
      },
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
 * The four modes, as a strip under the hero.
 *
 * `proof` already counts them — "4 transport modes" — and a count is a claim a
 * reader has to take on trust. Naming them costs one line and settles the
 * question a forwarder is actually asking, which is not *how many* but *is mine
 * one of them*. An air-only broker reading "4" scrolls on; the same broker
 * reading "Air" does not.
 *
 * Sea is carried as two container types — FCL and LCL — so `modeEnum` in
 * `packages/db` holds five values for these four modes; the strip lists the
 * modes a forwarder books, not the enum rows. There is no rail: the product
 * has no rail rating rule or milestone template, so the strip does not claim
 * one.
 *
 * `key` maps to a Phosphor glyph in `Modes.tsx`, the same split `steps.icon`
 * uses and for the same reason: this file stays data.
 */
export const modes: { key: string; label: Bi }[] = [
  { key: 'sea', label: { en: 'Sea', ar: 'بحري' } },
  { key: 'air', label: { en: 'Air', ar: 'جوي' } },
  { key: 'road', label: { en: 'Road', ar: 'بري' } },
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
 * Five cards. Each opens with what the desk gets and follows with how the
 * product makes it hold: a buyer reads the first sentence and an evaluator the
 * second, and they used to open with the database. `icon` is a key, not
 * a component — the mapping to Phosphor lives in `Capabilities.tsx`, so this
 * file stays a data file and swapping icon sets is one edit rather than five.
 */
export const capabilities = {
  eyebrow: { en: 'Under the file', ar: 'داخل السجل' },
  title: {
    en: 'The parts a forwarder opens every day.',
    ar: 'الأجزاء التي يفتحها الوكيل كل يوم.',
  },
  sub: {
    en: 'Six things a desk relies on, built so they still hold on the day everyone is in a hurry.',
    ar: 'ستة أمور يعتمد عليها المكتب، مبنية لتصمد حتى في اليوم الذي يستعجل فيه الجميع.',
  },
  cards: [
    {
      key: 'lane',
      span: 'half',
      icon: 'route',
      title: { en: 'Every leg on one timeline', ar: 'كل مرحلة على خط زمني واحد' },
      body: {
        en: 'See where every shipment is, and what changed. Pickup, gate-in, sailing, discharge, customs and delivery sit on one file, with planned, revised and actual times side by side. Nothing is overwritten, so when a customer asks when a date moved and who moved it, there is an answer.',
        ar: 'اعرفوا أين كل شحنة، وما الذي تغيّر. الاستلام والدخول والإبحار والتفريغ والتخليص والتسليم على سجل واحد، والوقت المخطط والمعدّل والفعلي جنباً إلى جنب. لا يُكتب شيء فوق شيء، فحين يسأل العميل متى تغيّر التاريخ ومن غيّره، يوجد جواب.',
      },
    },
    {
      key: 'money',
      span: 'half',
      icon: 'money',
      title: { en: 'Three decimals, all the way down', ar: 'ثلاث خانات عشرية، من الطرف إلى الطرف' },
      body: {
        en: 'Dinar invoices that add up to the fils. The dinar has three decimal places, and every amount is kept and calculated to all three, never rounded to two on its way to a screen, so the third decimal is never quietly dropped.',
        ar: 'فواتير بالدينار صحيحة حتى الفلس. للدينار ثلاث خانات عشرية، وكل مبلغ يُحفَظ ويُحسَب بها كاملة، ولا يُقرَّب إلى خانتين في طريقه إلى الشاشة، فلا تضيع الخانة الثالثة بهدوء.',
      },
    },
    {
      key: 'rates',
      span: 'half',
      icon: 'rates',
      title: { en: 'Quotes from the right rate, every time', ar: 'عروض من السعر الصحيح، في كل مرة' },
      body: {
        en: 'Your team prices from the card that is actually current. Cards are set by lane, mode and carrier with validity dates, and two can never cover the same route at the same time, so nobody has to remember which one applies.',
        ar: 'يسعّر فريقكم من البطاقة السارية فعلاً. البطاقات حسب المسار والوسيلة والناقل بتواريخ صلاحية، ولا يمكن لبطاقتين أن تغطّيا المسار نفسه في الوقت نفسه، فلا يحتاج أحد أن يتذكّر أيّها ينطبق.',
      },
    },
    {
      key: 'docs',
      span: 'half',
      icon: 'docs',
      title: { en: 'Documents without the retyping', ar: 'مستندات بلا إعادة كتابة' },
      body: {
        en: 'House bill, air waybill, delivery order, packing list, manifest and the customs pack come straight from the shipment file, in Arabic or English. Nothing is retyped into a template, so nothing is mistyped on the way.',
        ar: 'بوليصة الشحن الفرعية وبوليصة الشحن الجوي وأمر التسليم وقائمة التعبئة والبيان وحزمة التخليص تصدر مباشرة من سجل الشحنة، بالعربية أو الإنجليزية. لا يُعاد كتابة شيء في قالب، فلا يُخطأ في شيء على الطريق.',
      },
    },
    {
      key: 'inbox',
      span: 'half',
      icon: 'inbox',
      title: { en: 'Every enquiry in one queue', ar: 'كل استفسار في قائمة واحدة' },
      body: {
        en: 'WhatsApp, email, the web form and the phone land in one queue across every branch, each with an owner and a response clock, so no request waits because nobody saw it.',
        ar: 'واتساب والبريد ونموذج الموقع والهاتف تصل إلى قائمة واحدة لكل الفروع، لكل استفسار مسؤول وعدّاد للرد، فلا ينتظر طلب لأن أحداً لم يره.',
      },
    },
    {
      key: 'tenancy',
      span: 'half',
      icon: 'tenancy',
      title: { en: 'Each branch sees its own work', ar: 'كل فرع يرى عمله فقط' },
      body: {
        en: 'Staff see the branches and entities they work for, and nothing else. The separation is enforced by the database itself rather than by a filter on the screen, so even a faulty report cannot show one branch another branch’s shipments.',
        ar: 'يرى الموظفون الفروع والكيانات التي يعملون لها، ولا شيء غيرها. الفصل تفرضه قاعدة البيانات نفسها لا مرشّح على الشاشة، فحتى التقرير الخاطئ لا يُظهر لفرع شحنات فرع آخر.',
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
 * check and which this product has no customer data to support. The sales set
 * is written under one rule — nothing is claimed
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
    /** After the day count, which `Leak` computes from `FREE_TIME_ENDED`. */
    daysTail: { en: 'and counting', ar: 'ويزيد' },
    totalLabel: { en: 'Accrued to now', ar: 'المستحق حتى الآن' },
    written: { en: 'Charge line written automatically', ar: 'يُكتب بند التكلفة تلقائياً' },
  },
}

/**
 * The demo request form (`components/Enquiry.tsx`), which closes the home page.
 *
 * There is no trial. A visitor can open the live demo on their own, and the
 * meetings before a decision cost nothing; setup, onboarding and the
 * subscription are quoted per operation. The questions are the ones the first
 * call would otherwise spend twenty minutes on, so the quote can be shaped
 * before anyone meets. Only name, company and email are required: every other
 * question is a reason not to send the form, so none of them blocks it.
 */
export const enquiry = {
  title: {
    en: 'Book a demo, and tell us about your operation.',
    ar: 'احجزوا عرضاً تعريفياً، وأخبرونا عن عملكم.',
  },
  body: {
    en: 'A person reads every request and replies within one working day, in Arabic or English. The answers below shape the demo and the quote, so the first call is about your shipments, not a questionnaire.',
    ar: 'يقرأ شخصٌ كل طلب ويرد خلال يوم عمل واحد، بالعربية أو الإنجليزية. الإجابات أدناه تحدد محتوى العرض والتسعيرة، فيكون الاتصال الأول عن شحناتكم لا عن استبيان.',
  },
  steps: [
    {
      title: { en: 'Demo call', ar: 'اتصال تعريفي' },
      body: {
        en: 'Free. Your lanes and your documents, on the real software.',
        ar: 'مجاني. خطوطكم ومستنداتكم، على البرنامج نفسه.',
      },
    },
    {
      title: { en: 'Setup and onboarding', ar: 'الإعداد والتأهيل' },
      body: {
        en: 'Your rate cards, customers, templates and e-invoicing set up, and your team trained.',
        ar: 'إعداد بطاقات أسعاركم وعملائكم وقوالبكم والفوترة الإلكترونية، وتدريب فريقكم.',
      },
    },
    {
      title: { en: 'Live', ar: 'التشغيل' },
      body: {
        en: 'A subscription quoted for your branches and users. No per-shipment fees.',
        ar: 'اشتراك يُسعَّر حسب فروعكم ومستخدميكم. بلا رسوم على كل شحنة.',
      },
    },
  ],
  fields: {
    name: { en: 'Your name', ar: 'الاسم' },
    company: { en: 'Company', ar: 'الشركة' },
    email: { en: 'Work email', ar: 'البريد الإلكتروني للعمل' },
    phone: { en: 'Phone or WhatsApp', ar: 'الهاتف أو واتساب' },
    country: { en: 'Main country', ar: 'الدولة الرئيسية' },
    volume: { en: 'Shipments a month', ar: 'الشحنات شهرياً' },
    branches: { en: 'Branches', ar: 'عدد الفروع' },
    users: { en: 'People who would use it', ar: 'عدد المستخدمين' },
    modes: { en: 'What you move', ar: 'وسائل الشحن لديكم' },
    system: { en: 'What you use today', ar: 'ما تستخدمونه اليوم' },
    einvoicing: { en: 'E-invoicing you need', ar: 'الفوترة الإلكترونية المطلوبة' },
    timeline: { en: 'When you want to be live', ar: 'متى تريدون البدء' },
    message: { en: 'Anything else we should know', ar: 'أي شيء آخر يجب أن نعرفه' },
    optional: { en: 'optional', ar: 'اختياري' },
    choose: { en: 'Choose', ar: 'اختاروا' },
    about: { en: 'About your operation', ar: 'عن عملكم' },
  },
  branchCounts: [
    { value: '1', en: 'One office', ar: 'مكتب واحد' },
    { value: '2-3', en: '2 to 3', ar: 'من 2 إلى 3' },
    { value: '4-10', en: '4 to 10', ar: 'من 4 إلى 10' },
    { value: 'Over 10', en: 'More than 10', ar: 'أكثر من 10' },
  ],
  userCounts: [
    { value: 'Under 10', en: 'Under 10', ar: 'أقل من 10' },
    { value: '10-25', en: '10 to 25', ar: 'من 10 إلى 25' },
    { value: '25-100', en: '25 to 100', ar: 'من 25 إلى 100' },
    { value: 'Over 100', en: 'More than 100', ar: 'أكثر من 100' },
  ],
  modeOptions: [
    { value: 'Sea', en: 'Sea', ar: 'بحري' },
    { value: 'Air', en: 'Air', ar: 'جوي' },
    { value: 'Road', en: 'Road', ar: 'بري' },
    { value: 'Courier', en: 'Courier', ar: 'بريد سريع' },
    { value: 'Customs', en: 'Customs clearance', ar: 'تخليص جمركي' },
  ],
  systems: [
    { value: 'Spreadsheets', en: 'Spreadsheets and email', ar: 'جداول بيانات وبريد' },
    { value: 'CargoWise', en: 'CargoWise', ar: 'CargoWise' },
    { value: 'Logistaas', en: 'Logistaas', ar: 'Logistaas' },
    { value: 'Other software', en: 'Other freight software', ar: 'برنامج شحن آخر' },
    { value: 'In-house', en: 'Our own system', ar: 'نظام خاص بنا' },
  ],
  einvoicingNeeds: [
    { value: 'ZATCA', en: 'Saudi ZATCA', ar: 'زاتكا السعودية' },
    { value: 'UAE', en: 'UAE', ar: 'الإمارات' },
    { value: 'Both', en: 'Both', ar: 'كلاهما' },
    { value: 'None', en: 'Not needed', ar: 'غير مطلوبة' },
    { value: 'Unsure', en: 'Not sure yet', ar: 'غير متأكدين' },
  ],
  timelines: [
    { value: 'This month', en: 'This month', ar: 'هذا الشهر' },
    { value: '1-3 months', en: 'In 1 to 3 months', ar: 'خلال 1 إلى 3 أشهر' },
    { value: '3-6 months', en: 'In 3 to 6 months', ar: 'خلال 3 إلى 6 أشهر' },
    { value: 'Exploring', en: 'Just exploring', ar: 'نستكشف فقط' },
  ],
  countries: [
    { value: 'Kuwait', en: 'Kuwait', ar: 'الكويت' },
    { value: 'UAE', en: 'UAE', ar: 'الإمارات' },
    { value: 'Saudi Arabia', en: 'Saudi Arabia', ar: 'السعودية' },
    { value: 'Bahrain', en: 'Bahrain', ar: 'البحرين' },
    { value: 'Oman', en: 'Oman', ar: 'عُمان' },
    { value: 'Qatar', en: 'Qatar', ar: 'قطر' },
    { value: 'Other', en: 'Elsewhere', ar: 'دولة أخرى' },
  ],
  volumes: [
    { value: 'Under 50', en: 'Under 50', ar: 'أقل من 50' },
    { value: '50-200', en: '50 to 200', ar: 'من 50 إلى 200' },
    { value: '200-1,000', en: '200 to 1,000', ar: 'من 200 إلى 1,000' },
    { value: 'Over 1,000', en: 'Over 1,000', ar: 'أكثر من 1,000' },
  ],
  submit: { en: 'Request a demo', ar: 'اطلبوا العرض التعريفي' },
  sending: { en: 'Sending…', ar: 'جارٍ الإرسال…' },
  /** Beside the form, for a reader who would rather look than talk first. */
  selfServe: {
    en: 'Rather look first? The live demo is open, with no sign-up.',
    ar: 'تفضّلون الاطلاع أولاً؟ النسخة التجريبية مفتوحة، بلا تسجيل.',
  },
  done: {
    title: { en: 'Thank you. We have it.', ar: 'شكراً لكم، وصلنا طلبكم.' },
    body: {
      en: 'We will reply within one working day. If you would rather fix a time now, pick one below.',
      ar: 'سنرد خلال يوم عمل واحد. وإن فضّلتم تحديد موعد الآن، اختاروه أدناه.',
    },
    book: { en: 'Pick a time for the call', ar: 'اختاروا موعد الاتصال' },
  },
  error: {
    missing: {
      en: 'Please fill in your name, company and a work email.',
      ar: 'يرجى إدخال الاسم والشركة وبريد العمل.',
    },
    email: {
      en: 'Please use a valid work email. That address cannot receive mail, or it is a temporary inbox.',
      ar: 'يرجى استخدام بريد عمل صالح. هذا العنوان لا يستقبل البريد، أو أنه بريد مؤقت.',
    },
    busy: {
      en: 'Too many requests from here. Please try again in an hour, or email us.',
      ar: 'طلبات كثيرة من هذا العنوان. يرجى المحاولة بعد ساعة، أو مراسلتنا بالبريد.',
    },
    failed: {
      en: 'That did not go through. Please try again, or email us.',
      ar: 'لم يُرسَل الطلب. يرجى المحاولة مرة أخرى، أو مراسلتنا بالبريد.',
    },
  },
  privacy: {
    en: 'Used only to answer this request. See the privacy policy.',
    ar: 'تُستخدم فقط للرد على هذا الطلب. راجعوا سياسة الخصوصية.',
  },
}

/**
 * The intro-call booking page, offered once a demo request has been sent. A
 * link rather than an embed: an embedded scheduler is a third-party script on
 * every page view for the one visitor in a hundred who books.
 */
export const CALL_URL = 'https://cal.com/techpotions/intro-call-cargosharks'

/**
 * The market pages, as a strip of links on the home page. The header panels
 * that list them only render on hover, so before this the home page's HTML
 * linked to none of the pages written to rank.
 */
export const markets = {
  title: {
    en: 'Freight software for each Gulf market',
    ar: 'برنامج الشحن لكل سوق خليجي',
  },
  lede: {
    en: 'The same product, set up for the currency, the documents and the e-invoicing rules where you work.',
    ar: 'المنتج نفسه، مُعدّاً للعملة والمستندات وقواعد الفوترة الإلكترونية حيث تعملون.',
  },
  jobs: { en: 'Or start from the job', ar: 'أو ابدؤوا من المهمة' },
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
        // The one link with an Arabic twin: the same `hrefAr` shape as `nav`.
        { href: '/blog/', hrefAr: '/ar/blog/', label: { en: 'Blog', ar: 'المدونة' } },
        { href: DEMO_URL, label: { en: 'Live demo', ar: 'النسخة التجريبية' } },
        { href: '/#demo', hrefAr: '/ar/#demo', label: { en: 'Book a demo', ar: 'احجزوا عرضاً' } },
      ],
    },
    {
      heading: { en: 'Compare', ar: 'المقارنات' },
      links: [
        { href: '/compare/cargowise/', label: { en: 'vs CargoWise', ar: 'مقابل CargoWise' } },
        { href: '/compare/logistaas/', label: { en: 'vs Logistaas', ar: 'مقابل Logistaas' } },
        {
          href: '/compare/cargoes-runner/',
          label: { en: 'vs CARGOES Runner', ar: 'مقابل CARGOES Runner' },
        },
        {
          href: '/compare/spreadsheets/',
          label: { en: 'vs spreadsheets', ar: 'مقابل جداول البيانات' },
        },
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
