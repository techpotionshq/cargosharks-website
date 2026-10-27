import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No whole email address in anything that becomes a page.
 *
 * `components/Email.tsx` keeps addresses out of the HTML so that harvesters and
 * Cloudflare's Email Obfuscation find nothing to work on. One literal address
 * in a page undoes that for every page it is on, and nobody notices: the site
 * looks the same. `public/.well-known/security.txt` is exempt on purpose: RFC
 * 9116 requires a machine-readable contact there.
 */

const landing = join(__dirname, '..')
const scanned = ['src', 'content']
const allowed = new Set(['src/components/Email.tsx'])
const ADDRESS = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i

function files(dir: string): string[] {
  // `content/` does not exist until the pipeline's first post is merged.
  if (!existsSync(join(landing, dir))) return []
  return readdirSync(join(landing, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(tsx?|mdx?|json)$/.test(entry.name))
    .map((entry) => relative(landing, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
}

describe('email addresses', () => {
  it('appear only through components/Email.tsx', () => {
    const offenders: string[] = []
    for (const file of scanned.flatMap(files)) {
      if (allowed.has(file)) continue
      readFileSync(join(landing, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // `mailto:` counts when an address or an expression follows it, not
          // as a word in prose. A quoted `'@scope/` is an npm import, not an
          // address.
          if (/mailto:[\w$`{]/.test(line) || (ADDRESS.test(line) && !/['"]@[\w-]+\//.test(line))) {
            offenders.push(`${file}:${i + 1}: ${line.trim()}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})
