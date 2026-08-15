/**
 * Tests for verifying certificate trust against a real client rather than
 * against a certificate store.
 *
 * Store inspection is a heuristic and has been wrong twice: once because the
 * lookup key was the organization instead of the common name, and once — the
 * case that motivated this — because on managed Windows machines a certificate
 * can be genuinely present in the store and genuinely not honoured, when policy
 * forbids user-installed root CAs from validating. Electron's net module uses
 * Chromium's network stack, which consults the Windows store exactly like the
 * browsers and web apps that talk to the bridge, so probing the endpoint
 * answers the question that actually matters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'
import fs from 'fs'
import forge from 'node-forge'

const showMessageBox = vi.fn(async () => ({ response: 1, checkboxChecked: false }))

/** Controls what the fake network stack does with the probe request. */
let probeBehaviour: 'accept' | 'reject-cert' | 'reject-cert-chromium' | 'refused' | 'refused-chromium' = 'accept'

class FakeClientRequest extends EventEmitter {
  end() {
    setImmediate(() => {
      if (probeBehaviour === 'accept') {
        const response = new EventEmitter()
        this.emit('response', response)
        response.emit('end')
      } else if (probeBehaviour === 'reject-cert') {
        Object.assign(new Error(), {})
        const error = new Error('certificate verify failed') as Error & { code?: string }
        error.code = 'ERR_CERT_AUTHORITY_INVALID'
        this.emit('error', error)
      } else if (probeBehaviour === 'reject-cert-chromium') {
        // Real Electron net errors put the Chromium code in the message and
        // leave error.code unset. That is the shape we see on macOS.
        this.emit('error', new Error('net::ERR_CERT_AUTHORITY_INVALID'))
      } else if (probeBehaviour === 'refused-chromium') {
        this.emit('error', new Error('net::ERR_CONNECTION_REFUSED'))
      } else {
        const error = new Error('connection refused') as Error & { code?: string }
        error.code = 'ECONNREFUSED'
        this.emit('error', error)
      }
    })
  }
}

const request = vi.fn(() => new FakeClientRequest())

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  dialog: { showMessageBox },
  clipboard: { writeText: () => {} },
  BrowserWindow: class {},
  net: { request },
}))

/** Controls what external commands do. */
let execBehaviour: 'fail-all' | 'install-succeeds' | 'darwin-install-verifies' | 'already-trusted-verify-cert' = 'fail-all'

/** Captures `security add-trusted-cert` argv so tests can assert the flags. */
const securityAddArgv: string[][] = []

/** After a mocked macOS install, verify-cert starts succeeding. */
let darwinCertInKeychain = false

// Store lookups report "not trusted" unless a behaviour below says otherwise.
// Uses promisify.custom because sslCert wraps execFile with util.promisify
// and destructures { stdout }.
vi.mock('child_process', () => {
  const execFile = (() => { /* callback form unused */ }) as unknown as Record<symbol, unknown>

  execFile[Symbol.for('nodejs.util.promisify.custom')] = async (cmd: string, args: string[] = []) => {
    const argv = args.join(' ')

    if (cmd === 'security' && argv.includes('add-trusted-cert')) {
      securityAddArgv.push([...args])
    }

    if (execBehaviour === 'install-succeeds') {
      // The install itself works — this is the managed-Windows case where the
      // certificate lands in the store and is then ignored.
      if (argv.includes('-addstore')) return { stdout: 'CertUtil: -addstore command completed successfully.', stderr: '' }
      // Group policy restricting user root CAs is present.
      if (cmd === 'reg') return { stdout: '    Flags    REG_DWORD    0x1', stderr: '' }
    }

    if (execBehaviour === 'darwin-install-verifies') {
      if (cmd === 'security' && argv.includes('add-trusted-cert')) {
        darwinCertInKeychain = true
        return { stdout: '', stderr: '' }
      }
      if (cmd === 'security' && argv.includes('verify-cert')) {
        if (darwinCertInKeychain) {
          return { stdout: '...certificate verification successful.', stderr: '' }
        }
        const error = new Error('CSSMERR_TP_NOT_TRUSTED') as Error & { stdout: string }
        error.stdout = 'Cert Verify Result: CSSMERR_TP_NOT_TRUSTED'
        throw error
      }
      if (cmd === 'security' && argv.includes('find-certificate')) {
        // Install landed in the System keychain; the login keychain lookup
        // that used to gate the whole macOS check must not decide this.
        const error = new Error('The specified item could not be found in the keychain.') as Error & { stdout: string }
        error.stdout = ''
        throw error
      }
    }

    if (execBehaviour === 'already-trusted-verify-cert') {
      if (cmd === 'security' && argv.includes('verify-cert')) {
        return { stdout: '...certificate verification successful.', stderr: '' }
      }
    }

    const error = new Error('CertUtil: -verifystore command FAILED: 0x80090011') as Error & { stdout: string }
    error.stdout = 'CertUtil: -verifystore command FAILED: 0x80090011 (-2146893807 NTE_NOT_FOUND)'
    throw error
  }

  return { execFile }
})

