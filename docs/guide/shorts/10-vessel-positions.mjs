// Short 10: where the vessel is. Runs on the fixtures, whose shipments
// job-1046 (heard 25 minutes ago in the Strait of Malacca) and job-1048 (a
// name-only match waiting for a person to confirm) cover the card's states.
const card = (r, t) =>
  r.page
    .locator('section.rounded-card')
    .filter({ has: r.page.getByRole('heading', { name: t('vesselPosition.title'), exact: true }) })
    .first()

export default {
  id: '10-vessel-positions',
  title: 'Where is the vessel?',
  sub: 'The ship’s last position, on the shipment, the portal and the board',
  stack: 'fixtures',
  start: '/jobs/job-1046',
  routes: ['/jobs/job-1046', '/jobs/job-1048', '/dashboard', '/settings/integrations'],
  components: ['apps/web/src/features/vessels/ui/vessel-position-card.tsx'],
  steps: [
    {
      id: 'card',
      label: '{app:vesselPosition.title}',
      caption: { key: 'shorts.10-vessel-positions.card' },
      run: async (r, a, { t }) => {
        await r.scrollTo(card(r, t), { offset: 90, ms: 500 })
        await a.focus(
          card(r, t),
          '<b>Current</b>: heard 25 minutes ago,<br>with speed and course',
          { side: 'left', zoom: 1.25 },
        )
        await r.page.waitForTimeout(2600)
      },
    },
    {
      id: 'reported',
      label: 'Reported by the ship',
      caption: { key: 'shorts.10-vessel-positions.reported' },
      run: async (r, a, { t }) => {
        await a.unzoom(300)
        const eta = r.page.getByText(t('vesselPosition.reportedEta')).first().locator('xpath=..')
        await a.focus(eta, 'Typed in by the crew.<br>Not your ETA.', { side: 'left', zoom: 1.5 })
        await r.page.waitForTimeout(2400)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.cut(async () => r.goto('/jobs/job-1048', { wait: 300 }))
      },
    },
    {
      id: 'identity',
      label: 'Confirm the ship',
      caption: { key: 'shorts.10-vessel-positions.identity' },
      run: async (r, a, { t }) => {
        await r.scrollTo(card(r, t), { offset: 90, ms: 500 })
        const btn = card(r, t).getByRole('button', { name: t('vesselPosition.confirm') })
        await a.focus(card(r, t), 'A possible match by name.<br>A person checks the IMO number.', {
          side: 'left',
          zoom: 1.3,
        })
        await r.point(btn, { ms: 400 })
        await r.page.waitForTimeout(2600)
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
      id: 'board',
      label: 'On the dashboard map',
      caption: { key: 'shorts.10-vessel-positions.board' },
      run: async (r, a) => {
        const map = r.page.locator('canvas.maplibregl-canvas').first()
        await r.scrollTo(map, { offset: 160, ms: 500 })
        await a.focus(map, 'A dot for every vessel<br>the system has heard', { side: 'above' })
        await r.page.waitForTimeout(2600)
      },
      leave: async (r, a) => {
        await a.clear()
        await r.cut(async () => r.goto('/settings/integrations', { wait: 300 }))
      },
    },
    {
      id: 'setting',
      label: 'Off until you switch it on',
      caption: { key: 'shorts.10-vessel-positions.setting' },
      run: async (r, a, { t }) => {
        const c = r.page
          .locator('section.rounded-card')
          .filter({
            has: r.page.getByRole('heading', {
              name: t('integrations.keys.vesselPositions'),
              exact: true,
            }),
          })
          .first()
        await r.scrollTo(c, { offset: 200, ms: 500 })
        await a.focus(c, 'Free coastal receivers: China,<br>Singapore and Europe, not the Gulf', {
          side: 'above',
          zoom: 1.2,
        })
        await r.page.waitForTimeout(2800)
      },
    },
  ],
}
