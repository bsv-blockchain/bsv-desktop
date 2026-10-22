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
    const options = createArcadeServiceOptions('tstn', '0123456789abcdef'.repeat(2), custom)
    expect(options.chain).toBe('tstn')
    expect(options.arcadeUrl).toBe('https://arcade.example.com')
    expect(options.chaintracks.chain).toBe('tstn')
    expect(options.arcUrl).toBe('')
    expect(options.arcGorillaPoolUrl).toBeUndefined()
    setWocEndpoints(restored)
    expect(wocApiBase('tstn')).toBe(custom.whatsOnChainUrl)
    setWocEndpoints({})
  })

  const K = '02798b81951a6a8c7ef8beda09b06a23031d7efaf37b663265e0188ab378124046'
  it('defaults to no Mandala overlay on every network in both processes', () => {
    for (const { id } of frontend.NETWORKS) {
      expect(frontend.defaultNetworkSettings(id).mandalaOverlays).toEqual([])
      expect(backend.defaultNetworkSettings(id).mandalaOverlays).toEqual([])
    }
  })

  it('normalizes a valid overlay and rejects bad ones strictly', () => {
    for (const config of [frontend, backend]) {
      expect(config.normalizeNetworkSettings('test', { mandalaOverlays: [{ url: 'https://ov.example/', identityKey: ` ${K.toUpperCase()} ` }] }).mandalaOverlays)
        .toEqual([{ url: 'https://ov.example', identityKey: K }])
      expect(() => config.normalizeNetworkSettings('test', { mandalaOverlays: [{ url: 'https://ov.example', identityKey: '04' + 'ab'.repeat(32) }] }))
        .toThrow('Mandala overlay identity key must be a 66-character compressed public key in hex')
      expect(() => config.normalizeNetworkSettings('test', { mandalaOverlays: [{ url: 'https://a.example', identityKey: K }, { url: 'https://b.example', identityKey: K }] }))
        .toThrow('Each Mandala overlay identity key may appear once')
      expect(() => config.normalizeNetworkSettings('test', { mandalaOverlays: [{ url: 'ftp://x', identityKey: K }] })).toThrow('Mandala overlay URL')
      const five = [2, 3, 4, 5, 6].map(n => ({ url: `https://o${n}.example`, identityKey: `0${n % 2 ? 3 : 2}${String(n).repeat(64)}` }))
      expect(() => config.normalizeNetworkSettings('test', { mandalaOverlays: five })).toThrow('At most 4 Mandala overlays')
      expect(() => config.normalizeNetworkSettings('test', { mandalaOverlays: 'x' as any })).toThrow('Mandala overlay settings are invalid')
    }
  })

  it('restoring saved settings drops an invalid overlay instead of failing', () => {
    expect(frontend.restoreNetworkSettings({ test: { mandalaOverlays: [{ url: 'nope', identityKey: 'x' }] } }).test.mandalaOverlays).toEqual([])
    for (const config of [frontend, backend]) {
      // Old snapshots have no field; a corrupt one keeps valid entries, first duplicate wins, capped at 4.
      expect(config.restoreNetworkSettings({ test: { arcadeUrl: 'https://arc.example' } }).test.mandalaOverlays).toEqual([])
      expect(config.restoreNetworkSettings({ test: { mandalaOverlays: 7 } }).test.mandalaOverlays).toEqual([])
      const saved = [
        null,
        { url: 'https://a.example', identityKey: K },
        { url: 'https://dup.example', identityKey: K },
        ...[4, 5, 6, 7].map(n => ({ url: `https://o${n}.example`, identityKey: `02${String(n).repeat(64)}` })),
      ]
      expect(config.restoreNetworkSettings({ test: { mandalaOverlays: saved } }).test.mandalaOverlays).toEqual([
        { url: 'https://a.example', identityKey: K },
        ...[4, 5, 6].map(n => ({ url: `https://o${n}.example`, identityKey: `02${String(n).repeat(64)}` })),
      ])
    }
  })

  it('isolates storage and SSE replay cursors across all four networks', () => {
    const storageKeys = frontend.NETWORKS.map(({ id }) => walletStorageKey(identity, id))
    const cursorPaths = frontend.NETWORKS.map(({ id }) => arcadeSseCursorPath(identity, id))
    expect(new Set(storageKeys).size).toBe(4)
    expect(new Set(cursorPaths).size).toBe(4)
    expect(storageKeys).toContain(`${identity}-tstn`)
  })
})
