/**
 * Prove a carrier key works, against a real shipment, before anything depends
 * on it.
 *
 *     pnpm --filter @qabandi/service verify:tracking MAEU 123456789
 *     pnpm --filter @qabandi/service verify:tracking HLCU HLCUXYZ1234567 --bill
 *
 * The unit tests pin the translation and stub the network, which is what makes
 * them worth running in CI — but they cannot tell you that a Consumer-Key was
 * subscribed to the right product, that the tier issues a bearer, that the
 * gateway lives where the profile says, or that this carrier has ever heard of
 * this booking. Only a real call does that.
 *
 * It reads the environment directly rather than through `config.ts`, which
 * insists on a `DATABASE_URL` and an `INTERNAL_API_SECRET` first. That
 * insistence is right for the service and wrong here: somebody who has just
 * pasted a key out of a carrier portal should be able to test *that*, on a
 * laptop, with no database.
 *
 * Nothing is written anywhere. This only asks.
 */

import { loadEnv } from '@qabandi/db'
import type { TrackingQuery } from '../ports/index'
import { DCSA_CARRIERS, DcsaError, dcsaTracking, type DcsaCarrierProfile } from './dcsa-tracking'

function credentials(): Record<string, { key?: string; secret?: string }> {
  return {
    maersk: {
      key: process.env.DCSA_MAERSK_CONSUMER_KEY,
      secret: process.env.DCSA_MAERSK_CLIENT_SECRET,
    },
    hapag: {
      key: process.env.DCSA_HAPAG_CLIENT_ID,
      secret: process.env.DCSA_HAPAG_CLIENT_SECRET,
    },
    cmacgm: { key: process.env.DCSA_CMACGM_API_KEY },
  }
}

/**
 * Both halves of the URL, matching `carrier-tracking.ts`.
 *
 * The path as well as the host, because this script exists to reproduce what
 * the service does — a verifier that reads a different configuration from the
 * thing it is verifying will happily bless a setup that then fails at boot.
 */
function profiles(): DcsaCarrierProfile[] {
  const baseUrls: Record<string, string | undefined> = {
    maersk: process.env.DCSA_MAERSK_BASE_URL,
    hapag: process.env.DCSA_HAPAG_BASE_URL,
    cmacgm: process.env.DCSA_CMACGM_BASE_URL,
  }

  const paths: Record<string, string | undefined> = {
    maersk: process.env.DCSA_MAERSK_EVENTS_PATH,
    hapag: process.env.DCSA_HAPAG_EVENTS_PATH,
    cmacgm: process.env.DCSA_CMACGM_EVENTS_PATH,
  }

  /*
    `||` and not `??`, because this reads `process.env` raw rather than through
    `config.ts`. A blank `DCSA_MAERSK_BASE_URL=` line is the empty string, not
    undefined, and `??` would let it win over the profile's own host.
  */
  return DCSA_CARRIERS.map((profile) => ({
    ...profile,
    baseUrl: baseUrls[profile.key] || profile.baseUrl,
    eventsPath: paths[profile.key] || profile.eventsPath,
  }))
}

async function main(): Promise<void> {
  loadEnv()

  const [scac, reference, ...flags] = process.argv.slice(2)

  if (!scac || !reference) {
    console.error(
      'Usage: verify:tracking <SCAC> <reference> [--bill | --container]\n\n' +
        '  <SCAC>       MAEU, HLCU, CMDU — which carrier to ask\n' +
        '  <reference>  a booking number by default\n' +
        '  --bill       the reference is a master bill of lading\n' +
        '  --container  the reference is a container number\n',
    )
    process.exitCode = 1
    return
  }

  const adapter = dcsaTracking(credentials(), profiles())

  console.log('')
  console.log(`driver:     ${adapter.key}`)
  console.log(`carriers:   ${adapter.scacs.join(', ') || 'none configured'}`)
  console.log('')

  const query: TrackingQuery = {
    scac,
    reference,
    type: flags.includes('--bill')
      ? 'bill_of_lading'
      : flags.includes('--container')
        ? 'container'
        : 'booking_number',
  }

  console.log(`asking ${scac} about ${query.type} ${reference} …`)

  try {
    const reading = await adapter.read(query)

    if (reading.malformedReference) {
      /*
        Refused before the request, or by the carrier's own validation. Either
        way nothing is wrong with the key — the reference cannot match, and the
        fix is on the job rather than in the configuration.
      */
      console.log('')
      console.log(`  ${reading.malformedReference}`)
      console.log('')
      console.log('  The reference cannot match this carrier. Nothing was spent asking.')
      return
    }

    if (reading.unknownReference) {
      /*
        Worth calling out rather than reporting as an empty result. A carrier
        answers 404 for a reference it has never seen — a cancelled booking, a
        digit wrong, or a shipment belonging to somebody else's account. All
        three are a data problem and none of them is a broken key.
      */
      console.log('')
      console.log(`  ${scac} has never heard of this reference.`)
      console.log('  The key works. The reference does not — check it, and check that this')
      console.log('  account is a party to the shipment: carriers answer for their own only.')
      return
    }

    console.log('')
    console.log(`  milestones: ${reading.milestones.length}`)
    for (const milestone of reading.milestones) {
      console.log(
        `    ${milestone.occurredAt.toISOString()}  ${milestone.code.padEnd(16)} ${milestone.location ?? ''}`,
      )
    }

    const { etd, eta } = reading.estimates
    if (etd || eta) {
      console.log('')
      console.log(`  etd: ${etd?.toISOString() ?? '—'}`)
      console.log(`  eta: ${eta?.toISOString() ?? '—'}`)
    }

    if (reading.unmapped.length > 0) {
      /*
        Not a failure, and the most interesting line in the output.

        These are event kinds this build has no milestone template for. A
        carrier that has added one is how the vocabulary in `dcsa-events.ts`
        learns it is out of date, and reading it off a real shipment is
        cheaper than finding out when an SLA clock does not stop.
      */
      console.log('')
      console.log(`  not understood: ${reading.unmapped.join(', ')}`)
    }

    console.log('')
    console.log(
      reading.milestones.length > 0
        ? 'ok — this key reads real events. Set CARRIER_TRACKING_DRIVER=dcsa and the'
        : 'ok — the key works, but this shipment has no actual events yet. Estimates',
    )
    console.log(
      reading.milestones.length > 0
        ? 'hourly poll will put them on any job carrying this reference.'
        : 'only means the box has not moved, or the carrier publishes late.',
    )
  } catch (error) {
    console.log('')

    if (error instanceof DcsaError && !error.retryable) {
      console.error(`refused: ${error.message}`)
      console.error('')
      console.error('That is an authentication failure, not a bad reference. Check that:')
      console.error('  · the key is pasted whole, with no trailing newline')
      console.error('  · the portal application is subscribed to the tracking product')
      console.error('  · the base URL matches the environment the key was issued for')
      console.error('    (sandbox keys do not work against the production host)')
    } else {
      console.error(error instanceof Error ? error.message : String(error))
    }

    process.exitCode = 1
  }
}

await main()
