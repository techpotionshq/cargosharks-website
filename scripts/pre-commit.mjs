/**
 * Format what is about to be committed, before CI has to say so.
 *
 * `pnpm format:check` is the first step of the CI quality job, and the two
 * steps behind it — lint and typecheck — are skipped when it fails. So one
 * unformatted file does not cost a formatting error; it costs the entire
 * quality job, and the answer comes back four minutes later instead of at the
 * moment the file was written. That happened on this branch: 139 files had
 * drifted, and later a single one slipped through the same gap again because
 * it was patched by a script that did not re-run Prettier.
 *
 * This hook is the cheap half of that loop. `--no-verify` skips it, which is
 * correct: a hook that cannot be bypassed is a hook people delete.
 *
 * ## Why a partially staged file is refused rather than fixed
 *
 * Prettier reads the working tree, not the index. When a file has both staged
 * and unstaged changes those are different contents, so formatting it and
 * running `git add` would sweep the unstaged half into the commit — work the
 * author deliberately held back, committed silently under a message about
 * something else. That is a worse outcome than a failed commit, so those files
 * are named and the commit stops.
 */

import { execFileSync } from 'node:child_process'

const git = (args) => execFileSync('git', args, { encoding: 'utf8' })

/** `-z` because a path may contain a space, and one day one will. */
function gitPaths(args) {
  return git(args).split('\0').filter(Boolean)
}

const staged = gitPaths(['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'])
if (staged.length === 0) process.exit(0)

// Files carrying unstaged changes as well as staged ones.
const dirty = new Set(gitPaths(['diff', '--name-only', '-z']))

let unformatted = []
try {
  // `--list-different` prints the files that would change and exits 1 when
  // there are any. `--ignore-unknown` skips extensions Prettier has no parser
  // for, so the whole staged set can be passed without filtering by hand, and
  // `.prettierignore` is applied for free.
  execFileSync('pnpm', ['exec', 'prettier', '--ignore-unknown', '--list-different', ...staged], {
    encoding: 'utf8',
  })
} catch (error) {
  unformatted = String(error.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

if (unformatted.length === 0) process.exit(0)

const blocked = unformatted.filter((file) => dirty.has(file))
const fixable = unformatted.filter((file) => !dirty.has(file))

if (fixable.length > 0) {
  execFileSync('pnpm', ['exec', 'prettier', '--ignore-unknown', '--write', ...fixable], {
    stdio: 'ignore',
  })
  git(['add', '--', ...fixable])
  console.error(`formatted and re-staged ${fixable.length} file(s):`)
  for (const file of fixable) console.error(`  ${file}`)
}

if (blocked.length > 0) {
  console.error('')
  console.error('Refusing to commit — these need formatting but also carry unstaged changes:')
  for (const file of blocked) console.error(`  ${file}`)
  console.error('')
  console.error('Formatting them would stage the unstaged half too. Stage or stash it first:')
  console.error(`  pnpm exec prettier --write ${blocked.join(' ')}`)
  process.exit(1)
}
