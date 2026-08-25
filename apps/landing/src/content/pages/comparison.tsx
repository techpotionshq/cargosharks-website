import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr'
import type { Comparison } from '@/content/comparisons'
import { CONTACT_EMAIL, DEMO_URL, type Lang } from '@/content/copy'

/**
 * One comparison page, rendered from a row in `comparisons.ts`.
 *
 * The five imported documents are hand-written markup because they were
 * converted from HTML and nobody edits them structurally. These four are the
 * opposite case — the same document four times with different contents — so
 * they are one component and a table. That is not only less code: it is the
 * only arrangement in which the *shape* of the argument stays honest across all
 * four, and the shape is the thing `/compare/` §03 committed to.
 *
 * The order of the sections is the argument, and it is deliberately not the
 * order a sales page would use:
 *
 *   01  What they say about themselves — theirs, quoted, linked and dated.
 *   02  Where they are the better answer — before we say a word about us.
 *   03  Where we are.
 *   04  The questions, with our answers already written down.
 *
 * Putting §02 before §03 is the whole design. A comparison page that cannot
 * name a reader who should buy the other product is an advertisement wearing a
 * comparison's clothes, and a forwarder evaluating three systems can tell in
 * one paragraph. Leading with the case against ourselves is also the only
 * version of this page that is worth linking to.
 *
 * It uses `.doc-page` classes — the same stylesheet as the other five — so a
 * reader clicking from `/compare/` into `/compare/cargowise/` does not cross a
 * visual seam.
 */
