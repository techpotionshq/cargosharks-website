// Short 07: supplier bills. Seeded, from the booked shipment: the origin
// agent's bill is captured, matched to the shipment's costs and approved.
import { storyIds } from '../story/index.mjs'

const pick = async (sel, ...parts) => {
  const v = await sel.evaluate(
    (el, parts) => [...el.options].find((o) => parts.every((p) => o.text.includes(p)))?.value,
    parts,
  )
  await sel.selectOption(v)
}
const addLine = async (r, ctx, desc, charge, qty, price) => {
  await r.click(r.page.getByRole('button', { name: 'Add line' }).first(), {
    before: 60,
    after: 400,
  })
  const d = ctx.dlg()
  await d.locator('input[name=description]').fill(desc)
  await pick(d.locator('select[name=chargeTypeId]'), charge)
  await d.locator('input[name=quantity]').fill(qty)
  await d.locator('input[name=unitPrice]').fill(price)
  await r.click(d.getByRole('button', { name: 'Add' }).last(), { before: 60, after: 900 })
}
const match = async (r, ctx, i, charge) => {
  const btn = r.page
    .locator('table tbody tr')
    .nth(i)
    .getByRole('button', { name: 'Match' })
    .filter({ visible: true })
    .first()
  await r.click(btn, { before: 60, after: 600 })
  const sel = ctx.dlg().locator('select[name=chargeLineId]')
  if (!(await sel.isVisible().catch(() => false))) await r.click(btn, { after: 800 })
  await pick(sel, ctx.data.jobRef, charge)
  await r.click(ctx.dlg().getByRole('button', { name: 'Match' }).last(), {
    before: 60,
    after: 1000,
  })
}

export default {
  id: '07-supplier-bills',
  title: 'Supplier bills',
  sub: 'Check what partners bill against what you expected',
  stack: 'seeded',
  snapshot: 'booked',
  routes: ['/payables', '/payables/[id]'],
  before: async (ctx) => {
    ctx.data = await storyIds(ctx)
  },
  start: '/payables',
  steps: [
    {
      id: 'board',
      label: 'Payables',
      caption: { key: 'shorts.07-supplier-bills.board' },
      run: async (r, a) => {
        const nr = r.page
          .getByText('Needs review', { exact: true })
          .first()
          .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
        await a.focus(nr, 'Bills outside tolerance,<br>or matched to nothing', {
          side: 'below',
          zoom: 1.5,
        })
        await r.page.waitForTimeout(2200)
      },
    },
    {
      id: 'capture',
      label: 'Capture the bill',
      caption: { key: 'shorts.07-supplier-bills.capture' },
      run: async (r, a, ctx) => {
        await a.unzoom(300)
        await r.click(r.page.getByRole('button', { name: ctx.t('payableForm.capture') }).first(), {
          before: 80,
          after: 500,
        })
        const d = ctx.dlg()
        await pick(d.locator('select[name=branchId]'), 'KWI')
        await pick(d.locator('select[name=partnerId]'), 'SHACO')
        await r.type(d.locator('input[name=reference]'), 'SOL-INV-26104', { delay: 25 })
        await d.locator('select[name=currency]').selectOption('USD')
        const fx = d.locator('input[name=fxRate]')
        if (await fx.count()) await fx.fill('0.307')
        await a.focus(
          d.locator('input[name=reference]'),
          'Their invoice number.<br>The same number twice is refused.',
          { side: 'right' },
        )
        await r.page.waitForTimeout(1400)
        await a.clear()
        await r.click(d.getByRole('button', { name: 'Save' }), { before: 80, after: 300 })
        await r.cut(async () => {
          await r.page.waitForTimeout(1200)
          const [bill] = await ctx.sql(
            'select id from supplier_invoices order by created_at desc limit 1',
          )
          ctx.data.bill = bill.id
          await r.goto(`/payables/${bill.id}`, { wait: 300 })
        })
        await addLine(r, ctx, 'Ocean freight 2 x 40HC', 'Ocean Freight', '2', '2190')
        await r.cut(async () => {
          await addLine(
            r,
            ctx,
            'Terminal handling, origin',
            'Terminal Handling — Origin',
            '2',
            '165',
          )
          await addLine(r, ctx, 'Documentation fee', 'Documentation', '1', '50')
        })
      },
    },
    {
      id: 'match',
      label: 'Match to the shipment',
      caption: { key: 'shorts.07-supplier-bills.match' },
      run: async (r, a, ctx) => {
        await match(r, ctx, 0, 'Ocean Freight')
        await r.cut(async () => {
          await match(r, ctx, 1, 'Terminal Handling — Origin')
          await match(r, ctx, 2, 'Documentation')
          await r.page.reload({ waitUntil: 'networkidle' })
        })
        await a.focus(r.page.locator('table').first(), 'Every line <b>agrees</b>', {
          side: 'above',
          zoom: 1.3,
        })
        await r.page.waitForTimeout(2400)
      },
    },
    {
      id: 'approve',
      label: 'Finance approves',
      caption: { key: 'shorts.07-supplier-bills.approve' },
      run: async (r, a, ctx) => {
        await a.unzoom(300)
        const btn = r.page.getByRole('button', { name: 'Approve' }).first()
        await a.focus(btn, 'Whoever typed the bill<br>never clears it', { side: 'left', zoom: 1.5 })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(1100)
        await a.unzoom(300)
        await r.click(btn, { before: 80, after: 500 })
        const d = ctx.dlg()
        if (await d.count()) {
          // A bill whose total was added up from its lines needs that total confirmed first.
          const tick = d.getByLabel(ctx.t('payableForm.confirmTotal'))
          if (await tick.count()) await tick.check({ force: true })
          await r.click(d.getByRole('button').last(), { before: 80, after: 1200 })
        }
        await a.focus(
          r.page.getByText('Approved', { exact: true }).first(),
          'Status <b>Approved</b>, ready to pay',
          { side: 'right', zoom: 1.5 },
        )
        await r.page.waitForTimeout(1800)
      },
    },
  ],
}
