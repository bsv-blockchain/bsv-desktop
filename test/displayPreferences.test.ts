import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/services/secrets', () => ({
  getSnapshot: () => null,
  setSnapshot: () => {},
  persistSnapshot: async () => {},
  getKeyHex: () => null,
  getMnemonic: () => null,
  endSession: async () => {},
  clearCache: () => {},
}))
vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('../src/onWalletReady', () => ({ clearWalletForHttpRoute: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

let local: Map<string, string>

beforeEach(() => {
  local = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => { local.set(k, v) },
    removeItem: (k: string) => { local.delete(k) },
  })
})

const trust = { trustLevel: 2, trustedCertifiers: [] }

describe('display preferences (#114)', () => {
  it('switches theme and currency on the device with no wallet and no transaction', async () => {
    const { WalletService } = await import('../src/lib/services/WalletService')
    const service = new WalletService()
    const states: any[] = []
    service.on('stateChanged', s => states.push(s))

    service.updateDisplayPreferences({ theme: 'dark' })
    service.updateDisplayPreferences({ currency: 'USD' })

    expect(service.settings.theme).toEqual({ mode: 'dark' })
    expect(service.settings.currency).toBe('USD')
    expect(states.at(-1).settings.currency).toBe('USD')
    expect(local.get('userTheme')).toBe('dark')
    expect(local.get('bsv-desktop-currency')).toBe('USD')
  })

  it('never writes theme or currency to the wallet settings token', async () => {
    const { WalletService } = await import('../src/lib/services/WalletService')
    const service = new WalletService()
    const set = vi.fn(async () => {})
    const state = service as any
    state._managers = { settingsManager: { set } }
    state._settings = { trustSettings: trust }

    service.updateDisplayPreferences({ theme: 'light', currency: 'EUR' })
    // The Trust page spreads the whole settings object into its save.
    await service.updateSettings({ ...service.settings, trustSettings: trust })
    expect(set).not.toHaveBeenCalled()

    const changed = { trustLevel: 3, trustedCertifiers: [] }
    await service.updateSettings({ ...service.settings, trustSettings: changed })
    expect(set).toHaveBeenCalledOnce()
    expect(set.mock.calls[0][0]).toEqual({ trustSettings: changed })
    expect(service.settings).toMatchObject({ trustSettings: changed, theme: { mode: 'light' }, currency: 'EUR' })
  })

  it('carries older on-chain choices over once, without overriding device choices', async () => {
    const { loadDisplayPreferences, seedDisplayPreferences } = await import('../src/lib/utils/displayPreferences')
    const onChain = { trustSettings: trust, theme: { mode: 'dark' }, currency: 'GBP' }

    expect(seedDisplayPreferences(loadDisplayPreferences(), onChain)).toEqual({ theme: 'dark', currency: 'GBP' })

    local.set('userTheme', 'light')
    local.set('bsv-desktop-currency', 'SATS')
    expect(seedDisplayPreferences(loadDisplayPreferences(), onChain)).toEqual({ theme: 'light', currency: 'SATS' })
  })
})
