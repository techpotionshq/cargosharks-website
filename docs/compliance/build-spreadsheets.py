# -*- coding: utf-8 -*-
"""
Build the compliance spreadsheets.

    python docs/compliance/build-spreadsheets.py

Writes four workbooks into `docs/compliance/spreadsheets/`. They are the form a
reviewer, a regulator or a customer's procurement team actually asks for — a
regulator asking for an Article 30 record wants a table, not prose.

## Why the data lives here rather than in the Markdown

The `.md` files next door are the narrative: they explain *why* a control is
shaped the way it is, and that reasoning does not fit in a cell. The tables are
the record. Keeping the rows in this script rather than parsing them back out
of Markdown means one place to edit and no fragile round-trip.

**They can still drift.** If you change a retention period or a CAIQ answer,
change it here and re-run, then reconcile the prose next door. The counts in
`CAIQ.md` are computed by this script and printed at the end, so a mismatch is
visible rather than silent.

Nothing here is audited. Every workbook says so on its cover sheet, because a
spreadsheet gets forwarded away from the directory that explains it.
"""

import os
import sys

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is needed: pip install openpyxl")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'spreadsheets')

REVIEWED = '2026-10-02'
OWNER = '[TO CONFIRM — a named person]'

# --- house style -------------------------------------------------------------
#
# Muted and printable. These land in front of people who read a hundred
# questionnaires a year, and a spreadsheet that looks like a dashboard reads as
# marketing rather than as a record.

INK = '1F2933'
HEAD_FILL = PatternFill('solid', fgColor='1F2933')
HEAD_FONT = Font(color='FFFFFF', bold=True, size=10)
TITLE_FONT = Font(bold=True, size=14, color=INK)
BODY = Font(size=10, color=INK)
MONO = Font(size=10, color=INK, name='Consolas')

ANSWER_FILL = {
    'Yes': PatternFill('solid', fgColor='DCF2E3'),
    'Partial': PatternFill('solid', fgColor='FDF0D5'),
    'No': PatternFill('solid', fgColor='FADBD8'),
    'N/A': PatternFill('solid', fgColor='EBEDEF'),
}
ANSWER_FONT = {
    'Yes': Font(size=10, bold=True, color='1E7B45'),
    'Partial': Font(size=10, bold=True, color='9A6700'),
    'No': Font(size=10, bold=True, color='B42318'),
    'N/A': Font(size=10, bold=True, color='667085'),
}

THIN = Side(style='thin', color='D5D9DE')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

TOP_WRAP = Alignment(vertical='top', wrap_text=True)


def cover(wb, title, subtitle, notes):
    """Every workbook opens on what it is and what it is not."""
    ws = wb.create_sheet('Read me', 0)
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 3
    ws.column_dimensions['B'].width = 108

    rows = [
        (title, TITLE_FONT),
        (subtitle, Font(size=10, italic=True, color='667085')),
        ('', BODY),
        ('Last reviewed: %s' % REVIEWED, BODY),
        ('Owner: %s' % OWNER, BODY),
        ('Status: SELF-ASSESSED. Not audited, not certified, not attested.', Font(size=10, bold=True, color='B42318')),
        ('', BODY),
    ]
    for text, font in rows:
        ws.append(['', text])
        c = ws.cell(row=ws.max_row, column=2)
        c.font = font
        c.alignment = TOP_WRAP

    for line in notes:
        ws.append(['', line])
        c = ws.cell(row=ws.max_row, column=2)
        c.font = BODY
        c.alignment = TOP_WRAP
        ws.row_dimensions[ws.max_row].height = 30
    return ws


def table(ws, headers, widths, rows, answer_col=None, freeze='A2'):
    ws.sheet_view.showGridLines = False
    ws.append(headers)
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for c in ws[1]:
        c.fill = HEAD_FILL
        c.font = HEAD_FONT
        c.alignment = Alignment(vertical='center', wrap_text=True)
        c.border = BOX
    ws.row_dimensions[1].height = 30

    for row in rows:
        ws.append(row)
        r = ws.max_row
        for i in range(1, len(headers) + 1):
            c = ws.cell(row=r, column=i)
            c.font = BODY
            c.alignment = TOP_WRAP
            c.border = BOX
        if answer_col:
            c = ws.cell(row=r, column=answer_col)
            v = str(c.value)
            if v in ANSWER_FILL:
                c.fill = ANSWER_FILL[v]
                c.font = ANSWER_FONT[v]
                c.alignment = Alignment(vertical='center', horizontal='center')
        ws.row_dimensions[r].height = 58

    ws.freeze_panes = freeze
    ws.auto_filter.ref = 'A1:%s%d' % (get_column_letter(len(headers)), ws.max_row)
    return ws


# =============================================================================
# 1. ROPA — Article 30 record
# =============================================================================

