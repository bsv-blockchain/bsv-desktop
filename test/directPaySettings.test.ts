import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DIRECT_PAY_SETTINGS,
  DIRECT_PAY_SETTINGS_KEY,
  DEFAULT_RELAY_URL,
  DirectPaySettingsError,
  ALL_DIRECT_PAY_SETTINGS_KEYS,
  V1_DIRECT_PAY_SETTINGS_KEY,
  V2_DIRECT_PAY_SETTINGS_KEY,
  iceServersFrom,
  loadDirectPaySettings,
  saveDirectPaySettings,
  subscribeDirectPaySettings
} from '../src/lib/utils/directPaySettings'

let local: Map<string, string>
let setItem: (k: string, v: string) => void

beforeEach(() => {
  local = new Map()
  setItem = (k, v) => {
    local.set(k, v)
  }
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => setItem(k, v),
    removeItem: (k: string) => {
      local.delete(k)
    }
  })
  // A real EventTarget, so the change event behaves like the browser's.
  vi.stubGlobal('window', new EventTarget())
})

describe('direct-pay settings: loading', () => {
  it('defaults to receiving on through the public relay when nothing is stored', () => {
    expect(DIRECT_PAY_SETTINGS_KEY).toBe('bsv-desktop-direct-pay-v3')
    expect(V2_DIRECT_PAY_SETTINGS_KEY).toBe('bsv-desktop-direct-pay-v2')
    expect(V1_DIRECT_PAY_SETTINGS_KEY).toBe('bsv-desktop-direct-pay-v1')
    expect(ALL_DIRECT_PAY_SETTINGS_KEYS).toEqual(['bsv-desktop-direct-pay-v3', 'bsv-desktop-direct-pay-v2', 'bsv-desktop-direct-pay-v1'])
    expect(DEFAULT_RELAY_URL).toBe('wss://webrtpay-relay-us-1.bsvblockchain.tech')
    expect(DEFAULT_DIRECT_PAY_SETTINGS).toEqual({
      receiveEnabled: true,
      signaling: 'relay',
      relayUrl: 'wss://webrtpay-relay-us-1.bsvblockchain.tech',
      stunUrls: [
        'stun:stun-us-1.bsvb.tech:3478',
        'stun:stun.l.google.com:19302',
        'stun:stun.cloudflare.com:3478'
      ]
    })
    expect(loadDirectPaySettings()).toEqual(DEFAULT_DIRECT_PAY_SETTINGS)
  })

  it('hands out copies, so callers cannot change the defaults', () => {
    loadDirectPaySettings().stunUrls.push('stun:evil.example:3478')
    expect(loadDirectPaySettings().stunUrls).toEqual(DEFAULT_DIRECT_PAY_SETTINGS.stunUrls)
    expect(DEFAULT_DIRECT_PAY_SETTINGS.stunUrls).toHaveLength(3)
  })

  it.each(['{not json', '"text"', 'null', '[]', '42'])('falls back to defaults for corrupt storage %s', raw => {
    local.set(DIRECT_PAY_SETTINGS_KEY, raw)
    expect(loadDirectPaySettings()).toEqual(DEFAULT_DIRECT_PAY_SETTINGS)
  })

  it('falls back to defaults when storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      }
    })
    expect(loadDirectPaySettings()).toEqual(DEFAULT_DIRECT_PAY_SETTINGS)
  })

  it('falls back per field, keeping what is still valid', () => {
    local.set(
      DIRECT_PAY_SETTINGS_KEY,
      JSON.stringify({
        receiveEnabled: false,
        signaling: 'carrier-pigeon',
        relayUrl: 'ws://example.com',
        stunUrls: ['http://not-stun.example'],
        turn: { urls: 'http://not-turn.example', username: 'u', credential: 'c' }
      })
    )
    expect(loadDirectPaySettings()).toEqual({ ...DEFAULT_DIRECT_PAY_SETTINGS, receiveEnabled: false })

    local.set(
      DIRECT_PAY_SETTINGS_KEY,
      JSON.stringify({
        receiveEnabled: 'yes',
        signaling: 'relay',
        relayUrl: 'wss://relay.example.com',
        stunUrls: ['stun:one.example:3478']
      })
    )
    expect(loadDirectPaySettings()).toEqual({
      receiveEnabled: true,
      signaling: 'relay',
      relayUrl: 'wss://relay.example.com',
      stunUrls: ['stun:one.example:3478']
    })
  })

  it('still loads relay signaling without an address stored before saving refused it (shown as an error, Ruling 14)', () => {
    local.set(DIRECT_PAY_SETTINGS_KEY, JSON.stringify({ receiveEnabled: true, signaling: 'relay', relayUrl: '', stunUrls: [] }))
    expect(loadDirectPaySettings()).toEqual({ receiveEnabled: true, signaling: 'relay', relayUrl: '', stunUrls: [] })
  })
})

