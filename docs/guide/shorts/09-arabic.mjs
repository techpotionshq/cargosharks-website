// Short 09: Arabic, right to left. The language switch is a preference, not
// a record, so this runs on the fixtures.
export default {
  id: '09-arabic',
  title: 'Arabic, right to left',
  sub: 'Every screen and every document in both languages',
  stack: 'fixtures',
  start: '/dashboard',
  routes: ['/dashboard', '/enquiries/enq-318', '/quotes/quote-316', '/track'],
  ready: async (r) => r.waitMap(),
  steps: [
    {
      id: 'switch',
      label: 'Switch language',
      caption: { key: 'shorts.09-arabic.switch' },
      run: async (r, a, { t }) => {
        const btn = r.page.getByRole('button', { name: t('common.language') }).first()
        await a.focus(btn, 'Your choice only.<br>Colleagues keep theirs.', { side: 'left' })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(1200)
        await a.clear()
        await r.click(btn, { before: 80, after: 200 })
        await r.cut(async () => {
          await r.page.waitForFunction(() => document.documentElement.dir === 'rtl')
          await r.waitMap()
        })
      },
    },
    {
      id: 'rtl',
      label: 'Right to left',
      caption: { key: 'shorts.09-arabic.rtl' },
      run: async (r, a) => {
        await a.focus(
          r.page.locator('nav').first(),
          'Menu on the right,<br>every label translated',
          { side: 'left' },
        )
        await r.page.waitForTimeout(2600)
      },
      leave: async (r, a) => {
        await a.clear()
        await r.cut(async () => r.goto('/enquiries/enq-318', { wait: 400 }))
      },
    },
    {
      id: 'enquiry',
      label: 'Same records, in Arabic',
      caption: { key: 'shorts.09-arabic.enquiry' },
      run: async (r, a) => {
        const head = r.page.locator('main h1').first().locator('xpath=..')
        await a.focus(head, 'The enquiry header and<br>its status, in Arabic', {
          side: 'below',
          zoom: 1.4,
        })
        await r.page.waitForTimeout(2400)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.cut(async () => r.goto('/quotes/quote-316', { wait: 400 }))
      },
    },
    {
      id: 'quote',
      label: 'Arabic documents',
      caption: { key: 'shorts.09-arabic.quote' },
      run: async (r, a) => {
        const pdf = r.page.locator('main a[href*="/pdf"]').last()
        await a.focus(pdf, 'Quotation, bill of lading<br>and invoice, in Arabic', {
          side: 'below',
          zoom: 1.5,
        })
        await r.page.waitForTimeout(2600)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.cut(async () => r.goto('/track', { wait: 400 }))
      },
    },
    {
      id: 'track',
      label: 'Customer pages too',
      caption: { key: 'shorts.09-arabic.track' },
      run: async (r, a) => {
        const form = r.page
          .locator('form')
          .filter({ has: r.page.locator('input[name=reference]') })
          .first()
        await a.focus(form, 'Tracking, the portal and every<br>email, in the customer’s language', {
          side: 'below',
          zoom: 1.3,
        })
        await r.page.waitForTimeout(2800)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.cut(async () => {
          await r.goto('/dashboard', { wait: 300 })
          await r.waitMap()
        })
      },
    },
    {
      id: 'back',
      label: 'Back to English',
      caption: { key: 'shorts.09-arabic.back' },
      run: async (r, a) => {
        const btn = r.page.getByRole('button', { name: 'English' }).first()
        await a.focus(btn, 'English', { side: 'right' })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(1000)
        await a.clear()
        await r.click(btn, { before: 80, after: 200 })
        await r.cut(async () => {
          await r.page.waitForFunction(() => document.documentElement.dir !== 'rtl')
          await r.waitMap()
        })
        await r.page.waitForTimeout(1200)
      },
    },
  ],
}
