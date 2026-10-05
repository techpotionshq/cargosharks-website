// Short 03: the customer accepts in the portal. Seeded, from the quotation
// short 02 sent; the story plays it to make the "accepted" chapter.
import { storyIds } from '../story/index.mjs'

export default {
  id: '03-customer-accepts-quote',
  title: 'Accepted in the portal',
  sub: 'Your customer answers a quotation online',
  stack: 'seeded',
  snapshot: 'quoted',
  who: 'customer',
  routes: ['/portal/quotes', '/portal/quotes/[id]', '/quotes/[id]'],
  before: async (ctx) => {
    ctx.data = await storyIds(ctx)
  },
  start: '/portal/quotes',
  steps: [
    {
      id: 'list',
      label: 'Customer opens the portal',
      caption: { key: 'shorts.03-customer-accepts-quote.list' },
      run: async (r, a, { data }) => {
        const card = r.page
          .locator('li, article, div')
          .filter({ has: r.page.getByText(data.quoteRef, { exact: true }) })
          .filter({ has: r.page.getByRole('link') })
          .last()
        await a.focus(card, '<b>Awaiting your answer</b><br>Ningbo → Shuwaikh', {
          side: 'below',
          zoom: 1.4,
        })
        await r.page.waitForTimeout(2300)
      },
      leave: async (r, a, { data }) => {
        await a.unzoom(300)
        await r.cut(async () => r.goto(`/portal/quotes/${data.quote}`, { wait: 300 }))
      },
    },
    {
      id: 'detail',
      label: 'Checks the offer',
      caption: { key: 'shorts.03-customer-accepts-quote.detail' },
      run: async (r, a) => {
        const charges = r.page
          .getByText('Charges', { exact: true })
          .first()
          .locator('xpath=ancestor::section[1]')
        await a.focus(charges, 'Only the selling price.<br>Your costs stay private.', {
          side: 'right',
          zoom: 1.35,
        })
        await r.page.waitForTimeout(2400)
      },
    },
    {
      id: 'accept',
      label: 'Accepts',
      caption: { key: 'shorts.03-customer-accepts-quote.accept' },
      run: async (r, a, { dlg }) => {
        await a.unzoom(300)
        const btn = r.page.getByRole('button', { name: /^Accept$/ }).first()
        await a.focus(btn, 'Accept or decline,<br>with a reason', { side: 'left', zoom: 1.6 })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(1000)
        await a.unzoom(300)
        await r.click(btn, { before: 80, after: 500 })
        const ok = dlg().getByRole('button', { name: 'Accept quotation' })
        await a.focus(ok, 'She agrees to the total<br>and the terms', { side: 'left' })
        await r.point(ok, { ms: 300 })
        await r.page.waitForTimeout(1100)
        await a.clear()
        await r.click(ok, { before: 80, after: 1200 })
        await a.focus(
          r.page.getByText('Accepted', { exact: true }).first(),
          'Status <b>Accepted</b>',
          { side: 'right', zoom: 1.5 },
        )
        await r.page.waitForTimeout(1400)
      },
      leave: async (r, a, { data }) => {
        await a.unzoom(300)
        await r.cut(async () => {
          await r.open('operations')
          await r.goto(`/quotes/${data.quote}`, { wait: 400 })
        })
      },
    },
    {
      id: 'office',
      label: 'The office books it',
      caption: { key: 'shorts.03-customer-accepts-quote.office' },
      run: async (r, a, { t }) => {
        const btn = r.page.getByRole('button', { name: t('jobForm.open') }).first()
        await a.focus(
          btn,
          'Accepted in the portal.<br><b>{app:jobForm.open}</b> carries the prices across.',
          { side: 'left', zoom: 1.5 },
        )
        await r.point(btn, { ms: 350 })
        await r.page.waitForTimeout(2800)
      },
    },
  ],
}
