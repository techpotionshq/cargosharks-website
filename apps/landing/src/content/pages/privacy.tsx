/**
 * Converted, not written — and now the source.
 *
 * This page was hand-written HTML in `public/privacy.html` until the marketing
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
export function PrivacyContent() {
  return (
    <>
      {/* masthead ─────────────────────────────────────────────────────────────── */}
      <section className="hero hero--page">
        <div className="hero__field" aria-hidden="true">
          <div className="hero__grid"></div>
        </div>
        <div className="shell hero__copy">
          <h1 className="display">Privacy policy</h1>
          <p className="hero__sub">
            What personal data CargoSharks holds, where it is hosted, who else touches it, and what
            the audit trail records. Written from the source code rather than from a template.
          </p>
          <p className="hero__ways">
            <a href="/terms/">Terms of service</a>
            <a href="/dpa/">Data-processing addendum</a>
            <a href="/what-we-do/#parts">How the enforcement works</a>
          </p>
        </div>
      </section>

      <section className="band band--paper">
        <div className="shell">
          <div className="doc">
            <nav className="doc__toc" aria-label="Contents">
              <h2>Contents</h2>
              <ol>
                <li>
                  <a href="#scope">What this covers</a>
                </li>
                <li>
                  <a href="#roles">Who is responsible for what</a>
                </li>
                <li>
                  <a href="#site">This website</a>
                </li>
                <li>
                  <a href="#enquiries">What you send when you enquire</a>
                </li>
                <li>
                  <a href="#held">What the product holds</a>
                </li>
                <li>
                  <a href="#where">Where it is hosted</a>
                </li>
                <li>
                  <a href="#processors">Who else processes it</a>
                </li>
                <li>
                  <a href="#audit">What is recorded about every change</a>
                </li>
                <li>
                  <a href="#nodelete">Nothing is quietly deleted</a>
                </li>
                <li>
                  <a href="#retention">How long things are kept</a>
                </li>
                <li>
                  <a href="#support">When our support can see your data</a>
                </li>
                <li>
                  <a href="#credentials">How stored credentials are protected</a>
                </li>
                <li>
                  <a href="#security">Security &mdash; and what is not in place yet</a>
                </li>
                <li>
                  <a href="#rights">Your rights, and how to exercise them</a>
                </li>
                <li>
                  <a href="#transfers">Transfers out of the hosting region</a>
                </li>
                <li>
                  <a href="#changes">Changes to this policy</a>
                </li>
                <li>
                  <a href="#contact">Contact</a>
                </li>
              </ol>
            </nav>

            <div className="doc__body">
              <div className="draft-card">
                <h2>Read this before you read anything else</h2>
                <p>
                  This notice was assembled from the CargoSharks codebase &mdash; the database
                  schema, the migrations, the integration adapters and the deployment documentation
                  &mdash; by reading what they do and writing it down. That makes it unusually
                  specific about mechanism.
                </p>
                <p>Two rules were followed while writing it, and both still hold:</p>
                <ul>
                  <li>
                    <b>No certification is claimed.</b> CargoSharks holds no SOC 2 report, no ISO
                    27001 certificate and no third-party audit attestation, and does not describe
                    itself as &ldquo;GDPR compliant&rdquo;. What is described below is what the
                    software does. Whether that satisfies any particular law is a question for
                    counsel and for the customer&rsquo;s own assessment.
                  </li>
                  <li>
                    <b>Where the code and a conventional clause disagreed, the code won</b> &mdash;
                    and the disagreement was written down rather than smoothed over. Section&nbsp;09
                    is the clearest example: records are corrected in place rather than erased,
                    because the data is yours and the history behind a figure is part of what you
                    are keeping.
                  </li>
                </ul>
              </div>

              <section id="scope">
                <h2>
                  <span className="doc__n">01</span>What this covers
                </h2>
                <p>
                  This policy covers two quite different things, and confusing them is the usual way
                  a software privacy policy becomes untrue.
                </p>
                <ul className="bullets">
                  <li>
                    <strong>This website</strong> &mdash; <code>cargosharks.com</code>, the seven
                    static pages you are reading. Sections&nbsp;03 and 04 are about this and only
                    this.
                  </li>
                  <li>
                    <strong>The CargoSharks software</strong>, running in a deployment operated for
                    a customer. Sections&nbsp;05 onwards are about that. If you are an employee of a
                    forwarder that uses CargoSharks, or a customer or agent of one, this is the part
                    that concerns you &mdash; but your first point of contact is the forwarder, not
                    us. Section&nbsp;02 explains why.
                  </li>
                </ul>
                <p>
                  It does not cover the <a href="https://demo.cargosharks.com">demo deployment</a>,
                  which runs on invented data and holds no real record of anybody. It runs on
                  fixtures with no database behind it, so nothing done there is recorded in any
                  customer deployment.
                </p>
              </section>

              <section id="roles">
                <h2>
                  <span className="doc__n">02</span>Who is responsible for what
                </h2>
                <p>
                  CargoSharks is supplied as <strong>one deployment per customer</strong>: the
                  forwarder gets their own database, in their own instance, with their own
                  configuration. There is no shared table with a customer column in it, and no
                  identifier above the branch anywhere in the schema.
                </p>
                <p>That shape decides the roles.</p>
                <dl className="defs">
                  <div>
                    <dt>For this website and for enquiries</dt>
                    <dd>
                      <strong>CargoSharks Freight Technologies</strong> decides what is collected
                      and why. In data-protection terms it is the controller.
                    </dd>
                  </div>
                  <div>
                    <dt>For everything inside a customer&rsquo;s deployment</dt>
                    <dd>
                      The <strong>forwarder is the controller</strong>. They decide whose shipments
                      are recorded, which mailboxes are connected, whether the model surface is
                      switched on at all, and who may see what. We act on their instructions. The
                      terms of that relationship are in the{' '}
                      <a href="/dpa/">data-processing addendum</a>.
                    </dd>
                  </div>
                  <div>
                    <dt>If you are a shipper, consignee or contact</dt>
                    <dd>
                      Your data is in a forwarder&rsquo;s deployment because you did business with
                      the forwarder. Ask them first. We will help them answer you, and
                      section&nbsp;14 says what we can and cannot do.
                    </dd>
                  </div>
                </dl>
                <p>
                  Which data-protection law governs a given deployment depends on where it is hosted
                  and where the customer is established. Each customer&rsquo;s contract records the
                  hosting region, and this notice is written to the standard of the most demanding
                  regime that applies to it.
                </p>
              </section>

              <section id="site">
                <h2>
                  <span className="doc__n">03</span>This website
                </h2>
                <p>
                  The site you are reading is static HTML. It has no backend, no database and no
                  accounts. What follows is not a promise about a system that could change &mdash;
                  it is a description of files.
                </p>
                <ul className="bullets">
                  <li>
                    <strong>It sets no cookies.</strong> None: not a session cookie, not a
                    preference cookie, not a consent cookie. There is nothing to consent to.
                  </li>
                  <li>
                    <strong>It runs no analytics.</strong> There is no Google Analytics, no
                    Plausible, no Matomo, no Meta pixel, no LinkedIn tag and no heatmap script. Its
                    one script file, <code>assets/site.js</code>, does scroll effects and one form
                    handler, makes no network request of any kind, and stores nothing in the
                    browser.
                  </li>
                  <li>
                    <strong>The pilot form does not post anywhere.</strong> It composes a{' '}
                    <code>mailto:</code> message in your own mail client with your answers already
                    in it, and you press send. Nothing reaches a server unless you choose to send an
                    email, and the address is printed on the page so you can send it yourself
                    instead.
                  </li>
                </ul>
                <h3>The one third party</h3>
                <p>
                  The page loads its typefaces &mdash; Manrope, IBM Plex Mono and IBM Plex Sans
                  Arabic &mdash; from <strong>Google Fonts</strong> (
                  <code>fonts.googleapis.com</code> and <code>fonts.gstatic.com</code>). That
                  request carries your IP address and your browser&rsquo;s user-agent string to
                  Google, on every page load, and it happens before you interact with anything. It
                  is the only external host this site contacts.
                </p>
                <div className="doc__aside">
                  <b>Worth saying plainly:</b> the three typefaces this site uses are loaded from
                  Google&rsquo;s font servers, so opening a page discloses your IP address and
                  user-agent to Google. A German court has held that doing this without consent
                  transmits personal data. We intend to serve the font files from our own servers,
                  which removes the disclosure entirely.
                </div>
                <p>
                  Whoever hosts this site will also keep ordinary web-server logs &mdash; IP
                  address, time, path requested, user-agent.
                </p>
              </section>

              <section id="enquiries">
                <h2>
                  <span className="doc__n">04</span>What you send when you enquire
                </h2>
                <p>
                  If you use the pilot form or write to{' '}
                  <a href="mailto:hello@cargosharks.com">hello@cargosharks.com</a>, we receive what
                  you typed: your name, company, email address, phone number if you gave one, how
                  many branches you run, and what you use today. We use it to reply to you and to
                  have the conversation you started.
                </p>
                <p>We do not sell it, share it or add it to a list you did not ask to be on.</p>
              </section>

              <section id="held">
                <h2>
                  <span className="doc__n">05</span>What the product holds
                </h2>
                <p>
                  Inside a deployment, CargoSharks holds the record of a forwarding business. Most
                  of that is commercial rather than personal &mdash; lanes, containers, rates,
                  invoices. The personal data is listed here in full, because a list that omits the
                  awkward categories is worse than no list.
                </p>

                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Whose data</th>
                        <th scope="col">What is held</th>
                        <th scope="col">Why it is there</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">People who sign in</th>
                        <td>
                          Name in English and Arabic, email address, phone, interface language,
                          whether the account is active, and when it was last seen. Separately: a
                          hashed password, session records carrying{' '}
                          <strong>IP address and user-agent</strong>, and two-factor secrets where
                          two-factor is enabled.
                        </td>
                        <td>
                          Signing in, and knowing which branches and permissions apply to the
                          request.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Customer and agent contacts</th>
                        <td>
                          Name in English and Arabic, email, phone, their role at the company,
                          whether they are the primary contact, and which notifications they have
                          opted out of.
                        </td>
                        <td>
                          Quotations, documents, portal access and notifications go to a named
                          person, not to a company.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">People at the point of delivery</th>
                        <td>
                          The name of whoever received the goods,{' '}
                          <strong>their identity-document number</strong>, an image of{' '}
                          <strong>their handwritten signature</strong>, the{' '}
                          <strong>GPS latitude, longitude and accuracy</strong> of the delivery, and
                          any photographs taken &mdash; of the goods, of damage, or of the signed
                          paper.
                        </td>
                        <td>
                          Proof of delivery. This is the most sensitive category in the product, and
                          it is about people who never signed up for anything.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">People who write to a connected mailbox</th>
                        <td>
                          The message: subject, full body text, sender, all recipients and copies,
                          timestamps, and every attachment &mdash; stored as a record on the job.
                        </td>
                        <td>
                          An enquiry emailed to a branch becomes a proposal a coordinator accepts or
                          rejects; a partner&rsquo;s bill becomes matched lines. Raw MIME is not
                          retained; the flattened text is.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Named parties on shipping documents</th>
                        <td>
                          Shipper, consignee and notify-party names and addresses, as they appear on
                          the bill.
                        </td>
                        <td>They are what a bill of lading is.</td>
                      </tr>
                      <tr>
                        <th scope="row">Anyone in a document a model reads</th>
                        <td>
                          Where the assistant surface is switched on, every request sent to the
                          model provider and every response received is stored verbatim in the
                          deployment&rsquo;s own ledger &mdash; including any document that was
                          inlined into the request. See section&nbsp;07.
                        </td>
                        <td>
                          After a prompt-injection incident the first question is what the model
                          actually saw, and a system that cannot answer it cannot be investigated.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3>Cookies the product sets</h3>
                <p>Four, none of them for tracking or advertising:</p>
                <ul className="bullets">
                  <li>
                    <strong>The session cookie</strong> &mdash; <code>HttpOnly</code>, and{' '}
                    <code>Secure</code> in production. It is an opaque reference checked against the
                    database on every request rather than a self-contained token, so revoking a
                    session takes effect immediately rather than whenever it happens to expire.
                    Sessions last <strong>twelve hours</strong>.
                  </li>
                  <li>
                    <strong>The language preference</strong> (<code>qabandi_locale</code>) and{' '}
                    <strong>the theme preference</strong> (<code>qabandi_theme</code>) &mdash; one
                    year, readable by the page&rsquo;s own script because the page has to render in
                    the right direction before anything else happens.
                  </li>
                  <li>
                    <strong>A demo persona cookie</strong>, on the demo deployment only. It is
                    signed, and it is a demo gate rather than a security boundary.
                  </li>
                </ul>
              </section>

              <section id="where">
                <h2>
                  <span className="doc__n">06</span>Where it is hosted
                </h2>
                <p>
                  Each customer&rsquo;s deployment runs in a region chosen with them and recorded in
                  their contract. The database is a PostgreSQL instance outside the application
                  stack; documents and images are held in S3-compatible object storage.
                </p>
                <div className="doc__aside">
                  <b>Where the marketing copy runs ahead of the repository.</b> The home page offers
                  Kuwait, the UAE, Saudi Arabia or the EU. The specification is more cautious: it
                  records the hosting region as something chosen with the customer during discovery,
                  taking account of any government or ministry contract obligations, and defaulting
                  to a Gulf region &mdash; and lists the specific cloud and region as an{' '}
                  <em>open question</em>. Both statements are honest; they are answers to different
                  questions. What is contractually offered is a commercial decision.
                </div>
              </section>

              <section id="processors">
                <h2>
                  <span className="doc__n">07</span>Who else processes it
                </h2>
                <p>
                  Every external service below is <strong>off by default</strong> and is switched on
                  by the customer, from their own settings screen, with their own credentials. That
                  is not a courtesy &mdash; the software has no vendor account to fall back on.
                  Where a service is not configured, the feature that needs it degrades and says so
                  rather than silently doing nothing.
                </p>
                <p>Categories, and what actually reaches each one:</p>

                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Category</th>
                        <th scope="col">What it is</th>
                        <th scope="col">What reaches it</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Object storage</th>
                        <td>
                          S3-compatible storage, provider-agnostic. Any of Cloudflare R2, MinIO,
                          Backblaze or AWS S3 speaks the dialect the product signs for.
                        </td>
                        <td>
                          <strong>Every document byte.</strong> Generated PDFs (quotations,
                          invoices, delivery orders, house bills of lading and air waybills, customs
                          packs, manifests), inbound email attachments, uploaded scans,{' '}
                          <strong>proof-of-delivery signature images and photographs</strong>,
                          partner compliance documents, branch letterheads.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">The model provider</th>
                        <td>
                          <strong>OpenRouter</strong> (<code>openrouter.ai</code>), which is a
                          router rather than a model vendor: it forwards the request to whichever
                          model is configured and may serve a different one, which is why the
                          deployment records the model actually served alongside the one requested.
                          The default driver is <strong>none</strong> &mdash; nothing is sent
                          anywhere until a customer supplies a key.
                        </td>
                        <td>
                          Three surfaces. <strong>Enquiry reading:</strong> the subject and body
                          text of an inbound email, truncated.{' '}
                          <strong>Supplier-invoice reading:</strong> the whole document, inlined
                          into the request as data &mdash; so a commercial invoice or a customs
                          document leaves the deployment in full. <strong>The assistant:</strong>{' '}
                          the rows returned by its tool calls, which are exactly the rows the person
                          asking is permitted to see.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Outbound mail</th>
                        <td>
                          An SMTP relay the customer provisions. No provider is named or bundled.
                          TLS is required by the adapter, and certificate verification is on by
                          default.
                        </td>
                        <td>
                          Recipient addresses, message subjects and bodies in either language, and
                          attachments &mdash; quotations, invoices, proof of delivery,
                          password-reset mail.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Inbound mail</th>
                        <td>
                          The customer&rsquo;s own IMAP mailboxes, one per branch, polled by the
                          service. Passwords are sealed before they are stored (section&nbsp;12).
                        </td>
                        <td>
                          Nothing goes out. What comes <em>in</em> is the point: the product reads
                          the connected mailboxes, including message bodies and attachments.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Carrier tracking</th>
                        <td>
                          Maersk, Hapag-Lloyd and CMA CGM, over the DCSA standard, on the
                          customer&rsquo;s own carrier credentials. Built and tested;{' '}
                          <strong>not running anywhere today</strong>, because no carrier keys are
                          held.
                        </td>
                        <td>
                          Container numbers, bill-of-lading and booking references, carrier codes.
                          No personal data, by design.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Exchange rates</th>
                        <td>
                          A public rates endpoint (<code>open.er-api.com</code>), configurable to a
                          commercial feed.
                        </td>
                        <td>Currency codes. Nothing else.</td>
                      </tr>
                      <tr>
                        <th scope="row">Webhooks you configure</th>
                        <td>
                          Signed outbound webhooks to URLs the customer chooses, retried and logged.
                        </td>
                        <td>
                          Whatever the customer subscribed to, sent wherever the customer pointed
                          it. That is a transfer the customer directs, not one we make.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3>Things people expect to find here and will not</h3>
                <ul className="bullets">
                  <li>
                    <strong>No payment processor.</strong> There is no Stripe, no KNET integration,
                    no card handling of any kind anywhere in the product. Payments recorded in the
                    finance module are records of money received elsewhere.
                  </li>
                  <li>
                    <strong>No analytics or product telemetry by default.</strong> The application
                    is instrumented against the OpenTelemetry interface, but ships with no exporter
                    configured, so the instrumentation resolves to nothing. If a customer configures
                    a collector, spans carry the deployment key, the acting person&rsquo;s
                    identifier and the branch.
                  </li>
                  <li>
                    <strong>No error-reporting service.</strong> No Sentry, no Datadog, no Bugsnag.
                    Errors are written to the container&rsquo;s log as structured JSON.
                  </li>
                  <li>
                    <strong>No e-invoicing provider.</strong> The hand-off is built; no accredited
                    provider has been appointed, so nothing is transmitted.
                  </li>
                  <li>
                    <strong>No WhatsApp.</strong> The webhook verifies signatures and nothing
                    consumes it. Nothing is sent and nothing is read.
                  </li>
                </ul>
                <p>
                  The notice period before a sub-processor is added or replaced, and the
                  customer&rsquo;s right to object, are set out in the{' '}
                  <a href="/dpa/">data-processing addendum</a>.
                </p>
              </section>

              <section id="audit">
                <h2>
                  <span className="doc__n">08</span>What is recorded about every change
                </h2>
                <p>
                  Every insert, update and delete on every business table writes a row to the
                  deployment&rsquo;s audit log. It is written by database triggers rather than by
                  application code, so a change made by a script, or by someone with a database
                  client, is recorded exactly as a change made through a screen would be.
                </p>
                <p>
                  Each audit row carries: <strong>when</strong>, <strong>who</strong> (the acting
                  person&rsquo;s identifier and what kind of principal they were &mdash; staff,
                  customer contact, agent contact, support, or the system itself),{' '}
                  <strong>which table and which row</strong>, <strong>what operation</strong>,{' '}
                  <strong>the whole row before and the whole row after</strong>, the branch, and{' '}
                  <strong>the IP address the request came from</strong>.
                </p>
                <p>
                  There is no request identifier and no user-agent string on an audit row. The
                  user-agent is held on the session record instead.
                </p>
                <p>
                  Four kinds of table are excluded from this, on purpose: the audit log itself, the
                  authentication tables (a log that copied credential rows would be a new place to
                  steal them from), rate-limit counters, and the record of raw inbound webhooks.
                </p>
                <div className="doc__aside">
                  <b>How far &ldquo;the audit cannot be edited&rdquo; actually goes.</b>{' '}
                  <code>UPDATE</code>, <code>DELETE</code> and <code>TRUNCATE</code> on the audit
                  log are revoked from the account the application runs as and from the public role,
                  and only <code>INSERT</code> and <code>SELECT</code> are granted. So no action
                  taken through the product &mdash; by your administrator, by our support, or by
                  anyone holding an API key &mdash; can amend or remove an audit entry.{' '}
                  <b>The role that owns the table can still alter it.</b> That role is the migration
                  account; it is not used at runtime, it is not held by support, and migrations are
                  applied by continuous integration from tagged commits. That is a procedural
                  control on top of a structural one, and it is worth stating rather than rounding
                  up to &ldquo;impossible&rdquo;.
                </div>
              </section>

              <section id="nodelete">
                <h2>
                  <span className="doc__n">09</span>Nothing is quietly deleted
                </h2>
                <p>
                  This is the section a data-protection reviewer will look at most closely, so here
                  is exactly what happens to a record, and why.
                </p>
                <p>
                  Records are never deleted in place. That is structural, not a policy:{' '}
                  <code>DELETE</code> and <code>TRUNCATE</code> are revoked from the
                  application&rsquo;s database account on every table, and the default privileges
                  granted to it on future tables are <code>SELECT</code>, <code>INSERT</code> and{' '}
                  <code>UPDATE</code> only. A new table inherits the same inability. Records are
                  instead <em>superseded</em>, <em>closed</em> or <em>deactivated</em>: a rate card
                  is versioned, a user is deactivated, a quotation revision supersedes the one
                  before it and the earlier one stays readable.
                </p>
                <p>
                  Files behave the same way. Retiring a document copies the object under a{' '}
                  <code>retired/</code> prefix and removes the live key; the bytes survive, and what
                  happens to them afterwards is decided by a lifecycle rule on the bucket or by a
                  person &mdash; not by the application.
                </p>
                <p>
                  <strong>A single record is not erased in place.</strong> Records are corrected by
                  superseding them rather than by overwriting or deleting them, so a correction is
                  honoured going forward while the history behind it stays intact. What ends the
                  data altogether is deletion of the whole deployment at the end of the engagement,
                  which is yours to make &mdash; your data is your own (section&nbsp;14).
                </p>
                <div className="doc__aside">
                  <b>Why the design is like this.</b> Immutability is a real property a forwarder
                  wants: it is what makes the audit trail worth having and what stops a document
                  quietly changing after it was issued. So corrections supersede rather than
                  overwrite, and a single record is not erased in place. Your data is still yours:
                  you correct it on request while you hold it, and you delete the whole of it at the
                  end (section&nbsp;14).
                </div>
              </section>

              <section id="retention">
                <h2>
                  <span className="doc__n">10</span>How long things are kept
                </h2>
                <p>
                  Four periods are actually implemented in the software and are quoted here exactly:
                </p>
                <dl className="defs">
                  <div>
                    <dt>Sign-in sessions</dt>
                    <dd>Twelve hours, refreshed at most hourly.</dd>
                  </div>
                  <div>
                    <dt>Language and theme cookies</dt>
                    <dd>One year.</dd>
                  </div>
                  <div>
                    <dt>Failed background jobs</dt>
                    <dd>
                      Thirty days. A notification that never arrived is an incident to look into,
                      not a row to sweep up.
                    </dd>
                  </div>
                  <div>
                    <dt>Support access grants</dt>
                    <dd>Two hours by default, eight at the most. See section&nbsp;11.</dd>
                  </div>
                </dl>
                <p>
                  Everything else is undecided, and in practice indefinite. The specification asks
                  for audit entries and access logs to be kept for <em>at least</em> twelve months;
                  because nothing can delete them, they are in fact kept forever. Application logs,
                  web-server logs and object-storage lifecycle are all outside the software and are
                  not defined anywhere.
                </p>
                <h3>Backups</h3>
                <p>
                  Backup tooling exists and is used: a per-deployment dump taken through an
                  administrative connection, which the tool <em>refuses</em> to take through the
                  ordinary application account because row-level security would make such a dump
                  silently partial. Restores are drilled into a scratch database and verified by row
                  count and schema rather than by the exit status of the restore command &mdash; a
                  dump of an empty database restores perfectly.
                </p>
                <p>
                  What that tooling deliberately does not do is retention, off-site copying or
                  encryption at rest; those belong to the storage the dumps are written to. The
                  specification asks for daily backups kept fourteen days and weekly off-site copies
                  kept thirty, with quarterly restore drills evidenced in writing. That is a
                  requirement, not something the code enforces.
                </p>
                <p>
                  One property is worth knowing: mailbox passwords and integration credentials are
                  sealed with a key held in the environment and never in the database, so a backup
                  or a replica carries ciphertext and no key.
                </p>
              </section>

              <section id="support">
                <h2>
                  <span className="doc__n">11</span>When our support can see your data
                </h2>
                <p>
                  Not unless your administrator grants it, and then only within the boundary they
                  set. The mechanism, exactly as implemented:
                </p>
                <ul className="bullets">
                  <li>
                    <strong>Your administrator writes the grant</strong>, not us. A support
                    principal cannot create, extend or renew its own access &mdash; it is refused in
                    the application and it has no policy admitting it in the database.
                  </li>
                  <li>
                    <strong>A reason is required.</strong> The database will not accept a grant with
                    an empty one, and the form asks for the ticket or the request it is for.
                  </li>
                  <li>
                    <strong>It is scoped to named branches.</strong> Leaving the selection blank
                    does not mean everything; it defaults to the branches the granting administrator
                    holds themselves.
                  </li>
                  <li>
                    <strong>Read is the default and is structurally read-only.</strong> A support
                    session has select policies and nothing else, so an attempted change does not
                    fail a check &mdash; it finds no rule that admits it at all. Granting write
                    requires typing the words <code>GRANT WRITE</code>, because escalation should
                    feel like a different act.
                  </li>
                  <li>
                    <strong>It expires on its own</strong> &mdash; two hours by default, eight at
                    the most, one at the least. The expiry is checked by the database policy on
                    every statement, not by a cleanup job that might not run.
                  </li>
                  <li>
                    <strong>You can revoke it in one click</strong>, from the banner, and it takes
                    effect on the next statement.
                  </li>
                  <li>
                    <strong>A banner shows on every internal screen</strong> while a grant is live,
                    naming the engineer, the scope, the stated reason, the branches and the expiry
                    time.
                  </li>
                  <li>
                    <strong>Every session opened under a grant is logged</strong> &mdash; one row
                    per database transaction, written centrally so there is no path that forgets.
                    The log is insert-only, and your administrator can see the access count against
                    every grant ever issued without asking us for it.
                  </li>
                </ul>
              </section>

              <section id="credentials">
                <h2>
                  <span className="doc__n">12</span>How stored credentials are protected
                </h2>
                <p>
                  Credentials the product must be able to replay &mdash; a mailbox password it uses
                  to log in, an API key it presents to a carrier &mdash; are encrypted with{' '}
                  <strong>AES-256-GCM</strong>. A fresh 96-bit initialisation vector is generated
                  per seal by the sealing code itself; no caller gets the chance to supply one. The
                  stored form carries its scheme version, so the algorithm can be changed without
                  guessing at what old rows are.
                </p>
                <p>
                  The key is 32 raw bytes supplied through the environment. A passphrase is refused
                  rather than stretched into a key by an unspecified derivation.{' '}
                  <strong>The key is never in the database</strong>, which is the property that
                  makes the rest of it worth anything: the mailbox table is in every backup, every
                  replica and every dump somebody takes to debug something, and none of those
                  carries the key.
                </p>
                <p>
                  What is encrypted this way: mailbox passwords, and the secrets on integration
                  settings &mdash; the model provider key, the SMTP password, the object-storage
                  secret, carrier credentials, webhook signing secrets. A database constraint
                  enforces the sealed shape on mailbox passwords, so a plaintext password cannot be
                  written by a script or by hand.
                </p>
                <p>
                  Credentials that never need replaying are not encrypted at all &mdash; they are
                  hashed. API keys are hashed with Argon2id; session tokens are opaque references
                  looked up in the database.
                </p>
              </section>

              <section id="security">
                <h2>
                  <span className="doc__n">13</span>Security &mdash; and what is not in place yet
                </h2>
                <p>
                  What the software does is described above and in the{' '}
                  <a href="/dpa/#measures">addendum</a>: separation enforced by the database rather
                  than by application code, an audit trail written by triggers, no delete permission
                  anywhere, sealed credentials, scoped and expiring support access. Those are
                  properties of the build and can be checked against it.
                </p>
                <p>
                  What is <em>not</em> in place is listed here rather than omitted, because a
                  security section that only lists strengths tells a reviewer nothing:
                </p>
                <ul className="bullets">
                  <li>
                    <strong>The database connection does not specify TLS.</strong> Traffic between
                    the application containers and PostgreSQL runs however the connection string and
                    the server negotiate; nothing in the code requires encryption on that hop.
                    Traffic between the web and service containers is plain HTTP on a private
                    network, deliberately.
                  </li>
                  <li>
                    <strong>
                      Encryption at rest for the database itself is not established anywhere.
                    </strong>{' '}
                    It is a property of the chosen host, and no host has been chosen.
                  </li>
                  <li>
                    <strong>Audit search and export is not built.</strong> The log is complete,
                    immutable and readable, but no screen searches or exports it.
                  </li>
                  <li>
                    <strong>No in-place erasure of a single record.</strong> Records are corrected
                    by superseding, not deleting &mdash; right for an audit trail. Deletion of the
                    whole deployment at the end is yours to make. See section 09.
                  </li>
                  <li>
                    <strong>Monitoring and alerting are not in place.</strong> Tracing is wired with
                    no exporter registered.
                  </li>
                  <li>
                    <strong>No independent audit has been performed.</strong> No penetration test,
                    no SOC 2, no ISO 27001. The security properties described here are checked
                    against a live database by the project&rsquo;s own tests, which is verification,
                    not attestation.
                  </li>
                </ul>
                <p>
                  Two entries left this list on 25 August 2026, and are named here rather than
                  quietly removed. <strong>Security headers are now set</strong> by the application
                  &mdash; a content-security policy with a per-request nonce, HSTS, frame-options,
                  referrer and permissions policies. <strong>Sign-in lockout is built</strong>: five
                  failed attempts lock an account for fifteen minutes, alongside a per-address rate
                  limit, and two-factor authentication is now enforced for the Administrator and
                  Finance roles rather than merely offered.
                </p>
              </section>

              <section id="rights">
                <h2>
                  <span className="doc__n">14</span>Your rights, and how to exercise them
                </h2>
                <p>
                  Which rights you have depends on which law applies to you, which is set out in
                  section&nbsp;02. What we can do about each, mechanically, does not depend on that
                  at all:
                </p>
                <dl className="defs">
                  <div>
                    <dt>Access &mdash; what is held about you</dt>
                    <dd>
                      Available. A deployment can be queried for every record naming a person, and
                      the audit log can be read for every change touching them.
                    </dd>
                  </div>
                  <div>
                    <dt>Rectification &mdash; correcting something wrong</dt>
                    <dd>
                      Available, and it leaves a trace. Correcting a record supersedes it rather
                      than overwriting it, so the earlier value stays in the audit log. That is the
                      honest answer: the wrong value is corrected, not unwritten.
                    </dd>
                  </div>
                  <div>
                    <dt>Portability &mdash; getting the data out</dt>
                    <dd>
                      Available, with a caveat. A complete export in an open format is offered
                      commercially and there is nothing structural in the way of it. What is{' '}
                      <em>not</em> built is a single self-service action that produces it: the
                      specification calls for a full export as one action and records it as not
                      implemented. Today an export is assembled for you rather than pressed by you.
                      There are also a financial-journal export and cutover import templates in the
                      product.
                    </dd>
                  </div>
                  <div>
                    <dt>Erasure &mdash; being deleted</dt>
                    <dd>
                      A single record is not erased in place; it is corrected by superseding it (see
                      Rectification, above, and section&nbsp;09). Your data as a whole is yours to
                      delete at the end of the engagement (section&nbsp;14).
                    </dd>
                  </div>
                  <div>
                    <dt>Objection and restriction</dt>
                    <dd>
                      An account can be deactivated and a contact can be marked inactive or opted
                      out of notifications, both immediately. Neither removes anything.
                    </dd>
                  </div>
                </dl>
                <p>
                  If your data is in a forwarder&rsquo;s deployment, your request goes to the
                  forwarder &mdash; they decide, and we assist them. If it concerns this website or
                  an enquiry you sent us, write to us directly.
                </p>
                <p>
                  We answer a request as quickly as we can, and within the period the applicable law
                  allows. We will ask you to confirm your identity before we act on one, because
                  acting on an unverified request is itself a disclosure.
                </p>
              </section>

              <section id="transfers">
                <h2>
                  <span className="doc__n">15</span>Transfers out of the hosting region
                </h2>
                <p>
                  The deployment stays in its region. Two things can leave it, and both are the
                  customer&rsquo;s own switch:
                </p>
                <ul className="bullets">
                  <li>
                    <strong>Model requests</strong>, if the assistant surface is enabled. Those go
                    to OpenRouter, which routes onward. Where the model is served from is not
                    something the product controls or is told, and this is the single largest
                    residency question in the system: a customs declaration or a commercial invoice
                    inlined into a request body has left the region.
                  </li>
                  <li>
                    <strong>Mail</strong>, to whatever relay the customer points it at, and
                    webhooks, to whatever URL the customer configures.
                  </li>
                </ul>
                <p>
                  A customer with data-residency obligations should leave this surface switched off,
                  and we will say so in writing. It is off unless a key is configured, and removing
                  the key removes it entirely &mdash; there is no partial state and no residue.
                </p>
              </section>

              <section id="changes">
                <h2>
                  <span className="doc__n">16</span>Changes to this policy
                </h2>
                <p>
                  We post any change to this notice on this page, with the date it takes effect.
                  Where a change materially affects a customer&rsquo;s deployment, we tell that
                  deployment&rsquo;s administrators before it takes effect.
                </p>
              </section>

              <section id="contact">
                <h2>
                  <span className="doc__n">17</span>Contact
                </h2>
                <p>
                  Write to <a href="mailto:hello@cargosharks.com">hello@cargosharks.com</a>. A named
                  person replies, not a ticket queue.
                </p>
                <p>
                  Write to <a href="mailto:privacy@cargosharks.com">privacy@cargosharks.com</a> with
                  any question about this notice or to exercise a right. To report a vulnerability,
                  write to <a href="mailto:security@cargosharks.com">security@cargosharks.com</a>{' '}
                  &mdash; the terms are at{' '}
                  <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
                </p>
                <p>
                  If your data is in a forwarder&rsquo;s deployment, ask the forwarder first. They
                  are the controller and we act on their instructions.
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
                  <b>Derived from</b> the database migrations, the integration adapters, the
                  deployment notes and the specification&rsquo;s non-functional requirements
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
            <a href="/privacy/" aria-current="page">
              <b>Privacy policy</b>
              <small>What is held, where, by whom, and for how long. You are reading it.</small>
            </a>
            <a href="/terms/">
              <b>Terms of service</b>
              <small>What is supplied, what is owed on each side, and where the limits are.</small>
            </a>
            <a href="/dpa/">
              <b>Data-processing addendum</b>
              <small>
                Roles, sub-processors, security measures, and how your data is corrected, exported
                and deleted.
              </small>
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
