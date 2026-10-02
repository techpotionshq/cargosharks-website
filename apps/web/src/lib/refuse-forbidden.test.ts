/**
 * A refused permission is a sentence on the form, never a 500 — QA P2-4.
 *
 * Two halves: the wrapper turns `ForbiddenError` into the catalogue's message
 * and leaves every other error loud, and every form action in a `'use server'`
 * file is wrapped. The second is read from the source, because the failure it
 * guards against is a new action written the old way, which no behavioural
 * test of an existing action would notice.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

const { refuseForbidden } = await import('./refuse-forbidden')
const { ForbiddenError } = await import('./permissions')

describe('refuseForbidden', () => {
  it('answers a refused permission with the form message', async () => {
    const action = refuseForbidden(async () => {
      throw new ForbiddenError('invoice.approve@branch:x')
    })
    await expect(action()).resolves.toEqual({ message: 'common.forbiddenAction' })
  })

  it('passes a result through untouched', async () => {
    const action = refuseForbidden(async (n: number) => ({ ok: `done:${n}` }))
    await expect(action(1)).resolves.toEqual({ ok: 'done:1' })
  })

  it('leaves any other failure loud', async () => {
    const action = refuseForbidden(async () => {
      throw new Error('constraint')
    })
    await expect(action()).rejects.toThrow('constraint')
  })
})

describe('every form action', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name) && !name.includes('.test.')) files.push(path)
    }
  }
  walk(join(__dirname, '..'))

  it('is wrapped, so a ForbiddenError cannot escape as a 500', () => {
    const unwrapped: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!/^\s*['"]use server['"]/m.test(source)) continue
      // A (state, FormData) => state export written as a bare declaration.
      for (const match of source.matchAll(
        /export async function (\w+)\(\s*\w+: (?:ActionState|CustomerFormState),\s*\w+: FormData/g,
      )) {
        unwrapped.push(`${file.slice(file.indexOf('src/'))}: ${match[1]}`)
      }
    }
    expect(unwrapped).toEqual([])
  })
})
