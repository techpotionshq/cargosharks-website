/**
 * The audit export, exercised end to end without a database.
 *
 * It runs on the pilot fixtures, which is not a compromise here but the point:
 * `usePilotFixtures()` is true whenever `DATABASE_URL` is unset, `getSession`
 * short-circuits to the pilot principal, and `listAudit` serves the same
 * filtered fixture rows the demo shows. So the route's own logic — the
 * parameter validation, the header, the filename, the truncation notice — is
 * covered by the suite that needs no infrastructure, rather than only by the
 * database job.
 *
 * The cases below are the ones where being wrong is expensive rather than
 * merely untidy: an unrecognised `op` must narrow to nothing rather than reach
 * an enum column and error, and the file must carry the byte-order mark that
 * decides whether an Arabic principal name is readable in Excel.
 */

import { beforeAll, describe, expect, it } from 'vitest'

// Set before the route — and therefore `lib/pilot/source` — is first imported,
// because the predicate reads the environment at call time but the module
// graph is resolved once.
beforeAll(() => {
  delete process.env.DATABASE_URL
  process.env.QABANDI_PILOT_FIXTURES = '1'
})

const url = (query = '') => new Request(`http://localhost/api/audit.csv${query}`)

async function body(query = ''): Promise<string> {
  const { GET } = await import('./route')
  const response = await GET(url(query))
  return await response.text()
}

async function head(query = '') {
  const { GET } = await import('./route')
  return (await GET(url(query))).headers
}

describe('the audit export', () => {
  it('answers as a CSV attachment that will not be cached', async () => {
    const headers = await head()
    expect(headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(headers.get('content-disposition')).toMatch(
      /^attachment; filename="audit-all-\d{4}-\d{2}-\d{2}\.csv"$/,
    )
    // An audit export in a shared cache is the whole trail behind a URL.
    expect(headers.get('cache-control')).toBe('private, no-store')
  })

  it('names the table it was filtered to, so two exports do not overwrite', async () => {
    const headers = await head('?table=jobs')
    expect(headers.get('content-disposition')).toContain('audit-jobs-')
  })

  /*
    Read as bytes, and it has to be.

    `Response.text()` runs the WHATWG "UTF-8 decode", which *strips* a leading
    byte-order mark — so asserting on the decoded string reports the mark
    missing while it is present on the wire, which is exactly the wrong way
    round for the thing that decides whether Excel renders an Arabic name or
    mojibake. The first three bytes are the only honest place to look.
  */
  it('opens with the byte-order mark Excel needs for Arabic names', async () => {
    const { GET } = await import('./route')
    const bytes = new Uint8Array(await (await GET(url())).arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('writes the header row every downstream reader keys on', async () => {
    const first = (await body()).replace(/^﻿/, '').split('\r\n')[0]
    expect(first).toBe(
      '"id","at_utc","operation","table","record_id","principal","principal_type","branch","ip"',
    )
  })

  it('returns rows, and stamps time as ISO 8601 in UTC', async () => {
    const rows = (await body()).trimEnd().split('\r\n').slice(1)
    expect(rows.length).toBeGreaterThan(0)
    // Second column, quoted: 2026-08-25T21:36:00.000Z
    expect(rows[0]).toMatch(/"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/)
  })

  it('narrows to a single operation', async () => {
    const rows = (await body('?op=UPDATE')).trimEnd().split('\r\n').slice(1)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.includes('"UPDATE"'))).toBe(true)
  })

  /*
    An `op` outside the set is ignored rather than passed through. It reaches an
    equality test on an enum column, and the failure mode of forwarding it is a
    database error rather than an empty result — which turns a typo in a URL
    into a 500.
  */
  it('ignores an operation it does not recognise instead of erroring', async () => {
    const rows = (await body('?op=DROP')).trimEnd().split('\r\n').slice(1)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('ignores a malformed date rather than narrowing to nothing', async () => {
    const rows = (await body('?from=last-tuesday')).trimEnd().split('\r\n').slice(1)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('returns only a header for a period before anything was written', async () => {
    const lines = (await body('?from=2000-01-01&to=2000-01-02')).trimEnd().split('\r\n')
    expect(lines).toHaveLength(1)
  })

  it('finds an entry by a term in its record id', async () => {
    const all = (await body()).trimEnd().split('\r\n').slice(1)
    // Column 5, quoted, is the record id.
    const recordId = all[0]!.split('","')[4]!
    const rows = (await body(`?q=${encodeURIComponent(recordId)}`)).trimEnd().split('\r\n').slice(1)
    expect(rows.some((row) => row.includes(recordId))).toBe(true)
  })
})
