/**
 * Assets — every stored file, behind the `FileStore` port (§10).
 *
 * The row is the record; the bytes live in object storage. Nothing in this
 * table names Supabase or S3, which is what makes the pilot-to-R1 move a
 * storage adapter rather than a migration (§3.1).
 */

import { bigint, index, jsonb, text } from 'drizzle-orm/pg-core'
import { pk, ref, timestamps, tsz } from './columns'
import { pgTable } from './table'

export const assets = pgTable(
  'assets',
  {
    id: pk(),
    /**
     * Scoping column for RLS. Deliberately not a Drizzle `.references()`: the
     * foreign key is added in `0003_constraints.sql` instead, because
     * `branches.letterhead_asset_id` points back here and one of the two
     * directions has to be declared outside the schema module to keep the
     * import graph acyclic.
     */
    branchId: ref('branch_id').notNull(),
    /** Opaque to the application — `<driver>:<bucket>/<key>`. */
    storageKey: text('storage_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    /** SHA-256, for de-duplication and integrity checks on restore drills. */
    checksum: text('checksum'),
    uploadedById: ref('uploaded_by_id'),
    /** Scanner verdict, EXIF, page count — whatever the pipeline learned. */
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    /** Files are never deleted; they are retired (§5.5). */
    retiredAt: tsz('retired_at'),
    ...timestamps,
  },
  (t) => [index('assets_branch_idx').on(t.branchId, t.createdAt)],
)
