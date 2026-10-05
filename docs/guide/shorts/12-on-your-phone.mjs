// Short 12: the system on a phone. Recorded at phone size on the fixtures.
export default {
  id: '12-on-your-phone',
  title: 'On your phone',
  sub: 'The menu sheet, search, the assistant and tracking',
  stack: 'fixtures',
  viewport: 'phone',
  start: '/dashboard',
  routes: ['/dashboard', '/jobs', '/track'],
  components: ['apps/web/src/ui/nav.tsx'],
  steps: [
    {
      id: 'home',
      label: 'The dashboard',
      caption: { key: 'shorts.12-on-your-phone.home' },
      run: async (r, a) => {
        await a.focus(
          r.page.locator('main h1').first().locator('xpath=..'),
          'What needs you today,<br>at the top',
          { side: 'below' },
        )
        await r.page.waitForTimeout(2200)
      },
    },
    {
      id: 'menu',
      label: 'The menu sheet',
      caption: { key: 'shorts.12-on-your-phone.menu' },
      run: async (r, a, { t }) => {
        await a.clear()
        const btn = r.page.getByRole('button', { name: t('nav.menu') }).first()
        await r.click(btn, { before: 120, after: 900 })
        await a.focus(
          r.page.locator('dialog[open], [role=dialog]').last(),
          'Every section, search,<br>tracking and sign-out',
          { side: 'below' },
        )
        await r.page.waitForTimeout(2400)
      },
    },
    {
      id: 'section',
      label: 'Open a section',
      caption: { key: 'shorts.12-on-your-phone.section' },
      run: async (r, a) => {
        await a.clear()
        await r.click(
          r.page
            .locator('dialog[open], [role=dialog]')
            .last()
            .getByRole('link', { name: 'Shipments' })
            .first(),
          { before: 120, after: 300 },
        )
        await r.cut(async () => {
          await r.page.waitForLoadState('networkidle')
          await r.page.waitForTimeout(500)
        })
        await a.focus(
          r.page.locator('main a[href^="/jobs/"]').first(),
          'Tables become lists<br>you can scroll with a thumb',
          { side: 'below' },
        )
        await r.page.waitForTimeout(2200)
      },
    },
    {
      id: 'assistant',
      label: 'The assistant',
      caption: { key: 'shorts.12-on-your-phone.assistant' },
      run: async (r, a) => {
        await a.clear()
        await r.smoothScroll(0, 300)
        const btn = r.page.getByRole('button', { name: 'Assistant' }).first()
        await a.focus(btn, 'Always one tap away,<br>in the top bar', { side: 'below' })
        await r.page.waitForTimeout(2200)
      },
      leave: async (r, a) => {
        await a.clear()
        await r.cut(async () => {
          await r.open(null)
          await r.goto('/track', { wait: 300 })
        })
      },
    },
    {
      id: 'track',
      label: 'Customer tracking',
      caption: { key: 'shorts.12-on-your-phone.track' },
      run: async (r, a) => {
        await r.type('input[name=reference]', 'KWI-2026-01041', { delay: 25 })
        await r.type('input[name=verifier]', 'CMAU0385171', { delay: 25 })
        await r.click(r.page.locator('form button[type=submit]').last(), { before: 80, after: 200 })
        await r.cut(async () => {
          await r.page.waitForLoadState('networkidle')
          await r.page.waitForTimeout(800)
        })
        const result = r.page
          .getByText(/steps complete/)
          .first()
          .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
        await r.scrollTo(result, { offset: 80, ms: 400 })
        await a.focus(
          result,
          'No login. The steps, the arrival<br>and any notice, in plain words',
          { side: 'below' },
        )
        await r.page.waitForTimeout(2600)
      },
    },
  ],
}
