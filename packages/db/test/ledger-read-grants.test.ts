/**
 * Who reads the ledgers — QA P2-11.
 *
 * `/finance`, `/invoices`, `/payments`, `/payables` and `/settlements` asked
 * only for a session, so every internal role could open them. They now ask for
 * `receivable.read` or `payable.read`, and a key the seed grants to nobody is a
 * screen that silently vanishes for everyone — so the grants are asserted
 * against the seeded matrix, not assumed. Against the database the seed
 * actually wrote, which CI seeds before this suite runs.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDatabase, systemActor, withActor, type Database } from '../src/index'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)

describe.skipIf(!enabled)('ledger read grants', () => {
  let app: Database
  let grants: Map<string, Set<string>>

  beforeAll(async () => {
    app = createDatabase({ connectionString: APP_URL!, max: 1 })
    const rows = await withActor(
      systemActor(),
      (tx) =>
        tx.execute(sql`
          select r.key as role, rp.permission_key as permission
            from role_permissions rp join roles r on r.id = rp.role_id
           where rp.allowed and rp.permission_key in ('receivable.read', 'payable.read')
        `),
      app,
    )
    grants = new Map()
    for (const row of rows.rows as { role: string; permission: string }[]) {
      grants.set(row.role, (grants.get(row.role) ?? new Set()).add(row.permission))
    }
  })

  const holds = (role: string) => [...(grants.get(role) ?? [])].sort()

  it('gives both ledgers to finance, the operations manager and the administrator', () => {
    for (const role of ['finance', 'operations_manager', 'administrator']) {
      expect(holds(role)).toEqual(['payable.read', 'receivable.read'])
    }
  })

  it('gives the coordinator the payables register they capture bills into, and no more', () => {
    expect(holds('coordinator')).toEqual(['payable.read'])
  })

  it('gives neither ledger to read-only, sales or the customs broker', () => {
    for (const role of ['read_only', 'sales', 'customs_broker']) expect(holds(role)).toEqual([])
  })
})
