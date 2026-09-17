/**
 * The integration catalogue — FR-AD-03.
 *
 * Two things are worth testing here and the rest is a data literal.
 *
 * **`pollRunsPerHour` decides whether a rate limit is respected.** It is the
 * right-hand half of `batch × runs-per-hour ≤ the carrier's cap`, the
 * arithmetic `.env.example` used to leave an operator to do by hand. Getting it
 * wrong in the *safe* direction wastes a form validation; getting it wrong in
 * the other tells somebody a schedule is affordable when it spends four times
 * the quota, and the failure that follows is a 429 that looks exactly like a
 * carrier with nothing to say.
 *
 * So an unrecognised expression must return null rather than a guess. A wrong
 * reassurance about a rate limit is worse than no reassurance.
 *
 * **`isLiveDriver` decides what a save demands.** `manual` and `none` are real
 * implementations rather than absences, so a form that treated them as live
 * would demand a provider URL before somebody had appointed a provider.
 */

import { describe, expect, it } from 'vitest'
import {
  INTEGRATIONS,
  INTEGRATION_KEYS,
  integrationEnvKeys,
  integrationSpec,
  isLiveDriver,
  pollRunsPerHour,
} from '../src/integrations'

describe('the integration catalogue', () => {
  describe('what it declares', () => {
    it('gives every integration a unique key', () => {
      expect(new Set(INTEGRATION_KEYS).size).toBe(INTEGRATION_KEYS.length)
    })

    /**
     * The message catalogue nests on `.`, so a dotted key would resolve as two
     * levels — `keys.carrier.poll` reading as `keys → carrier → poll`. It
     * happens to work and it is a trap: the first key with a dot in a name
     * that is also an integration produces a silent collision.
     */
    it('keeps a key usable as a message path and a form field name', () => {
      for (const key of INTEGRATION_KEYS) {
        expect(key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/)
      }
      for (const spec of INTEGRATIONS) {
        for (const field of spec.fields) expect(field.name).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/)
        for (const secret of spec.secrets) expect(secret.name).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/)
      }
    })

    /**
     * A field and a secret sharing a name would collide in the form: one
     * `FormData` key, read once as a setting and once as a credential, and the
     * credential would be written into `settings` in clear.
     */
    it('never gives a field and a secret the same name', () => {
      for (const spec of INTEGRATIONS) {
        const fields = spec.fields.map((f) => f.name)
        const secrets = spec.secrets.map((s) => s.name)
        expect(fields.filter((name) => secrets.includes(name))).toEqual([])
      }
    })

    /** Every field names the variable it takes over from, and names it once. */
    it('maps each setting to exactly one environment variable', () => {
      const seen = new Map<string, string>()

      for (const spec of INTEGRATIONS) {
        for (const entry of [...spec.fields, ...spec.secrets]) {
          const owner = seen.get(entry.env)
          expect(owner ?? spec.key).toBe(spec.key)
          seen.set(entry.env, spec.key)
        }
      }

      expect(integrationEnvKeys()).toContain('SMTP_HOST')
      expect(integrationEnvKeys()).toContain('DCSA_MAERSK_CONSUMER_KEY')
    })

    /** A driver default that is not one of the drivers is unselectable. */
    it('offers its default driver as one of the choices', () => {
      for (const spec of INTEGRATIONS) {
        if (!spec.drivers || !spec.defaultDriver) continue
        expect(spec.drivers.map((d) => d.value)).toContain(spec.defaultDriver)
      }
    })

    /**
     * Every default is the Release One behaviour: nothing switches on because
     * a variable was left in an example file. Two of these are recurring
     * per-unit costs and one is a contract with a tax authority.
     */
    it('defaults the paid integrations to off', () => {
      expect(integrationSpec('fx')?.defaultDriver).toBe('manual')
      expect(integrationSpec('carrierTracking')?.defaultDriver).toBe('manual')
      expect(integrationSpec('einvoice')?.defaultDriver).toBe('none')
    })

    /*
      Auto-fanout mails real agents, so it ships dark like the paid feeds: the
      inert `manual` driver until an administrator switches it to `auto`.
    */
    it('defaults automatic rate procurement to off', () => {
      const spec = integrationSpec('rateAutoFanout')
      expect(spec?.defaultDriver).toBe('manual')
      expect(spec?.drivers?.find((d) => d.value === 'manual')?.live).toBe(false)
      expect(spec?.drivers?.find((d) => d.value === 'auto')?.live).toBe(true)
    })

    /* Auto-accept writes to the enquiry unattended, so it too ships dark. */
    it('defaults enquiry auto-accept to off', () => {
      const spec = integrationSpec('enquiryAutoAccept')
      expect(spec?.defaultDriver).toBe('manual')
      expect(spec?.drivers?.find((d) => d.value === 'auto')?.live).toBe(true)
    })
  })

  describe('which drivers demand their fields', () => {
    it('treats the Release One driver as needing nothing', () => {
      const fx = integrationSpec('fx')!
      expect(isLiveDriver(fx, 'manual')).toBe(false)
      expect(isLiveDriver(fx, 'api')).toBe(true)
    })

    /** No driver switch at all means the settings always apply. */
    it('treats an integration with no drivers as always live', () => {
      expect(isLiveDriver(integrationSpec('carrierPoll')!, undefined)).toBe(true)
    })

    /** Nothing chosen falls to the catalogue default, not to "live". */
    it('falls back to the default when nothing is chosen', () => {
      expect(isLiveDriver(integrationSpec('einvoice')!, undefined)).toBe(false)
    })

    /**
     * `log` is a deliberate choice with a working implementation, not an
     * absence — but it needs no host and no credential, so a save must not
     * demand them.
     */
    it('does not demand a relay to write mail to the log', () => {
      const smtp = integrationSpec('smtp')!
      expect(isLiveDriver(smtp, 'log')).toBe(false)
      expect(isLiveDriver(smtp, 'smtp')).toBe(true)
    })
  })

  describe('reading a schedule as calls per hour', () => {
    it('reads the shapes a deployment actually uses', () => {
      expect(pollRunsPerHour('30 * * * *')).toBe(1)
      expect(pollRunsPerHour('* * * * *')).toBe(60)
      expect(pollRunsPerHour('*/30 * * * *')).toBe(2)
      expect(pollRunsPerHour('*/10 * * * *')).toBe(6)
      expect(pollRunsPerHour('*/15 * * * *')).toBe(4)
      expect(pollRunsPerHour('0,30 * * * *')).toBe(2)
    })

    it('is not confused by surrounding whitespace', () => {
      expect(pollRunsPerHour('  30   *  * * * ')).toBe(1)
    })

    /**
     * The whole reason this returns a nullable number.
     *
     * A guess here is a number an administrator compares against a carrier's
     * published cap and acts on. Anything the parser does not genuinely
     * understand has to say so, and the screen renders "cannot be checked"
     * rather than a figure it invented.
     */
    it('refuses to guess at anything else', () => {
      // A stepped *hour* field is read as one run — see the case below.
      expect(pollRunsPerHour('30 ' + '*/2 * * *')).toBe(1)
      expect(pollRunsPerHour('H/5 * * * *')).toBeNull()
      expect(pollRunsPerHour('*/0 * * * *')).toBeNull()
      expect(pollRunsPerHour('*/90 * * * *')).toBeNull()
      expect(pollRunsPerHour('30 * * *')).toBeNull()
      expect(pollRunsPerHour('')).toBeNull()
      expect(pollRunsPerHour('@hourly')).toBeNull()
    })

    /*
      A known and deliberate over-estimate.

      A schedule that restricts the *hour* field — a stepped or ranged hour,
      such as an every-two-hours poll — really runs less often than this
      reports, because only the minute field is read. That errs towards thinking the schedule spends more
      of the quota than it does, which is the safe direction: the number exists
      to stop somebody exceeding a cap, never to reassure them they are under
      one.
    */
    it('over-estimates rather than under-estimates a restricted hour field', () => {
      expect(pollRunsPerHour('*/10 9-17 * * *')).toBe(6)
    })
  })
})
