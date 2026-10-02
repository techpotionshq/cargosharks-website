/**
 * The administration reads — users, roles, branches, reference data, audit.
 *
 * Two of these carry more weight than their size suggests. `listUsers` and
 * `listBranches` describe *who may act where*, so a scoping mistake here shows
 * one operator another operator's staff list. And `listAudit` reads the one
 * table the product promises nobody can edit (FR-AD-01) — a register that
 * silently returns nothing would make that promise unfalsifiable.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { adminActor, bothBranchesActor, homeActor, world } = await import('@/lib/testing/fixtures')
const {
  listUsers,
  listRoles,
  listBranches,
  referenceCounts,
  listChargeTypes,
  listReferenceSample,
  listAudit,
  auditTableCounts,
  listCalendarOptions,
} = await import('./queries')

describe.skipIf(!enabled)('administration reads', () => {
  beforeAll(async () => {
    await world()
  })

  describe('people and places', () => {
    it('lists the fixture principal among the users', async () => {
      const emails = (await listUsers(bothBranchesActor)).map((u) => u.email)
      expect(emails).toContain('fixtures@qabandi.test')
    })

    /** The seeded matrix: seven roles, and the permission counts behind them. */
    it('lists the seeded roles', async () => {
      const rows = await listRoles(bothBranchesActor)
      const keys = rows.map((r) => r.key)
      expect(keys).toContain('administrator')
      expect(keys).toContain('finance')
      expect(rows.length).toBeGreaterThanOrEqual(7)
    })

    /**
     * Branches are configuration, not tenant data, and `branches_read` says so
     * with `using (true)`. Every internal principal can read the whole list —
     * which is what makes the branch picker work for someone being granted a
     * role in a branch they do not yet hold.
     *
     * Writing is the gated half (`admin.branches.write`), and 0016's trigger
     * narrows even that to the series counters for anyone else.
     */
    it('lists every branch, because branches are configuration', async () => {
      const codes = (await listBranches(homeActor)).map((b) => b.code)
      expect(codes).toContain('FXH')
      expect(codes).toContain('FXA')
    })

    it('offers a calendar to attach a branch to', async () => {
      const options = await listCalendarOptions(bothBranchesActor)
      expect(options.length).toBeGreaterThan(0)
      expect(options.every((o) => o.value && o.label)).toBe(true)
    })
  })

  describe('reference data — FR-AD-03', () => {
    /**
     * Configuration is rows, not code, and these screens are how an
     * administrator edits it without a release. A count that reads zero makes
     * the screen look empty rather than broken.
     */
    it('counts reference tables and finds them populated', async () => {
      const counts = await referenceCounts(bothBranchesActor)
      expect(counts.length).toBeGreaterThan(0)
      expect(counts.some((c) => Number(c.count) > 0)).toBe(true)
    })

    it('lists the seeded charge types', async () => {
      const types = await listChargeTypes(bothBranchesActor)
      expect(types.length).toBeGreaterThan(0)
    })

    it('samples reference rows for the screen', async () => {
      const sample = await listReferenceSample(bothBranchesActor)
      expect(sample).toBeDefined()
    })

    /*
      F27: an Arabic screen names the rows in Arabic. The same rows in the same
      order, only the name moves — and the seed gives every incoterm an Arabic
      name, so at least one must differ from its English one.
    */
    it('names the reference rows in the reader’s language', async () => {
      const en = await listReferenceSample(bothBranchesActor)
      const ar = await listReferenceSample(bothBranchesActor, 'ar')

      expect(ar.incoterms.map((row) => row.code)).toEqual(en.incoterms.map((row) => row.code))
      expect(ar.incoterms.some((row, index) => row.name !== en.incoterms[index]!.name)).toBe(true)
      expect(ar.incoterms.every((row) => row.name.length > 0)).toBe(true)
    })
  })

  describe('audit — FR-AD-01', () => {
    /**
     * Everything the fixtures did was audited by a trigger, so this must not
     * be empty: an audit register that reads zero is indistinguishable from an
     * audit trigger that never fired.
     */
    it('returns audit entries to an administrator', async () => {
      const rows = await listAudit(adminActor)
      expect(rows.length).toBeGreaterThan(0)
    })

    /**
     * The gate, from the other side. `audit_log_read` requires
     * `admin.audit.read` and only `administrator` holds it, so an operations
     * manager sees an empty register rather than a forbidden one.
     *
     * Both halves are needed: zero rows on its own cannot distinguish a policy
     * that is working from an audit trigger that never fired.
     */
    /*
      Slower than the default five seconds, and for a reason worth recording
      rather than hiding: proving the register is empty means scanning it. The
      denied case cannot stop early — `limit 150` never fills — so every row is
      tested, and each test calls `app.has_permission` and
      `app.support_sees_branch` afresh because Postgres re-evaluates a STABLE
      function per row inside an `OR`. At the ~69k rows this database has
      accumulated that is about 0.6s of function calls, and it grows with the
      table. Wrapping the row-independent halves of those policies in
      `(select …)` makes them InitPlans evaluated once, which measures 5.8×
      faster here — a change to every policy in `0004`/`0008` and so its own
      piece of work, not a line in a test.
    */
    it('shows nothing to a principal without admin.audit.read', { timeout: 30_000 }, async () => {
      expect(await listAudit(bothBranchesActor)).toEqual([])
    })

    it('filters the audit register by table', async () => {
      const counts = await auditTableCounts(adminActor)
      expect(counts.length).toBeGreaterThan(0)

      const table = counts[0]!.tableName
      const rows = await listAudit(adminActor, { table })
      expect(rows.every((r) => r.tableName === table)).toBe(true)
    })

    it('returns nothing for a table nobody has touched', async () => {
      expect(await listAudit(adminActor, { table: 'no_such_table' })).toEqual([])
    })

    /*
      The filters `FR-AD-02` asks for, checked against real rows.

      The free-text case is the one worth pinning: it searches three columns at
      once, so the risk is not that it finds too little but that a term meant
      for one column silently matches another and the reader draws a conclusion
      from a row that has nothing to do with their question.
    */
    it('narrows to one operation', async () => {
      const rows = await listAudit(adminActor, { op: 'INSERT' })
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.op === 'INSERT')).toBe(true)
    })

    it('finds an entry by its record id', async () => {
      const [sample] = await listAudit(adminActor, { limit: 1 })
      expect(sample).toBeDefined()

      const rows = await listAudit(adminActor, { q: sample!.rowId })
      expect(rows.some((r) => r.rowId === sample!.rowId)).toBe(true)
    })

    it('keeps the whole of the closing day rather than stopping at its midnight', async () => {
      const today = new Date().toISOString().slice(0, 10)
      const rows = await listAudit(adminActor, { from: today, to: today })

      // Everything the seed wrote happened today, so a `to` that compared
      // against midnight would return nothing at all here.
      expect(rows.length).toBeGreaterThan(0)
    })

    it('returns nothing for a period before anything was written', async () => {
      expect(await listAudit(adminActor, { from: '2000-01-01', to: '2000-01-02' })).toEqual([])
    })

    it('honours the row cap the export relies on', async () => {
      expect((await listAudit(adminActor, { limit: 3 })).length).toBeLessThanOrEqual(3)
    })
  })
})
