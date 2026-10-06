# CI

Three workflows in `.github/workflows/`: `ci.yml` (does the code behave),
`security.yml` (is the supply chain clean) and `guide.yml` (which parts of the
user guide a change makes stale, informational only). This page is where they
run and why a pull request does not run all of them.

## Where it runs

Every job runs on a self-hosted runner, because the GitHub-hosted minutes ran
out. Each job picks its runner with the same expression:

```yaml
runs-on: ${{ vars.CI_RUNNER && fromJSON(vars.CI_RUNNER) || fromJSON('["self-hosted","linux","x64","qabandi-ci"]') }}
```

With the repository variable `CI_RUNNER` unset, jobs go to a runner carrying
all four labels. To move everything back to GitHub-hosted runners without a
commit, set `CI_RUNNER` under Settings, Secrets and variables, Actions,
Variables, to the JSON string `"ubuntu-latest"` (the quotes are part of the
value). A JSON array of labels also works. Delete the variable to return to
the self-hosted runner.

If no runner with those labels is online, jobs wait in the queue (for up to a
day) rather than fail. A run stuck at "Waiting for a runner" means the machine
is down, not that the code is wrong.

### The runners

Two runner containers on the Coolify server, from
[`infra/ci-runner/docker-compose.yml`](../infra/ci-runner/docker-compose.yml),
built from [`infra/ci-runner/Dockerfile`](../infra/ci-runner/Dockerfile): the
upstream `myoung34/github-runner` image, pinned to a dated release and digest,
plus Chromium's system libraries for the repository's Playwright version and
`fonts-noto-core` for Arabic. Nothing else is added.

To deploy, create a Coolify resource from this repository with the Docker
Compose build pack, base directory `/infra/ci-runner`, compose file
`/docker-compose.yml`. Add `GH_RUNNER_PAT` (the registration token) as a
secret environment variable. Turn automatic deployment off, or set a watch path
of `infra/ci-runner/**`: a redeploy restarts both runners and kills the jobs on
them.

What the workflows depend on, and so what not to change in that file without
reading this:

- **Labels** `linux,x64,qabandi-ci`, plus `self-hosted`, which GitHub adds.
- **`network_mode: host`.** A job's Postgres is a service container the
  host's Docker daemon publishes on a random host port; the job reaches it at
  `127.0.0.1:<port>`, which from inside the runner container is only the host
  with host networking. The e2e web server picks a free host port the same
  way, so two runners in one network namespace never collide.
- **The Docker socket** (`/var/run/docker.sock`). Service containers, image
  builds, Semgrep and TruffleHog all run on the host's daemon. This is root on
  the host for whoever can change a workflow.
- **One work directory per runner, at the same path on both sides**
  (`/tmp/github-runner-1`, `/tmp/github-runner-2`, and `RUNNER_WORKDIR` set to
  it). Semgrep's `docker run -v "$PWD:/src"` and TruffleHog's `-v .:/tmp` are
  resolved by the host's daemon, so `$PWD` inside the runner has to name the
  same directory on the host. Two runners never share one: a workspace is
  cleaned at the start of every job.
- **Root** (`RUN_AS_ROOT=true`). Files the jobs and Semgrep write are
  root-owned, which is consistent: root owns the workspace too. It also lets
  the e2e jobs fall back to `playwright install-deps` if the image ever lacks
  a library (below).
- **Chromium's libraries in the image, detected per job.**
  `.github/actions/playwright` runs `ldd` over the installed Chromium binaries
  and asks fontconfig for an Arabic face. When both are there it installs
  nothing; when not, it runs `playwright install-deps chromium` (root or
  GitHub-hosted) or warns (a non-root self-hosted runner, where an
  administrator runs `npx playwright@<version> install-deps chromium` once).
  Keep `PLAYWRIGHT_VERSION` in the Dockerfile near the lockfile's; drift costs
  an install, not a failure.
- **A tool-cache volume per runner** (`/opt/hostedtoolcache`), holding Node,
  Playwright's Chromium and the Next.js build cache across redeploys. Per
  runner because `setup-node` and Turbopack's cache are not safe for two
  writers.
