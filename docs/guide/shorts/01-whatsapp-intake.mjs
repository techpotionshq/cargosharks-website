// Short 01: a WhatsApp message becomes a complete enquiry. Runs on the
// fixtures: enquiry 318 is the pilot data's WhatsApp intake, conversation and
// all, so nothing has to be sent to record it. The customer's message is shown
// as a phone bubble (an annotation), because the real one arrived before the
// recording starts.
const ENQ = '/enquiries/enq-318'

export default {
  id: '01-whatsapp-intake',
  title: 'WhatsApp enquiries',
  sub: 'A customer message becomes a complete enquiry',
  stack: 'fixtures',
  start: '/enquiries',
  routes: ['/enquiries', ENQ],
  steps: [
    {
      id: 'msg',
      label: 'Customer sends a WhatsApp',
      caption: { key: 'shorts.01-whatsapp-intake.msg' },
      run: async (r, a) => {
        await a.wa(
          'Fintas Steel Industries',
          'We have 2 × 40’HC of steel coils to move ex Ningbo, cargo ready at the mill',
          '09:21',
        )
        await r.page.waitForTimeout(2600)
      },
    },
    {
      id: 'queue',
      label: 'In the enquiry queue',
      caption: { key: 'shorts.01-whatsapp-intake.queue' },
      run: async (r, a) => {
        await a.unwa()
        const link = r.page.locator(`a[href="${ENQ}"]`).first()
        const row = r.page.locator('tr', { has: link }).first()
        await a.focus(
          row.locator('td').first(),
          '<b>New</b> · WhatsApp · Fintas Steel Industries<br>Reply deadline already counting',
          { side: 'right', zoom: 1.5 },
        )
        await r.point(link, { ms: 350 })
        await r.page.waitForTimeout(2000)
      },
      leave: async (r, a) => {
        await a.unzoom(320)
        await r.cut(async () => {
          await r.click(r.page.locator(`a[href="${ENQ}"]`).first(), { before: 80, after: 80 })
          await r.page.waitForURL(/enquiries\/enq-318/)
          await r.page.waitForLoadState('networkidle')
        })
      },
    },
    {
      id: 'asks',
      label: 'Assistant asks for what is missing',
      caption: { key: 'shorts.01-whatsapp-intake.asks' },
      run: async (r, a) => {
        // The customer named the boxes (2 × 40'HC), so the demo office's own FCL
        // requirement, the package count, is what is left to ask for.
        const row = r.page.getByText('Asked for the missing details').first().locator('xpath=..')
        await a.focus(
          row,
          'Missing: <b>the number of packages</b>.<br>It asks once, in the customer’s language.',
          { side: 'below', zoom: 1.4 },
        )
        await r.point(row, { ms: 350 })
        await r.page.waitForTimeout(2500)
      },
    },
    {
      id: 'thread',
      label: 'The whole conversation',
      caption: { key: 'shorts.01-whatsapp-intake.thread' },
      run: async (r, a) => {
        await a.unzoom(320)
        await r.scrollTo(r.page.getByRole('heading', { name: 'Conversation' }).first(), {
          offset: 70,
          ms: 450,
        })
        // Let the scroll come to rest before measuring, or the box is drawn where the bubble was.
        await r.page.waitForTimeout(500)
        const convo = r.page
          .locator('section')
          .filter({ has: r.page.getByRole('heading', { name: 'Conversation' }) })
          .last()
        await a.focus(
          convo.getByText(/steel coils to move/).first(),
          'Customer: <b>2 × 40’HC of steel coils</b>',
          { side: 'right', zoom: 1.3 },
        )
        await r.page.waitForTimeout(1600)
        await a.focus(
          convo.getByText(/we still need the number of packages/).last(),
          'Assistant: one question,<br>signed by the branch',
          { side: 'left', zoom: 1.3 },
        )
        await r.page.waitForTimeout(1800)
      },
    },
    {
      id: 'read',
      label: 'Details read from the chat',
      caption: { key: 'shorts.01-whatsapp-intake.read' },
      run: async (r, a) => {
        await a.unzoom(320)
        await r.scrollTo(r.page.getByText('Read from the message').first(), { offset: 70, ms: 450 })
        const ev = r.page.getByText(/^2 [x×] 40.HC of steel coils$/).first()
        await a.focus(ev, 'Commodity <b>steel coils</b>,<br>quoted from the message', {
          side: 'right',
          zoom: 1.5,
        })
        await r.point(ev, { ms: 350 })
        await r.page.waitForTimeout(2500)
      },
    },
    {
      id: 'accept',
      label: 'A person accepts',
      caption: { key: 'shorts.01-whatsapp-intake.accept' },
      run: async (r, a, { t }) => {
        await a.unzoom(320)
        const btn = r.page
          .getByRole('button', { name: new RegExp(`^${t('proposals.acceptAll')}`) })
          .first()
        await a.focus(btn, 'One click accepts every suggestion,<br>under your own name', {
          side: 'left',
          zoom: 1.5,
        })
        await r.point(btn, { ms: 350 })
        await r.page.waitForTimeout(2200)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.smoothScroll(0, 450)
      },
    },
    {
      id: 'ready',
      label: 'Ready to price',
      caption: { key: 'shorts.01-whatsapp-intake.ready' },
      run: async (r, a, { t }) => {
        const summary = r.page
          .getByText('Lane', { exact: true })
          .first()
          .locator('xpath=ancestor::*[.//*[normalize-space()="Mode"]][1]')
        await a.focus(
          summary,
          '<b>Customer, lane and mode</b> filled in<br>from one WhatsApp conversation',
          { side: 'below', zoom: 1.3 },
        )
        await r.point(r.page.getByRole('button', { name: t('quote.priceIt') }).first(), { ms: 400 })
        await r.page.waitForTimeout(2600)
      },
    },
  ],
}
