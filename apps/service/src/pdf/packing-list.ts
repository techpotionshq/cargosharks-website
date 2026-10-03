/**
 * The packing list — what is in each package, and where each package is.
 *
 * The customs officer's document and the warehouse's document at once. It
 * differs from the bill of lading in exactly one respect that matters: the
 * bill states what the shipper *declared*, and this states what was *packed*,
 * which is why net weight appears here and nowhere else. Duty is assessed on
 * value, but an inspection is settled by weighing the carton.
 *
 * Grouped by container where the cargo lines say which container they are in.
 * An officer opening one container needs the lines for that container, not the
 * shipment's total — and a shipment split across three containers with one
 * flat list is a list somebody has to re-sort by hand at the port.
 */

import {
  cargoTotals,
  customerSide,
  esc,
  escBlock,
  field,
  formatDate,
  formatQuantity,
  letterhead,
  localised,
  page,
  partyBlock,
  partyOf,
  type CargoView,
  type DocumentLocale,
  type JobDocumentView,
} from './document-kit'

const STRINGS = {
  en: {
    title: 'Packing List',
    shipper: 'Shipper',
    consignee: 'Consignee',
    job: 'Our reference',
    houseBill: 'House B/L',
    invoice: 'Invoice reference',
    date: 'Date',
    container: 'Container',
    loose: 'Loose / unstuffed',
    line: '#',
    marks: 'Marks',
    packages: 'Packages',
    description: 'Description of goods',
    hs: 'HS code',
    net: 'Net (kg)',
    gross: 'Gross (kg)',
    volume: 'Volume (cbm)',
    subtotal: 'Container total',
    totals: 'Shipment total',
    declaration: 'We certify that the particulars given above are true and correct.',
    signed: 'For and on behalf of the shipper',
  },
  ar: {
    title: 'قائمة التعبئة',
    shipper: 'الشاحن',
    consignee: 'المرسل إليه',
    job: 'مرجعنا',
    houseBill: 'البوليصة الفرعية',
    invoice: 'رقم الفاتورة',
    date: 'التاريخ',
    container: 'الحاوية',
    loose: 'بضاعة سائبة',
    line: 'م',
    marks: 'العلامات',
    packages: 'الطرود',
    description: 'وصف البضاعة',
    hs: 'البند الجمركي',
    net: 'الوزن الصافي (كجم)',
    gross: 'الوزن الإجمالي (كجم)',
    volume: 'الحجم (متر مكعب)',
    subtotal: 'إجمالي الحاوية',
    totals: 'إجمالي الإرسالية',
    declaration: 'نقرّ بأن البيانات المذكورة أعلاه صحيحة ومطابقة للواقع.',
    signed: 'عن الشاحن وبالنيابة عنه',
  },
} as const

export function renderPackingListHtml(view: JobDocumentView, locale: DocumentLocale): string {
  const t = STRINGS[locale]
  const totals = cargoTotals(view.cargo)

  /*
    Grouped by container, and the ungrouped lines kept together at the end
    rather than scattered.

    `Map` preserves insertion order, so containers appear in the order the
    cargo lines name them — which is the order they were stuffed in, and the
    order the operator entered them in.
  */
  const groups = new Map<string, CargoView[]>()
  for (const line of view.cargo) {
    const key = line.containerNo ?? ''
    const existing = groups.get(key)
    if (existing) existing.push(line)
    else groups.set(key, [line])
  }

  const row = (line: CargoView): string => `<tr>
    <td class="n">${line.lineNo}</td>
    <td>${escBlock(line.marksAndNumbers) || '—'}</td>
    <td class="n">${line.packageCount ?? '—'} ${esc(line.packageType ?? '')}</td>
    <td>${escBlock(localised(line.descriptionEn, line.descriptionAr, locale))}</td>
    <td>${esc(line.hsCode ?? '—')}</td>
    <td class="n">${formatQuantity(line.netWeightKg, locale)}</td>
    <td class="n">${formatQuantity(line.grossWeightKg, locale)}</td>
    <td class="n">${formatQuantity(line.volumeCbm, locale)}</td>
  </tr>`

  const sections = [...groups.entries()]
    .map(([containerNo, lines]) => {
      const sub = cargoTotals(lines)
      const equipment = view.equipment.find((e) => e.containerNo === containerNo)
      const heading = containerNo
        ? `${t.container} ${esc(containerNo)}${equipment?.containerType ? ` · ${esc(equipment.containerType)}` : ''}${equipment?.sealNo ? ` · ${esc(equipment.sealNo)}` : ''}`
        : t.loose

      return `<h2 style="margin-top:5mm">${heading}</h2>
<table>
  <thead><tr>
    <th class="n" style="width:5%">${t.line}</th>
    <th style="width:16%">${t.marks}</th>
    <th class="n" style="width:12%">${t.packages}</th>
    <th>${t.description}</th>
    <th style="width:10%">${t.hs}</th>
    <th class="n" style="width:10%">${t.net}</th>
    <th class="n" style="width:10%">${t.gross}</th>
    <th class="n" style="width:10%">${t.volume}</th>
  </tr></thead>
  <tbody>${lines.map(row).join('')}</tbody>
  <tfoot><tr>
    <td colspan="2">${t.subtotal}</td>
    <td class="n">${sub.packages}</td>
    <td colspan="2"></td>
    <td class="n">${formatQuantity(sub.netWeightKg, locale)}</td>
    <td class="n">${formatQuantity(sub.grossWeightKg, locale)}</td>
    <td class="n">${formatQuantity(sub.volumeCbm, locale)}</td>
  </tr></tfoot>
</table>`
    })
    .join('')

  // Party records win; otherwise the customer goes on its own side (NEW-8).
  const customerName = localised(view.customer.nameEn, view.customer.nameAr, locale)
  const side = customerSide(view)
  const sides = {
    shipper: side === 'shipper' ? customerName : '—',
    consignee: side === 'consignee' ? customerName : '—',
  }

  return page(
    locale,
    `
${letterhead(view, t.title, view.reference, locale)}

<div class="grid">
  ${partyBlock(partyOf(view, 'shipper'), t.shipper, locale, sides.shipper)}
  ${partyBlock(partyOf(view, 'consignee'), t.consignee, locale, sides.consignee)}
</div>

<div class="row" style="margin-top:4mm">
  ${field(t.job, esc(view.reference))}
  ${field(t.houseBill, esc(view.houseBillNumber ?? '—'))}
  ${field(t.invoice, esc(view.customerReference ?? '—'))}
  ${field(t.date, esc(formatDate(view.issuedAt, locale)))}
</div>

${sections}

<table style="margin-top:5mm">
  <tfoot><tr>
    <td colspan="2">${t.totals}</td>
    <td class="n" style="width:12%">${totals.packages}</td>
    <td colspan="2"></td>
    <td class="n" style="width:10%">${formatQuantity(totals.netWeightKg, locale)}</td>
    <td class="n" style="width:10%">${formatQuantity(totals.grossWeightKg, locale)}</td>
    <td class="n" style="width:10%">${formatQuantity(totals.volumeCbm, locale)}</td>
  </tr></tfoot>
</table>

<div class="terms">${esc(t.declaration)}</div>
<div class="sign"><div>${esc(t.signed)}</div></div>
`,
  )
}
