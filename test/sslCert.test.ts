/**
 * Regression tests for the localhost certificate trust check.
 *
 * The Windows trust detection used to look the certificate up by "BSV Desktop",
 * which is the organization name. certutil resolves a name-style certificate ID
 * against the common name — "localhost" here — so the lookup always failed with
 * NTE_NOT_FOUND, the app concluded the certificate was untrusted, and it
 * re-prompted on every launch even though the certificate was installed.
 *
 * Detection now keys off the SHA-1 thumbprint, so these tests pin the
 * thumbprint computation against Node's own X.509 parser.
 */

import { describe, it, expect, vi } from 'vitest'
import { X509Certificate } from 'crypto'
import forge from 'node-forge'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bsv-desktop-test' },
  dialog: { showMessageBox: async () => ({ response: 1 }) },
  clipboard: { writeText: () => {} },
  net: { request: () => { throw new Error('probe unavailable in tests') } },
}))

let sslCert: typeof import('../electron/sslCert')

/** Builds a self-signed localhost cert with the same shape the app generates. */
function makeLocalhostCert(): string {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'countryName', value: 'US' },
    { shortName: 'ST', value: 'California' },
    { name: 'localityName', value: 'San Francisco' },
    { name: 'organizationName', value: 'BSV Desktop' },
    { shortName: 'OU', value: 'Development' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())

  return forge.pki.certificateToPem(cert)
}

describe('getCertSha1Thumbprint', () => {
  it('matches the SHA-1 fingerprint reported by Node\'s X.509 parser', async () => {
    sslCert = await import('../electron/sslCert')
    const pem = makeLocalhostCert()

    // Independent implementation: Node parses the DER and computes SHA-1 itself.
    const expected = new X509Certificate(pem).fingerprint.replace(/:/g, '').toLowerCase()

    expect(sslCert.getCertSha1Thumbprint(pem)).toBe(expected)
  })

  it('returns lowercase hex of the right length, as certutil prints it', async () => {
    sslCert = await import('../electron/sslCert')
    const thumbprint = sslCert.getCertSha1Thumbprint(makeLocalhostCert())

    expect(thumbprint).toMatch(/^[0-9a-f]{40}$/)
  })

  it('distinguishes two certificates that share a common name', async () => {
    sslCert = await import('../electron/sslCert')

    // Both are CN=localhost, O=BSV Desktop — the exact collision the old
    // name-based lookup could not tell apart. A stale certificate left in the
    // trust store must not be mistaken for the one currently being served.
    const first = sslCert.getCertSha1Thumbprint(makeLocalhostCert())
    const second = sslCert.getCertSha1Thumbprint(makeLocalhostCert())

    expect(first).not.toBe(second)
  })
})
