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

### The runner

The runner is a container on the Coolify server, from
[`infra/ci-runner/docker-compose.yml`](../infra/ci-runner/docker-compose.yml)
(image `myoung34/github-runner:ubuntu-noble`). Paste it into a Docker Compose
resource, add `ACCESS_TOKEN` as a secret, deploy. What the workflows depend
on, and so what not to change in that file without reading this:

- **Labels** `linux,x64,qabandi-ci`, plus `self-hosted`, which GitHub adds.
- **`network_mode: host`.** A job's Postgres is a service container the
  host's Docker daemon publishes on a random host port; the job reaches it at
  `127.0.0.1:<port>`, which from inside the runner container is only the host
  with host networking. The e2e web server picks a free host port the same
  way.
- **The Docker socket** (`/var/run/docker.sock`). Service containers,
  `docker build`, Semgrep and TruffleHog all run on the host's daemon. This is
  root on the host for whoever can change a workflow.
- **The work directory at the same path on both sides**
  (`/tmp/github-runner`, and `RUNNER_WORKDIR` set to it). Semgrep's
  `docker run -v "$PWD:/src"` and TruffleHog's `-v .:/tmp` are resolved by the
  host's daemon, so `$PWD` inside the runner has to name the same directory on
  the host. TruffleHog's relative `.` also needs Docker CLI 23 or newer in the
  image (Noble's is).
- **Root** (`RUN_AS_ROOT=true`). The e2e jobs pass `--with-deps` to
  `playwright install` when they run as root or on GitHub-hosted runners, and
  apt-get Chromium's libraries into the container; after the first job that is
  an `apt-get update` and nothing else. A non-root self-hosted runner skips
  it and needs `npx playwright@1.62.1 install-deps chromium` run once by an
  administrator. Files the jobs and Semgrep write are root-owned, which is
  consistent: root owns the workspace too.
- **A named volume for the tool cache** (`/opt/hostedtoolcache`), holding Node
  and Playwright's Chromium across redeploys. The pnpm store sits under the
  work directory (`XDG_DATA_HOME`), on the same filesystem as the
  workspaces, so installs hardlink.
- **Nothing else installed.** The image has git, bash, curl, tar and the
  Docker CLI. Node and pnpm are installed per job; there is no need for a
  Postgres client (provisioning uses the Node driver), `openssl`, `jq`,
  `ffmpeg` (only `pnpm guide:build` uses it) or `git-lfs` (no LFS objects).
- **Limits** of 4 CPUs and 8 GB on the runner container. They do not cover
  the sibling containers it starts (Postgres, image builds, Semgrep), so leave
  the host 2 cores and 4 GB above that.
- **Disk**: 60 GB free at the least, 100 GB comfortable. About 2 GB of pnpm
  store, 0.6 GB of Chromium per Playwright version, 3 GB of workspace, and
  Docker the rest: `postgres:18-alpine`, `semgrep/semgrep`, the TruffleHog
  image and the build cache of two runtime images. Turn on Coolify's weekly
  Docker cleanup for the server, or the cron line in the compose file.
- **Network**: github.com and `*.actions.githubusercontent.com`, the npm
  registry, nodejs.org, the Playwright CDN, Ubuntu's apt mirrors, Docker Hub,
  ghcr.io and semgrep.dev.

One container runs one job at a time, which is the intended setup. Jobs are
written to be safe side by side (random Postgres ports, a free web port, run
ids on images and containers), so a second runner is a second copy of the
service with another `RUNNER_NAME_PREFIX`.

Self-hosted runners execute whatever a pull request's workflow says. Keep the
repository private and leave "Require approval for all outside collaborators"
on for fork pull requests.

## What a change runs

The first job, `Change scope`, reads the pull request's diff
(`scripts/ci-scope.mjs`) and decides which jobs it can fail. Pushes to `main`
and `qabandi`, the manual button and the schedule run everything. A path the
rules do not recognise runs everything.

| The change touches | Format, lint | Types | Unit | Database | E2E offline | E2E seeded | Build |
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

A service-only change skips both end-to-end jobs because neither starts the
service (`.env.ci` explains why). The database job runs for core because the
coverage gate that measures core lives there.

`Guide staleness` runs only when a pull request touches `apps/web/`,
`packages/`, `docs/guide/`, `tools/guide/`, `scripts/q.mjs` or the lockfile.

In `security.yml`, the secret scan and Semgrep run on every pull request.
Dependency advisories, the runtime image scan and the SBOM run when a pull
request touches the lockfile, any `package.json`, `pnpm-workspace.yaml`,
`.npmrc` or the Dockerfile, and always on pushes and the Monday schedule.

## Required checks

Mark **`CI result`** as required. It always runs, passes when every needed job
passed or was skipped, and fails if one failed or was cancelled. Requiring the
individual jobs also works, since a skipped job reports success, but one check
does not need updating when a job is added. **`Security result`** is the
equivalent for `security.yml`, if supply-chain findings should block a merge.
Never require `Guide staleness (informational)`: it is filtered by path, and a
required check that never starts blocks the merge.
