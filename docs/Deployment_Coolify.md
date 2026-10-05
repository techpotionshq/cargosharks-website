# Deploying to Coolify — three containers, one private network

**Operations note · v1.0 · Internal**

| | |
|---|---|
| **Question answered** | The product is `web` and `service`, talking to each other, plus `landing`, which talks to neither. What does that look like on Coolify, and what must never be exposed? |
| **Applies to** | `Dockerfile` (three build targets) and `compose.prod.yaml` |
| **Companion to** | `Operations_Findings.md`, which records what broke the first time |

---

## 1. The one rule

`SERVICE_URL` is an **internal** address. A container name on the private
network, plain HTTP, port 3001:

```
SERVICE_URL=http://service:3001
```

Never the service's public domain. The reason is what lives behind that URL:
the `/internal` prefix authenticates the *caller* with a shared secret, and the
caller then **names the principal to act as**. That is what makes it useful —
the web app has already resolved the session, and row-level security should
decide what a document may contain rather than a second check that could drift
(§5.2). It is also what makes it dangerous: anyone holding
`INTERNAL_API_SECRET` can name any principal in any branch.

Routing that traffic through a public domain puts an impersonation endpoint on
the internet, protected by one string, for no benefit — the two containers are
a virtual network hop apart.

## 2. The service has no domain

It serves four prefixes and they do not have the same audience:

| Prefix | Audience | Reached how |
|---|---|---|
| `/webhooks` | carrier and provider callbacks | `https://<web>/webhooks/…`, through the web container |
| `/api/v1` | the public read and tracking API | `https://<web>/api/v1/…`, through the web container |
| `/health` | the platform's health check | the container `HEALTHCHECK`, on the private network |
| `/internal` | the web container, and nothing else | `SERVICE_URL`, on the private network — **never** from outside |

The two public prefixes are served by `apps/web` as catch-all route handlers
(`app/api/v1/[[...path]]`, `app/webhooks/[[...path]]`) that forward the
request to `SERVICE_URL` unchanged — body byte for byte, because both webhook
handlers verify an HMAC over exactly what the provider signed. The helper
behind them, `apps/web/src/lib/service-proxy.ts`, forwards those two prefixes
and answers 404 to everything else.

So one domain on `web` for the service's traffic. Configure WhatsApp and the
mail provider with `https://app.example.com/webhooks/whatsapp` and
`…/webhooks/email`; hand customers `https://app.example.com/api/v1`.
`/internal` is unreachable from outside not because something refuses it but
because no route leads there.

`landing` gets a domain too, separately — it is the public marketing site, not
part of this proxy chain, and shares no request path with `web`. Point the
product's root domain at it and `app.` (or similar) at `web`; nothing in
either container assumes anything about the other's hostname.

The in-code guard stays as defence in depth: the service refuses any
`/internal` request carrying proxy forwarding headers (`X-Forwarded-For`,
`X-Forwarded-Host`, `X-Forwarded-Proto`, `Forwarded`) with a 404, so a
service that somebody later *does* give a domain still fails closed.
`INTERNAL_API_TRUST_PROXY=true` disables that guard; it exists for a
deployment where something on the *private* network legitimately adds
forwarding headers — a service mesh, a sidecar. It is not a way to make a
public route work, and there is no longer a reason to want one.

## 3. One stack, not three applications

Deploy all three containers from `compose.prod.yaml` — build pack **Docker
Compose**, compose location `/compose.prod.yaml`. Coolify puts the stack on
one bridge network and Docker DNS resolves a service by the name it carries in
that file, so `SERVICE_URL=http://service:3001` is true by construction rather
than by a setting somebody has to remember. The shared secret is also declared
once: separate `web` and `service` applications means `INTERNAL_API_SECRET`
typed into two places, and the failure when those drift is a 401 the web app
reports to an operator as "the document could not be generated". `landing`
takes no environment at all, so it has nothing to drift.

That file is deliberately not `compose.dev.yaml`, which is the local
dependency stack — Postgres with a password of `postgres`, MinIO with a
published key, both bound to host ports. Deploying that one would put them on
the internet.

Coolify manages naming, restarts and networking for a stack, so
`container_name`, `restart` and `networks` are absent from the file on purpose.
A custom network is the worst of the three: it puts a container on two networks
at once, and Traefik then chooses between them per request — which presents as
intermittent 504s rather than as a misconfiguration.

