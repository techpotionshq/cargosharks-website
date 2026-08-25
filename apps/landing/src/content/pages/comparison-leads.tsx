import type { Lang } from '@/content/copy'

/**
 * A different opening for each comparison, because they are different
 * arguments.
 *
 * The four pages were one component driven by a table, which is good
 * engineering and made a bad set of pages: they could not differ, so they
 * didn't, and four identical documents read as a template with the nouns
 * swapped. The shared parts — the questions table, the facts table, the policy
 * note — *should* be identical, because they are the promise this site makes on
 * every one of these pages. The opening should not be, because the reason
 * somebody is comparing us to CargoWise is not the reason they are comparing us
 * to a spreadsheet.
 *
 * So each page now leads on the question that actually distinguishes it:
 *
 *   CargoWise        scale — the two are not the same size of thing
 *   Logistaas        how narrow the difference is between two peers
 *   CARGOES Runner   who owns the software, and where they sit in the chain
 *   spreadsheets     three failure modes, told as three moments
 *
 * Every figure here is about positioning or about a working method, never about
 * what a competitor's software can do — see `/compare/` §03.
 */

/**
 * Where two products are aimed, on the one axis that decides a shortlist.
 *
 * Both ranges come from how each side describes *itself*: theirs quotes 193
 * countries and "the world's logistics leaders", ours says Kuwait and the Gulf
 * on every page of this site. A ruler settles in one glance what three
 * paragraphs would argue about.
 */
export function ScaleRuler({ lang }: { lang: Lang }) {
  const stops = [
    { key: 'desk', x: 120, en: 'one desk', ar: 'مكتب واحد' },
    { key: 'ten', x: 330, en: '10 people', ar: '10 موظفين' },
    { key: 'fifty', x: 560, en: '50', ar: '50' },
    { key: 'two-hundred', x: 780, en: '200', ar: '200' },
    { key: 'global', x: 930, en: 'global network', ar: 'شبكة عالمية' },
  ]

  return (
    <figure className="cmp-figure">
      <div className="cmp-panel">
        <svg viewBox="0 0 1000 260" role="img" aria-labelledby="scale-title" className="cmp-svg">
          <title id="scale-title">
            {lang === 'ar'
              ? 'مسطرة تبيّن حجم العملية التي يستهدفها كل منتج'
              : 'A ruler showing the size of operation each product is aimed at'}
          </title>

          <line x1="60" y1="150" x2="960" y2="150" className="cmp-axis" />
          {stops.map((stop) => (
            <g key={stop.key}>
              <line x1={stop.x} y1="143" x2={stop.x} y2="157" className="cmp-axis" />
              <text x={stop.x} y="180" textAnchor="middle" className="cmp-axis-label">
                {lang === 'ar' ? stop.ar : stop.en}
              </text>
            </g>
          ))}

          {/* Ours: a single-country forwarder with a real operations desk. */}
          <path d="M92 118 H 600" className="cmp-line cmp-line--per" fill="none" />
          <path d="M92 108 V 128 M600 108 V 128" className="cmp-line cmp-line--per" fill="none" />
          <text x="92" y="94" className="cmp-key cmp-key--per">
            {lang === 'ar' ? 'CargoSharks موجَّه إلى هنا' : 'CargoSharks is aimed here'}
          </text>

          {/* Theirs, from their own positioning rather than from our reading. */}
          <path d="M430 214 H 962" className="cmp-line cmp-line--flat" fill="none" />
          <path d="M430 204 V 224 M962 204 V 224" className="cmp-line cmp-line--flat" fill="none" />
          <text x="430" y="248" className="cmp-key cmp-key--flat">
            {lang === 'ar' ? 'CargoWise يصف نفسه هنا' : 'CargoWise positions itself here'}
          </text>
        </svg>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'المدَيان من وصف كل طرف لنفسه لا من مقارنة مزايا: هم يذكرون 193 دولة و«كبار الشركات اللوجستية في العالم»، ونحن نقول الكويت والخليج في كل صفحة هنا. والتداخل حقيقي — إن كنتم داخله فالسؤال ليس أيّهما أقدر، بل أيّهما بُني لحجمكم.'
          : 'Both ranges come from how each side describes itself rather than from any feature comparison: they quote 193 countries and “the world’s logistics leaders”; we say Kuwait and the Gulf on every page of this site. The overlap is real — and if you are inside it, the question is not which is more capable but which was built for your size.'}
      </figcaption>
    </figure>
  )
}

/**
 * Two peers, drawn at the real size of their agreement.
 *
 * A page that spends its length hunting for differences between two products
 * aimed at the same buyer is a page that has to invent some. This one opens by
 * conceding the middle, which is most of it.
 */
