import type { Bi } from '@/content/copy'

/**
 * The opening section of each comparison page, which is different on each one.
 *
 * The four pages were one component and a table. That is good engineering and
 * it made a bad set of pages: they *could* not differ, so they didn't, and four
 * identical documents read as a template with the nouns swapped.
 *
 * The shared parts stay shared, and deliberately — the questions table, the
 * facts table and the policy note are the promise this site makes on every one
 * of these pages, and a promise that changes shape per page is not a promise.
 * What is different now is the lead, because the reason somebody is comparing
 * us to CargoWise is not the reason they are comparing us to a spreadsheet:
 *
 *   `scale`   the two are not the same size of thing
 *   `peer`    the difference is narrow, and the agreement is most of it
 *   `chain`   who owns the software, and where they stand in the trade
 *   `modes`   three failure moments, told as three moments
 *
 * `modes` also drops the "what they say about themselves" section entirely.
 * A spreadsheet has no vendor and no positioning, and running it through a
 * template that expects one is how the first version ended up with a heading
 * reading "What they say about themselves" over a paragraph about Excel.
 */

export type LeadShape = 'scale' | 'peer' | 'chain' | 'modes'

export interface Lead {
  shape: LeadShape
  eyebrow: Bi
  heading: Bi
  body: Bi
  /** `modes` only: the three moments, each with its own cost. */
  moments?: { when: Bi; what: Bi; instead: Bi }[]
}

