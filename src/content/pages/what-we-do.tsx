import type { ComponentType, ReactNode } from 'react'
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  ClockCounterClockwise,
  Database,
  GlobeHemisphereEast,
  LockKey,
  PaintBrush,
} from '@phosphor-icons/react/dist/ssr'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Reveal } from '@/components/Reveal'
import { Breadcrumbs } from '@/components/StructuredData'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Section, SectionHeader } from '@/components/ui/section'
import { DEMO_URL } from '@/content/copy'
import {
  AccrualStair,
  ChargeableColumns,
  DutyMatrix,
  MilestoneStrips,
  MinorUnits,
} from '@/content/pages/figures'
import { STAGGER } from '@/lib/motion'

/**
 * `/what-we-do/`: the whole product on one page, English only.
 *
 * It used to be a converted HTML document inside `DocPage`, on `pages.css`:
 * eight numbered bands, each a centred eyebrow, heading and lead over a
 * full-width figure, about 16,000px tall on a desktop. It is on the same
 * system as the home page and the market pages now (`SolutionPage`), and
 * what changed is mostly layout:
 *
 *   - **Figures sit beside the copy they prove** instead of under it, so a
 *     section costs one row of height rather than three.
 *   - **Paragraphs that said the same thing twice are one paragraph.** The
 *     loop's lead and the boundary figure's caption both explained "nothing is
 *     retyped"; the modes table and the chargeable-weight figure both listed
 *     the divisors. Every fact the old page stated is still here.
 *   - **Three drawings that restated a paragraph are not rendered**:
 *     `LayeredRecord` (supersede, never overwrite), `OwnDatabase` (one
 *     database per customer) and `ScopeSpan` (the six states over the five
 *     exclusions, both already on the page as text). The five figures that
 *     carry data of their own stay, each given the width it needs.
 *   - **The stale roadmap paragraph is gone.** It listed the agent portal and
 *     WhatsApp intake as coming; both ship (`scripts/blog/product-facts.md`).
 *
 * The figures come from `figures.tsx`, each in its own `ChartFigure` card, so
 * the page sets them like any other block and no longer loads `pages.css`.
 *
 * The `id`s on the sections are the header menu's anchors (`nav` in
 * `copy.ts`) and are linked from the compare, privacy and terms pages: keep
 * them when moving sections around.
 */

function H2({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <h2
      className={`max-w-[22ch] text-balance font-display text-h2 font-extrabold ${dark ? 'text-on-void' : 'text-heading'}`}
    >
      {children}
    </h2>
  )
}