- **`QABANDI_CI_CACHE`**, a directory inside that volume only its runner
  writes. `.github/actions/setup` links `apps/web/.next/cache` into it (one
  subdirectory per job kind), because `actions/checkout` deletes `.next` with
  the rest of the ignored files. Measured here: a web build takes about 50s
  cold and 8s warm. Unset, jobs build cold.
- **A pnpm store per runner** under its work directory (`XDG_DATA_HOME`), on
  the same mount as the workspaces so installs hardlink. A hardlink cannot
  cross mount points, which is why it is not one shared store.
- **Nothing else installed.** The image has git, bash, curl, tar and the
  Docker CLI with buildx. Node and pnpm are installed per job; there is no need
  for a Postgres client (provisioning uses the Node driver), `openssl`, `jq`,
  `ffmpeg` (only `pnpm guide:build` uses it) or `git-lfs` (no LFS objects).
- **Disk**: 60 GB free at the least, 100 GB comfortable. Per runner about 2 GB
  of pnpm store, 0.6 GB of Chromium per Playwright version, up to 1 GB of Next
  cache and 3 GB of workspace; then Docker: `postgres:18-alpine`,
  `semgrep/semgrep`, the TruffleHog image and the image builder's cache. Turn
  on Coolify's weekly Docker cleanup for the server and add the cron line in
  the compose file, which also prunes the builder.
- **Network**: github.com and `*.actions.githubusercontent.com`, the npm
  registry, nodejs.org, the Playwright CDN, Ubuntu's apt mirrors, Docker Hub,
  ghcr.io and semgrep.dev.

Self-hosted runners execute whatever a pull request's workflow says. Keep the
repository private and leave "Require approval for all outside collaborators"
on for fork pull requests.

### Sharing the machine

The server is 8 cores and 16 GB and also runs the demo apps and Coolify. CI is
held to about half of it, and gives way when the demos need the CPU:

| What | CPUs | Memory | CPU weight | Set in |
| --- | --- | --- | --- | --- |
| Each runner container (two) | 2 | 4 GB, no swap | 256 | compose file |
| Each job's Postgres | 1 | 2 GB (1 GB tmpfs data) | 256 | `ci.yml` service `options` |
| Semgrep | 2 | 3 GB | 256 | `security.yml` |
| Image builds (one BuildKit, both runners) | 2 | 4 GB | 256 | `security.yml` |
| TruffleHog | unlimited | unlimited | default | the action; one short process |

Docker's default CPU weight is 1024, so under contention a demo container gets
four times a CI container's share; on an idle machine the weight changes
nothing. Containers a job starts through the socket are siblings of the runner
on the host, outside its limits, which is why each gets its own.

Inside the jobs:

- **Two test workers.** `VITEST_MAX_WORKERS=2` in `ci.yml`, and Playwright's
  `workers: 2` under `CI`. Node reports the host's eight cores inside a
  two-CPU container, so the defaults would start seven workers and throttle.
- **A heap ceiling for builds**, `NODE_OPTIONS=--max-old-space-size=3072`,
  inside the runner's 4 GB.
- **Postgres without durability.** `POSTGRES_INITDB_ARGS` passes `initdb -c
  fsync=off -c synchronous_commit=off -c full_page_writes=off -c
  max_wal_size=256MB`, which Postgres 16 and later write into
  `postgresql.conf`. A service container cannot take a server command, and
  the other routes (overriding the entrypoint, or `docker run` in a step) lose
  the image's initialisation or the runner's health check, port read-back and
  cleanup. The data directory is a tmpfs, so nothing reaches the shared disk
  and no anonymous volume is left behind. A "Durability settings" step prints
  what the server is actually running with.
- **Image builds through a limited builder.** `docker build` runs on the host
  daemon's BuildKit, which takes no limits (`--cpus` and `--memory` belong to
  the legacy builder). The image job creates, or finds, a `docker-container`
  builder named `qabandi-ci` whose container is limited, and whose cache
  volume is the local layer cache between runs.

