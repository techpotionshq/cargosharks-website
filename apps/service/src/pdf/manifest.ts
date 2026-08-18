/**
 * The cargo manifest — every house under one master, on one page.
 *
 * The only document here that is not about a job. A manifest is the
 * consolidation's document: it is what the carrier, the destination agent and
 * the customs authority at the discharge port each need in order to know what
 * is on the master bill, and it is the artefact that makes a groupage
 * operation legible to everybody outside it.
 *
 * Which is why it takes its own view rather than the shared `JobDocumentView`.
 * A manifest read from twenty separate job queries can disagree with itself —
 * house eleven's weight totalled at a different moment from house twelve's —
 * and the document whose entire purpose is to reconcile is the last one that
 * should be assembled from twenty reads.
 *
 * The totals line is load-bearing. A manifest whose house weights do not sum
 * to the master bill's declared weight is the discrepancy that holds a
 * container at the port, so the total is computed here from the houses rather
 * than copied from the master.
 */

import {
  esc,
  field,
  formatDate,
  formatQuantity,
  localised,
  page,
  type DocumentLocale,
  type PlaceView,
} from './document-kit'

export interface ManifestHouseView {
  readonly houseBillNumber: string | null
  readonly jobReference: string
  readonly shipperName: string
  readonly consigneeName: string
  readonly notifyName: string | null
  readonly descriptionEn: string
  readonly descriptionAr: string | null
  readonly marksAndNumbers: string | null
  readonly packageCount: number | null
  readonly packageType: string | null
  readonly grossWeightKg: string | null
  readonly volumeCbm: string | null
  readonly containerNo: string | null
  readonly origin: string | null
  readonly destination: string | null
  readonly freightTerm: 'prepaid' | 'collect'
}

export interface ConsolidationDocumentView {
  readonly reference: string
  readonly masterBillNumber: string | null
  readonly bookingNumber: string | null
  readonly mode: string
  readonly carrierName: string | null
  readonly coloadPartnerName: string | null
  readonly vesselName: string | null
  readonly voyageNumber: string | null
  readonly flightNumber: string | null
  readonly origin: PlaceView | null
  readonly destination: PlaceView | null
  readonly etd: Date | null
  readonly eta: Date | null
  readonly branch: {
    readonly legalNameEn: string
    readonly legalNameAr: string
    readonly taxRegistration: string | null
  }
  readonly houses: readonly ManifestHouseView[]
  readonly issuedAt: Date
  readonly placeOfIssue: string
}

const STRINGS = {
  en: {
    title: 'Cargo Manifest',
    masterBill: 'Master B/L',
    booking: 'Booking',
    carrier: 'Carrier',
    coload: 'Co-loader',
    vessel: 'Vessel / Voyage',
    flight: 'Flight',
    load: 'Port of loading',
    discharge: 'Port of discharge',
    etd: 'ETD',
    eta: 'ETA',
    issued: 'Issued',
    houseBill: 'House B/L',
    shipper: 'Shipper',
    consignee: 'Consignee',
    description: 'Description',
    packages: 'Pkgs',
    gross: 'Gross (kg)',
    volume: 'Cbm',
    container: 'Container',
    freight: 'Frt',
    prepaid: 'PP',
    collect: 'CC',
    totals: 'Totals',
    houses: 'house bills',
    empty: 'No house bills are attached to this consolidation yet.',
  },
  ar: {
    title: 'بيان الحمولة',
    masterBill: 'البوليصة الرئيسية',
    booking: 'رقم الحجز',
    carrier: 'الناقل',
    coload: 'شريك التجميع',
    vessel: 'الباخرة / الرحلة',
    flight: 'رقم الرحلة',
    load: 'ميناء الشحن',
    discharge: 'ميناء التفريغ',
    etd: 'المغادرة المتوقعة',
    eta: 'الوصول المتوقع',
    issued: 'تاريخ الإصدار',
    houseBill: 'البوليصة الفرعية',
    shipper: 'الشاحن',
    consignee: 'المرسل إليه',
    description: 'الوصف',
    packages: 'الطرود',
    gross: 'الوزن (كجم)',
    volume: 'م٣',
    container: 'الحاوية',
    freight: 'الأجرة',
    prepaid: 'مقدماً',
    collect: 'عند الوصول',
    totals: 'الإجمالي',
    houses: 'بوليصة فرعية',
    empty: 'لا توجد بوالص فرعية مرتبطة بهذا التجميع بعد.',
  },
} as const

