import { beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  options: [] as any[],
  findApps: vi.fn(),
  findAppsAcrossHosts: vi.fn(),
}))
vi.mock('metanet-apps', () => ({
  AppCatalog: class {
    constructor(opts: any) { lib.options.push(opts) }
    findApps = lib.findApps
    findAppsAcrossHosts = lib.findAppsAcrossHosts
  },
}))

import { APP_CATALOG_HOSTS, loadAppCatalog } from '../src/lib/utils/appCatalog'

const app = (domain: string) => ({ metadata: { domain }, token: {} })

beforeEach(() => {
  lib.options = []
  lib.findApps.mockReset().mockResolvedValue([app('slap.example')])
  lib.findAppsAcrossHosts.mockReset()
})

describe('loadAppCatalog (#113)', () => {
  it('merges ls_apps from every mainnet host with the network set explicitly', async () => {
    lib.findAppsAcrossHosts.mockResolvedValue({ apps: [app('a.example'), app('b.example')], diagnostics: { hosts: [{ ok: true }] } })
    const apps = await loadAppCatalog('main')
    expect(apps.map(a => a.metadata.domain)).toEqual(['a.example', 'b.example'])
    expect(lib.options[0].networkPreset).toBe('mainnet')
    // A wallet is supplied so the library never creates its own WalletClient.
    expect(lib.options[0].wallet).toBeDefined()
    expect(lib.findAppsAcrossHosts.mock.calls[0][1].hosts).toEqual(APP_CATALOG_HOSTS)
    expect(lib.findApps).not.toHaveBeenCalled()
  })

  it('falls back to SLAP discovery when every catalog host is down', async () => {
    lib.findAppsAcrossHosts.mockResolvedValue({ apps: [], diagnostics: { hosts: [{ ok: false }, { ok: false }] } })
    expect((await loadAppCatalog('main')).map(a => a.metadata.domain)).toEqual(['slap.example'])
  })

  it('uses testnet discovery off mainnet', async () => {
    await loadAppCatalog('test')
    expect(lib.options[0].networkPreset).toBe('testnet')
    expect(lib.findApps).toHaveBeenCalledOnce()
    expect(lib.findAppsAcrossHosts).not.toHaveBeenCalled()
  })
})
