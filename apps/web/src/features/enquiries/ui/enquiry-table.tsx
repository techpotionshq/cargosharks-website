/**
 * The enquiry list.
 *
 * A server component: it renders from data the page already has and ships no
 * JavaScript for the table itself. There is no client-side state manager in
 * this application and none is planned (§1) — the server holds the state, and
 * a Server Action mutation revalidates the path.
 */

import { getFormatter, getTranslations } from 'next-intl/server'

export interface EnquiryRow {
  id: string
  reference: string
  status: string
  mode: string | null
  createdAt: Date
  slaDueAt: Date | null
  firstRespondedAt: Date | null
  customerName: string | null
  customerNameAr: string | null
  ownerName: string | null
  originName: string | null
  destinationName: string | null
}

export async function EnquiryTable({ rows, locale }: { rows: EnquiryRow[]; locale: 'en' | 'ar' }) {
  const t = await getTranslations('enquiry')
  const tMode = await getTranslations('mode')
  const format = await getFormatter()
  const now = Date.now()

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--ink-muted)]">{t('empty')}</p>
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        {/* `text-start`, never `text-left`: the header aligns to the inline
            start, which is the right-hand side in Arabic. */}
        <tr className="border-b border-[var(--line)] text-start text-[var(--ink-muted)]">
          <th className="py-2 text-start font-medium">{t('reference')}</th>
          <th className="py-2 text-start font-medium">{t('customer')}</th>
          <th className="py-2 text-start font-medium">{t('lane')}</th>
          <th className="py-2 text-start font-medium">{t('mode')}</th>
          <th className="py-2 text-start font-medium">{t('owner')}</th>
          <th className="py-2 text-start font-medium">{t('status')}</th>
          <th className="py-2 text-start font-medium">{t('slaDue')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const breached =
            row.firstRespondedAt === null && row.slaDueAt !== null && row.slaDueAt.getTime() < now

          return (
            <tr key={row.id} className="border-b border-[var(--line)]">
              <td className="numeric py-2">
                <a className="text-[var(--color-brand-500)] hover:underline" href={`/enquiries/${row.id}`}>
                  {row.reference}
                </a>
              </td>
              {/* Both name columns exist on every entity a document renders
                  (§11); the Arabic one is preferred when the user reads Arabic. */}
              <td className="py-2">
                {(locale === 'ar' ? row.customerNameAr : null) ?? row.customerName ?? '—'}
              </td>
              <td className="py-2">
                {row.originName ?? '—'} → {row.destinationName ?? '—'}
              </td>
              <td className="py-2">{row.mode ? tMode(row.mode as 'air') : '—'}</td>
              <td className="py-2">{row.ownerName ?? '—'}</td>
              <td className="py-2">{t(`statuses.${row.status}` as 'statuses.new')}</td>
              <td className="numeric py-2">
                {row.slaDueAt ? (
                  <span className={breached ? 'text-[var(--color-status-breached)]' : undefined}>
                    {format.dateTime(row.slaDueAt, 'withTime')}
                    {breached ? ` · ${t('overdue')}` : ''}
                  </span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
