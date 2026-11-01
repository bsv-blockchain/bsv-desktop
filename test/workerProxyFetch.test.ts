import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  proxyAgent: vi.fn(),
  throwOnAgent: false
}))

vi.mock('undici', () => ({
  fetch: state.fetch,
  ProxyAgent: class {
    constructor(url: string) {
      if (state.throwOnAgent) throw new Error('bad proxy URL')
      state.proxyAgent(url)
    }
  }
}))

const savedEnv = {
  appProxy: process.env.BSV_DESKTOP_PROXY_URL,
  httpProxy: process.env.HTTP_PROXY,
  httpsProxy: process.env.HTTPS_PROXY,
  noProxy: process.env.NO_PROXY,
  noProxyLower: process.env.no_proxy
}

function restoreEnv() {
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  restore('BSV_DESKTOP_PROXY_URL', savedEnv.appProxy)
  restore('HTTP_PROXY', savedEnv.httpProxy)
  restore('HTTPS_PROXY', savedEnv.httpsProxy)
  restore('NO_PROXY', savedEnv.noProxy)
  restore('no_proxy', savedEnv.noProxyLower)
}

describe('workerProxyFetch', () => {
  beforeEach(() => {
    vi.resetModules()
    state.fetch.mockReset()
    state.proxyAgent.mockReset()
    state.throwOnAgent = false
    delete process.env.BSV_DESKTOP_PROXY_URL
    delete process.env.NO_PROXY
    delete process.env.no_proxy
  })

  afterEach(() => {
    restoreEnv()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses the app-owned proxy URL for public HTTP(S) requests', async () => {
    process.env.BSV_DESKTOP_PROXY_URL = 'http://127.0.0.1:7890'
    process.env.NO_PROXY = 'localhost,127.0.0.1,::1'
    const original = vi.fn()
    vi.stubGlobal('fetch', original)
    state.fetch.mockResolvedValue({ ok: true })

    await import('../electron/workerProxyFetch')

    expect(state.proxyAgent).toHaveBeenCalledWith('http://127.0.0.1:7890')
    await globalThis.fetch('https://arcade.example/tx', { method: 'POST' })

    expect(state.fetch).toHaveBeenCalledWith(
      'https://arcade.example/tx',
      expect.objectContaining({ method: 'POST', dispatcher: expect.anything() })
    )
    expect(original).not.toHaveBeenCalled()
  })

  it('ignores HTTP_PROXY/HTTPS_PROXY from the shell when the app has no proxy', async () => {
    process.env.HTTP_PROXY = 'http://shell-proxy.example:8080'
    process.env.HTTPS_PROXY = 'http://shell-proxy.example:8080'
    const original = vi.fn()
    vi.stubGlobal('fetch', original)

    await import('../electron/workerProxyFetch')

    expect(globalThis.fetch).toBe(original)
    expect(state.proxyAgent).not.toHaveBeenCalled()
  })

  it('keeps loopback and NO_PROXY domains off the proxy', async () => {
    process.env.BSV_DESKTOP_PROXY_URL = 'http://127.0.0.1:7890'
    process.env.NO_PROXY = 'localhost,127.0.0.1,::1,.local'
    const original = vi.fn().mockResolvedValue('direct')
    vi.stubGlobal('fetch', original)

    await import('../electron/workerProxyFetch')

    await globalThis.fetch('http://127.0.0.1:9000/health')
    await globalThis.fetch('http://chaintracks.local/v1/headers')

    expect(original).toHaveBeenCalledTimes(2)
    expect(state.fetch).not.toHaveBeenCalled()
  })

  it('leaves fetch direct when the proxy URL is invalid', async () => {
    process.env.BSV_DESKTOP_PROXY_URL = 'not a proxy'
    state.throwOnAgent = true
    const original = vi.fn()
    vi.stubGlobal('fetch', original)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await import('../electron/workerProxyFetch')

    expect(globalThis.fetch).toBe(original)
    expect(warn.mock.calls[0]?.[0]).toContain('invalid proxy URL')
  })
})
