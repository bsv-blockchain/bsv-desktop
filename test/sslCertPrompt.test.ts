/**
 * Regression tests for when the certificate trust prompt is allowed to appear.
 *
 * The prompt used to pop up before the main app window did. The window is
 * created with `show: false` and only shown on 'ready-to-show' (the renderer's
 * first paint), while certificate work started immediately after
 * createWindow(). On a cold start the dialog won that race, so new users met an
 * unexplained certificate prompt floating over the desktop with no application
 * behind it — and largely dismissed it, leaving the HTTPS substrate untrusted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'
import fs from 'fs'
import forge from 'node-forge'

const showMessageBox = vi.fn(async () => ({ response: 1, checkboxChecked: false }))

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  dialog: { showMessageBox },
  clipboard: { writeText: () => {} },
  BrowserWindow: class {},
  // Probe unavailable, so trust falls back to inspecting the certificate store
  // — these tests are about prompt timing, not about the probe.
  net: { request: () => { throw new Error('probe unavailable in tests') } },
}))

// Every trust lookup fails, i.e. the certificate is not trusted and the app
// must prompt. Callback-style so promisify() wraps it the way the real one is.
vi.mock('child_process', () => ({
  execFile: (_cmd: string, _args: string[], cb: (err: Error) => void) => {
    cb(new Error('NTE_NOT_FOUND'))
  },
}))

/** Minimal stand-in for BrowserWindow covering what the prompt path touches. */
class FakeWindow extends EventEmitter {
  private visible = false
  private destroyed = false

  isVisible() { return this.visible }
  isDestroyed() { return this.destroyed }
  show() { this.visible = true; this.emit('show') }
  destroy() { this.destroyed = true; this.emit('closed') }
}

/** Lets pending microtasks and timers settle so we can assert on "not yet". */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
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

  const file = path.join(os.tmpdir(), `bsv-cert-prompt-test-${process.pid}-${Date.now()}.crt`)
  fs.writeFileSync(file, forge.pki.certificateToPem(cert))
  return file
}

let sslCert: typeof import('../electron/sslCert')
let certPath: string

describe('certificate trust prompt timing', () => {
  beforeEach(async () => {
    showMessageBox.mockClear()
    sslCert = await import('../electron/sslCert')
    certPath = writeTempCert()
  })

  it('does not prompt until the main window is visible', async () => {
    const window = new FakeWindow()
    const pending = sslCert.ensureCertTrusted(certPath, window as never)

    await settle()
    expect(showMessageBox).not.toHaveBeenCalled()

    window.show()
    await pending

    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('parents the dialog to the main window so it is not a free-floating prompt', async () => {
    const window = new FakeWindow()
    window.show()

    await sslCert.ensureCertTrusted(certPath, window as never)

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(showMessageBox.mock.calls[0][0]).toBe(window)
  })

  it('prompts immediately when the window is already visible', async () => {
    const window = new FakeWindow()
    window.show()

    const pending = sslCert.ensureCertTrusted(certPath, window as never)
    await settle()

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    await pending
  })

  it('does not prompt at all if the window is closed while still hidden', async () => {
    const window = new FakeWindow()
    const pending = sslCert.ensureCertTrusted(certPath, window as never)

    await settle()
    window.destroy()
    await pending

    expect(showMessageBox).not.toHaveBeenCalled()
  })
})
