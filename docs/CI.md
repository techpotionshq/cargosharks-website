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

### What the runner needs

- **Labels**: `self-hosted`, `linux`, `x64` (added automatically on
  registration) and `qabandi-ci` (add it when registering, or later in the
  repository's runner settings).
- **Runs on the host, as a non-root user in the `docker` group**, with Docker
  Engine reachable on `/var/run/docker.sock`. Service containers (Postgres 18
  for the database and seeded end-to-end jobs), the secret scan, Semgrep and
  the image build all use it. Not inside a container: service ports are
  published on the host's `127.0.0.1`.
- **Installed once**: `git` 2.18 or newer, `bash`, `curl`, `tar`, `gzip`,
  `grep`, and Chromium's system libraries for Playwright. The last are
  `sudo npx playwright@1.62.1 install-deps chromium` (match the version in
  `pnpm-lock.yaml` after a Playwright bump). GitHub-hosted runners get these
  through `--with-deps`; the self-hosted machine should not grant `sudo` to
  jobs.
- **Not needed**: Node (installed per job by `actions/setup-node` into the
  tool cache), pnpm (per job, into the job's temp directory), a Postgres
  client (provisioning connects through the Node driver), `openssl`, `jq`,
  `ffmpeg` (only `pnpm guide:build` uses it, never CI) or `git-lfs` (no LFS
  objects).
- **Disk**: 60 GB free at the least, 100 GB comfortable. The pnpm store is
  around 2 GB, Playwright's Chromium about 0.6 GB per version under the tool
  cache, each runner's workspace 3 GB with `node_modules` and `.next`, and
  Docker the rest: `postgres:18-alpine`, `semgrep/semgrep`, the TruffleHog
  image and the build cache of two runtime images. Prune Docker weekly from
  cron, for example `docker system prune -af --filter until=168h`.
- **CPU and memory**: 4 to 8 cores, 16 GB. One runner instance is the
  recommended setup. Jobs are written to be safe side by side (Postgres gets a
  host port Docker picks, the web server a free port, images and containers
  carry the run id), so a second instance on an 8-core machine is safe, but a
  production build, Chromium and Postgres at once on 4 cores is slower than
  one after another.
- **Network**: github.com and `*.actions.githubusercontent.com`, the npm
  registry, nodejs.org, the Playwright CDN, Docker Hub, ghcr.io and semgrep.dev.

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
| `scripts/`, hooks, lint and editor configuration | yes | | | | | | |
| `tools/guide/` | yes | yes | | | | | |
| `apps/landing/` (main only) | yes | yes | | | | | landing |
| `packages/core/` | yes | yes | yes | yes | | yes | |
| `packages/db/` | yes | yes | yes | yes | | yes | |
| `apps/service/` | yes | yes | yes | yes | | | all |
| `apps/web/`, `packages/brand/` | yes | yes | yes | yes | yes | yes | all |
| `Dockerfile`, `compose.*.yaml`, `infra/` | yes | | | | | | all |
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
