/**
 * The boot-time template sync, against a real database.
 *
 * A deployment runs migrations, not the seed, so the service writes the default
 * templates itself at boot. What is pinned: every default row exists after a
 * sync, a second sync adds nothing, and a branch's own wording is left alone.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, isNull, sql } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { withActor, systemActor } = await import('../src/actor')
const { NOTIFICATION_TEMPLATES, syncNotificationTemplates } =
  await import('../src/notification-templates')
const { notificationTemplates } = await import('../src/schema/index')

const defaults = () =>
  withActor(systemActor(), (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationTemplates)
      .where(isNull(notificationTemplates.branchId)),
  ).then(([row]) => row!.n)

describe.skipIf(!enabled)('syncNotificationTemplates', () => {
  let branchBody: string | null = null
  const sample = NOTIFICATION_TEMPLATES[0]!

  beforeAll(async () => {
    // A branch's own wording for the first template, if the database has a branch.
    await withActor(systemActor(), async (tx) => {
      const [branch] = await tx
        .execute(sql`select id from branches limit 1`)
        .then((r) => r.rows as { id: string }[])
      if (!branch) return
      branchBody = `Branch wording ${Date.now()}`
      await tx
        .insert(notificationTemplates)
        .values({
          eventKey: sample.eventKey,
          channel: sample.channel,
          locale: sample.locale,
          branchId: branch.id,
          subject: sample.subject,
          body: branchBody,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [
            notificationTemplates.eventKey,
            notificationTemplates.channel,
            notificationTemplates.locale,
            notificationTemplates.branchId,
          ],
          set: { body: branchBody },
        })
    })
  })

  afterAll(() => undefined)

  it('writes every default row, and a second run adds nothing', async () => {
    await withActor(systemActor(), (tx) => syncNotificationTemplates(tx))
    const once = await defaults()
    expect(once).toBeGreaterThanOrEqual(NOTIFICATION_TEMPLATES.length)

    await withActor(systemActor(), (tx) => syncNotificationTemplates(tx))
    expect(await defaults()).toBe(once)
  })

  it('leaves a branch row alone', async () => {
    if (!branchBody) return
    await withActor(systemActor(), (tx) => syncNotificationTemplates(tx))
    const rows = await withActor(systemActor(), (tx) =>
      tx
        .select({ body: notificationTemplates.body })
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.eventKey, sample.eventKey),
            eq(notificationTemplates.channel, sample.channel),
            eq(notificationTemplates.locale, sample.locale),
            sql`${notificationTemplates.branchId} is not null`,
          ),
        ),
    )
    expect(rows.map((r) => r.body)).toContain(branchBody)
  })
})