**If you keep them as two separate applications** instead, each stack gets its
own network and by default they cannot see each other at all. Enable **Connect
to Predefined Network** on both, then address the service by the name Coolify
renamed it to — `http://service-<uuid>:3001`, behind the eye icon next to the
internal URL. That option changes how DNS resolves *within* a stack, so if
either stack later grows a third container, check that it still resolves its
siblings by name.

## 4. Environment, per application

Both apps take their whole configuration from the environment. Nothing below is
Coolify-specific.

### Web

```
DATABASE_URL=postgres://app_user:…@db-host:5432/qabandi
BETTER_AUTH_SECRET=…
BETTER_AUTH_URL=https://app.example.com
INTERNAL_API_SECRET=…                    # identical to the service's
MAILBOX_ENCRYPTION_KEY=…                 # identical to the service's; base64 of 32 bytes
```

`MAILBOX_ENCRYPTION_KEY` is on both containers because both use it: the web
app seals a credential when an administrator saves a mailbox or an
integration (`packages/db/src/secrets.ts`), and the service opens it when the
worker runs. Two different keys means the web app seals a password the
service cannot read, and that surfaces as "this sealed credential could not
be opened" on the first poll, not at boot. It is base64 of 32 raw bytes, not
a passphrase — a key of any other length is refused, and the service's boot
line then reports mailboxes unreadable.

Do **not** add `SERVICE_URL` or `QABANDI_PILOT_FIXTURES` on a compose stack.
The first is hard-coded in `compose.prod.yaml` so it cannot be pointed at a
public domain from the UI (§1); the second is `ENV`-set to `0` in the
Dockerfile's web stage, so a deployment that loses its connection string fails
by name instead of serving demo data. Both are settings that should not be one
checkbox away from wrong. The one exception is a deliberately fixture-backed
demo deployment, where `QABANDI_PILOT_FIXTURES=1` is the point.

Set `RUN_MIGRATIONS=true` and `MIGRATION_DATABASE_URL` on **one** deployment
only, and leave both unset everywhere else. The entrypoint explains why: the
migrator owns every object and can drop a policy, which is not a credential an
ordinary restart should hold.

### Service

```
DATABASE_URL=postgres://app_user:…@db-host:5432/qabandi
INTERNAL_API_SECRET=…                    # identical to the web app's
WEB_URL=https://app.example.com          # the address in outbound links; also the CORS origin
MAILBOX_ENCRYPTION_KEY=…                 # identical to the web app's
FILE_STORE_DRIVER=s3                     # bootstrap fallback — see below
S3_ENDPOINT=… S3_REGION=… S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=…
```

`WEB_URL` has a config default of `http://localhost:3000` and is not derived
from `BETTER_AUTH_URL`, so leaving it unset on a deployment fails quietly
rather than at boot — the service's CORS origin is then localhost.
`CHROMIUM_EXECUTABLE_PATH` is already set in the image, so PDF
rendering works with no configuration. The storage credentials are the
**service's alone** — the web app never signs anything, it asks for a link.

Storage, the mail relay, the FX feed, the carrier registrations, WhatsApp,
the e-invoice provider and the model are **rows, not variables**:
`integration_settings`, edited at Settings → Integrations, with credentials
sealed under `MAILBOX_ENCRYPTION_KEY` (`FR-AD-03`). A row wins; the
environment answers when there is no row, which is what lets mail work before
anyone can sign in to configure mail. So `SMTP_*`, `FX_*`,
`CARRIER_TRACKING_DRIVER` and the `DCSA_*` keys are bootstrap values here,
not the place to manage them — the names are listed under "Integration
settings" in `README.md`, and `pnpm doctor` prints the live list. Every one
degrades honestly when absent.

## 5. Four things that catch people

**Press "Load Compose File" after choosing the compose build pack.** Coolify
does not read the file on its own. Until it has, it does not know `web` and
`service` exist — no per-service domain fields appear, the API refuses to set
one (*"Cannot set docker_compose_domains without docker_compose_raw"*), and a
deploy in that state comes up with no Traefik router at all. The site then
answers nothing, which reads like a crashed container rather than a missing
button. Nothing in `compose.prod.yaml` can warn you about this. Once the
fields appear, set a domain on `web` and leave `service` blank — it is
reached through `web` (§2), and a domain on it is a second way in that
nothing needs.

**Do not restate the environment in `compose.prod.yaml`.** Coolify writes the
application's runtime variables to a `.env` and loads it into every service in
the stack through `env_file`, so everything set in the UI already reaches both
containers. A compose `environment:` entry *overrides* `env_file` — which means
a well-meaning `SMTP_HOST: ${SMTP_HOST:-}` overwrites the delivered value with
an empty string. The file declares `SERVICE_URL` and nothing else, on purpose:
that is the one value the file must decide and the operator must not.

