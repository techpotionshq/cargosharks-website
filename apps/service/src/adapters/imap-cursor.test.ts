/**
 * The IMAP poll decides what is new by UID, not by `\Seen` (V11), and a
 * failing message cannot hold the batch (R5).
 *
 * `imapflow` is replaced by an in-memory mailbox, so the whole of `collect` —
 * search, fetch, flag, cursor — runs against messages this file controls. The
 * planner's arithmetic is pinned separately below, without a mailbox.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeMessage {
  uid: number
  seen: boolean
  source: string
}

const box = vi.hoisted(() => ({
  uidValidity: 1n,
  messages: [] as { uid: number; seen: boolean; source: string }[],
  fetched: [] as number[],
}))

vi.mock('imapflow', () => ({
  ImapFlow: class {
    mailbox: { uidValidity: bigint; uidNext: number } | false = false
    on() {}
    async connect() {}
    async getMailboxLock() {
      const next = Math.max(0, ...box.messages.map((m) => m.uid)) + 1
      this.mailbox = { uidValidity: box.uidValidity, uidNext: next }
      return { release() {} }
    }
    async search(query: { seen?: boolean; uid?: string }) {
      if (query.seen === false) return box.messages.filter((m) => !m.seen).map((m) => m.uid)
      const from = Number(query.uid!.split(':')[0])
      const found = box.messages.filter((m) => m.uid >= from).map((m) => m.uid)
      // A real server answers `N:*` with the highest UID even below N.
      return found.length > 0 ? found : box.messages.slice(-1).map((m) => m.uid)
    }
    async fetchOne(uid: string) {
      box.fetched.push(Number(uid))
      const m = box.messages.find((x) => x.uid === Number(uid))
      return m ? { source: Buffer.from(m.source) } : false
    }
    async messageFlagsAdd(uid: string) {
      const m = box.messages.find((x) => x.uid === Number(uid))
      if (m) m.seen = true
    }
    async messageMove() {}
    async logout() {}
    close() {}
  },
}))

const { imapSource, planBatch, pendingDue, advanceCursor } = await import('./imap')
type UidCursor = import('./imap').UidCursor

const mail = (uid: number, seen = false): FakeMessage => ({
  uid,
  seen,
  source:
    `Message-ID: <m${uid}@cursor.test>\r\nFrom: a@b.test\r\nTo: ops@q.test\r\n` +
    `Subject: Enquiry ${uid}\r\nDate: Mon, 28 Sep 2026 09:00:00 +0000\r\n\r\nBody ${uid}\r\n`,
})

/** A cursor kept in memory, as the mailbox row keeps it. */
function memoryCursor() {
  let stored: UidCursor | null = null
  return {
    get value() {
      return stored
    },
    store: {
      load: async () => stored,
      save: async (c: UidCursor) => {
        stored = c
      },
    },
  }
}

function source(cursor: ReturnType<typeof memoryCursor>, batch = 25) {
  return imapSource({
    host: 'imap.test',
    port: 993,
    secure: true,
    user: 'ops@q.test',
    password: 'x',
    folder: 'INBOX',
    batch,
    maxAttachmentBytes: 1024 * 1024,
    cursor: cursor.store,
  })
}

