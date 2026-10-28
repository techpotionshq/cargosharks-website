import type { ComponentType, ReactNode } from 'react'
import { Certificate, Stamp, User, Warehouse } from '@phosphor-icons/react/dist/ssr'
import {
  AskUs,
  ComparePage,
  ComparisonLinks,
  Masthead,
  Tail,
} from '@/components/compare/parts'
import { Reveal } from '@/components/Reveal'
import { Breadcrumbs } from '@/components/StructuredData'
import { Section, SectionHeader } from '@/components/ui/section'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DEMO_URL } from '@/content/copy'
import { ChargeWaffle, OnboardingGantt } from '@/content/pages/figures'
import { STAGGER } from '@/lib/motion'

/**
 * `/compare/`: three ways to run a forwarding operation, who CargoSharks is not
 * for, and the four comparison pages.
 *
 * It was hand-converted HTML on `pages.css` with an eyebrow and a centred
 * block per section. It is on the rebuilt system now (`SolutionPage` is the
 * model), and shorter: the same facts in a split, a table, cards, one dark
 * band and a numbered list, where the order is information.
 *
 * Two things changed in substance. The proof used to quote counts from the
 * test suite (policies, triggers, interface strings) that go stale on the next
 * migration; the mechanisms stay and the numbers went. And §03 used to say we
 * publish no claims about other products while four comparison pages did; it
 * now says what those pages do and do not contain.
 */

export const compareMeta = {
  title: 'Freight forwarding software compared | CargoSharks',
  description:
    'How CargoSharks compares with CargoWise, Logistaas, CARGOES Runner and spreadsheets for Gulf forwarders, and the four cases where it is the wrong choice.',
}

const SHAPES = [
  {
    label: 'Spreadsheets and mailboxes',
    body: 'A real system that many profitable forwarders run on, and it costs nothing to change. It fails at scale and at handover: nothing has an owner, nothing has a clock, and the knowledge is in people rather than in a record.',
  },
  {
    label: 'A global platform',
    body: 'Breadth: every mode, every geography, every adjacent function. The trade is that a five-branch forwarder uses a fraction of it, configures a great deal of it, and pays for the rest.',
  },
  {
    label: 'The whole of one job',
    body: 'What we built. Narrower on purpose: the commercial and operational loop of a forwarding job, complete, including the parts that usually fall out of it: free-time clocks, consolidation cost apportionment, per-mode chargeable weight, bilingual documents. Nothing here manages a warehouse.',
  },
]

