// Short 13: choosing which alerts also come by email. Runs on the fixtures;
// the choice is shown, not saved.
export default {
  id: '13-notification-emails',
  title: 'Alerts by email',
  sub: 'Everything in the bell, and only what you choose in your inbox',
  stack: 'fixtures',
  start: '/dashboard',
  routes: ['/dashboard'],
  components: ['apps/web/src/features/notifications/ui/notification-bell.tsx'],
  ready: async (r) => r.waitMap(),
  steps: [
    {
      id: 'bell',
      label: 'The bell',
      caption: { key: 'shorts.13-notification-emails.bell' },
      run: async (r, a, { t }) => {
        const bell = r.page.locator(`summary[aria-label^="${t('notifications.title')}"]`).first()
        await a.focus(bell, 'New enquiries, overdue replies,<br>holds and free time', {
          side: 'left',
        })
        await r.page.waitForTimeout(1400)
        await a.clear()
        await r.click(bell, { before: 80, after: 700 })
        await a.focus(
          r.page.locator('details[open] > div').first(),
          'Every alert arrives here,<br>newest first',
          { side: 'left', zoom: 1.6 },
        )
        await r.page.waitForTimeout(2200)
      },
    },
    {
      id: 'choose',
      label: '{app:notifications.emailTitle}',
      caption: { key: 'shorts.13-notification-emails.choose' },
      run: async (r, a, { t }) => {
        await a.clear()
        const toggle = r.page
          .locator('details[open]')
          .getByText(t('notifications.emailTitle'))
          .first()
        await r.click(toggle, { before: 80, after: 700 })
        const form = toggle.locator('xpath=ancestor::details[1]')
        await a.focus(form, 'Untick a group to stop<br>its emails. Yours alone.', {
          side: 'left',
          zoom: 1.6,
        })
        await r.page.waitForTimeout(2600)
      },
    },
    {
      id: 'save',
      label: 'Save',
      caption: { key: 'shorts.13-notification-emails.save' },
      run: async (r, a, { t }) => {
        const btn = r.page
          .locator('details[open]')
          .getByRole('button', { name: t('notifications.emailSave') })
          .last()
        await a.focus(btn, 'The bell keeps every alert;<br>email follows your choice', {
          side: 'left',
        })
        await r.point(btn, { ms: 300 })
        await r.page.waitForTimeout(2400)
      },
    },
  ],
}