**Leave `SERVICE_URL` a runtime variable, not a build variable.** It is read in
server actions and route handlers, so a change needs a restart rather than a
rebuild. Ticking Coolify's *Build Variable?* bakes it into the image, and the
image then carries whatever the value was at build time to every environment it
is promoted to.

**One Dockerfile, two images.** The root `Dockerfile` builds both: no target
gives the web image on port 3000, `--target service` gives the service image on
port 3001. `compose.prod.yaml` names both, so one deploy builds them from one
commit — which matters, because the two halves share `packages/db` and the
`/internal` contract and were never meant to be a version apart. The web image
is the last stage in the file on purpose, so a build that names no target is
completely unchanged and never installs Chromium.

## 6. Checking it worked

```
pnpm --filter @qabandi/service verify:last-mile
```

Renders every document through the real Chromium, round-trips a file through
the configured storage, splits a master cost across two houses, and builds a
journal — against the real database, cancelling its fixtures afterwards. Run it
after `db:migrate` and `db:seed` on a new deployment, before the first real
shipment is loaded.

For the routing specifically, from outside, against the one domain:

```
curl -i https://app.example.com/internal/documents/invoice/whatever
curl -i -X POST https://app.example.com/webhooks/email -d '{}'
curl -i https://app.example.com/api/v1/jobs
```

The first is a `404` from the web app — there is no route, which is the
point. The second is a `401 bad_signature` and the third a `401 unauthorized`,
both *from the service*: proof the request crossed the private network and
the service answered. A `503 service_not_configured` on either means the web
container has no `SERVICE_URL`; a `502` means it has one and the service is
not listening there.

---

## 7. The public demo

A demo deployment is the same two containers with the database taken away and
one flag turned on. Nothing is forked and nothing is a special build: it is the
release image reading a different environment, which is the only arrangement
that keeps a demo honest about what the product does.

```
QABANDI_PILOT_FIXTURES=1
QABANDI_DEMO_LOGIN=1
QABANDI_DEMO_PASSWORD=…            # optional; unset it is `<brand key>-demo`
BETTER_AUTH_SECRET=…               # still required — it keys the persona cookie
BRAND=                             # leave unset: the default is CargoSharks
```

and, deliberately, **no `DATABASE_URL`**. `usePilotFixtures()` refuses to engage
when `NODE_ENV=production` *and* a connection string is present, so a demo that
is handed one silently stops being a demo and starts serving an empty database.
Leaving it out is what makes the flag mean anything.

`RUN_MIGRATIONS` and `MIGRATION_DATABASE_URL` must be unset. There is nothing to
migrate.

### What the visitor meets

Without `QABANDI_DEMO_LOGIN`, fixture mode short-circuits session resolution to
one internal principal and there is no sign-in screen at all — right for the
day-15 rehearsal, wrong for a public URL, where the sign-in screen is part of
what is being shown. With it, the visitor gets the product's own sign-in form
and three personas:

| | Lands on | Holds |
|---|---|---|
| `operations@<brand key>.example` | `/dashboard` | every permission key |
| `customer@gulfsteel.example` | `/portal` | no branch, no role, no permission |
| `agent@everbright.example` | `/agent` | no branch, no role, no permission |

The last two are not a simplification. A real customer or agent contact holds
exactly that — `roles` is seven *internal* roles and `create-user.ts` assigns
one only to staff — so the demo's portal login provably cannot open the
operations board, which is the claim the marketing site spends a section
making. Signing in as the customer and trying is the demonstration.

The password is printed on the sign-in screen, click-to-fill. A demo whose
credentials are not on the screen is a demo nobody enters.
`QABANDI_DEMO_PASSWORD` exists for the other case: a demo reachable only by
people who were told the password.

### What it is not

`timingSafeEqual` on the password and an HMAC on the persona cookie are there so
that a visitor cannot switch from the customer portal to the operations board by
editing a cookie — which would refute the tenancy claim on the very deployment
built to demonstrate it. That is the whole of the threat model. **It is a demo
gate, not a security boundary**, and it guards seeded fixtures with the password
written a few centimetres above the field. Nothing real is behind it, and
nothing real should ever be put behind it.

`QABANDI_DEMO_LOGIN` must never be set on a customer's deployment. It is
inert there — it cannot engage without `usePilotFixtures()`, which a configured
production database already refuses — but a flag that depends on another flag
for its safety is a flag to leave alone.