/** Spreadsheets, a global platform in general (no vendor), and us. */
const ROWS: { q: string; sheet: string; platform: string; ours: ReactNode }[] = [
  {
    q: 'How a job gets priced',
    sheet: 'From a spreadsheet somebody maintains, by whoever knows where it is. A day and a half is normal.',
    platform:
      'From rate tables in the platform, once they have been loaded and kept current. The loading is the constraint.',
    ours: 'From your own cards, by lane, mode and carrier, with validity dates that make two overlapping cards on a lane impossible. Chargeable weight is calculated per mode: five modes, five arithmetics.',
  },
  {
    q: 'Where the job lives',
    sheet: 'An inbox, a folder, a WhatsApp thread and someone’s memory. No two of them agree.',
    platform:
      'In the platform, if every step is entered into it. The gap between the platform and the mailbox is where the work leaks.',
    ours: 'One record from enquiry, quote and award through execution and documents to invoice, never re-keyed. An enquiry emailed to a branch mailbox is read into a proposal a coordinator accepts or rejects.',
  },
  {
    q: 'Arabic',
    sheet: 'Whatever the person typing writes. Documents are usually English.',
    platform:
      'A localisation added to a product designed in English. You can tell, and so can your customer.',
    ours: 'Every interface string in both languages, kept in step by a check that fails the build, with right-to-left in the layout. Documents generate bilingual from the job.',
  },
  {
    q: 'Where your data sits',
    sheet: 'On laptops, in an email provider, and in whatever else grew up around it.',
    platform: 'In the vendor’s multi-tenant estate, in whichever regions the vendor operates.',
    ours: 'One deployment per customer: your own database, in your own instance, in a region agreed with you. There is no second tenant in the database.',
  },
  {
    q: 'What separation rests on',
    sheet: 'Who has been given the file.',
    platform: 'Application code enforcing a customer identifier on every query.',
    ours: 'Row-level security in the database, on every table. Ask for another branch’s shipment and it comes back not found, because the row is not in the answer at all.',
  },
  {
    q: 'What a change leaves behind',
    sheet: 'A newer version of the file.',
    platform: 'Whatever the application chose to log.',
    ours: 'An audit row written by a database trigger: who, when, the whole row before and after, and the source IP, so a change made around the application is recorded too. The application’s account cannot delete from any table.',
  },
  {
    q: 'Getting running',
    sheet: 'Already running. That is the point of it.',
    platform: 'An implementation project, sized by how many entities and how much history you bring.',
    ours: 'Fifteen working days of paid setup and onboarding on your own data, from the day your data arrives. Fixed fee. Nothing built in it is thrown away.',
  },
  {
    q: 'Breadth',
    sheet: 'As broad as your spreadsheets, as deep as the person who wrote them.',
    platform:
      'Broad: warehouse, transport networks, purchase orders, customs filing in the markets the vendor has built for.',
    ours: (
      <>
        Narrow and complete. No warehouse module, no purchase orders, no native apps, no Kuwait
        customs filing, each excluded by decision and{' '}
        <a href="/what-we-do/" className="text-blue-ink hover:underline">
          listed on What we do
        </a>
        .
      </>
    ),
  },
  {
    q: 'Whose brand your customer sees',
    sheet: 'Yours, on documents you build by hand.',
    platform: 'Depends on the product and the tier.',
    ours: 'Yours. No colour, logo or company name is written into the product; the operator is a setting, and no supplier badge appears on anything your customer sees.',
  },
  {
    q: 'If you leave',
    sheet: 'You keep the files. Nothing was ever consolidated, so nothing is lost.',
    platform: 'An export, on the vendor’s terms and in the vendor’s formats.',
    ours: 'An export in an open format, any day, at no charge. A single self-service export action is specified and not yet built; today we assemble it for you. Source escrow is available on request.',
  },
]

const NOT_FOR: {
  icon: ComponentType<{ className?: string; weight?: 'regular' }>
  title: string
  body: string
}[] = [
  {
    icon: Warehouse,
    title: 'You need a warehouse management system',
    body: 'Inventory, locations, pick and pack. There is no warehouse module and there will not be one; it is a product in its own right. If warehousing is half your business, buy something that does it.',
  },
  {
    icon: Stamp,
    title: 'You need customs declarations filed directly',
    body: 'In Kuwait, clearance runs through a system a forwarder cannot buy an interface to. We track declarations and estimate duty from a tariff table; we do not file, and are not planning to.',
  },
  {
    icon: User,
    title: 'You are one person with fifteen shipments a month',
    body: 'A spreadsheet and a shared mailbox work at that size, and setup would cost more than the leak. Come back at three or four coordinators, or when a second branch appears.',
  },
  {
    icon: Certificate,
    title: 'You buy on certification rather than inspection',
    body: 'There is no SOC 2 report, no ISO 27001 certificate and no independent penetration test. There is a running system you can open without asking, and claims checked by an automated test suite against a live database.',
  },
]

/** In the order they are quickest to test, which is why they are numbered. */
const CHECKS: { claim: string; how: ReactNode }[] = [
  {
    claim: 'Separation is enforced by the database',
    how: 'Sign in to the demo as the customer contact and try to open the operations board. You get nothing: no empty list and no error, because those rows are not in the answer at all.',
  },
  {
    claim: 'Bilingual from the start',
    how: 'Switch the demo to Arabic and issue a document. Look at where the numbers sit, which way the layout runs, and whether the labels read as Arabic. A few seconds is usually enough.',
  },
  {
    claim: 'The whole of one job',
    how: (
      <>
        Take a job in the demo from enquiry to invoice without leaving the record. Then read{' '}
        <a href="/what-we-do/" className="text-blue-ink hover:underline">
          the scope on What we do
        </a>{' '}
        and see whether anything you need is on the list of what we decided not to build.
      </>
    ),
  },
  {
    claim: 'Free time counts itself',
    how: 'Find a container past its free days and look at what appeared on the job’s cost ledger without anybody entering it. That charge line is the one most forwarders are not billing today.',
  },
]

