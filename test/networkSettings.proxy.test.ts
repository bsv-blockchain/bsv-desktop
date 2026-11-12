import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  userData: '',
  setProxy: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  session: { defaultSession: { setProxy: state.setProxy } },
  ipcMain: { handle: vi.fn() }
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

describe('proxy settings -> worker environment', () => {
  beforeEach(() => {
    vi.resetModules()
    state.setProxy.mockReset()
    state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-network-settings-'))
    delete process.env.BSV_DESKTOP_PROXY_URL
  })

  afterEach(() => {
    restoreEnv()
    fs.rmSync(state.userData, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function writeProxySettings(value: unknown) {
    fs.writeFileSync(path.join(state.userData, 'network-settings.json'), JSON.stringify(value))
  }

  it('exports the app-owned proxy URL for the monitor worker', async () => {
    writeProxySettings({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890' })

    const { applyPersistedProxySettings } = await import('../electron/networkSettings')
    await applyPersistedProxySettings()

    expect(process.env.BSV_DESKTOP_PROXY_URL).toBe('http://127.0.0.1:7890')
    expect(state.setProxy).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '<local>;localhost;127.0.0.1;::1'
    })
  })

  it('clears the worker proxy URL in direct mode', async () => {
    writeProxySettings({ mode: 'direct' })
    process.env.BSV_DESKTOP_PROXY_URL = 'http://stale.example:8080'

    const { applyPersistedProxySettings } = await import('../electron/networkSettings')
    await applyPersistedProxySettings()

    expect(process.env.BSV_DESKTOP_PROXY_URL).toBeUndefined()
    expect(state.setProxy).toHaveBeenCalledWith({ mode: 'direct' })
  })

  it('clears the worker proxy URL when no settings file exists', async () => {
    process.env.BSV_DESKTOP_PROXY_URL = 'http://stale.example:8080'

    const { applyPersistedProxySettings } = await import('../electron/networkSettings')
    await applyPersistedProxySettings()

    expect(process.env.BSV_DESKTOP_PROXY_URL).toBeUndefined()
    expect(state.setProxy).not.toHaveBeenCalled()
  })
})
