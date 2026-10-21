import { afterEach, describe, expect, it, vi } from 'vitest'

describe('fetchProxy manifest security', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('does not fall back to renderer fetch when the manifest proxy rejects', async () => {
    const proxyError = new Error('Manifest URL rejected by security policy')
    const proxyFetchManifest = vi.fn().mockRejectedValue(proxyError)
    const originalFetch = vi.fn()

    vi.stubGlobal('window', {
      fetch: originalFetch,
      electronAPI: { proxyFetchManifest }
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await import('../src/fetchProxy')

    await expect(
      window.fetch('https://example.com/manifest.json')
    ).rejects.toThrow('Manifest URL rejected by security policy')

    expect(proxyFetchManifest).toHaveBeenCalledWith(
      'https://example.com/manifest.json'
    )
    expect(originalFetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })
})