Expected time per job, against the last single-runner run (PR #33):

| Job | Before | After (warm caches) | Why |
| --- | --- | --- | --- |
| Change scope | 10s | 10s | unchanged |
| Checks (was Format, lint, types + Unit tests) | 1m + 2m | about 2m 30s | one checkout and install instead of two |
| Migrations, seed and RLS policies | 4m | about 3m | no fsync, tmpfs data |
| End-to-end (no database) | 5m | about 3m 30s | warm Next cache, no apt per run |
| End-to-end (seeded database) | 5m | about 3m 30s | the same, plus a faster seed |
| Production build | 1m | about 30s | warm Next cache |
| Security (all jobs) | about 3m | about 2m 30s | three jobs and three checkouts fewer |

CPU-bound steps are somewhat slower per job than before, because a runner now
has two CPUs where the single runner had four. The gain is in what no longer
happens (second installs, apt, cold builds) and in two jobs running at once
with no job waiting on another: a full pull request run was about 21 minutes
of one runner end to end, and should be about 10 minutes of wall clock on two.
A cold cache (the first run on a new runner, or after a Playwright bump) adds
about a minute to each e2e job.

## What a change runs

The first job, `Change scope`, reads the pull request's diff
(`scripts/ci-scope.mjs`) and decides which jobs it can fail. Pushes to `main`
and `qabandi`, the manual button and the schedule run everything. A path the
rules do not recognise runs everything.

| The change touches | Checks: format, lint | Checks: types | Checks: unit | Database | E2E offline | E2E seeded | Build |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Markdown anywhere, `docs/`, `.claude/` | yes | | | | | | |
| `scripts/`, `infra/ci-runner/`, hooks, lint and editor configuration | yes | | | | | | |
| `tools/guide/` | yes | yes | | | | | |
| `apps/landing/` (main only) | yes | yes | | | | | landing |
| `packages/core/` | yes | yes | yes | yes | | yes | |
| `packages/db/` | yes | yes | yes | yes | | yes | |
| `apps/service/` | yes | yes | yes | yes | | | all |
| `apps/web/`, `packages/brand/` | yes | yes | yes | yes | yes | yes | all |
| `Dockerfile`, `compose.*.yaml`, the rest of `infra/` | yes | | | | | | all |
| `.github/`, `scripts/ci-scope.mjs`, lockfile, root `package.json`, `.env.ci`, root configuration | yes | yes | yes | yes | yes | yes | all |

Format, lint, types and the unit suites are steps of one job, `Checks`, which
always runs; the scope decides which of its steps do. A step runs even when the
one before it failed, so a formatting slip does not hide a failing test. A
service-only change skips both end-to-end jobs because neither starts the
service (`.env.ci` explains why). The database job runs for core because the
coverage gate that measures core lives there. The two end-to-end jobs run side
by side; nothing orders them.

`Guide staleness` runs only when a pull request touches `apps/web/`,
`packages/`, `docs/guide/`, `tools/guide/`, `scripts/q.mjs` or the lockfile.

`security.yml` has two jobs:

| Job | Steps | Runs |
| --- | --- | --- |
| `Security checks` | dependency scope, secret scan (TruffleHog), static analysis (Semgrep) | every pull request |
| | bill of materials, dependency advisories | when the scope says dependencies changed |
| `Runtime image` | build both images, scan both with Trivy | when the scope says dependencies changed |

"Dependencies changed" means the pull request touches the lockfile, any
`package.json`, `pnpm-workspace.yaml`, `.npmrc`, the Dockerfile or
`.dockerignore`, `security.yml` or `.github/actions/`; pushes and the Monday
schedule always say yes. `Runtime image` waits for `Security checks` because
the scope is decided there, and runs even when a finding failed it.

## Required checks

Mark **`CI result`** as required. It always runs, passes when every needed job
passed or was skipped, and fails if one failed or was cancelled. Requiring the
individual jobs also works, since a skipped job reports success, but one check
does not need updating when a job is added. If `Format, lint, types`, `Unit
tests`, `Secret scan`, `Static analysis`, `Dependency scope`, `Dependency
advisories` or `Bill of materials` were ever marked required, remove them:
those jobs no longer exist (they are steps of `Checks` and `Security
checks`), and a required check that never reports blocks the merge. **`Security result`** is the
equivalent for `security.yml`, if supply-chain findings should block a merge.
Never require `Guide staleness (informational)`: it is filtered by path, and a
required check that never starts blocks the merge.
