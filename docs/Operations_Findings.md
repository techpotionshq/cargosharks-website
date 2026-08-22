# Operations Findings — What Broke, and What It Taught Us

**Deployment, fleet and reliability notes · v1.2 · Internal**

| | |
|---|---|
| **Prepared by** | techpotions |
| **Date** | 18 August 2026 |
| **Question asked** | The platform works. What stops a *second* deployment of it working, and what stopped the first one? |
| **Relationship to the code** | Companion to `Qabandi_Architecture.md`. That describes the design; this records where the design met a real database and lost. |
| **Status** | Every fault below is fixed unless marked **Open**. |
| **v1.1** | Adds §10, the notification chain — four breaks in one path, and what finding them changed about how a feature is called finished. |
| **v1.2** | Adds §11, the first day the inbound mailbox and the model ran against real services — a feedback loop, a provider quirk that impersonated flakiness, and what test databases nobody empties do to tests. |

> **The finding in one line:** eleven faults were found in one day of running the system in anger, and nine of them were in the paths that stand a deployment up rather than in the product — which is exactly the half a second customer exercises first.

---

## 1. The pattern worth internalising

`OP-01` **Every bug found was in code with no test. Not one was in the tested
core.**

The domain engines (122 tests), the RLS policies (50) and the money handling
were correct throughout. The faults were in bootstrap scripts, layout-level
queries, migrations applied to a database that was not brand new, and adapters
written against documentation rather than a live service.

`apps/web/src/features/` is roughly 28,000 lines with almost no tests. That is
where the next ones are, and it is the layer that runs the customer's actual
business.

`OP-02` **A clean-room test proves less than it appears to.** Three separate
faults passed every from-scratch run and failed on a database that already
existed. If a check only ever runs against a fresh install, it is not testing
the situation every customer after the first will be in.

---

## 2. Bootstrap — a fresh deployment could not be created

**Fixed.**

`OP-03` The documented quickstart could not complete. `db:seed` leaves
`branches` empty; a role is granted *per branch* (`FR-ID-02`), so
`db:create-user` refused with "no matching branches" — and the only other way
to create a branch is a settings screen that needs an account. A closed loop.

`db:seed-demo` failed for the same reason one layer down: it resolves `KWI` and
`DXB` by code and writes `branch_id` from the result, so on an empty table every
insert violated a `not null`.

**Fixes:** new `pnpm db:create-branch`, wired into the README and `tenant:new`;
`seed-demo` creates the branches it references so it stands a demo up from a
migrated database and nothing else; `create-user` now names the fix in its
error.

`OP-04` **`infra/postgres/init/01-roles.sql` hard-coded the database name.**
`grant connect on database qabandi` is correct for exactly one deployment and
silently wrong for every other — so provisioning a tenant database called
anything else produced a broken deployment, surfacing three steps later as
`CREATE SCHEMA "drizzle"` being refused. **This made the entire per-customer
fleet model impossible.** Now uses `current_database()`, which is right for
both the container and `db:provision`.

---

## 3. Migrations — the new-enum trap

**Fixed.**

`OP-05` PostgreSQL refuses to *use* an enum label added in the current
transaction unless the type was **also created** in that transaction
(`check_safe_enum_use`, SQLSTATE `55P04`). Drizzle runs a migration run as one
transaction, so `0008_support_access.sql` behaved differently by target:

| Target | Result |
|---|---|
| Fresh install | `0000` creates `principal_type`, `0008` extends it — same transaction, using the label is allowed |
| Existing deployment | The type was created months ago — `type = 'support'` raises `55P04` and the whole run rolls back |

The file even carried a comment asserting the opposite. It passed every
clean-room test and would have failed on the only database that mattered.

**Fix:** compare as text — `type::text = 'support'` never resolves the label.

**Rule to carry forward:** *if a migration adds an enum value, never use that
value in the same migration.* Cast to text, or split across releases.

---

## 4. Blast radius — where a failure is decides how bad it is

**Fixed, twice, for the same reason.**

`OP-06` **A layout-level query that throws denies the entire application.**

| Incident | Cause |
|---|---|
| `getNavCounts` / `getSetupState` | Skipped the `usePilotFixtures()` guard every other feature has. Being layout-level, they took down every internal screen without a database rather than one panel. |
| `SupportAccessBanner` | Queried `support_grants` on a deployment where the code was updated and `db:migrate` was not. `42P01`, and an entire freight operation could not open a single page because a **notice** could not render. |

