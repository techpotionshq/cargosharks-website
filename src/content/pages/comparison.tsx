import type { Metadata } from 'next'
import type { ComponentType } from 'react'
import {
  ArrowUpRight,
  CaretDown,
  ClockCounterClockwise,
  Coins,
  Database,
  MonitorPlay,
  Translate,
} from '@phosphor-icons/react/dist/ssr'
import {
  AskUs,
  ComparePage,
  ComparisonLinks,
  DarkLedger,
  Masthead,
  OUR_SPEC,
  Tail,
} from '@/components/compare/parts'
import { Reveal } from '@/components/Reveal'
import { Breadcrumbs, FaqSchema } from '@/components/StructuredData'
import { Section, SectionHeader } from '@/components/ui/section'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { leads } from '@/content/comparison-leads'
import { comparisons, facts, type Comparison } from '@/content/comparisons'
import { DEMO_URL } from '@/content/copy'
import { CostShape, SurfaceTimeline } from '@/content/pages/comparison-figures'
import { ChainPosition, OverlapSets, ScaleRuler } from '@/content/pages/comparison-leads'
import { AccrualStair, AllocationSplit, MinorUnits } from '@/content/pages/figures'
import { OwnDatabase } from '@/content/pages/illustrations'
import { STAGGER } from '@/lib/motion'
import { pageOpenGraph } from '@/lib/og'

/**
 * One comparison page, rendered from a row in `comparisons.ts` and its lead in
 * `comparison-leads.ts`. English only.
 *
 * The order of the sections is the argument, and it is not a sales page's:
 *
 *   1. The question this comparison turns on, drawn (`lead.shape`).
 *   2. What they say about themselves, quoted, linked and dated, beside where
 *      they are the better answer. Before a word about us.
 *   3. Where we are, with the mechanism drawn.
 *   4. How to check each claim in the demo.
 *   5. The screen, the questions to ask both of us, and the policy note.
 *
 * Shapes vary down the page as `DESIGN.md` asks: a split with a chart, two
 * columns on a sunk band, a row of cards, a table beside its heading, one dark
 * band for the screenshot, then `<details>` for the questions. The old version
 * repeated one centred heading-lead-list block with a numbered eyebrow eight
 * times, at about twice the height.
 */

/** Per-slug metadata, so the four route files stay one line each. */
export function comparisonMetadata(slug: string): Metadata {
  const item = comparison(slug)
  const path = `/compare/${slug}/`
  return {
    title: item.meta.title,
    description: item.meta.description,
    alternates: { canonical: path },
    openGraph: pageOpenGraph({
      path,
      title: item.meta.title,
      description: item.meta.description,
      type: 'article',
    }),
  }
}

export function comparison(slug: string): Comparison {
  const item = comparisons.find((entry) => entry.slug === slug)
  if (!item) throw new Error(`No comparison for ${slug}`)
  return item
}

/** One icon per shared "pick us" point, in `OUR_POINTS` order. */
const POINT_ICONS: ComponentType<{ className?: string; weight?: 'regular' }>[] = [
  Translate,
  Coins,
  Database,
  ClockCounterClockwise,
  MonitorPlay,
]

/** The lead chart, by the shape of the argument. */
const LEAD_FIGURE = {
  scale: ScaleRuler,
  peer: OverlapSets,
  chain: ChainPosition,
  modes: AccrualStair,
}

/**
 * The mechanism the page's own argument turns on, and a different one on each:
 * the dinar's third decimal for scale, a split charge for the closest peer,
 * whose database it is for the terminal operator's software, and the clock for
 * the spreadsheet.
 */
const MECHANISM_FIGURE = {
  scale: MinorUnits,
  peer: AllocationSplit,
  chain: OwnDatabase,
  modes: SurfaceTimeline,
}