ROPA_HEADERS = [
    'Ref', 'Processing activity', 'Our role', 'Controller', 'Purpose',
    'Categories of data subject', 'Categories of personal data',
    'Special category data', 'Lawful basis', 'Recipients / sub-processors',
    'International transfer', 'Retention', 'Security measures',
    'Where it lives (tables)', 'Status',
]
ROPA_WIDTHS = [6, 26, 12, 20, 34, 30, 44, 20, 28, 32, 26, 26, 34, 34, 26]

NOT_SET = 'NOT SET — blocked on the erasure decision'

ROPA_ROWS = [
    ['P-01', 'Operating the freight platform', 'Processor',
     "The forwarder (our customer)",
     'Running a freight forwarder\'s operations: enquiries, quotes, shipments, customs, invoicing, settlement',
     "The operator's staff; customer contacts; agent contacts; consignee and shipper contacts named on shipments; drivers and recipients who sign for delivery",
     'Names (English and Arabic), email addresses, telephone numbers, job titles, employer, branch, role and permissions; correspondence; signatures and proof-of-delivery photographs; geolocation captured at delivery; identity-document numbers where the controller chooses to collect them',
     "None intended. Proof-of-delivery photographs can incidentally contain images of people",
     "The controller's — their contract with their customers, and their legitimate interest in operating their business",
     "The operator's own staff scoped by branch; the customer contact for their own shipments; the agent contact for jobs their partner is named on",
     'Determined by the hosting region, which is not yet chosen',
     NOT_SET,
     'Row-level security (ENABLE and FORCE) on 87 of 93 tables, 211 policies; audit by trigger; DELETE revoked; permissions checked per branch',
     'principals, customer_contacts, partner_contacts, jobs, shipments, pod_*, documents, messages',
     'Live'],

    ['P-02', 'Identity and access', 'Joint — see note',
     'Us for the account; the forwarder for the person',
     'Authenticating staff and contacts; enforcing branch scoping and permissions',
     'Anyone with a sign-in',
     'Email, name, password hash, TOTP secret and backup codes, session tokens, IP address, user agent, failed sign-in counts and lock expiry',
     'None',
     'Necessary for the contract; legitimate interest in securing the system',
     'Nobody outside the deployment',
     'None',
     'Sessions expire at 12 hours. Credentials last as long as the account. Deactivation is is_active = false, never deletion',
     'Passwords hashed; TOTP mandatory for Administrator and Finance; lockout after 5 failures; opaque database-backed sessions',
     'auth_user, auth_session, auth_account, auth_two_factor, principals, principal_branch_roles',
     'Live. These tables sit outside RLS and outside audit by design — an audit trigger over credential rows would copy secrets into the log'],

    ['P-03', 'Audit trail', 'Processor', 'The forwarder',
     'Accountability. Who changed what, when',
     'Anyone whose record was created, changed or viewed',
     'Principal id, table, row id, operation, timestamp, client IP address, before/after values — which include personal data wherever the audited row did',
     'Only where the audited row held it',
     'Legal obligation and legitimate interest; an audit trail is itself a security measure',
     'Internal principals with the audit permission; support principals under an unexpired grant',
     'None',
     'NOT SET. NFR-10 requires 12 months minimum, searchable and exportable — the search and the CSV export are built; the period is not',
     'Insert-only. DELETE revoked. 85 triggers; the build fails for any business table without one',
     'audit_log',
     'Live. The table that collides hardest with erasure rights'],

    ['P-04', 'Vendor support access', 'Processor', 'The forwarder',
     'Letting a support engineer answer a question about a specific record',
     'Anyone whose record the engineer reads',
     'Whatever the grant admits, plus a record of the engineer, the grant, the reason and each access',
     'Only where the admitted row held it',
     'The support contract; the customer grants each access explicitly',
     'Named support engineers only',
     'Depends on where the engineer is',
     'NOT SET',
     'Granted by the customer, time-boxed, revocable, read-only unless the customer grants write scope (updates only, never inserts or deletes), logged once per transaction inside that transaction',
     'support_grants, support_access_log',
     'Live. A banner shows the customer while a session is open'],

    ['P-05', 'Inbound enquiry mail', 'Processor', 'The forwarder',
     'Turning emailed and WhatsApp enquiries into structured records, and — where a branch switches the intake agent on — answering the sender with at most one confirmation and a capped number of clarifications',
     'Anyone who emails the enquiry mailbox or messages a business WhatsApp number',
     'Sender address, message body, attachments — uncontrolled, because anyone may write in',
     'Possible but not sought — the sender controls what they send',
     "The controller's legitimate interest in answering enquiries",
     'The IMAP mailbox provider the customer provisions',
     'Depends on the mailbox provider',
     'NOT SET',
     'Mailbox passwords sealed with AES-256-GCM under a key held outside the database; a check constraint refuses plaintext',
     'mailboxes, whatsapp_numbers, messages, message_attachments, intake_conversations, intake_turns',
     'Live. The mailbox is on the open internet. The intake agent ships off per branch'],

    ['P-06', 'The AI surface', 'Processor', 'The forwarder',
     'Extracting structure from enquiries and documents; answering operator questions',
     'Anyone named in text submitted for extraction',
     'Enquiry and document text — for the intake agent, every customer message in the conversation and any PDF or image attached to it — which may contain any of the categories above',
     'Possible, incidentally',
     "The controller's legitimate interest, and their explicit decision to switch the surface on",
     'OpenRouter, and the model provider it routes to',
     'YES — outside the Gulf. Mechanism not settled',
     'NOT SET. ai_invocations stores the verbatim request and response; whether to truncate or redact is undecided',
     'Off unless a key is configured. Removing the key removes the surface entirely',
     'ai_invocations, extraction_proposals, assistant_threads, assistant_messages',
     'OPTIONAL — recommend OFF for any customer with residency obligations'],

    ['C-01', 'Marketing and sales', 'Controller', 'Us',
     'Answering enquiries from the public site; demonstrating the product',
     'People who contact us',
     'Name, company, email, message',
     'None',
     'Legitimate interest in responding to an enquiry',
     'The SMTP/mailbox provider',
     'Depends on the provider',
     'NOT SET',
     'Ordinary mailbox controls',
     'Not in the product database',
     'Live. The hosted demo runs on fixtures with no database'],
]

