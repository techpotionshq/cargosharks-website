import {
  AccrualStair,
  ChargeableColumns,
  DutyMatrix,
  MilestoneStrips,
  MinorUnits,
  ScopeSpan,
} from '@/content/pages/figures'
import { LayeredRecord, OwnDatabase } from '@/content/pages/illustrations'

/**
 * Converted, not written — and now the source.
 *
 * This page was hand-written HTML in `public/what-we-do.html` until the marketing
 * site became a Next app. The conversion was mechanical, by a script, and
 * deliberately so: between them these documents carry fifty-three
 * `[TO CONFIRM]` markers, a clause-numbering scheme people quote back in
 * emails, and a great deal of prose that says exactly what the software does
 * and no more. Retyping that into JSX by hand is the most expensive way to
 * introduce an error in this repository — a dropped `not` in a clause is
 * invisible in review and consequential in a way a layout bug never is.
 *
 * The HTML original is gone and this file is what there is. **Edit it here.**
 * It reads oddly for a React component — `className` on plain markup, no props,
 * no composition — because it is a document rather than a component, and
 * breaking it into components would be the retyping the conversion avoided.
 *
 * Its styling is `src/app/pages.css`, scoped under `.doc-page`, which
 * `src/components/DocPage.tsx` puts on the `<main>` around it.
 */
