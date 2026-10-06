/**
 * Which CI jobs a change needs: the first job of `.github/workflows/ci.yml`.
 *
 * CI runs on two small self-hosted runners on a machine shared with the demos
 * (docs/CI.md), so every job a change cannot break is a job queued in front of
 * one that can. `typecheck` and `unit` are steps of the one `Checks` job rather
 * than jobs of their own; they are still decided here. This maps the paths
 * a pull request touches to the jobs that could fail because of them, and
 * says so in the run summary so a skipped job is never a mystery.
 *
 * Path rules rather than `pnpm q impact`: the jobs are whole packages wide (a
 * unit job runs every unit suite, an e2e job every screen), so the import
 * graph would only refine an answer that is already decided at the package
 * boundary. Path rules also need no `pnpm install`, which keeps this job at a
 * checkout and a node process.
 *
 * The bias is deliberate and one-directional. A path nothing below recognises
 * runs everything, a push runs everything, and a diff this script cannot read
 * runs everything. Running too much costs minutes; running too little ships a
 * broken migration.
 *
 *   node scripts/ci-scope.mjs                      # in CI: reads the event and the diff
 *   node scripts/ci-scope.mjs --range A B          # a dry walk over any two commits
 *   node scripts/ci-scope.mjs --files a.ts b.md    # or over a list of paths
 *
 * Dependency-free on purpose: it runs before anything is installed.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const JOBS = ['typecheck', 'unit', 'database', 'e2e_offline', 'e2e_full', 'build']

const everything = { typecheck: 1, unit: 1, database: 1, e2e_offline: 1, e2e_full: 1, build: 'all' }
// Format and lint always run, so "lint only" is the empty set.
const lintOnly = {}

/*
  The first matching rule wins, so the specific ones come first. Each names
  the jobs a change under it can fail, and why, because the why is what the
  next person editing this table needs.
*/
const RULES = [
  // What the pipeline is made of. A change here can break any job, including
  // this one, so nothing is pruned.
  [/^\.github\//, everything, 'workflows'],
  [/^scripts\/ci-scope\.mjs$/, everything, 'the pruning rules themselves'],
  [
    /^(pnpm-lock\.yaml|pnpm-workspace\.yaml|package\.json|\.npmrc|\.env\.ci|tsconfig\.base\.json|vitest\.config\.ts)$/,
    everything,
    'dependencies or root configuration',
  ],

  // Words. Prettier and the link check are the only things that read them.
  // docs/guide holds the shorts' scripts as `.mjs`, which oxlint covers; the
  // Guide workflow reports what they make stale.
  [/\.md$/i, lintOnly, 'markdown'],
  [/^docs\//, lintOnly, 'docs'],
  [/^\.claude\//, lintOnly, 'agent notes'],

  // The guide pipeline is tooling: never deployed, never imported by an app.
  [/^tools\/guide\//, { typecheck: 1 }, 'guide tooling'],

  // CargoSharks' marketing site (main only). Imports `brand` and nothing else.
  [/^apps\/landing\//, { typecheck: 1, build: 'landing' }, 'landing site'],

  // The engines and the schema. Core is where money is calculated, so the
  // seeded end-to-end run (real rows, real three-decimal amounts) runs too,
  // and the database job because the coverage gate measures core there. The
  // offline run renders fixtures, which a core change cannot alter.
  [/^packages\/core\//, { typecheck: 1, unit: 1, database: 1, e2e_full: 1 }, 'domain engines'],
  [
    /^packages\/db\//,
    { typecheck: 1, unit: 1, database: 1, e2e_full: 1 },
    'schema, migrations, seed',
  ],

  // Brand tokens reach every screen, the PDFs and the landing site.
  [/^packages\/brand\//, everything, 'brand'],

  [/^apps\/web\//, everything, 'web app'],

  // No CI job starts the service for the e2e suites (`.env.ci` explains why:
  // the assistant's "not configured" answer is what they assert), so a
  // service-only change cannot move an e2e result.
  [/^apps\/service\//, { typecheck: 1, unit: 1, database: 1, build: 'all' }, 'service'],

  // The runner's own compose file (docs/CI.md). It is deployed by hand on
  // Coolify, not built or shipped by anything CI checks.
  [/^infra\/ci-runner\//, lintOnly, 'CI runner deployment'],

  // What ships. The runtime image is scanned by security.yml on the same paths.
  [/^(Dockerfile|\.dockerignore|compose\.[\w.-]+\.ya?ml|infra\/)/, { build: 'all' }, 'deployment'],

  // Repository checks and hooks are exactly what `pnpm lint` runs.
  [/^scripts\//, lintOnly, 'repository scripts'],
  [
    /^(\.githooks\/|\.gitignore$|\.gitattributes$|\.prettierignore$|\.prettierrc\.json$|\.oxlintrc\.json$|\.env\.example$|fleet\.example\.json$)/,
    lintOnly,
    'lint and editor configuration',
  ],
]

function classify(file) {
  for (const [pattern, jobs, why] of RULES) if (pattern.test(file)) return { jobs, why }
  return { jobs: everything, why: 'unrecognised path, so everything' }
}

/** The union of what every file needs. `build: 'all'` outranks `'landing'`. */
function scope(files) {
  const result = Object.fromEntries(JOBS.map((j) => [j, j === 'build' ? 'none' : false]))
  for (const file of files) {
    const { jobs } = classify(file)
    for (const job of JOBS) {
      if (!jobs[job]) continue
      if (job === 'build') result.build = result.build === 'all' ? 'all' : jobs.build
      else result[job] = true
    }
  }
  return result
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/*
  `--no-renames` so a move reports both ends: deleting a web file can break
  web as surely as editing one.
*/
const diff = (a, b) => git(['diff', '--name-only', '--no-renames', a, b])

function decide(argv) {
  if (argv[0] === '--files') return { files: argv.slice(1), why: 'paths given' }
  if (argv[0] === '--range') return { files: diff(argv[1], argv[2]), why: `${argv[1]}..${argv[2]}` }

  const event = process.env.GITHUB_EVENT_NAME
  // A push to qabandi or main is the merged result, and the schedule and the
  // manual button are asking for the whole answer.
  if (event !== 'pull_request') return { files: null, why: `${event ?? 'local'} runs everything` }

  /*
    A pull request checks out `refs/pull/N/merge`, whose first parent is the
    tip of the base branch. So `HEAD^1..HEAD` is exactly what merging would
    change, with no merge-base arithmetic and only two commits of history.
  */
  try {
    return { files: diff('HEAD^1', 'HEAD'), why: 'pull request: HEAD^1..HEAD' }
  } catch (error) {
    return { files: null, why: `could not read the diff (${String(error.message).split('\n')[0]})` }
  }
}

function main() {
  const { files, why } = decide(process.argv.slice(2))
  const result = files === null ? { ...everything } : scope(files)
  for (const job of JOBS) if (job !== 'build') result[job] = Boolean(result[job])

  const lines = JOBS.map((j) => `${j}=${result[j]}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)

  const table = files === null ? [] : files.map((f) => `| \`${f}\` | ${classify(f).why} |`)
  const summary = [
    '## What this change runs',
    '',
    `Decided from: ${why}.`,
    '',
    '| Job | Runs |',
    '| --- | --- |',
    `| Format, lint | always |`,
    ...JOBS.map(
      (j) => `| ${j} | ${result[j] === false || result[j] === 'none' ? 'skipped' : result[j]} |`,
    ),
    '',
    ...(table.length
      ? [
          '<details><summary>Files and the rule each matched</summary>',
          '',
          '| File | Rule |',
          '| --- | --- |',
          ...table,
          '',
          '</details>',
        ]
      : []),
  ].join('\n')
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)

  console.log(`${why}${files ? `, ${files.length} file(s)` : ''}`)
  console.log(lines.join('\n'))
}

main()
