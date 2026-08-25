import type { Lang } from '@/content/copy'

/**
 * Three drawings that are pictures rather than charts.
 *
 * `figures.tsx` holds the things with numbers in them. These three have none,
 * and they exist for the arguments that a chart cannot carry because there is
 * nothing to plot: *a record is never overwritten*, *your database is your
 * own*, and — for one band on `/compare/` — a horizon, because a page that is
 * nine screens of type needs somewhere for the eye to rest that is not another
 * table.
 *
 * They are drawn, not photographed, for the reason the photography on this site
 * is photographed: a stock picture of a server room says nothing about
 * row-level security, and a diagram of three cylinders says the whole thing in
 * one glance. Where a real photograph is the better answer — a yard, a quay, a
 * ship — `public/pic/photos/` already has four under an Unsplash licence and
 * they are used instead.
 *
 * **A drawn illustration on this site is line art in the product's own
 * palette.** No gradients, no fills that are not a token, no perspective, no
 * little people. The house style is technical drawing: the same hairline that
 * rules the tables, the same mono for anything that labels a part. Anything
 * softer than that reads as clip art, and clip art on a page arguing for
 * verifiable claims undoes the page.
 *
 * A previous version of this file drew a berth plan with animated "marching
 * ants" round the containers. It was deleted — see the commit — because motion
 * that means nothing is worse than no drawing at all: it draws the eye to a
 * decoration and away from the sentence it sits beside. Nothing here moves.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   Nothing is deleted — a record and its versions
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Three versions of one quotation, and the audit beside them.
 *
 * The claim is a database property and it is almost impossible to feel from a
 * sentence: `superseded_by` rather than `UPDATE`, so what the customer actually
 * accepted stays recoverable whatever has happened to the quotation since. The
 * drawing makes it physical — the older sheets are still there, still stamped,
 * still legible, and the newest one is simply on top.
 */