export function WhatWeDoContent() {
  return (
    <>
      {/* masthead ─────────────────────────────────────────────────────────────── */}
      <section className="hero hero--page">
        <div className="hero__field" aria-hidden="true"><div className="hero__grid"></div></div>
        <div className="shell hero__copy">
          <p className="hero__kicker"><i></i>The product, from the beginning</p>
          <h1 className="display">The whole of one forwarding job, in one record.</h1>
          <p className="hero__sub">CargoSharks is the commercial and operational software a freight forwarder runs its day on: an enquiry arrives, it is priced from your own contracts, it is quoted, awarded, executed, documented and invoiced &mdash; and at no point is any of it typed into a second system. It is built in Arabic and English at the same time, and it runs on a database that belongs to you.</p>
          <p className="hero__ways">
            <a href="https://demo.cargosharks.com">Open the live demo</a>
            <a href="/#demo">Book the 15-day pilot</a>
            <a href="/compare/">How we are different</a>
            <a href="/">The home page</a>
          </p>
        </div>
      </section>

      {/* 01 — the problem ─────────────────────────────────────────────────────── */}
      <section className="band band--paper" id="problem">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">01 &mdash; Why anyone changes</p>
            <h2 className="h2">The problem is not your people</h2>
          </div>
          <div className="prose rise">
            <p>Your rates are in spreadsheets, so a quotation takes a day and a half. Your enquiries are in four mailboxes, so nobody owns them and nobody is timed. Your customers find out where their container is by ringing someone who has to go and find out. And your margin on a job is a number you reconstruct at month-end rather than one you knew when you quoted.</p>
            <p><strong>Every one of those is a system-of-record problem.</strong> None of them is a training problem, and none of them is fixed by a better spreadsheet. They persist because the job does not live anywhere &mdash; it lives in an inbox, a folder, a WhatsApp thread and somebody&rsquo;s memory, and no two of those agree.</p>
            <p>It costs you the jobs you priced too slowly, and the ones you priced too cheaply.</p>
          </div>
        </div>
      </section>

      {/* 02 — the loop ────────────────────────────────────────────────────────── */}
      <section className="band band--white" id="loop">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">02 &mdash; What replaces it</p>
            <h2 className="h2">One record. Six states. No exits.</h2>
            <p className="lead">A job enters as an enquiry and leaves as a paid invoice without ever being re-keyed into something else. Each state hands the next one everything it needs, which is the entire point: nothing is retyped, so nothing can be retyped differently.</p>
          </div>

          <div className="rail rise">
            <div className="stage"><div className="stage__dot">01</div><h3>Enquiry</h3><p>One queue across every branch, one owner, one response clock.</p></div>
            <div className="stage"><div className="stage__dot">02</div><h3>Quote</h3><p>Priced from your own card where one covers the lane; sent to agents where it doesn&rsquo;t.</p></div>
            <div className="stage"><div className="stage__dot">03</div><h3>Award</h3><p>Acceptance converts the quote. Buy, sell and margin lock to the record.</p></div>
            <div className="stage"><div className="stage__dot">04</div><h3>Execution</h3><p>Milestones, customs stage, containers, free-time clocks, exceptions.</p></div>
            <div className="stage"><div className="stage__dot">05</div><h3>Documents</h3><p>Typed, versioned, attached &mdash; released to the customer where permitted.</p></div>
            <div className="stage"><div className="stage__dot">06</div><h3>Invoice</h3><p>Raised from the job&rsquo;s own cost ledger, in the right entity, currency and language.</p></div>
          </div>

          {/*
            The fourth state, drawn at the six lengths it actually has.

            The rail above is one row of six states because that part is the
            same for every shipment. Execution is not: a sea import is nine
            milestones and a land import is five, and a page that says "job
            file with milestones" and stops has said nothing a reader can
            check. These are the seeded templates, at their real lengths.
          */}
          <MilestoneStrips lang="en" />

          <div className="prose rise" style={{ marginTop: 'clamp(44px,5vw,68px)' }}>
            <p>Two consequences follow from that shape, and they are the two things a forwarder notices first.</p>
            <p><strong>What you sold is what you costed.</strong> Accepting a quotation opens the job file with the buying and selling rates already attached to it, so the margin on the job is a live figure rather than one reconstructed at month-end from three sources that disagree.</p>
            <p><strong>Revisions supersede rather than overwrite.</strong> What the customer actually accepted stays recoverable, whatever has happened to the quotation since. That is a property of the database rather than a habit of the people using it &mdash; see <a href="/what-we-do/#parts">what holds when people are careless</a>.</p>
          </div>

          {/* The paragraph above is the hardest one on this page to feel, because
              "supersedes rather than overwrites" is a schema decision and reads
              as a phrase. Drawn, it is three sheets and a trail. */}
          <LayeredRecord lang="en" />
        </div>
      </section>

      {/* 03 — the modes ───────────────────────────────────────────────────────── */}
      <section className="band band--navy" id="modes">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">03 &mdash; Modes</p>
            <h2 className="h2">Five modes, each calculated its own way</h2>
            <p className="lead">Freight is not billed on what a shipment weighs. It is billed on the greater of weight and volume, converted by a divisor that differs per mode, rounded up to that mode&rsquo;s increment, then floored at that mode&rsquo;s minimum. Approximating one mode with another&rsquo;s arithmetic is where a rate quietly stops matching the invoice.</p>
          </div>

          {/*
            Every figure in this table is a seed row in `packages/core/src/chargeable.ts`,
            not a number written for a website. They are configuration (FR-AD-03): an
            airline that moves from a 6000 divisor to a 5000 one is an administrator's
            edit, not a release.
          */}
          <div className="modes rise">
            <div className="modes__row">
              <div className="modes__name"><i>01</i>Sea FCL</div>
              <div className="modes__unit">per container</div>
              <p className="modes__note">Volume never enters the calculation. Rated by container type and count, with demurrage, detention and storage clocks running per container against the carrier&rsquo;s free days.</p>
            </div>
            <div className="modes__row">
              <div className="modes__name"><i>02</i>Sea LCL</div>
              <div className="modes__unit">revenue ton</div>
              <p className="modes__note">Weight or measure: whichever is greater of cubic metres and metric tonnes. A 1,000&nbsp;cm&sup3;/kg divisor &mdash; one cbm to one tonne &mdash; with a 1,000&nbsp;kg minimum.</p>
            </div>
            <div className="modes__row">
              <div className="modes__name"><i>03</i>Air</div>
              <div className="modes__unit">chargeable kg</div>
              <p className="modes__note">The IATA 6,000&nbsp;cm&sup3;/kg divisor, which is 166.67&nbsp;kg to the cubic metre. Rounded up to the next half kilo, floored at 45&nbsp;kg. Weight breaks apply as your carrier states them.</p>
            </div>
            <div className="modes__row">
              <div className="modes__name"><i>04</i>Land</div>
              <div className="modes__unit">chargeable kg</div>
              <p className="modes__note">A 3,000&nbsp;cm&sup3;/kg divisor, rounded up to the whole kilo, no minimum.</p>
            </div>
            <div className="modes__row">
              <div className="modes__name"><i>05</i>Courier</div>
              <div className="modes__unit">chargeable kg</div>
              <p className="modes__note">A 5,000&nbsp;cm&sup3;/kg divisor, rounded up to the next half kilo, floored at half a kilo.</p>
            </div>
          </div>

          {/* The table above states the rules; this runs them. One pallet
              through all five, so the six-fold spread between air and sea LCL
              is a thing the reader sees rather than a thing we assert. */}
          <ChargeableColumns lang="en" />

          <p className="small muted rise" style={{ marginTop: 'clamp(28px,3vw,40px)', maxWidth: '72ch' }}>
            Milestone sets and free-time rules are per mode in the same way. A sea import and an air import do not share a checklist here because they do not share one in the yard.
          </p>
        </div>
      </section>

      {/* 04–06 — what each part does ──────────────────────────────────────────── */}
      <section className="band band--white" id="parts">
        <div className="shell splits-wide">
          <div className="section-head rise">
            <p className="eyebrow">04 &mdash; The three halves of the day</p>
            <h2 className="h2">What each part of it actually does</h2>
            <p className="lead">Commercial, operations, finance. The screens below are captures of the running build, not renderings of one &mdash; the same screens you can open yourself in the demo.</p>
          </div>

          <div className="splits">
            <div className="split rise">
              <div className="split__copy">
                <p className="eyebrow">Commercial</p>
                <h3 className="h2">From enquiry to quotation, in one place</h3>
                <p className="lead">Every enquiry, wherever it came from, with an owner and a clock &mdash; and a price that comes from your own contracts.</p>
                <ul className="feature-list">
                  <li><b>The queue.</b> Enquiries from the web form, from email and from the phone, in one list across every branch. Each has an owner, a status and a response deadline, so how long you are actually taking is measured rather than estimated.</li>
                  <li><b>The inbox.</b> An enquiry emailed to a branch mailbox is read into a proposal &mdash; parties, lane, cargo, what was asked for &mdash; which a coordinator accepts or rejects. Nothing becomes an enquiry without a person saying so, and what was proposed is kept beside what was decided.</li>
                  <li><b>The pricing.</b> Buy and sell rate cards by lane, mode and carrier, with validity dates that make two overlapping cards on a lane unrepresentable rather than merely unlikely.</li>
                  <li><b>The margin.</b> Buy, sell and margin side by side on every option, before the quotation goes out.</li>
                  <li><b>The lanes you are quoting blind.</b> The rate-card screen names which lanes have no live buying rate on file and which cards expire inside thirty days. A lane with no buying rate is a lane you are pricing from memory.</li>
                </ul>
              </div>
              <div className="shot">
                <div className="frame">
                  <img src="/pic/screens/enquiries.webp" alt="The enquiry queue: every enquiry with an owner, a status and a response deadline" loading="lazy" decoding="async" />
                </div>
              </div>
            </div>

            <div className="split split--flip rise">
              <div className="split__copy">
                <p className="eyebrow">Operations</p>
                <h3 className="h2">The board tells you what is wrong before the customer does</h3>
                <p className="lead">Live shipments ordered by exception, oldest first &mdash; on the principle that the one nobody has looked at is the one the process missed.</p>
                <ul className="feature-list">
                  <li><b>The job file.</b> Milestones by mode and direction, kept as planned, revised and actual &mdash; all three, because the difference between them is the conversation.</li>
                  <li><b>Customs.</b> Declarations ordered by the window that closes first: type, number, status, duty, broker and clearance deadline, with a duty estimate from the tariff table before the declaration goes in. Holds and inspections sit on the board rather than in a file.</li>
                  <li><b>Free time.</b> Demurrage, detention and storage clocks per container against the carrier&rsquo;s free days. When free time runs out the clock writes its own charge line, against the right counterparty, at the right per-diem rate.</li>
                  <li><b>Consolidation.</b> A master with its houses under it, the manifest generated from them, and the master&rsquo;s costs apportioned across the houses so each house&rsquo;s margin is real.</li>
                  <li><b>Ask it.</b> An assistant that answers questions over your own data &mdash; whose free time runs out this week, which invoices are overdue, where a supplier billed more than the job accrued. It sees exactly what the person asking is allowed to see, and nothing else.</li>
                </ul>
              </div>
              <div className="shot">
                <div className="frame">
                  <img src="/pic/screens/jobs.webp" alt="The operations board: live shipments ordered by exception, oldest first" loading="lazy" decoding="async" />
                </div>
              </div>
            </div>

            <div className="split rise">
              <div className="split__copy">
                <p className="eyebrow">Finance and documents</p>
                <h3 className="h2">What you are owed, how late it is, and who to ring</h3>
                <p className="lead">Job costing, invoicing and receivables across entities and currencies &mdash; and every document the job issues, versioned.</p>
                <ul className="feature-list">
                  <li><b>Currency, handled properly.</b> Money is decimal throughout and rounds per currency at the line, because the Kuwaiti dinar carries three decimal places and a system that rounds everything to two corrupts every Kuwaiti amount it touches. Each charge line stores its own rate and the moment it was taken.</li>
                  <li><b>Separated duties.</b> Draft, approved, issued, part-paid, paid, credited &mdash; and only Finance may issue, void or credit. An operations manager who can issue invoices is the segregation-of-duties failure an auditor asks about first.</li>
                  <li><b>Supplier bills.</b> A scan, or a bill emailed in by a partner you already know, is read into lines and matched against what the job accrued. The variance is on screen before anyone approves it &mdash; which is where the argument with the agent belongs, not after the customer has been invoiced.</li>
                  <li><b>Documents.</b> House bill of lading or air waybill, delivery order, packing list, customs pack, consolidation manifest. Bilingual, numbered from the issuing branch&rsquo;s own series, released per document &mdash; released ones appear to the customer, drafts do not.</li>
                </ul>
              </div>
              <div className="shot">
                <div className="frame">
                  <img src="/pic/screens/finance.webp" alt="Receivables grouped by how late they are, largest exposure first" loading="lazy" decoding="async" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 05 — the two that fall out ───────────────────────────────────────────── */}
      {/*
        A section that is two figures and four sentences, which is unusual for
        this page and is the point of it.

        Both of these are things every system in the category claims and few of
        them do, and both are impossible to argue in prose without sounding like
        every other vendor arguing the same thing. Drawn, they are checkable in
        about a minute each: count the steps on the stair, count the decimal
        places on an invoice in the demo.
      */}
      <section className="band band--paper" id="mechanisms">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">05 &mdash; The two that fall out</p>
            <h2 className="h2">The clock nobody starts, and the decimal nobody keeps</h2>
            <p className="lead">Everything in this category quotes, books and invoices. These two are what quietly does not survive the trip from a demo to a Kuwaiti operation &mdash; the first because it needs a scheduled job rather than a screen to look at, the second because it needs a currency the product was not designed around.</p>
          </div>

          <AccrualStair lang="en" />
          <MinorUnits lang="en" />
        </div>
      </section>

      {/*
        A horizon, between the last paper band and the first navy one.

        `.divider` has been in this stylesheet since the site was nine HTML
        files and has had nothing using it since the conversion. It is a
        photograph with a gradient over it that starts at `--paper` and ends at
        `--navy-900`, which means it only works in one position: paper above,
        navy below. Here, that is exactly the seam.
      */}
      <section className="divider" aria-hidden="true">
        <img src="/pic/photos/containers-aerial.webp" alt="" loading="lazy" decoding="async" />
      </section>

      {/* 06 — bilingual ───────────────────────────────────────────────────────── */}
      <section className="band band--navy" id="bilingual">
        <div className="shell">
          <div className="section-head rise" style={{ paddingInline: 'clamp(6px,2.4vw,42px)' }}>
            <p className="eyebrow">06 &mdash; Language</p>
            <h2 className="h2">Bilingual, not translated</h2>
            <p className="lead">2,727 interface strings in Arabic and English, kept in sync, with right-to-left in the layout rather than bolted onto it. The quotation your customer opens in Arabic reads the way an Arabic document should, because it was built that way rather than mirrored.</p>
          </div>

          <div className="pair rise">
            <figure className="pair__en">
              <div className="frame">
                <img src="/pic/screens/english.webp" alt="The dashboard in English: four figures, the map, and the assistant, laid out left to right" loading="lazy" decoding="async" />
              </div>
              <figcaption>English &mdash; left to right</figcaption>
            </figure>
            <figure className="pair__ar">
              <div className="frame">
                <img src="/pic/screens/arabic.webp" alt="The same dashboard in Arabic: the same four figures and the same map, laid out right to left" loading="lazy" decoding="async" />
              </div>
              <figcaption className="pair--rtl">العربية &mdash; من اليمين إلى اليسار</figcaption>
            </figure>
          </div>

          <p className="pull rise" style={{ marginInlineStart: 'clamp(6px,2.4vw,42px)' }}>Every product in this market was built in English and had Arabic added afterwards. You can tell within about four seconds, and so can your customer.</p>
        </div>
      </section>

      {/* 07 — ownership ───────────────────────────────────────────────────────── */}
      <section className="band band--paper" id="ownership">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">07 &mdash; Ownership and enforcement</p>
            <h2 className="h2">Your database, your brand, your data</h2>
            <p className="lead">One deployment per customer &mdash; your own database in your own instance, not a shared table with a customer column in it. Inside that deployment, branch separation is enforced by the database rather than by application code that can forget one query: ask for another branch&rsquo;s shipment and it comes back <em>not found</em>, because the row is never in the answer.</p>
          </div>

          {/* The sentence above contains the words "not a shared table with a
              customer column in it", which is precise, correct, and means
              nothing to a reader who has never had to write the query that
              remembers the column. Both shapes, side by side. */}
          <OwnDatabase lang="en" />

          <div className="grid grid--3">
            <article className="card rise">
              <h3>The audit trail writes itself</h3>
              <p>Eighty database triggers, so a change that goes around the application is still recorded. Editing the audit is revoked from every account in the system &mdash; your administrator&rsquo;s and ours alike.</p>
            </article>
            <article className="card rise">
              <h3>Nothing is ever deleted</h3>
              <p>Records are superseded, closed or deactivated. The permission to delete does not exist on the account the application runs as.</p>
            </article>
            <article className="card rise">
              <h3>The region is yours to pick</h3>
              <p>Kuwait, the UAE, Saudi Arabia or the EU, chosen by you and written into the contract rather than into a support ticket.</p>
            </article>
            <article className="card rise">
              <h3>Your brand. Nowhere ours.</h3>
              <p>No colour, logo or company name is written into the product anywhere. The operator is a setting, so your customer never sees a supplier badge on anything.</p>
            </article>
            <article className="card rise">
              <h3>Support cannot look without a grant</h3>
              <p>Access is granted by your administrator, scoped to named branches, against a ticket reference, and it expires on its own. A banner shows while it is open, and one click revokes it.</p>
            </article>
            <article className="card rise">
              <h3>Verified, not asserted</h3>
              <p>88 tables, 197 policies, 80 audit triggers &mdash; counted against a live PostgreSQL 18.6, not estimated from a design document.</p>
            </article>
          </div>

          {/*
            Separation of duties, printed rather than promised.

            The six cards above are about what we cannot do to your data. This is
            about what your own people cannot do to each other's work, which is
            the half an auditor actually asks about — and it is a table we can
            publish because it is transcribed from the file the database is
            seeded from rather than written from memory.
          */}
          <DutyMatrix lang="en" />

          <p className="small muted rise" style={{ marginTop: 'clamp(30px,3.4vw,44px)', maxWidth: '74ch' }}>
            How each of those is implemented, and what is still open, is written out in the <a href="/privacy/">privacy policy</a> and the <a href="/dpa/">data-processing addendum</a> &mdash; both drafts, both pending review by counsel, and both honest about where the code and a standard clause disagree.
          </p>
        </div>
      </section>

      {/* 08 — boundaries ──────────────────────────────────────────────────────── */}
      <section className="band band--white" id="boundaries">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">08 &mdash; The boundary</p>
            <h2 className="h2">The whole of one job. Not a piece of everything.</h2>
            <p className="lead">This is the section the instinct says to bury, and it is the one that makes the rest of the page believable. Five things are outside the product by decision rather than by accident, and none of them is coming.</p>
          </div>

          {/* Scope and exclusions at the same weight, which is the whole honesty
              of the drawing: a diagram showing only what is included is a logo
              wall with rectangles. */}
          <ScopeSpan lang="en" />

          {/*
            Deliberately the *stable* half of the home page's section 07. The roadmap
            column there carries dates that move with SRS §11, and duplicating a list
            that goes stale silently would put two copies of it on the site. The
            exclusions below have not changed and are not expected to; the dated
            roadmap stays in one place and is linked to.
          */}
          <ul className="notfor rise">
            <li><span>
              <b>Warehouse management</b>
              <small>Inventory, locations, pick and pack. That is a product in its own right, not a module you bolt onto a forwarding platform.</small>
            </span></li>
            <li><span>
              <b>Purchase orders and vendor management</b>
              <small>It sits on top of a working job platform, not beside one. Until the job platform is working, it has nothing to sit on.</small>
            </span></li>
            <li><span>
              <b>Native mobile applications</b>
              <small>Proof of delivery already works from a phone browser &mdash; signature, photographs, recipient and location. An app to do the same thing is a second thing to keep in step.</small>
            </span></li>
            <li><span>
              <b>Direct customs filing in Kuwait</b>
              <small>Clearance runs through MicroClear, which is not an API a forwarder can buy. We track declarations and estimate duty; we do not file them, and we are not planning to.</small>
            </span></li>
            <li><span>
              <b>Master carrier documents</b>
              <small>A master bill is the carrier&rsquo;s document, issued on the carrier&rsquo;s stock. House documents are ours, and those we generate.</small>
            </span></li>
          </ul>

          <p className="small muted rise" style={{ marginTop: 'clamp(28px,3vw,40px)', maxWidth: '74ch' }}>
            What <em>is</em> in the product today, and what is on the roadmap with dates against it &mdash; UAE e-invoicing, Saudi ZATCA, the agent portal, WhatsApp, scheduled reports, live carrier tracking &mdash; is kept in one place rather than two: <a href="#boundaries">the boundary section above</a>, which is read straight off the specification&rsquo;s own build-status table.
          </p>
        </div>
      </section>

      {/* tail ─────────────────────────────────────────────────────────────────── */}
      <section className="band tail">
        <div className="shell">
          <div className="rise">
            <h2>The fastest way to judge this is to open it.</h2>
            <p>The demo is the build, running on a seeded dataset, with three sign-ins so you can see what your customer and your agent see as well as what you see. Nothing you do in it touches anything.</p>
          </div>
          <div className="tail__actions rise">
            <a className="btn btn--primary" href="https://demo.cargosharks.com">Open the live demo<span className="btn__hint">no sign-up</span></a>
            <a className="btn btn--ghost" href="/#demo">Book the 15-day pilot</a>
          </div>
        </div>
      </section>
    </>
  )
}