export function renderManifestHtml(
  view: ConsolidationDocumentView,
  locale: DocumentLocale,
): string {
  const t = STRINGS[locale]
  const air = view.mode === 'air'
  const entity = locale === 'ar' ? view.branch.legalNameAr : view.branch.legalNameEn

  const place = (p: PlaceView | null): string =>
    p ? esc(`${localised(p.nameEn, p.nameAr, locale)}${p.unlocode ? ` (${p.unlocode})` : ''}`) : '—'

  const totals = view.houses.reduce(
    (acc, h) => ({
      packages: acc.packages + (h.packageCount ?? 0),
      gross: acc.gross + Number(h.grossWeightKg ?? 0),
      volume: acc.volume + Number(h.volumeCbm ?? 0),
    }),
    { packages: 0, gross: 0, volume: 0 },
  )

  const rows = view.houses
    .map(
      (h) => `<tr>
    <td>${esc(h.houseBillNumber ?? h.jobReference)}</td>
    <td>${esc(h.shipperName)}</td>
    <td>${esc(h.consigneeName)}${h.notifyName ? `<br><span class="muted">${esc(h.notifyName)}</span>` : ''}</td>
    <td>${esc(localised(h.descriptionEn, h.descriptionAr, locale))}${h.marksAndNumbers ? `<br><span class="muted">${esc(h.marksAndNumbers.split('\n')[0] ?? '')}</span>` : ''}</td>
    <td class="n">${h.packageCount ?? '—'}${h.packageType ? `<br><span class="muted">${esc(h.packageType)}</span>` : ''}</td>
    <td class="n">${formatQuantity(h.grossWeightKg, locale)}</td>
    <td class="n">${formatQuantity(h.volumeCbm, locale)}</td>
    <td>${esc(h.containerNo ?? '—')}</td>
    <td class="n">${h.freightTerm === 'prepaid' ? t.prepaid : t.collect}</td>
  </tr>`,
    )
    .join('')

  return page(
    locale,
    `
<div class="head">
  <div>
    <h1>${esc(t.title)}</h1>
    <div class="muted">${esc(view.masterBillNumber ?? view.reference)} · ${view.houses.length} ${esc(t.houses)}</div>
  </div>
  <div class="entity">
    <strong>${esc(entity)}</strong>
    ${view.branch.taxRegistration ? `<div class="muted">${esc(view.branch.taxRegistration)}</div>` : ''}
  </div>
</div>

<div class="row">
  ${field(t.masterBill, esc(view.masterBillNumber ?? '—'))}
  ${field(t.booking, esc(view.bookingNumber ?? '—'))}
  ${field(t.carrier, esc(view.carrierName ?? '—'))}
  ${view.coloadPartnerName ? field(t.coload, esc(view.coloadPartnerName)) : ''}
  ${field(air ? t.flight : t.vessel, esc(air ? (view.flightNumber ?? '—') : [view.vesselName, view.voyageNumber].filter(Boolean).join(' / ') || '—'))}
</div>

<div class="row">
  ${field(t.load, place(view.origin))}
  ${field(t.discharge, place(view.destination))}
  ${field(t.etd, esc(formatDate(view.etd, locale)))}
  ${field(t.eta, esc(formatDate(view.eta, locale)))}
  ${field(t.issued, `${esc(view.placeOfIssue)} · ${esc(formatDate(view.issuedAt, locale))}`)}
</div>

${
  view.houses.length === 0
    ? `<p class="muted" style="margin-top:6mm">${esc(t.empty)}</p>`
    : `<table>
  <thead><tr>
    <th style="width:12%">${t.houseBill}</th>
    <th style="width:14%">${t.shipper}</th>
    <th style="width:16%">${t.consignee}</th>
    <th>${t.description}</th>
    <th class="n" style="width:8%">${t.packages}</th>
    <th class="n" style="width:10%">${t.gross}</th>
    <th class="n" style="width:7%">${t.volume}</th>
    <th style="width:12%">${t.container}</th>
    <th class="n" style="width:5%">${t.freight}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="4">${t.totals}</td>
    <td class="n">${totals.packages}</td>
    <td class="n">${formatQuantity(totals.gross.toFixed(3), locale)}</td>
    <td class="n">${formatQuantity(totals.volume.toFixed(3), locale)}</td>
    <td colspan="2"></td>
  </tr></tfoot>
</table>`
}
`,
    /* Landscape: nine columns of house data do not fit portrait, and a
       manifest that wraps is a manifest nobody reads at the counter. */
    `@page { size: A4 landscape; margin: 12mm; }`,
  )
}
