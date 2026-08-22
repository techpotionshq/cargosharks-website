# Deploying to Coolify — two containers, one private network

**Operations note · v1.0 · Internal**

| | |
|---|---|
| **Question answered** | The product is two containers that talk to each other. What does that look like on Coolify, and what must never be exposed? |
| **Applies to** | `Dockerfile` (two build targets) and `compose.deploy.yml` |
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

## 2. But the service does need a domain

It serves four prefixes and they do not have the same audience:

| Prefix | Audience | Public? |
|---|---|---|
| `/webhooks` | carrier and provider callbacks | **yes, required** |
| `/api/v1` | the public read and tracking API | yes |
| `/health` | the platform's health check | yes |
| `/internal` | the web container, and nothing else | **never** |

So "just don't expose the service" is not available. Give it a domain, keep
`SERVICE_URL` internal, and make sure `/internal` cannot be reached through it.

Two controls, and you want both:

1. **In the code, by default.** The service refuses any `/internal` request
   carrying proxy forwarding headers (`X-Forwarded-For`, `X-Forwarded-Host`,
   `X-Forwarded-Proto`, `Forwarded`) with a 404. A call from the web container
   over the Docker network carries none of them; one through Traefik always
   carries at least one. This needs no configuration and fails closed.
2. **At the proxy, if you want defence in depth.** A Traefik middleware
   blocking the path prefix. Coolify's label generation has a history of sharp
   edges here, so check the router rule actually took effect rather than
   assuming it did.

`INTERNAL_API_TRUST_PROXY=true` disables the first control. It exists for a
deployment where something on the *private* network legitimately adds
forwarding headers — a service mesh, a sidecar. It is not a way to make a
public route work.

## 3. One stack, not two applications

Deploy both containers from `compose.deploy.yml` — build pack **Docker
Compose**, compose location `/compose.deploy.yml`. Coolify puts the stack on
one bridge network and Docker DNS resolves a service by the name it carries in
that file, so `SERVICE_URL=http://service:3001` is true by construction rather
than by a setting somebody has to remember. The shared secret is also declared
once: two applications means `INTERNAL_API_SECRET` typed into two places, and
the failure when those drift is a 401 the web app reports to an operator as
"the document could not be generated".

That file is deliberately not `docker-compose.yml`, which is the local
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
```

Do **not** add `SERVICE_URL` or `QABANDI_PILOT_FIXTURES` on a compose stack.
The first is hard-coded in `compose.deploy.yml` so it cannot be pointed at a
public domain from the UI (§1); the second is `ENV`-set in the Dockerfile's web
stage. Both are settings that should not be one checkbox away from wrong.

Set `RUN_MIGRATIONS=true` and `MIGRATION_DATABASE_URL` on **one** deployment
only, and leave both unset everywhere else. The entrypoint explains why: the
migrator owns every object and can drop a policy, which is not a credential an
ordinary restart should hold.

### Service

```
DATABASE_URL=postgres://app_user:…@db-host:5432/qabandi
INTERNAL_API_SECRET=…                    # identical to the web app's
WEB_URL=https://app.example.com          # this is the CORS origin
FILE_STORE_DRIVER=s3
S3_ENDPOINT=… S3_REGION=… S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=…
```

`CHROMIUM_EXECUTABLE_PATH` is already set in the image, so PDF rendering works
with no configuration. The storage credentials are the **service's alone** —
the web app never signs anything, it asks for a link.

Add `SMTP_*` for notifications, `FX_*` for the rate feed, and
`CARRIER_TRACKING_*` when a tracking feed is bought. All have defaults that
degrade honestly.

## 5. Four things that catch people

**Press "Load Compose File" after choosing the compose build pack.** Coolify
does not read the file on its own. Until it has, it does not know `web` and
`service` exist — no per-service domain fields appear, the API refuses to set
one (*"Cannot set docker_compose_domains without docker_compose_raw"*), and a
deploy in that state comes up with no Traefik router at all. The site then
answers nothing, which reads like a crashed container rather than a missing
button. Nothing in `compose.deploy.yml` can warn you about this.

**Do not restate the environment in `compose.deploy.yml`.** Coolify writes the
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
port 3001. `compose.deploy.yml` names both, so one deploy builds them from one
commit — which matters, because the two halves share `packages/db` and the
`/internal` contract and were never meant to be a version apart. The web image
is the last stage in the file on purpose, so a build that names no target is
completely unchanged and never installs Chromium.

`infra/Dockerfile.service` still exists and builds the same thing standalone.
Prefer the root file — two Dockerfiles that must agree are two Dockerfiles that
eventually do not.

## 6. Checking it worked

```
pnpm --filter @qabandi/service verify:last-mile
```

Renders every document through the real Chromium, round-trips a file through
the configured storage, splits a master cost across two houses, and builds a
journal — against the real database, cancelling its fixtures afterwards. Run it
after `db:migrate` and `db:seed` on a new deployment, before the first real
shipment is loaded.

For the proxy control specifically, from outside:

```
curl -i https://svc.example.com/internal/documents/invoice/whatever
```

A `404` is the guard working. Anything else — a `401`, a `400`, a hang — means
the request reached the prefix without forwarding headers, and the deployment
needs looking at before it carries a customer's data.
