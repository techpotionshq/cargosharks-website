/**
 * The blog as it stood when it moved into the CMS: the posts that were files
 * under content/blog/ (the published demurrage post, and the customs draft
 * that was waiting in a pull request) and the topic backlog that was
 * scripts/blog/topics.json. Read once, by src/migrations/20261027_210000_seed_content.ts.
 */

type SeedCopy = {
  title: string
  excerpt: string
  metaDescription?: string | null
  focusKeyword?: string | null
  faqs: { question: string; answer: string }[]
  body: string
}

type SeedPost = {
  slug: string
  status: 'published' | 'draft'
  publishedAt: string
  author: string
  tags: string[]
  source: 'ai' | 'human'
  cover: string | null
  topicKey: string | null
  en: SeedCopy
  ar: SeedCopy
}

type SeedTopic = {
  key: string
  title: string
  status: 'ready' | 'written' | 'rejected'
  archetype:
    'explainer' | 'guide' | 'checklist' | 'regulation' | 'comparison' | 'alternatives' | 'use-case'
  targetQuery: string
  audience?: string | null
  angle?: string | null
  expertNote?: string | null
  keywords: string[]
  internalLinks: string[]
}

export const seedPosts: SeedPost[] = [
  {
    slug: 'demurrage-vs-detention',
    status: 'published',
    publishedAt: '2026-10-27',
    author: 'CargoSharks',
    tags: ['demurrage', 'detention', 'free time', 'ocean freight'],
    source: 'ai',
    cover: 'demurrage-vs-detention.webp',
    topicKey: 'demurrage-vs-detention',
    en: {
      title: 'Demurrage vs detention: what each charge means and when the clock runs',
      excerpt:
        'Demurrage is the charge for a container inside the terminal past its free days. Detention is the charge for a container outside the terminal past its free days. Here is how each clock starts, ends and gets billed in Kuwait, the UAE and Saudi Arabia.',
      metaDescription:
        'Demurrage vs detention explained for freight forwarders in Kuwait, the UAE and Saudi Arabia. Learn where each charge applies, when the clock starts, and how to track both.',
      focusKeyword: 'demurrage vs detention',
      faqs: [
        {
          question: 'What is the difference between demurrage and detention?',
          answer:
            'Demurrage is the daily charge for a container that stays inside the port or terminal after its free days run out. Detention is the daily charge for a container that stays outside the terminal, with the consignee, forwarder or transporter, after its free days run out. The difference is where the container sits and who bills for the delay.',
        },
        {
          question: 'When does demurrage start on an import?',
          answer:
            'On an import, the demurrage clock starts at discharge from the vessel. The container gets its free days from that point, and if it stays in the terminal beyond them, demurrage accrues for each extra day until it is gated out.',
        },
        {
          question: 'When does detention start on an export?',
          answer:
            'On an export, detention usually starts when the empty container is collected from the depot. It runs until the laden container is gated in at the port.',
        },
        {
          question: 'Can one container be charged both demurrage and detention?',
          answer:
            'Yes. On an import, demurrage can build up while the container sits in the terminal after discharge, and detention can start after gate-out if the empty is returned late. One shipment then shows two separate debit notes.',
        },
        {
          question: 'Do demurrage and detention share the same free time?',
          answer:
            'No. In most Gulf tariffs the line sets detention free time separately from terminal demurrage free time, unless the contract explicitly offers a combined pool.',
        },
      ],
      body: "Demurrage vs detention is simpler than it sounds: demurrage is the daily charge for a shipping container that stays inside the port or terminal beyond its free days, and detention is the daily charge for a container that stays outside the terminal beyond its free days. In Kuwait, the UAE and Saudi Arabia, these appear as separate charges in the line's or terminal's tariff, so one container can earn both on a single shipment.\n\n## Demurrage vs detention: what each one means\n\nBoth charges exist because a shipping container is an asset that costs the owner money when it is not moving. The difference between demurrage and detention is where the container sits and who bills for the delay.\n\nDemurrage applies while the container is inside the terminal or port. Detention applies while the container is with the consignee, forwarder or transporter outside the gate. The free time is separate in most Gulf tariffs.\n\n## What is demurrage?\n\nDemurrage is the daily charge a terminal or shipping line applies when a laden container stays inside the port or terminal past the free days in the tariff.\n\nFor an import, the demurrage clock starts at discharge. The container gets its free days from that point. If it stays in the terminal beyond those free days, demurrage accrues for each extra day or part of a day until the container exits the terminal gate.\n\nFor an export, the demurrage clock starts when the laden container is gated into the terminal. If the container is sent in too early, or the vessel is late, and the container stays in the terminal beyond the free days, demurrage accrues until the container loads.\n\nFree days vary by port, carrier, contract, equipment type and whether the container is dry, reefer or out of gauge. Some terminals count calendar days. Others count from a specific cut-off time. The desk should check the line's tariff and the terminal's schedule before quoting the job.\n\nWho bills demurrage varies in Gulf ports. The terminal or the line through the local agent may issue the debit note. Either way, it lands in the job as a supplier cost.\n\nEvidence for demurrage comes from the discharge list, the gate-out pass and the terminal system timestamps. These show whether the container was inside the terminal past free time.\n\n## What is detention?\n\nDetention is the daily charge a shipping line applies when the container stays outside the terminal beyond the free days allowed for returning the empty.\n\nFor an import, the detention clock starts at gate-out. The consignee or transporter takes the container for unloading. After unpacking, the empty must go back to the depot or terminal stated on the release. If the empty returns late, detention accrues.\n\nFor an export, detention usually starts when an empty container is collected from the depot. It runs until the laden container is gated in at the port. Holding the empty too long before stuffing, or delaying the return of the loaded unit to the port, attracts detention.\n\nThe line sets detention free time separately from terminal demurrage free time. A common mistake is to assume the two clocks share one free period. In many Gulf tariffs they do not, unless the contract explicitly offers a combined pool.\n\nEvidence for detention comes from the gate-out pass, the empty return receipt and the depot in-gate timestamp.\n\n## Demurrage vs detention at a glance\n\nDemurrage and detention differ in where the container sits, who bills, and which milestone starts and ends each clock. The clean rule is that the container passing through the gate changes which clock runs.\n\n| Criterion | Demurrage | Detention |\n|---|---|---|\n| Where the container is | Inside the port or terminal | Outside the terminal with the forwarder, transporter or consignee |\n| Who charges | Terminal or line through the agent | Shipping line |\n| Import clock starts | Discharge, after free days | Gate-out from the terminal |\n| Import clock ends | Gate-out from the terminal | Empty return to the depot |\n| Export clock starts | Laden gate-in to the terminal | Empty pickup from the depot |\n| Export clock ends | Vessel loading | Laden gate-in to the terminal |\n| Free time | Set by terminal or line tariff | Set by line tariff |\n| Typical evidence | Discharge list, gate-out pass | Gate-out pass, empty return receipt |\n\n## The same container can earn both charges\n\nAn import container can earn demurrage and detention in sequence.\n\nThe vessel discharges the container. The terminal gives free days. If the container stays in the terminal past those free days, demurrage accrues. Once the forwarder or consignee collects it through the gate, demurrage stops and detention starts. If the empty returns late, detention accrues.\n\nThis is why a single shipment can show two separate debit notes. It is also why a delay at customs, or a missing delivery order, can start one charge and then push the next charge to run late.\n\nThe forwarder should not assume one charge replaces the other. Each sits on its own clock, with its own free days and its own billing party.\n\n## The milestones that start each clock\n\nA job file becomes much easier to reconcile when the desk records the exact milestones.\n\nImport milestones:\n\n- Discharge: starts the demurrage free time.\n- Gate-out: ends demurrage and starts detention.\n- Empty return: ends detention.\n\nExport milestones:\n\n- Empty pickup: starts detention free time.\n- Laden gate-in: ends detention and starts demurrage free time.\n- Vessel loading: ends demurrage.\n\nIf any of these milestones is missing, or has only a date and no time, the desk cannot prove which side caused the delay. In the Gulf, gate passes and terminal receipts carry these timestamps. Keep them in the same folder as the job.\n\n## What a forwarder should check before free time ends\n\nA short operational checklist helps.\n\n- Read the line's tariff before quoting. Confirm the free days for demurrage and detention separately.\n- Confirm whether free days are calendar days or working days, and what the cut-off time is.\n- Check Gulf working days. Fridays, Saturdays, public holidays and Ramadan hours affect when gates and customs desks are open.\n- If customs inspection or missing documents may delay gate-out, flag it at discharge, not after free time has passed.\n- If the consignee cannot collect or return the container in time, request an extension from the line or terminal before the free time expires. Extensions are not guaranteed and may have their own conditions.\n- Record the gate-out and empty return timestamps the same day they happen.\n\nCustoms release is a common source of delay. In Saudi Arabia, the clearance process includes the customs declaration and any inspection. In the UAE, the delivery order and gate pass come after customs release. In Kuwait, the port release and gate pass follow the customs decision. Each of these steps sits before gate-out and can consume demurrage free days if the paperwork waits.\n\nWaiting until the debit note arrives is too late. By then the argument is about the invoice, not about the operation.\n\n## What a desk should do about demurrage and detention\n\nGive the job a clear rule: record the free time expiry as a task in the file, with a reminder before it falls due. Then record the actual gate-out and empty return against the same job.\n\nBefore approving a demurrage or detention [invoice](/freight-invoicing-software/), match the charges against the milestone dates. If the terminal says demurrage ran three days, check the discharge date and the gate-out pass. If the line says detention ran five days, check the gate-out and the empty return receipt.\n\nPut the responsibility in writing at the quote stage. If the consignee owns the delay, the quote or SOP should say so. If the forwarder owns the delay, absorb it and log the reason. The operations team manages the clock. The finance team checks the invoice.\n\n[CargoSharks](/what-we-do/) records the milestone that starts each free time clock, such as discharge or gate-out, and writes the demurrage or detention charge line into the job as the clock runs. That gives operations and finance one place to see the charge forming before the supplier invoice arrives.\n\nTo size the problem for your own desk, the [free time cost calculator](/#calculator) on the CargoSharks home page estimates what overruns cost a month from your container volume, the share that overrun, the days over and the daily charge.\n",
    },
    ar: {
      title: 'الأرضيات مقابل غرامة التأخير: معنى كل رسم ومتى يبدأ احتسابه',
      excerpt:
        'الأرضيات هي الرسم اليومي على الحاوية التي تبقى داخل الميناء بعد انتهاء فترة السماح، وغرامة التأخير هي الرسم اليومي على الحاوية التي تبقى خارج الميناء بعد انتهاء فترة السماح. إليكم الفرق بينهما ومتى يبدأ احتساب كل منهما في الكويت والإمارات والسعودية.',
      metaDescription:
        'تعرفوا على الفرق بين الأرضيات وغرامة التأخير في الشحن البحري، ومتى يبدأ احتساب كل رسم، وكيف تتجنبونها في موانئ الكويت والإمارات والسعودية.',
      focusKeyword: 'الفرق بين الأرضيات وغرامة التأخير',
      faqs: [
        {
          question: 'ما الفرق بين الأرضيات وغرامة التأخير؟',
          answer:
            'الأرضيات هي الرسم اليومي على الحاوية التي تبقى داخل الميناء أو المحطة بعد انتهاء أيام السماح. وغرامة التأخير هي الرسم اليومي على الحاوية التي تبقى خارج المحطة لدى المخلص أو الناقل أو المرسل إليه بعد انتهاء أيام السماح. الفرق الأساسي هو مكان وجود الحاوية ومن يحرر الفاتورة.',
        },
        {
          question: 'متى يبدأ احتساب الأرضيات في الاستيراد؟',
          answer:
            'في الاستيراد، يبدأ احتساب الأرضيات عند تفريغ الحاوية من السفينة. تحصل الحاوية على أيام السماح من تلك النقطة، وإذا بقيت في المحطة بعدها تتراكم الأرضيات عن كل يوم إضافي.',
        },
        {
          question: 'متى تبدأ غرامة التأخير في التصدير؟',
          answer:
            'في التصدير، تبدأ غرامة التأخير عادة عند استلام الحاوية الفارغة من المستودع، وتستمر حتى دخول الحاوية المشحونة إلى الميناء عبر البوابة.',
        },
        {
          question: 'هل يمكن أن تتحمل الحاوية الواحدة الرسمين معاً؟',
          answer:
            'نعم. في الاستيراد، قد تتراكم الأرضيات أثناء وجود الحاوية في المحطة بعد التفريغ، ثم تبدأ غرامة التأخير بعد الخروج من البوابة إذا تأخرت إعادة الحاوية الفارغة. وهكذا تظهر شحنة واحدة بإشعاري خصم منفصلين.',
        },
        {
          question: 'هل أيام السماح موحدة بين الأرضيات وغرامة التأخير؟',
          answer:
            'لا. في معظم تعرفات الخليج، يحدد الخط الملاحي فترة سماح غرامة التأخير بشكل منفصل عن فترة سماح أرضيات المحطة، إلا إذا نص العقد صراحة على رصيد مشترك.',
        },
      ],
      body: 'الفرق بين الأرضيات وغرامة التأخير أبسط مما يبدو: الأرضيات هي الرسم اليومي على حاوية الشحن التي تبقى داخل الميناء أو المحطة بعد انتهاء أيام السماح، وغرامة التأخير هي الرسم اليومي على الحاوية التي تبقى خارج المحطة بعد انتهاء أيام السماح. في الكويت والإمارات والسعودية، يظهر هذان الرسمان كبنود منفصلة في تعرفة الخط الملاحي أو المحطة، لذا يمكن أن تتحمل الحاوية الواحدة كلا الرسمين في شحنة واحدة.\n\n## الأرضيات وغرامة التأخير: ماذا يعني كل منهما\n\nيوجد الرسمان لأن حاوية الشحن أصل يكلف مالكه مالاً عندما لا يتحرك. الفرق بين الأرضيات وغرامة التأخير هو مكان وجود الحاوية ومن يحرر فاتورة التأخير.\n\nتُطبق الأرضيات أثناء وجود الحاوية داخل المحطة أو الميناء. وتُطبق غرامة التأخير أثناء وجود الحاوية لدى المرسل إليه أو المخلص أو الناقل خارج البوابة. وفترة السماح منفصلة في معظم تعرفات الخليج.\n\n## ما هي الأرضيات؟\n\nالأرضيات هي الرسم اليومي الذي تفرضه المحطة أو الخط الملاحي عندما تبقى الحاوية المشحونة داخل الميناء أو المحطة بعد انتهاء أيام السماح المنصوص عليها في التعرفة.\n\nفي الاستيراد، يبدأ احتساب الأرضيات عند التفريغ. وتحصل الحاوية على أيام السماح الخاصة بها من تلك النقطة. إذا بقيت في المحطة بعد تلك الأيام، تتراكم الأرضيات عن كل يوم إضافي أو جزء من اليوم حتى تخرج الحاوية من بوابة المحطة.\n\nفي التصدير، يبدأ احتساب الأرضيات عندما تدخل الحاوية المشحونة إلى المحطة عبر البوابة. إذا أُرسلت الحاوية مبكراً جداً، أو تأخرت السفينة، وبقيت الحاوية في المحطة بعد أيام السماح، تتراكم الأرضيات حتى تحميل الحاوية على السفينة.\n\nتختلف أيام السماح حسب الميناء والناقل والعقد ونوع المعدة وما إذا كانت الحاوية جافة أو مبردة أو خارج المقاس. بعض المحطات تحتسب الأيام التقويمية. وبعضها الآخر يحتسب من وقت قطع محدد. يجب على المكتب مراجعة تعرفة الخط الملاحي وجدول المحطة قبل تسعير العملية.\n\nيختلف من يحرر فاتورة الأرضيات في موانئ الخليج. قد تصدر المحطة إشعار الخصم أو يصدره الخط الملاحي عبر الوكيل المحلي. وفي الحالتين، يدخل الرسم في ملف العملية كتكلفة مورد.\n\nتأتي أدلة الأرضيات من قائمة التفريغ وتصريح الخروج من البوابة والطوابع الزمنية في نظام المحطة. فهي تُظهر ما إذا كانت الحاوية داخل المحطة بعد انتهاء فترة السماح.\n\n## ما هي غرامة التأخير؟\n\nغرامة التأخير هي الرسم اليومي الذي يفرضه الخط الملاحي عندما تبقى الحاوية خارج المحطة بعد انتهاء أيام السماح المسموح بها لإعادة الحاوية الفارغة.\n\nفي الاستيراد، يبدأ احتساب غرامة التأخير عند الخروج من البوابة. يستلم المرسل إليه أو الناقل الحاوية لتفريغها. وبعد التفريغ، يجب إعادة الحاوية الفارغة إلى المستودع أو المحطة المحددة في إذن التسليم. إذا تأخرت إعادة الحاوية الفارغة، تتراكم غرامة التأخير.\n\nفي التصدير، تبدأ غرامة التأخير عادة عند استلام الحاوية الفارغة من المستودع. وتستمر حتى دخول الحاوية المشحونة إلى الميناء عبر البوابة. والاحتفاظ بالحاوية الفارغة مدة طويلة قبل التعبئة، أو تأخير إعادة الوحدة المحملة إلى الميناء، يستوجب غرامة التأخير.\n\nيحدد الخط الملاحي فترة سماح غرامة التأخير بشكل منفصل عن فترة سماح أرضيات المحطة. ومن الأخطاء الشائعة افتراض أن الساعتين تشتركان في فترة سماح واحدة. في كثير من تعرفات الخليج لا تشتركان، إلا إذا نص العقد صراحة على رصيد مشترك.\n\nتأتي أدلة غرامة التأخير من تصريح الخروج من البوابة وإيصال إعادة الحاوية الفارغة والطابع الزمني لدخول المستودع.\n\n## الأرضيات مقابل غرامة التأخير في لمحة\n\nتختلف الأرضيات وغرامة التأخير في مكان وجود الحاوية ومن يحرر الفاتورة وأي مرحلة تبدأ وتنهي كل ساعة. القاعدة الواضحة هي أن مرور الحاوية عبر البوابة يغير الساعة الجارية.\n\n| المعيار | الأرضيات | غرامة التأخير |\n|---|---|---|\n| مكان وجود الحاوية | داخل الميناء أو المحطة | خارج المحطة لدى المخلص أو الناقل أو المرسل إليه |\n| من يفرض الرسم | المحطة أو الخط الملاحي عبر الوكيل | الخط الملاحي |\n| بداية احتساب رسوم الاستيراد | التفريغ، بعد أيام السماح | الخروج من بوابة المحطة |\n| نهاية احتساب رسوم الاستيراد | الخروج من بوابة المحطة | إعادة الحاوية الفارغة إلى المستودع |\n| بداية احتساب رسوم التصدير | دخول الحاوية المشحونة إلى المحطة | استلام الحاوية الفارغة من المستودع |\n| نهاية احتساب رسوم التصدير | تحميل السفينة | دخول الحاوية المشحونة إلى المحطة |\n| فترة السماح | تحددها المحطة أو تعرفة الخط الملاحي | تحددها تعرفة الخط الملاحي |\n| الأدلة النموذجية | قائمة التفريغ، تصريح الخروج من البوابة | تصريح الخروج من البوابة، إيصال إعادة الحاوية الفارغة |\n\n## الحاوية نفسها قد تتحمل الرسمين\n\nقد تتحمل حاوية الاستيراد الأرضيات وغرامة التأخير بالتتابع.\n\nتفرغ السفينة الحاوية. وتمنح المحطة أيام سماح. إذا بقيت الحاوية في المحطة بعد تلك الأيام، تتراكم الأرضيات. وبمجرد استلام المخلص أو المرسل إليه للحاوية عبر البوابة، تتوقف الأرضيات وتبدأ غرامة التأخير. وإذا تأخرت إعادة الحاوية الفارغة، تتراكم غرامة التأخير.\n\nلهذا قد تظهر شحنة واحدة بإشعاري خصم منفصلين. ولهذا أيضاً قد يؤدي التأخير في التخليص الجمركي، أو غياب أمر التسليم، إلى بدء رسم ثم دفع الرسم التالي إلى التأخر.\n\nلا ينبغي للمخلص أن يفترض أن أحد الرسمين يحل محل الآخر. فكل منهما يعمل بساعته الخاصة وبأيام سماحه الخاصة وبجهة الفوترة الخاصة به.\n\n## المراحل التي تبدأ عندها كل ساعة\n\nيصبح التوفيق في ملف العملية أسهل كثيراً عندما يسجل المكتب المراحل المحددة بدقة.\n\nمراحل الاستيراد:\n\n- التفريغ: يبدأ فترة سماح الأرضيات.\n- الخروج من البوابة: ينهي الأرضيات ويبدأ غرامة التأخير.\n- إعادة الحاوية الفارغة: تنهي غرامة التأخير.\n\nمراحل التصدير:\n\n- استلام الحاوية الفارغة: يبدأ فترة سماح غرامة التأخير.\n- دخول الحاوية المشحونة: ينهي غرامة التأخير ويبدأ فترة سماح الأرضيات.\n- تحميل السفينة: ينهي الأرضيات.\n\nإذا غابت أي من هذه المراحل، أو تضمنت تاريخاً فقط دون وقت، فلن يستطيع المكتب إثبات أي طرف تسبب في التأخير. في الخليج، تحمل تصاريح البوابة وإيصالات المحطة هذه الطوابع الزمنية. احتفظوا بها في المجلد نفسه مع ملف العملية.\n\n## ما يجب على المخلص التحقق منه قبل انتهاء فترة السماح\n\nقائمة تحقق تشغيلية قصيرة تساعد.\n\n- اقرؤوا تعرفة الخط الملاحي قبل التسعير. وأكدوا أيام السماح للأرضيات وغرامة التأخير كل على حدة.\n- تأكدوا مما إذا كانت أيام السماح أياماً تقويمية أم أيام عمل، وما هو وقت القطع.\n- تحققوا من أيام العمل في الخليج. تؤثر أيام الجمعة والسبت والعطلات الرسمية وساعات رمضان على مواعيد فتح البوابات ومكاتب الجمارك.\n- إذا كان الفحص الجمركي أو نقص المستندات قد يؤخر الخروج من البوابة، فضعوا علامة على ذلك عند التفريغ، وليس بعد انتهاء فترة السماح.\n- إذا لم يستطع المرسل إليه استلام الحاوية أو إعادتها في الوقت المحدد، فاطلبوا تمديداً من الخط الملاحي أو المحطة قبل انتهاء فترة السماح. التمديدات غير مضمونة وقد تكون لها شروطها الخاصة.\n- سجلوا طوابع الخروج من البوابة وإعادة الحاوية الفارغة في اليوم نفسه الذي تحدث فيه.\n\nالإفراج الجمركي مصدر شائع للتأخير. في السعودية، تشمل عملية التخليص البيان الجمركي وأي فحص. وفي الإمارات، يصدر أمر التسليم وتصريح البوابة بعد الإفراج الجمركي. وفي الكويت، يلي الإفراج عن الميناء وتصريح البوابة القرار الجمركي. كل خطوة من هذه الخطوات تسبق الخروج من البوابة وقد تستهلك أيام سماح الأرضيات إذا انتظرت الأوراق.\n\nالانتظار حتى وصول إشعار الخصم متأخر جداً. عندها يصبح النقاش حول الفاتورة لا حول العملية.\n\n## ماذا يفعل المكتب بشأن الأرضيات وغرامة التأخير\n\nضعوا للعملية قاعدة واضحة: سجلوا انتهاء فترة السماح كمهمة في الملف، مع تذكير قبل حلول موعدها. ثم سجلوا الخروج الفعلي من البوابة وإعادة الحاوية الفارغة في العملية نفسها.\n\nقبل اعتماد فاتورة أرضيات أو غرامة تأخير، طابقوا الرسوم مع تواريخ المراحل. إذا قالت المحطة إن الأرضيات استمرت ثلاثة أيام، فتحققوا من تاريخ التفريغ وتصريح الخروج من البوابة. وإذا قال الخط الملاحي إن غرامة التأخير استمرت خمسة أيام، فتحققوا من الخروج من البوابة وإيصال إعادة الحاوية الفارغة.\n\nضعوا المسؤولية كتابياً في مرحلة التسعير. إذا كان المرسل إليه هو المسؤول عن التأخير، فيجب أن ينص عرض السعر أو إجراءات التشغيل الموحدة على ذلك. وإذا كان المخلص هو المسؤول عن التأخير، فليتحمل التكلفة ويسجل السبب. فريق العمليات يدير الساعة. وفريق الشؤون المالية يدقق الفاتورة.\n\nيسجل [CargoSharks](/what-we-do/) المرحلة التي تبدأ عندها كل ساعة فترة سماح، مثل التفريغ أو الخروج من البوابة، ويكتب سطر رسم الأرضيات أو غرامة التأخير في العملية أثناء جريان الساعة. وهذا يمنح العمليات والشؤون المالية مكاناً واحداً لرؤية الرسم يتكون قبل وصول فاتورة المورد.\n\nولتقدير حجم المشكلة لدى مكتبكم، تقدّر [حاسبة تكلفة وقت السماح](/ar/#calculator) في الصفحة الرئيسية لـ CargoSharks ما تكلّفه التجاوزات شهرياً، انطلاقاً من عدد الحاويات ونسبة ما يتجاوز وقت السماح وأيام التجاوز والرسم اليومي.\n',
    },
  },
  {
    slug: 'how-customs-clearance-works-for-imports-into-kuwait',
    status: 'draft',
    publishedAt: '2026-10-27',
    author: 'CargoSharks',
    tags: ['how-to-guide'],
    source: 'ai',
    cover: 'how-customs-clearance-works-for-imports-into-kuwait.webp',
    topicKey: 'kuwait-customs-clearance-steps',
    en: {
      title: 'How customs clearance works for imports into Kuwait',
      excerpt:
        'The arrival-to-release sequence as an operations desk sees it, and where the file usually stalls.',
      metaDescription:
        'Step by step Kuwait customs clearance process for forwarders and customs brokers: documents, declaration, payment, inspection, and release.',
      focusKeyword: 'customs clearance Kuwait',
      faqs: [
        {
          question: 'Who handles customs clearance for imports into Kuwait?',
          answer:
            'A licensed customs broker prepares and submits the declaration. The forwarder or consignee supplies the import clearance documents, approvals, and payments. Transport takes over after release.',
        },
        {
          question: 'What documents are needed for Kuwait customs clearance?',
          answer:
            'The usual set includes the bill of lading or air waybill, commercial invoice, packing list, certificate of origin, delivery order, and any product-specific permits or licences.',
        },
        {
          question: 'Where do Kuwait import clearance files usually stall?',
          answer:
            'Most files stall before the declaration is accepted. The common causes are document mismatches, missing permits, vague invoice descriptions, and unclear HS classification.',
        },
        {
          question: 'When should import clearance work start in Kuwait?',
          answer:
            'Start at booking. Pre-clearance work before arrival is the control point that reduces port storage and demurrage after discharge.',
        },
      ],
      body: 'Customs clearance Kuwait follows a set sequence from arrival to release. The physical cargo usually waits while the file moves. Most delays happen before the declaration is accepted. This guide follows the file as an operations desk sees it: documents, declaration, payment, inspection, release, and the handover to transport.\n\n## Customs clearance Kuwait: the sequence from arrival to release\n\nThe answer is that clearance is document-first. The port or airport release comes only after the file closes. The work runs in this order.\n\n1. The carrier sends an arrival notice.\n2. You collect the delivery order from the shipping agent or airline.\n3. You collect and check the import clearance documents.\n4. The customs broker prepares and submits the declaration.\n5. Customs assesses duties and fees.\n6. The shipment may go to inspection.\n7. Customs issues the release order.\n8. Transport picks up and delivers.\n\nThe broker usually handles steps 4 to 7. The forwarder or consignee handles the documents and pays charges. The transport team takes over after release.\n\nThis sequence is stable. The time each step takes varies by port, cargo type, and documentation.\n\n## Kuwait customs clearance documents: what to collect before arrival\n\nThe import clearance documents are the set that proves the goods, the value, the origin, and the consignee. Start collection as soon as the shipment is confirmed.\n\n| Document | Who issues it | What the desk checks |\n|---|---|---|\n| Bill of lading or air waybill | Carrier | Consignee, notify party, marks, freight terms |\n| Commercial invoice | Shipper | Description, value, currency, HS code, Incoterms |\n| Packing list | Shipper | Package count, weights, dimensions, marks |\n| Certificate of origin | Chamber of commerce or exporter | Country of origin matches declaration |\n| Delivery order | Shipping agent or airline | Available after freight and local charges are settled |\n| Product permits or licences | Relevant Kuwait authority | Required for the specific goods |\n\nDo not wait for arrival to find a missing certificate. Ask the shipper for the full set before the vessel or flight departs. If the goods need a permit, confirm the permit before loading.\n\nThe invoice description matters. A vague description such as "general goods" leads to holds and questions. The description should say what the goods are, what they are made of, and their intended use where that affects classification.\n\n## Where Kuwait import clearance files usually stall\n\nMost files stall before the declaration is accepted. The usual causes are document mismatches, missing permits, and unclear classification.\n\n| Stall point | Where it happens | What to do |\n|---|---|---|\n| Consignee name differs from licence or civil ID | Delivery order and declaration | Check the consignee before the bill is issued |\n| Invoice contains vague or generic description | Declaration review | Get a precise commercial description before submission |\n| Certificate of origin missing or exporter name differs | Declaration review | Request it before arrival and compare to the invoice |\n| Freight charges unpaid | Delivery order | Confirm payment status before vessel arrival |\n| HS code not agreed | Duty assessment | Agree the code with the broker before submission |\n| Inspection hold | Customs inspection | Send the required documents the same day |\n\nThe most expensive delay is a missing permit. If the goods require a permit and the shipper did not obtain it, the cargo may wait at the port. This is a commercial and regulatory issue, not just a paperwork issue.\n\nClearance does not start at the gate. It starts when the shipment is booked. Pre-clearance work is what separates a clean release from a storage and demurrage bill.\n\n## How to keep a Kuwait customs clearance file moving\n\nThe control point is pre-arrival. A file that is complete before arrival clears faster than a file assembled after discharge.\n\nFollow this order.\n\n1. Open the file when the booking is confirmed.\n2. Request the commercial invoice, packing list, and certificate of origin immediately.\n3. Check the consignee against the import licence or civil ID.\n4. Confirm the HS code and duty rate with the broker.\n5. Get the consignee\'s approval on duties and fees before declaration.\n6. Submit the declaration as soon as the delivery order is ready.\n7. If Customs rejects the declaration, correct it the same day.\n8. Record the release and hand the file to transport.\n\nTrack five dates: arrival, documents complete, declaration submitted, payment, release. When one date slips, chase that step.\n\nDuty amounts vary by HS code. Do not guess. The broker confirms the rate and the payable amount with the consignee before submission.\n\n## Customs broker Kuwait: who handles each step\n\nThe broker moves the file. The consignee gives authority and approvals. The transport provider takes over after release.\n\n| Step | Broker | Consignee or forwarder | Transport |\n|---|---|---|---|\n| Arrival notice | Receives it | Confirms cargo and consignee | Waits for release |\n| Delivery order | Collects from agent | Pays freight and local charges | Not yet involved |\n| Document check | Reviews set | Provides missing documents | Not yet involved |\n| Declaration | Prepares and submits | Approves duties | Not yet involved |\n| Inspection | Attends or coordinates | Provides supporting documents | Not yet involved |\n| Release | Receives release order | Pays Customs duties | Collects delivery instructions |\n| Delivery | Hands over documents | Confirms delivery address | Picks up and delivers |\n\nUse a written checklist for each file. The checklist keeps the broker, consignee, and transport team on the same step.\n\nSoftware does not clear cargo. People do. CargoSharks keeps the clearance file in one place: customs status and document issue in Arabic and English, costs, and customer invoicing. See the [Kuwait scope](/freight-forwarding-software-kuwait/) and the [customs scope](/customs-clearance-software/).\n',
    },
    ar: {
      title: 'كيف يعمل التخليص الجمركي للواردات إلى الكويت',
      excerpt:
        'دليل تشغيلي يشرح خطوات التخليص الجمركي لواردات الكويت، والمستندات المطلوبة، ونقاط التوقف الشائعة، وأدوار كل طرف في الملف.',
      metaDescription:
        'دليل عملي خطوة بخطوة للتخليص الجمركي للواردات إلى الكويت، من المستندات المطلوبة حتى الإفراج، مع نقاط التوقف الشائعة ودور كل طرف في الملف.',
      focusKeyword: 'تخليص جمركي الكويت',
      faqs: [
        {
          answer:
            'يتولى المخلص الجمركي المرخص إعداد البيان الجمركي وتقديمه. ويقوم وكيل الشحن أو المستورد بتوفير مستندات التخليص والموافقات والمدفوعات. ويتولى النقل بعد الإفراج.',
          question: 'من يتولى التخليص الجمركي للواردات إلى الكويت؟',
        },
        {
          answer:
            'تشمل المجموعة المعتادة بوليصة الشحن أو بوليصة الشحن الجوي، والفاتورة التجارية، وقائمة التعبئة، وشهادة المنشأ، وأمر التسليم، وأي تصاريح أو تراخيص خاصة بالبضائع.',
          question: 'ما المستندات المطلوبة للتخليص الجمركي في الكويت؟',
        },
        {
          answer:
            'تتعطل معظم الملفات قبل قبول البيان الجمركي. والأسباب الشائعة هي عدم تطابق المستندات، ونقص التصاريح، ووصف الفاتورة الغامض، وعدم وضوح تصنيف النظام المنسق.',
          question: 'أين تتعطل ملفات تخليص الواردات في الكويت عادةً؟',
        },
        {
          answer:
            'يبدأ العمل عند الحجز. أعمال ما قبل الوصول هي نقطة التحكم التي تقلل من رسوم التخزين في الميناء والأرضيات بعد التفريغ.',
          question: 'متى يجب أن يبدأ عمل تخليص الواردات في الكويت؟',
        },
      ],
      body: 'يجري التخليص الجمركي في الكويت وفق تسلسل ثابت من وصول البضاعة حتى الإفراج عنها. تنتظر البضاعة عادةً في الميناء أو المطار ريثما يتحرك الملف ورقيًا. وأغلب التأخير يحدث قبل قبول البيان الجمركي.\n\nهذا الدليل يتابع الملف كما يراه مكتب العمليات: المستندات، البيان الجمركي، السداد، المعاينة، الإفراج، والتسليم إلى النقل.\n\n## التخليص الجمركي في الكويت: التسلسل من الوصول إلى الإفراج\n\nالتخليص في الكويت يبدأ بالمستندات أولاً. فلا يتم الإفراج عن البضاعة من الميناء أو المطار إلا بعد إغلاق الملف. وهذا هو الترتيب العملي للخطوات:\n\n1. يرسل الناقل إشعار وصول.\n2. تجمعون أمر التسليم من الوكيل الملاحي أو شركة الطيران.\n3. تجمعون مستندات تخليص الواردات وتفحصونها.\n4. يعد المخلص الجمركي البيان الجمركي ويقدمه.\n5. تقدر الجمارك الرسوم والضرائب.\n6. قد تذهب الشحنة للمعاينة.\n7. تصدر الجمارك أمر الإفراج.\n8. يتسلم الناقل الشحنة ويقوم بالتوصيل.\n\nيتولى المخلص الجمركي عادة الخطوات من 4 إلى 7. ويتولى وكيل الشحن أو المستورد تجهيز المستندات وسداد الرسوم. ويتولى فريق النقل المهمة بعد الإفراج.\n\nهذا التسلسل ثابت، لكن الوقت الذي تستغرقه كل خطوة يختلف حسب الميناء ونوع البضاعة واكتمال المستندات.\n\n## مستندات التخليص الجمركي الكويتي: ما يجب جمعه قبل الوصول\n\nمستندات تخليص الواردات هي المجموعة التي تثبت ماهية البضاعة وقيمتها ومنشأها والمستورد. ابدأوا بتجميعها فور تأكيد الشحنة.\n\n| المستند | جهة الإصدار | ما يفحصه المكتب |\n|---|---|---|\n| بوليصة الشحن أو بوليصة الشحن الجوي | الناقل | اسم المستورد، الطرف المخطر، العلامات، شروط الشحن |\n| الفاتورة التجارية | المصدّر | وصف البضاعة، القيمة، العملة، كود النظام المنسق، شروط التسليم |\n| قائمة التعبئة | المصدّر | عدد الطرود، الأوزان، المقاسات، العلامات |\n| شهادة المنشأ | الغرفة التجارية أو المصدّر | تطابق بلد المنشأ مع البيان الجمركي |\n| أمر التسليم | الوكيل الملاحي أو شركة الطيران | يصبح متاحًا بعد تسوية أجرة الشحن والرسوم المحلية |\n| تصاريح أو تراخيص المنتج | الجهة الكويتية المختصة | مطلوبة لبعض أنواع البضائع |\n\nلا تنتظروا وصول البضاعة لتكتشفوا نقص شهادة ما. اطلبوا من المصدّر المجموعة كاملة قبل مغادرة السفينة أو الطائرة. وإن كانت البضاعة تحتاج تصريحًا، تأكدوا من وجوده قبل التحميل.\n\nوصف الفاتورة مهم جدًا. وصف غامض مثل "بضائع عامة" يؤدي إلى توقفات واستفسارات. ينبغي أن يوضح الوصف ماهية البضاعة ومكوناتها والاستخدام المقصود لها متى أثّر ذلك على التصنيف.\n\n## أين تتعطل ملفات تخليص الواردات الكويتية عادةً\n\nتتعطل معظم الملفات قبل قبول البيان الجمركي. الأسباب المعتادة هي عدم تطابق المستندات، نقص التصاريح، وعدم وضوح التصنيف.\n\n| نقطة التعطل | أين تحدث | ما العمل |\n|---|---|---|\n| اختلاف اسم المستورد عن الترخيص أو البطاقة المدنية | أمر التسليم والبيان الجمركي | تحققوا من اسم المستورد قبل إصدار بوليصة الشحن |\n| وصف غامض أو عام في الفاتورة | مراجعة البيان الجمركي | احصلوا على وصف تجاري دقيق قبل تقديم البيان |\n| غياب شهادة المنشأ أو اختلاف اسم المصدّر | مراجعة البيان الجمركي | اطلبوها قبل الوصول وقارنوها بالفاتورة |\n| أجرة الشحن غير مسددة | أمر التسليم | تأكدوا من حالة الدفع قبل وصول السفينة |\n| عدم الاتفاق على كود النظام المنسق | تقدير الرسوم | اتفقوا على الكود مع المخلص قبل التقديم |\n| إيقاف للمعاينة | معاينة الجمارك | أرسلوا المستندات المطلوبة في نفس اليوم |\n\nأغلى أنواع التأخير هو نقص التصريح. إذا كانت البضاعة تتطلب تصريحًا ولم يحصل عليه المصدّر، فقد تبقى البضاعة في الميناء. هذه مشكلة تجارية وتنظيمية، لا مجرد مشكلة ورقية.\n\nلا يبدأ التخليص عند البوابة. بل يبدأ عندما تُحجز الشحنة. أعمال ما قبل التخليص هي ما يصنع الفارق بين إفراج نظيف وفاتورة تخزين وأرضيات.\n\n## كيف تحافظون على حركة ملف التخليص الجمركي في الكويت\n\nنقطة التحكم هي ما قبل الوصول. الملف المكتمل قبل وصول البضاعة يُفرج عنه أسرع من ملف يُجمَّع بعد التفريغ.\n\nاتبعوا هذا الترتيب:\n\n1. افتحوا الملف عند تأكيد الحجز.\n2. اطلبوا فورًا الفاتورة التجارية وقائمة التعبئة وشهادة المنشأ.\n3. قارنوا اسم المستورد بالترخيص أو البطاقة المدنية.\n4. أكدوا كود النظام المنسق ونسبة الرسم مع المخلص.\n5. احصلوا على موافقة المستورد على الرسوم قبل تقديم البيان.\n6. قدموا البيان الجمركي فور جهوزية أمر التسليم.\n7. إذا رفضت الجمارك البيان، فصححوه في نفس اليوم.\n8. سجلوا الإفراج وسلموا الملف للنقل.\n\nتتبعوا 5 تواريخ: الوصول، اكتمال المستندات، تقديم البيان، السداد، الإفراج. عندما يتأخر تاريخ واحد، راجعوا تلك الخطوة.\n\nتختلف الرسوم الجمركية باختلاف كود النظام المنسق. لا تخمنوا. يؤكد المخلص النسبة والمبلغ المستحق مع المستورد قبل التقديم.\n\n## المخلص الجمركي في الكويت: من يتولى كل خطوة\n\nيُحرك المخلص الملف. ويمنح المستورد الصلاحيات والموافقات. ويتولى مزود النقل المهمة بعد الإفراج.\n\n| الخطوة | المخلص الجمركي | المستورد أو وكيل الشحن | جهة النقل |\n|---|---|---|---|\n| إشعار الوصول | يستلمه | يؤكد البضاعة والمستورد | ينتظر الإفراج |\n| أمر التسليم | يستلمه من الوكيل | يسدد أجرة الشحن والرسوم المحلية | غير مشارك بعد |\n| فحص المستندات | يراجع المجموعة | يوفر المستندات الناقصة | غير مشارك بعد |\n| البيان الجمركي | يعده ويقدمه | يعتمد الرسوم | غير مشارك بعد |\n| المعاينة | يحضر أو ينسق | يوفر المستندات المساندة | غير مشارك بعد |\n| الإفراج | يستلم أمر الإفراج | يسدد الرسوم الجمركية | يستلم تعليمات التسليم |\n| التسليم | يسلم المستندات | يؤكد عنوان التسليم | يستلم ويوصل |\n\nاستخدموا قائمة تدقيق مكتوبة لكل ملف. القائمة تجعل المخلص والمستورد وفريق النقل يقفون على نفس الخطوة.\n\nلا تقوم البرمجيات بتخليص البضاعة. يقوم به الناس. تبقي CargoSharks ملف التخليص في مكان واحد: حالة البيان الجمركي وإصدار المستندات بالعربية والإنجليزية، والتكاليف، وفواتير العملاء. اطّلعوا على [نطاق العمل في الكويت](/ar/freight-forwarding-software-kuwait/) و[نطاق العمل الجمركي](/ar/customs-clearance-software/).\n\n## أسئلة متكررة\n\n**من يتولى التخليص الجمركي للواردات إلى الكويت؟**\n\nيتولى المخلص الجمركي المرخص إعداد البيان الجمركي وتقديمه. ويقوم وكيل الشحن أو المستورد بتوفير مستندات التخليص والموافقات والمدفوعات. ويتولى النقل بعد الإفراج.\n\n**ما المستندات المطلوبة للتخليص الجمركي في الكويت؟**\n\nتشمل المجموعة المعتادة بوليصة الشحن أو بوليصة الشحن الجوي، والفاتورة التجارية، وقائمة التعبئة، وشهادة المنشأ، وأمر التسليم، وأي تصاريح أو تراخيص خاصة بالبضائع.\n\n**أين تتعطل ملفات تخليص الواردات في الكويت عادةً؟**\n\nتتعطل معظم الملفات قبل قبول البيان الجمركي. والأسباب الشائعة هي عدم تطابق المستندات، ونقص التصاريح، ووصف الفاتورة الغامض، وعدم وضوح تصنيف النظام المنسق.\n\n**متى يجب أن يبدأ عمل تخليص الواردات في الكويت؟**\n\nيبدأ العمل عند الحجز. أعمال ما قبل الوصول هي نقطة التحكم التي تقلل من رسوم التخزين في الميناء والأرضيات بعد التفريغ.\n',
    },
  },
]