**The rule:** *layout-level, non-essential rendering degrades; page-level
essential rendering fails loudly.* The support banner now swallows and logs;
`/settings/support` deliberately still fails, because a page about who has
access that quietly rendered "nobody" would be a lie rather than a degradation.

`OP-07` **A timestamp read through raw SQL is a string, not a `Date`.**
`tx.execute(sql\`…\`)` returns driver values; the declared type said `Date`,
TypeScript believed it, and the first `.toISOString()` threw — in a layout, so
it took everything with it. Hand-verifying those queries missed it because
printing a value never calls a `Date` method.

---

## 5. Failing safely — where a guard belongs

**Fixed.**

`OP-08` **"Refuse to start" and "refuse to serve" are different things, and the
difference is which layer you throw in.**

A `BETTER_AUTH_SECRET` guard was added at module scope in `auth.ts`. The check
was right — Better Auth only *warns* when the secret is missing and falls back
to a shared default signing key, so a session minted against any deployment
would be accepted by every other. But a module-scope throw happens **before
React renders anything**, so no error boundary can catch it, `global-error.tsx`
included. Every request answered a bare `Internal Server Error` whose only clue
was a stack trace naming a compiled chunk.

**Fix:** validate in `instrumentation.ts` `register()`, which runs once before
the process takes traffic — the only place in a Next application where refusing
to start is real. The deployment now fails at boot with a numbered list of
problems, in the log where whoever deployed is already looking.

---

## 6. Diagnosis — a health endpoint must not lie

**Fixed.**

`OP-09` **`/api/health` reported a permissions error as `database:
unreachable`,** because its probe read `drizzle.__drizzle_migrations` and
`app_user` had no grant on that schema. A real outage was chased as a
networking fault on the strength of one word.

