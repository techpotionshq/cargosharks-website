/**
 * The row wins, the environment answers beneath it — FR-AD-03.
 *
 * This is the one rule in the integration change that must not be implemented
 * twice, because two implementations of it disagree in the worst possible
 * place: the settings screen would report "set in the environment" while the
 * service read a row, which is a confident wrong answer to the only question
 * anybody asks of a settings page.
 *
 * Four properties are pinned here and each one is a real failure that this
 * resolution order is chosen to avoid:
 *
 *   - **A deployment with no rows behaves exactly as before.** Every existing
 *     install has no rows, so this is the whole claim that the change is
 *     additive rather than a migration everybody has to perform.
 *   - **Blank is unset, not empty.** A form posts empty strings for fields
 *     nobody touched. Treating one as a value means an empty string beats the
 *     environment default it was meant to fall through to — and `new URL('')`
 *     throws, from a deployment that did nothing wrong.
 *   - **An inactive row answers nothing.** That is what makes deactivating a
 *     rollback rather than a wipe: the deployment goes back to how it was
 *     configured, and nothing typed is lost.
 *   - **Nothing here opens a credential.** `apps/web` imports this module to
 *     render a settings screen, and must not be able to read a key back out
 *     even by accident.
 */

import { describe, expect, it } from 'vitest'
import { integrationSpec } from '@qabandi/core'
import { resolveIntegration, withoutSealed } from '../src/integrations'
import type { IntegrationSettings } from '../src/schema/settings'

const smtp = integrationSpec('smtp')!
const fx = integrationSpec('fx')!

