/**
 * The job document templates.
 *
 * Pure functions of a view, tested here rather than through rendered PDFs for
 * the same reason the invoice is: what goes wrong on a bill of lading is
 * escaping, totals, and a field silently going missing — none of which need a
 * browser. Chromium's half of the job is Arabic shaping and mirroring, and
 * that is verified by looking at the output.
 *
 * The bill of lading gets the most attention here because it is the only
 * document in the system with legal weight: it is the contract of carriage and
 * frequently a document of title, and a defect on it is not a cosmetic bug.
 */

import { describe, expect, it } from 'vitest'
import { renderBillOfLadingHtml } from './bill-of-lading'
import { renderDeliveryOrderHtml } from './delivery-order'
import { renderPackingListHtml } from './packing-list'
import { renderManifestHtml, type ConsolidationDocumentView } from './manifest'
import { cargoTotals, type CargoView, type JobDocumentView } from './document-kit'

const base: JobDocumentView = {
  reference: 'KWI-JOB-2026-00042',
  houseBillNumber: 'QBD-KWI-2026-00017',
  masterBillNumber: 'MSCU1234567',
  bookingNumber: 'BK-99812',
  customerReference: 'PO-4471',
  mode: 'sea_lcl',
  tradeDirection: 'import',
  incoterm: 'CIF',
  vesselName: 'MSC ISTANBUL',
  voyageNumber: '214W',
  flightNumber: null,
  etd: new Date('2026-06-02T00:00:00Z'),
  eta: new Date('2026-06-21T00:00:00Z'),
  origin: { nameEn: 'Jebel Ali', nameAr: 'جبل علي', unlocode: 'AEJEA' },
  destination: { nameEn: 'Shuwaikh', nameAr: 'الشويخ', unlocode: 'KWSWK' },
  branch: {
    legalNameEn: 'Al-Qabandi & Partners Co.',
    legalNameAr: 'شركة القبندي وشركاه',
    taxRegistration: 'KW-TRN-4471',
    country: 'KW',
  },
  customer: { nameEn: 'Gulf Trading Co.', nameAr: 'شركة الخليج للتجارة' },
  parties: [
    {
      role: 'shipper',
      nameEn: 'Shanghai Everbright Ltd.',
      nameAr: null,
      address: 'No. 88 Pudong Avenue\nBuilding C, Floor 12',
      city: 'Shanghai',
      country: 'CN',
      contactName: 'Wei Zhang',
      phone: '+86 21 5555 0100',
      email: 'export@everbright.example',
      taxId: null,
    },
    {
      role: 'consignee',
      nameEn: 'TO ORDER',
      nameAr: null,
      address: null,
      city: null,
      country: null,
      contactName: null,
      phone: null,
      email: null,
      taxId: null,
    },
    {
      role: 'notify',
      nameEn: 'Gulf Trading Co.',
      nameAr: 'شركة الخليج للتجارة',
      address: 'Block 4, Street 12\nShuwaikh Industrial',
      city: 'Kuwait City',
      country: 'KW',
      contactName: null,
      phone: '+965 2222 0000',
      email: null,
      taxId: 'KW-TRN-9981',
    },
  ],
  cargo: [
    {
      lineNo: 1,
      marksAndNumbers: 'GTC/KWI/1-120\nMADE IN CHINA',
      packageCount: 120,
      packageType: 'CARTONS',
      descriptionEn: 'Ceramic floor tiles',
      descriptionAr: 'بلاط سيراميك للأرضيات',
      hsCode: '6907.21.00',
      grossWeightKg: '4820.500',
      netWeightKg: '4610.000',
      volumeCbm: '12.480',
      containerNo: 'MSCU7654321',
    },
    {
      lineNo: 2,
      marksAndNumbers: 'GTC/KWI/121-150',
      packageCount: 30,
      packageType: 'PALLETS',
      descriptionEn: 'Sanitary ware',
      descriptionAr: 'أدوات صحية',
      hsCode: '6910.10.00',
      grossWeightKg: '1180.000',
      netWeightKg: '1090.000',
      volumeCbm: '6.020',
      containerNo: null,
    },
  ],
  equipment: [
    {
      containerNo: 'MSCU7654321',
      containerType: '40HC',
      sealNo: 'SL-441982',
      grossWeightKg: '4820.500',
    },
  ],
  issuedAt: new Date('2026-06-02T07:30:00Z'),
  placeOfIssue: 'KWI',
  freightTerm: 'prepaid',
}

const view = (patch: Partial<JobDocumentView>): JobDocumentView => ({ ...base, ...patch })

