// Short 02: rates and quotations. Seeded: it sends rate requests, reads the
// replies, makes a rate card, prices and sends a quotation. The story plays
// this short to make the "quoted" chapter, so short 03 opens the quotation
// this one sent.
import { replyToRateRequests, storyIds } from '../story/index.mjs'

// The cheapest reply's row. "Rates from agents" is a table now (it was a list
// of flex rows), and the old `li, div` match found the table's wrapper div,
// which holds every row's button. The row is the unit the eye compares.
const reply = (r) =>
  r.page
    .locator('tr, li')
    .filter({ has: r.page.getByText('Cheapest', { exact: true }) })
    .filter({ has: r.page.getByRole('button', { name: /Make rate card|Replace the older rate/ }) })
    .last()

export default {
  id: '02-rates-and-quotations',
  title: 'Rates and quotations',
  sub: 'Partner prices compared, priced and sent in minutes',
  stack: 'seeded',
  snapshot: 'ready',
  routes: ['/enquiries/[id]', '/quotes/[id]'],
  before: async (ctx) => {
    ctx.data = await storyIds(ctx)
  },
  start: (ctx) => `/enquiries/${ctx.data.enquiry}`,
  steps: [
    {
      id: 'request',
      label: 'Ask partners for a price',
      caption: { key: 'shorts.02-rates-and-quotations.request' },
      run: async (r, a, { t, dlg }) => {
        await r.scrollTo(r.page.getByRole('heading', { name: 'Rates from agents' }).first(), {
          offset: 300,
          ms: 450,
        })
        const btn = r.page.getByRole('button', { name: t('rateRequests.request') }).first()
        await a.focus(btn, 'Partners covering<br><b>Ningbo → Shuwaikh</b>', {
          side: 'left',
          zoom: 1.5,
        })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(900)
        await a.unzoom(300)
        await r.click(btn, { before: 80, after: 600 })
        for (const box of await dlg().locator('input[type=checkbox]').all())
          if (!(await box.isChecked())) await box.check({ force: true })
        await a.focus(
          dlg().locator('form').first(),
          'Each one gets <b>one email</b>.<br>Replies come back here.',
          { side: 'left' },
        )
        await r.page.waitForTimeout(1500)
        await a.clear()
        await r.click(dlg().getByRole('button', { name: 'Send requests' }), {
          before: 80,
          after: 500,
        })
      },
    },
    {
      id: 'replies',
      label: 'Replies compared',
      caption: { key: 'shorts.02-rates-and-quotations.replies' },
      run: async (r, a, ctx) => {
        await r.cut(async () => {
          const e = ctx.data.enquiry
          await ctx.waitFor(
            async () =>
              Number(
                (
                  await ctx.sql(
                    'select count(*)::int n from rate_requests where enquiry_id = $1 and sent_at is not null',
                    [e],
                  )
                )[0].n,
              ) >= 3,
          )
          await replyToRateRequests(ctx)
          await ctx.waitFor(
            async () =>
              Number(
                (
                  await ctx.sql(
                    "select count(*)::int n from rate_requests where enquiry_id = $1 and status::text = 'parsed'",
                    [e],
                  )
                )[0].n,
              ) >= 3,
          )
          await r.page.reload({ waitUntil: 'networkidle' })
          await r.scrollTo(r.page.getByRole('heading', { name: 'Rates from agents' }).first(), {
            offset: 140,
            ms: 10,
          })
          await r.page.waitForTimeout(300)
        })
        await a.focus(
          reply(r),
          '<b>Cheapest</b> of three replies,<br>in US dollars and in dinars',
          { side: 'above', zoom: 1.35 },
        )
        await r.page.waitForTimeout(2300)
      },
    },
    {
      id: 'award',
      label: 'Make it a rate card',
      caption: { key: 'shorts.02-rates-and-quotations.award' },
      run: async (r, a) => {
        const btn = reply(r).getByRole('button', { name: /Make rate card|Replace the older rate/ })
        await a.focus(btn, 'Buying rate on file,<br>with its validity date', {
          side: 'left',
          zoom: 1.4,
        })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(900)
        await a.clear()
        await r.click(btn, { before: 80, after: 1200 })
        const confirm = r.page.locator('dialog[open], [role=dialog]').last()
        if (await confirm.count())
          await r.click(confirm.getByRole('button').last(), { before: 80, after: 1200 })
      },
    },
    {
      id: 'price',
      label: 'Price it',
      caption: { key: 'shorts.02-rates-and-quotations.price' },
      run: async (r, a, { t }) => {
        await a.unzoom(300)
        await r.smoothScroll(0, 400)
        await r.click(r.page.getByRole('button', { name: t('quote.priceIt') }).first(), {
          before: 80,
          after: 200,
        })
        await r.cut(async () => {
          await r.page.waitForLoadState('networkidle')
          await r.page.waitForTimeout(1500)
        })
        const bd = r.page
          .getByText('Charge breakdown')
          .first()
          .locator('xpath=ancestor::section[1]')
        await r.scrollTo(bd, { offset: 90, ms: 450 })
        await a.focus(bd, 'The customer never sees<br>the <b>buy</b> side', {
          side: 'above',
          zoom: 1.3,
        })
        await r.page.waitForTimeout(2600)
      },
      leave: async (r, a, ctx) => {
        await a.unzoom(300)
        await r.cut(async () => {
          ctx.data = await storyIds(ctx)
          await r.goto(`/quotes/${ctx.data.quote}`, { wait: 300 })
        })
      },
    },
    {
      id: 'quote',
      label: 'The quotation',
      caption: { key: 'shorts.02-rates-and-quotations.quote' },
      run: async (r, a) => {
        const m = r.page
          .getByText('Margin', { exact: true })
          .first()
          .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
        await a.focus(m, 'Price, cost and <b>margin</b><br>before anything is sent', {
          side: 'below',
          zoom: 1.5,
        })
        await r.page.waitForTimeout(2200)
      },
    },
    {
      id: 'send',
      label: 'Send to the customer',
      caption: { key: 'shorts.02-rates-and-quotations.send' },
      run: async (r, a, { t, dlg }) => {
        await a.unzoom(300)
        const btn = r.page.getByRole('button', { name: t('quoteDetail.moveOpen.sent') }).first()
        await a.focus(btn, 'Goes to the customer’s portal,<br>in English or Arabic', {
          side: 'left',
          zoom: 1.5,
        })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(900)
        await a.unzoom(300)
        await r.click(btn, { before: 80, after: 500 })
        await r.click(dlg().getByRole('button', { name: 'Send it' }), { before: 120, after: 900 })
        await a.focus(
          r.page.getByText('Sent', { exact: true }).first(),
          'Status <b>Sent</b>: waiting for<br>the customer’s answer',
          { side: 'right', zoom: 1.5 },
        )
        await r.page.waitForTimeout(1600)
      },
    },
  ],
}