export const leads: Record<string, Lead> = {
  cargowise: {
    shape: 'scale',
    eyebrow: { en: '01 — The question underneath', ar: '01 — السؤال الكامن' },
    heading: {
      en: 'This is a question about size, not about features',
      ar: 'هذا سؤال عن الحجم لا عن المزايا',
    },
    body: {
      en: 'Almost every honest sentence on this page follows from one fact: the two are not the same size of thing. A platform that quotes 193 countries and a system built for a Kuwaiti forwarder are not competing to be more capable — they are aimed at different operations, and the overlap between them is where you have to decide.',
      ar: 'تنبع كل جملة صادقة في هذه الصفحة تقريباً من حقيقة واحدة: ليسا شيئاً واحداً في الحجم. فمنصة تذكر 193 دولة ونظام بُني لوكيل شحن كويتي لا يتنافسان على القدرة — بل هما موجَّهان إلى عمليتين مختلفتين، والتداخل بينهما هو موضع القرار.',
    },
  },

  logistaas: {
    shape: 'peer',
    eyebrow: { en: '01 — What we agree on', ar: '01 — ما نتفق عليه' },
    heading: {
      en: 'Most of this comparison is agreement',
      ar: 'معظم هذه المقارنة اتفاق',
    },
    body: {
      en: 'Two cloud systems sold to forwarders the same size in the same region will do most of the same job, and pretending otherwise is how comparison pages lose the reader. Quoting, operations, documents and finance are table stakes and both of us clear them. So this page concedes the middle first, and then spends its length on the crescents — which are narrow, specific, and worth writing down properly.',
      ar: 'نظامان سحابيان يُباعان لوكلاء بالحجم نفسه في المنطقة نفسها سيؤديان معظم العمل نفسه، والتظاهر بغير ذلك هو ما يفقد صفحات المقارنة قارئها. التسعير والعمليات والمستندات والمالية أساسيات نجتازها كلانا. لذا تسلّم هذه الصفحة بالوسط أولاً، ثم تقضي طولها في الهلالين — وهما ضيّقان ومحددان ويستحقان الكتابة بدقة.',
    },
  },

  'cargoes-runner': {
    shape: 'chain',
    eyebrow: { en: '01 — Who owns the software', ar: '01 — لمن البرنامج' },
    heading: {
      en: 'The distinguishing fact here is not a feature',
      ar: 'الحقيقة المميِّزة هنا ليست ميزة',
    },
    body: {
      en: 'DP World operates terminals and also sells software to the forwarders who book through them. Both parties publish that and it is not an accusation — for a forwarder whose volume runs through those terminals, the closeness is the whole reason to choose it. For a forwarder whose volume does not, it is a question worth asking out loud. That is the axis this comparison turns on, and no feature list touches it.',
      ar: 'تشغّل DP World محطات وتبيع أيضاً البرنامج لوكلاء الشحن الذين يحجزون عبرها. وكلا الطرفين ينشر ذلك، وليست تهمة — فالوكيل الذي يمرّ حجمه عبر تلك المحطات يجد في القرب سبب الاختيار كله. أما من لا يمرّ حجمه عبرها فالسؤال يستحق أن يُطرح صراحة. وهذا هو المحور الذي تدور عليه هذه المقارنة، ولا تلمسه قائمة مزايا.',
    },
  },

  spreadsheets: {
    shape: 'modes',
    eyebrow: { en: '01 — Three moments', ar: '01 — ثلاث لحظات' },
    heading: {
      en: 'It does not break gradually. It breaks at three specific moments',
      ar: 'لا ينكسر تدريجياً. ينكسر في ثلاث لحظات بعينها',
    },
    body: {
      en: 'A spreadsheet has no vendor, no roadmap and nothing to misrepresent, so this is the one page here that can be direct. It is also better than most software at several things, which is why it is still winning. What follows is not an argument that it is bad — it is the three moments at which it stops being the cheaper option, each one a thing that has already happened to somebody reading this.',
      ar: 'جدول البيانات بلا مورّد وبلا خارطة طريق وبلا ما يُساء تمثيله، ولذا فهذه الصفحة الوحيدة هنا التي يمكن أن تكون صريحة. وهو أيضاً أفضل من معظم البرمجيات في أمور عدة، ولهذا ما زال يفوز. وما يلي ليس حجة على سوئه — بل هي اللحظات الثلاث التي يكفّ عندها عن كونه الخيار الأرخص، وكل واحدة منها وقعت فعلاً لأحد قرّاء هذه الصفحة.',
    },
    moments: [
      {
        when: { en: 'The second person joins', ar: 'حين ينضم الشخص الثاني' },
        what: {
          en: 'Two people quoting from one workbook eventually send two prices for one lane, and the version that goes out is whichever one the person quoting had open. Nobody notices until the customer puts them side by side.',
          ar: 'شخصان يسعّران من مصنّف واحد سيرسلان في النهاية سعرين لمسار واحد، والنسخة التي تخرج هي التي كانت مفتوحة أمام من يسعّر. ولا ينتبه أحد إلى أن يضعهما العميل جنباً إلى جنب.',
        },
        instead: {
          en: 'A rate card carries a lane, a mode, a carrier and validity dates, and the schema will not accept two that cover the same route at the same time.',
          ar: 'بطاقة السعر تحمل مساراً ووسيلة وناقلاً وتواريخ صلاحية، وبنية القاعدة لا تقبل بطاقتين تغطّيان المسار نفسه في الوقت نفسه.',
        },
      },
      {
        when: { en: 'A container sits past its free days', ar: 'حين تتجاوز حاوية أيام السماح' },
        what: {
          en: 'Starting the counter is somebody’s job and it is nobody’s job. It surfaces six weeks later on a supplier invoice, at which point the question has stopped being how much and become who was supposed to be watching.',
          ar: 'تشغيل العدّاد مهمة أحدهم وليس مهمة أحد. فيظهر بعد ستة أسابيع على فاتورة مورّد، وعندها يكفّ السؤال عن كونه «كم» ويصير «من كان يفترض به أن يراقب».',
        },
        instead: {
          en: 'The milestone that ends free time starts the clock, and the charge line is written against the job on the day rather than found on a statement.',
          ar: 'المرحلة التي ينتهي عندها وقت السماح تشغّل العدّاد، ويُكتب بند التكلفة على الشحنة في يومه لا يُكتشف في كشف حساب.',
        },
      },
      {
        when: { en: 'Somebody asks who changed it', ar: 'حين يسأل أحدهم من غيّره' },
        what: {
          en: 'A spreadsheet has one truth and no history. When a date moved, who moved it and what it said before are not hard questions — they are questions with no answer at all, which is a different and worse thing.',
          ar: 'لجدول البيانات حقيقة واحدة بلا تاريخ. فمتى تغيّر التاريخ ومن غيّره وماذا كان قبله ليست أسئلة صعبة — بل أسئلة بلا جواب البتة، وهذا شيء آخر وأسوأ.',
        },
        instead: {
          en: 'Nothing is deleted. Every change is stamped with who made it and when, and a superseded row is marked superseded and stays where it was.',
          ar: 'لا يُحذف شيء. كل تغيير مختوم بمن أجراه ومتى، والسطر المستبدَل يُعلَّم بأنه مستبدَل ويبقى في موضعه.',
        },
      },
    ],
  },
}