# =============================================================================
# 2. CAIQ
# =============================================================================

CAIQ_HEADERS = ['Domain', 'ID', 'Question', 'Response', 'Notes', 'Evidence / where']
CAIQ_WIDTHS = [34, 10, 52, 12, 62, 40]

C = [
    ('Audit and Assurance', 'A&A-01', 'Are audit and assurance policies established and reviewed?', 'Partial', 'Documented and versioned in the repository. No annual review cycle in force.', 'docs/compliance/'),
    ('Audit and Assurance', 'A&A-02', 'Are independent audits performed at least annually?', 'No', 'No SOC 2, no ISO 27001, no penetration test. The single largest gap.', '—'),
    ('Audit and Assurance', 'A&A-03', 'Are compliance audits risk-based?', 'N/A', 'Follows from A&A-02.', '—'),
    ('Audit and Assurance', 'A&A-04', 'Is there a process to remediate audit findings?', 'Partial', 'CI and the weekly security workflow gate findings; no external audit to remediate.', '.github/workflows/'),
    ('Audit and Assurance', 'A&A-05', 'Is there an audit management and remediation-tracking process?', 'Partial', 'Tracked as repository issues and in Decisions_Required.md.', 'docs/compliance/Decisions_Required.md'),

    ('Application and Interface Security', 'AIS-01', 'Are application security policies established?', 'Yes', 'CLAUDE.md non-negotiables, enforced by eight repository invariant checks in `pnpm lint`.', 'CLAUDE.md, scripts/check-*.mjs'),
    ('Application and Interface Security', 'AIS-02', 'Is application security tested before release?', 'Yes', 'Every commit: types, engines, migrations, the RLS policy matrix on real PostgreSQL, and every screen end to end in both languages.', '.github/workflows/ci.yml'),
    ('Application and Interface Security', 'AIS-03', 'Is there automated static analysis?', 'Yes', 'Semgrep — typescript, react, nodejs, secrets, owasp-top-ten, sql-injection — per change and weekly.', '.github/workflows/security.yml'),
    ('Application and Interface Security', 'AIS-04', 'Is input validated?', 'Yes', 'Zod at every boundary. Server Actions are the only mutation path.', 'apps/web/src/features/*/form-actions.ts'),
    ('Application and Interface Security', 'AIS-05', 'Is a software bill of materials produced?', 'Yes', 'CycloneDX on every security-workflow run, retained 90 days.', '.github/workflows/security.yml'),
    ('Application and Interface Security', 'AIS-06', 'Are secure coding standards defined?', 'Yes', 'Enforced mechanically: dependency direction, message parity, permission coverage, fixture coverage, migration ordering.', 'scripts/check-*.mjs'),
    ('Application and Interface Security', 'AIS-07', 'Is dependency vulnerability scanning performed?', 'Yes', 'pnpm audit per change and weekly; fails on high and above. Dependabot opens the fixes.', '.github/workflows/security.yml, .github/dependabot.yml'),

    ('Business Continuity', 'BCR-01', 'Is there a business continuity plan?', 'No', 'Not written.', '—'),
    ('Business Continuity', 'BCR-02', 'Are RTO and RPO defined?', 'No', 'Open. Deferred to the customer agreement.', 'Decisions_Required.md'),
    ('Business Continuity', 'BCR-03', 'Are backups performed and tested?', 'Partial', 'Tooling exists and is exercised. The NFR-11 schedule (daily/14 days, weekly off-site/30 days, quarterly signed-off drill) is not operating.', 'pnpm fleet:backup, fleet:restore-drill'),
    ('Business Continuity', 'BCR-04', 'Is there a documented disaster-recovery process?', 'Partial', 'Restore is a command; the surrounding procedure is not written.', 'packages/db/src/fleet-backup.ts'),
    ('Business Continuity', 'BCR-05', 'Is continuity tested annually?', 'No', 'No tabletop exercise has been run.', '—'),

    ('Change Control', 'CCC-01', 'Is there a change-management policy?', 'Partial', 'CI gates every change. Peer review is NOT currently required — the highest-priority fix if a certificate is ever wanted, because auditors sample a past period.', '.github/workflows/ci.yml'),
    ('Change Control', 'CCC-02', 'Are changes tested before production?', 'Yes', 'Six CI jobs; a production build is one of them.', '.github/workflows/ci.yml'),
    ('Change Control', 'CCC-03', 'Is there a rollback capability?', 'Partial', 'Container images roll back. Migrations are forward-only by design and do not.', 'packages/db/migrations/'),
    ('Change Control', 'CCC-04', 'Are unauthorised changes prevented?', 'Partial', 'drizzle-kit push is disabled deliberately; migrations run as a separate role. Branch protection is not configured.', 'packages/db/package.json'),
    ('Change Control', 'CCC-05', 'Is configuration baselined?', 'Yes', 'Everything in the repository; reference data is seed rows an administrator edits without a release.', 'packages/db/src/seed.ts'),

    ('Cryptography and Key Management', 'CEK-01', 'Is data encrypted in transit?', 'Partial', 'TLS terminated at the reverse proxy; HSTS now set. The database connection does not require TLS, and web-to-service is plain HTTP on a private network.', 'apps/web/src/proxy.ts'),
    ('Cryptography and Key Management', 'CEK-02', 'Is data encrypted at rest?', 'No', 'A property of the host, and no host is chosen. Mailbox credentials ARE sealed with AES-256-GCM.', '—'),
    ('Cryptography and Key Management', 'CEK-03', 'Are strong algorithms used?', 'Yes', 'AES-256-GCM for sealed credentials; TOTP for the second factor; password hashing by Better Auth.', 'packages/db/src/schema/integrations.ts'),
    ('Cryptography and Key Management', 'CEK-04', 'Are keys managed and rotated?', 'Partial', 'Keys live in the environment, deliberately outside the database and its backups. No formal rotation schedule.', '.env.example'),
    ('Cryptography and Key Management', 'CEK-05', 'Are keys stored separately from the data they protect?', 'Yes', 'MAILBOX_ENCRYPTION_KEY stays in the environment precisely because `mailboxes` is in every backup and replica.', 'docs/Qabandi_Architecture.md'),

    ('Data Centre Security', 'DCS-01', 'Is physical security managed?', 'N/A', 'Inherited from the hosting provider, which is not chosen.', '—'),

    ('Data Security and Privacy', 'DSP-01', 'Is data classified?', 'Partial', 'Implicit in the schema and the ROPA; no formal classification scheme.', 'docs/compliance/ROPA.md'),
    ('Data Security and Privacy', 'DSP-02', 'Is there a data inventory?', 'Yes', 'The ROPA, derived from the schema.', 'docs/compliance/ROPA.md'),
    ('Data Security and Privacy', 'DSP-03', 'Is data segregated between tenants?', 'Yes', 'Enforced by the database: RLS ENABLE and FORCE on 87 of 93 tables, 211 policies, and a database per customer.', 'packages/db/migrations/0004_rls.sql'),
    ('Data Security and Privacy', 'DSP-04', 'Is secure deletion supported?', 'No', 'The system is built on "nothing is deleted". DELETE is revoked from the application role.', 'packages/db/migrations/01-roles.sql'),
    ('Data Security and Privacy', 'DSP-05', 'Are retention periods defined?', 'No', 'Open, and blocked on the erasure decision.', 'Decisions_Required.md'),
    ('Data Security and Privacy', 'DSP-06', 'Is a DPIA performed where required?', 'No', 'Blocked on which law applies.', '—'),
    ('Data Security and Privacy', 'DSP-07', 'Are sub-processors disclosed?', 'Yes', 'Published list, with what each receives and whether it can be switched off.', 'docs/compliance/Sub_Processors.md'),
    ('Data Security and Privacy', 'DSP-08', 'Can a customer\'s data be returned or exported?', 'Partial', 'Export exists per register; a whole-tenant export is not built.', 'apps/web/src/features/*/export-actions.ts'),

    ('Governance, Risk and Compliance', 'GRC-01', 'Is there an information-security policy?', 'Partial', 'This directory. Not formally approved or on a review cycle.', 'docs/compliance/'),
    ('Governance, Risk and Compliance', 'GRC-02', 'Is there a risk-management programme?', 'Partial', 'Risks named where they live. No register with owners and dates.', 'Security_Measures.md, Operations_Findings.md'),
    ('Governance, Risk and Compliance', 'GRC-03', 'Are roles and responsibilities defined?', 'No', 'The incident plan has no named owner yet.', 'Incident_Response.md'),
    ('Governance, Risk and Compliance', 'GRC-04', 'Is there an exception process?', 'Yes', 'Every deviation carries a written reason in code, and the invariant checks refuse silent omissions.', 'scripts/check-fixtures.mjs'),

    ('Human Resources Security', 'HRS-01', 'Are background checks performed?', 'No', 'Open.', '—'),
    ('Human Resources Security', 'HRS-02', 'Are confidentiality agreements in place?', 'Partial', 'Asserted in the DPA; the underlying agreements are open.', 'apps/landing/src/content/pages/dpa.tsx'),
    ('Human Resources Security', 'HRS-03', 'Is security awareness training provided?', 'No', '—', '—'),
    ('Human Resources Security', 'HRS-04', 'Is there an onboarding and offboarding process?', 'Partial', 'Technically: accounts are is_active = false and revocation takes effect on the next request. Not documented as a procedure.', 'apps/web/src/lib/session.ts'),

    ('Identity and Access Management', 'IAM-01', 'Is there an access-management policy?', 'Yes', 'Roles and permissions are seed rows; 38 enforced keys, granted and checked per branch.', 'scripts/check-permissions.mjs'),
    ('Identity and Access Management', 'IAM-02', 'Is least privilege enforced?', 'Yes', 'Application role holds NOBYPASSRLS, owns nothing, DELETE revoked. Migrations run as a separate role.', 'packages/db/migrations/01-roles.sql'),
    ('Identity and Access Management', 'IAM-03', 'Is multi-factor authentication supported?', 'Yes', 'TOTP, and mandatory for Administrator and Finance — enforced in both internal shells. Backup codes accepted at the challenge.', 'apps/web/src/features/auth/enrolment.ts'),
    ('Identity and Access Management', 'IAM-04', 'Are strong passwords enforced?', 'Yes', 'Twelve characters minimum.', 'apps/web/src/lib/auth.ts'),
    ('Identity and Access Management', 'IAM-05', 'Is there protection against brute force?', 'Yes', 'Five failures locks the account for fifteen minutes; ten attempts per address per fifteen minutes. Enforced inside Better Auth; the address comes from the trusted proxy hops, never the leftmost X-Forwarded-For entry.', 'packages/core/src/lockout.ts, apps/web/src/lib/throttle.ts'),
    ('Identity and Access Management', 'IAM-06', 'Are sessions managed securely?', 'Yes', 'Database-backed and opaque, never JWTs. Revocation takes effect on the next request; sign-out deletes the session and a reset revokes all of them. 12-hour expiry, __Secure- cookies.', 'apps/web/src/lib/session.ts'),
    ('Identity and Access Management', 'IAM-07', 'Are privileged accesses logged?', 'Yes', '85 audit triggers; vendor support access separately granted, time-boxed, read-only unless the customer grants write scope, logged per transaction.', 'packages/db/migrations/0008_support_access.sql'),
    ('Identity and Access Management', 'IAM-08', 'Are access reviews performed periodically?', 'No', 'No cadence defined.', '—'),
    ('Identity and Access Management', 'IAM-09', 'Is SSO or SAML supported?', 'No', 'Deliberately out of scope for Release One.', 'apps/web/src/lib/auth.ts'),

    ('Infrastructure and Virtualisation', 'IVS-01', 'Is network segmentation in place?', 'Partial', 'The service\'s /internal routes are unreachable from outside the private network, verified by three curl checks in the deploy procedure.', 'docs/Deployment_Coolify.md'),
    ('Infrastructure and Virtualisation', 'IVS-02', 'Are baseline configurations enforced?', 'Yes', 'One Dockerfile, standalone output, no devDependencies in the runtime image.', 'Dockerfile'),

    ('Threat and Vulnerability Management', 'TVM-01', 'Is vulnerability scanning performed?', 'Yes', 'Dependencies, container image (Trivy) and source (Semgrep), weekly and per change.', '.github/workflows/security.yml'),
    ('Threat and Vulnerability Management', 'TVM-02', 'Are vulnerabilities remediated within defined timeframes?', 'Partial', 'Gated on high and above; no formal SLA per severity.', '.github/workflows/security.yml'),
    ('Threat and Vulnerability Management', 'TVM-03', 'Is penetration testing performed?', 'No', 'The single highest-value thing to buy. Roughly $5-15k.', '—'),
    ('Threat and Vulnerability Management', 'TVM-04', 'Is there a vulnerability-disclosure process?', 'Yes', 'RFC 9116.', '/.well-known/security.txt'),

    ('Logging and Monitoring', 'LOG-01', 'Are security events logged?', 'Yes', 'Audit triggers on every business table; support access logged per transaction.', 'packages/db/migrations/0003_audit.sql'),
    ('Logging and Monitoring', 'LOG-02', 'Are logs protected from tampering?', 'Yes', 'audit_log is insert-only and DELETE is revoked from the application role.', 'packages/db/migrations/0003_audit.sql'),
    ('Logging and Monitoring', 'LOG-03', 'Are logs retained?', 'Partial', 'Nothing is deleted, so retention is effectively unlimited — but NFR-10\'s twelve-month searchable and exportable requirement is not met.', '—'),
    ('Logging and Monitoring', 'LOG-04', 'Is monitoring and alerting in place?', 'No', 'OpenTelemetry is wired with no exporter registered. NFR-18 requires this at handover.', 'packages/db/src/actor.ts'),
    ('Logging and Monitoring', 'LOG-05', 'Is there audit-log review?', 'No', 'No screen searches or exports the log.', '—'),

    ('Security Incident Management', 'SEF-01', 'Is there an incident-response plan?', 'Yes', 'Written, with the queries that answer "what did this principal touch".', 'docs/compliance/Incident_Response.md'),
    ('Security Incident Management', 'SEF-02', 'Are incidents reported to customers?', 'Partial', 'The DPA now commits to 24 hours from becoming aware. Needs the named incident lead to be real.', 'apps/landing/src/content/pages/dpa.tsx'),
    ('Security Incident Management', 'SEF-03', 'Is the plan tested?', 'No', 'No tabletop exercise has been run.', '—'),
    ('Security Incident Management', 'SEF-04', 'Is forensic evidence preserved?', 'Partial', 'The audit trail is unusually strong and hard to erase. No formal evidence-handling procedure beyond section 3 of the plan.', 'docs/compliance/Incident_Response.md'),

    ('Supply Chain Management', 'STA-01', 'Are third parties assessed?', 'Partial', 'Disclosed and reasoned; no formal assessment.', 'docs/compliance/Sub_Processors.md'),
    ('Supply Chain Management', 'STA-02', 'Are sub-processors contractually bound?', 'Partial', 'Thirty days\' notice and an objection right are now published. The underlying contracts are open.', 'apps/landing/src/content/pages/dpa.tsx'),
    ('Supply Chain Management', 'STA-03', 'Is an SBOM maintained?', 'Yes', 'Per build, CycloneDX, retained 90 days.', '.github/workflows/security.yml'),
    ('Supply Chain Management', 'STA-04', 'Is there supplier lock-in?', 'No', 'No supplier-hosted component in the runtime path; the customer owns the code and the cloud account on final payment; the AI surface is removed by unsetting one key.', 'NFR-17'),
]

