/**
 * Regression tests for the localhost certificate serial number.
 *
 * Every generated certificate used serial 01 with the same issuer name. macOS
 * keychains identify certificates by issuer + serial, so once one BSV Desktop
 * certificate was in the login keychain, `add-trusted-cert` for any later one
 * (after expiry or a fresh profile) wrote trust settings but did not store the
 * certificate. Chromium finds trust anchors through the keychain, rejected the
 * HTTPS bridge with ERR_CERT_AUTHORITY_INVALID, and the app re-prompted on
 * every launch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import forge from 'node-forge'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: { showMessageBox: async () => ({ response: 1 }) },
  clipboard: { writeText: () => {} },
  net: { request: () => { throw new Error('probe unavailable in tests') } },
}))

function serialOf(pem: string): string {
  return forge.pki.certificateFromPem(pem).serialNumber
}

describe('generateSelfSignedCert serial number', () => {
  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-desktop-cert-'))
  })

  it('gives each new certificate a distinct, positive serial', async () => {
    const { generateSelfSignedCert } = await import('../electron/sslCert')
    const first = await generateSelfSignedCert()
    fs.rmSync(path.join(userData, 'certs'), { recursive: true })
    const second = await generateSelfSignedCert()

    const a = serialOf(first.cert)
    const b = serialOf(second.cert)
    expect(a).not.toBe('01')
    expect(a).not.toBe(b)
    // DER INTEGER: a leading byte >= 0x80 would make the serial negative.
    expect(parseInt(a.slice(0, 2), 16)).toBeLessThan(0x80)
  }, 30_000)

  it('replaces a still-valid certificate that has the legacy serial 01', async () => {
    const { generateSelfSignedCert } = await import('../electron/sslCert')
    const generated = await generateSelfSignedCert()

    // Rewrite it as a legacy certificate: same key and names, serial 01.
    const legacy = forge.pki.certificateFromPem(generated.cert)
    const key = forge.pki.privateKeyFromPem(generated.key)
    legacy.serialNumber = '01'
    legacy.sign(key, forge.md.sha256.create())
    fs.writeFileSync(generated.certPath, forge.pki.certificateToPem(legacy))

    const reloaded = await generateSelfSignedCert()
    expect(serialOf(reloaded.cert)).not.toBe('01')
  }, 30_000)

  it('keeps a valid certificate that already has a unique serial', async () => {
    const { generateSelfSignedCert } = await import('../electron/sslCert')
    const first = await generateSelfSignedCert()
    const second = await generateSelfSignedCert()
    expect(second.cert).toBe(first.cert)
  }, 30_000)
})
