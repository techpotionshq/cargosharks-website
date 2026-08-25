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
import { renderAirWaybillHtml } from './air-waybill'
import { renderBillOfLadingHtml } from './bill-of-lading'
import { renderDeliveryOrderHtml } from './delivery-order'
import { renderPackingListHtml } from './packing-list'
import { renderManifestHtml, type ConsolidationDocumentView } from './manifest'
import { renderCustomsPackHtml, type CustomsPackView } from './customs-pack'
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
    billOfLadingTermsEn: null,
    billOfLadingTermsAr: null,
  },
  customer: { nameEn: 'Gulf Trading Co.', nameAr: 'شركة الخليج للتجارة' },
  placeOfReceipt: null,
  placeOfDelivery: null,
  shippedOnBoardAt: new Date('2026-06-01T14:00:00Z'),
  houseBillSurrenderedAt: null,
  parties: [
    {
      role: 'shipper',
      nameEn: 'Shanghai Hongqiao Ltd.',
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
  chargeableWeightKg: null,
  chargeableBasis: null,
  currency: 'USD',
}

const view = (patch: Partial<JobDocumentView>): JobDocumentView => ({ ...base, ...patch })

describe('house bill of lading', () => {
  it('prints the shipper, consignee and notify party in their own boxes', () => {
    const html = renderBillOfLadingHtml(base, 'en')

    expect(html).toContain('Shanghai Hongqiao Ltd.')
    expect(html).toContain('TO ORDER')
    expect(html).toContain('Notify party')
  })

  it('preserves the line breaks in marks and numbers', () => {
    // The marks match what is stencilled on the carton. Collapsing them into a
    // paragraph is a discrepancy somebody argues about at the port.
    expect(renderBillOfLadingHtml(base, 'en')).toContain(
      '<bdi>GTC/KWI/1-120</bdi><br><bdi>MADE IN CHINA</bdi>',
    )
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
    expect(renderBillOfLadingHtml(base, 'en', { originals: 1 })).toMatch(
      /Number of original[\s\S]*?1/,
    )
  })

  it('carries the "said to contain" disclaimer', () => {
    expect(renderBillOfLadingHtml(base, 'en')).toContain('said to contain')
    expect(renderBillOfLadingHtml(base, 'en')).toContain('the others to stand void')
  })

  it('prints the freight term, because it is the contract', () => {
    expect(renderBillOfLadingHtml(base, 'en')).toContain('Prepaid')
    expect(renderBillOfLadingHtml(view({ freightTerm: 'collect' }), 'en')).toContain('Collect')
  })

  it('renders Arabic right to left with the Arabic party names', () => {
    const html = renderBillOfLadingHtml(base, 'ar')
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('بوليصة شحن فرعية')
    expect(html).toContain('شركة الخليج للتجارة')
  })

  it('falls back to the English name where a party has no Arabic one', () => {
    expect(renderBillOfLadingHtml(base, 'ar')).toContain('Shanghai Hongqiao Ltd.')
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

  // --- what a bank reads: UCP 600 art. 20 ---------------------------------

  it('carries a dated on-board notation naming the vessel', () => {
    // Without it the bank takes the issue date as the shipment date and
    // refuses the bill against a credit that calls for a shipped one.
    const html = renderBillOfLadingHtml(base, 'en')
    expect(html).toContain('On-board notation')
    expect(html).toContain('Shipped on board')
    expect(html).toMatch(/Shipped on board[\s\S]*?MSC ISTANBUL \/ 214W[\s\S]*?01 Jun 2026/)
  })

  it('says "received for shipment" rather than inventing an on-board date', () => {
    const html = renderBillOfLadingHtml(view({ shippedOnBoardAt: null }), 'en')
    expect(html).toContain('Received for shipment')
    expect(html).not.toContain('Shipped on board')
  })

  it('prints each original as its own sheet, numbered within the set', () => {
    const html = renderBillOfLadingHtml(base, 'en')
    expect(html).toContain('Original 1 of 3')
    expect(html).toContain('Original 2 of 3')
    expect(html).toContain('Original 3 of 3')
    expect(html).not.toContain('Original 4 of 3')
    expect(html.match(/class="sheet face"/g)).toHaveLength(6)
  })

  it('marks every copy non-negotiable on its face', () => {
    const html = renderBillOfLadingHtml(base, 'en', { copies: 2 })
    expect(html.match(/Copy — non-negotiable/g)).toHaveLength(2)
    expect(html.match(/class="sheet face"/g)).toHaveLength(5)
  })

  it('honours a different number of originals on every sheet', () => {
    const html = renderBillOfLadingHtml(base, 'en', { originals: 1, copies: 0 })
    expect(html).toContain('Original 1 of 1')
    expect(html.match(/class="sheet face"/g)).toHaveLength(1)
  })

  it('prints the branch terms as the back of every sheet, face then back', () => {
    // Duplex printing takes pages in pairs. Terms once at the end would put
    // the second original's terms on the first original's reverse.
    const html = renderBillOfLadingHtml(
      view({
        branch: {
          ...base.branch,
          billOfLadingTermsEn: '1. Definitions. "Carrier" means the issuer.\n\n2. Clause paramount.',
        },
      }),
      'en',
      { originals: 2, copies: 1 },
    )
    const order = [...html.matchAll(/class="sheet (face|back)"/g)].map((m) => m[1])
    expect(order).toEqual(['face', 'back', 'face', 'back', 'face', 'back'])
    expect(html).toContain('<p>1. Definitions. &quot;Carrier&quot; means the issuer.</p>')
    expect(html).toContain('<p>2. Clause paramount.</p>')
    expect(html).toContain('printed on the reverse side form part of this bill of lading')
  })

  it('prints no back page, and does not cite one, where the branch has no terms', () => {
    const html = renderBillOfLadingHtml(base, 'en')
    expect(html).not.toContain('class="sheet back"')
    expect(html).not.toContain('reverse side')
  })

  it('prints the Arabic terms on the Arabic bill', () => {
    const html = renderBillOfLadingHtml(
      view({
        branch: {
          ...base.branch,
          billOfLadingTermsEn: 'English clauses',
          billOfLadingTermsAr: 'البنود العربية',
        },
      }),
      'ar',
    )
    expect(html).toContain('البنود العربية')
    expect(html).not.toContain('English clauses')
  })

  it('prints no originals once the bill has been surrendered, and stamps every copy', () => {
    // Telex release: the originals were handed back, so there are none to
    // print. Three original sheets with SURRENDERED across them would be three
    // pages that say ORIGINAL first.
    const html = renderBillOfLadingHtml(
      view({ houseBillSurrenderedAt: new Date('2026-06-09T09:00:00Z') }),
      'en',
    )
    expect(html).not.toContain('Original 1 of 3')
    expect(html.match(/class="sheet face"/g)).toHaveLength(3)
    expect(html.match(/class="surrendered"/g)).toHaveLength(3)
    expect(html).toContain('Surrendered')
    expect(html).toMatch(/Telex release · 09 Jun 2026/)
  })

  it('still prints one stamped copy of a surrendered bill when no copies were asked for', () => {
    const html = renderBillOfLadingHtml(
      view({ houseBillSurrenderedAt: new Date('2026-06-09T09:00:00Z') }),
      'en',
      { copies: 0 },
    )
    expect(html.match(/class="sheet face"/g)).toHaveLength(1)
  })

  it('does not stamp a bill that has not been surrendered', () => {
    expect(renderBillOfLadingHtml(base, 'en')).not.toContain('class="surrendered"')
  })

  it('watermarks every sheet of a draft', () => {
    // `.draft` is position: fixed, which Chromium repeats on every printed
    // page — one element, six watermarks.
    const html = renderBillOfLadingHtml(view({ houseBillNumber: null }), 'en')
    expect(html.match(/class="draft"/g)).toHaveLength(1)
    expect(html.indexOf('class="draft"')).toBeLessThan(html.indexOf('class="sheet face"'))
  })

  // --- the boxes a document checker ticks ----------------------------------

  it('prints place of receipt and delivery where the movement is door-to-door', () => {
    const html = renderBillOfLadingHtml(
      view({ placeOfReceipt: 'Shanghai CFS, Waigaoqiao', placeOfDelivery: 'Shuwaikh, Block 4' }),
      'en',
    )
    expect(html).toContain('Place of receipt')
    expect(html).toContain('Shanghai CFS, Waigaoqiao')
    expect(html).toContain('Place of delivery')
    expect(html).toContain('Shuwaikh, Block 4')
  })

  it('says where the freight is payable, derived from the term', () => {
    // Prepaid is paid at loading, collect at discharge. Derived so the box
    // cannot disagree with the stamp beside it.
    expect(renderBillOfLadingHtml(base, 'en')).toMatch(/Freight payable at[\s\S]*?Jebel Ali/)
    expect(renderBillOfLadingHtml(view({ freightTerm: 'collect' }), 'en')).toMatch(
      /Freight payable at[\s\S]*?Shuwaikh/,
    )
  })

  it('isolates a Latin party name on the Arabic face so its full stop stays put', () => {
    // `Shanghai Hongqiao Ltd.` printed as `.Shanghai Hongqiao Ltd` — the
    // trailing full stop resolved to the paragraph's direction.
    const html = renderBillOfLadingHtml(base, 'ar')
    expect(html).toContain('<bdi>Shanghai Hongqiao Ltd.</bdi>')
    expect(html).toContain('<bdi>No. 88 Pudong Avenue</bdi><br><bdi>Building C, Floor 12</bdi>')
  })

  it('isolates the vessel, booking and container codes as left-to-right runs', () => {
    const html = renderBillOfLadingHtml(base, 'ar')
    expect(html).toContain('<span dir="ltr">MSC ISTANBUL / 214W</span>')
    expect(html).toContain('<span dir="ltr">BK-99812</span>')
    expect(html).toContain('<span dir="ltr">MSCU7654321 / 40HC / SL-441982</span>')
  })
})

describe('house air waybill', () => {
  const air = (patch: Partial<JobDocumentView> = {}): JobDocumentView =>
    view({
      mode: 'air',
      vesselName: null,
      voyageNumber: null,
      flightNumber: 'KU 172',
      chargeableWeightKg: '2100.000',
      ...patch,
    })

  it('is the document a job in air mode gets, not a retitled bill of lading', () => {
    const html = renderAirWaybillHtml(air(), 'en')
    expect(html).toContain('House Air Waybill')
    expect(html).toContain('KU 172')
    expect(html).not.toContain('MSC ISTANBUL')
    expect(html).not.toContain('said to contain')
  })

  it('states on its face that it is not negotiable', () => {
    // The whole difference from a bill of lading. A consignee who believes an
    // air waybill is a document of title believes something that will not hold.
    expect(renderAirWaybillHtml(air(), 'en')).toContain('Not negotiable')
  })

  it('refuses to consign to order, and says why', () => {
    // The ocean template defaults a missing consignee to TO ORDER. Carried onto
    // a waybill that names a party no handling agent can release to.
    const html = renderAirWaybillHtml(
      air({
        parties: base.parties.map((p) =>
          p.role === 'consignee' ? { ...p, nameEn: 'TO ORDER' } : p,
        ),
      }),
      'en',
    )
    expect(html).toContain('cannot be consigned to order')
  })

  it('names the consignee box rather than leaving it blank when there is none', () => {
    const html = renderAirWaybillHtml(
      air({ parties: base.parties.filter((p) => p.role !== 'consignee') }),
      'en',
    )
    expect(html).toContain('CONSIGNEE REQUIRED')
  })

  it('prints the chargeable weight it was given, not a weight it recomputed', () => {
    expect(renderAirWaybillHtml(air(), 'en')).toContain('2,100')
  })

  it('carries the Montreal limitation notice, because the cap depends on it', () => {
    const html = renderAirWaybillHtml(air(), 'en')
    expect(html).toContain('22 SDR per kilogramme')
    expect(html).toContain('CONDITIONS OF CONTRACT')
  })

  it('declares NVD, NCV and XXX rather than leaving the value boxes empty', () => {
    const html = renderAirWaybillHtml(air(), 'en')
    expect(html).toContain('NVD')
    expect(html).toContain('NCV')
    expect(html).toContain('XXX')
  })

  it('withholds the rate, because original 2 is handed to the consignee', () => {
    const html = renderAirWaybillHtml(air(), 'en')
    expect(html).toContain('AS AGREED')
  })

  it('allocates the three originals rather than counting them', () => {
    const html = renderAirWaybillHtml(air(), 'en')
    expect(html).toContain('Original 1 — for issuing carrier')
    expect(html).toContain('Original 2 — for consignee, travels with the goods')
    expect(html).toContain('Original 3 — for shipper')
  })

  it('rates a minimum-weight consignment M and everything else Q', () => {
    expect(renderAirWaybillHtml(air({ chargeableBasis: 'minimum' }), 'en')).toMatch(/>M</)
    expect(renderAirWaybillHtml(air({ chargeableBasis: 'volumetric' }), 'en')).toMatch(/>Q</)
  })

  it('marks the charge in the column the freight term puts it in', () => {
    expect(renderAirWaybillHtml(air(), 'en')).toContain('>PP<')
    expect(renderAirWaybillHtml(air({ freightTerm: 'collect' }), 'en')).toContain('>CC<')
  })

  it('watermarks an unnumbered waybill', () => {
    expect(renderAirWaybillHtml(air({ houseBillNumber: null }), 'en')).toContain(
      'DRAFT — not a valid air waybill',
    )
  })

  it('isolates the phone number so Arabic does not reverse it', () => {
    // Caught by looking at a rendered Arabic waybill: +965 2222 0000 printed
    // as 0000 2222 965+. Every character present, the number unusable.
    const html = renderAirWaybillHtml(air(), 'ar')
    expect(html).toContain('<span dir="ltr">+86 21 5555 0100</span>')
    expect(html).toContain('<span dir="ltr">MSCU1234567</span>')
  })

  it('renders Arabic right to left', () => {
    const html = renderAirWaybillHtml(air(), 'ar')
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('بوليصة شحن جوي فرعية')
    expect(html).toContain('غير قابلة للتداول')
  })

  it('escapes markup in a shipper-supplied description', () => {
    const html = renderAirWaybillHtml(
      air({
        cargo: [{ ...base.cargo[0], descriptionEn: '<script>alert(1)</script>' } as CargoView],
      }),
      'en',
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
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

  it('stops demanding an original once the bill has been surrendered', () => {
    // "Against surrender of the original" on a telex-released shipment is an
    // instruction nobody can comply with, and a terminal that reads it
    // literally holds the cargo.
    const html = renderDeliveryOrderHtml(
      view({ houseBillSurrenderedAt: new Date('2026-06-09T09:00:00Z') }),
      'en',
    )
    expect(html).toContain('surrendered at origin on 09 Jun 2026 (telex release)')
    expect(html).not.toContain('against surrender of the original bill of lading')
  })

  it('demands the original where the bill has not been surrendered', () => {
    expect(renderDeliveryOrderHtml(base, 'en')).toContain(
      'against surrender of the original bill of lading',
    )
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
        shipperName: 'Shanghai Hongqiao Ltd.',
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
        consigneeName: 'Ardiya Hardware',
        notifyName: 'Ardiya Hardware',
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

/**
 * The pack is a working document, not a filing. We do not file — Kuwait
 * customs runs on a concession held by a competitor — so what this removes is
 * the hour of retyping, not the thirty seconds of clicking.
 *
 * That makes the estimate's *provenance* the thing to protect. A broker who
 * disagrees with 7% can see it came from prefix 870323 and say so, which is a
 * conversation; a bare figure is an argument. So the tests here are mostly
 * about what the sheet admits to: which tariff line answered, which codes it
 * could not price, and that none of it carries any authority.
 */
describe('customs declaration pack', () => {
  const pack: CustomsPackView = {
    job: base,
    declarationType: 'Import — consumption',
    declarationNo: 'KWD-2026-77123',
    brokerName: 'Bayan Clearing Co.',
    currency: 'KWD',
    goodsValue: '12500.000',
    freightValue: '840.000',
    insuranceValue: null,
    customsValue: '13340.000',
    estimatedDuty: '667.000',
    estimatedAt: new Date('2026-06-02T07:30:00Z'),
    lines: [
      {
        lineNo: 1,
        description: 'Ceramic floor tiles',
        hsCode: '6907.21.00',
        matchedPrefix: '690721',
        ratePercent: '5',
        packageCount: 120,
        grossWeightKg: '4820.500',
        netWeightKg: '4610.000',
        value: '10000.000',
        duty: '500.000',
        countryOfOrigin: 'CN',
      },
      {
        lineNo: 2,
        description: 'Sanitary ware',
        hsCode: null,
        matchedPrefix: null,
        ratePercent: null,
        packageCount: 30,
        grossWeightKg: '1180.000',
        netWeightKg: '1090.000',
        value: null,
        duty: null,
        countryOfOrigin: null,
      },
    ],
    unmatched: ['(no code)'],
  }

  const packed = (patch: Partial<CustomsPackView>): CustomsPackView => ({ ...pack, ...patch })

  it('names the broker it was prepared for, and the declaration it belongs to', () => {
    const html = renderCustomsPackHtml(pack, 'en')

    expect(html).toContain('Bayan Clearing Co.')
    expect(html).toContain('KWD-2026-77123')
    expect(html).toContain('Import — consumption')
  })

  /** The consignee is the importer of record; the customer is the fallback. */
  it('puts the consignee in the importer box and the shipper in the supplier box', () => {
    const html = renderCustomsPackHtml(pack, 'en')

    expect(html).toContain('Importer of record')
    expect(html).toContain('Shanghai Hongqiao Ltd.')
  })

  /**
   * The audit trail of the lookup, printed under the code that produced it.
   * Without it the rate is a number the broker can only accept or reject.
   */
  it('shows which tariff prefix answered, beneath the code it matched', () => {
    const html = renderCustomsPackHtml(pack, 'en')

    expect(html).toContain('6907.21.00')
    expect(html).toContain('690721')
    expect(html).toContain('5%')
  })

  /**
   * A dash, not a zero. A zero in the duty column reads as "exempt", which is
   * a statement about the goods; a dash reads as "not priced", which is a
   * statement about us and is the true one.
   */
  it('leaves an unpriced line blank rather than printing it as free', () => {
    const html = renderCustomsPackHtml(
      packed({ lines: [pack.lines[1]!], unmatched: ['(no code)'] }),
      'en',
    )

    expect(html).not.toContain('>0%<')
    expect(html).not.toContain('KWD 0.000')
    expect(html).toContain('<td class="n">—</td>')
  })

  it('lists the codes it could not price, because they are the work', () => {
    const html = renderCustomsPackHtml(packed({ unmatched: ['8703.23', '9999.99'] }), 'en')

    expect(html).toContain('No tariff line was found')
    expect(html).toContain('8703.23')
    expect(html).toContain('9999.99')
  })

  it('says nothing at all about unmatched codes when every line priced', () => {
    const html = renderCustomsPackHtml(packed({ unmatched: [] }), 'en')

    expect(html).not.toContain('No tariff line was found')
  })

  /**
   * The disclaimer is on every copy. An estimate that travels without it is an
   * estimate somebody will eventually treat as an assessment.
   */
  it('states on its face that the figure carries no authority', () => {
    const html = renderCustomsPackHtml(pack, 'en')

    expect(html).toContain('is not an assessment')
  })

  it('prints the valuation stack, with a dash for the part nobody knows', () => {
    const html = renderCustomsPackHtml(pack, 'en')

    expect(html).toContain('Customs valuation (CIF)')
    expect(html).toContain('Insurance')
    // KWD is three decimals — a global `toFixed(2)` here loses a fils a line.
    expect(html).toContain('13,340.000')
    expect(html).toContain('667.000')
  })

  it('names the flight on an air shipment and the vessel on a sea one', () => {
    const sea = renderCustomsPackHtml(pack, 'en')
    const air = renderCustomsPackHtml(
      packed({ job: view({ mode: 'air', flightNumber: 'KU 618', vesselName: null }) }),
      'en',
    )

    expect(sea).toContain('MSC ISTANBUL / 214W')
    expect(air).toContain('KU 618')
    expect(air).toContain('Flight')
  })

  /** Nine columns do not fit portrait, as on the manifest. */
  it('prints landscape', () => {
    expect(renderCustomsPackHtml(pack, 'en')).toContain('size: A4 landscape')
  })

  it('renders Arabic right to left', () => {
    const html = renderCustomsPackHtml(pack, 'ar')

    expect(html).toContain('dir="rtl"')
    expect(html).toContain('ملف البيان الجمركي')
  })

  /**
   * The description comes off a shipper's booking and is never trusted. It is
   * the one field on this sheet an outside party writes.
   */
  it('escapes markup in a shipper-supplied description', () => {
    const html = renderCustomsPackHtml(
      packed({
        lines: [{ ...pack.lines[0]!, description: '<script>alert(1)</script>' }],
      }),
      'en',
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
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

/**
 * The letterhead is the operator's, whoever the operator is.
 *
 * `DOCUMENT_CSS` opened with `--brand:#8c1d18` — Al-Qabandi's maroon — for as
 * long as they were the default brand, and kept printing it after the default
 * became CargoSharks. Every surrender stamp, warning box and draft watermark
 * on a bill of lading, delivery order, waybill and manifest came out in one
 * client's red regardless of who had issued the document. Asserted across all
 * four because they share one stylesheet and would have failed together.
 */
describe('the shared stylesheet', () => {
  const documents = {
    'bill of lading': () => renderBillOfLadingHtml(base, 'en'),
    'air waybill': () => renderAirWaybillHtml(base, 'en'),
    'delivery order': () => renderDeliveryOrderHtml(base, 'en'),
    'packing list': () => renderPackingListHtml(base, 'en'),
  }

  for (const [name, render] of Object.entries(documents)) {
    it(`resolves ${name} colours from the brand, not a literal`, () => {
      const html = render()
      expect(html).toContain('--qb-brand:')
      expect(html).toContain('--brand: var(--qb-brand)')
      expect(html).not.toMatch(/#[0-9a-fA-F]{6}/)
      expect(html).not.toContain('rgba(140,29,24')
    })
  }

  /* Paper has no colour scheme — see `pdf/brand.ts`. */
  it('pins the page to the light theme', () => {
    expect(renderBillOfLadingHtml(base, 'ar')).toContain('data-theme="light"')
  })
})
