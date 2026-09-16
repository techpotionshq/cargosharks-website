/**
 * The default templates, against the event catalogue they exist for.
 *
 * No database. This is a consistency check between two lists that live in
 * different packages and are edited months apart — the exact shape of drift
 * that produced the invented milestone codes, where the adapter mapped to a
 * vocabulary the seed had never contained and everything downstream looked
 * healthy while delivering nothing.
 *
 * The failure this prevents is silent by construction: `renderTemplate`
 * substitutes an unknown merge field with an empty string, and a delivery with
 * no template is recorded as `failed` against one recipient and read by nobody.
 * Neither raises an alarm. A test is the only place either can be caught.
 */

import { describe, expect, it } from 'vitest'
import { NOTIFICATION_EVENTS, mergeFields, unknownMergeFields } from '@qabandi/core'
import { NOTIFICATION_TEMPLATES } from '../src/notification-templates'

const LOCALES = ['en', 'ar'] as const

describe('notification templates', () => {
  it('covers every declared event in both languages', () => {
    const missing: string[] = []

    for (const event of NOTIFICATION_EVENTS) {
      for (const locale of LOCALES) {
        const found = NOTIFICATION_TEMPLATES.some(
          (t) => t.eventKey === event.key && t.locale === locale && t.channel === 'email',
        )
        if (!found) missing.push(`${event.key} (${locale})`)
      }
    }

    expect(missing).toEqual([])
  })

  it('templates no event that does not exist', () => {
    const declared = new Set(NOTIFICATION_EVENTS.map((e) => e.key))
    const orphans = NOTIFICATION_TEMPLATES.filter((t) => !declared.has(t.eventKey)).map(
      (t) => t.eventKey,
    )

    expect(orphans).toEqual([])
  })

  it('has exactly one default row per event, channel and language', () => {
    const seen = new Map<string, number>()
    for (const t of NOTIFICATION_TEMPLATES) {
      const key = `${t.eventKey}/${t.channel}/${t.locale}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }

    // A duplicate would not fail the seed — it would violate the unique
    // constraint at insert and take the whole seed down with it.
    expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([])
  })

  /**
   * The check that matters most.
   *
   * `{{amount}}` where the event carries `{{total}}` renders as a blank space
   * in a customer's inbox — "Amount:  KWD" — and no log line anywhere records
   * that it happened.
   */
  it('uses no merge field its event does not carry', () => {
    const wrong: string[] = []

    for (const template of NOTIFICATION_TEMPLATES) {
      for (const unknown of unknownMergeFields(template.eventKey, template.subject)) {
        wrong.push(`${template.eventKey} (${template.locale}) subject: {{${unknown}}}`)
      }
      for (const unknown of unknownMergeFields(template.eventKey, template.body)) {
        wrong.push(`${template.eventKey} (${template.locale}) body: {{${unknown}}}`)
      }
    }

    expect(wrong).toEqual([])
  })

  /**
   * And the converse: a field nobody uses.
   *
   * Every declared field costs something at the raise site — a wider select, a
   * join, a formatted date. One that reaches no template is work done on every
   * event for a value that is discarded, and it is usually the fossil of a
   * template that was reworded.
   */
  it('declares no field that no template uses', () => {
    const unused: string[] = []

    for (const event of NOTIFICATION_EVENTS) {
      const used = new Set(
        NOTIFICATION_TEMPLATES.filter((t) => t.eventKey === event.key).flatMap((t) => [
          ...mergeFields(t.subject),
          ...mergeFields(t.body),
        ]),
      )
      for (const field of event.fields) {
        if (!used.has(field)) unused.push(`${event.key}.${field}`)
      }
    }

    expect(unused).toEqual([])
  })

  it('has a subject and a body on every row', () => {
    for (const t of NOTIFICATION_TEMPLATES) {
      expect(t.subject.trim(), `${t.eventKey} (${t.locale}) subject`).not.toBe('')
      expect(t.body.trim(), `${t.eventKey} (${t.locale}) body`).not.toBe('')
      // Trimmed at construction, so a leading blank line never reaches a mail
      // client as an empty first paragraph.
      expect(t.body).toBe(t.body.trim())
    }
  })

  /**
   * The Arabic row is actually Arabic.
   *
   * A copy-paste that leaves the English text under `locale: 'ar'` is invisible
   * in review — the row is present, the seed succeeds, the coverage test above
   * passes — and it is only found by an Arabic-speaking customer receiving
   * English, which is the worst possible reviewer to leave it to.
   */
  it('writes the Arabic rows in Arabic', () => {
    /*
      The rule is "no English prose", not "contains Arabic".

      `job.milestone_reached` has the Arabic subject `{{reference}}:
      {{milestoneAr}}` — entirely merge fields, and correct: the reference is
      Latin either way and the milestone name arrives already translated.
      Demanding an Arabic character would fail that row and teach whoever hits
      it to weaken the test. Asking instead that no English *word* survives the
      merge fields catches the copy-paste this exists for and nothing else.
    */
    const withoutMergeFields = (s: string): string => s.replace(/\{\{\w+\}\}/g, ' ')
    const englishWord = /[A-Za-z]{2,}/

    for (const t of NOTIFICATION_TEMPLATES.filter((t) => t.locale === 'ar')) {
      expect(
        englishWord.exec(withoutMergeFields(t.subject))?.[0] ?? null,
        `${t.eventKey} Arabic subject contains English`,
      ).toBeNull()
      expect(
        englishWord.exec(withoutMergeFields(t.body))?.[0] ?? null,
        `${t.eventKey} Arabic body contains English`,
      ).toBeNull()
    }
  })

  it('signs every outbound message with the branch that sent it', () => {
    // Multi-entity is a selling point (§5.3). A template that hard-coded one
    // company name would sign a Dubai shipment as the Kuwait entity.
    //
    // In-app is exempt, and it is the one channel that should be: it is read by
    // the person it is about, in a panel that already names who is signed in,
    // so a "{{senderName}}" line would be a signature on a note to oneself —
    // the same mail-merge-that-escaped this rule exists to catch, arriving from
    // the other direction. The rule is about correspondence leaving the
    // building; the bell never does.
    for (const t of NOTIFICATION_TEMPLATES.filter((t) => t.channel !== 'in_app')) {
      expect(t.body, `${t.eventKey} (${t.locale})`).toContain('{{senderName}}')
    }
  })
})
