// Short 05: documents and the house bill. Seeded: issuing and releasing are
// writes, and the PDF previews are rendered by the service.
import { storyIds } from '../story/index.mjs'
import { pdfPage } from './lib/pdf.mjs'

const panel = (r) =>
  r.page.getByText('Issue and preview').first().locator('xpath=ancestor::section[1]')

export default {
  id: '05-documents-and-house-bill',
  title: 'Shipping documents',
  sub: 'Bills of lading and more, built from the shipment',
  stack: 'seeded',
  snapshot: 'booked',
  routes: ['/jobs/[id]', '/api/jobs/[id]/documents/[kind]', '/documents'],
  components: ['docs/guide/shorts/lib/pdf.mjs'],
  before: async (ctx) => {
    ctx.data = await storyIds(ctx)
  },
  start: (ctx) => `/jobs/${ctx.data.job}`,
  steps: [
    {
      id: 'panel',
      label: 'Issue and preview',
      caption: { key: 'shorts.05-documents-and-house-bill.panel' },
      run: async (r, a) => {
        await r.scrollTo(panel(r), { offset: 90, ms: 450 })
        await a.focus(panel(r), 'House bill, delivery order,<br>packing list, customs pack', {
          side: 'left',
          zoom: 1.35,
        })
        await r.page.waitForTimeout(2300)
      },
    },
    {
      id: 'preview',
      label: 'Preview the house bill',
      caption: { key: 'shorts.05-documents-and-house-bill.preview' },
      run: async (r, a, { data }) => {
        await a.unzoom(300)
        const en = r.page.locator(`a[href^="/api/jobs/${data.job}/documents/house_bill"]`).first()
        await a.focus(en, 'English preview', { side: 'left', zoom: 1.5 })
        await r.point(en, { ms: 300 })
        await r.page.waitForTimeout(800)
        await a.unzoom(300)
        await r.cut(async () =>
          pdfPage(r, `/api/jobs/${data.job}/documents/house_bill`, 'house-bill-of-lading'),
        )
        await a.focus(
          r.page.locator('div.pdfpage').first(),
          'Shipper, consignee, vessel,<br>containers and cargo,<br>exactly as entered',
          { side: 'right' },
        )
        await r.page.waitForTimeout(2600)
      },
      leave: async (r, a, { data }) => {
        await a.clear()
        await r.cut(async () => {
          await r.goto(`/jobs/${data.job}`, { wait: 300 })
          await r.scrollTo(panel(r), { offset: 90, ms: 10 })
        })
      },
    },
    {
      id: 'issue',
      label: 'Issue the delivery order',
      caption: { key: 'shorts.05-documents-and-house-bill.issue' },
      run: async (r, a, { dlg }) => {
        const btn = panel(r).getByRole('button', { name: 'Issue', exact: true }).nth(1)
        await a.focus(
          btn.locator('xpath=..'),
          '<b>Issue</b> in your language,<br>or <b>{app:documentActions.issueIn,language=ar}</b>',
          { side: 'left', zoom: 1.5 },
        )
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(1200)
        await a.unzoom(300)
        await r.click(btn, { before: 80, after: 700 })
        if (await dlg().count())
          await r.click(dlg().getByRole('button').last(), { before: 80, after: 1000 })
        const files = r.page.getByText('Shipment files', { exact: true }).first()
        await r.scrollTo(files, { offset: 200, ms: 450 })
        const row = files
          .locator('xpath=ancestor::section[1]')
          .getByText('Delivery Order', { exact: true })
          .first()
          .locator('xpath=../..')
        await a.focus(row, 'Issued as <b>version 1</b>,<br>stored exactly as handed over', {
          side: 'below',
          zoom: 1.4,
        })
        await r.page.waitForTimeout(1800)
      },
    },
    {
      id: 'release',
      label: 'Release to the customer',
      caption: { key: 'shorts.05-documents-and-house-bill.release' },
      run: async (r, a, { dlg }) => {
        await a.unzoom(300)
        const btn = r.page.getByRole('button', { name: 'Release' }).first()
        await a.focus(btn, 'Drafts never reach<br>the customer', { side: 'left', zoom: 1.5 })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(1100)
        await a.unzoom(300)
        await r.click(btn, { before: 80, after: 700 })
        if (await dlg().count())
          await r.click(dlg().getByRole('button').last(), { before: 80, after: 1200 })
        await r.page.waitForTimeout(500)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.cut(async () => r.goto('/documents', { wait: 300 }))
      },
    },
    {
      id: 'register',
      label: 'The document register',
      caption: { key: 'shorts.05-documents-and-house-bill.register' },
      run: async (r, a) => {
        await a.focus(
          r.page.locator('tbody tr').first(),
          'Newest first.<br>Superseded versions stay visible.',
          { side: 'below', zoom: 1.3 },
        )
        await r.page.waitForTimeout(2600)
      },
    },
  ],
}