export function ComparisonContent({ item }: { item: Comparison }) {
  const lead = leads[item.slug]!
  const LeadFigure = LEAD_FIGURE[lead.shape]
  const Mechanism = MECHANISM_FIGURE[lead.shape]
  const vendor = item.source !== null

  return (
    <ComparePage>
      <Breadcrumbs
        trail={[
          { name: 'Compare', path: '/compare/' },
          { name: `CargoSharks vs ${item.name}`, path: `/compare/${item.slug}/` },
        ]}
      />

      <Masthead
        title={item.h1.en}
        lede={item.lede.en}
        aside={
          // The fact sheet answers what a buyer checks first; on a phone it
          // pushed the page's own argument half a screen further down,
          // so it starts at tablet width.
          <div className="hidden md:block">
            <DarkLedger rows={OUR_SPEC} />
          </div>
        }
      />

      {/* 1. The question underneath, and its chart. */}
      <Section>
        <div className="shell flex flex-col gap-10">
          <Reveal>
            <SectionHeader title={lead.heading.en} lede={lead.body.en} />
          </Reveal>
          {lead.moments ? (
            <dl className="divide-y divide-line border-y border-line">
              {lead.moments.map((moment) => (
                <div
                  key={moment.when.en}
                  className="grid grid-cols-1 gap-2 py-5 lg:grid-cols-12 lg:gap-8"
                >
                  <dt className="font-display text-h3 font-bold text-heading lg:col-span-3">
                    {moment.when.en}
                  </dt>
                  <dd className="text-body text-ink-dim lg:col-span-5">{moment.what.en}</dd>
                  <dd className="border-s-2 border-blue/40 ps-4 text-small text-ink-dim lg:col-span-4">
                    <span className="font-semibold text-heading">On a file: </span>
                    {moment.instead.en}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {/* Every lead figure sits in `ChartFigure` on Tailwind alone, so it
              needs no `.doc-page` scope. */}
          <LeadFigure lang="en" />

        </div>
      </Section>

      {/* 2. Theirs, then the case for them, side by side. */}
      <Section rule tone="sunk">
        <div className="shell grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <Reveal className="min-w-0 lg:col-span-6">
            <h2 className="max-w-[22ch] text-balance font-display text-h2 font-extrabold text-heading">
              {vendor ? `What ${item.name} says about itself` : 'How it runs today'}
            </h2>
            {vendor ? (
              <>
                <blockquote className="mt-6 border-s-2 border-line-strong ps-5 text-body text-ink sm:text-lede">
                  {item.theirPitch.en}
                </blockquote>
                {/* The source and the day it was read, printed rather than
                    buried: a dated claim goes stale visibly. */}
                <p className="mt-5 text-small text-ink-dim">
                  Read from{' '}
                  <a
                    href={item.source!}
                    rel="nofollow noopener"
                    target="_blank"
                    className="inline-flex items-center gap-1 text-blue-ink hover:underline"
                  >
                    {item.source!.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    <ArrowUpRight weight="bold" className="size-3.5" />
                  </a>{' '}
                  on <span className="figures font-mono">{item.checked}</span>. If it has gone
                  out of date, tell us and we will correct it.
                </p>
              </>
            ) : (
              <p className="mt-6 max-w-[56ch] text-lede text-ink-dim">{item.theirPitch.en}</p>
            )}
          </Reveal>
          <Reveal className="min-w-0 lg:col-span-6" delay={STAGGER}>
            <h2 className="font-display text-h2 font-extrabold text-heading">
              {item.pickThem.heading.en}
            </h2>
            <ul className="mt-6 divide-y divide-line border-y border-line">
              {item.pickThem.points.map((point) => (
                <li key={point.en} className="py-4 text-body text-ink-dim">
                  {point.en}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Section>

      {/* 3. The case for us: five mechanisms as cards, then the one drawn.
          The spreadsheet page made its case in the moments above, so it shows
          only the drawing. */}
      <Section rule>
        <div className="shell flex flex-col gap-10">
          <Reveal>
            <SectionHeader
              title={item.pickUs.heading.en}
              lede={
                vendor
                  ? 'Each point is a mechanism you can check in the demo.'
                  : 'On a file, the milestone starts the clock, so the charge is known on the first day it accrues.'
              }
            />
          </Reveal>
          {item.pickUs.points.length > 0 ? (
            <Reveal
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4"
              delay={STAGGER}
            >
              {item.pickUs.points.map((point, index) => {
                const Icon = POINT_ICONS[index]
                return (
                  <article
                    key={point.en}
                    className="flex flex-row items-start gap-4 lg:flex-col lg:gap-3 lg:rounded-lg lg:border lg:border-line lg:bg-paper-lift lg:p-5"
                  >
                    {Icon ? (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-blue/8 text-blue-ink">
                        <Icon weight="regular" className="size-5" />
                      </span>
                    ) : null}
                    <p className="text-small text-ink-dim">{point.en}</p>
                  </article>
                )
              })}
            </Reveal>
          ) : null}
          <Mechanism lang="en" />
        </div>
      </Section>

      {/* 4. Each claim, and how a buyer checks it in the demo. It used to print
          SQL and hand-typed counts; see `facts` in `comparisons.ts`. */}
      <Section rule tone="lift" space="tight">
        <div className="shell grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <h2 className="text-balance font-display text-h2 font-extrabold text-heading">
              Check each claim in the demo
            </h2>
            <p className="mt-4 max-w-[40ch] text-body text-ink-dim">
              No sign-up and no call. All of it takes about ten minutes.
            </p>
          </div>
          <div className="min-w-0 lg:col-span-8">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">The claim</TableHead>
                  <TableHead scope="col">How to check it</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {facts.map((fact) => (
                  <TableRow key={fact.claim.en}>
                    <TableHead
                      scope="row"
                      className="h-auto w-[34%] py-3 align-top text-small font-semibold whitespace-normal text-ink"
                    >
                      {fact.claim.en}
                    </TableHead>
                    <TableCell className="text-ink-dim">{fact.check.en}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Section>

      {/* 5. The screen the argument is made on: the one dark band. */}
      <section className="bg-void py-16 text-on-void md:py-20">
        <div className="shell flex flex-col gap-8">
          <h2 className="max-w-[24ch] text-balance font-display text-h2 font-extrabold">
            The screen this argument rests on
          </h2>
          <figure className="overflow-hidden rounded-xl border border-void-line bg-void-lift">
            <img
              src={`/pic/screens/${lead.shot.file}.webp`}
              alt={lead.shot.alt.en}
              width={2360}
              height={1476}
              loading="lazy"
              decoding="async"
              className="w-full"
            />
            <figcaption className="flex flex-col gap-2 border-t border-void-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <span className="max-w-[80ch] text-small text-on-void-dim">{lead.shot.look.en}</span>
              <a
                href={DEMO_URL}
                className="inline-flex shrink-0 items-center gap-1.5 text-small font-medium text-blue-lit hover:underline"
              >
                Open it yourself, no sign-up
                <ArrowUpRight weight="bold" className="size-3.5" />
              </a>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* 6. The questions, as `<details>` so the answers are in the HTML, and
          the same strings `FaqSchema` marks up. */}
      <Section>
        <div className="shell flex flex-col gap-10">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <h2 className="text-balance font-display text-h2 font-extrabold text-heading">
                Ask both of us these, and compare the answers
              </h2>
              <p className="mt-4 max-w-[44ch] text-body text-ink-dim">
                Our answers are written down, and under each is what a good answer sounds like
                from any vendor, us included. If another vendor answers better, buy from them.
              </p>
            </div>
            <div className="divide-y divide-line border-y border-line lg:col-span-7">
              {item.ask.map((entry) => (
                <details key={entry.question.en} className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 py-4 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {entry.question.en}
                    <CaretDown
                      weight="bold"
                      className="size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="flex max-w-[64ch] flex-col gap-3 pb-5">
                    <p className="text-body text-ink-dim">{entry.ours.en}</p>
                    <p className="border-s-2 border-blue/40 ps-4 text-small text-ink-dim">
                      <span className="font-semibold text-heading">
                        What a good answer sounds like:{' '}
                      </span>
                      {entry.tell.en}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          </div>
          {/* The pricing question, as a shape. No vendor is named on it. */}
          <CostShape lang="en" />
        </div>
        <FaqSchema
          items={item.ask.map((entry) => ({
            question: entry.question.en,
            answer: entry.ours.en,
          }))}
        />
      </Section>

      {/* 7. The policy, and the other comparisons. */}
      <Section rule tone="sunk" space="tight">
        <div className="shell grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <h2 className="font-display text-h3 font-bold text-heading">
              Why there is no tick-and-cross grid
            </h2>
            <p className="mt-3 max-w-[60ch] text-body text-ink-dim">
              We know our product properly and theirs from the outside, and a grid written by one
              side goes stale silently. Ask us directly at <AskUs /> and you will get a written
              answer that cites what each vendor publishes, and “we do not know” where we do not.
            </p>
          </div>
          <div className="lg:col-span-6">
            <h2 className="font-display text-h3 font-bold text-heading">Other comparisons</h2>
            <div className="mt-3">
              <ComparisonLinks except={item.slug} />
            </div>
          </div>
        </div>
      </Section>

      <Tail
        heading="See it on your own lanes."
        body="The demo is the real software on seeded data, open with no sign-up. The demo call is free, and we tailor it to your shipments."
      />
    </ComparePage>
  )
}
