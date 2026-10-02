import 'server-only'

/**
 * A record id from a URL — A17.
 *
 * Every detail route took `[id]` straight to a `where id = $1` against a uuid
 * column, so `/jobs/abc` reached PostgreSQL as a failed cast and came back as
 * a 500 — "Something went wrong" for a typo, and a stack trace in the log for
 * every crawler that probed a path. Anything that is not a uuid cannot be a
 * record, so it is not found, which is also the answer FR-ID-04 gives for a
 * record the caller may not see.
 *
 * The pilot fixtures key their records by readable ids (`job-1041`) and run
 * no query to fail, so the check stands aside for them.
 */

import { notFound } from 'next/navigation'
import { usePilotFixtures } from '@/lib/pilot/source'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/** Whether `id` could name a record on this deployment. */
export function isRecordId(id: string): boolean {
  return usePilotFixtures() || isUuid(id)
}

/** The id, or the not-found page. For pages and `generateMetadata`. */
export function recordId(id: string): string {
  if (!isRecordId(id)) notFound()
  return id
}