describe('the IMAP poll with a cursor', () => {
  beforeEach(() => {
    box.uidValidity = 1n
    box.messages = []
    box.fetched = []
  })

  it('files mail a person opened before the poll reached it', async () => {
    const cursor = memoryCursor()
    box.messages = [mail(1, true), mail(2)]
    const filed: string[] = []
    const handler = async (m: { externalId: string }) => {
      filed.push(m.externalId)
    }

    // First poll: no history, so the old rule once — unseen is owed, seen is history.
    await source(cursor).collect(handler)
    expect(filed).toEqual(['<m2@cursor.test>'])

    // Two arrive; a coordinator reads one of them before the next minute.
    box.messages.push(mail(3, true), mail(4))
    await source(cursor).collect(handler)

    expect(filed).toEqual(['<m2@cursor.test>', '<m3@cursor.test>', '<m4@cursor.test>'])

    // And nothing is filed twice on the poll after.
    await source(cursor).collect(handler)
    expect(filed).toHaveLength(3)
  })

  it('starts again from the unseen rule when UIDVALIDITY changes', async () => {
    const cursor = memoryCursor()
    box.messages = [mail(1)]
    await source(cursor).collect(async () => {})
    expect(cursor.value?.uidNext).toBe(2)

    box.uidValidity = 2n
    box.messages = [mail(1, true), mail(2)]
    const filed: string[] = []
    await source(cursor).collect(async (m) => {
      filed.push(m.externalId)
    })

    expect(filed).toEqual(['<m2@cursor.test>'])
    expect(cursor.value?.uidValidity).toBe('2')
  })

  /*
    R5: a batch's worth of messages that fail every time used to come back
    first on every poll, and nothing behind them was read.
  */
  it('reads new mail behind messages that keep failing', async () => {
    const cursor = memoryCursor()
    // Prime the cursor on an empty mailbox.
    await source(cursor, 4).collect(async () => {})

    box.messages = [mail(1), mail(2), mail(3), mail(4)]
    const failing = new Set([
      '<m1@cursor.test>',
      '<m2@cursor.test>',
      '<m3@cursor.test>',
      '<m4@cursor.test>',
    ])
    const handler = async (m: { externalId: string }) => {
      if (failing.has(m.externalId)) throw new Error('Object storage is not configured')
    }
    await expect(source(cursor, 4).collect(handler)).rejects.toThrow(/4 of 4/)
    expect(Object.keys(cursor.value!.pending).sort()).toEqual(['1', '2', '3', '4'])

    // New plain mail arrives; the four failures are waiting out their backoff.
    box.messages.push(mail(5), mail(6))
    const filed: string[] = []
    await source(cursor, 4).collect(async (m) => {
      await handler(m)
      filed.push(m.externalId)
    })

    expect(filed).toEqual(['<m5@cursor.test>', '<m6@cursor.test>'])
  })
})

describe('planBatch', () => {
  const NOW = new Date('2026-09-28T09:00:00Z')
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

  it('gives due retries at most half a batch while new mail waits', () => {
    const pending = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((uid) => [String(uid), { attempts: 1, failedAt: minutesAgo(5) }]),
    )
    const plan = planBatch([10, 11, 12, 13, 14, 15], pending, 4, NOW)
    expect(plan.retry).toHaveLength(2)
    expect(plan.fresh).toEqual([10, 11])
  })

  it('fills the batch from either side when the other is short', () => {
    const pending = { '1': { attempts: 0, failedAt: null }, '2': { attempts: 0, failedAt: null } }
    expect(planBatch([10], pending, 4, NOW)).toEqual({ fresh: [10], retry: [1, 2] })
    expect(planBatch([10, 11, 12, 13, 14], {}, 4, NOW)).toEqual({
      fresh: [10, 11, 12, 13],
      retry: [],
    })
  })

  it('leaves a failure alone until its wait is over', () => {
    expect(pendingDue({ attempts: 1, failedAt: minutesAgo(0.5) }, NOW)).toBe(false)
    expect(pendingDue({ attempts: 1, failedAt: minutesAgo(1) }, NOW)).toBe(true)
    expect(pendingDue({ attempts: 4, failedAt: minutesAgo(7) }, NOW)).toBe(false)
    expect(pendingDue({ attempts: 4, failedAt: minutesAgo(8) }, NOW)).toBe(true)
    // Capped at an hour however often it failed.
    expect(pendingDue({ attempts: 30, failedAt: minutesAgo(60) }, NOW)).toBe(true)
  })
})

describe('advanceCursor', () => {
  const NOW = new Date('2026-09-28T09:00:00Z')
  const start: UidCursor = {
    folder: 'INBOX',
    uidValidity: '1',
    uidNext: 10,
    pending: { '3': { attempts: 2, failedAt: '2026-09-28T08:00:00.000Z' } },
  }

  it('moves past the new mail taken and carries its failures', () => {
    const next = advanceCursor(
      start,
      [10, 11, 12],
      new Map([
        [3, 'filed'],
        [10, 'filed'],
        [11, 'failed'],
        [12, 'gone'],
      ] as const),
      NOW,
    )
    expect(next.uidNext).toBe(13)
    expect(next.pending).toEqual({ '11': { attempts: 1, failedAt: NOW.toISOString() } })
  })

  it('counts another failure of a pending message', () => {
    const next = advanceCursor(start, [], new Map([[3, 'failed']] as const), NOW)
    expect(next.uidNext).toBe(10)
    expect(next.pending['3']).toEqual({ attempts: 3, failedAt: NOW.toISOString() })
  })
})