describe('house bill of lading', () => {
  it('prints the shipper, consignee and notify party in their own boxes', () => {
    const html = renderBillOfLadingHtml(base, 'en')

    expect(html).toContain('Shanghai Everbright Ltd.')
    expect(html).toContain('TO ORDER')
    expect(html).toContain('Notify party')
  })

  it('preserves the line breaks in marks and numbers', () => {
    // The marks match what is stencilled on the carton. Collapsing them into a
    // paragraph is a discrepancy somebody argues about at the port.
    expect(renderBillOfLadingHtml(base, 'en')).toContain('GTC/KWI/1-120<br>MADE IN CHINA')
  })

  it('totals the packages, weight and measurement across the cargo lines', () => {
    const html = renderBillOfLadingHtml(base, 'en')
    expect(html).toContain('>150<')
    expect(html).toContain('6,000.5')
    expect(html).toContain('18.5')
  })

  it('watermarks a bill with no number rather than issuing it quietly', () => {
    const html = renderBillOfLadingHtml(view({ houseBillNumber: null }), 'en')
    expect(html).toContain('DRAFT — not a valid bill of lading')
  })

  it('does not watermark a numbered bill', () => {
    expect(renderBillOfLadingHtml(base, 'en')).not.toContain('class="draft"')
  })

  it('states the number of originals on the face', () => {
    // The carrier releases against any one original and the others become
    // void. A bill that does not say how many exist cannot be safely
    // surrendered.
    expect(renderBillOfLadingHtml(base, 'en')).toContain('Number of original B/L')
    expect(renderBillOfLadingHtml(base, 'en', { originals: 1 })).toMatch(/Number of original[\s\S]*?1/)
  })

  it('carries the "said to contain" disclaimer', () => {
    expect(renderBillOfLadingHtml(base, 'en')).toContain('said to contain')
    expect(renderBillOfLadingHtml(base, 'en')).toContain('the others to stand void')
  })

  it('prints the freight term, because it is the contract', () => {
    expect(renderBillOfLadingHtml(base, 'en')).toContain('Prepaid')
    expect(renderBillOfLadingHtml(view({ freightTerm: 'collect' }), 'en')).toContain('Collect')
  })

  it('becomes an air waybill in air mode and shows the flight, not the vessel', () => {
    const html = renderBillOfLadingHtml(
      view({ mode: 'air', flightNumber: 'KU 172', vesselName: null, voyageNumber: null }),
      'en',
    )
    expect(html).toContain('House Air Waybill')
    expect(html).toContain('KU 172')
    expect(html).not.toContain('MSC ISTANBUL')
  })

  it('renders Arabic right to left with the Arabic party names', () => {
    const html = renderBillOfLadingHtml(base, 'ar')
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('بوليصة شحن فرعية')
    expect(html).toContain('شركة الخليج للتجارة')
  })

  it('falls back to the English name where a party has no Arabic one', () => {
    expect(renderBillOfLadingHtml(base, 'ar')).toContain('Shanghai Everbright Ltd.')
  })

  it('escapes markup in a shipper-supplied description', () => {
    // The description is printed verbatim and arrives here as markup. Without
    // escaping, a script in it runs inside the renderer — a browser process in
    // our own container.
    const html = renderBillOfLadingHtml(
      view({
        cargo: [{ ...base.cargo[0]!, descriptionEn: '<script>alert(1)</script> tiles & fittings' }],
      }),
      'en',
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; fittings')
  })

  it('prints the container and seal where the cargo is stuffed', () => {
    expect(renderBillOfLadingHtml(base, 'en')).toContain('MSCU7654321 / 40HC / SL-441982')
  })
})

describe('delivery order', () => {
  it('states the release conditions every time', () => {
    const html = renderDeliveryOrderHtml(base, 'en')
    expect(html).toContain('payment in full')
    expect(html).toContain('surrender of the original bill of lading')
  })

  it('expires, and says when', () => {
    // A delivery order with no expiry is a standing instruction to release
    // somebody else's cargo, and it circulates by email for months.
    const html = renderDeliveryOrderHtml(base, 'en')
    expect(html).toContain('Valid until')
    expect(html).toContain('09 Jun 2026')
  })

  it('honours an explicit validity date', () => {
    const html = renderDeliveryOrderHtml(base, 'en', {
      validUntil: new Date('2026-06-30T00:00:00Z'),
    })
    expect(html).toContain('30 Jun 2026')
  })

  it('addresses the terminal it is handed to', () => {
    const html = renderDeliveryOrderHtml(base, 'en', { addressedTo: 'KGL Shuwaikh Terminal' })
    expect(html).toContain('KGL Shuwaikh Terminal')
  })
})

describe('packing list', () => {
  it('groups the lines by the container they are stuffed in', () => {
    const html = renderPackingListHtml(base, 'en')
    expect(html).toContain('Container MSCU7654321')
    expect(html).toContain('Loose / unstuffed')
  })

  it('subtotals each container as well as the shipment', () => {
    const html = renderPackingListHtml(base, 'en')
    expect(html).toContain('Container total')
    expect(html).toContain('Shipment total')
  })

  it('shows net weight, which the bill of lading does not', () => {
    // Duty is assessed on value; an inspection is settled by weighing the
    // carton, and the net is what the officer weighs against.
    expect(renderPackingListHtml(base, 'en')).toContain('Net (kg)')
    expect(renderBillOfLadingHtml(base, 'en')).not.toContain('Net (kg)')
  })

  it('carries the HS code for the officer reading it', () => {
    expect(renderPackingListHtml(base, 'en')).toContain('6907.21.00')
  })
})

describe('cargo manifest', () => {
  const consol: ConsolidationDocumentView = {
    reference: 'KWI-CNS-2026-00008',
    masterBillNumber: 'MSCU1234567',
    bookingNumber: 'BK-99812',
    mode: 'sea_lcl',
    carrierName: 'MSC',
    coloadPartnerName: null,
    vesselName: 'MSC ISTANBUL',
    voyageNumber: '214W',
    flightNumber: null,
    origin: { nameEn: 'Jebel Ali', nameAr: 'جبل علي', unlocode: 'AEJEA' },
    destination: { nameEn: 'Shuwaikh', nameAr: 'الشويخ', unlocode: 'KWSWK' },
    etd: new Date('2026-06-02T00:00:00Z'),
    eta: new Date('2026-06-21T00:00:00Z'),
    branch: {
      legalNameEn: 'Al-Qabandi & Partners Co.',
      legalNameAr: 'شركة القبندي وشركاه',
      taxRegistration: 'KW-TRN-4471',
    },
    houses: [
      {
        houseBillNumber: 'QBD-KWI-2026-00017',
        jobReference: 'KWI-JOB-2026-00042',
        shipperName: 'Shanghai Everbright Ltd.',
        consigneeName: 'Gulf Trading Co.',
        notifyName: null,
        descriptionEn: 'Ceramic floor tiles',
        descriptionAr: null,
        marksAndNumbers: 'GTC/KWI/1-120',
        packageCount: 120,
        packageType: 'CARTONS',
        grossWeightKg: '4820.500',
        volumeCbm: '12.480',
        containerNo: 'MSCU7654321',
        origin: null,
        destination: null,
        freightTerm: 'prepaid',
      },
      {
        houseBillNumber: 'QBD-KWI-2026-00018',
        jobReference: 'KWI-JOB-2026-00043',
        shipperName: 'Ningbo Fastener Works',
        consigneeName: 'Al-Sayer Hardware',
        notifyName: 'Al-Sayer Hardware',
        descriptionEn: 'Steel fasteners',
        descriptionAr: null,
        marksAndNumbers: null,
        packageCount: 45,
        packageType: 'CASES',
        grossWeightKg: '2100.000',
        volumeCbm: '3.200',
        containerNo: 'MSCU7654321',
        origin: null,
        destination: null,
        freightTerm: 'collect',
      },
    ],
    issuedAt: new Date('2026-06-02T07:30:00Z'),
    placeOfIssue: 'KWI',
  }

  it('lists every house under the master', () => {
    const html = renderManifestHtml(consol, 'en')
    expect(html).toContain('QBD-KWI-2026-00017')
    expect(html).toContain('QBD-KWI-2026-00018')
    expect(html).toContain('2 house bills')
  })

  it('totals the house weights rather than copying the master', () => {
    // A manifest whose house weights do not sum to the declared master weight
    // is the discrepancy that holds a container at the port.
    const html = renderManifestHtml(consol, 'en')
    expect(html).toContain('6,920.5')
    expect(html).toContain('15.68')
  })

  it('marks each house prepaid or collect', () => {
    const html = renderManifestHtml(consol, 'en')
    expect(html).toContain('>PP<')
    expect(html).toContain('>CC<')
  })

  it('prints landscape, because nine columns do not fit portrait', () => {
    expect(renderManifestHtml(consol, 'en')).toContain('size: A4 landscape')
  })

  it('says so plainly when no house has been attached yet', () => {
    const html = renderManifestHtml({ ...consol, houses: [] }, 'en')
    expect(html).toContain('No house bills are attached')
  })
})

describe('shared totals', () => {
  it('sums packages, weights and volume across lines', () => {
    const totals = cargoTotals(base.cargo)
    expect(totals.packages).toBe(150)
    expect(totals.grossWeightKg).toBe('6000.5')
    expect(totals.volumeCbm).toBe('18.5')
  })

  it('answers zero rather than NaN for an empty shipment', () => {
    const empty: CargoView[] = []
    expect(cargoTotals(empty)).toEqual({
      packages: 0,
      grossWeightKg: '0',
      netWeightKg: '0',
      volumeCbm: '0',
    })
  })
})