describe('direct-pay settings: migrating to v3 (relay by default)', () => {
  const stun = ['stun:a.example:3478']

  it('keeps v3 settings as stored, message box signaling and receiving off included', () => {
    const v3 = { receiveEnabled: false, signaling: 'messagebox', relayUrl: '', stunUrls: stun }
    local.set(DIRECT_PAY_SETTINGS_KEY, JSON.stringify(v3))
    local.set(V2_DIRECT_PAY_SETTINGS_KEY, JSON.stringify({ receiveEnabled: true, signaling: 'relay', relayUrl: 'wss://old.example.com', stunUrls: [] }))
    expect(loadDirectPaySettings()).toEqual(v3)
  })

  it('moves v2 message box settings to the default relay, keeping receiving off and the STUN servers', () => {
    const v2 = { receiveEnabled: false, signaling: 'messagebox', relayUrl: '', stunUrls: stun }
    local.set(V2_DIRECT_PAY_SETTINGS_KEY, JSON.stringify(v2))
    expect(loadDirectPaySettings()).toEqual({ receiveEnabled: false, signaling: 'relay', relayUrl: DEFAULT_RELAY_URL, stunUrls: stun })
  })

  it('keeps a relay address the user entered in v2 (and v2 receiving on)', () => {
    const v2 = { receiveEnabled: true, signaling: 'messagebox', relayUrl: 'wss://relay.example.com', stunUrls: stun, turn: { urls: 'turn:t.example:3478', username: 'u', credential: 'c' } }
    local.set(V2_DIRECT_PAY_SETTINGS_KEY, JSON.stringify(v2))
    expect(loadDirectPaySettings()).toEqual({ ...v2, signaling: 'relay' })
  })

  it('gives a v2 relay address that is no longer valid the default relay', () => {
    local.set(V2_DIRECT_PAY_SETTINGS_KEY, JSON.stringify({ receiveEnabled: true, signaling: 'relay', relayUrl: 'ws://example.com', stunUrls: stun }))
    expect(loadDirectPaySettings()).toMatchObject({ signaling: 'relay', relayUrl: DEFAULT_RELAY_URL })
  })

  it('prefers v2 over v1', () => {
    local.set(V2_DIRECT_PAY_SETTINGS_KEY, JSON.stringify({ receiveEnabled: false, signaling: 'messagebox', relayUrl: '', stunUrls: stun }))
    local.set(V1_DIRECT_PAY_SETTINGS_KEY, JSON.stringify({ receiveEnabled: true, signaling: 'messagebox', relayUrl: 'wss://v1.example.com', stunUrls: [] }))
    expect(loadDirectPaySettings()).toEqual({ receiveEnabled: false, signaling: 'relay', relayUrl: DEFAULT_RELAY_URL, stunUrls: stun })
  })

  it('migrates v1 with receiving turned on and the relay, keeping the other v1 values', () => {
    const v1 = { receiveEnabled: false, signaling: 'messagebox', relayUrl: '', stunUrls: stun }
    local.set(V1_DIRECT_PAY_SETTINGS_KEY, JSON.stringify(v1))
    expect(loadDirectPaySettings()).toEqual({ receiveEnabled: true, signaling: 'relay', relayUrl: DEFAULT_RELAY_URL, stunUrls: stun })
    local.set(V1_DIRECT_PAY_SETTINGS_KEY, JSON.stringify({ ...v1, relayUrl: 'wss://relay.example.com' }))
    expect(loadDirectPaySettings().relayUrl).toBe('wss://relay.example.com')
  })

  it.each([V2_DIRECT_PAY_SETTINGS_KEY, V1_DIRECT_PAY_SETTINGS_KEY])('reads corrupt %s settings as the defaults', key => {
    local.set(key, '{not json')
    expect(loadDirectPaySettings()).toEqual(DEFAULT_DIRECT_PAY_SETTINGS)
  })

  it('writes v3 only, leaving older settings as they were and no longer read', () => {
    const v2 = { receiveEnabled: true, signaling: 'relay', relayUrl: '', stunUrls: stun }
    const v1 = { receiveEnabled: false }
    local.set(V2_DIRECT_PAY_SETTINGS_KEY, JSON.stringify(v2))
    local.set(V1_DIRECT_PAY_SETTINGS_KEY, JSON.stringify(v1))
    // The user chooses the message box over the migrated relay; that choice stays.
    saveDirectPaySettings({ ...loadDirectPaySettings(), signaling: 'messagebox', receiveEnabled: false })
    expect(JSON.parse(local.get(DIRECT_PAY_SETTINGS_KEY)!)).toMatchObject({ signaling: 'messagebox', receiveEnabled: false })
    expect(JSON.parse(local.get(V2_DIRECT_PAY_SETTINGS_KEY)!)).toEqual(v2)
    expect(JSON.parse(local.get(V1_DIRECT_PAY_SETTINGS_KEY)!)).toEqual(v1)
    expect(loadDirectPaySettings()).toMatchObject({ signaling: 'messagebox', receiveEnabled: false })
  })
})

