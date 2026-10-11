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

  it('accepts a verified store when this process cannot see the new trust yet', async () => {
    const { checkAndRepairCertTrust } = await import('../electron/sslCert')
    const probe = vi.fn().mockResolvedValue(false)
    const result = await checkAndRepairCertTrust(null, { certPath: '/c.crt', probe, ensure: async () => {}, storeCheck: async () => true })
    expect(result).toEqual({ trusted: true, repaired: true })
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
