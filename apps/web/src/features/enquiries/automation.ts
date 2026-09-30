import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import {
  extractionProposals,
  notificationOutbox,
  rateRequests,
  withActor,
  type Actor,
} from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'

/**
 * What the automations have done to one enquiry, for the activity strip.
 *
 * A read model kept in the slice rather than in `lib/pilot/types`: nothing else
 * shares it, and the strip is the only screen that reads it. Each field is a
 * count or a timestamp the enquiry screen turns into one line — "acknowledged ·
 * N fields read · N rate requests out" — so a coordinator sees the machine
 * working on their enquiry rather than having to infer it from three panels.
 */
export interface EnquiryAutomation {
  /** When the customer was auto-acknowledged, or null (unknown sender, or manual). */
  readonly acknowledgedAt: Date | null
  /** Fields the model read off the email — proposals it has ever made here. */
  readonly fieldsRead: number
  /** Fields still waiting for a person to confirm. */
  readonly fieldsPending: number
  /** Rate requests sent to agents for this enquiry (not superseded). */
  readonly rateRequestsSent: number
  /** Of those, how many an agent has replied to. */
  readonly rateRepliesIn: number
}

export async function enquiryAutomation(
  actor: Actor,
  enquiryId: string,
): Promise<EnquiryAutomation> {
  if (usePilotFixtures()) {
    // The demo enquiry, shown mid-automation: acknowledged, read, two RFQs out.
    return {
      acknowledgedAt: new Date(Date.now() - 1000 * 60 * 18),
      fieldsRead: 9,
      fieldsPending: 3,
      rateRequestsSent: 4,
      rateRepliesIn: 2,
    }
  }
  if (!enquiryId) {
    return {
      acknowledgedAt: null,
      fieldsRead: 0,
      fieldsPending: 0,
      rateRequestsSent: 0,
      rateRepliesIn: 0,
    }
  }

  return withActor(actor, async (tx) => {
    const [ack] = await tx
      .select({ at: notificationOutbox.createdAt })
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.enquiryId, enquiryId),
          eq(notificationOutbox.eventKey, 'enquiry.received'),
        ),
      )
      .orderBy(notificationOutbox.createdAt)
      .limit(1)

    const [fields] = await tx
      .select({
        read: sql<number>`count(*)`,
        pending: sql<number>`count(*) filter (where ${extractionProposals.status} = 'proposed')`,
      })
      .from(extractionProposals)
      .where(
        and(
          eq(extractionProposals.targetTable, 'enquiries'),
          eq(extractionProposals.targetId, enquiryId),
        ),
      )

    const [rfq] = await tx
      .select({
        sent: sql<number>`count(*)`,
        replied: sql<number>`count(*) filter (where ${rateRequests.status} in ('responded','parsed','accepted'))`,
      })
      .from(rateRequests)
      .where(and(eq(rateRequests.enquiryId, enquiryId), ne(rateRequests.status, 'superseded')))

    return {
      acknowledgedAt: ack?.at ?? null,
      fieldsRead: Number(fields?.read ?? 0),
      fieldsPending: Number(fields?.pending ?? 0),
      rateRequestsSent: Number(rfq?.sent ?? 0),
      rateRepliesIn: Number(rfq?.replied ?? 0),
    }
  })
}
