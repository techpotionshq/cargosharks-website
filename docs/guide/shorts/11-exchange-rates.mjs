// Short 11: the exchange-rate feed. Runs on the fixtures: the setting is shown
// and opened, never saved.
const fxCard = (r, t) =>
  r.page
    .locator('section.rounded-card')
    .filter({ has: r.page.getByRole('heading', { name: t('integrations.keys.fx'), exact: true }) })
    .first()

export default {
  id: '11-exchange-rates',
  title: 'Exchange rates',
  sub: 'Daily rates, with their source on every conversion',
  stack: 'fixtures',
  start: '/settings/integrations',
  routes: ['/settings/integrations', '/reference', '/enquiries/enq-318'],
  components: ['apps/web/src/features/admin/ui/fx-feed-notice.tsx'],
  steps: [
    {
      id: 'setting',
      label: '{app:integrations.keys.fx}',
      caption: { key: 'shorts.11-exchange-rates.setting' },
      run: async (r, a, { t }) => {
        await r.scrollTo(fxCard(r, t), { offset: 200, ms: 500 })
        await a.focus(fxCard(r, t), 'Typed by hand until<br>someone chooses a feed', {
          side: 'above',
          zoom: 1.2,
        })
        await r.page.waitForTimeout(2400)
      },
    },
    {
      id: 'modes',
      label: 'Choose where rates come from',
      caption: { key: 'shorts.11-exchange-rates.modes' },
      run: async (r, a, { t, dlg }) => {
        await a.unzoom(300)
        await r.click(fxCard(r, t).getByRole('button', { name: /configure/i }), {
          before: 80,
          after: 700,
        })
        const resilient = dlg().getByText(t('integrations.drivers.fx.resilient')).first()
        await a.focus(resilient, 'Two public providers,<br>checked against each other', {
          side: 'below',
        })
        await r.page.waitForTimeout(1600)
        await a.clear()
        await r.click(resilient, { before: 80, after: 900 })
        const ack = dlg().getByText(t('integrations.acknowledge.fx.resilient.title')).first()
        if (await ack.count()) {
          await a.focus(
            ack.locator('xpath=..'),
            'Indicative rates from third parties.<br>You acknowledge it first.',
            { side: 'above' },
          )
          await r.page.waitForTimeout(2400)
        }
      },
      leave: async (r, a) => {
        await a.clear()
        await r.cut(async () => r.goto('/reference', { wait: 300 }))
      },
    },
    {
      id: 'source',
      label: 'Every rate has a source',
      caption: { key: 'shorts.11-exchange-rates.source' },
      run: async (r, a) => {
        const c = r.page
          .locator('section.rounded-card')
          .filter({ has: r.page.getByRole('heading', { name: 'Exchange rates', exact: true }) })
          .first()
        await r.scrollTo(c, { offset: 140, ms: 500 })
        await a.focus(c, 'The newest rate for each pair,<br>and where it came from', {
          side: 'above',
          zoom: 1.3,
        })
        await r.page.waitForTimeout(2600)
      },
      leave: async (r, a) => {
        await a.unzoom(300)
        await r.cut(async () => r.goto('/enquiries/enq-318', { wait: 300 }))
      },
    },
    {
      id: 'converted',
      label: 'Conversions say so',
      caption: { key: 'shorts.11-exchange-rates.converted' },
      run: async (r, a) => {
        const rates = r.page
          .getByText('Rates from agents')
          .first()
          .locator('xpath=ancestor::section[1]')
        await r.scrollTo(rates, { offset: 120, ms: 500 })
        const conv = rates.getByText(/≈ KWD/).first()
        await a.focus(conv.locator('xpath=..'), 'Dollars shown in dinars,<br>at the day’s rate', {
          side: 'left',
          zoom: 1.5,
        })
        await r.page.waitForTimeout(2600)
      },
    },
  ],
}