export function LayeredRecord({ lang }: { lang: Lang }) {
  const versions = [
    {
      n: 'v1',
      x: 46,
      y: 128,
      state: { en: 'superseded', ar: 'مستبدَلة' },
      when: '18 Aug · 09:12',
    },
    {
      n: 'v2',
      x: 84,
      y: 100,
      state: { en: 'superseded', ar: 'مستبدَلة' },
      when: '19 Aug · 14:40',
    },
    {
      n: 'v3',
      x: 122,
      y: 72,
      state: { en: 'accepted', ar: 'مقبولة' },
      when: '21 Aug · 11:05',
    },
  ]

  const trail = [
    {
      when: '18 Aug 09:12',
      who: { en: 'N. Al-Failakawi', ar: 'ن. الفيلكاوي' },
      what: { en: 'quote.send', ar: 'quote.send' },
    },
    {
      when: '19 Aug 14:40',
      who: { en: 'N. Al-Failakawi', ar: 'ن. الفيلكاوي' },
      what: { en: 'quote.revise', ar: 'quote.revise' },
    },
    {
      when: '21 Aug 11:05',
      who: { en: 'M. Haddad', ar: 'م. حداد' },
      what: { en: 'quote.accept', ar: 'quote.accept' },
    },
    {
      when: '21 Aug 11:05',
      who: { en: 'system', ar: 'النظام' },
      what: { en: 'job.book', ar: 'job.book' },
    },
  ]

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <svg viewBox="0 0 1000 320" role="img" aria-labelledby="layered-title" className="cmp-svg">
          <title id="layered-title">
            {lang === 'ar'
              ? 'ثلاث نسخ من عرض سعر، مرصوفة فوق بعضها، وإلى جانبها سجل التدقيق'
              : 'Three versions of a quotation, stacked, with the audit trail beside them'}
          </title>

          {versions.map((version, index) => {
            const current = index === versions.length - 1
            return (
              <g key={version.n}>
                <rect
                  x={version.x}
                  y={version.y}
                  width="286"
                  height="176"
                  rx="3"
                  className={current ? 'illo-sheet illo-sheet--live' : 'illo-sheet'}
                />
                {/* Ruled lines standing in for the document's own body. Three on
                    the covered sheets, because that is all of them you can see. */}
                {(current ? [42, 66, 90, 114, 138] : [42, 66, 90]).map((offset) => (
                  <line
                    key={offset}
                    x1={version.x + 22}
                    y1={version.y + offset}
                    x2={version.x + (current ? 210 : 120)}
                    y2={version.y + offset}
                    className="illo-line"
                  />
                ))}
                <text x={version.x + 22} y={version.y + 26} className="illo-tag">
                  {version.n} · {version.state[lang]}
                </text>
                {current ? (
                  <text x={version.x + 22} y={version.y + 162} className="cmp-note">
                    {version.when}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* The bracket says what the stack means, so the drawing does not
              depend on the caption to be read. */}
          <path d="M424 88 H 448 V 240 H 424" className="illo-brace" fill="none" />
          <text x="462" y="80" className="cmp-track-label">
            {lang === 'ar' ? 'لا شيء يُحذف' : 'nothing is deleted'}
          </text>

          {trail.map((entry, index) => {
            const y = 120 + index * 34
            return (
              <g key={entry.when + entry.what.en}>
                <circle cx="470" cy={y - 5} r="3.5" className="cmp-node" />
                <text x="488" y={y} className="illo-trail">
                  {entry.when}
                </text>
                <text x="640" y={y} className="illo-trail illo-trail--who">
                  {entry.who[lang]}
                </text>
                <text x="820" y={y} className="illo-trail illo-trail--key">
                  {entry.what[lang]}
                </text>
              </g>
            )
          })}
          <line x1="470" y1="242" x2="960" y2="242" className="cmp-axis" />
          <text x="470" y="266" className="cmp-axis-label">
            {lang === 'ar'
              ? 'يكتبه مُشغِّل في القاعدة، لا الشيفرة'
              : 'written by a database trigger, not by the application'}
          </text>
        </svg>

        <p className="fig-source">packages/db · superseded_by · app.attach_audit</p>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'المراجعة تستبدل ولا تكتب فوق: ما قبله عرضٌ سعرٍ قائم لا نسخة سابقة ضائعة، وما وافق عليه العميل يبقى قابلاً للاسترجاع مهما جرى للعرض بعده. وسجل التدقيق إلى جانبه يكتبه مُشغِّل في قاعدة البيانات، فالتغيير الذي يلتفّ حول التطبيق مسجَّلٌ أيضاً.'
          : 'A revision supersedes rather than overwrites: what came before is still a quotation rather than a lost draft, and what the customer accepted stays recoverable whatever has happened since. The trail beside it is written by a database trigger, so a change made around the application is recorded too.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   One deployment per customer
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Three databases, and the shape we did not build.
 *
 * The right-hand half describes a *category* — one estate, one table, a
 * customer column on every row and a query that must never forget it — and not
 * anybody's product. That distinction is the same one `/compare/` §01 draws
 * when it describes "a global platform" without naming one, and it is what
 * keeps this drawing publishable under §03. Multi-tenancy done properly is
 * respectable engineering; it is simply a different promise from the one this
 * product makes, and a buyer is entitled to see the two shapes side by side.
 */
export function OwnDatabase({ lang }: { lang: Lang }) {
  const stacks = [
    { x: 96, label: { en: 'A forwarder', ar: 'وكيل شحن' }, region: 'Kuwait' },
    { x: 216, label: { en: 'Another', ar: 'وكيل آخر' }, region: 'UAE' },
    { x: 336, label: { en: 'A third', ar: 'وكيل ثالث' }, region: 'EU' },
  ]

  return (
    <figure className="cmp-figure fig">
      <div className="cmp-panel">
        <svg viewBox="0 0 1000 320" role="img" aria-labelledby="own-db-title" className="cmp-svg">
          <title id="own-db-title">
            {lang === 'ar'
              ? 'ثلاث قواعد بيانات منفصلة، كلٌّ لعميل ومنطقة، مقابل جدول واحد مشترك يحمل عمود عميل'
              : 'Three separate databases, one per customer and region, against a single shared table carrying a customer column'}
          </title>

          <text x="40" y="44" className="cmp-track-label">
            {lang === 'ar' ? 'ما نبنيه' : 'What we build'}
          </text>

          {stacks.map((stack) => (
            <g key={stack.region}>
              {/* A cylinder: two ellipses and the wall between them. */}
              <path
                d={`M${stack.x} 96 a 40 14 0 0 1 80 0 v 96 a 40 14 0 0 1 -80 0 Z`}
                className="illo-db"
              />
              <ellipse cx={stack.x + 40} cy="96" rx="40" ry="14" className="illo-db illo-db--top" />
              <text x={stack.x + 40} y="228" textAnchor="middle" className="cmp-axis-label">
                {stack.label[lang]}
              </text>
              <text x={stack.x + 40} y="248" textAnchor="middle" className="cmp-note">
                {stack.region}
              </text>
            </g>
          ))}

          <text x="40" y="286" className="cmp-axis-label">
            {lang === 'ar'
              ? 'لا مُعرِّف مستأجر في المخطط، لأنه لا مستأجر ثانٍ في القاعدة'
              : 'no tenant identifier in the schema, because there is no second tenant in the database'}
          </text>

          <line x1="520" y1="40" x2="520" y2="290" className="cmp-guide" />

          <text x="556" y="44" className="cmp-track-label">
            {lang === 'ar' ? 'الشكل الذي لم نبنِه' : 'The shape we did not build'}
          </text>

          {/* One table, a customer column, and every row depending on a query
              remembering it. Drawn as a grid because that is what it is. */}
          <rect x="556" y="80" width="380" height="128" className="illo-table" />
          {[0, 1, 2, 3].map((row) => (
            <line
              key={row}
              x1="556"
              y1={112 + row * 32}
              x2="936"
              y2={112 + row * 32}
              className="illo-line"
            />
          ))}
          <rect x="556" y="80" width="86" height="128" className="illo-col" />
          <text x="599" y="72" textAnchor="middle" className="cmp-note">
            customer_id
          </text>
          <text x="556" y="238" className="cmp-axis-label">
            {lang === 'ar'
              ? 'كل استعلام لا بدّ أن يتذكّره — وواحدٌ لا يتذكّره يكفي'
              : 'every query must remember it — and one that does not is enough'}
          </text>
          <text x="556" y="262" className="cmp-axis-label">
            {lang === 'ar'
              ? 'هندسة محترمة، لكنها وعدٌ آخر'
              : 'respectable engineering, and a different promise'}
          </text>
        </svg>

        <p className="fig-source">packages/db/src/actor.ts · one deployment per customer</p>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'قاعدة بيانات لكل عميل، في نسخته وفي منطقة يختارها هو وتُكتب في العقد. وداخلها يفصل بين الفروع الأمان على مستوى الصف في القاعدة نفسها لا شيفرة التطبيق: اطلبوا شحنة فرع آخر يعُد الجواب «غير موجود»، لأن الصف ليس في الجواب أصلاً.'
          : 'One database per customer, in their own instance, in a region they choose and that goes into the contract. Inside it, branches are separated by row-level security in the database rather than by application code: ask for another branch’s shipment and it comes back not found, because the row is not in the answer at all.'}
      </figcaption>
    </figure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   A horizon
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A quay, drawn at hairline weight, for the one place on these pages where the
 * eye needs somewhere to go that is not a table.
 *
 * It is decorative and it is `aria-hidden`, which is the honest way to ship a
 * decoration: a screen reader is not made to listen to a description of a crane
 * for no reason. It is also the only thing in this file that is allowed to be
 * pretty, and it stays at one stroke weight so it reads as a drawing on the
 * page rather than as an illustration pasted onto it.
 */
export function QuayLine() {
  const stacks = [
    { x: 120, rows: 3, cols: 4 },
    { x: 268, rows: 2, cols: 3 },
    { x: 700, rows: 4, cols: 3 },
    { x: 812, rows: 2, cols: 5 },
  ]

  return (
    <div className="illo-quay" aria-hidden="true">
      <svg viewBox="0 0 1000 200" className="cmp-svg">
        {/* The water, and the quay it stops at. */}
        <line x1="0" y1="168" x2="1000" y2="168" className="illo-quay__deck" />
        {[178, 188].map((y) => (
          <line key={y} x1="0" y1={y} x2="1000" y2={y} className="illo-quay__water" />
        ))}

        {/* Two gantry cranes: legs, boom, trolley, and the hoist hanging from
            it. Straight lines only — a curve here would be a different drawing
            from every other one on the site. */}
        {[380, 560].map((x) => (
          <g key={x}>
            <path
              d={`M${x} 168 V 74 M${x + 74} 168 V 74 M${x - 46} 74 H ${x + 128} M${x + 128} 74 l 26 -26`}
              className="illo-quay__crane"
              fill="none"
            />
            <path
              d={`M${x + 30} 74 V 104 M${x + 18} 104 H ${x + 42}`}
              className="illo-quay__crane"
              fill="none"
            />
          </g>
        ))}

        {/* A hull, with a deck load on it. */}
        <path d="M628 168 h 250 l -22 -34 h -206 Z" className="illo-quay__hull" />
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <rect
            key={n}
            x={660 + n * 34}
            y="108"
            width="28"
            height="22"
            className="illo-quay__box"
          />
        ))}

        {/* Yard stacks. Each box is one box: the count is not meaningful and
            neither is the arrangement, which is why they are all one weight. */}
        {stacks.map((stack) =>
          Array.from({ length: stack.rows }).map((_, row) =>
            Array.from({ length: stack.cols }).map((__, col) => (
              <rect
                key={`${stack.x}-${row}-${col}`}
                x={stack.x + col * 30}
                y={168 - (row + 1) * 20}
                width="26"
                height="16"
                className="illo-quay__box"
              />
            )),
          ),
        )}
      </svg>
    </div>
  )
}
