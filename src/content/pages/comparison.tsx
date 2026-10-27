import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr'
import { facts } from '@/content/comparisons'
import type { Comparison } from '@/content/comparisons'
import { CostShape, SurfaceTimeline } from '@/content/pages/comparison-figures'
import { ChainPosition, OverlapSets, ScaleRuler } from '@/content/pages/comparison-leads'
import { AccrualStair, AllocationSplit, MinorUnits } from '@/content/pages/figures'
import { OwnDatabase } from '@/content/pages/illustrations'
import { leads } from '@/content/comparison-leads'
import { DEMO_URL, type Lang } from '@/content/copy'
import { EmailLink } from '@/components/Email'

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
  // Every slug has a lead; the `!` is the type system agreeing rather than
  // a shortcut — `comparison-leads.ts` is keyed by the same slugs.
  const lead = leads[item.slug]!

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
            <a href={DEMO_URL}>
              {lang === 'ar' ? 'افتحوا النسخة التجريبية' : 'Open the live demo'}
            </a>
            <a href="/compare/">{lang === 'ar' ? 'كل المقارنات' : 'All comparisons'}</a>
            <a href="/what-we-do/">{lang === 'ar' ? 'ماذا نفعل' : 'What we do'}</a>
            <a href="/">{lang === 'ar' ? 'الصفحة الرئيسية' : 'The home page'}</a>
          </p>
        </div>
      </section>

      {/*
        §01 is different on every page, and that is the point of `LeadShape`.

        These four were one component and a table, so they could not differ and
        did not — four identical documents reading as a template with the nouns
        swapped. What stays shared below is shared on purpose: the questions
        table, the facts table and the policy note are the promise this site
        makes on all of them, and a promise that changes shape per page is not
        one. The opening is what changes, because the reason somebody compares
        us to CargoWise is not the reason they compare us to a spreadsheet.
      */}
      <section className="band band--paper">
        <div className="shell">
          <div className="section-head">
            <p className="eyebrow">
              <b />
              {lead.eyebrow[lang]}
            </p>
            <h2 className="h2">{lead.heading[lang]}</h2>
            <p className="lead">{lead.body[lang]}</p>
          </div>

          {lead.shape === 'scale' ? <ScaleRuler lang={lang} /> : null}
          {lead.shape === 'peer' ? <OverlapSets lang={lang} /> : null}
          {lead.shape === 'chain' ? <ChainPosition lang={lang} /> : null}

          {/*
            The three moments, and the only place on these pages where a
            narrative beats a list.

            `modes` also has no vendor block after it — a spreadsheet publishes
            nothing about itself, and running it through a template that expects
            positioning is how the first version printed the heading "What they
            say about themselves" over a paragraph about Excel.
          */}
          {lead.shape === 'modes' ? (
            <ol className="cmp-moments">
              {(lead.moments ?? []).map((moment, index) => (
                <li key={moment.when.en}>
                  <p className="cmp-moments__n">{String(index + 1).padStart(2, '0')}</p>
                  <h3 className="h3">{moment.when[lang]}</h3>
                  <p>{moment.what[lang]}</p>
                  <p className="cmp-moments__then">
                    <b>{lang === 'ar' ? 'على السجل: ' : 'On a file: '}</b>
                    {moment.instead[lang]}
                  </p>
                </li>
              ))}
            </ol>
          ) : null}

          {/* The second moment, drawn. It is the one of the three that is
              arithmetic rather than judgement, so it is the one a picture
              settles: five free days, and then a charge line every day whether
              or not anybody has opened the file. */}
          {lead.shape === 'modes' ? <AccrualStair lang={lang} /> : null}
        </div>
      </section>

      {/* What the vendor says about itself — only where there is a vendor. */}
      {item.source ? (
        <section className="band band--white">
          <div className="shell">
            <div className="section-head">
              <p className="eyebrow">
                <b />
                {lang === 'ar' ? '02 — بكلماتهم' : '02 — In their words'}
              </p>
              <h2 className="h2">
                {lang === 'ar' ? 'ما يقولونه عن أنفسهم' : 'What they say about themselves'}
              </h2>
              <p className="lead">{item.theirPitch[lang]}</p>
            </div>

            {/*
              The source and the date it was read, printed rather than buried.

              This is what makes writing about somebody else's product
              defensible at all. A claim with a date on it is a claim the reader
              can discount for themselves — and when it goes stale it goes stale
              *visibly*, which is precisely the failure `/compare/` §03 says a
              tick-and-cross grid hides.
            */}
            <p className="small muted">
              {lang === 'ar' ? 'قُرئ من ' : 'Read from '}
              <a href={item.source} rel="nofollow noopener" target="_blank">
                {item.source.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                <ArrowUpRight
                  weight="bold"
                  style={{ display: 'inline', width: '0.8em', height: '0.8em' }}
                />
              </a>
              {lang === 'ar' ? ' بتاريخ ' : ' on '}
              {item.checked}
              {lang === 'ar'
                ? '. إن كان هذا قد تقادم، أخبرونا ونصححه.'
                : '. If this has gone out of date, tell us and we will correct it.'}
            </p>
          </div>
        </section>
      ) : null}

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

          {/* Every claim above that carries a number, with the command that
              re-checks it. This is what stops §03 being prose. */}
          <div className="tablewrap">
            <table className="cmp-facts">
              <thead>
                <tr>
                  <th scope="col">{lang === 'ar' ? 'الدعوى' : 'The claim'}</th>
                  <th scope="col">{lang === 'ar' ? 'الرقم' : 'Figure'}</th>
                  <th scope="col">{lang === 'ar' ? 'كيف تتحققون منه' : 'How you check it'}</th>
                </tr>
              </thead>
              <tbody>
                {facts.map((fact) => (
                  <tr key={fact.figure + fact.claim.en}>
                    <th scope="row">{fact.claim[lang]}</th>
                    <td>{fact.figure}</td>
                    <td>{fact.check[lang]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            The mechanism figure, and it is different on every one of the four.

            Everything above this line is shared on purpose — the same feature
            list shape, the same facts table, the same promise. What was also
            shared, and should not have been, was the drawing: one timeline
            about free time on all four pages, which meant the page arguing
            about *scale* and the page arguing about *who owns the software*
            illustrated themselves with the same picture. Four identical
            documents with the nouns swapped, again, one level down.

            So each shape now gets the mechanism its own argument turns on, and
            each of those is a claim about our software rather than about
            anybody's product:

              scale   the market this was built for, down to the third decimal
              peer    the narrowest, most specific difference there is — a fils
              chain   whose database it is, drawn beside the shape we did not build
              modes   the clock, which is where a spreadsheet actually breaks
          */}
          {lead.shape === 'scale' ? <MinorUnits lang={lang} /> : null}
          {lead.shape === 'peer' ? <AllocationSplit lang={lang} /> : null}
          {lead.shape === 'chain' ? <OwnDatabase lang={lang} /> : null}
          {lead.shape === 'modes' ? <SurfaceTimeline lang={lang} /> : null}
        </div>
      </section>

      {/*
        The screen the page has been asking you to open.

        Four pages arguing entirely in prose and tables, on a site whose central
        claim is *open it and check*, and not one of them showed the thing. The
        capture is of the running build and the caption says what to look at —
        both from `comparison-leads.ts`, so the screen differs per page for the
        same reason the lead does.
      */}
      <section className="band band--white">
        <div className="shell">
          <div className="section-head">
            <p className="eyebrow">
              <b />
              {lang === 'ar' ? 'على الشاشة' : 'On the screen'}
            </p>
            <h2 className="h2">
              {lang === 'ar'
                ? 'الشاشة التي تقوم عليها الحجة أعلاه'
                : 'The screen the argument above is made on'}
            </h2>
          </div>

          <figure className="cmp-figure">
            <div className="frame">
              <img
                src={`/pic/screens/${lead.shot.file}${lang === 'ar' ? '-ar' : ''}.webp`}
                alt={lead.shot.alt[lang]}
                loading="lazy"
                decoding="async"
              />
            </div>
            <figcaption>
              {lead.shot.look[lang]}{' '}
              <a href={DEMO_URL}>{lang === 'ar' ? 'افتحوها بأنفسكم' : 'Open it yourself'}</a>
              {lang === 'ar' ? ' — بلا تسجيل.' : ' — no sign-up.'}
            </figcaption>
          </figure>
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
              {lang === 'ar'
                ? 'اسألوا كلينا هذه، وقارنوا الأجوبة'
                : 'Ask both of us these, and compare the answers'}
            </h2>
            <p className="lead">
              {lang === 'ar'
                ? 'أجوبتنا مكتوبة سلفاً، وإلى جانبها ما يبدو عليه الجواب الجيد من أي مورّد — بما فيه نحن. من يأخذ هذه القائمة إلى مكالمة أخرى ويحصل على جواب أفضل من جوابنا ينبغي له أن يشتري من هناك، وهذا ما يجعل نشرها يستحق.'
                : 'Our answers are already written, and beside each one is what a good answer sounds like from any vendor — including us. Somebody who takes this list to another vendor’s call and gets a better answer than ours should buy from them, which is what makes it worth publishing.'}
            </p>
          </div>

          {/*
            Three columns, and all three carry content.

            The third was a ruled empty box for the reader to complete on the
            call. On paper that is a worksheet; on a screen it read as content
            that had failed to load — a column of dashed rectangles is what a
            broken page looks like, not what an invitation looks like. It also
            had us asking the reader to do the work while supplying nothing.

            What fills it is the thing we can honestly put there: what a good
            answer to that question sounds like from *anybody*. It is not a
            claim about a competitor — every line applies to us as much as to
            them, and two of them are pointedly aimed at us. It also makes the
            table useful away from this page, which the blank column only
            pretended to be.
          */}
          <div className="tablewrap">
            <table className="cmp-ask">
              <thead>
                <tr>
                  <th scope="col">{lang === 'ar' ? 'السؤال' : 'The question'}</th>
                  <th scope="col">{lang === 'ar' ? 'جوابنا' : 'Our answer'}</th>
                  <th scope="col">
                    {lang === 'ar' ? 'كيف يبدو الجواب الجيد' : 'What a good answer sounds like'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {item.ask.map((entry) => (
                  <tr key={entry.question.en}>
                    <th scope="row">{entry.question[lang]}</th>
                    <td>{entry.ours[lang]}</td>
                    <td className="cmp-tell">{entry.tell[lang]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The pricing question above is the one a shape explains faster than
              a sentence. No vendor is named on it and it has no vertical
              scale. */}
          <CostShape lang={lang} />
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
              <EmailLink />
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