# =============================================================================
# 3. Sub-processors
# =============================================================================

SUB_HEADERS = ['Ref', 'Sub-processor', 'Purpose', 'Personal data?', 'Data reaching it', 'Location', 'Can it be switched off?', 'Status']
SUB_WIDTHS = [6, 28, 34, 15, 46, 24, 44, 22]

SUB_ROWS = [
    ['S-01', 'Hosting provider (NOT CHOSEN)', 'Runs the application, the database and the object store', 'Yes', 'All of it', 'To be decided with the customer', 'No — but the region and provider are the customer\'s choice, and the whole deployment can run in the customer\'s own cloud account', 'BLOCKED — decision D'],
    ['S-02', 'Object storage (S3-compatible; Cloudflare R2 in the reference deployment)', 'Bills of lading, invoices, proof-of-delivery photographs, correspondence attachments', 'Yes', 'Documents and their metadata', 'Follows the hosting decision', 'No, but the driver is pluggable — any S3-compatible endpoint, including self-hosted, is configuration', 'Active'],
    ['S-03', 'SMTP provider (per deployment)', 'Sends quotes, invoices, notifications, password-reset links', 'Yes', 'Recipient addresses, message bodies, attachments', 'Customer\'s choice', 'No. The provider is the operator\'s', 'Active'],
    ['S-04', 'IMAP mailbox provider (per deployment)', 'Reads the inbound enquiry mailbox', 'Yes', 'Whatever a customer or agent emails in', 'Customer\'s choice', 'Yes — mailbox polling is per-row configuration at Settings > Mailboxes', 'Active, optional'],
    ['S-05', 'OpenRouter', 'The AI surface: enquiry extraction, the assistant', 'Yes', 'Enquiry text and document extracts submitted for extraction', 'Outside the Gulf', 'YES. Unset the key and the surface disappears. Recommended OFF for any customer with residency obligations', 'Active, optional'],
    ['N-01', 'Carrier APIs (Maersk, Hapag-Lloyd, CMA CGM, DCSA)', 'Container and shipment tracking', 'No', 'Container and bill-of-lading numbers only', 'Various', 'Yes, per carrier', 'Not a sub-processor'],
    ['N-02', 'open.er-api.com', 'Daily exchange rates', 'No', 'Nothing — an outbound request for public rates', 'Public internet', 'Yes', 'Not a sub-processor'],
    ['N-03', 'tiles.openfreemap.org', 'Map tiles and glyphs for the lane map', 'Incidental', 'The viewer\'s IP address, by virtue of the request', 'Public internet', 'Yes, at the cost of the map', 'Not a sub-processor'],
    ['N-04', 'Google Fonts', 'Three typefaces', 'Incidental', 'The viewer\'s IP address and user agent', 'Google', 'Yes — self-hosting removes it entirely. RECOMMENDED before launch', 'Open item'],
]

