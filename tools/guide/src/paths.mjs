// Where everything lives. Sources are in the repository; the cache and the
// built outputs are not, because a screenshot or a video segment is derived
// from sources that are, and committing derived binaries is how a repository
// grows by a gigabyte without anyone deciding it should.
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO = resolve(TOOL, '..', '..')
export const GUIDE = join(REPO, 'docs', 'guide')
export const WEB = join(REPO, 'apps', 'web')

/** Content-addressed store. Outside git; `GUIDE_CACHE` moves it (CI, a shared disk). */
export const CACHE =
  process.env.GUIDE_CACHE ??
  join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'qabandi-guide')

/** Built outputs (HTML, PDF, MP4, SRT). `out/` is already gitignored repository-wide. */
export const OUT = process.env.GUIDE_OUT ?? join(GUIDE, 'out')

/** Per-run scratch for the stack (pid files, logs, browser sessions). */
export const RUN = process.env.GUIDE_RUN ?? join(CACHE, 'run')

/**
 * Chromium. Playwright's own download when present, otherwise the system one.
 * `GUIDE_CHROMIUM` wins, because CI images put it somewhere else every year.
 */
export function chromiumPath() {
  if (process.env.GUIDE_CHROMIUM) return process.env.GUIDE_CHROMIUM
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean)
  for (const root of roots) {
    if (!existsSync(root)) continue
    const dirs = readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse()
    for (const d of dirs) {
      for (const exe of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        if (existsSync(join(root, d, exe))) return join(root, d, exe)
      }
    }
  }
  return undefined
}

/** Fonts the cards and captions are set in. Bundled fonts in ~/.fonts are used when present. */
export const FONT_DIR = process.env.GUIDE_FONTS ?? join(homedir(), '.fonts')