describe('direct-pay settings: saving', () => {
  // A relay without an address can carry nothing: refuse it rather than store a setup that
  // can only show as a failure.
  it.each(['', '   '])('refuses relay signaling without a relay URL (%j), naming the field', relayUrl => {
    const changed = vi.fn()
    window.addEventListener('direct-pay-settings-changed', changed)
    let error: unknown
    try { saveDirectPaySettings({ signaling: 'relay', relayUrl }) } catch (e) { error = e }
    expect(error).toBeInstanceOf(DirectPaySettingsError)
    expect((error as DirectPaySettingsError).field).toBe('relayUrl')
    expect((error as Error).message).toBe('Enter the relay server address, or choose the message box for signaling.')
    expect(local.has(DIRECT_PAY_SETTINGS_KEY)).toBe(false)
    expect(changed).not.toHaveBeenCalled()
  })

  it('names the relay URL field when the address itself is refused', () => {
    let error: unknown
    try { saveDirectPaySettings({ signaling: 'relay', relayUrl: 'ws://example.com' }) } catch (e) { error = e }
    expect(error).toBeInstanceOf(DirectPaySettingsError)
    expect((error as DirectPaySettingsError).field).toBe('relayUrl')
  })

  it('still saves message box signaling without a relay URL', () => {
    expect(saveDirectPaySettings({ signaling: 'messagebox', relayUrl: '' }).relayUrl).toBe('')
  })

  it('rejects a plain ws relay on a public host', () => {
    expect(() => saveDirectPaySettings({ relayUrl: 'ws://example.com' })).toThrow(/wss/)
    expect(local.has(DIRECT_PAY_SETTINGS_KEY)).toBe(false)
  })

  it.each(['ws://localhost:8787', 'ws://127.0.0.1:8787/relay', 'ws://[::1]:8787', 'wss://relay.example.com/ws'])(
    'accepts relay %s',
    relayUrl => {
      expect(saveDirectPaySettings({ relayUrl }).relayUrl).toBe(relayUrl)
    }
  )

  it.each(['http://relay.example.com', 'https://relay.example.com', 'ws://localhost.evil.example', 'relay.example.com', 'wss://'])(
    'rejects relay %s',
    relayUrl => {
      expect(() => saveDirectPaySettings({ relayUrl })).toThrow(/relay/i)
    }
  )

  it('accepts only stun: and stuns: servers', () => {
    expect(saveDirectPaySettings({ stunUrls: ['stun:a.example:3478', 'stuns:b.example:5349'] }).stunUrls).toEqual([
      'stun:a.example:3478',
      'stuns:b.example:5349'
    ])
    for (const bad of ['http://a.example', 'turn:a.example:3478', 'a.example:3478', 'stun:']) {
      expect(() => saveDirectPaySettings({ stunUrls: [bad] })).toThrow(/STUN/)
    }
    expect(() => saveDirectPaySettings({ stunUrls: 'stun:a.example' as any })).toThrow(/STUN/)
  })

  it('allows no STUN servers at all', () => {
    expect(saveDirectPaySettings({ stunUrls: [] }).stunUrls).toEqual([])
    expect(loadDirectPaySettings().stunUrls).toEqual([])
  })

  it('accepts only turn: and turns: servers, with a username and credential', () => {
    const turn = { urls: 'turns:turn.example:5349', username: 'u', credential: 'c' }
    expect(saveDirectPaySettings({ turn }).turn).toEqual(turn)
    expect(() => saveDirectPaySettings({ turn: { ...turn, urls: 'stun:turn.example' } })).toThrow(/TURN/)
    expect(() => saveDirectPaySettings({ turn: { ...turn, urls: 'http://turn.example' } })).toThrow(/TURN/)
    expect(() => saveDirectPaySettings({ turn: { ...turn, username: '' } })).toThrow(/TURN/)
    expect(() => saveDirectPaySettings({ turn: { ...turn, credential: '' } })).toThrow(/TURN/)
  })

  it('does not echo a TURN credential in an error', () => {
    try {
      saveDirectPaySettings({ turn: { urls: 'http://turn.example', username: 'user-x', credential: 'secret-y' } })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).not.toMatch(/secret-y|user-x/)
    }
  })

  it('treats a fully blank TURN form as no TURN', () => {
    const saved = saveDirectPaySettings({ turn: { urls: ' ', username: '', credential: '' } })
    expect('turn' in saved).toBe(false)
    expect(loadDirectPaySettings().turn).toBeUndefined()
  })

  it('rejects an unknown signaling mode and a non-boolean receive flag', () => {
    expect(() => saveDirectPaySettings({ signaling: 'carrier-pigeon' as any })).toThrow(/signaling/i)
    expect(() => saveDirectPaySettings({ receiveEnabled: 'yes' as any })).toThrow(/receive/i)
  })

  it('round-trips every field', () => {
    const settings = {
      receiveEnabled: true,
      signaling: 'relay' as const,
      relayUrl: 'wss://relay.example.com/ws',
      stunUrls: ['stun:stun.example.com:3478'],
      turn: { urls: 'turn:turn.example.com:3478', username: '1700000000:02ab', credential: 'c3VwZXI=' }
    }
    expect(saveDirectPaySettings(settings)).toEqual(settings)
    expect(JSON.parse(local.get(DIRECT_PAY_SETTINGS_KEY)!)).toEqual(settings)
    expect(loadDirectPaySettings()).toEqual(settings)
  })

  it('trims what the user typed and fills omitted fields with the defaults', () => {
    const saved = saveDirectPaySettings({ relayUrl: '  wss://relay.example.com  ', stunUrls: [' stun:a.example:3478 ', ' '] })
    expect(saved).toEqual({
      ...DEFAULT_DIRECT_PAY_SETTINGS,
      relayUrl: 'wss://relay.example.com',
      stunUrls: ['stun:a.example:3478']
    })
    expect(loadDirectPaySettings()).toEqual(saved)
  })

  it('refuses to claim a save that did not persist', () => {
    setItem = () => {
      throw new Error('quota')
    }
    const heard = vi.fn()
    subscribeDirectPaySettings(heard)
    expect(() => saveDirectPaySettings({ receiveEnabled: true })).toThrow(/could not be saved/i)
    expect(heard).not.toHaveBeenCalled()
  })
})

