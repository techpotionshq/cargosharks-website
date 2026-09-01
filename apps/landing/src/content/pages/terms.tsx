/**
 * Converted, not written — and now the source.
 *
 * This page was hand-written HTML in `public/terms.html` until the marketing
 * site became a Next app. The conversion was mechanical, by a script, and
 * deliberately so: between them these documents carry a clause-numbering
 * scheme people quote back in emails and a great deal of prose that says
 * exactly what the software does and no more. Retyping that into JSX by hand is the most expensive way to
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
export function TermsContent() {
  return (
    <>
      <section className="hero hero--page">
        <div className="hero__field" aria-hidden="true">
          <div className="hero__grid"></div>
        </div>
        <div className="shell hero__copy">
          <h1 className="display">Terms of service</h1>
          <p className="hero__sub">
            What CargoSharks supplies, what each side owes the other, what the software does and
            does not do, and where the limits sit. Written from the build, so the description of the
            product is accurate; the commercial particulars are settled in your agreement.
          </p>
          <p className="hero__ways">
            <a href="/privacy/">Privacy policy</a>
            <a href="/dpa/">Data-processing addendum</a>
            <a href="/what-we-do/#boundaries">What is and isn&rsquo;t in the product</a>
          </p>
        </div>
      </section>

      <div className="draft">
        <div className="shell">
          <span className="draft__tag">Draft</span>
          <p>
            <b>These terms are a draft, under review by counsel, and not yet in force.</b> They
            describe how CargoSharks is supplied and what each side is responsible for. The product
            description is grounded in the codebase rather than in a template.{' '}
            <b>The signed agreement and its order form govern.</b> Where those and this page differ,
            they prevail, and the commercial particulars &mdash; fees, term, service levels,
            liability and governing law &mdash; are settled there rather than here.
          </p>
        </div>
      </div>

      <section className="band band--paper">
        <div className="shell">
          <div className="doc">
            <nav className="doc__toc" aria-label="Contents">
              <h2>Contents</h2>
              <ol>
                <li>
                  <a href="#t-what">What this document is</a>
                </li>
                <li>
                  <a href="#t-who">Who you are contracting with</a>
                </li>
                <li>
                  <a href="#t-supply">What is supplied</a>
                </li>
                <li>
                  <a href="#t-pilot">The pilot</a>
                </li>
                <li>
                  <a href="#t-yours">Your data is yours</a>
                </li>
                <li>
                  <a href="#t-use">How you may use it</a>
                </li>
                <li>
                  <a href="#t-accounts">Accounts, branches and permissions</a>
                </li>
                <li>
                  <a href="#t-availability">Availability and support</a>
                </li>
                <li>
                  <a href="#t-access">Our access to your deployment</a>
                </li>
                <li>
                  <a href="#t-third">Services you provision yourself</a>
                </li>
                <li>
                  <a href="#t-notdo">What the product does not do</a>
                </li>
                <li>
                  <a href="#t-fees">Fees</a>
                </li>
                <li>
                  <a href="#t-conf">Confidentiality</a>
                </li>
                <li>
                  <a href="#t-ip">Intellectual property and escrow</a>
                </li>
                <li>
                  <a href="#t-warranty">Warranties, and their limits</a>
                </li>
                <li>
                  <a href="#t-liability">Liability</a>
                </li>
                <li>
                  <a href="#t-term">Term, termination and exit</a>
                </li>
                <li>
                  <a href="#t-changes">Changes to these terms</a>
                </li>
                <li>
                  <a href="#t-law">Governing law</a>
                </li>
                <li>
                  <a href="#t-contact">Contact</a>
                </li>
              </ol>
            </nav>

            <div className="doc__body">
              <div className="draft-card">
                <h2>What this is, and what it is not</h2>
                <p>
                  Written from the CargoSharks codebase. Sections 03, 05, 09, 10 and 11 describe the
                  software and are accurate as of 25 August 2026 &mdash; they were written by
                  reading the migrations, the adapters and the specification&rsquo;s build-status
                  table, not by describing an intention.
                </p>
                <p>
                  The commercial particulars live in your agreement and its order form, not here. In
                  particular <b>no price appears anywhere in this document</b>, and none should be
                  inferred from it.
                </p>
                <p>
                  No certification is claimed. CargoSharks holds no SOC&nbsp;2 report, no
                  ISO&nbsp;27001 certificate and no independent security attestation.
                </p>
              </div>

              <section id="t-what">
                <h2>
                  <span className="doc__n">01</span>What this document is
                </h2>
                <p>
                  These terms are intended to govern the supply of the CargoSharks software to a
                  customer &mdash; a freight forwarder &mdash; and its use by that customer&rsquo;s
                  staff, and by the customers and agents that customer invites into it.
                </p>
                <p>
                  They are meant to be read with two others: the{' '}
                  <a href="/privacy/">privacy policy</a>, which describes what is held and by whom,
                  and the <a href="/dpa/">data-processing addendum</a>, which governs personal data.
                  Where they conflict, the order form prevails, then the agreement, then the
                  addendum on anything concerning personal data, then these terms.
                </p>
              </section>

              <section id="t-who">
                <h2>
                  <span className="doc__n">02</span>Who you are contracting with
                </h2>
                <p>
                  The contracting entity is <strong>CargoSharks Freight Technologies</strong>. Its
                  registered particulars, and the entity contracting in each market, are stated in
                  the agreement.
                </p>
                <p>
                  &ldquo;CargoSharks&rdquo; below means that entity. &ldquo;You&rdquo; means the
                  organisation named on the order form, not an individual who signs in.
                </p>
              </section>

              <section id="t-supply">
                <h2>
                  <span className="doc__n">03</span>What is supplied
                </h2>
                <p>
                  CargoSharks is supplied as <strong>one deployment per customer</strong>. That is
                  not a packaging choice on top of a shared system &mdash; it is the architecture.
                  There is no tenant identifier anywhere in the schema, because there is no second
                  tenant in the database to distinguish you from.
                </p>
                <ol className="clauses">
                  <li data-s="3">
                    <strong>Your own database.</strong> Your data is in your own PostgreSQL
                    database, in your own instance, in a region agreed with you and recorded in the
                    order form. Not a shared table with a customer column in it.
                  </li>
                  <li data-s="3">
                    <strong>Separation inside the deployment is enforced by the database.</strong>{' '}
                    Branch separation is written as row-level security policies rather than as
                    filters in application code. A request for a branch you do not hold returns{' '}
                    <em>not found</em>, because the row is not in the answer at all. The application
                    connects as a role with no ability to bypass those policies.
                  </li>
                  <li data-s="3">
                    <strong>Your brand, and nowhere ours.</strong> No colour, logo or company name
                    is written into the product. The operator is a setting. Documents your customers
                    receive carry your entity&rsquo;s name and your branch&rsquo;s own numbering
                    series.
                  </li>
                  <li data-s="3">
                    <strong>Both languages.</strong> The interface, the documents, the portal and
                    the public tracking page are in Arabic and English, with right-to-left in the
                    layout rather than applied to it.
                  </li>
                  <li data-s="3">
                    <strong>An audit trail you cannot switch off.</strong> Every change to a
                    business record is written to an audit log by database triggers. That is a
                    property of the deployment, not a feature with a toggle. Its limits are
                    described in the <a href="/privacy/#audit">privacy policy, section 08</a>.
                  </li>
                  <li data-s="3">
                    <strong>Nothing is deleted.</strong> The application&rsquo;s database account
                    holds no delete permission on any table. Records are superseded, closed or
                    deactivated. Read{' '}
                    <a href="/privacy/#nodelete">section 09 of the privacy policy</a> before
                    agreeing to anything about retention or erasure, because this constrains both.
                  </li>
                </ol>
                <p>
                  A deployment can be operated by us on your behalf or run in your own cloud
                  account, and the agreement records which. That choice decides who holds the cloud
                  account and who carries the infrastructure obligations in section 08 &mdash; in a
                  customer-operated deployment those are yours.
                </p>
              </section>

              <section id="t-pilot">
                <h2>
                  <span className="doc__n">04</span>The pilot
                </h2>
                <p>
                  The pilot is a fixed-scope, fixed-fee engagement: your rate card, your customer
                  and agent lists, fifteen to twenty-five of your own completed job files, your
                  logo, and ninety minutes with whoever runs your operation &mdash; built into a
                  working deployment in fifteen working days from the day your data arrives, rather
                  than from signature.
                </p>
                <ol className="clauses">
                  <li data-s="4">
                    It is built on <strong>your</strong> deployment, in your region, under your
                    brand. Nothing built during the pilot is thrown away if you proceed.
                  </li>
                  <li data-s="4">
                    The fee is fixed and, if you proceed, is credited against the full
                    implementation. The fee, what it covers and the period over which it is credited
                    are on the order form. If you do not proceed, the deployment stays up for thirty
                    days so that you can take a full export.
                  </li>
                  <li data-s="4">
                    What is outside the fixed scope, and what it costs if you want it, belongs on
                    the order form rather than here. Rate-card cleaning, additional legal entities
                    and historical migration beyond the agreed job files are the usual exclusions,
                    and each is priced on the order form.
                  </li>
                </ol>
              </section>

              <section id="t-yours">
                <h2>
                  <span className="doc__n">05</span>Your data is yours
                </h2>
                <ol className="clauses">
                  <li data-s="5">
                    Everything you put into the deployment, and everything the product derives from
                    it, is <strong>yours</strong>. CargoSharks claims no ownership of it and no
                    licence to it beyond what is necessary to run the service for you and to support
                    it when you ask.
                  </li>
                  <li data-s="5">
                    <strong>Your data is not used to train anything.</strong> No model is trained,
                    fine-tuned or evaluated on your records by us. Where you switch the model
                    surface on, requests go to the provider you configured, on your key &mdash; and
                    that provider&rsquo;s own terms then apply to those requests, which is a matter
                    between you and them. See section 10 and{' '}
                    <a href="/privacy/#processors">privacy, section 07</a>.
                  </li>
                  <li data-s="5">
                    <strong>
                      An export in an open format is available on request, at no charge
                    </strong>
                    , for as long as the agreement runs and for <strong>thirty days</strong>{' '}
                    afterwards.
                  </li>
                  <li data-s="5">
                    One honest qualification on the previous clause: a{' '}
                    <em>single self-service action</em> that produces a complete export is specified
                    and <strong>not built</strong>. Today an export is assembled for you on request.
                    A financial-journal export and the cutover import templates are in the product
                    and are self-service.
                  </li>
                  <li data-s="5">
                    The schema is documented. If you leave, there is nothing to disentangle, because
                    nothing was entangled &mdash; your database was never shared with anyone
                    else&rsquo;s.
                  </li>
                </ol>
              </section>

              <section id="t-use">
                <h2>
                  <span className="doc__n">06</span>How you may use it
                </h2>
                <p>
                  You may use the deployment to run your own forwarding business, including inviting
                  your customers and your agents into the portals built for them. You may not:
                </p>
                <ul className="bullets">
                  <li>
                    resell or sublicense access to organisations that are not your customers or your
                    agents, or operate the deployment as a service for a third party;
                  </li>
                  <li>
                    attempt to reach data outside the branches and role you hold, or to bypass the
                    database policies that enforce that;
                  </li>
                  <li>
                    connect a mailbox you are not entitled to read, or configure an integration with
                    credentials that are not yours to use;
                  </li>
                  <li>
                    put data into the system that you have no right to process &mdash; the model
                    surface in particular sends what you feed it to a third-party provider;
                  </li>
                  <li>
                    use the software to break the law of the place you are operating in, including
                    sanctions and export controls that apply to freight.
                  </li>
                </ul>
                <p>
                  We will ask you to put a breach of this section right within thirty days. Where a
                  breach is unlawful, or puts other people&rsquo;s data at risk, we may suspend the
                  affected access immediately and ask afterwards.
                </p>
              </section>

              <section id="t-accounts">
                <h2>
                  <span className="doc__n">07</span>Accounts, branches and permissions
                </h2>
                <ol className="clauses">
                  <li data-s="7">
                    You appoint your own administrators. They create accounts, assign branches and
                    roles, connect mailboxes and integrations, and grant or revoke our support
                    access. We do not do any of that on your behalf without a grant from you.
                  </li>
                  <li data-s="7">
                    Accounts belong to named people. Sessions last twelve hours and are checked
                    against the database on every request, so deactivating an account takes effect
                    immediately rather than whenever a token expires.
                  </li>
                  <li data-s="7">
                    Accounts are deactivated, never deleted &mdash; see section 03.6. A deactivated
                    account cannot sign in and remains attributable in the audit trail, which is the
                    point.
                  </li>
                  <li data-s="7">
                    You are responsible for who you give access to, and for the credentials your
                    people hold. The product does what it can to help: passwords are at least twelve
                    characters, five failed sign-ins lock an account for fifteen minutes, sign-in
                    attempts are rate limited per address, and{' '}
                    <strong>
                      two-factor authentication is required for the Administrator and Finance roles
                    </strong>{' '}
                    &mdash; an account that holds one of them cannot reach any screen until it has
                    enrolled.
                  </li>
                </ol>
              </section>

              <section id="t-availability">
                <h2>
                  <span className="doc__n">08</span>Availability and support
                </h2>
                <p>
                  Nothing in this section is decided. It is listed in full because a reviewer will
                  look for it, and an empty section is more honest than an invented one.
                </p>
                <p>
                  The uptime commitment, how it is measured, the maintenance window, support hours,
                  and the response targets by severity are set out in the agreement. Announced
                  maintenance is scheduled outside the Sunday-to-Thursday working week across every
                  country a deployment serves.
                </p>
                <p>
                  What can be said today: backup tooling exists and is used, restores are drilled
                  into a scratch database and verified by row count and schema rather than by the
                  restore command&rsquo;s exit status, and the specification asks for daily backups
                  kept fourteen days, weekly off-site copies kept thirty, and quarterly restore
                  drills evidenced in writing. Retention, off-site copying and encryption of those
                  dumps are properties of the storage they are written to, and are not implemented
                  by the tooling itself. The recovery-point and recovery-time objectives we commit
                  to for your deployment are stated in the agreement.
                </p>
              </section>

              <section id="t-access">
                <h2>
                  <span className="doc__n">09</span>Our access to your deployment
                </h2>
                <p>
                  We have none until you grant it. The mechanism is described in full in{' '}
                  <a href="/privacy/#support">privacy, section 11</a>; the commitments that follow
                  from it are:
                </p>
                <ol className="clauses">
                  <li data-s="9">
                    Support access is created by <strong>your</strong> administrator, scoped to
                    branches they choose, against a reason the database will not accept as empty.
                  </li>
                  <li data-s="9">
                    Read access is structurally read-only. Write access requires a deliberate, typed
                    escalation and is limited to updating existing records &mdash; a support session
                    cannot create users or change your permission matrix.
                  </li>
                  <li data-s="9">
                    Every grant expires on its own within eight hours at the most, two by default. A
                    support principal cannot extend or renew its own access.
                  </li>
                  <li data-s="9">
                    A banner names the engineer, the scope, the reason and the expiry on every
                    internal screen while a grant is open, and you can revoke it in one click.
                  </li>
                  <li data-s="9">
                    Every session opened under a grant is logged, insert-only, and the access count
                    is visible to you against every grant ever issued &mdash; without asking us.
                  </li>
                  <li data-s="9">
                    Separately from support access, the role that owns the database schema can alter
                    any table, including the audit log. It is not used at runtime and is not held by
                    support; migrations are applied by continuous integration from tagged commits.
                    In a customer-hosted deployment you hold that credential, and we use it only
                    with your agreement and only to apply a migration from a tagged commit.
                  </li>
                </ol>
              </section>

              <section id="t-third">
                <h2>
                  <span className="doc__n">10</span>Services you provision yourself
                </h2>
                <p>
                  Every external service the product can talk to is off by default and is turned on
                  by you, with your credentials, from your own settings screen. The software has no
                  vendor account to fall back on.
                </p>
                <ol className="clauses">
                  <li data-s="10">
                    <strong>Carrier tracking</strong> runs on your own carrier API credentials. It
                    is built for Maersk, Hapag-Lloyd and CMA CGM over the DCSA standard, and it does
                    not run until you hold those credentials. Registering once on all
                    customers&rsquo; behalf is not something the carriers permit, and we do not do
                    it.
                  </li>
                  <li data-s="10">
                    <strong>Mail</strong> &mdash; the outbound relay and the inbound mailboxes
                    &mdash; is yours. We bundle no provider.
                  </li>
                  <li data-s="10">
                    <strong>Object storage</strong> is S3-compatible and is yours to point at.
                  </li>
                  <li data-s="10">
                    <strong>The model surface</strong> is off unless you supply a key. When it is
                    on, requests go through OpenRouter, and a supplier-invoice reading sends{' '}
                    <em>the whole document</em>. Read{' '}
                    <a href="/privacy/#transfers">privacy, section 15</a> before enabling it if you
                    have data-residency obligations.
                  </li>
                  <li data-s="10">
                    We are not responsible for those services&rsquo; availability, their terms or
                    their pricing. Where one is unavailable, the feature that depends on it degrades
                    and says so rather than failing silently.
                  </li>
                </ol>
              </section>

              <section id="t-notdo">
                <h2>
                  <span className="doc__n">11</span>What the product does not do
                </h2>
                <p>
                  Stated here as a term rather than left to the sales conversation, so that nothing
                  below can be a surprise in week three.
                </p>
                <ul className="bullets">
                  <li>
                    <strong>It does not file customs declarations.</strong> Kuwait clearance runs
                    through a concession-held system that is not an interface a forwarder can buy.
                    The product tracks declarations and estimates duty from a tariff table; it files
                    nothing, and that is a decision rather than a gap.
                  </li>
                  <li>
                    <strong>It does not transmit e-invoices.</strong> Invoice data carries tax
                    treatment and rate per line, and the hand-off to an accredited provider is built
                    as a plug. No provider has been appointed and the mandated document format is
                    not generated. The UAE timetable in the specification is a provider appointment
                    due 30 October 2026 and go-live on 1 January 2027 for the largest filers; the
                    Saudi ZATCA path carries no date.
                  </li>
                  <li>
                    <strong>It does not issue master carrier documents.</strong> A master bill is
                    the carrier&rsquo;s document on the carrier&rsquo;s stock. House documents are
                    generated.
                  </li>
                  <li>
                    <strong>There is no warehouse module</strong>, no purchase-order management and
                    no native mobile application. Proof of delivery works from a phone browser.
                  </li>
                  <li>
                    <strong>The agent portal answers rate requests and no more</strong> in this
                    release. Milestone posting, document upload and performance views are not built.
                  </li>
                  <li>
                    <strong>WhatsApp is not connected.</strong> The webhook verifies signatures and
                    nothing consumes it. Nothing is sent and nothing is read.
                  </li>
                  <li>
                    <strong>Accounting is an export, not a connector.</strong> A journal your
                    accountant can import, guarded against exporting a period twice.
                  </li>
                  <li>
                    <strong>Scheduled reports are not built.</strong> The job is registered; there
                    is no handler and no schedule.
                  </li>
                </ul>
                <p>
                  The current state of each of these, with dates where dates exist, is on{' '}
                  <a href="/what-we-do/#boundaries">the scope section of the home page</a>, which is
                  read from the specification&rsquo;s own build-status table. Where that page and
                  this section ever disagree, the specification is right and both should be
                  corrected.
                </p>
              </section>

              <section id="t-fees">
                <h2>
                  <span className="doc__n">12</span>Fees
                </h2>
                <p>
                  The implementation fee, the subscription and what it is priced on, the currency,
                  the invoicing frequency and the payment terms are on the order form. Any tax is
                  added unless the order form says otherwise.
                </p>
                <p>
                  One commitment can be made now because it is a product decision rather than a
                  pricing one: <strong>the subscription is not priced per shipment.</strong> Volume
                  pricing charges a forwarder more for growing, which is the opposite of what a
                  system of record should do to them.
                </p>
              </section>

              <section id="t-conf">
                <h2>
                  <span className="doc__n">13</span>Confidentiality
                </h2>
                <p>
                  Each side keeps the other&rsquo;s confidential information in confidence, uses it
                  only to perform the agreement, and does not disclose it except to people who need
                  it and are under the same obligation. This does not cover information that is
                  public through no fault of the receiver, was already held without an obligation,
                  or must be disclosed by law. The obligation survives the agreement. A separate
                  non-disclosure agreement, where one is signed, takes precedence.
                </p>
                <p>
                  Your rate cards and your customer list are the most commercially sensitive things
                  in the deployment, and they are yours.
                </p>
                <p>
                  Naming you as a reference customer requires your written permission, and is not
                  implied by anything in this agreement.
                </p>
              </section>

              <section id="t-ip">
                <h2>
                  <span className="doc__n">14</span>Intellectual property and escrow
                </h2>
                <ol className="clauses">
                  <li data-s="14">
                    The software, and everything in it that is not your data, remains ours. You get
                    a licence to use it for the term, for your own business.
                  </li>
                  <li data-s="14">
                    Your data, your brand and your documents remain yours &mdash; see section 05.
                  </li>
                  <li data-s="14">
                    <strong>Source escrow is available on request.</strong> That is offered because
                    the question &ldquo;what if you go out of business&rdquo; is a real one for a
                    small supplier and is better answered than avoided: your deployment is your own
                    database in your own instance, the schema is documented, and the export is
                    available at any time. The agent, the release conditions and who bears the cost
                    are agreed with you when you ask for it.
                  </li>
                </ol>
              </section>

              <section id="t-warranty">
                <h2>
                  <span className="doc__n">15</span>Warranties, and their limits
                </h2>
                <p>What can be warranted honestly today is narrow, and it is better to say so.</p>
                <ol className="clauses">
                  <li data-s="15">
                    We warrant that the software will perform materially as described in the
                    documentation supplied with it, and that the description of the product in
                    sections 03, 05, 09, 10 and 11 above is accurate as at the date of this
                    document. If it does not, tell us and we will fix it &mdash; that is the remedy;
                    beyond that warranty and anything that cannot be excluded by law, the software
                    is supplied as it is.
                  </li>
                  <li data-s="15">
                    <strong>No certification is warranted.</strong> There is no SOC&nbsp;2 report,
                    no ISO&nbsp;27001 certificate, no penetration test and no independent security
                    audit. The security properties described are checked against a live database by
                    the project&rsquo;s own tests. That is verification by us; it is not attestation
                    by anyone else.
                  </li>
                  <li data-s="15">
                    The product does not give tax, customs or legal advice. A duty estimate is an
                    estimate from a tariff table, kept beside the assessed figure precisely so the
                    two can be seen to differ.
                  </li>
                </ol>
              </section>

              <section id="t-liability">
                <h2>
                  <span className="doc__n">16</span>Liability
                </h2>
                <p>
                  The limit of liability, and what it is measured against, are stated in the
                  agreement. Neither side is liable for indirect or consequential loss, or for loss
                  of profit, revenue or goodwill. Nothing in the agreement limits a liability that
                  cannot be limited by law.
                </p>
              </section>

              <section id="t-term">
                <h2>
                  <span className="doc__n">17</span>Term, termination and exit
                </h2>
                <p>
                  The initial term, how it renews and the notice each side must give are on the
                  order form. Either side may end the agreement for a material breach the other has
                  not put right within thirty days of being told about it.
                </p>
                <p>What follows from the build, whatever the commercial terms turn out to be:</p>
                <ol className="clauses">
                  <li data-s="17">
                    An export in an open format is available on request while the agreement runs and
                    for a period afterwards &mdash; see section 05.
                  </li>
                  <li data-s="17">
                    <strong>Returning your data is straightforward. Destroying it is not.</strong>{' '}
                    The product cannot delete: the application&rsquo;s database account holds no
                    delete permission on any table, retired files are moved rather than removed, and
                    there is no purge, redaction or anonymisation routine anywhere in the codebase.
                    Destruction at the end of the agreement therefore means destroying the
                    deployment and its backups as infrastructure, not running a function inside the
                    product.
                  </li>
                  <li data-s="17">
                    The deployment stays up for <strong>thirty days</strong> after termination so
                    that you can take a full export. After that, and on your written instruction,
                    the database and the object store are destroyed and the backup generations
                    holding them age out on their own retention cycle. We confirm each step in
                    writing.
                  </li>
                </ol>
              </section>

              <section id="t-changes">
                <h2>
                  <span className="doc__n">18</span>Changes to these terms
                </h2>
                <p>
                  We may change these terms on thirty days&rsquo; written notice. If a change is
                  materially adverse to you, you may end the agreement without penalty before it
                  takes effect. The commercial terms on a signed order form do not change except by
                  agreement.
                </p>
              </section>

              <section id="t-law">
                <h2>
                  <span className="doc__n">19</span>Governing law
                </h2>
                <p>
                  The governing law and the forum for any dispute are stated in the agreement, and
                  are settled with each customer according to where they are established and where
                  their deployment is hosted.
                </p>
                <p>
                  This is not a formality here. The product is sold across Kuwait, the UAE, Qatar
                  and Saudi Arabia, hosted in a region the customer picks, and possibly hosted in
                  the EU. Those are four or five legal systems and the choice interacts with the
                  data-protection question in <a href="/privacy/#roles">privacy, section 02</a>.
                </p>
              </section>

              <section id="t-contact">
                <h2>
                  <span className="doc__n">20</span>Contact
                </h2>
                <p>
                  Notices, questions and anything that needs a person:{' '}
                  <a href="mailto:hello@cargosharks.com">hello@cargosharks.com</a>.
                </p>
                <p>
                  Formal notice may be given by email to the address each side names in the
                  agreement, and takes effect on the next working day. The registered address of the
                  contracting entity is stated in the agreement.
                </p>
              </section>

              <div className="doc__stamp">
                <span>
                  <b>Status</b> Draft &mdash; under review by counsel, not yet in force
                </span>
                <span>
                  <b>Written</b> 25 August 2026, from the CargoSharks codebase
                </span>
                <span>
                  <b>Product description accurate as at</b> 25 August 2026, against the
                  specification&rsquo;s build-status table
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band band--white">
        <div className="shell">
          <p className="eyebrow">The set</p>
          <h2 className="h2" style={{ maxWidth: '22ch' }}>
            Three documents
          </h2>
          <div className="doc-switch">
            <a href="/privacy/">
              <b>Privacy policy</b>
              <small>What is held, where, by whom, and for how long.</small>
            </a>
            <a href="/terms/" aria-current="page">
              <b>Terms of service</b>
              <small>
                What is supplied, what is owed on each side, and where the limits are. You are
                reading it.
              </small>
            </a>
            <a href="/dpa/">
              <b>Data-processing addendum</b>
              <small>
                Roles, sub-processors, security measures, and the erasure problem in full.
              </small>
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