export function CompareContent() {
  return (
    <ComparePage>
      <Breadcrumbs trail={[{ name: 'Compare', path: '/compare/' }]} />

      <Masthead
        title="Freight forwarding software compared, and who CargoSharks is not for"
        lede="Three ways to run a forwarding operation, what each costs, and the cases where we are the wrong choice. Every claim about us can be checked in the running demo in about ten minutes."
        aside={
          <div>
            <p className="mb-3 text-small text-on-void-faint">One page for each</p>
            <ComparisonLinks dark />
          </div>
        }
      />

      {/* The three shapes, then the catalogue that makes "complete" testable:
          the charge types an administrator edits. Full width, because the
          waffle's labels need the room. */}
      <Section>
        <div className="shell flex flex-col gap-10">
          <Reveal>
            <SectionHeader
              title="Three ways to run a forwarding operation"
              lede="A Gulf forwarder with two to ten branches is usually choosing between three shapes rather than between products. They have different economics and fail in different ways."
            />
          </Reveal>
          <Reveal className="grid grid-cols-1 gap-6 md:grid-cols-3" delay={STAGGER}>
            {SHAPES.map((shape) => (
              <div key={shape.label} className="border-s-2 border-blue/40 ps-4">
                <h3 className="text-body font-semibold text-heading">{shape.label}</h3>
                <p className="mt-1 text-small text-ink-dim">{shape.body}</p>
              </div>
            ))}
          </Reveal>
          <ChargeWaffle lang="en" />
        </div>
      </Section>

      <Section rule tone="sunk">
        <div className="shell flex flex-col gap-10">
          <Reveal>
            <SectionHeader
              title="The three side by side"
              lede="The middle column describes that kind of choice in general, not any particular vendor."
            />
          </Reveal>
          <div className="min-w-0 rounded-lg border border-line bg-paper-lift">
            <Table className="min-w-[52rem] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="w-[16%]">
                    <span className="sr-only">The question</span>
                  </TableHead>
                  <TableHead scope="col" className="w-[26%]">
                    Spreadsheets and mailboxes
                  </TableHead>
                  <TableHead scope="col" className="w-[26%]">
                    A global platform
                  </TableHead>
                  <TableHead scope="col" className="w-[32%] bg-blue/6 font-semibold text-blue-ink">
                    CargoSharks
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROWS.map((row) => (
                  <TableRow key={row.q}>
                    <TableHead
                      scope="row"
                      className="h-auto py-3 align-top text-small font-semibold whitespace-normal text-ink"
                    >
                      {row.q}
                    </TableHead>
                    <TableCell className="text-ink-dim">{row.sheet}</TableCell>
                    <TableCell className="text-ink-dim">{row.platform}</TableCell>
                    <TableCell className="bg-blue/6 text-ink">{row.ours}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Section>

      <Section rule>
        <div className="shell flex flex-col gap-10">
          <Reveal>
            <SectionHeader
              title="Who CargoSharks is not for"
              lede="Four situations where a global platform, an incumbent or a spreadsheet is the better answer. Reading them before the demo saves you a fortnight."
            />
          </Reveal>
          <Reveal className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" delay={STAGGER}>
            {NOT_FOR.map(({ icon: Icon, title, body }) => (
              <article
                key={title}
                className="flex flex-col gap-3 rounded-lg border border-line bg-paper-lift p-5"
              >
                <span className="flex size-10 items-center justify-center rounded-md bg-blue/8 text-blue-ink">
                  <Icon weight="regular" className="size-5" />
                </span>
                <h3 className="font-display text-h3 font-bold text-heading">{title}</h3>
                <p className="text-small text-ink-dim">{body}</p>
              </article>
            ))}
          </Reveal>
        </div>
      </Section>

      {/* The register changes here: from what we are to what we say about
          other people, so this is the dark band. */}
      <section className="relative isolate overflow-hidden bg-void py-16 text-on-void md:py-20">
        <img
          src="/pic/photos/containers-stack.webp"
          alt=""
          width={1600}
          height={1067}
          loading="lazy"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-void/88" />
        <div className="shell grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-16">
          <Reveal className="lg:col-span-5">
            <h2 className="max-w-[20ch] text-balance font-display text-h2 font-extrabold text-on-void">
              What we say about other vendors
            </h2>
          </Reveal>
          <Reveal className="flex flex-col gap-4 lg:col-span-7" delay={STAGGER}>
            <p className="max-w-[62ch] text-lede text-on-void-dim">
              CargoWise, Logistaas and CARGOES Runner are the products a Gulf forwarder most often
              has on the same shortlist. Each comparison page quotes what that vendor says about
              itself, with the page and the date it was read, and says where that vendor is the
              better choice before it says anything about us.
            </p>
            <p className="max-w-[62ch] text-body text-on-void-dim">
              None of them prints a tick-and-cross grid. A grid is a snapshot of somebody else’s
              roadmap that goes stale silently, and written by one side it is an argument with a
              table around it. Ask us directly at{' '}
              <AskUs className="text-blue-lit" /> and you get a written answer that cites what
              each vendor publishes, and “we do not know” where we do not.
            </p>
          </Reveal>
        </div>
      </section>

      <Section tone="lift">
        <div className="shell grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h2 className="text-balance font-display text-h2 font-extrabold text-heading">
              Check it yourself in about ten minutes
            </h2>
            <p className="mt-4 max-w-[44ch] text-body text-ink-dim">
              Four claims, in the order they are quickest to test, in{' '}
              <a href={DEMO_URL} className="text-blue-ink hover:underline">
                the live demo
              </a>
              . No sign-up.
            </p>
            <p className="mt-6 max-w-[44ch] text-small text-ink-dim">
              <span className="font-semibold text-ink">Where these claims come from.</span> The
              separation, audit and language-parity claims are asserted by the product’s automated
              test suite against a live PostgreSQL database and both message catalogues. The per-mode
              chargeable-weight arithmetic is the seeded rule set in the pricing engine. The scope
              statements and the export qualification come from the specification’s build-status
              table. No claim on this page is about another company’s product.
            </p>
          </div>
          <ol className="divide-y divide-line border-y border-line lg:col-span-7">
            {CHECKS.map((check, index) => (
              <li key={check.claim} className="grid grid-cols-[2.25rem_1fr] gap-x-3 py-4">
                <span className="figures pt-0.5 font-mono text-small text-blue-ink">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-body font-semibold text-heading">{check.claim}</h3>
                  <p className="mt-1 text-small text-ink-dim">{check.how}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* The site promised fifteen days of setup and never showed what they
          are. The plan exists, it is specific, and printing it is worth more
          than another sentence promising it. */}
      <Section rule>
        <div className="shell flex flex-col gap-10">
          <Reveal>
            <SectionHeader
              title="Onboarding on your own data, with the days written down"
              lede="Paid setup and onboarding at a fixed fee: fifteen working days, starting the day your data arrives rather than the day you sign. Each block has to produce its output before the next begins, and nothing built in it is thrown away."
            />
          </Reveal>
          <OnboardingGantt lang="en" />
        </div>
      </Section>

      <Tail
        heading="Ask us the awkward question."
        body={
          <>
            The comparison that matters is the one about your own operation. Write to <AskUs className="text-blue-lit" />: a
            named person replies in writing, and says “we do not know” where that is the answer.
          </>
        }
      />
    </ComparePage>
  )
}