**Fixes:** reachability and schema version are now separate questions —
`select 1` isolates connectivity, and the version is allowed to fail on its own
terms. `0009_schema_version_read` grants the application read on that one table,
so the endpoint can compare applied migrations against `EXPECTED_MIGRATIONS`
(taken from Drizzle's own journal, so it cannot drift).

A database behind the code now reports `migrationsPending`. That single line
replaces an hour of stack-trace reading, and **it should be checked after every
deploy**:

```
{"status":"ok","schemaVersion":10,"expectedSchemaVersion":10,
 "migrationsPending":0,"database":"ok","auth":"ok"}
```

`OP-10` **Log the cause privately; report the class publicly.** The endpoint is
unauthenticated, so a connection error — which carries host, role and often the
database name — cannot go in the response. Discarding it entirely is what made
the outage expensive. It now goes to stderr.

---

## 7. Open — the fleet problem nobody has hit yet

`OP-11` **Open. `db:provision` resets cluster-global role passwords.**

`app_user` and `app_migrator` are PostgreSQL *roles*, which are cluster-wide,
not per-database. Provisioning tenant B on the same cluster therefore rewrites
tenant A's credentials, and tenant A stops working. This was hit twice in one
afternoon locally.

| Deployment shape | Affected |
|---|---|
| One instance per tenant | No |
| Shared cluster, database per tenant | **Yes — tenant A breaks when tenant B is provisioned** |

**Decide before customer number two.** The options are one instance per tenant
(simple, more expensive), or per-tenant role names such as `app_user_<key>`
(cheaper, and a change to `01-roles.sql`, `provision.ts` and every connection
string).

---

## 8. Testing — what the day changed

`OP-12` **Nothing in this repository had ever submitted a form.** The
end-to-end suite asserted on server-rendered markup only, so it passed while
sign-in was untestable. The first test that needed a working form found a
selector bug in minutes — and, briefly, produced a false accusation that the
product's sign-in was broken when it was the test that was wrong.

`OP-13` **A fixture whose correctness depends on how long ago the database was
created is not a fixture.** Support-access grants were inserted with
`onConflictDoNothing` and expiries four hours out, so the suite passed on a
fresh database and failed the same afternoon with every grant reporting itself
expired — which reads exactly like a policy regression. They upsert now.

`OP-14` **Verify integrations against the live service, not the
documentation.** Two adapters were written from docs and both were wrong: a
Terminal49 endpoint that does not exist, and a milestone vocabulary
(`DISCHARGED`, `DEPARTED`) that exists nowhere in our own seed — the templates
are lower snake case. The second would have looked wired up, logged cleanly,
and delivered nothing.

---

---

## 9. A feature that was never once exercised

**Fixed.** Added at v1.1, when notifications were built out.

`OP-16` **Four independent breaks in a single path, each invisible to the
others.** Notifications were declared complete at Release One: an outbox table,
a dispatcher with recipients, opt-outs and quiet hours, a delivery table with
retry columns, and a queue name. Every part existed. The path had never carried
one message, and it was broken in four places at once:

| Break | Effect |
|---|---|
| `registerChannel` registry was empty | Every send recorded `failed: no adapter` |
| `notification_templates` had **zero rows** | Every send would have recorded `failed: no template` |
| Nothing ever called `send` for the dispatch job | The worker was mounted and never invoked, so no outbox row was ever read |
| Recipient resolution dropped its filter | An event naming no customer resolved to *every active principal in the database* |

The fourth is the serious one. `event.customerId ? eq(...) : undefined` reads
correctly and is wrong: `undefined` vanishes inside Drizzle's `and()`, so the
narrowing disappeared rather than failing. An SLA breach in Kuwait would have
emailed Dubai staff, every agent contact, and every portal user of every
unrelated customer.

`OP-17` **The lesson is about how completeness is judged.** Each part had a
plausible claim to being finished, and no part could reveal that the *chain*
was not. `OP-01` said the bugs were in code with no test; this is narrower and
sharper — **the bugs are in the joins between tested parts**, and only
something that runs the whole path end to end can see them.

That is now `pnpm --filter @qabandi/service verify:notifications`: it raises a
real event, runs the real dispatcher, and speaks real SMTP to a throwaway
server, then prints the message that came out. It belongs beside
`verify:storage` at step 6 of the checklist.

`OP-18` **Quiet hours deferred messages into a table nobody read.** A recipient
inside quiet hours had a delivery written as `queued` — and the outbox row was
then marked dispatched anyway, so nothing looked at it again. FR-NT-07 says
such events are *deferred*; they were discarded, politely.

Related, and from the same reading: `attempts`, `deferred_until`, `last_error`
and `failed_at` had been on `notification_deliveries` since Release One with
nothing writing them, so a relay down for ninety seconds lost every
notification raised in that window, permanently. **A column that nothing writes
is a claim the schema is making on the code's behalf.**

`OP-19` **Run a scheduled job twice before believing it.** The overdue-invoice
notice deduplicated against the outbox on `payload ->> 'reference'`, and an
invoice's payload carries `seriesNo`. The comparison was therefore
`null = 'KWI-2026-00042'` — null, not true — so the guard never suppressed
anything.

The symptom was not a duplicate row. It was **a dunning letter to every
customer with an unpaid invoice, every night, for as long as it stayed
unpaid** — the exact behaviour the file's own header promised it did not have.
Running the worker once looked perfect. Running it twice, in a row, took four
seconds and found it.

`OP-20` **A default in an example file is a code path.** `.env.example` ships
`MAIL_FROM="Al-Qabandi & Partners <no-reply@qabandi.local>"`, and the SMTP
envelope takes a bare address. Using the setting verbatim in both places sends
`MAIL FROM:<Al-Qabandi & Partners <no-reply@qabandi.local>>`, which every relay
rejects — on every deployment that copied the example, which is all of them,
and on none that set a bare address, which is how it survives local testing.

`OP-21` **Two checks were reporting on themselves rather than on the code.**
Found while the above was being fixed, and both had been quietly wrong:

- `check-messages.mjs` kept one namespace per binding name per file. Three
  server actions each with `const t = getTranslations(...)` collapsed to the
  last one, so keys were reported missing when they were defined — and, in the
  other direction, a genuinely missing key would pass if it happened to exist
  under a sibling namespace.
- `check-links.mjs` collected only `page.tsx`, so every `href` pointing at an
  API route handler scored as dead. `/api/documents/[id]` is a link a person
  clicks: it downloads their bill of lading.

A check that cries wolf is a check somebody switches off, which is worse than
not having it.

## 10. The deploy checklist this produced

Before calling a deployment live:

1. `BETTER_AUTH_SECRET` set to a real per-tenant value — `openssl rand -base64 32`
2. `pnpm db:migrate` run **against that deployment's database**
3. `/api/health` returns `status: ok`, `migrationsPending: 0`, `auth: ok`
4. `QABANDI_TENANT` set, so telemetry can tell deployments apart
5. One backup taken **and restored** — `pnpm fleet:restore-drill`
6. Sign in as a real user, on the deployed instance
7. `pnpm --filter @qabandi/service verify:notifications` — proves the whole
   notification path, in both languages, before a customer is loaded (`OP-16`)

`OP-15` Steps 2 and 3 are the ones that were skipped, and step 3 would have
caught step 2 in seconds.

---

## 11. The first day against real services — 22–23 August 2026

Everything in §2–§10 was found standing a deployment up. These three were found
the first time the inbound mailbox, the object store and the model provider
were all real at once, with the service left running and nobody watching it.
Each one was invisible to every test in the repository, because each one needs
a second party to misbehave.

`OP-30` **A bounce became an enquiry, and the enquiry's notification became
the next bounce.** The dev mailbox received a delivery failure. `inbound-mail`
filed it as a new enquiry — sender `MAILER-DAEMON`, subject *"Undelivered Mail
Returned to Sender"* — started its SLA clock, queued a model call to read it,
and wrote an `enquiry.created` notification to its "customer". The dispatcher
emailed the daemon. The daemon bounced it. **One hundred and ninety-five
enquiries in about thirty minutes**, at one model call each.

No rule in the system could see it. A retry policy sees one job; an SLA clock
sees one enquiry; idempotency sees one `Message-ID`, and every bounce had a
fresh one. Each turn of the loop looked, to every guard we had, like a new
customer writing in. The fix is `isAutomaticMail` in `inbound-routing.ts` plus
an `automatic` flag both adapters set from the headers that only they can read
(`Auto-Submitted`, `X-Auto-Response-Suppress`, `Precedence`, the null
`Return-Path`, `multipart/report`). Automatic mail is *claimed* — so it is never
re-polled — and then filed nowhere. It is deliberately not a spam filter: an
unknown sender with an odd subject is an enquiry, which is the whole of
FR-EQ-02.

The lesson generalises: **any path that replies to the sender of inbound mail
needs a loop breaker before it needs anything else.** Out-of-office replies
would have done the same thing more slowly.

`OP-31` **A provider quirk impersonated a transient fault, and the retry
policy paid for it.** `minimax/minimax-m3`, asked for structured output,
intermittently returns `content: null` with the entire JSON answer in
`message.reasoning` — nine "reasoning" tokens that *are* the reply. The adapter
read only `content`, so a correct answer arrived as the empty string,
`parseModelJson` raised *"The model returned nothing"*, and the worker — which
had just been taught to rethrow transient failures so pg-boss would retry —
retried five times at full price and failed identically each time.

It was never transient. The ledger showed it: every failed call was `ok` from
the provider's view, fourteen tokens, a second's latency, no error — identical
to the calls that succeeded. The tell was that the *same* tiny response
sometimes parsed and sometimes did not. `model.ts` now reads `reasoning` as the
reply where there is no content and no tool call; since it went live, zero
empties against seven reads.

Two rules came out of this. First, **"the provider returned nothing" is a claim
to verify against the ledger, not a diagnosis** — `ai_invocations.response`
holds the raw body for exactly this. Second, the split between failures worth
retrying and failures that are settled is now explicit in both extraction
workers: `ai.not_configured` and `ai.budget_exhausted` are swallowed, because
five attempts cannot fix either; everything else goes back to the queue.

`OP-32` **A test database nobody empties changes what a test can assert.**
`DELETE` is revoked from `app_user` (§5.5), so `qabandi_test` only ever grows.
Three tests that passed on the day they were written failed on the fourth run:
a consolidation cluster on the shared fixture lane had accumulated more cargo
than a 40HC takes; a `LIMIT 400` with no `ORDER BY` in the candidates query
returned the oldest four hundred fixtures and never this week's bookings (a
real product bug, found by the accumulation); and a web test that collided
with the seed's `KWSWK` ran on a database where the seed had not yet run,
succeeded, and made *"Shuwaikh Two"* — an inland depot with no Arabic name —
that deployment's Shuwaikh for good, which a service-side document test then
failed on.

Separately, running the web and service suites **concurrently** against that
one database produced a different single failure each run — consecutive
invoice numbers, taxable lines — from the other suite's writes landing between
a test's two steps. CI runs them sequentially; so must a developer.

The rules: a test that asserts exact figures makes the rows it asserts about
(`candidates.test.ts`, `freshLane()`); a test that needs a pre-existing row
creates it rather than assuming a seed ran first; a query with a `LIMIT` says
what it is limiting to; and one suite at a time. `docs/Dev_Environment.md`
records where that database is.

