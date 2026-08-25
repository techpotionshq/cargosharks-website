/**
 * Which connections are allowed to go unencrypted, and which refuse to start.
 *
 * `resolveSsl` is small, but it is the kind of small where every branch is a
 * security posture, and three of them are easy to get backwards. The cases
 * below are the ones that would actually cost something:
 *
 *   - **An explicit `sslmode=` in the connection string wins.** An operator who
 *     has already secured the link must not have it silently replaced by our
 *     default, and a "secure by default" flag that downgrades somebody's
 *     verified connection is worse than no flag.
 *   - **Production against a remote host refuses to start.** This is the whole
 *     point of the change: shipping credentials in clear across a network
 *     because nobody chose is not a state the process should be able to reach.
 *   - **Production against loopback is fine.** Otherwise the refusal is theatre
 *     that every local deployment learns to switch off, and a flag people
 *     habitually disable protects nothing.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveSsl } from '../src/client'

const REMOTE = 'postgres://app_user:pw@db.example.com:5432/qabandi'
const LOCAL = 'postgres://app_user:pw@127.0.0.1:5432/qabandi'

const saved = {
  ssl: process.env.DATABASE_SSL,
  ca: process.env.DATABASE_CA_CERT,
  env: process.env.NODE_ENV,
}

beforeEach(() => {
  delete process.env.DATABASE_SSL
  delete process.env.DATABASE_CA_CERT
})

afterEach(() => {
  // Restored rather than deleted: NODE_ENV in particular is read by things
  // outside this file, and leaving it unset leaks into whatever runs next.
  for (const [key, value] of [
    ['DATABASE_SSL', saved.ssl],
    ['DATABASE_CA_CERT', saved.ca],
    ['NODE_ENV', saved.env],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('resolveSsl', () => {
  it('leaves an explicit sslmode in the connection string alone', () => {
    process.env.DATABASE_SSL = 'require'
    expect(resolveSsl(`${REMOTE}?sslmode=verify-full`)).toBeUndefined()
  })

  it('encrypts without verifying on require', () => {
    process.env.DATABASE_SSL = 'require'
    expect(resolveSsl(REMOTE)).toEqual({ rejectUnauthorized: false })
  })

  it('verifies against the named authority on verify-full', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qabandi-ca-'))
    const path = join(dir, 'ca.pem')
    writeFileSync(path, '-----BEGIN CERTIFICATE-----\nnot-a-real-one\n')
    process.env.DATABASE_SSL = 'verify-full'
    process.env.DATABASE_CA_CERT = path

    expect(resolveSsl(REMOTE)).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nnot-a-real-one\n',
    })
  })

  it('refuses verify-full with nothing to verify against', () => {
    process.env.DATABASE_SSL = 'verify-full'
    expect(() => resolveSsl(REMOTE)).toThrow(/DATABASE_CA_CERT/)
  })

  it('refuses a value it does not recognise rather than guessing', () => {
    process.env.DATABASE_SSL = 'prefer'
    expect(() => resolveSsl(REMOTE)).toThrow(/not one of/)
  })

  it('allows an unencrypted link when that is the recorded decision', () => {
    process.env.DATABASE_SSL = 'disable'
    process.env.NODE_ENV = 'production'
    expect(resolveSsl(REMOTE)).toBeUndefined()
  })

  it('refuses to start in production against a remote host with no decision made', () => {
    process.env.NODE_ENV = 'production'
    expect(() => resolveSsl(REMOTE)).toThrow(/clear text/)
  })

  it('allows production against loopback, where there is no network to cross', () => {
    process.env.NODE_ENV = 'production'
    expect(resolveSsl(LOCAL)).toBeUndefined()
    expect(resolveSsl('postgres:///qabandi')).toBeUndefined()
  })

  it('does not refuse outside production, where a developer database is normal', () => {
    process.env.NODE_ENV = 'development'
    expect(resolveSsl(REMOTE)).toBeUndefined()
  })
})
