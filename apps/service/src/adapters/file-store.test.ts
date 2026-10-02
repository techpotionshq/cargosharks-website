/**
 * The memory driver is one store per process, not one per call (ai-3).
 *
 * `fileStore()` resolves the driver on every use, and the memory driver used
 * to build a fresh map each time — so a file uploaded by one request was
 * missing for the next, and "Read a bill" always failed with "no such key".
 */

import { describe, expect, it } from 'vitest'
import type { LiveIntegration } from '../settings'
import { resolveFileStore } from './file-store'

const memory: LiveIntegration = {
  key: 'fileStore',
  driver: 'memory',
  live: false,
  missing: [],
  fromRow: false,
  text: () => undefined,
  number: (_name, fallback) => fallback,
  bool: (_name, fallback) => fallback,
  secret: () => undefined,
}

describe('the memory file store', () => {
  it('finds, on a later resolution, what an earlier one stored', async () => {
    const stored = await resolveFileStore(memory).put(
      'bills/ai-3.pdf',
      Buffer.from('%PDF-1.7 ai-3'),
      'application/pdf',
    )

    const read = await resolveFileStore(memory).get(stored.storageKey)
    expect(read.toString()).toBe('%PDF-1.7 ai-3')
  })

  it('is the same store each time it is resolved', () => {
    expect(resolveFileStore(memory)).toBe(resolveFileStore(memory))
  })
})
