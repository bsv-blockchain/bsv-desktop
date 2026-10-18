/**
 * Settings for direct (peer-to-peer) payments, stored on this device in
 * localStorage like the display preferences. They are not part of the wallet,
 * so they work before sign-in and survive logout (see WalletService).
 *
 * Receiving is off by default: while it is on, any wallet that knows the
 * identity key can learn this device's public IP address and when the wallet is
 * unlocked by starting a connection, without paying (audit F14). Sending
 * directly needs no setting, and reveals the payer's IP address to the
 * recipient's wallet.
 */
export interface DirectPaySettings {
  /** Answer direct payments from other wallets. Off unless the user turns it on. */
  receiveEnabled: boolean
  /** How the two wallets find each other before connecting. */
  signaling: 'messagebox' | 'relay'
  /** wss:// signaling relay (ws:// only for localhost). Used when signaling is 'relay'. */
  relayUrl: string
  /** stun: / stuns: servers used to discover this device's public address. */
  stunUrls: string[]
  /** Optional TURN server, for testing. */
  turn?: { urls: string; username: string; credential: string }
}

export const DIRECT_PAY_SETTINGS_KEY = 'bsv-desktop-direct-pay-v1'

const CHANGED_EVENT = 'direct-pay-settings-changed'

export const DEFAULT_DIRECT_PAY_SETTINGS: DirectPaySettings = {
  receiveEnabled: false,
  signaling: 'messagebox',
  relayUrl: '',
  stunUrls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** A setting that cannot be saved, worded for the user; `field` names the one at fault. */
export class DirectPaySettingsError extends Error {
  constructor(message: string, readonly field?: keyof DirectPaySettings) {
    super(message)
    this.name = 'DirectPaySettingsError'
  }
}

function checkReceiveEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Receive direct payments must be on or off.')
  return value
}

function checkSignaling(value: unknown): DirectPaySettings['signaling'] {
  if (value !== 'messagebox' && value !== 'relay') {
    throw new Error('Signaling must be the message box or a relay.')
  }
  return value
}

/** An empty string means no relay is configured. */
function checkRelayUrl(value: unknown): string {
  if (typeof value !== 'string') throw new DirectPaySettingsError('The relay URL is not a valid address.', 'relayUrl')
  const text = value.trim()
  if (!text) return ''
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new DirectPaySettingsError('The relay URL is not a valid address. Use a wss:// address.', 'relayUrl')
  }
  const secure = url.protocol === 'wss:'
  const local = url.protocol === 'ws:' && LOCAL_HOSTS.has(url.hostname)
  if (!secure && !local) {
    throw new DirectPaySettingsError('The relay URL must start with wss:// (ws:// is only allowed for localhost).', 'relayUrl')
  }
  return text
}

/** Blank entries are dropped, so a form can pass one line per server. */
function checkStunUrls(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('STUN servers must be a list of stun: or stuns: addresses.')
  const urls: string[] = []
  for (const entry of value) {
    const text = typeof entry === 'string' ? entry.trim() : null
    if (text === '') continue
    if (text === null || !/^stuns?:\S+$/.test(text)) {
      throw new Error(`STUN server "${String(entry)}" must start with stun: or stuns:.`)
    }
    urls.push(text)
  }
  return urls
}

/** Absent, or a form with every field blank, means no TURN server. */
function checkTurn(value: unknown): DirectPaySettings['turn'] {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') throw new Error('The TURN server settings are not valid.')
  const { urls, username, credential } = value as Record<string, unknown>
  const text = (field: unknown) => (typeof field === 'string' ? field.trim() : null)
  const [turnUrls, turnUser, turnCredential] = [text(urls), text(username), text(credential)]
  if (!turnUrls && !turnUser && !turnCredential) return undefined
  if (!turnUrls || !/^turns?:\S+$/.test(turnUrls)) {
    throw new Error('The TURN server must start with turn: or turns:.')
  }
  if (!turnUser || !turnCredential) {
    throw new Error('A TURN server needs both a username and a credential.')
  }
  return { urls: turnUrls, username: turnUser, credential: turnCredential }
}

function withTurn(settings: Omit<DirectPaySettings, 'turn'>, turn: DirectPaySettings['turn']): DirectPaySettings {
  return turn ? { ...settings, turn } : settings
}

/** Falls back to the default for each stored field that is missing or no longer valid. */
export function loadDirectPaySettings(): DirectPaySettings {
  const defaults = DEFAULT_DIRECT_PAY_SETTINGS
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DIRECT_PAY_SETTINGS_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
  } catch { /* corrupt or unreadable storage: the defaults apply */ }

  const field = <T>(check: (value: unknown) => T, value: unknown, fallback: T): T => {
    try { return check(value) } catch { return fallback }
  }

  return withTurn(
    {
      receiveEnabled: field(checkReceiveEnabled, stored.receiveEnabled, defaults.receiveEnabled),
      signaling: field(checkSignaling, stored.signaling, defaults.signaling),
      relayUrl: field(checkRelayUrl, stored.relayUrl, defaults.relayUrl),
      stunUrls: field(checkStunUrls, stored.stunUrls, [...defaults.stunUrls])
    },
    field(checkTurn, stored.turn, undefined)
  )
}

/**
 * Validates and stores the settings. Fields left out take their defaults, so the
 * argument describes the whole stored state. Throws an Error with a message fit
 * for the user and stores nothing when a value is not acceptable; relay signaling
 * needs a relay URL. Relay URL problems are `DirectPaySettingsError`s naming the field.
 */
export function saveDirectPaySettings(input: Partial<DirectPaySettings>): DirectPaySettings {
  const defaults = DEFAULT_DIRECT_PAY_SETTINGS
  const settings = withTurn(
    {
      receiveEnabled: checkReceiveEnabled(input.receiveEnabled ?? defaults.receiveEnabled),
      signaling: checkSignaling(input.signaling ?? defaults.signaling),
      relayUrl: checkRelayUrl(input.relayUrl ?? defaults.relayUrl),
      stunUrls: checkStunUrls(input.stunUrls ?? defaults.stunUrls)
    },
    checkTurn(input.turn)
  )
  if (settings.signaling === 'relay' && !settings.relayUrl) {
    throw new DirectPaySettingsError('Enter the relay server address, or choose the message box for signaling.', 'relayUrl')
  }
  try {
    localStorage.setItem(DIRECT_PAY_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    throw new Error('Direct payment settings could not be saved on this device.')
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
  return settings
}

/** The ICE servers for a connection: the STUN list, then TURN with its credentials. */
export function iceServersFrom(settings: DirectPaySettings): RTCIceServer[] {
  const servers: RTCIceServer[] = []
  if (settings.stunUrls.length > 0) servers.push({ urls: [...settings.stunUrls] })
  if (settings.turn) {
    servers.push({
      urls: settings.turn.urls,
      username: settings.turn.username,
      credential: settings.turn.credential
    })
  }
  return servers
}

/** Calls `fn` after every save (in this window). Returns the unsubscribe function. */
export function subscribeDirectPaySettings(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGED_EVENT, fn)
  return () => window.removeEventListener(CHANGED_EVENT, fn)
}
