/**
 * The note a job-billed invoice carries, stored once and read in any language.
 *
 * Drafting from a job used to write "Billed from KWI-JOB-..." as plain text in
 * the drafting user's language, so the Arabic PDF of an invoice drafted by an
 * English-speaking colleague printed English, and the other way round (NEW-6).
 * The note is now stored in one fixed form and recognised on the way out, so
 * every renderer (the invoice page, the PDF) says it in its own language. A
 * note a person typed or edited is free text and shown as typed.
 *
 * Both stored forms are recognised, the fixed English one and the Arabic one
 * earlier drafts wrote, so invoices drafted before this read correctly too.
 */

/** What an invoice's note is: the job it was billed from, or text a person wrote. */
export type InvoiceNote =
  | { readonly kind: 'billedFrom'; readonly reference: string }
  | { readonly kind: 'text'; readonly text: string }

const BILLED_FROM = /^\s*(?:Billed from|مفوترة من)\s+([A-Za-z0-9][A-Za-z0-9-]{2,40})\s*$/u

/** The note to store on an invoice drafted from a job. Not shown as is; see `readInvoiceNote`. */
export function billedFromNote(reference: string): string {
  return `Billed from ${reference}`
}

/** An invoice's stored note, read for rendering. Null when there is none. */
export function readInvoiceNote(notes: string | null | undefined): InvoiceNote | null {
  if (!notes?.trim()) return null
  const match = BILLED_FROM.exec(notes)
  return match ? { kind: 'billedFrom', reference: match[1]! } : { kind: 'text', text: notes }
}
