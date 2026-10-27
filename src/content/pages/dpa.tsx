/**
 * Converted, not written — and now the source.
 *
 * This page was hand-written HTML in `public/dpa.html` until the marketing
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

import { EmailLink } from '@/components/Email'
export function DpaContent() {
  return (
    <>
      <section className="hero hero--page">
        <div className="hero__field" aria-hidden="true">
          <div className="hero__grid"></div>
        </div>
        <div className="shell hero__copy">
          <h1 className="display">Data-processing addendum</h1>
          <p className="hero__sub">
            Roles, the subject-matter and duration of processing, the categories of data and data
            subject, the sub-processors, the security measures as actually implemented &mdash; and
            and how your data is corrected, exported and deleted at the end.
          </p>
          <p className="hero__ways">
            <a href="/privacy/">Privacy policy</a>
            <a href="/terms/">Terms of service</a>
            <a href="#erasure">Straight to erasure and deletion</a>
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
                  <a href="#d-what">What this addendum is</a>
                </li>
                <li>
                  <a href="#d-roles">Roles</a>
                </li>
                <li>
                  <a href="#d-subject">Subject-matter, duration, nature and purpose</a>
                </li>
                <li>
                  <a href="#d-categories">Categories of data and of data subject</a>
                </li>
                <li>
                  <a href="#d-instructions">Processing only on instructions</a>
                </li>
                <li>
                  <a href="#d-people">Confidentiality of personnel</a>
                </li>
                <li>
                  <a href="#measures">Security measures, as implemented</a>
                </li>
                <li>
                  <a href="#d-gaps">Security measures not yet in place</a>
                </li>
                <li>
                  <a href="#d-sub">Sub-processors</a>
                </li>
                <li>
                  <a href="#d-model">The model surface, in detail</a>
                </li>
                <li>
                  <a href="#erasure">Assisting with data-subject requests</a>
                </li>
                <li>
                  <a href="#d-breach">Personal data breach</a>
                </li>
                <li>
                  <a href="#d-dpia">Impact assessments and prior consultation</a>
                </li>
                <li>
                  <a href="#d-return">Return and deletion at the end</a>
                </li>
                <li>
                  <a href="#d-audit">Audits and inspections</a>
                </li>
                <li>
                  <a href="#d-transfers">International transfers</a>
                </li>
                <li>
                  <a href="#d-liability">Liability and precedence</a>
                </li>
                <li>
                  <a href="#d-contact">Contact</a>
                </li>
              </ol>
            </nav>

            <div className="doc__body">
              <section id="d-what">
                <h2>
                  <span className="doc__n">01</span>What this addendum is
                </h2>
                <p>
                  This addendum is intended to sit under the <a href="/terms/">agreement</a> and to
                  govern the processing of personal data in a CargoSharks deployment. It is written
                  in the vocabulary of controller and processor because that is the vocabulary most
                  reviewers will bring to it.
                </p>
                <p>
                  This addendum follows the article-28 pattern because it is the most demanding of
                  the regimes that may apply. Which law governs a particular engagement depends on
                  the hosting region and on where the controller is established, and is recorded in
                  the agreement.
                </p>
              </section>

              <section id="d-roles">
                <h2>
                  <span className="doc__n">02</span>Roles
                </h2>
                <dl className="defs">
                  <div>
                    <dt>The customer is the controller</dt>
                    <dd>
                      The forwarder decides whose data goes into the deployment, which mailboxes are
                      connected, whether the model surface is enabled, who may see what, and for how
                      long records are kept.
                    </dd>
                  </div>
                  <div>
                    <dt>CargoSharks is the processor</dt>
                    <dd>
                      <strong>CargoSharks Freight Technologies</strong> processes personal data in
                      the deployment only to provide and support the service.
                    </dd>
                  </div>
                  <div>
                    <dt>For its own website and sales</dt>
                    <dd>
                      CargoSharks is a controller in its own right. That is covered by the{' '}
                      <a href="/privacy/#site">privacy policy, sections 03 and 04</a>, and is
                      outside this addendum.
                    </dd>
                  </div>
                </dl>
                <p>
                  Because the product is supplied <strong>one deployment per customer</strong>{' '}
                  &mdash; one database, one schema, no tenant identifier above the branch &mdash;
                  there is no processing of one controller&rsquo;s data in a system shared with
                  another controller&rsquo;s. That removes an entire category of question a reviewer
                  would otherwise have to ask.
                </p>
              </section>

              <section id="d-subject">
                <h2>
                  <span className="doc__n">03</span>Subject-matter, duration, nature and purpose
                </h2>
                <dl className="defs">
                  <div>
                    <dt>Subject-matter</dt>
                    <dd>
                      Personal data contained in the records of a freight-forwarding business: the
                      people who work for the forwarder, the people who work for its customers and
                      agents, the people who receive goods at the door, and the people who
                      correspond with a connected mailbox.
                    </dd>
                  </div>
                  <div>
                    <dt>Nature of the processing</dt>
                    <dd>
                      Storage, structuring, retrieval, use, generation of documents, transmission by
                      email and webhook, and &mdash; where the controller enables it &mdash;
                      disclosure to a model provider for extraction and question answering.
                    </dd>
                  </div>
                  <div>
                    <dt>Purpose</dt>
                    <dd>
                      Operating the forwarder&rsquo;s commercial and operational record: pricing,
                      quoting, executing, documenting and invoicing a freight job, and giving its
                      customers and agents visibility of the parts that concern them.
                    </dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>
                      The term of the agreement, and afterwards for as long as the deployment and
                      its backups exist. See section&nbsp;14, which explains why that sentence is
                      not the usual one.
                    </dd>
                  </div>
                </dl>
              </section>

              <section id="d-categories">
                <h2>
                  <span className="doc__n">04</span>Categories of data and of data subject
                </h2>
                <p>
                  Read this beside <a href="/privacy/#held">privacy, section 05</a>, which carries
                  the same list with more detail. In summary:
                </p>
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Data subject</th>
                        <th scope="col">Categories of personal data</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">The controller&rsquo;s staff</th>
                        <td>
                          Name (English and Arabic), work email, phone, interface language, active
                          flag, last seen. Authentication records: hashed password, session token,{' '}
                          <strong>IP address</strong>, <strong>user-agent</strong>, two-factor
                          secret and backup codes where enabled.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Contacts at customers and agents</th>
                        <td>
                          Name (English and Arabic), email, phone, job role, primary-contact flag,
                          notification opt-outs.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Recipients of goods</th>
                        <td>
                          Name, <strong>identity-document number</strong>,{' '}
                          <strong>an image of a handwritten signature</strong>,{' '}
                          <strong>GPS coordinates and accuracy of the delivery point</strong>,
                          photographs taken at delivery, and any exception note.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Correspondents</th>
                        <td>
                          Everything in a message read from a connected mailbox: sender, all
                          recipients and copies, subject, full body text, timestamps, and
                          attachments.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Named parties on documents</th>
                        <td>Shipper, consignee and notify-party names and addresses.</td>
                      </tr>
                      <tr>
                        <th scope="row">Anyone appearing in data a model reads</th>
                        <td>
                          Whatever is in the email or the document that was sent. Stored verbatim in
                          the deployment&rsquo;s own model ledger. See section&nbsp;10.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="doc__aside">
                  <b>Two categories deserve a reviewer&rsquo;s attention.</b> The proof-of-delivery
                  record holds an identity-document number, a signature image and a precise
                  location, about a person who never entered into any relationship with the
                  controller&rsquo;s software supplier. The mailbox records hold the contents of
                  correspondence, including from people who wrote in about something else entirely.
                  Neither is unusual for the industry; both are the parts most likely to attract a
                  question. The field is optional in the schema, and a controller who does not need
                  it should leave it unused.
                </div>
              </section>

              <section id="d-instructions">
                <h2>
                  <span className="doc__n">05</span>Processing only on instructions
                </h2>
                <ol className="clauses">
                  <li data-s="5">
                    CargoSharks processes personal data in the deployment only on the
                    controller&rsquo;s documented instructions, which the agreement, this addendum
                    and the controller&rsquo;s own configuration of the product constitute.
                  </li>
                  <li data-s="5">
                    The product&rsquo;s external connections are all off by default and are turned
                    on by the controller, with the controller&rsquo;s own credentials. Enabling one
                    is an instruction; there is no vendor account behind any of them.
                  </li>
                  <li data-s="5">
                    <strong>
                      Controller data is not used to train, fine-tune or evaluate any model
                    </strong>
                    , by us or on our behalf.
                  </li>
                  <li data-s="5">
                    If an instruction appears to us to breach applicable data-protection law, we
                    tell the controller without delay and may suspend the affected processing until
                    it is resolved.
                  </li>
                </ol>
              </section>

              <section id="d-people">
                <h2>
                  <span className="doc__n">06</span>Confidentiality of personnel
                </h2>
                <p>
                  Everyone with the possibility of access is bound to confidentiality. In practice
                  the number of people who <em>can</em> access a deployment&rsquo;s data at all is
                  bounded by the mechanism in section 07 rather than by a policy: without a grant
                  from the controller&rsquo;s own administrator, there is no path in.
                </p>
                <p>
                  Everyone with support access is bound by a written confidentiality obligation that
                  survives the end of their engagement. Access is not standing: it exists only while
                  a grant the customer wrote is unexpired, and the customer can see it and revoke it
                  at any time.
                </p>
              </section>

              <section id="measures">
                <h2>
                  <span className="doc__n">07</span>Security measures, as implemented
                </h2>
                <p>
                  Each row below is a property of the build, not an intention. Where a measure has a
                  limit, the limit is in the row.
                </p>
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Measure</th>
                        <th scope="col">How it is implemented, and its limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Separation between controllers</th>
                        <td>
                          One deployment per customer: a separate database and a separate instance.
                          No shared table, no tenant column.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Separation inside a deployment</th>
                        <td>
                          Row-level security policies in the database, keyed on what kind of
                          principal is asking &mdash; staff by branch, a customer contact by
                          customer, an agent contact by the jobs they are party to, everyone else
                          denied. The application connects as a role that cannot bypass them and
                          owns no table. An unauthorised request returns not-found rather than a
                          filtered list.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Access control</th>
                        <td>
                          Permissions per role and branch, checked in the application as well as in
                          the database on the stated principle that neither is trusted alone.
                          Sessions are opaque database-backed references, twelve hours, revocable
                          immediately. Two-factor authentication is enforced for the Administrator
                          and Finance roles.{' '}
                          <strong>Lockout after repeated failures is built</strong>, as is
                          per-address rate limiting.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Audit trail</th>
                        <td>
                          Database triggers on every business table, recording time, principal and
                          principal type, table, row, operation, the whole row before and after,
                          branch, and source IP. Update, delete and truncate on the log are revoked
                          from the application role and from public. The schema-owning role can
                          still alter it; it is not used at runtime and migrations are applied by
                          continuous integration from tagged commits.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Immutability</th>
                        <td>
                          Delete and truncate revoked from the application role on every table;
                          future tables inherit select, insert and update only. Files are retired by
                          moving them, not by removing them.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Encryption of stored credentials</th>
                        <td>
                          AES-256-GCM with a fresh 96-bit initialisation vector per value,
                          scheme-versioned. The 32-byte key comes from the environment and is never
                          in the database, so a backup or a replica carries ciphertext without a
                          key. A database constraint refuses an unsealed mailbox password. API keys
                          are hashed with Argon2id.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Encryption in transit</th>
                        <td>
                          Outbound connections to the model provider, the carriers and the rates
                          feed are HTTPS. SMTP requires TLS with certificate verification on by
                          default; IMAP uses implicit TLS or STARTTLS. Session cookies are marked
                          secure in production.{' '}
                          <strong>See section 08 for what is not covered.</strong>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Support access</th>
                        <td>
                          Granted by the controller&rsquo;s administrator, scoped to named branches,
                          requiring a non-empty reason, read-only by default and structurally so,
                          expiring within eight hours at most, revocable in one click, announced by
                          a banner on every internal screen, and logged once per database
                          transaction to an insert-only log the controller can read.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Backup and restore</th>
                        <td>
                          Per-deployment dumps taken through an administrative connection &mdash;
                          the tool refuses the application account, because row-level security would
                          make such a dump silently partial. Restores are drilled into a scratch
                          database and verified by row count and schema. Retention, off-site copying
                          and encryption of the dumps are not implemented by the tooling and belong
                          to the storage they are written to.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Verification</th>
                        <td>
                          Row-level security is applied to every business table and an audit trigger
                          to every business table, asserted by the project&rsquo;s own test suite
                          &mdash; a new table with no policy fails the build. That is verification
                          by the supplier.{' '}
                          <strong>It is not an independent attestation, and none exists.</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section id="d-gaps">
                <h2>
                  <span className="doc__n">08</span>Security measures not yet in place
                </h2>
                <p>
                  Listed rather than omitted. A reviewer who finds these on their own will discount
                  everything in section 07.
                </p>
                <ul className="bullets">
                  <li>
                    <strong>The database connection does not require TLS.</strong> Nothing in the
                    code specifies it. Traffic between the web and service containers is plain HTTP
                    on a private network, by design.
                  </li>
                  <li>
                    <strong>Encryption at rest for the database is not established.</strong> It
                    depends on a host that has not been chosen.
                  </li>
                  <li>
                    <strong>No independent security testing.</strong> No penetration test, no SOC 2,
                    no ISO 27001.
                  </li>
                  <li>
                    <strong>There is no data-erasure mechanism</strong>, and retention periods are
                    not set. See section 11.
                  </li>
                  <li>
                    <strong>Monitoring and alerting are not in place.</strong>
                  </li>
                  <li>
                    <strong>Audit search and export is specified and not built</strong> &mdash; the
                    log is complete and readable, but there is no screen that searches or exports
                    it.
                  </li>
                </ul>
                <p>
                  Closed on 25 August 2026, and recorded here rather than quietly dropped: the
                  application now sets a full set of <strong>security headers</strong>, including a
                  content-security policy with a per-request nonce and HSTS;{' '}
                  <strong>sign-in lockout</strong> and a per-address rate limit are built; and{' '}
                  <strong>two-factor authentication is enforced</strong> for the Administrator and
                  Finance roles.
                </p>
              </section>

              <section id="d-sub">
                <h2>
                  <span className="doc__n">09</span>Sub-processors
                </h2>
                <p>
                  The unusual thing about this list is that{' '}
                  <strong>the controller appoints all of them</strong>. Every external service is
                  off by default and is configured by the controller with the controller&rsquo;s own
                  credentials; the software holds no vendor account for any of them. In the strict
                  sense most are the controller&rsquo;s own processors rather than our
                  sub-processors, and a reviewer should read the list that way.
                </p>
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Category</th>
                        <th scope="col">Who</th>
                        <th scope="col">What it receives</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Object storage</th>
                        <td>
                          Any S3-compatible provider the controller points at (Cloudflare R2, MinIO,
                          Backblaze, AWS S3 &mdash; the product signs the requests itself and names
                          no vendor).
                        </td>
                        <td>
                          Every document byte: generated PDFs, email attachments, uploaded scans,{' '}
                          <strong>proof-of-delivery signatures and photographs</strong>, compliance
                          documents, letterheads.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Model provider</th>
                        <td>
                          <strong>OpenRouter</strong>, and whichever model the controller configures
                          it to route to. Off unless the controller supplies a key.
                        </td>
                        <td>
                          See section&nbsp;10 &mdash; it is the row that needs more than a cell.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Outbound mail</th>
                        <td>The controller&rsquo;s own SMTP relay.</td>
                        <td>Recipients, subjects, bodies in either language, attachments.</td>
                      </tr>
                      <tr>
                        <th scope="row">Inbound mail</th>
                        <td>The controller&rsquo;s own IMAP host, one mailbox per branch.</td>
                        <td>
                          Nothing is sent to it. The product reads from it: bodies, headers,
                          attachments.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Carrier tracking</th>
                        <td>
                          Maersk, Hapag-Lloyd, CMA CGM, over DCSA, on the controller&rsquo;s own
                          credentials. Built; not running anywhere today.
                        </td>
                        <td>
                          Container, bill-of-lading and booking numbers. No personal data by design.
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Exchange rates</th>
                        <td>A public rates endpoint.</td>
                        <td>Currency codes only.</td>
                      </tr>
                      <tr>
                        <th scope="row">Outbound webhooks</th>
                        <td>Whatever URL the controller configures.</td>
                        <td>
                          Whatever events the controller subscribes to. A controller-directed
                          transfer.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  Not present, and worth saying because a reviewer will look:{' '}
                  <strong>
                    no payment processor, no analytics, no advertising or marketing platform, no
                    error-reporting service, no product-telemetry exporter, no appointed e-invoicing
                    provider, no WhatsApp sender.
                  </strong>{' '}
                  The application is instrumented against the OpenTelemetry interface with no
                  exporter configured, so nothing is emitted unless the controller configures a
                  collector.
                </p>
                <p>
                  We give the controller <strong>thirty days&rsquo; written notice</strong> before
                  we engage or replace a sub-processor. The controller may object in writing within
                  that period on reasonable data-protection grounds. If we cannot resolve the
                  objection, the controller may terminate the affected service without penalty.
                </p>
              </section>

              <section id="d-model">
                <h2>
                  <span className="doc__n">10</span>The model surface, in detail
                </h2>
                <p>
                  This is the part of the system that moves personal data furthest, and it is off
                  until the controller turns it on. Three surfaces use it:
                </p>
                <ol className="clauses">
                  <li data-s="10">
                    <strong>Reading an enquiry.</strong> The subject and body text of an inbound
                    email are sent, truncated. What comes back is a proposal a coordinator accepts
                    or rejects; nothing becomes a record without a person saying so.
                  </li>
                  <li data-s="10">
                    <strong>Reading a supplier invoice.</strong>{' '}
                    <strong>The whole document is inlined into the request</strong> &mdash; not a
                    link to it, the bytes. A commercial invoice or a customs document therefore
                    leaves the deployment in full. This is the single most consequential sentence in
                    this addendum for a controller with residency obligations.
                  </li>
                  <li data-s="10">
                    <strong>The assistant.</strong> It answers questions over the controller&rsquo;s
                    own data. Its tool calls run under the asking person&rsquo;s own database
                    policies, so it can see exactly what that person could see on a screen and
                    nothing else. What is sent to the model is the rows those calls returned.
                  </li>
                </ol>
                <p>Two properties of the arrangement matter:</p>
                <ul className="bullets">
                  <li>
                    <strong>OpenRouter is a router, not a model vendor.</strong> The request is
                    forwarded to whichever provider serves the configured model, and the model
                    actually served may differ from the one requested &mdash; the deployment records
                    both, for exactly this reason. Which company processed the request, and where,
                    is not something the product is told.
                  </li>
                  <li>
                    <strong>
                      Every request and response is kept, verbatim, in the deployment.
                    </strong>{' '}
                    That includes any document that was inlined. It is a deliberate design decision:
                    after a prompt-injection incident the first question is what the model actually
                    saw, and a system that cannot answer it cannot be investigated. It also means
                    the ledger is a second copy of the most sensitive payloads in the system, inside
                    a database that cannot delete.
                  </li>
                </ul>
                <p>
                  A controller with data-residency obligations should leave this surface switched
                  off, and we advise that in writing. It is inactive unless a key is configured;
                  removing the key removes it entirely, with no partial state and no residue.
                </p>
              </section>

              <section id="erasure">
                <h2>
                  <span className="doc__n">11</span>Assisting with data-subject requests
                </h2>
                <p>What can be done, mechanically, and what cannot:</p>
                <dl className="defs">
                  <div>
                    <dt>Access</dt>
                    <dd>
                      <strong>Yes.</strong> A deployment can be queried for every record naming a
                      person, and the audit log read for every change that touched them.
                    </dd>
                  </div>
                  <div>
                    <dt>Rectification</dt>
                    <dd>
                      <strong>Yes, and it leaves a trace.</strong> Correcting a record supersedes it
                      rather than overwriting it. The wrong value is corrected going forward; it is
                      not unwritten, and it remains in the audit log&rsquo;s before-and-after copy.
                    </dd>
                  </div>
                  <div>
                    <dt>Portability</dt>
                    <dd>
                      <strong>Yes, on request.</strong> An export in an open format is available. A
                      single self-service action producing a complete export is specified and not
                      built; today it is assembled on request.
                    </dd>
                  </div>
                  <div>
                    <dt>Restriction and objection</dt>
                    <dd>
                      <strong>Partly.</strong> An account can be deactivated and a contact marked
                      inactive or opted out of notifications, immediately. Neither removes anything.
                    </dd>
                  </div>
                  <div>
                    <dt>Erasure</dt>
                    <dd>
                      <strong>No. There is no mechanism.</strong>
                    </dd>
                  </div>
                </dl>
                <p>
                  That last line deserves the detail, because it is the one a reviewer will test.
                </p>
                <p>
                  The application&rsquo;s database account cannot delete or truncate on any table
                  &mdash; the privileges it holds are select, insert and update &mdash; and a
                  retired file is moved under a <code>retired/</code> prefix rather than shredded.
                  Records are corrected by superseding them, not by erasing them, so there is no
                  in-place erasure of a single person mid-engagement. The honest answer to that
                  request is correction, above; and, at the end of the engagement, deletion of the
                  whole deployment, which is the controller&rsquo;s to make (section&nbsp;14).
                </p>
                <div className="doc__aside">
                  <b>Why the design is like this, and what it buys.</b> Immutability is what makes
                  the audit trail worth having. It is why a quotation revision cannot quietly
                  replace what a customer accepted, why a document cannot change after it was
                  issued, and why a dispute six months later can be settled from the record. Freight
                  also carries statutory retention obligations of its own, which frequently outlast
                  any request to be forgotten. None of that makes the absence of an erasure path
                  acceptable by itself &mdash; it makes it a decision that has to be taken
                  deliberately.
                </div>
              </section>

              <section id="d-breach">
                <h2>
                  <span className="doc__n">12</span>Personal data breach
                </h2>
                <p>
                  We notify the controller without undue delay after becoming aware of a personal
                  data breach affecting their deployment, and give them what they need to make their
                  own notification.
                </p>
                <p>
                  We notify the controller <strong>within 24 hours of becoming aware</strong> of a
                  personal-data breach affecting their deployment, by email to their named
                  administrators. A first notification states what is known, what is not yet known,
                  what we are doing, and when the next update will come. It is not delayed for the
                  sake of being complete.
                </p>
                <p>
                  What the deployment can supply towards an investigation is genuinely strong and
                  worth stating: the audit log carries every change to every business record with
                  the acting principal, the source IP and the whole row before and after; the
                  support access log carries every session opened under a grant; and the model
                  ledger carries every request and response verbatim. What it does not carry is a
                  user-agent string on anything but the session record, and there is no request
                  identifier tying an audit row to a specific HTTP request.
                </p>
              </section>

              <section id="d-dpia">
                <h2>
                  <span className="doc__n">13</span>Impact assessments and prior consultation
                </h2>
                <p>
                  We assist the controller with impact assessments and with any prior consultation,
                  given the information available to us. This document, and the privacy policy, are
                  most of that information: they are written from the code precisely so that an
                  assessment does not have to be based on a brochure.
                </p>
                <p>
                  Two things in the product are the likely subject of an assessment: the{' '}
                  <strong>proof-of-delivery record</strong> (identity number, signature image,
                  precise location) and the <strong>model surface</strong> (section 10). Neither is
                  hidden in this document for that reason.
                </p>
              </section>

              <section id="d-return">
                <h2>
                  <span className="doc__n">14</span>Return and deletion at the end
                </h2>
                <ol className="clauses">
                  <li data-s="14">
                    <strong>Return is straightforward.</strong> An export in an open format is
                    available on request, during the term and for a period afterwards. The schema is
                    documented. There is nothing to disentangle because your database was never
                    entangled with anyone else&rsquo;s.
                  </li>
                  <li data-s="14">
                    <strong>The data is yours.</strong> The deployment is your own database, in your
                    own instance, and it can run on your own infrastructure. We do not own the
                    controller&rsquo;s data, and where you host it yourself we hold no copy of it.
                  </li>
                  <li data-s="14">
                    So deletion at the end is the controller&rsquo;s to make, not ours to withhold.
                    The deployment stays available for <strong>thirty days</strong> after
                    termination so that a full export can be taken; after that, on the
                    controller&rsquo;s written instruction, what remains &mdash; the database, the
                    object store including its <code>retired/</code> prefix, and the backups taken
                    from them &mdash; is destroyed, by you where you host it and by us where we host
                    it for you.
                  </li>
                </ol>
              </section>

              <section id="d-audit">
                <h2>
                  <span className="doc__n">15</span>Audits and inspections
                </h2>
                <p>
                  The controller can already audit one thing without asking us:{' '}
                  <strong>every support grant ever issued</strong>, with the access count against
                  it, is on their own settings screen and comes from an insert-only log. That is the
                  part of a processor relationship customers most often cannot verify, and here they
                  can.
                </p>
                <p>
                  Beyond that, a controller may audit our compliance with this addendum{' '}
                  <strong>once in any twelve-month period</strong>, on thirty days&rsquo; written
                  notice, at their own cost, and through an auditor who is bound by confidentiality
                  and is not a competitor of ours. There is no independent attestation to offer in
                  its place; what we give instead is the measures in section 07, the sub-processor
                  list, and answers in writing.
                </p>
              </section>

              <section id="d-transfers">
                <h2>
                  <span className="doc__n">16</span>International transfers
                </h2>
                <p>
                  The deployment stays in the region chosen with the controller and recorded in the
                  agreement. What leaves it is only what the controller switched on: model requests
                  (section 10), mail to the relay they configured, and webhooks to the URLs they
                  chose &mdash; and the model surface is inactive unless the controller enables it.
                </p>
              </section>

              <section id="d-liability">
                <h2>
                  <span className="doc__n">17</span>Liability and precedence
                </h2>
                <p>
                  Liability under this addendum is subject to the limitations in the agreement.
                  Where this addendum and the agreement conflict on the processing of personal data,
                  this addendum prevails.
                </p>
              </section>

              <section id="d-contact">
                <h2>
                  <span className="doc__n">18</span>Contact
                </h2>
                <p>
                  <EmailLink /> reaches a person.
                </p>
                <p>
                  Data-protection notices under this addendum go to <EmailLink box="privacy" />.
                  Breach notifications and security reports go to <EmailLink box="security" />.
                </p>
              </section>

              <div className="doc__stamp">
                <span>
                  <b>Status</b> Effective on signing
                </span>
                <span>
                  <b>Written</b> 25 August 2026, from the CargoSharks codebase
                </span>
                <span>
                  <b>Your data is yours</b> corrected in place on request, exported at the end, and
                  deleted at your instruction
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
            <a href="/terms/">
              <b>Terms of service</b>
              <small>What is supplied, what is owed on each side, and where the limits are.</small>
            </a>
            <a href="/dpa/" aria-current="page">
              <b>Data-processing addendum</b>
              <small>
                Roles, sub-processors, security measures, and how your data is corrected, exported
                and deleted. You are reading it.
              </small>
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
