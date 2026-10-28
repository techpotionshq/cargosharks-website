import type { Bi } from '@/content/copy'

/**
 * The opening section of each comparison page, which is different on each one.
 *
 * The four pages are one component and a table, and that made them identical
 * documents with the nouns swapped. The questions table and the checks table
 * stay shared on purpose: they are the same promise on every page. The lead
 * differs, because the reason somebody compares us to CargoWise is not the
 * reason they compare us to a spreadsheet:
 *
 *   `scale`   the two are not the same size of thing
 *   `peer`    the difference is narrow, and most of it is agreement
 *   `chain`   who owns the software, and where they stand in the trade
 *   `modes`   three failure moments, told as three moments
 *
 * `modes` has no vendor and no positioning to quote, so its page drops the
 * "in their words" quote and its case is the three `moments` rather than a
 * list of points.
 */

export type LeadShape = 'scale' | 'peer' | 'chain' | 'modes'

export interface Lead {
  shape: LeadShape
  heading: Bi
  body: Bi
  /** `modes` only: the three moments, each with what a file does instead. */
  moments?: { when: Bi; what: Bi; instead: Bi }[]
  /**
   * The one screen this page's reader should open first, and what to look at.
   * `file` is a capture of the running build in `public/pic/screens/`; `look`
   * says what to notice, tied to this page's argument.
   */
  shot: { file: string; alt: Bi; look: Bi }
}

