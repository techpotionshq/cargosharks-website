import { ChargeWaffle, PilotGantt } from '@/content/pages/figures'
import { QuayLine } from '@/content/pages/illustrations'

/**
 * Converted, not written — and now the source.
 *
 * This page was hand-written HTML in `public/compare.html` until the marketing
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
export function CompareContent() {
  return (
    <>
      <section className="hero hero--page">
        <div className="hero__field" aria-hidden="true">
          <div className="hero__grid"></div>
        </div>
        <div className="shell hero__copy">
          <p className="hero__kicker">
            <i></i>How we compare
          </p>
          <h1 className="display">How we are different, and who we are not for.</h1>
          <p className="hero__sub">
            This page compares <em>approaches</em> rather than companies. Every claim on it is about
            us and can be checked against the running build in about ten minutes. That is a
            deliberate choice, and section 03 explains it rather than leaving you to notice.
          </p>
          <p className="hero__ways">
            <a href="/what-we-do/">What we actually do</a>
            <a href="https://demo.cargosharks.com">Check it in the demo</a>
            <a href="/what-we-do/#boundaries">What is deliberately not in it</a>
          </p>
        </div>
      </section>

      {/* 01 — the three shapes ────────────────────────────────────────────────── */}
      <section className="band band--paper compare" id="approaches">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">01 &mdash; The shapes of the choice</p>
            <h2 className="h2">Three ways to run a forwarding operation</h2>
            <p className="lead">
              A forwarder in the Gulf with two to ten branches is usually choosing between three
              shapes, not between a list of products. The shapes have different economics and
              different failure modes, and the product names inside each one matter less than the
              shape does.
            </p>
          </div>

          <div className="prose rise">
            <p>
              <strong>Spreadsheets and mailboxes</strong> is not doing nothing. It is a real system
              that a great many profitable forwarders run on, and it has the enormous advantage of
              costing nothing to change. It fails at scale and at handover: nothing has an owner,
              nothing has a clock, and the knowledge is in people rather than in a record.
            </p>
            <p>
              <strong>A global platform</strong> buys you breadth &mdash; every mode, every
              geography, every adjacent function, and a road that keeps going long after you have
              stopped walking down it. The trade is that a five-branch forwarder uses a fraction of
              it, configures a great deal of it, and pays for the rest.
            </p>
            <p>
              <strong>The whole of one job</strong> is what we built. Narrower on purpose: the
              commercial and operational loop of a forwarding job, complete, including the parts
              that usually fall out of it &mdash; free-time clocks, consolidation cost
              apportionment, per-mode chargeable weight, bilingual documents. Nothing here manages a
              warehouse, and nothing is going to.
            </p>
          </div>

          {/*
            "Complete" is the word in that paragraph doing all the work, and it
            is the one a reader has no way to test. The catalogue is the closest
            thing to a test we can print: twenty-one charge types over six
            rating functions, all of them rows an administrator edits. The
            second and third shapes above both fail at exactly this point — a
            spreadsheet has no catalogue, and a platform has one you configure.
          */}
          <ChargeWaffle lang="en" />

          <div className="tablewrap rise">
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">The question</span>
                  </th>
                  <th scope="col">Spreadsheets and mailboxes</th>
                  <th scope="col">A global platform</th>
                  <th scope="col" className="is-ours">
                    CargoSharks<span className="compare__mark">This is our column</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">How a job gets priced</th>
                  <td>
                    From a spreadsheet somebody maintains, by whoever knows where it is. A day and a
                    half is normal.
                  </td>
                  <td>
                    From rate tables in the platform, once they have been loaded and kept current.
                    Capability is not the constraint; the loading is.
                  </td>
                  <td className="is-ours">
                    From your own cards, by lane, mode and carrier, with validity dates that make
                    two overlapping cards on a lane unrepresentable. Chargeable weight is calculated
                    per mode &mdash; five modes, five different arithmetics.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Where the job actually lives</th>
                  <td>
                    An inbox, a folder, a WhatsApp thread and someone&rsquo;s memory. No two of them
                    agree.
                  </td>
                  <td>
                    In the platform, if every step is entered into it. The gap between the platform
                    and the mailbox is where the work leaks.
                  </td>
                  <td className="is-ours">
                    One record through six states &mdash; enquiry, quote, award, execution,
                    documents, invoice &mdash; and it is never re-keyed into anything else. An
                    enquiry emailed to a branch mailbox is read into a proposal a coordinator
                    accepts or rejects.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Arabic</th>
                  <td>Whatever the person typing writes. Documents are usually English.</td>
                  <td>
                    Available as a localisation, added to a product designed in English. You can
                    tell, and so can your customer.
                  </td>
                  <td className="is-ours">
                    2,727 interface strings in both languages, kept in sync, with right-to-left in
                    the layout rather than applied to it. Documents generate bilingual from the job.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Where your data sits</th>
                  <td>On laptops, in an email provider, and in whatever else grew up around it.</td>
                  <td>
                    In the vendor&rsquo;s multi-tenant estate, in whichever regions the vendor
                    operates.
                  </td>
                  <td className="is-ours">
                    One deployment per customer: your own database, in your own instance, in a
                    region agreed with you. There is no tenant identifier in the schema, because
                    there is no second tenant in the database.
                  </td>
                </tr>
                <tr>
                  <th scope="row">What separation rests on</th>
                  <td>Who has been given the file.</td>
                  <td>Application code enforcing a customer identifier on every query.</td>
                  <td className="is-ours">
                    Row-level security in the database. Ask for another branch&rsquo;s shipment and
                    it comes back <em>not found</em>, because the row is not in the answer at all
                    &mdash; 197 policies across 88 tables, counted against a live database by the
                    test suite rather than estimated.
                  </td>
                </tr>
                <tr>
                  <th scope="row">What a change leaves behind</th>
                  <td>A newer version of the file.</td>
                  <td>Whatever the application chose to log.</td>
                  <td className="is-ours">
                    An audit row written by a database trigger, carrying who, when, the whole row
                    before and after, and the source IP &mdash; so a change made around the
                    application is recorded too. Nothing is deleted; the application&rsquo;s account
                    holds no delete permission on any table.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Getting running</th>
                  <td>Already running. That is the point of it.</td>
                  <td>
                    An implementation project, sized by how many entities and how much history you
                    bring.
                  </td>
                  <td className="is-ours">
                    Fifteen working days for a pilot on your own data, from the day your data
                    arrives rather than from signature. Fixed fee. Nothing built in it is thrown
                    away.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Breadth</th>
                  <td>As broad as your spreadsheets. As deep as the person who wrote them.</td>
                  <td>
                    Broad. Warehouse, transport networks, purchase orders, customs filing in the
                    markets the vendor has built for.
                  </td>
                  <td className="is-ours">
                    Narrow and complete. No warehouse module, no purchase orders, no native apps, no
                    Kuwait customs filing &mdash; each excluded by decision and{' '}
                    <a href="/what-we-do/#boundaries">listed on the home page</a> rather than
                    discovered in week three.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Whose brand your customer sees</th>
                  <td>Yours, on documents you build by hand.</td>
                  <td>Depends on the product and the tier.</td>
                  <td className="is-ours">
                    Yours. No colour, logo or company name is written into the product anywhere
                    &mdash; the operator is a setting, and there is no supplier badge on anything
                    your customer ever sees.
                  </td>
                </tr>
                <tr>
                  <th scope="row">If you leave</th>
                  <td>
                    You keep the files. You lose nothing because nothing was ever consolidated.
                  </td>
                  <td>An export, on the vendor&rsquo;s terms and in the vendor&rsquo;s formats.</td>
                  <td className="is-ours">
                    An export in an open format, any day, at no charge, of a database that was never
                    shared with anyone else&rsquo;s. One honest qualification: a single self-service
                    action producing that export is specified and <strong>not yet built</strong>{' '}
                    &mdash; today it is assembled for you. Source escrow is available on request.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 02 — who it is not for ──────────────────────────────────────────────── */}
      <section className="band band--white" id="notfor">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">02 &mdash; The honest half</p>
            <h2 className="h2">Who this is not for</h2>
            <p className="lead">
              Five situations where a global platform, an incumbent, or a spreadsheet is the better
              answer. Reading this before the demo saves you a fortnight.
            </p>
          </div>

          <ul className="notfor rise">
            <li>
              <span>
                <b>You need a warehouse management system</b>
                <small>
                  Inventory, locations, pick and pack. There is no warehouse module here and there
                  is not going to be one &mdash; that is a product in its own right, not a module
                  you bolt on. If warehousing is half your business, buy something that does it.
                </small>
              </span>
            </li>
            <li>
              <span>
                <b>You need customs declarations filed directly</b>
                <small>
                  In Kuwait, clearance runs through a system that is not an interface a forwarder
                  can buy. We track declarations and estimate duty from a tariff table; we do not
                  file, and we are not planning to. If direct filing is the requirement, this is the
                  wrong product and we would rather tell you now.
                </small>
              </span>
            </li>
            <li>
              <span>
                <b>You need accredited e-invoicing transmission today</b>
                <small>
                  Invoice data carries tax treatment and rate per line, and the hand-off to an
                  accredited provider is built as a plug. No provider is appointed and the mandated
                  document format is not generated. The UAE timetable in our specification is a
                  provider appointment due 30 October 2026 and go-live on 1 January 2027 for the
                  largest filers. If you must transmit before then, we are not ready and will say
                  so.
                </small>
              </span>
            </li>
            <li>
              <span>
                <b>You are one person with fifteen shipments a month</b>
                <small>
                  A spreadsheet and a shared mailbox genuinely work at that size, and the
                  implementation effort would cost you more than the leak does. Come back at three
                  or four coordinators, or when a second branch appears.
                </small>
              </span>
            </li>
            <li>
              <span>
                <b>You buy on certification rather than on inspection</b>
                <small>
                  There is no SOC&nbsp;2 report, no ISO&nbsp;27001 certificate and no independent
                  penetration test. What there is instead is a running system you can open without
                  asking, and a set of claims counted by an automated test suite against a live
                  database. If your procurement process needs an attestation, ours is not a box we
                  can tick.
                </small>
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/*
        A horizon between the honest half and the policy.

        `.divider` is a photograph under a gradient that runs from `--paper` to
        `--navy-900`, so it works in one position only: a light band above and
        the dark band below. That seam is here, and it is also the one place on
        this page where the reader has just finished five reasons not to buy
        from us and could use somewhere for their eye to go.
      */}
      <section className="divider" aria-hidden="true">
        <img src="/pic/photos/containers-stack.webp" alt="" loading="lazy" decoding="async" />
      </section>

      {/* 03 — why no competitor comparison ───────────────────────────────────── */}
      <section className="band band--navy" id="named">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">03 &mdash; What this page will not do</p>
            <h2 className="h2">We do not publish claims about other people&rsquo;s products</h2>
          </div>

          <div className="prose rise">
            <p>
              There is a version of this page that names three or four competitors and prints a
              tick-and-cross grid against them. We are not going to publish one, for three reasons
              that have nothing to do with politeness.
            </p>
            <p>
              <strong>It goes stale silently.</strong> A grid is a snapshot of somebody else&rsquo;s
              roadmap. Every entry in it starts decaying the day it is published, and the thing
              about a decayed competitive claim is that the person it misleads is your prospect and
              the person who looks foolish is you.
            </p>
            <p>
              <strong>We would be marking our own homework.</strong> We know our product properly
              and theirs from the outside. A grid written by one side is not a comparison; it is an
              argument with a table around it.
            </p>
            <p>
              <strong>It would be the wrong argument anyway.</strong> The reason to choose us is not
              that somebody else is worse. It is that we are the whole of one job in this market, in
              this language, on your own database &mdash; and you can check every word of that
              yourself in about ten minutes.
            </p>
            <p>
              So: if you are evaluating us alongside CargoWise, Logistaas or CARGOES&nbsp;Runner
              &mdash; which are the products a Gulf forwarder most often has on the same shortlist
              &mdash; ask us directly. You will get a written answer that cites what each vendor
              publishes itself, and where we do not know, you will get &ldquo;we do not know&rdquo;.
            </p>
          </div>

          <p className="pull rise">
            Every claim on this page is about us, and every one of them is checkable without talking
            to a salesperson.
          </p>
        </div>
      </section>

      {/* 04 — how to check it ────────────────────────────────────────────────── */}
      <section className="band band--paper" id="check">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">04 &mdash; Do not take our word for it</p>
            <h2 className="h2">How to check every claim above, in about ten minutes</h2>
            <p className="lead">Four of them, in the order they are quickest to test.</p>
          </div>

          <div className="grid grid--2">
            <article className="card rise">
              <h3>&ldquo;Separation is enforced by the database&rdquo;</h3>
              <p>
                Open the demo and sign in as the customer contact. Then try to open the operations
                board. You will not get an empty list or an error &mdash; you will get nothing,
                because those rows are not in the answer to your request at all.
              </p>
            </article>
            <article className="card rise">
              <h3>&ldquo;Bilingual, not translated&rdquo;</h3>
              <p>
                Switch the demo to Arabic and issue a document. Look at where the numbers sit, which
                way the layout runs, and whether the labels read as Arabic or as English with Arabic
                words in it. Four seconds is usually enough.
              </p>
            </article>
            <article className="card rise">
              <h3>&ldquo;The whole of one job&rdquo;</h3>
              <p>
                Take a job in the demo from enquiry through to invoice without leaving the record.
                Then read <a href="/what-we-do/#boundaries">the scope columns</a> and see whether
                anything you need is in the middle column, which is the one listing what we have
                decided not to build.
              </p>
            </article>
            <article className="card rise">
              <h3>&ldquo;Free time counts itself&rdquo;</h3>
              <p>
                Find a container past its free days in the demo and look at what appeared on the
                job&rsquo;s cost ledger without anybody entering it. That charge line is the one
                most forwarders are not billing today.
              </p>
            </article>
          </div>

          <div className="sourced rise">
            <p>
              <b>Where the claims on this page come from.</b> The counts &mdash; 88 tables, 197
              policies, 80 audit triggers, 2,727 interface strings &mdash; are asserted by the
              project&rsquo;s own test suite against a live PostgreSQL 18.6 and against the two
              message catalogues. The per-mode chargeable-weight arithmetic is the seeded rule set
              in the pricing engine. The scope statements and the UAE e-invoicing dates are read
              from the specification&rsquo;s build-status table. The export qualification in the
              last row of the table is from the same source, where a complete export as a single
              action is recorded as not implemented.
            </p>
            <p>
              <b>Claims about other companies&rsquo; products on this page: none.</b> The three
              product names in section 03 are named only as products a prospect may be evaluating,
              with no statement made about any of them. The &ldquo;global platform&rdquo; column
              describes the shape of that choice in general and is not a description of any
              particular vendor.
            </p>
          </div>
        </div>
      </section>

      {/* 05 — the pilot, drawn ────────────────────────────────────────────────── */}
      {/*
        The site has offered a fifteen-day pilot in four places and has never
        once shown what the fifteen days are.

        That plan exists — `docs/Qabandi_Pilot_15_Day.md` §4 — it is specific,
        and it is dull in the way a real plan is dull. Printing it is worth more
        than another sentence promising that it exists, and it belongs on this
        page rather than on `/what-we-do/`: a reader comparing three systems is
        deciding what the next three weeks look like, not what the product does.
      */}
      <section className="band band--white" id="pilot">
        <div className="shell">
          <div className="section-head rise">
            <p className="eyebrow">05 &mdash; What the fifteen days are</p>
            <h2 className="h2">A pilot on your own data, with the days written down</h2>
            <p className="lead">
              Fixed fee, fifteen working days, starting the day your data arrives rather than the
              day you sign. This is the plan we work to, block by block, with what each one has to
              produce before the next begins. Nothing built in it is thrown away.
            </p>
          </div>

          <PilotGantt lang="en" />

          <QuayLine />
        </div>
      </section>

      <section className="band tail">
        <div className="shell">
          <div className="rise">
            <h2>Ask us the awkward question.</h2>
            <p>
              The comparison that matters is the one about your own operation, and it usually starts
              with something this page cannot answer. A named person replies, in writing, and says
              &ldquo;we do not know&rdquo; where that is the answer.
            </p>
          </div>
          <div className="tail__actions rise">
            <a className="btn btn--primary" href="https://demo.cargosharks.com">
              Open the live demo<span className="btn__hint">no sign-up</span>
            </a>
            <a className="btn btn--ghost" href="mailto:hello@cargosharks.com">
              hello@cargosharks.com
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