/** A row, with only the parts the resolver reads worth spelling out. */
const row = (over: Partial<IntegrationSettings> = {}): IntegrationSettings =>
  ({
    id: '00000000-0000-7000-8000-000000000001',
    key: 'smtp',
    driver: null,
    settings: {},
    secrets: {},
    isActive: true,
    lastCheckedAt: null,
    lastOkAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as IntegrationSettings

const ENV = {
  SMTP_HOST: 'relay.env.test',
  SMTP_PORT: '587',
  SMTP_PASSWORD: 'from-the-environment',
  MAIL_FROM: 'env@qabandi.test',
  MAIL_DRIVER: 'smtp',
} as NodeJS.ProcessEnv

describe('resolving an integration', () => {
  describe('a deployment that has never opened the settings screen', () => {
    /** The whole claim that this change is additive. */
    it('answers exactly what the environment says', () => {
      const resolved = resolveIntegration(smtp, undefined, ENV)

      expect(resolved.settings.host).toBe('relay.env.test')
      expect(resolved.settings.port).toBe('587')
      expect(resolved.sources.host).toBe('env')
      expect(resolved.driver).toBe('smtp')
      expect(resolved.driverSource).toBe('env')
    })

    it('reports a credential as present without revealing it', () => {
      const resolved = resolveIntegration(smtp, undefined, ENV)

      expect(resolved.hasSecret.password).toBe(true)
      // Present in the environment is not sealed on a row, and `sealed` only
      // ever carries the latter.
      expect(resolved.sealed.password).toBeUndefined()
    })

    it('names what is still missing, and only for a live driver', () => {
      expect(resolveIntegration(smtp, undefined, {}).missing).toContain('host')
      expect(resolveIntegration(smtp, undefined, { MAIL_DRIVER: 'log' }).missing).toEqual([])
    })
  })

  describe('a row over the environment', () => {
    it('lets a stored value win', () => {
      const resolved = resolveIntegration(smtp, row({ settings: { host: 'relay.row.test' } }), ENV)

      expect(resolved.settings.host).toBe('relay.row.test')
      expect(resolved.sources.host).toBe('row')
      // The field the row said nothing about still falls through.
      expect(resolved.settings.port).toBe('587')
      expect(resolved.sources.port).toBe('env')
    })

    /**
     * The `blankIsUnset` rule, which the service config learned the hard way.
     *
     * A form posts `''` for every field nobody touched. Reading that as a
     * value means the empty string beats the environment default it was meant
     * to fall through to, and the symptom downstream is `new URL('')` throwing
     * on a deployment that did exactly what it was told.
     */
    it('treats a blank stored value as absent', () => {
      const resolved = resolveIntegration(smtp, row({ settings: { host: '   ' } }), ENV)

      expect(resolved.settings.host).toBe('relay.env.test')
      expect(resolved.sources.host).toBe('env')
    })

    /** A switch is stored as a boolean and read back as a string. */
    it('reads a stored boolean as a string, so a caller cannot compare wrongly', () => {
      const resolved = resolveIntegration(smtp, row({ settings: { secure: false } }), ENV)

      expect(resolved.settings.secure).toBe('false')
      expect(resolved.sources.secure).toBe('row')
    })

    it('lets a row choose the driver', () => {
      const resolved = resolveIntegration(smtp, row({ driver: 'log' }), ENV)

      expect(resolved.driver).toBe('log')
      expect(resolved.driverSource).toBe('row')
      expect(resolved.live).toBe(false)
    })

    /**
     * A row that exists but has never had its driver set must not quietly
     * switch a deployment off `MAIL_DRIVER=log` by being created — somebody
     * saving a host name has not asked for mail to start going out.
     */
    it('does not take over the driver by existing', () => {
      const resolved = resolveIntegration(smtp, row({ settings: { host: 'relay.row.test' } }), {
        ...ENV,
        MAIL_DRIVER: 'log',
      })

      expect(resolved.driver).toBe('log')
      expect(resolved.driverSource).toBe('env')
    })
  })

  describe('an inactive row', () => {
    /** Deactivating is a rollback, not a wipe. */
    it('answers nothing and lets the environment through', () => {
      const resolved = resolveIntegration(
        smtp,
        row({ isActive: false, driver: 'log', settings: { host: 'relay.row.test' } }),
        ENV,
      )

      expect(resolved.settings.host).toBe('relay.env.test')
      expect(resolved.sources.host).toBe('env')
      expect(resolved.driver).toBe('smtp')
      expect(resolved.isActive).toBe(false)
    })

    /** And what was typed is still there to switch back on. */
    it('keeps the row reported as inactive rather than absent', () => {
      const resolved = resolveIntegration(smtp, row({ isActive: false }), ENV)
      expect(resolved.isActive).toBe(false)
    })
  })

  describe('credentials', () => {
    it('carries sealed ciphertext and never a plaintext value', () => {
      const sealed = 'v1:aaaa:bbbb:cccc'
      const resolved = resolveIntegration(smtp, row({ secrets: { password: sealed } }), ENV)

      expect(resolved.sealed.password).toBe(sealed)
      expect(resolved.hasSecret.password).toBe(true)
      expect(JSON.stringify(resolved)).not.toContain('from-the-environment')
    })

    /**
     * The shape `apps/web` renders from.
     *
     * A separate function rather than a flag, because a flag defaulting the
     * wrong way is how a credential reaches a browser — and a call site that
     * has to name what it wants cannot get it by omission.
     */
    it('can be stripped of ciphertext for the browser', () => {
      const resolved = withoutSealed(
        resolveIntegration(smtp, row({ secrets: { password: 'v1:a:b:c' } }), ENV),
      )

      expect(resolved.sealed).toEqual({})
      // Presence survives — the screen still says "stored".
      expect(resolved.hasSecret.password).toBe(true)
    })

    it('counts a required credential as missing only when neither layer has one', () => {
      const einvoice = integrationSpec('einvoice')!

      expect(
        resolveIntegration(einvoice, row({ key: 'einvoice', driver: 'asp' }), {}).missing,
      ).toContain('apiKey')
      expect(
        resolveIntegration(einvoice, row({ key: 'einvoice', driver: 'none' }), {}).missing,
      ).toEqual([])
    })
  })

  describe('an integration nobody has configured anywhere', () => {
    it('resolves rather than throwing, and reports what it lacks', () => {
      const resolved = resolveIntegration(fx, undefined, {})

      expect(resolved.driver).toBe('manual')
      expect(resolved.live).toBe(false)
      // `manual` is a real implementation, so nothing is missing.
      expect(resolved.missing).toEqual([])
      expect(resolved.settings.url).toBeUndefined()
    })
  })
})