export const leads: Record<string, Lead> = {
  cargowise: {
    shape: 'scale',
    heading: {
      en: 'The two are built for different sizes of operation',
      ar: 'بُني كلٌّ منهما لحجم عمليات مختلف',
    },
    body: {
      en: 'A platform that quotes 193 countries and a system built for a Kuwaiti forwarder are aimed at different operations. Where they overlap is where you have to decide, and the question there is which one was built for your size.',
      ar: 'منصة تذكر 193 دولة ونظام بُني لوكيل شحن كويتي موجَّهان إلى عمليتين مختلفتين. وحيث يتداخلان يكون القرار، والسؤال هناك: أيّهما بُني لحجمكم؟',
    },
    shot: {
      file: 'app-dashboard',
      alt: {
        en: 'The dashboard: four figures, a map of live shipments, and the assistant panel',
        ar: 'لوحة المعلومات: أربعة أرقام وخريطة للشحنات الجارية ولوحة المساعد',
      },
      look: {
        en: 'This is the whole of the software rather than one module of it: a system built for one operation shows its edges on the first screen, and nothing here has to be configured before it works.',
        ar: 'هذه هي البرمجية كلها لا وحدة منها: النظام المبني لعملية واحدة تُرى حدوده من أول شاشة، ولا شيء هنا يحتاج إعداداً قبل أن يعمل.',
      },
    },
  },

  logistaas: {
    shape: 'peer',
    heading: {
      en: 'Most of this comparison is agreement',
      ar: 'معظم هذه المقارنة اتفاق',
    },
    body: {
      en: 'Two cloud systems sold to forwarders the same size in the same region do most of the same job. Quoting, operations, documents and finance are table stakes and both of us clear them. The differences sit at the edges, and they are narrow and specific.',
      ar: 'نظامان سحابيان يُباعان لوكلاء بالحجم نفسه في المنطقة نفسها يؤديان معظم العمل نفسه. التسعير والعمليات والمستندات والمالية أساسيات نجتازها كلانا. والفروق عند الأطراف، ضيقة ومحددة.',
    },
    shot: {
      file: 'finance',
      alt: {
        en: 'Receivables grouped by how late they are, largest exposure first',
        ar: 'الذمم المدينة مجمّعة حسب مدة التأخر، والأكبر تعرضاً أولاً',
      },
      look: {
        en: 'One of the edges: every charge line stores its own rate and the moment it was taken, money is decimal from the database to the page, and ageing is grouped by exposure rather than by invoice date.',
        ar: 'أحد الأطراف: كل بند تكلفة يخزّن سعر صرفه ولحظة أخذه، والمال عشري من القاعدة إلى الشاشة، وتقادم الذمم مجمّع حسب حجم التعرض لا حسب تاريخ الفاتورة.',
      },
    },
  },

  'cargoes-runner': {
    shape: 'chain',
    heading: {
      en: 'The difference that matters is who owns the software',
      ar: 'الفرق المهم هو من يملك البرنامج',
    },
    body: {
      en: 'DP World operates terminals and also sells software to the forwarders who book through them. Both parties publish that. For a forwarder whose volume runs through those terminals, the closeness is the reason to choose it; for one whose volume does not, it is a question worth asking out loud.',
      ar: 'تشغّل DP World محطات وتبيع أيضاً البرنامج لوكلاء الشحن الذين يحجزون عبرها. وكلا الطرفين ينشر ذلك. فالوكيل الذي يمرّ حجمه عبر تلك المحطات يجد في القرب سبب الاختيار؛ ومن لا يمرّ حجمه عبرها فالسؤال يستحق أن يُطرح صراحة.',
    },
    shot: {
      file: 'jobs',
      alt: {
        en: 'The operations board: live shipments ordered by exception, oldest first',
        ar: 'لوحة العمليات: الشحنات الجارية مرتّبة حسب الاستثناء، الأقدم أولاً',
      },
      look: {
        en: 'Everything on this board is there because somebody at your desk put it there. We operate no terminal, vessel or depot, so nothing arrives from a party that is also selling you the software; the other side of that is that we have no privileged data feed either.',
        ar: 'كل ما على هذه اللوحة موجود لأن أحداً من مكتبكم وضعه. لا نشغّل محطة ولا سفينة ولا مستودعاً، فلا يصل إليها شيء من طرف يبيعكم البرنامج أيضاً؛ والوجه الآخر أننا بلا تغذية بيانات ذات امتياز كذلك.',
      },
    },
  },

  spreadsheets: {
    shape: 'modes',
    heading: {
      en: 'A spreadsheet breaks at three specific moments',
      ar: 'جدول البيانات ينكسر في ثلاث لحظات بعينها',
    },
    body: {
      en: 'It does not wear out gradually, and it is not bad software. These are the three moments at which it stops being the cheaper option, and each one has already happened to somebody reading this.',
      ar: 'لا يبلى تدريجياً، وليس برنامجاً سيئاً. هذه هي اللحظات الثلاث التي يكفّ عندها عن كونه الخيار الأرخص، وكل واحدة منها وقعت فعلاً لأحد قرّاء هذه الصفحة.',
    },
    shot: {
      file: 'enquiries',
      alt: {
        en: 'The enquiry queue: every enquiry with an owner, a status and a response deadline',
        ar: 'طابور الاستفسارات: لكل استفسار مالك وحالة وموعد للرد',
      },
      look: {
        en: 'An owner, a status, and a deadline that is measured rather than remembered. A shared workbook can have those headings; it has nothing that objects when they are left empty.',
        ar: 'مالك، وحالة، وموعدٌ يُقاس لا يُتذكَّر. يستطيع المصنّف المشترك أن يحمل هذه العناوين؛ لكنه لا يملك ما يعترض حين تُترك فارغة.',
      },
    },
    moments: [
      {
        when: { en: 'The second person joins', ar: 'حين ينضم الشخص الثاني' },
        what: {
          en: 'Two people quoting from one workbook eventually send two prices for one lane, and the one that goes out is whichever the person quoting had open. Nobody notices until the customer puts them side by side.',
          ar: 'شخصان يسعّران من مصنّف واحد سيرسلان في النهاية سعرين لمسار واحد، والذي يخرج هو ما كان مفتوحاً أمام من يسعّر. ولا ينتبه أحد إلى أن يضعهما العميل جنباً إلى جنب.',
        },
        instead: {
          en: 'A rate card carries a lane, a mode, a carrier and validity dates, and the database will not accept two that cover the same route at the same time.',
          ar: 'بطاقة السعر تحمل مساراً ووسيلة وناقلاً وتواريخ صلاحية، وقاعدة البيانات لا تقبل بطاقتين تغطّيان المسار نفسه في الوقت نفسه.',
        },
      },
      {
        when: { en: 'A container sits past its free days', ar: 'حين تتجاوز حاوية أيام السماح' },
        what: {
          en: 'Starting the counter is everybody’s job and nobody’s. It surfaces six weeks later on a supplier invoice, when the question is no longer how much but who was supposed to be watching.',
          ar: 'تشغيل العدّاد مهمة الجميع وليس مهمة أحد. فيظهر بعد ستة أسابيع على فاتورة مورّد، حين لا يعود السؤال «كم» بل «من كان يفترض به أن يراقب».',
        },
        instead: {
          en: 'The milestone that starts free time starts the clock, and the charge line is written to the job on the day rather than found on a statement.',
          ar: 'المرحلة التي يبدأ عندها وقت السماح تشغّل العدّاد، ويُكتب بند التكلفة على الشحنة في يومه لا يُكتشف في كشف حساب.',
        },
      },
      {
        when: { en: 'Somebody asks who changed it', ar: 'حين يسأل أحدهم من غيّره' },
        what: {
          en: 'A spreadsheet has one truth and no history. When a date moved, who moved it and what it said before are questions with no answer at all.',
          ar: 'لجدول البيانات حقيقة واحدة بلا تاريخ. فمتى تغيّر التاريخ ومن غيّره وماذا كان قبله أسئلة بلا جواب البتة.',
        },
        instead: {
          en: 'Nothing is deleted. A database trigger stamps every change with who made it and when, and a superseded row is marked superseded and stays where it was.',
          ar: 'لا يُحذف شيء. مُشغِّل في قاعدة البيانات يختم كل تغيير بمن أجراه ومتى، والسطر المستبدَل يُعلَّم بأنه مستبدَل ويبقى في موضعه.',
        },
      },
    ],
  },
}