export const seedTopics: SeedTopic[] = [
  {
    key: 'demurrage-vs-detention',
    title: 'Demurrage vs detention',
    status: 'written',
    archetype: 'explainer',
    targetQuery: 'demurrage vs detention',
    audience: null,
    angle: null,
    expertNote: null,
    keywords: [],
    internalLinks: [],
  },
  {
    key: 'kuwait-customs-clearance-steps',
    title: 'How customs clearance works for imports into Kuwait',
    status: 'written',
    archetype: 'guide',
    targetQuery: 'customs clearance Kuwait',
    audience: 'operations staff and owners at Kuwaiti forwarders and customs brokers',
    angle:
      "The sequence from arrival to release as a forwarder's desk experiences it, and where files usually stall.",
    expertNote: null,
    keywords: ['Kuwait customs clearance', 'customs broker Kuwait', 'import clearance documents'],
    internalLinks: ['/customs-clearance-software/', '/freight-forwarding-software-kuwait/'],
  },
  {
    key: 'freight-quotation-checklist',
    title: 'What a freight quotation should include',
    status: 'ready',
    archetype: 'checklist',
    targetQuery: 'freight quotation template',
    audience: 'sales and pricing staff at Gulf forwarders',
    angle: 'The lines and terms that stop a won quote from turning into a loss-making job.',
    expertNote: null,
    keywords: ['freight quote', 'shipping quotation', 'freight rate quotation'],
    internalLinks: ['/freight-quotation-software/'],
  },
  {
    key: 'uae-e-invoicing-forwarders',
    title: 'UAE e-invoicing: what freight forwarders need to prepare',
    status: 'ready',
    archetype: 'regulation',
    targetQuery: 'UAE e-invoicing freight forwarders',
    audience: 'finance managers at UAE forwarders',
    angle:
      "What the programme means for a forwarder's invoices, stated with official sources and no guessed dates.",
    expertNote: null,
    keywords: ['UAE e-invoicing', 'PINT AE', 'accredited service provider UAE'],
    internalLinks: ['/uae-e-invoicing-freight-forwarders/', '/freight-invoicing-software/'],
  },
  {
    key: 'whatsapp-enquiries',
    title: 'Handling freight enquiries that arrive on WhatsApp',
    status: 'ready',
    archetype: 'guide',
    targetQuery: 'WhatsApp for freight forwarders',
    audience: 'sales coordinators at Gulf forwarders',
    angle: 'Turning chat messages into quotable enquiries without losing the facts in a thread.',
    expertNote: null,
    keywords: ['WhatsApp business logistics', 'freight enquiry management'],
    internalLinks: ['/whatsapp-for-freight-forwarders/', '/freight-quotation-software/'],
  },
  {
    key: 'chargeable-weight-air-freight',
    title: 'Chargeable weight in air freight, worked through',
    status: 'ready',
    archetype: 'guide',
    targetQuery: 'how to calculate chargeable weight air freight',
    audience: 'junior pricing and operations staff',
    angle:
      'Volumetric versus actual weight with worked examples, and the mistakes that under-quote a shipment.',
    expertNote: null,
    keywords: ['volumetric weight', 'air freight chargeable weight formula', 'dimensional weight'],
    internalLinks: ['/freight-quotation-software/'],
  },
  {
    key: 'bilingual-freight-documents',
    title: 'Arabic and English freight documents: getting both right',
    status: 'ready',
    archetype: 'explainer',
    targetQuery: 'Arabic freight documents',
    audience: 'operations and documentation staff',
    angle:
      'Where bilingual documents go wrong in practice: names, numbers, direction and which version governs.',
    expertNote: null,
    keywords: ['bilingual invoice Arabic English', 'Arabic commercial invoice'],
    internalLinks: ['/arabic-freight-documents/'],
  },
  {
    key: 'spreadsheets-to-system',
    title: 'When a forwarder outgrows spreadsheets',
    status: 'ready',
    archetype: 'comparison',
    targetQuery: 'freight forwarding software vs spreadsheets',
    audience: 'owners of small and mid-sized Gulf forwarders',
    angle:
      'The specific failures that show a spreadsheet-run desk has hit its limit, and what to check before switching.',
    expertNote: '',
    keywords: ['freight forwarding Excel', 'logistics spreadsheet'],
    internalLinks: ['/compare/spreadsheets/', '/what-we-do/'],
  },
]
