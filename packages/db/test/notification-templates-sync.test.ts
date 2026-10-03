/**
 * The boot-time template sync, against a real database.
 *
 * A deployment runs migrations, not the seed, so the service writes the default
 * templates itself at boot. What is pinned: every default row exists after a
 * sync, a second sync adds nothing, a branch's own wording is left alone, and
 * a default row an administrator saved keeps its wording while an unedited one
 * is refreshed to the shipped copy.
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

  /** The default row for a template, read as the system principal. */
  const defaultRow = (template: (typeof NOTIFICATION_TEMPLATES)[number]) =>
    withActor(systemActor(), (tx) =>
      tx
        .select()
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.eventKey, template.eventKey),
            eq(notificationTemplates.channel, template.channel),
            eq(notificationTemplates.locale, template.locale),
            isNull(notificationTemplates.branchId),
          ),
        ),
    ).then((rows) => rows[0])

  it("keeps an administrator's wording of a default row, and refreshes an unedited one", async () => {
    const edited = NOTIFICATION_TEMPLATES[1]!
    const stale = NOTIFICATION_TEMPLATES[2]!
    await withActor(systemActor(), (tx) => syncNotificationTemplates(tx))

    const wording = `Admin wording ${Date.now()}`
    await withActor(systemActor(), async (tx) => {
      // What the template editor writes when it saves a default row in place.
      await tx
        .update(notificationTemplates)
        .set({ subject: wording, body: wording, customisedAt: new Date() })
        .where(eq(notificationTemplates.id, (await defaultRow(edited))!.id))
      // A row still holding old vendor copy, never touched by a person.
      await tx
        .update(notificationTemplates)
        .set({ body: 'Old vendor copy' })
        .where(eq(notificationTemplates.id, (await defaultRow(stale))!.id))
    })

    await withActor(systemActor(), (tx) => syncNotificationTemplates(tx))

    const keptRow = await defaultRow(edited)
    expect(keptRow?.subject).toBe(wording)
    expect(keptRow?.body).toBe(wording)
    expect((await defaultRow(stale))?.body).toBe(stale.body)
  })

  it('inserts a default row that is missing', async () => {
    const missing = NOTIFICATION_TEMPLATES[3]!
    const row = await defaultRow(missing)
    // Nothing is deleted by the application role, so the test moves the row
    // aside to a key no template uses, which is what "missing" looks like.
    await withActor(systemActor(), (tx) =>
      tx
        .update(notificationTemplates)
        .set({ eventKey: `retired.${Date.now()}`, isActive: false })
        .where(eq(notificationTemplates.id, row!.id)),
    )
    expect(await defaultRow(missing)).toBeUndefined()

    await withActor(systemActor(), (tx) => syncNotificationTemplates(tx))
    const restored = await defaultRow(missing)
    expect(restored?.body).toBe(missing.body)
    expect(restored?.customisedAt).toBeNull()
  })
})