# =============================================================================
# 4. Decisions register
# =============================================================================

DEC_HEADERS = ['Ref', 'Theme', 'Decision required', 'Who decides', 'Recommendation', 'Blocks', 'Priority', 'Status', 'Due']
DEC_WIDTHS = [7, 26, 56, 20, 56, 34, 11, 16, 12]

DEC_ROWS = [
    ['A', 'Applicable law', 'Which data-protection law the operator accepts as applying — CITRA, UAE PDPL, Saudi PDPL, GDPR, or a combination', 'Counsel', 'Draft to CITRA as the operative regime and GDPR as the ceiling. The addendum already follows the Article 28 pattern', 'Almost everything — vocabulary, breach clock, transfer rules, rights', 'BLOCKER', 'Open', ''],
    ['B', 'Erasure', 'What happens when someone asks to be erased, given DELETE is revoked and nothing can be deleted', 'Counsel, then engineering', 'Both: rely on statutory retention where it applies; build a supervised redaction path (~2 weeks) for everything else', 'Every retention period in the ROPA', 'BLOCKER', 'Open', ''],
    ['C', 'Operating model', 'Is a deployment operated by us, by the customer, or either — and who holds the cloud account', 'Commercial', 'Pick one as the default and price the other. Both are already built', 'Every infrastructure obligation in the terms', 'BLOCKER', 'Open', ''],
    ['D', 'Hosting', 'Region, provider, encryption at rest, backup destination and retention', 'Commercial + engineering', 'Decide before any ministry-adjacent tender — this one can hard-stop a bid', 'Residency, encryption at rest, backups, 3 rows in the measures annex', 'BLOCKER', 'Open', ''],
    ['E', 'Corporate identity', 'Registered entity name, legal form, commercial registration number, registered address', 'Operator', 'Mechanical. Blocks the most documents for the least effort', 'Privacy, DPA, Terms', 'High', 'Partly closed', ''],
    ['F', 'Email addresses', 'privacy@cargosharks.com and security@cargosharks.com must exist', 'Operator', 'Create both. They are already published on the site and in security.txt', 'security.txt, privacy notice, DPA', 'High', 'MUST DO', 'Before launch'],
    ['G', 'Incident lead', 'A named person owning the incident plan and the 24-hour breach commitment', 'Operator', 'Name one. An incident plan with no name produces a meeting, not a response', 'The published 24h breach commitment', 'High', 'MUST DO', 'Before launch'],
    ['H', 'Fonts', 'Self-host the three typefaces instead of loading them from Google', 'Engineering', 'Do it. About an hour; removes a third-party disclosure of every visitor IP', 'Privacy notice section 04', 'Medium', 'Open', ''],
    ['I', 'Change management', 'Require pull-request review, starting now', 'Engineering', 'Start now if any certificate is ever wanted — auditors sample a PAST period and evidence cannot be created retrospectively', 'SOC 2 CC8.1, ISO A.8.32', 'High', 'Open', 'Start now'],
    ['J', 'Penetration test', 'Commission one', 'Operator', 'The highest-value purchase available. $5-15k, 2-4 weeks', 'CAIQ TVM-03; every framework', 'High', 'Open', ''],
    ['K', 'Monitoring', 'Register an OpenTelemetry exporter and set up alerting', 'Engineering', 'NFR-18 requires it at handover. Currently wired with no exporter', 'CAIQ LOG-04', 'Medium', 'Open', ''],
    ['L', 'Audit search/export', 'Build the screen that searches and exports the audit log', 'Engineering', 'NFR-10 requires 12 months searchable AND exportable. Data is there; the screen is not', 'CAIQ LOG-05, DSP-08', 'Medium', 'Open', ''],
    ['M', 'TLS to database', 'Require TLS on the database connection', 'Engineering', 'Set sslmode in the connection string, or document the private-network boundary as the control', 'CAIQ CEK-01', 'Medium', 'Open', ''],
    ['N', 'Commercial terms', 'Fees, term, service levels, RPO/RTO, liability cap, governing law, insurance', 'Commercial + counsel', 'All deferred to the signed agreement on the public pages. Item: liability cap is what a customer legal team reaches for first', 'The signed agreement', 'High', 'Deferred', ''],
]


