import { describe, expect, it } from 'vitest'
import * as frontend from '../src/lib/networkConfig'
import * as backend from '../electron/networkConfig'
import { walletStorageKey } from '../electron/wallet-portability/bindings'
import { arcadeSseCursorPath } from '../electron/arcadeSse'
import { createArcadeServiceOptions } from '../electron/arcade'
import { setWocEndpoints, wocApiBase } from '../src/lib/utils/woc'

const identity = `02${'ab'.repeat(32)}`

describe('network service preferences', () => {
  it('matches mobile wallet defaults across main and renderer processes', () => {
    expect(frontend.defaultNetworkSettingsMap()).toEqual(backend.defaultNetworkSettingsMap())
    for (const { id } of frontend.NETWORKS) {
      expect(frontend.defaultNetworkSettings(id).messageBoxUrl).toBe('https://messagebox.bsvblockchain.tech')
      expect(frontend.defaultNetworkSettings(id).storageUrl).toBe('')
    }
    expect(frontend.defaultNetworkSettings('ttn').arcadeUrl).toBe('https://arcade-v2-ttn-us-1.bsvblockchain.tech')
  })

  it('requires explicit TSTN services rather than using another test network', () => {
    expect(frontend.defaultNetworkSettings('tstn').arcadeUrl).toBe('')
    expect(() => frontend.normalizeNetworkSettings('tstn', {})).toThrow('Arcade URL is required')
    expect(frontend.restoreNetworkSettings({}).tstn.arcadeUrl).toBe('')
    expect(() => wocApiBase('tstn')).toThrow('TSTN')
  })

  it('defaults unset Message Box URLs at both configuration boundaries', () => {
    for (const messageBoxUrl of [undefined, null, '', ' \t ']) {
      for (const config of [frontend, backend]) {
        const settings = config.normalizeNetworkSettings('test', { messageBoxUrl })
        expect(settings.messageBoxUrl).toBe('https://messagebox.bsvblockchain.tech')
        expect(settings.useMessageBox).toBe(true)
        expect(config.restoreNetworkSettings({ test: { messageBoxUrl } }).test.messageBoxUrl)
          .toBe('https://messagebox.bsvblockchain.tech')
      }
    }
  })

  it('preserves custom Message Box URLs and an explicit disable setting', () => {
    for (const config of [frontend, backend]) {
      const settings = config.normalizeNetworkSettings('main', { messageBoxUrl: ' https://my-messagebox.example.com/ ', useMessageBox: false })
      expect(settings.messageBoxUrl).toBe('https://my-messagebox.example.com')
      expect(settings.useMessageBox).toBe(false)
      expect(config.normalizeNetworkSettings('main', { messageBoxUrl: '', useMessageBox: false }).useMessageBox).toBe(false)
    }
  })

  it('rejects malformed service URLs at the renderer and IPC boundary', () => {
    for (const value of ['file:///etc/passwd', 'https://user:password@example.com', 'javascript:alert(1)', 'https://example.com?key=secret']) {
      expect(() => frontend.normalizeNetworkSettings('main', { arcadeUrl: value })).toThrow()
      expect(() => backend.normalizeNetworkSettings('main', { arcadeUrl: value })).toThrow()
    }
  })

  it('restores each network independently and retains configured TSTN endpoints', () => {
    const custom = frontend.normalizeNetworkSettings('tstn', {
      arcadeUrl: ' https://arcade.example.com/ ',
      chaintracksUrl: 'https://headers.example.com/chaintracks/v1/',
      whatsOnChainUrl: 'https://explorer.example.com/v1/bsv/tstn',
      storageUrl: 'https://storage.example.com',
    })
    const restored = frontend.restoreNetworkSettings(JSON.parse(JSON.stringify({ tstn: custom })))
    expect(restored.tstn).toEqual(custom)
    expect(restored.test).toEqual(frontend.defaultNetworkSettings('test'))
    const options = createArcadeServiceOptions('tstn', identity, custom)
    expect(options.chain).toBe('tstn')
    expect(options.arcadeUrl).toBe('https://arcade.example.com')
    expect(options.chaintracks.chain).toBe('tstn')
    expect(options.arcUrl).toBe('')
    expect(options.arcGorillaPoolUrl).toBeUndefined()
    setWocEndpoints(restored)
    expect(wocApiBase('tstn')).toBe(custom.whatsOnChainUrl)
    setWocEndpoints({})
  })

  it('isolates storage and SSE replay cursors across all four networks', () => {
    const storageKeys = frontend.NETWORKS.map(({ id }) => walletStorageKey(identity, id))
    const cursorPaths = frontend.NETWORKS.map(({ id }) => arcadeSseCursorPath(identity, id))
    expect(new Set(storageKeys).size).toBe(4)
    expect(new Set(cursorPaths).size).toBe(4)
    expect(storageKeys).toContain(`${identity}-tstn`)
  })
})
