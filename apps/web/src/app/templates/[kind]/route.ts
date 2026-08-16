/**
 * The published import template — `FR-MD-11`.
 *
 * Generated from the descriptor on every request rather than kept as a file in
 * `public/`. A field added to the importer would otherwise be missing from the
 * template people download, and they would find out one validation report at a
 * time.
 *
 * Behind the session for the same reason every other route is: the column set
 * describes the operator's data model, and there is no reason for it to be
 * public. The permission checked is the one that would let the caller perform
 * the import itself — a read-only account has no use for a template it cannot
 * submit.
 *
 * A BOM is prepended deliberately. Without it, Excel on Windows opens a UTF-8
 * CSV as Windows-1252 and renders every Arabic column heading as mojibake,
 * which reads to the operator as "the file is broken" rather than "the
 * encoding was guessed".
 */

import { NextResponse } from 'next/server'
import { templateCsv } from '@qabandi/core/import'
import { getSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { importKind, isImportKind } from '@/features/imports/descriptors'

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { kind } = await params
  if (!isImportKind(kind)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const entry = importKind(kind)!
  if (!can(session, entry.permission)) {
    // Not-found rather than forbidden, consistent with FR-ID-04: a caller
    // learns nothing about what exists from what they may not have.
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return new NextResponse(`﻿${templateCsv(entry.descriptor)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="qabandi-${kind}-template.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