export function OverlapSets({ lang }: { lang: Lang }) {
  return (
    <figure className="cmp-figure">
      <div className="cmp-panel">
        <svg viewBox="0 0 1000 300" role="img" aria-labelledby="overlap-title" className="cmp-svg">
          <title id="overlap-title">
            {lang === 'ar'
              ? 'دائرتان متداخلتان تبيّنان أن معظم ما يفعله النظامان مشترك'
              : 'Two overlapping circles showing that most of what the two systems do is shared'}
          </title>

          <circle cx="430" cy="140" r="118" className="cmp-set" />
          <circle cx="570" cy="140" r="118" className="cmp-set" />

          <text x="500" y="132" textAnchor="middle" className="cmp-track-label">
            {lang === 'ar' ? 'معظم العمل' : 'most of the job'}
          </text>
          <text x="500" y="156" textAnchor="middle" className="cmp-axis-label">
            {lang === 'ar'
              ? 'تسعير وعمليات ومستندات ومالية'
              : 'quoting, operations, documents, finance'}
          </text>

          <text x="272" y="146" textAnchor="middle" className="cmp-key cmp-key--flat">
            {lang === 'ar' ? 'هم' : 'them'}
          </text>
          <text x="728" y="146" textAnchor="middle" className="cmp-key cmp-key--per">
            {lang === 'ar' ? 'نحن' : 'us'}
          </text>

          <text x="500" y="284" textAnchor="middle" className="cmp-note">
            {lang === 'ar'
              ? 'الفرق في الهلالين لا في الوسط'
              : 'the difference is in the crescents, not the middle'}
          </text>
        </svg>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'هذه أقرب مقارنة في القائمة، ورسمها بأمانة يعني رسم الاتفاق بحجمه الحقيقي. ما تبقّى ضيّق ومحدد، ولذلك يستحق أن يُكتب بدقة بدل أن يُضخَّم.'
          : 'This is the closest comparison on the list, and drawing it honestly means drawing the agreement at its real size. What is left over is narrow and specific, which is why it is worth writing down precisely rather than inflating.'}
      </figcaption>
    </figure>
  )
}

/**
 * Who sits where in the chain.
 *
 * DP World operates terminals and also sells software to the forwarders who
 * book through them. Both parties publish that, it is not an accusation, and
 * for some buyers the closeness is the whole reason to choose it — which is why
 * the page says so before it says anything else. It is also the one question
 * that makes this comparison different from the other three.
 */
export function ChainPosition({ lang }: { lang: Lang }) {
  const links = [
    { key: 'shipper', x: 140, en: 'shipper', ar: 'الشاحن' },
    { key: 'forwarder', x: 380, en: 'forwarder', ar: 'وكيل الشحن' },
    { key: 'terminal', x: 620, en: 'terminal', ar: 'المحطة' },
    { key: 'carrier', x: 860, en: 'carrier', ar: 'الناقل' },
  ]

  return (
    <figure className="cmp-figure">
      <div className="cmp-panel">
        <svg viewBox="0 0 1000 264" role="img" aria-labelledby="chain-title" className="cmp-svg">
          <title id="chain-title">
            {lang === 'ar'
              ? 'رسم يبيّن موقع كل طرف في سلسلة الشحن'
              : 'A diagram showing where each party sits in the freight chain'}
          </title>

          <line x1="140" y1="126" x2="860" y2="126" className="cmp-axis" />
          {links.map((link) => (
            <g key={link.key}>
              <circle
                cx={link.x}
                cy="126"
                r="9"
                className={link.key === 'forwarder' ? 'cmp-mark' : 'cmp-node'}
              />
              <text x={link.x} y="158" textAnchor="middle" className="cmp-track-label">
                {lang === 'ar' ? link.ar : link.en}
              </text>
            </g>
          ))}

          {/* Where each software vendor stands relative to that chain. */}
          <path d="M620 104 V 62 H 652" className="cmp-line cmp-line--flat" fill="none" />
          <text x="664" y="66" className="cmp-key cmp-key--flat">
            {lang === 'ar'
              ? 'DP World تشغّل محطات وتبيع البرنامج'
              : 'DP World runs terminals, and sells the software'}
          </text>

          {/* Drops from below the label, not through it — the baseline is at
              y=158 and the old path started at 148. */}
          <path d="M380 172 V 208 H 424" className="cmp-line cmp-line--per" fill="none" />
          <text x="436" y="210" className="cmp-key cmp-key--per">
            {lang === 'ar' ? 'نحن نبيع البرنامج فقط' : 'we sell the software and nothing else'}
          </text>
        </svg>
      </div>

      <figcaption>
        {lang === 'ar'
          ? 'ليست هذه تهمة، وكلا الطرفين ينشر هذه الحقيقة. القرب من المحطة ميزة حقيقية إن كان حجمكم يمرّ عبرها، وسؤال يستحق الطرح إن لم يكن. ونحن لا نشغّل شيئاً تحجزون فيه — وهذا أيضاً وضع له وجهان.'
          : 'This is not an accusation and both parties publish it. Closeness to the terminal is a real advantage if your volume runs through it, and a question worth asking if it does not. We operate nothing you book through, which is also a position with two sides to it.'}
      </figcaption>
    </figure>
  )
}
