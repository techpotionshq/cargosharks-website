import { Database } from '@phosphor-icons/react/dist/ssr'
import { ChartFigure } from '@/components/charts/ChartFigure'
import type { Lang } from '@/content/copy'

/**
 * Two diagrams that are pictures of an idea rather than charts of data.
 *
 * `figures.tsx` holds the things with numbers in them. These two have none:
 * *a record is never overwritten*, and *your database is your own*. Both were
 * hairline SVG drawn on `pages.css` classes; they are now Tailwind compositions
 * inside `ChartFigure`, like every other figure on the site, so they read the
 * same inside a `.doc-page` wrapper or outside one, mirror in Arabic through
 * logical properties, and reflow on a phone instead of scrolling sideways.
 *
 * The rules they keep from the drawings: the palette's own tokens only, blue
 * for what this product does, the dark navy for the comparison (never a grey or
 * beige tint), and no decoration that does not mean something. A third drawing,
 * a quay skyline once used as a resting place on `/compare/`, was deleted when
 * nothing rendered it any more.
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
 * stack makes it physical: the older sheets are still there behind the live
 * one, still labelled, and the newest is simply in front. The names and times
 * are a sample, and `meta` says so.
 */
export function LayeredRecord({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const trail = [
    {
      when: { en: '18 Aug, 09:12', ar: '18 أغسطس، 09:12' },
      who: { en: 'N. Al-Failakawi', ar: 'ن. الفيلكاوي' },
      what: 'quote.send',
    },
    {
      when: { en: '19 Aug, 14:40', ar: '19 أغسطس، 14:40' },
      who: { en: 'N. Al-Failakawi', ar: 'ن. الفيلكاوي' },
      what: 'quote.revise',
    },
    {
      when: { en: '21 Aug, 11:05', ar: '21 أغسطس، 11:05' },
      who: { en: 'M. Haddad', ar: 'م. حداد' },
      what: 'quote.accept',
    },
    {
      when: { en: '21 Aug, 11:05', ar: '21 أغسطس، 11:05' },
      who: { en: 'system', ar: 'النظام' },
      what: 'job.book',
    },
  ]
  const superseded = ar ? 'مستبدَلة' : 'Superseded'

  return (
    <ChartFigure
      title={
        ar
          ? 'عرض سعر واحد بثلاث نسخ، وإلى جانبه سجل التدقيق'
          : 'One quotation, three versions, and the audit trail beside them'
      }
      meta={ar ? 'سجل نموذجي' : 'A sample record'}
      caption={
        ar
          ? 'المراجعة تستبدل ولا تكتب فوق، فيبقى ما وافق عليه العميل قابلاً للاسترجاع. ويكتب السجلَّ مُشغِّلٌ في قاعدة البيانات.'
          : 'A revision supersedes rather than overwrites, so what the customer accepted stays recoverable. A database trigger writes the trail.'
      }
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-10">
        {/* The stack: v1 and v2 show only their top edge behind v3. */}
        <div className="flex min-w-0 flex-col">
          {[
            { n: 'v1', inset: 'mx-8' },
            { n: 'v2', inset: 'mx-4' },
          ].map((sheet) => (
            <div
              key={sheet.n}
              className={`${sheet.inset} flex items-center justify-between gap-4 rounded-t-lg border border-b-0 border-line bg-paper px-4 py-2 text-label text-ink-faint`}
            >
              <span dir="ltr" className="font-mono">
                {sheet.n}
              </span>
              <span>{superseded}</span>
            </div>
          ))}
          <div className="flex flex-col gap-4 rounded-lg border-2 border-blue bg-paper-lift p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <span dir="ltr" className="font-mono text-small font-semibold text-heading">
                v3
              </span>
              <span className="rounded-sm bg-blue/10 px-2 py-0.5 text-label font-semibold text-blue-ink">
                {ar ? 'مقبولة' : 'Accepted'}
              </span>
            </div>
            {/* Ruled lines standing in for the document's own body. */}
            <div aria-hidden="true" className="flex flex-col gap-2.5">
              {['w-11/12', 'w-3/4', 'w-5/6', 'w-1/2'].map((width) => (
                <span key={width} className={`h-2 rounded-full bg-line ${width}`} />
              ))}
            </div>
            <p className="figures text-small text-ink-dim">
              {ar ? 'قُبلت في 21 أغسطس، 11:05' : 'Accepted 21 Aug, 11:05'}
            </p>
          </div>
        </div>

        {/* The trail, as a ledger: who on the start side, the recorded action
            on the end, the time under the name. Two lines per entry, so it fits a
            phone without a third column. */}
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-small font-semibold text-heading">
            {ar ? 'سجل التدقيق، ولا شيء يُحذف' : 'Audit trail, nothing deleted'}
          </p>
          <ol className="divide-y divide-line border-y border-line">
            {trail.map((entry) => (
              <li key={entry.what} className="flex items-start justify-between gap-4 py-2.5">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-small leading-snug text-ink">{entry.who[lang]}</span>
                  <span className="figures text-label leading-snug text-ink-faint">
                    {entry.when[lang]}
                  </span>
                </span>
                <span dir="ltr" className="font-mono text-label leading-snug text-blue-ink">
                  {entry.what}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </ChartFigure>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   One deployment per customer
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Separate databases, and the shape we did not build.
 *
 * The navy card describes a *category* — one estate, one table, a tenant
 * column on every row and a query that must never forget it — and not
 * anybody's product. That distinction is the same one `/compare/` §01 draws
 * when it describes "a global platform" without naming one, and it is what
 * keeps this figure publishable under §03. Multi-tenancy done properly is
 * respectable engineering; it is simply a different promise from the one this
 * product makes, and a buyer is entitled to see the two shapes side by side.
 *
 * The column is labelled `tenant_id` rather than `customer_id` on purpose: the
 * real schema *does* carry a `customer_id` (the forwarder's own client, for the
 * customer portal), so borrowing that name for the shape we did not build
 * would collide with a real, differently-purposed column.
 */
export function OwnDatabase({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const ours = [
    { label: { en: 'A forwarder', ar: 'وكيل شحن' }, region: { en: 'Kuwait', ar: 'الكويت' } },
    { label: { en: 'Another', ar: 'وكيل آخر' }, region: { en: 'UAE', ar: 'الإمارات' } },
    { label: { en: 'A third', ar: 'وكيل ثالث' }, region: { en: 'EU', ar: 'أوروبا' } },
  ]

  return (
    <ChartFigure
      title={
        ar
          ? 'قاعدة بيانات لكل عميل، إلى جانب الجدول المشترك الذي لم نبنِه'
          : 'One database per customer, beside the shared table we did not build'
      }
      caption={
        ar
          ? 'قاعدة بيانات لكل عميل، في منطقة يختارها وتُكتب في العقد. وداخلها يفصل الأمان على مستوى الصف بين الفروع.'
          : 'One database per customer, in a region they choose that goes into the contract. Inside it, row-level security separates branches.'
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-paper p-5">
          <p className="text-small font-semibold text-blue-ink">
            {ar ? 'ما نبنيه' : 'What we build'}
          </p>
          <dl className="divide-y divide-line border-y border-line">
            {ours.map((row) => (
              <div key={row.region.en} className="flex items-center gap-3 py-2.5">
                <Database weight="regular" aria-hidden="true" className="size-5 shrink-0 text-blue" />
                <dt className="text-small text-ink">{row.label[lang]}</dt>
                <dd className="ms-auto text-small font-semibold text-heading">
                  {row.region[lang]}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-small text-ink-dim">
            {ar
              ? 'لا مُعرِّف مستأجر في المخطط، لأنه لا مستأجر ثانٍ في القاعدة.'
              : 'No tenant identifier in the schema, because there is no second tenant in the database.'}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-4 rounded-lg bg-void p-5">
          <p className="text-small font-semibold text-on-void">
            {ar ? 'الشكل الذي لم نبنِه' : 'The shape we did not build'}
          </p>
          {/* One shared table. The tenant column is the only thing written;
              the rest of each row is a ruled line, because its content is not
              the point. A database table reads left to right in both
              languages, so it is set `ltr`. */}
          <div dir="ltr" className="overflow-hidden rounded-md border border-void-line">
            <div className="grid grid-cols-[6.5rem_1fr] border-b border-void-line bg-void-lift">
              <span className="border-e border-void-line px-3 py-2 font-mono text-label text-blue-lit">
                tenant_id
              </span>
              <span className="px-3 py-2 font-mono text-label text-on-void-faint">…</span>
            </div>
            {['A', 'B', 'C'].map((tenant) => (
              <div
                key={tenant}
                className="grid grid-cols-[6.5rem_1fr] border-b border-void-line last:border-b-0"
              >
                <span className="border-e border-void-line px-3 py-2 font-mono text-label text-on-void">
                  {tenant}
                </span>
                <span className="flex items-center px-3">
                  <span aria-hidden="true" className="h-1.5 w-3/4 rounded-full bg-void-line" />
                </span>
              </div>
            ))}
          </div>
          <p className="text-small text-on-void-dim">
            {ar
              ? 'كل استعلام لا بدّ أن يتذكّره، ويكفي استعلام واحد لا يتذكّره. هندسة محترمة، لكنها وعدٌ آخر.'
              : 'Every query must remember it, and one that does not is enough. Respectable engineering, and a different promise.'}
          </p>
        </div>
      </div>
    </ChartFigure>
  )
}