export function ComparisonContent({ item, lang }: { item: Comparison; lang: Lang }) {
  return (
    <>
      {/*
        The masthead, copied from `what-we-do.tsx` rather than improvised.

        `hero__field` and the `hero__grid` inside it are an absolutely
        positioned decorative layer — `inset: 0`, a hairline grid, a mask. The
        first version of this file put the `.shell` *inside* `hero__grid`, which
        took the whole masthead out of flow: the band collapsed to nothing and
        the headline rendered underneath the floating header. The copy is a
        sibling of the field, and it carries `hero__copy`.
      */}
      <section className="hero hero--page">
        <div className="hero__field" aria-hidden="true">
          <div className="hero__grid" />
        </div>
        <div className="shell hero__copy">
          <p className="hero__kicker">
            <i />
            {lang === 'ar' ? 'مقارنة' : 'Comparison'}
          </p>
          <h1 className="display">{item.title[lang]}</h1>
          <p className="hero__sub">{item.lede[lang]}</p>
          <p className="hero__ways">
            <a href={DEMO_URL}>{lang === 'ar' ? 'افتحوا النسخة التجريبية' : 'Open the live demo'}</a>
            <a href="/compare/">{lang === 'ar' ? 'كل المقارنات' : 'All comparisons'}</a>
            <a href="/what-we-do/">{lang === 'ar' ? 'ماذا نفعل' : 'What we do'}</a>
            <a href="/">{lang === 'ar' ? 'الصفحة الرئيسية' : 'The home page'}</a>
          </p>
        </div>
      </section>

      <section className="band band--paper">
        <div className="shell">
          <div className="section-head">
            {/* A spreadsheet has no vendor, so it cannot say anything about
                itself and the section is a description rather than a quotation.
                Keyed off `source` — the same field that decides whether there is
                a link and a read-on date to print below. */}
            <p className="eyebrow">
              <b />
              {item.source
                ? lang === 'ar'
                  ? '01 — بكلماتهم'
                  : '01 — In their words'
                : lang === 'ar'
                  ? '01 — ما هو'
                  : '01 — What it is'}
            </p>
            <h2 className="h2">
              {item.source
                ? lang === 'ar'
                  ? 'ما يقولونه عن أنفسهم'
                  : 'What they say about themselves'
                : lang === 'ar'
                  ? 'ما تستخدمونه اليوم فعلاً'
                  : 'What you are actually using today'}
            </h2>
            <p className="lead">{item.theirPitch[lang]}</p>
          </div>

          {/*
            The source and the date it was read, printed rather than buried.

            This is the mechanism that makes writing about somebody else's
            product defensible at all. A claim with a date on it is a claim the
            reader can discount for themselves — and when it goes stale, it goes
            stale *visibly*, which is precisely the failure `/compare/` §03 says
            a tick-and-cross grid hides.
          */}
          {item.source ? (
            <p className="small muted">
              {lang === 'ar' ? 'المصدر: ' : 'Read from '}
              <a href={item.source} rel="nofollow noopener" target="_blank">
                {item.source.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                <ArrowUpRight weight="bold" style={{ display: 'inline', width: '0.8em', height: '0.8em' }} />
              </a>
              {lang === 'ar' ? ' — قُرئ في ' : ' on '}
              {item.checked}
              {lang === 'ar'
                ? '. إن كان هذا قد تقادم، أخبرونا ونصححه.'
                : '. If this has gone out of date, tell us and we will correct it.'}
            </p>
          ) : null}
        </div>
      </section>

      <section className="band band--white">
        <div className="shell">
          <div className="section-head">
            <p className="eyebrow">
              <b />
              {lang === 'ar' ? '02 — الحجة ضدنا' : '02 — The case against us'}
            </p>
            <h2 className="h2">{item.pickThem.heading[lang]}</h2>
            <p className="lead">
              {lang === 'ar'
                ? 'هذا القسم قبل الذي يليه عن قصد. صفحة مقارنة لا تستطيع تسمية قارئ ينبغي له اختيار المنتج الآخر ليست مقارنة.'
                : 'This section comes before the next one on purpose. A comparison page that cannot name a reader who should buy the other product is not a comparison.'}
            </p>
          </div>

          <ul className="feature-list">
            {item.pickThem.points.map((point) => (
              <li key={point.en}>{point[lang]}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band band--navy">
        <div className="shell">
          <div className="section-head">
            <p className="eyebrow">
              <b />
              {lang === 'ar' ? '03 — الحجة لنا' : '03 — The case for us'}
            </p>
            <h2 className="h2">{item.pickUs.heading[lang]}</h2>
            <p className="lead">
              {lang === 'ar'
                ? 'كل بند أدناه آلية يمكنكم التحقق منها في النسخة التجريبية أو في الشيفرة، لا وعد.'
                : 'Every point below is a mechanism you can check in the demo or in the source, rather than a promise.'}
            </p>
          </div>

          <ul className="feature-list">
            {item.pickUs.points.map((point) => (
              <li key={point.en}>{point[lang]}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band band--paper">
        <div className="shell">
          <div className="section-head">
            <p className="eyebrow">
              <b />
              {lang === 'ar' ? '04 — الأسئلة' : '04 — The questions'}
            </p>
            <h2 className="h2">
              {lang === 'ar' ? 'اسألوا كلينا هذه، وقارنوا الأجوبة' : 'Ask both of us these, and compare the answers'}
            </h2>
            <p className="lead">
              {lang === 'ar'
                ? 'أجوبتنا مكتوبة سلفاً. من يأخذ هذه القائمة إلى مكالمة أخرى ويحصل على جواب أفضل من جوابنا ينبغي له أن يشتري من هناك — وهذا ما يجعل نشر القائمة يستحق.'
                : 'Our answers are already written. Somebody who takes this list to another vendor’s call and gets a better answer than ours should buy from them — which is what makes the list worth publishing.'}
            </p>
          </div>

          <dl className="spec">
            {item.ask.map((entry) => (
              <div key={entry.question.en}>
                <dt>{entry.question[lang]}</dt>
                <dd>
                  <span>{entry.ours[lang]}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="band band--white">
        <div className="shell">
          <div className="section-head">
            <h2 className="h2">
              {lang === 'ar' ? 'ما لن تجدوه في هذه الصفحة' : 'What you will not find on this page'}
            </h2>
            <p className="lead">
              {lang === 'ar'
                ? 'جدول علامات صح وخطأ. نحن نعرف منتجنا جيداً ومنتجهم من الخارج، وجدول يكتبه طرف واحد ليس مقارنة بل حجة حولها إطار. والأسوأ أنه يتقادم بصمت: كل خانة فيه تبدأ بالتحلل يوم نشرها، ومن تُضلَّل به هو عميلكم المحتمل ومن يبدو أحمق هو أنتم.'
                : 'A tick-and-cross grid. We know our product properly and theirs from the outside, and a grid written by one side is not a comparison — it is an argument with a table around it. Worse, it goes stale silently: every entry starts decaying the day it is published, and the person it misleads is your prospect while the person who looks foolish is you.'}
            </p>
            <p className="lead">
              {lang === 'ar' ? 'اسألونا مباشرة على ' : 'Ask us directly at '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              {lang === 'ar'
                ? '. ستحصلون على جواب مكتوب يستشهد بما ينشره كل مورّد عن نفسه، وحيث لا نعرف ستحصلون على «لا نعرف».'
                : '. You will get a written answer that cites what each vendor publishes itself, and where we do not know, you will get “we do not know”.'}
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