describe('direct-pay settings: ICE servers', () => {
  it('lists the STUN servers, then TURN with its credentials', () => {
    const turn = { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }
    expect(iceServersFrom({ ...DEFAULT_DIRECT_PAY_SETTINGS, turn })).toEqual([
      { urls: DEFAULT_DIRECT_PAY_SETTINGS.stunUrls },
      { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }
    ])
  })

  it('omits an empty STUN list and an absent TURN entry', () => {
    expect(iceServersFrom({ ...DEFAULT_DIRECT_PAY_SETTINGS, stunUrls: [] })).toEqual([])
    expect(iceServersFrom(DEFAULT_DIRECT_PAY_SETTINGS)).toEqual([{ urls: DEFAULT_DIRECT_PAY_SETTINGS.stunUrls }])
  })

  it('does not share the settings array with the result', () => {
    const settings = { ...DEFAULT_DIRECT_PAY_SETTINGS, stunUrls: ['stun:a.example:3478'] }
    const [server] = iceServersFrom(settings)
    ;(server.urls as string[]).push('stun:b.example:3478')
    expect(settings.stunUrls).toEqual(['stun:a.example:3478'])
  })
})

describe('direct-pay settings: change events', () => {
  it('tells subscribers after a save, until they unsubscribe', () => {
    const heard = vi.fn()
    const unsubscribe = subscribeDirectPaySettings(heard)

    saveDirectPaySettings({ receiveEnabled: true })
    expect(heard).toHaveBeenCalledTimes(1)

    unsubscribe()
    saveDirectPaySettings({ receiveEnabled: false })
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('does not tell subscribers about a rejected save', () => {
    const heard = vi.fn()
    subscribeDirectPaySettings(heard)
    expect(() => saveDirectPaySettings({ relayUrl: 'ws://example.com' })).toThrow()
    expect(heard).not.toHaveBeenCalled()
  })

  it('emits the documented window event', () => {
    const heard = vi.fn()
    ;(window as unknown as EventTarget).addEventListener('direct-pay-settings-changed', heard)
    saveDirectPaySettings({ receiveEnabled: true })
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('works without a window', () => {
    vi.stubGlobal('window', undefined)
    expect(saveDirectPaySettings({ receiveEnabled: true }).receiveEnabled).toBe(true)
    expect(() => subscribeDirectPaySettings(() => {})()).not.toThrow()
  })
})
