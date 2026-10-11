import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bsv-desktop-test' },
  dialog: { showMessageBox: async () => ({ response: 1 }) },
  clipboard: { writeText: () => {} },
  net: { request: () => { throw new Error('probe unavailable in tests') } },
}))

describe('checkAndRepairCertTrust', () => {
  it('does nothing when clients already accept the endpoint', async () => {
    const { checkAndRepairCertTrust } = await import('../electron/sslCert')
    const ensure = vi.fn(async () => {})
    const result = await checkAndRepairCertTrust(null, { certPath: '/c.crt', probe: async () => true, ensure, storeCheck: async () => false })
    expect(result).toEqual({ trusted: true, repaired: false })
    expect(ensure).not.toHaveBeenCalled()
  })

  it('runs the trust flow and reports repaired when the probe then passes', async () => {
    const { checkAndRepairCertTrust } = await import('../electron/sslCert')
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const ensure = vi.fn(async () => {})
    const result = await checkAndRepairCertTrust(null, { certPath: '/c.crt', probe, ensure, storeCheck: async () => false })
    expect(ensure).toHaveBeenCalledWith('/c.crt', null)
    expect(result).toEqual({ trusted: true, repaired: true })
  })

  it('trusts an already-verified store without prompting again (this process cannot see new trust)', async () => {
    const { checkAndRepairCertTrust } = await import('../electron/sslCert')
    const probe = vi.fn().mockResolvedValue(false)
    const ensure = vi.fn(async () => {})
    const result = await checkAndRepairCertTrust(null, { certPath: '/c.crt', probe, ensure, storeCheck: async () => true })
    expect(ensure).not.toHaveBeenCalled()
    expect(result).toEqual({ trusted: true, repaired: false })
  })

  it('repairs when the store did not trust it and does after the trust flow', async () => {
    const { checkAndRepairCertTrust } = await import('../electron/sslCert')
    const storeCheck = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const ensure = vi.fn(async () => {})
    const result = await checkAndRepairCertTrust(null, { certPath: '/c.crt', probe: async () => false, ensure, storeCheck })
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ trusted: true, repaired: true })
  })

  it('shares one run between concurrent calls', async () => {
    const { checkAndRepairCertTrust } = await import('../electron/sslCert')
    let finish!: () => void
    const ensure = vi.fn(() => new Promise<void>(r => { finish = r }))
    const storeCheck = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const d = { certPath: '/c.crt', probe: async () => false, ensure, storeCheck }
    const a = checkAndRepairCertTrust(null, d)
    const b = checkAndRepairCertTrust(null, d)
    await vi.waitFor(() => expect(ensure).toHaveBeenCalled())
    finish()
    expect(await a).toEqual({ trusted: true, repaired: true })
    expect(await b).toEqual({ trusted: true, repaired: true })
    expect(ensure).toHaveBeenCalledTimes(1)
  })

  it('reports untrusted when nothing worked', async () => {
    const { checkAndRepairCertTrust } = await import('../electron/sslCert')
    const result = await checkAndRepairCertTrust(null, { certPath: '/c.crt', probe: async () => false, ensure: async () => {}, storeCheck: async () => false })
    expect(result).toEqual({ trusted: false, repaired: false })
  })

  it('is inconclusive without a certificate', async () => {
    const { checkAndRepairCertTrust } = await import('../electron/sslCert')
    expect(await checkAndRepairCertTrust(null, { certPath: null })).toEqual({ trusted: null, repaired: false })
  })
})
