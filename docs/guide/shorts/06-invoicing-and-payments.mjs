// Short 06: invoicing and payments. Seeded, from the booked shipment.
import { storyIds } from '../story/index.mjs'

/** Picks the option whose text contains every part (labels carry codes and amounts). */
const pick = async (sel, ...parts) => {
  const v = await sel.evaluate(
    (el, parts) => [...el.options].find((o) => parts.every((p) => o.text.includes(p)))?.value,
    parts,
  )
  await sel.selectOption(v)
}

export default {
  id: '06-invoicing-and-payments',
  title: 'Invoices and payments',
  sub: 'Bill the shipment and match the money',
  stack: 'seeded',
  snapshot: 'booked',
  routes: ['/finance', '/invoices/[id]', '/payments'],
  before: async (ctx) => {
    ctx.data = await storyIds(ctx)
  },
  start: '/finance',
  steps: [
    {
      id: 'unbilled',
      label: 'Earned, not yet billed',
      caption: { key: 'shorts.06-invoicing-and-payments.unbilled' },
      run: async (r, a, { data }) => {
        const row = r.page
          .locator('tr, li', { has: r.page.getByText(data.jobRef) })
          .filter({ has: r.page.getByRole('button', { name: 'Draft invoice' }) })
          .first()
        await r.scrollTo(row, { offset: 300, ms: 450 })
        await a.focus(row, 'Maryam’s shipment:<br>charges not on any invoice', {
          side: 'above',
          zoom: 1.35,
        })
        await r.page.waitForTimeout(2300)
      },
    },
    {
      id: 'draft',
      label: 'Draft the invoice',
      caption: { key: 'shorts.06-invoicing-and-payments.draft' },
      run: async (r, a, ctx) => {
        await a.unzoom(300)
        const row = r.page
          .locator('tr, li', { has: r.page.getByText(ctx.data.jobRef) })
          .filter({ has: r.page.getByRole('button', { name: 'Draft invoice' }) })
          .first()
        await r.click(row.getByRole('button', { name: 'Draft invoice' }), {
          before: 80,
          after: 200,
        })
        await r.cut(async () => {
          await r.page.waitForTimeout(1500)
          const [inv] = await ctx.sql('select id from invoices order by created_at desc limit 1')
          ctx.data.invoice = inv.id
          await r.goto(`/invoices/${inv.id}`, { wait: 300 })
        })
        const lines = r.page
          .getByText('What is being charged')
          .first()
          .locator('xpath=ancestor::section[1]')
        await a.focus(lines, 'The quotation’s charges,<br>in dinars to three decimals', {
          side: 'right',
          zoom: 1.3,
        })
        await r.page.waitForTimeout(2300)
      },
    },
    {
      id: 'issue',
      label: 'Approve and issue',
      caption: { key: 'shorts.06-invoicing-and-payments.issue' },
      run: async (r, a, { dlg }) => {
        await a.unzoom(300)
        await r.click(r.page.getByRole('button', { name: 'Approve' }).first(), {
          before: 80,
          after: 500,
        })
        await r.click(dlg().getByRole('button', { name: 'Approve' }).last(), {
          before: 80,
          after: 1100,
        })
        await r.click(r.page.getByRole('button', { name: 'Issue' }).first(), {
          before: 80,
          after: 500,
        })
        await a.focus(
          dlg()
            .getByText(/cannot be undone/)
            .first(),
          'Mistakes are fixed with<br>a <b>credit note</b>, never an edit',
          { side: 'below' },
        )
        await r.page.waitForTimeout(1700)
        await a.clear()
        await r.click(dlg().getByRole('button', { name: 'Issue it' }), { before: 80, after: 1200 })
        await a.focus(
          r.page.getByText(/^KWI-\d{4}-\d+$/).first(),
          'Its number, from the branch’s series',
          { side: 'right', zoom: 1.6 },
        )
        await r.page.waitForTimeout(1500)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.cut(async () => r.goto('/payments', { wait: 300 }))
      },
    },
    {
      id: 'receipt',
      label: 'Record the payment',
      caption: { key: 'shorts.06-invoicing-and-payments.receipt' },
      run: async (r, a, ctx) => {
        const [inv] = await ctx
          .sql('select total_amount::text as total from invoices where id = $1', [ctx.data.invoice])
          .catch(() => [{}])
        await r.click(r.page.getByRole('button', { name: 'Record a receipt' }).first(), {
          before: 80,
          after: 500,
        })
        const d = ctx.dlg()
        await pick(d.locator('select[name=branchId]'), 'KWI')
        await pick(d.locator('select[name=customerId]'), 'RUMRET')
        const total = inv?.total ? Number(inv.total).toFixed(3) : ''
        if (total) await d.locator('input[name=amount]').pressSequentially(total, { delay: 20 })
        await d.locator('input[name=reference]').fill('TT-88231')
        await pick(d.locator('select[name=invoiceId]'), 'Rumaithiya')
        await a.focus(d.locator('select[name=invoiceId]'), 'Matched to the invoice', {
          side: 'right',
        })
        await r.page.waitForTimeout(1300)
        await a.clear()
        await r.click(d.getByRole('button', { name: 'Record receipt' }), { before: 80, after: 900 })
      },
      leave: async (r, a, { data }) => {
        await r.cut(async () => r.goto(`/invoices/${data.invoice}`, { wait: 300 }))
      },
    },
    {
      id: 'paid',
      label: 'Paid',
      caption: { key: 'shorts.06-invoicing-and-payments.paid' },
      run: async (r, a) => {
        const card = r.page
          .getByText('Still outstanding')
          .first()
          .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
        await a.focus(card, 'Nothing outstanding', { side: 'below', zoom: 1.5 })
        await r.page.waitForTimeout(2400)
      },
    },
  ],
}