class FakeWindow extends EventEmitter {
  isVisible() { return true }
  isDestroyed() { return false }
}

function writeTempCert(): string {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)
  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'organizationName', value: 'BSV Desktop' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const file = path.join(os.tmpdir(), `bsv-probe-test-${process.pid}-${Date.now()}.crt`)
  fs.writeFileSync(file, forge.pki.certificateToPem(cert))
  return file
}

let sslCert: typeof import('../electron/sslCert')
let certPath: string

const originalPlatform = process.platform

function stubPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('certificate trust verification', () => {
  beforeEach(async () => {
    showMessageBox.mockClear()
    request.mockClear()
    securityAddArgv.length = 0
    darwinCertInKeychain = false
    execBehaviour = 'fail-all'
    stubPlatform(originalPlatform)
    sslCert = await import('../electron/sslCert')
    certPath = writeTempCert()
  })

  afterEach(() => {
    stubPlatform(originalPlatform)
  })

  it('does not prompt when a real client already accepts the endpoint', async () => {
    probeBehaviour = 'accept'

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    // The store says untrusted; the probe says otherwise and wins.
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('prompts when a real client rejects the certificate', async () => {
    probeBehaviour = 'reject-cert'

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    expect(showMessageBox).toHaveBeenCalled()
  })

  it('does not warn when the user declines the install', async () => {
    probeBehaviour = 'reject-cert'
    showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false }) // "Not Now"

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    // Declining is a deliberate choice, not a failure to scold the user for.
    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('explains the failure when the cert installs but is still not honoured', async () => {
    // The managed-Windows case: policy forbids user-installed root CAs, so the
    // install genuinely succeeds and the certificate is genuinely ignored.
    stubPlatform('win32')
    probeBehaviour = 'reject-cert'
    execBehaviour = 'install-succeeds'
    showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false }) // "Trust Certificate"

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    expect(showMessageBox).toHaveBeenCalledTimes(2)

    const warning = showMessageBox.mock.calls[1][1] as unknown as Electron.MessageBoxOptions
    expect(warning.title).toBe('Certificate Not Trusted')
    expect(warning.detail).toContain('policy')
  })

  it('does not warn on macOS when install succeeds but this process still rejects TLS', async () => {
    // Chromium caches keychain trust at process start. After add-trusted-cert
    // the store verifies the cert and a fresh process accepts it, but the
    // in-process probe still returns ERR_CERT_AUTHORITY_INVALID. That is not
    // a device-policy failure and must not scare the user.
    stubPlatform('darwin')
    probeBehaviour = 'reject-cert-chromium'
    execBehaviour = 'darwin-install-verifies'
    showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    const prompt = showMessageBox.mock.calls[0][1] as unknown as Electron.MessageBoxOptions
    expect(prompt.title).toBe('SSL Certificate Trust')
  })

  it('trusts the macOS keychain even when the cert is not in the login keychain', async () => {
    // The osascript fallback installs into the System keychain. Looking the
    // cert up only in login.keychain-db used to report "untrusted" and trip
    // the warning even after a successful admin install.
    stubPlatform('darwin')
    probeBehaviour = 'reject-cert-chromium'
    execBehaviour = 'darwin-install-verifies'
    showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    expect(showMessageBox.mock.calls.map(([, options]) => (
      options as Electron.MessageBoxOptions
    ).title)).not.toContain('Certificate Not Trusted')
  })

  it('adds the macOS cert to the user trust domain before asking for admin', async () => {
    stubPlatform('darwin')
    probeBehaviour = 'reject-cert-chromium'
    execBehaviour = 'darwin-install-verifies'
    showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    expect(securityAddArgv.length).toBeGreaterThan(0)
    expect(securityAddArgv[0]).toContain('add-trusted-cert')
    expect(securityAddArgv[0]).toContain('trustRoot')
    expect(securityAddArgv[0]).not.toContain('-d')
  })

  it('treats a Chromium connection-refused (no error.code) as inconclusive', async () => {
    // Electron's net module reports net::ERR_CONNECTION_REFUSED in the
    // message and leaves code undefined. That is not a trust answer.
    stubPlatform('darwin')
    probeBehaviour = 'refused-chromium'
    execBehaviour = 'already-trusted-verify-cert'

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('falls back to the store when the bridge is not reachable', async () => {
    probeBehaviour = 'refused'

    await sslCert.ensureCertTrusted(certPath, new FakeWindow() as never)

    // A refused connection says nothing about trust, so we must not treat it as
    // proof of anything — here the store reports untrusted, so we prompt.
    expect(showMessageBox).toHaveBeenCalled()
  })
})