/** Label and body pairs with a rule on the start side, for the points beside a figure. */
function Points({ items }: { items: { label: string; body: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-1">
      {items.map((item) => (
        <div key={item.label} className="border-s-2 border-blue/40 ps-4">
          <dt className="text-body font-semibold text-heading">{item.label}</dt>
          <dd className="mt-0.5 text-small text-ink-dim">{item.body}</dd>
        </div>
      ))}
    </dl>
  )
}

const link = 'font-medium text-blue-ink underline-offset-2 hover:underline'

const FACTS = [
  { label: 'Modes', value: 'Sea FCL, sea LCL, air, land and courier' },
  { label: 'Languages', value: 'Arabic and English, built together' },
  { label: 'Money', value: 'Decimal throughout; the dinar keeps three places' },
  { label: 'E-invoicing', value: 'Saudi ZATCA Phase 2 and UAE e-invoicing' },
  { label: 'Hosting', value: 'Your own database, in the region you choose' },
]

const STATES = [
  { name: 'Enquiry', body: 'One queue across every branch, one owner, one response clock.' },
  {
    name: 'Quote',
    body: 'Priced from your own card where one covers the lane; sent to agents where it does not.',
  },
  { name: 'Award', body: 'Acceptance converts the quote. Buy, sell and margin lock to the record.' },
  { name: 'Execution', body: 'Milestones, customs stage, containers, free-time clocks, exceptions.' },
  {
    name: 'Documents',
    body: 'Typed, versioned and attached; released to the customer where permitted.',
  },
  {
    name: 'Invoice',
    body: 'Raised from the job’s own cost ledger, in the right entity, currency and language.',
  },
]

/*
 * Every figure here is a seed row in the product's `packages/core/src/chargeable.ts`,
 * not a number written for a website. They are configuration: an airline that
 * moves from a 6,000 divisor to a 5,000 one is an administrator's edit, not a
 * release.
 */
const MODES = [
  {
    name: 'Sea FCL',
    unit: 'per container',
    note: 'Volume never enters it. Rated by container type and count, with demurrage, detention and storage clocks per container against the carrier’s free days.',
  },
  {
    name: 'Sea LCL',
    unit: 'revenue ton',
    note: 'The greater of cubic metres and metric tonnes: a 1,000 cm³/kg divisor, one cbm to one tonne, with a 1,000 kg minimum.',
  },
  {
    name: 'Air',
    unit: 'chargeable kg',
    note: 'The IATA 6,000 cm³/kg divisor, 166.67 kg to the cubic metre. Rounded up to the next half kilo, floored at 45 kg; weight breaks as your carrier states them.',
  },
  {
    name: 'Land',
    unit: 'chargeable kg',
    note: 'A 3,000 cm³/kg divisor, rounded up to the whole kilo, no minimum.',
  },
  {
    name: 'Courier',
    unit: 'chargeable kg',
    note: 'A 5,000 cm³/kg divisor, rounded up to the next half kilo, floored at half a kilo.',
  },
]

const PARTS: {
  title: string
  lede: string
  shot: { src: string; alt: string }
  points: { label: string; body: ReactNode }[]
}[] = [
  {
    title: 'Commercial: from enquiry to quotation in one place',
    lede: 'Every enquiry, wherever it came from, with an owner and a clock, and a price from your own contracts.',
    shot: {
      src: '/pic/screens/enquiries.webp',
      alt: 'The enquiry queue: every enquiry with an owner, a status and a response deadline',
    },
    points: [
      {
        label: 'The queue',
        body: 'Web form, email, WhatsApp and phone enquiries in one list across every branch, each with an owner, a status and a response deadline, so response time is measured.',
      },
      {
        label: 'The inbox',
        body: 'An email to a branch mailbox is read into a proposal (parties, lane, cargo, request) that a coordinator accepts or rejects. Nothing becomes an enquiry without a person, and the proposal is kept beside the decision.',
      },
      {
        label: 'Pricing and margin',
        body: 'Buy and sell rate cards by lane, mode and carrier, whose validity dates make two overlapping cards on a lane impossible to save. Buy, sell and margin sit side by side on every option before it goes out.',
      },
      {
        label: 'The lanes you quote blind',
        body: 'The rate-card screen names the lanes with no live buying rate and the cards expiring within thirty days.',
      },
    ],
  },
  {
    title: 'Operations: the board shows what is wrong before the customer does',
    lede: 'Live shipments ordered by exception, oldest first, because the one nobody has looked at is the one the process missed.',
    shot: {
      src: '/pic/screens/jobs.webp',
      alt: 'The operations board: live shipments ordered by exception, oldest first',
    },
    points: [
      {
        label: 'The job file',
        body: 'Milestones by mode and direction, kept as planned, revised and actual, because the difference between them is the conversation.',
      },
      {
        label: 'Customs',
        body: 'Declarations ordered by the window that closes first, with status, duty, broker and deadline, and a duty estimate from the tariff table before filing. Holds and inspections sit on the board.',
      },
      {
        label: 'Free time',
        body: 'Demurrage, detention and storage clocks per container against the carrier’s free days. When free time ends, the clock writes its own charge line against the right counterparty at the right per-diem rate.',
      },
      {
        label: 'Consolidation',
        body: 'A master with its houses, the manifest generated from them, and the master’s costs apportioned so each house’s margin is real.',
      },
      {
        label: 'Ask it',
        body: 'An assistant that answers over your own data (whose free time ends this week, which invoices are overdue, where a supplier billed more than the job accrued) and sees only what the person asking may see.',
      },
    ],
  },
  {
    title: 'Finance and documents: what you are owed, how late, and who to ring',
    lede: 'Job costing, invoicing and receivables across entities and currencies, and every document the job issues, versioned.',
    shot: {
      src: '/pic/screens/finance.webp',
      alt: 'Receivables grouped by how late they are, largest exposure first',
    },
    points: [
      {
        label: 'Currency',
        body: 'Decimal throughout and rounded per currency at the line, so the Kuwaiti dinar keeps its three places. Each charge line stores its own exchange rate and when it was taken.',
      },
      {
        label: 'Separated duties',
        body: 'Draft, approved, issued, part-paid, paid, credited. Only Finance may issue, void or credit an invoice.',
      },
      {
        label: 'Supplier bills',
        body: 'A scan or an emailed bill is read into lines and matched against what the job accrued; the variance shows before anyone approves it.',
      },
      {
        label: 'E-invoicing',
        body: (
          <>
            VAT category, rate and exemption code on every line. Saudi invoices clear with ZATCA
            Phase 2 as they are issued; UAE invoices go to the customer’s accredited service
            provider (
            <a href="/uae-e-invoicing-freight-forwarders/" className={link}>
              UAE e-invoicing
            </a>
            ).
          </>
        ),
      },
      {
        label: 'Documents',
        body: 'House bill of lading or air waybill, delivery order, packing list, customs pack, consolidation manifest. Bilingual, numbered from the issuing branch’s series; customers see released documents, never drafts.',
      },
    ],
  },
]

const GUARANTEES: {
  icon: ComponentType<{ className?: string; weight?: 'regular' }>
  title: string
  body: string
}[] = [
  {
    icon: ClockCounterClockwise,
    title: 'The audit trail writes itself',
    body: 'Eighty database triggers, so a change that goes around the application is still recorded. Editing the audit is revoked from every account, your administrator’s and ours alike.',
  },
  {
    icon: Archive,
    title: 'Nothing is ever deleted',
    body: 'Records are superseded, closed or deactivated. The permission to delete does not exist on the account the application runs as.',
  },
  {
    icon: GlobeHemisphereEast,
    title: 'The region is yours to pick',
    body: 'Kuwait, the UAE, Saudi Arabia or the EU, chosen by you and written into the contract.',
  },
  {
    icon: PaintBrush,
    title: 'Your brand, and nowhere ours',
    body: 'No colour, logo or company name is written into the product. The operator is a setting, so your customer never sees a supplier badge.',
  },
  {
    icon: LockKey,
    title: 'Support cannot look without a grant',
    body: 'Your administrator grants access to named branches against a ticket reference, and it expires on its own. A banner shows while it is open; one click revokes it.',
  },
  {
    icon: Database,
    title: 'Counted on a live database',
    body: '88 tables, 197 policies and 80 audit triggers, counted against a running PostgreSQL 18.6 rather than estimated from a design document.',
  },
]

const EXCLUSIONS = [
  {
    label: 'Warehouse management',
    body: 'Inventory, locations, pick and pack. That is a product in its own right, and it does not bolt onto a forwarding platform as a module.',
  },
  {
    label: 'Purchase orders and vendor management',
    body: 'It sits on top of a working job platform. Until the job platform is working, it has nothing to sit on.',
  },
  {
    label: 'Native mobile applications',
    body: 'Proof of delivery already works from a phone browser: signature, photographs, recipient and location. An app doing the same is a second thing to keep in step.',
  },
  {
    label: 'Direct customs filing in Kuwait',
    body: 'Clearance runs through MicroClear, which is not an API a forwarder can buy. We track declarations and estimate duty; we do not file them, and we are not planning to.',
  },
  {
    label: 'Master carrier documents',
    body: 'A master bill is the carrier’s document, issued on the carrier’s stock. House documents are ours, and those we generate.',
  },
]

export function WhatWeDoPage() {
  return (
    <>
      <Header lang="en" mark={<Wordmark tone="onDark" height={24} />} />
      <main id="top">
        <Breadcrumbs trail={[{ name: 'What we do', path: '/what-we-do/' }]} />

        {/* Masthead: the claim and the two actions, and the five facts a buyer
            checks first, so the first screen answers them. The fact sheet is
            desktop only: every line of it is said again further down, and on
            a phone it pushed the first section a whole screen away. */}
        <section className="bg-void pt-32 pb-16 text-on-void lg:pt-36 lg:pb-20">
          <div className="shell grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-end lg:gap-16">
            <div className="lg:col-span-7">
              <h1 className="max-w-[22ch] text-balance font-display text-display font-extrabold">
                Freight forwarding software for the whole of one job, in one record
              </h1>
              <p className="mt-6 max-w-[58ch] text-lede text-on-void-dim">
                An enquiry arrives, is priced from your own contracts, quoted, awarded, executed,
                documented and invoiced, and none of it is typed into a second system. Built in
                Arabic and English at the same time, on a database that belongs to you.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <a href={DEMO_URL}>
                    Open the live demo
                    <ArrowRight weight="bold" className="size-4 rtl:-scale-x-100" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="onDark">
                  <a href="/#demo">Book a demo</a>
                </Button>
                <a
                  href="/compare/"
                  className="ms-2 inline-flex min-h-10 items-center text-body text-on-void-dim underline-offset-4 hover:text-on-void hover:underline"
                >
                  How we are different
                </a>
              </div>
            </div>
            <dl className="hidden divide-y divide-void-line border-y border-void-line lg:col-span-5 lg:block">
              {FACTS.map((row) => (
                <div key={row.label} className="grid grid-cols-5 gap-4 py-3.5">
                  <dt className="col-span-2 text-small text-on-void-faint">{row.label}</dt>
                  <dd className="col-span-3 text-small text-on-void">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Split: why anyone changes. */}
        <Section id="problem" space="tight">
          <Reveal className="shell grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <H2>The problem is not your people</H2>
            </div>
            <div className="flex max-w-[64ch] flex-col gap-4 text-body text-ink-dim lg:col-span-7">
              <p className="text-lede">
                Your rates are in spreadsheets, so a quotation takes a day and a half. Your
                enquiries are in four mailboxes, so nobody owns them and nobody is timed. Customers
                find their container by ringing someone who has to go and find out. And the margin
                on a job is a number you reconstruct at month-end instead of one you knew when you
                quoted.
              </p>
              <p>
                <strong className="font-semibold text-ink">
                  Each of those is a system-of-record problem.
                </strong>{' '}
                Training does not fix them and a better spreadsheet does not either. They persist
                because the job lives in an inbox, a folder, a WhatsApp thread and somebody’s
                memory, and no two of those agree. It costs you the jobs priced too slowly, and the
                ones priced too cheaply.
              </p>
            </div>
          </Reveal>
        </Section>

        {/* The loop: six states, in order, so the numbers are information. Then
            the fourth state drawn at the six lengths it actually has. */}
        <Section id="loop" rule tone="lift">
          <div className="shell">
            <Reveal>
              <SectionHeader
                title="One record from enquiry to paid invoice"
                lede="Each state hands the next everything it needs, so nothing is retyped differently. Accepting a quotation opens the job with buy and sell rates attached, so margin is a live figure, and a revision supersedes the quotation before it instead of overwriting what the customer accepted."
              />
            </Reveal>
            <Reveal delay={STAGGER}>
              <ol className="mt-10 grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-6 lg:border-b">
                {STATES.map((state, index) => (
                  <li
                    key={state.name}
                    className="flex flex-col gap-1.5 border-b border-line py-4 pe-4 lg:border-b-0 lg:border-s lg:ps-4 lg:first:border-s-0 lg:first:ps-0"
                  >
                    <span className="figures font-mono text-label text-blue-ink">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-display text-h3 font-bold text-heading">{state.name}</h3>
                    <p className="text-small text-ink-dim">{state.body}</p>
                  </li>
                ))}
              </ol>
            </Reveal>
            <Reveal className="mt-12">
              <MilestoneStrips lang="en" />
            </Reveal>
          </div>
        </Section>

        {/* Beside a document: the rules on one side, the rules run on the other. */}
        <Section id="modes" rule tone="sunk">
          <div className="shell grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-16">
            <Reveal className="lg:col-span-5">
              <H2>Five modes, each calculated its own way</H2>
              <p className="mt-5 max-w-[58ch] text-lede text-ink-dim">
                Freight is billed on the greater of weight and volume, converted by a divisor that
                differs per mode, rounded up to that mode’s increment and floored at its minimum.
                Using one mode’s arithmetic for another is where a rate stops matching the invoice.
              </p>
              <dl className="mt-6 divide-y divide-line border-y border-line">
                {MODES.map((mode) => (
                  <div key={mode.name} className="grid grid-cols-[7rem_1fr] gap-4 py-3.5 sm:grid-cols-7">
                    <dt className="sm:col-span-2">
                      <span className="block text-body font-semibold text-heading">
                        {mode.name}
                      </span>
                      <span className="block text-label text-ink-faint">{mode.unit}</span>
                    </dt>
                    <dd className="text-small text-ink-dim sm:col-span-5">{mode.note}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
            <Reveal className="min-w-0 lg:sticky lg:top-28 lg:col-span-7 lg:pt-2" delay={STAGGER}>
              <ChargeableColumns lang="en" />
            </Reveal>
          </div>
        </Section>

        {/* The three halves of the day as three parallel columns, each under
            its screen from the running build. Side by side they cost one
            column's height instead of three rows'. */}
        <Section id="parts" rule>
          <div className="shell">
            <Reveal>
              <SectionHeader
                title="What each part of it does"
                lede="Commercial, operations and finance. The screens are captures of the running build, the same ones you can open yourself in the demo."
              />
            </Reveal>
            <div className="mt-12 grid grid-cols-1 gap-14 lg:grid-cols-3 lg:gap-8">
              {PARTS.map((part, index) => (
                <Reveal
                  key={part.title}
                  delay={index * STAGGER}
                  className="flex min-w-0 flex-col gap-5 lg:border-s lg:border-line lg:ps-8 lg:first:border-s-0 lg:first:ps-0"
                >
                  <figure className="overflow-hidden rounded-lg border border-line bg-paper-lift shadow-sm">
                    <img
                      src={part.shot.src}
                      alt={part.shot.alt}
                      width={2360}
                      height={1475}
                      loading="lazy"
                      decoding="async"
                      className="w-full"
                    />
                  </figure>
                  <div>
                    <h3 className="text-balance font-display text-h3 font-bold text-heading">
                      {part.title}
                    </h3>
                    <p className="mt-2 text-small text-ink-dim">{part.lede}</p>
                  </div>
                  <Points items={part.points} />
                </Reveal>
              ))}
            </div>
            <p className="mt-12">
              <a
                href={DEMO_URL}
                className="inline-flex min-h-10 items-center gap-1.5 text-body font-medium text-blue-ink hover:underline"
              >
                Open these screens yourself, no sign-up
                <ArrowUpRight weight="bold" className="size-3.5 rtl:-scale-x-100" />
              </a>
            </p>
          </div>
        </Section>

        {/* The decimals beside the copy (an HTML figure, legible at that width),
            the clock under both across the full shell (an SVG, which is not). */}
        <Section id="mechanisms" rule tone="sunk">
          <div className="shell">
            <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-16">
              <Reveal className="lg:col-span-5">
                <H2>The clock nobody starts, and the decimal nobody keeps</H2>
                <p className="mt-5 max-w-[56ch] text-lede text-ink-dim">
                  Everything in this category quotes, books and invoices. These two are what fail
                  between a demo and a Kuwaiti operation: the free-time clock needs a scheduled job
                  rather than a screen to look at, and the dinar needs a product designed around
                  three decimal places.
                </p>
              </Reveal>
              <Reveal className="min-w-0 lg:col-span-7" delay={STAGGER}>
                <MinorUnits lang="en" />
              </Reveal>
            </div>
            <Reveal className="mt-12">
              <AccrualStair lang="en" />
            </Reveal>
          </div>
        </Section>

        {/* Dark band over the port: the argument changes register here, from
            what the software does to what it looks like to your customer. */}
        <section
          id="bilingual"
          className="relative isolate scroll-mt-24 overflow-hidden bg-void py-16 text-on-void md:py-20"
        >
          <img
            src="/pic/photos/containers-aerial.webp"
            alt=""
            width={1600}
            height={1067}
            loading="lazy"
            className="absolute inset-0 -z-20 h-full w-full object-cover"
          />
          <div className="absolute inset-0 -z-10 bg-void/90" />
          <div className="shell">
            <Reveal>
              <SectionHeader
                dark
                title="Built in Arabic and English at the same time"
                lede="2,727 interface strings in both languages, kept in sync, with right-to-left in the layout from the start. Most products in this market were built in English with Arabic added later. You can tell within about four seconds, and so can your customer."
              />
            </Reveal>
            <Reveal className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2" delay={STAGGER}>
              <figure className="min-w-0">
                <img
                  src="/pic/screens/english.webp"
                  alt="The dashboard in English: four figures, the map, and the assistant, laid out left to right"
                  width={2360}
                  height={1619}
                  loading="lazy"
                  decoding="async"
                  className="w-full rounded-lg border border-void-line"
                />
                <figcaption className="mt-3 text-small text-on-void-dim">
                  English, left to right
                </figcaption>
              </figure>
              <figure className="min-w-0">
                <img
                  src="/pic/screens/arabic.webp"
                  alt="The same dashboard in Arabic: the same four figures and the same map, laid out right to left"
                  width={2360}
                  height={1619}
                  loading="lazy"
                  decoding="async"
                  className="w-full rounded-lg border border-void-line"
                />
                <figcaption dir="rtl" lang="ar" className="mt-3 text-small text-on-void-dim">
                  العربية، من اليمين إلى اليسار
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </section>

        {/* Ownership: the claim beside its drawing, then the six guarantees as
            cards, then the duty matrix beside what it is. */}
        <Section id="ownership">
          <div className="shell">
            <Reveal>
              <SectionHeader
                title="Your database, your brand, your data"
                lede={
                  <>
                    One deployment per customer: your own database in your own instance, with no
                    shared table and no customer column. Inside it the database separates branches,
                    so another branch’s shipment comes back <em>not found</em>, because the row is
                    never in the answer.
                  </>
                }
              />
            </Reveal>

            <Reveal className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {GUARANTEES.map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="grid grid-cols-[auto_1fr] content-start items-center gap-x-4 gap-y-3 rounded-lg border border-line bg-paper-lift p-5"
                >
                  <span className="flex size-10 items-center justify-center rounded-md bg-blue/8 text-blue-ink">
                    <Icon weight="regular" className="size-5" />
                  </span>
                  <h3 className="font-display text-h3 font-bold text-heading">{title}</h3>
                  <p className="col-span-2 text-small text-ink-dim">{body}</p>
                </article>
              ))}
            </Reveal>

            <div className="mt-14 grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-16">
              <Reveal className="lg:col-span-4">
                <h3 className="font-display text-h3 font-bold text-heading">
                  Separation of duties, printed
                </h3>
                <p className="mt-2 text-body text-ink-dim">
                  The cards are about what we cannot do to your data. This is what your own people
                  cannot do to each other’s work, the half an auditor asks about, transcribed from
                  the file the database is seeded from.
                </p>
                <p className="mt-4 text-small text-ink-dim">
                  How each of these is implemented, and what is still open, is in the{' '}
                  <a href="/privacy/" className={link}>
                    privacy policy
                  </a>{' '}
                  and the{' '}
                  <a href="/dpa/" className={link}>
                    data-processing addendum
                  </a>
                  . Both are drafts pending review by counsel, and both say where the code and a
                  standard clause disagree.
                </p>
              </Reveal>
              <Reveal className="min-w-0 lg:col-span-8" delay={STAGGER}>
                <DutyMatrix lang="en" />
              </Reveal>
            </div>
          </div>
        </Section>

        {/* Ledger: what is outside the product by decision. */}
        <Section id="boundaries" rule tone="sunk">
          <div className="shell grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-16">
            <Reveal className="min-w-0 lg:col-span-5">
              <H2>What is deliberately outside it</H2>
              <p className="mt-5 max-w-[56ch] text-lede text-ink-dim">
                The section that makes the rest believable. Five things are outside the product by
                decision, and none of them is coming.
              </p>
            </Reveal>
            <Reveal className="lg:col-span-7" delay={STAGGER}>
              <dl className="divide-y divide-line border-y border-line">
                {EXCLUSIONS.map((item) => (
                  <div key={item.label} className="grid gap-1 py-4 sm:grid-cols-7 sm:gap-6">
                    <dt className="text-body font-semibold text-heading sm:col-span-2">
                      {item.label}
                    </dt>
                    <dd className="text-body text-ink-dim sm:col-span-5">{item.body}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-small text-ink-dim">
                How that scope compares with other systems is on the{' '}
                <a href="/compare/" className={link}>
                  comparison pages
                </a>
                .
              </p>
            </Reveal>
          </div>
        </Section>

        <section className="bg-void py-14 text-on-void lg:py-16">
          <div className="shell flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-display text-h2 font-extrabold">
                The fastest way to judge this is to open it.
              </h2>
              <p className="mt-3 max-w-[62ch] text-body text-on-void-dim">
                The demo is the real software on a seeded dataset, open with no sign-up, with three
                sign-ins so you see what your customer and your agent see as well. Nothing you do in
                it touches anything.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Button asChild size="lg">
                <a href={DEMO_URL}>Open the live demo</a>
              </Button>
              <Button asChild size="lg" variant="onDark">
                <a href="/#demo">Book a demo</a>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <Footer lang="en" mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}
