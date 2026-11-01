import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  available: true,
  fetch: vi.fn()
}))

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      get fetch() {
        return state.available ? state.fetch : undefined
      }
    }
  }
}))

describe('sessionFetch', () => {
  beforeEach(() => {
    vi.resetModules()
    state.available = true
    state.fetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('routes HTTP(S) through the Electron session with wallet-safe defaults', async () => {
    const original = vi.fn()
    vi.stubGlobal('fetch', original)
    state.fetch.mockResolvedValue({ ok: true })

    const { installSessionFetch } = await import('../electron/sessionFetch')
    installSessionFetch()

    await globalThis.fetch('https://arcade.example/tx', { method: 'POST' })

    expect(state.fetch).toHaveBeenCalledWith(
      'https://arcade.example/tx',
      expect.objectContaining({ method: 'POST', credentials: 'omit', cache: 'no-store' })
    )
    expect(original).not.toHaveBeenCalled()
  })

  it('keeps the caller explicit credentials and cache options', async () => {
    const original = vi.fn()
    vi.stubGlobal('fetch', original)
    state.fetch.mockResolvedValue({ ok: true })

    const { installSessionFetch } = await import('../electron/sessionFetch')
    installSessionFetch()

    await globalThis.fetch('https://arcade.example/tx', {
      credentials: 'include',
      cache: 'reload'
    })

    expect(state.fetch).toHaveBeenCalledWith(
      'https://arcade.example/tx',
      expect.objectContaining({ credentials: 'include', cache: 'reload' })
    )
  })

  it('leaves non-HTTP schemes on Node fetch', async () => {
    const original = vi.fn().mockResolvedValue('raw')
    vi.stubGlobal('fetch', original)

    const { installSessionFetch } = await import('../electron/sessionFetch')
    installSessionFetch()

    const result = await globalThis.fetch('data:text/plain,hello')

    expect(result).toBe('raw')
    expect(original).toHaveBeenCalledWith('data:text/plain,hello', undefined)
    expect(state.fetch).not.toHaveBeenCalled()
  })

  it('is idempotent', async () => {
    const original = vi.fn()
    vi.stubGlobal('fetch', original)

    const { installSessionFetch } = await import('../electron/sessionFetch')
    installSessionFetch()
    const patched = globalThis.fetch
    installSessionFetch()

    expect(globalThis.fetch).toBe(patched)
  })

  it('leaves fetch untouched when session.fetch is unavailable', async () => {
    state.available = false
    const original = vi.fn()
    vi.stubGlobal('fetch', original)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { installSessionFetch } = await import('../electron/sessionFetch')
    installSessionFetch()

    expect(globalThis.fetch).toBe(original)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session.fetch is unavailable'))
  })
})