def build():
    os.makedirs(OUT, exist_ok=True)
    written = []

    # --- ROPA ---
    wb = Workbook()
    wb.remove(wb.active)
    cover(wb, 'Record of Processing Activities',
          'Article 30 record — CargoSharks freight platform',
          ['This is the record a regulator or a customer asks for. One row per processing activity.',
           'We are the PROCESSOR for everything inside a customer deployment, and the CONTROLLER for our own sales correspondence.',
           'RETENTION IS NOT SET on any row. That is one decision, not seven: the product cannot delete (DELETE is revoked from the application role), which collides with a right to erasure. See the Retention sheet.',
           'The narrative version, with the reasoning, is docs/compliance/ROPA.md.'])
    table(wb.create_sheet('Article 30 record'), ROPA_HEADERS, ROPA_WIDTHS, ROPA_ROWS)

    ws = wb.create_sheet('Retention decision')
    cover_rows = [
        'Every retention cell says NOT SET. Here is why, and what to do about it.',
        '',
        'The system is built on "nothing is deleted". DELETE and TRUNCATE are revoked from the application role on every table, and default privileges on future tables are SELECT, INSERT and UPDATE only. A new table inherits the same inability.',
        'That is excellent for an audit trail and directly in tension with a right to erasure.',
        '',
        'The resolution is a legal decision that then becomes an engineering one, in that order:',
        '1. Rely on statutory retention where it applies. Freight and tax records carry minimums; where one applies, erasure is lawfully refused.',
        '2. Build a supervised redaction path for everything else. Not deletion — overwrite the personal fields, keep the row and its references, record the redaction in the audit trail. Roughly a fortnight.',
        '3. Most likely: both.',
        '',
        'Until this is decided, no retention period can be written down honestly, and the privacy notice cannot answer the question a data subject is most likely to ask.',
    ]
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 3
    ws.column_dimensions['B'].width = 110
    for line in cover_rows:
        ws.append(['', line])
        c = ws.cell(row=ws.max_row, column=2)
        c.font = BODY
        c.alignment = TOP_WRAP
    p = os.path.join(OUT, 'ROPA.xlsx')
    wb.save(p)
    written.append(p)

    # --- CAIQ ---
    wb = Workbook()
    wb.remove(wb.active)
    tally = {}
    for row in C:
        tally[row[3]] = tally.get(row[3], 0) + 1
    total = len(C)
    cover(wb, 'CAIQ — self-assessment',
          'CSA Consensus Assessments Initiative Questionnaire, answered against the build',
          ['SELF-ASSESSED. Not audited, not certified, not attested. Publishing it as anything else would be a misrepresentation.',
           'Yes = implemented and demonstrable in the code or against a running system. Partial = part is real and the rest is named. No = not there. N/A = does not apply to how this is built.',
           'There are deliberately a lot of "No" answers. A questionnaire without them is one nobody believes.',
           '%d controls: %d Yes, %d Partial, %d No, %d N/A.' % (
               total, tally.get('Yes', 0), tally.get('Partial', 0), tally.get('No', 0), tally.get('N/A', 0)),
           'The strengths cluster in tenant separation, audit, identity and the build pipeline — controls that are expensive to retrofit. The gaps cluster in attestation and operational procedure, which are cheap to fix. That is an unusual and favourable shape.',
           'Priority: a penetration test (TVM-03); monitoring (LOG-04); the retention and erasure decision (DSP-04/05); pull-request review starting now (CCC-01); TLS to the database and encryption at rest once a host is chosen (CEK-01/02).'])
    table(wb.create_sheet('CAIQ'), CAIQ_HEADERS, CAIQ_WIDTHS, [list(r) for r in C], answer_col=4)

    ws = wb.create_sheet('Summary')
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 18
    ws.column_dimensions['B'].width = 12
    ws.append(['Response', 'Count'])
    for c in ws[1]:
        c.fill = HEAD_FILL
        c.font = HEAD_FONT
    for k in ['Yes', 'Partial', 'No', 'N/A']:
        ws.append([k, tally.get(k, 0)])
        ws.cell(row=ws.max_row, column=1).fill = ANSWER_FILL[k]
        ws.cell(row=ws.max_row, column=1).font = ANSWER_FONT[k]
    ws.append(['Total', total])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=10)
    p = os.path.join(OUT, 'CAIQ.xlsx')
    wb.save(p)
    written.append(p)

    # --- Sub-processors ---
    wb = Workbook()
    wb.remove(wb.active)
    cover(wb, 'Sub-processors',
          'Every third party that can hold or see customer data',
          ['A customer DPA requires this list, a notice period before it changes, and a right to object.',
           'Published position: thirty days notice, objection in writing, termination without penalty if unresolved.',
           'S- rows process personal data. N- rows do not, and are listed because reviewers ask.',
           'No supplier-hosted component sits in the runtime path (NFR-17). Every row is configurable per deployment, optional, or both.'])
    table(wb.create_sheet('Sub-processors'), SUB_HEADERS, SUB_WIDTHS, SUB_ROWS)
    p = os.path.join(OUT, 'Sub_Processors.xlsx')
    wb.save(p)
    written.append(p)

    # --- Decisions ---
    wb = Workbook()
    wb.remove(wb.active)
    cover(wb, 'Compliance decisions register',
          'What is still open, who decides it, and what it blocks',
          ['A to D are blockers: they unblock most of the rest. Take them in order.',
           'F and G must be made TRUE before launch, not merely reviewed — both are already published on the site.',
           'I expires: auditors sample a PAST period, so pull-request review has to start before you want the certificate, not when.',
           'The public pages no longer show [TO CONFIRM] markers. Positions were written in as defensible defaults; this register is what a lawyer marks up.'])
    table(wb.create_sheet('Decisions'), DEC_HEADERS, DEC_WIDTHS, DEC_ROWS)
    p = os.path.join(OUT, 'Decisions.xlsx')
    wb.save(p)
    written.append(p)

    for f in written:
        print('wrote', os.path.relpath(f, os.path.dirname(HERE)))
    print()
    print('CAIQ tally: %d controls — %s' % (total, ', '.join('%d %s' % (v, k) for k, v in sorted(tally.items()))))


if __name__ == '__main__':
    build()
