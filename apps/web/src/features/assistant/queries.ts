/**
 * Whether the assistant can run at all — answered on the server, before render.
 *
 * The panel used to find this out by asking, which put the discovery in the
 * wrong place twice over. A launcher was drawn, a person clicked it, a request
 * went out, and only then did anything say there was no key — and while the
 * dock was closed nothing had asked at all, so the button that opened it was
 * always offered whether or not it led anywhere.
 *
 * Resolved here instead, from the same row the service reads. Three things
 * fall out of that and all three matter:
 *
 *   - the launcher and the nav entry can simply not be offered;
 *   - there is no round trip to the service to decide it;
 *   - and `apps/web` and `apps/service` cannot disagree about it, because
 *     `resolveIntegration` is the one function that answers the question.
 *
 * ## It never opens a secret
 *
 * `hasSecret` reports *presence*, from the sealed row or from the environment
 * beneath it, and nothing here calls `openSecret`. The web app has no business
 * holding an OpenRouter key in memory to decide whether to draw a button, and
 * a check that decrypted one would be a key in a render path for no reason.
 */

import { cache } from 'react'
import {
  integrationSpec,
  readIntegrationRow,
  resolveIntegration,
  systemActor,
  withActor,
} from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotIntegrationSettings } from '@/lib/pilot/fixtures'

/**
 * Resolved once per request.
 *
 * `cache` is React's per-request memo, not a shared cache — the layout and the
 * page both ask, and two identical reads of one row per page view is one more
 * than needed. It does not outlive the request, so a key added on the settings
 * screen takes effect on the next navigation rather than on a restart.
 */
export const assistantConfigured = cache(async (): Promise<boolean> => {
  const spec = integrationSpec('ai')
  if (!spec) return false

  /*
    Only the row comes from fixtures. `resolveIntegration` still decides.

    The alternative — `if (usePilotFixtures()) return true` — would be a second
    answer to "is the assistant configured", and this question already has a
    resolver whose whole job is to merge a row over the environment over the
    catalogue. Handing it the fixture row keeps one implementation, so a change
    to what counts as configured cannot take effect in one mode and not the
    other.
  */
  if (usePilotFixtures()) {
    const row = pilotIntegrationSettings().find((candidate) => candidate.key === 'ai')
    return resolveIntegration(spec, row).hasSecret.apiKey === true
  }

  try {
    /*
      The system actor, and only here.

      `integration_settings` is not branch-scoped and its policy conditions on
      an administrative permission, so a coordinator reading it under their own
      actor would correctly see nothing — and would then be told the assistant
      is unconfigured on a deployment where it works perfectly. The row holds no
      customer data and nothing is decrypted; what is read is whether a key
      exists.
    */
    const row = await withActor(systemActor(), (tx) => readIntegrationRow(tx, 'ai'))
    return resolveIntegration(spec, row).hasSecret.apiKey === true
  } catch {
    /*
      A database that cannot be read is not a configuration answer.

      Reported as unconfigured because that is the safe direction: the panel
      offers a setting to check instead of a composer that would fail on the
      first question. The alternative — assuming it works — produces a
      spinner and then an error, which is a worse way to learn the same thing.
    */
    return false
  }
})
