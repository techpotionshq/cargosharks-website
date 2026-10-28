import { Check } from '@phosphor-icons/react/dist/ssr'
import { ChartFigure } from '@/components/charts/ChartFigure'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Bi, Lang } from '@/content/copy'

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
 * Every figure here is about positioning or a working method, never about what
 * a competitor's software can do: the rule `/compare/` states.
 *
 * They sit in `ChartFigure` and are built from `ui/table` and Tailwind, with no
 * `pages.css` classes, so they need no `.doc-page` wrapper. The hand-drawn SVG
 * they replace (a ruler, a Venn, a chain of circles) each said less than the
 * table or the pair of cards that took its place.
 */

/** The vendor pages were read on this date; `comparisons.ts` holds each source. */
const READ_ON: Bi = {
  en: 'Vendor sites, read 25 Aug 2026',
  ar: 'مواقع المورّدين، قُرئت في 25 أغسطس 2026',
}

/**
 * Where two products are aimed, side by side.
 *
 * Both rows come from how each side describes *itself*: theirs quotes 193
 * countries, 30 languages and the operators it addresses (the same facts
 * `comparisons.ts` cites); ours says Kuwait and the Gulf on every page of this
 * site.
 */
export function ScaleRuler({ lang }: { lang: Lang }) {
  // A table, not a ruler. The ruler put "one desk", "10 people", "50", "200"
  // and "global network" on one axis, which is four units pretending to be
  // one, and no source gives either product's range in any single unit. Each
  // cell below is a fact the vendor publishes about itself.
  const ar = lang === 'ar'
  const rows: { key: string; name: string; reach: Bi; languages: Bi; for: Bi }[] = [
    {
      key: 'cargosharks',
      name: 'CargoSharks',
      reach: { en: 'Kuwait and the Gulf', ar: 'الكويت والخليج' },
      languages: { en: '2 (English, Arabic)', ar: '2 (العربية والإنجليزية)' },
      for: { en: 'Freight forwarders', ar: 'وكلاء الشحن' },
    },
    {
      key: 'cargowise',
      name: 'CargoWise',
      reach: { en: '193 countries', ar: '193 دولة' },
      languages: { en: '30', ar: '30' },
      for: {
        en: 'Forwarders, customs brokers, warehouse operators, carriers and drayage operators',
        ar: 'وكلاء الشحن والمخلّصون ومشغّلو المستودعات والناقلون ومشغّلو النقل البري',
      },
    },
  ]

  return (
    <ChartFigure
      title={
        ar
          ? 'ما يقول كل منتج إنه مبني له، بكلماته هو'
          : 'What each product says it is built for, in its own words'
      }
      meta={READ_ON[lang]}
      caption={
        ar
          ? 'كل صفّ من وصف المنتج لنفسه. وكيل شحن في الكويت يستطيع تشغيل أيٍّ منهما، والسؤال: أيّهما بُني لحجمكم؟'
          : 'Each row is how the product describes itself. A forwarder in Kuwait could run either; the question is which was built for your size.'
      }
    >
      {/* On a phone, one short ledger per product: four columns in 310px
          either scrolled half the table out of sight or wrapped "Who it is
          for" one word to a line. From `sm` up, the table. */}
      <div className="flex flex-col gap-6 sm:hidden">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-2">
            <p
              className={`text-small font-semibold ${
                row.key === 'cargosharks' ? 'text-blue-ink' : 'text-heading'
              }`}
            >
              {row.name}
            </p>
            <dl className="divide-y divide-line border-y border-line">
              {[
                { label: ar ? 'أين يعمل' : 'Where it works', value: row.reach[lang] },
                { label: ar ? 'اللغات' : 'Languages', value: row.languages[lang] },
                { label: ar ? 'لمن' : 'Who it is for', value: row.for[lang] },
              ].map((cell) => (
                <div key={cell.label} className="grid grid-cols-[6.5rem_1fr] gap-3 py-2">
                  <dt className="text-label text-ink-faint">{cell.label}</dt>
                  <dd className="figures text-small text-ink">{cell.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <Table className="hidden sm:table">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{ar ? 'المنتج' : 'Product'}</TableHead>
            <TableHead scope="col">{ar ? 'أين يعمل' : 'Where it works'}</TableHead>
            <TableHead scope="col">{ar ? 'اللغات' : 'Languages'}</TableHead>
            <TableHead scope="col">{ar ? 'لمن' : 'Who it is for'}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableHead
                scope="row"
                className={`h-auto py-3 align-top text-small font-semibold ${
                  row.key === 'cargosharks' ? 'text-blue-ink' : 'text-heading'
                }`}
              >
                {row.name}
              </TableHead>
              <TableCell className="text-ink">{row.reach[lang]}</TableCell>
              <TableCell className="figures text-ink">{row.languages[lang]}</TableCell>
              <TableCell className="text-ink-dim">{row.for[lang]}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ChartFigure>
  )
}

/**
 * Two peers, drawn at the real size of their agreement.
 *
 * A page that spends its length hunting for differences between two products
 * aimed at the same buyer is a page that has to invent some. This one opens by
 * conceding the middle, which is most of it. It was a Venn; it is now the four
 * areas both systems cover, ticked under each name. There is deliberately no
 * "only Logistaas" column: saying what their software does or lacks is the
 * claim `/compare/` §03 says we do not publish.
 */
export function OverlapSets({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const shared: Bi[] = [
    { en: 'Quoting', ar: 'التسعير' },
    { en: 'Operations', ar: 'العمليات' },
    { en: 'Documents', ar: 'المستندات' },
    { en: 'Finance', ar: 'المالية' },
  ]
  const yes = ar ? 'نعم' : 'Yes'

  return (
    <ChartFigure
      title={ar ? 'معظم العمل مشترك بين النظامين' : 'Most of the job is shared between the two'}
      caption={
        ar
          ? 'هذه أساسيات يجتازها النظامان. إنها أقرب مقارنة في القائمة، والفروق عند الأطراف ضيّقة ومحددة.'
          : 'Both systems clear these table stakes. It is the closest comparison on the list, and the differences at the edges are narrow and specific.'
      }
    >
      <Table className="mx-auto max-w-xl">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{ar ? 'مجال العمل' : 'Area of work'}</TableHead>
            <TableHead scope="col" className="w-[30%] text-center font-semibold text-blue-ink">
              CargoSharks
            </TableHead>
            <TableHead scope="col" className="w-[30%] text-center font-semibold text-heading">
              Logistaas
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shared.map((area) => (
            <TableRow key={area.en}>
              <TableHead scope="row" className="h-auto py-3 text-small font-semibold text-heading">
                {area[lang]}
              </TableHead>
              <TableCell className="align-middle">
                <Check weight="bold" className="mx-auto size-5 text-blue" role="img" aria-label={yes} />
              </TableCell>
              <TableCell className="align-middle">
                <Check weight="bold" className="mx-auto size-5 text-heading" role="img" aria-label={yes} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ChartFigure>
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
 *
 * The chain is four steps on one rule with the two that matter marked: the
 * forwarder (the buyer, blue) and the terminal (where DP World stands, navy).
 * Under it, the two vendors as two cards; DP World's is on the navy because it
 * is the comparison series, as on every chart on the site.
 */
export function ChainPosition({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const links: { key: string; name: Bi; tone: 'buyer' | 'terminal' | null }[] = [
    { key: 'shipper', name: { en: 'Shipper', ar: 'الشاحن' }, tone: null },
    { key: 'forwarder', name: { en: 'Forwarder', ar: 'وكيل الشحن' }, tone: 'buyer' },
    { key: 'terminal', name: { en: 'Terminal', ar: 'المحطة' }, tone: 'terminal' },
    { key: 'carrier', name: { en: 'Carrier', ar: 'الناقل' }, tone: null },
  ]

  return (
    <ChartFigure
      title={
        ar
          ? 'أين يقف كل مورّد في سلسلة الشحن'
          : 'Where each software vendor stands in the freight chain'
      }
      caption={
        ar
          ? 'الطرفان ينشران هذا. القرب من المحطة ميزة إن كان حجمكم يمرّ عبرها، وسؤال يستحق الطرح إن لم يكن.'
          : 'Both parties publish this. Closeness to the terminal is an advantage if your volume runs through it, and a question to ask if not.'
      }
    >
      <div className="flex flex-col gap-7">
        {/* One rule through four nodes, from the first node's centre to the
            last's, so it never pokes out past either end. */}
        <ol className="relative grid grid-cols-4">
          <span
            aria-hidden="true"
            className="absolute inset-x-[12.5%] top-[9px] h-0.5 bg-line-strong"
          />
          {links.map((link) => (
            <li key={link.key} className="relative flex flex-col items-center gap-2.5 text-center">
              <span
                aria-hidden="true"
                className={`size-5 rounded-full ring-4 ring-paper-lift ${
                  link.tone === 'buyer'
                    ? 'bg-blue'
                    : link.tone === 'terminal'
                      ? 'bg-heading'
                      : 'border-2 border-line-strong bg-paper-lift'
                }`}
              />
              <span
                className={`text-small ${
                  link.tone === 'buyer'
                    ? 'font-semibold text-blue-ink'
                    : link.tone === 'terminal'
                      ? 'font-semibold text-heading'
                      : 'text-ink-dim'
                }`}
              >
                {link.name[lang]}
              </span>
              {/* Who stands at the two marked links, so the cards below read
                  against the chain without a connector line. */}
              {link.tone ? (
                <span className="-mt-2 text-label text-ink-faint">
                  {link.tone === 'buyer' ? (ar ? 'أنتم' : 'You') : 'DP World'}
                </span>
              ) : null}
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-5">
            <p className="text-small font-semibold text-blue-ink">CargoSharks</p>
            <p className="text-small text-ink-dim">
              {ar
                ? 'نبيع البرنامج فقط، ولا نشغّل شيئاً تحجزون فيه.'
                : 'Sells the software and nothing else. It operates nothing you book through.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-void p-5">
            <p className="text-small font-semibold text-on-void">DP World</p>
            <p className="text-small text-on-void-dim">
              {ar
                ? 'تشغّل محطات في هذه السلسلة، وتبيع البرنامج لوكلاء الشحن.'
                : 'Runs terminals in this chain, and sells the software to forwarders.'}
            </p>
          </div>
        </div>
      </div>
    </ChartFigure>
  )
}
