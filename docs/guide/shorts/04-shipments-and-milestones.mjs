// Short 04: shipments and milestones. Seeded, from the booked shipment.
import { storyIds } from '../story/index.mjs'

export default {
  id: '04-shipments-and-milestones',
  title: 'Shipments and milestones',
  sub: 'Every step of the journey, on one page',
  stack: 'seeded',
  snapshot: 'booked',
  routes: ['/jobs', '/jobs/[id]', '/track'],
  before: async (ctx) => {
    ctx.data = await storyIds(ctx)
  },
  start: '/jobs',
  steps: [
    {
      id: 'board',
      label: 'Shipments',
      caption: { key: 'shorts.04-shipments-and-milestones.board' },
      run: async (r, a, { data }) => {
        const link = r.page.getByRole('link', { name: data.jobRef }).first()
        const row = r.page.locator('tr', { has: link }).first()
        await a.focus(
          (await row.count()) ? row.locator('td').first() : link,
          '<b>In transit</b> · Ningbo → Shuwaikh<br>Rumaithiya Retail Trading',
          { side: 'right', zoom: 1.5 },
        )
        await r.point(link, { ms: 350 })
        await r.page.waitForTimeout(2000)
      },
      leave: async (r, a, { data }) => {
        await a.unzoom(300)
        await r.cut(async () => r.goto(`/jobs/${data.job}`, { wait: 300 }))
      },
    },
    {
      id: 'milestones',
      label: 'Milestones',
      caption: { key: 'shorts.04-shipments-and-milestones.milestones' },
      run: async (r, a) => {
        const panel = r.page
          .getByText('Milestones', { exact: true })
          .first()
          .locator('xpath=ancestor::section[1]')
        await a.focus(panel, 'Done steps are ticked<br>with the <b>actual</b> time', {
          side: 'right',
          zoom: 1.3,
        })
        await r.page.waitForTimeout(2300)
      },
    },
    {
      id: 'record',
      label: '{app:jobActions.recordMilestone}',
      caption: { key: 'shorts.04-shipments-and-milestones.record' },
      run: async (r, a, { t, dlg }) => {
        await a.unzoom(300)
        await r.click(
          r.page.getByRole('button', { name: t('jobActions.recordMilestone') }).first(),
          { before: 80, after: 500 },
        )
        const d = dlg()
        await r.select(d.locator('select[name=milestoneId]'), { label: 'Vessel arrived' })
        await d.locator('input[name=actualAt]').fill('2026-10-24T07:40')
        await a.focus(
          d.locator('select[name=milestoneId]'),
          '<b>Vessel arrived</b>, 24 Oct 07:40',
          { side: 'right' },
        )
        await r.page.waitForTimeout(1300)
        await a.clear()
        await r.click(d.getByRole('button', { name: 'Save', exact: true }).last(), {
          before: 80,
          after: 1200,
        })
        const line = r.page
          .getByText('Vessel arrived', { exact: true })
          .first()
          .locator('xpath=ancestor::li[1]')
        await a.focus(line, 'Ticked, with the time', { side: 'right', zoom: 1.5 })
        await r.page.waitForTimeout(1600)
      },
    },
    {
      id: 'stage',
      label: '{app:jobActions.setStatus}',
      caption: { key: 'shorts.04-shipments-and-milestones.stage' },
      run: async (r, a, { t, dlg }) => {
        await a.unzoom(300)
        await r.smoothScroll(0, 300)
        await r.click(r.page.getByRole('button', { name: t('jobActions.setStatus') }).first(), {
          before: 80,
          after: 500,
        })
        await r.select(dlg().locator('select[name=status]'), { label: 'Arrived' })
        await r.click(dlg().getByRole('button', { name: 'Save', exact: true }).last(), {
          before: 80,
          after: 1200,
        })
        await a.focus(
          r.page.getByText('Arrived', { exact: true }).first(),
          'Stage: <b>Arrived</b>',
          { side: 'right', zoom: 1.6 },
        )
        await r.page.waitForTimeout(1600)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.cut(async () => {
          await r.open(null)
          await r.goto('/track', { wait: 300 })
        })
      },
    },
    {
      id: 'track',
      label: 'Customer tracking',
      caption: { key: 'shorts.04-shipments-and-milestones.track' },
      run: async (r, a, { data }) => {
        await r.type('input[name=reference]', data.jobRef, { delay: 22 })
        await r.type('input[name=verifier]', 'MSKU7204418', { delay: 22 })
        await r.click(r.page.locator('form button[type=submit]').last(), { before: 80, after: 200 })
        await r.cut(async () => {
          await r.page.waitForLoadState('networkidle')
          await r.page.waitForTimeout(800)
        })
        const card = r.page
          .getByText(/^Estimated arrival$|^Arrived$/i)
          .last()
          .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
        await a.focus(card, 'No login. The same steps<br>and the latest arrival date.', {
          side: 'below',
          zoom: 1.3,
        })
        await r.page.waitForTimeout(2600)
      },
    },
  ],
}
