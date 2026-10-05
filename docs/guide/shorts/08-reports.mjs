// Short 08: the margin report. Read-only, so it runs on the fixtures.
const card = (page, label) =>
  page
    .getByText(label, { exact: true })
    .first()
    .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')

export default {
  id: '08-reports',
  title: 'Margin report',
  sub: 'What every shipment, customer and lane really earned',
  stack: 'fixtures',
  who: 'operations',
  start: '/reports',
  routes: ['/reports', '/dashboard'],
  steps: [
    {
      id: 'totals',
      label: 'The margin report',
      caption: { key: 'shorts.08-reports.totals' },
      run: async (r, a, { t }) => {
        await a.focus(
          card(r.page, t('reports.revenue')).locator('xpath=..'),
          'For any date range,<br>by the date they sailed',
          { side: 'below', zoom: 1.3 },
        )
        await r.page.waitForTimeout(2300)
      },
    },
    {
      id: 'lane',
      label: 'Group by {app:reports.dimension.lane}',
      caption: { key: 'shorts.08-reports.lane' },
      run: async (r, a, { t }) => {
        await a.unzoom(300)
        const tab = r.page
          .getByRole('link', { name: t('reports.dimension.lane'), exact: true })
          .first()
        await r.click(tab, { before: 80, after: 300 })
        await r.cut(async () => {
          await r.page.waitForLoadState('networkidle')
          await r.page.waitForTimeout(500)
        })
        const row = r.page.locator('tbody tr').first()
        await a.focus(row, 'The best-earning lane first:<br>revenue, cost and <b>margin</b>', {
          side: 'below',
          zoom: 1.35,
        })
        await r.page.waitForTimeout(2400)
      },
    },
    {
      id: 'mode',
      label: 'Group by {app:reports.dimension.mode}',
      caption: { key: 'shorts.08-reports.mode' },
      run: async (r, a, { t }) => {
        await a.unzoom(300)
        const tab = r.page
          .getByRole('link', { name: t('reports.dimension.mode'), exact: true })
          .first()
        await r.click(tab, { before: 80, after: 300 })
        await r.cut(async () => {
          await r.page.waitForLoadState('networkidle')
          await r.page.waitForTimeout(500)
        })
        await a.focus(
          r.page.locator('table').first(),
          'Revenue, cost, profit<br>and margin per mode',
          { side: 'above', zoom: 1.25 },
        )
        await r.page.waitForTimeout(2600)
      },
    },
    {
      id: 'export',
      label: 'Export',
      caption: { key: 'shorts.08-reports.export' },
      run: async (r, a, { t }) => {
        await a.unzoom(300)
        const btn = r.page.getByRole('link', { name: t('reports.exportCsv') }).first()
        await a.focus(btn, 'Every row, every column', { side: 'left', zoom: 1.6 })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(2200)
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
      id: 'kpis',
      label: 'Win rate and margin',
      caption: { key: 'shorts.08-reports.kpis' },
      run: async (r, a, { t }) => {
        const w = r.page.getByText(t('dashboard.winRate')).first()
        await r.scrollTo(w, { offset: 300, ms: 500 })
        await a.focus(
          w.locator('xpath=ancestor::*[contains(@class,"rounded")][1]'),
          'Rising wins with falling margin<br>means the team is buying work',
          { side: 'left', zoom: 1.4 },
        )
        await r.page.waitForTimeout(2800)
      },
    },
  ],
}
