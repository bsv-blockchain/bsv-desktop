/**
 * Settings for direct (peer-to-peer) payments, stored on this device in
 * localStorage like the display preferences. They are not part of the wallet,
 * so they work before sign-in and survive logout (see WalletService).
 *
 * Receiving is on by default (the user's decision, 2026-10-18), and the switch
 * is in Settings. It answers live payments only while the Payments page's Receive
 * tab is showing (the user's decision, 2026-10-21; see DirectPayManager): while it
 * is, any wallet that knows the identity key can learn this device's public IP
 * address and that the Receive tab is open by starting a connection, without
 * paying (audit F14). Payers who find the wallet closed use the message box. The
 * settings are one per device, so receiving answers for every wallet profile on it.
 * Wallets find each other through the public WebRTPay relay by default (the
 * user's decision, 2026-10-19), with the message box as the fallback while the
 * relay cannot be reached (see DirectPayManager). Settings saved before then are
 * read once, while the v3 key is absent, with relay signaling and, when they had
 * no relay address, the default one: v2 settings keep their receiving choice, v1
 * settings (when receiving was off by default) are read with receiving on. From
 * then on the v3 key holds the user's choice, message box signaling included.
 * Sending directly needs no setting, and reveals the payer's IP address to the
 * recipient's wallet. When two wallets cannot connect directly, a TURN server
 * may relay the encrypted connection; the carriers see who connects, their
 * addresses and when, never the payment.
 * Sharing this device's local address is on by default (the user's decision,
 * 2026-10-20: paying someone in the same office is common). Without it Chromium
 * offers only mDNS names for this device, which wallets on the same network often
 * cannot resolve, and many routers will not loop traffic back to their own public
 * address. While it is on, the default-route LAN address and IPv6 address reach the
 * other wallet inside the encrypted signal, and appear in face-to-face payment codes.
 */
export interface DirectPaySettings {
  /**
   * Answer direct payments from other wallets while the Receive tab is showing. On unless
   * the user turns it off.
   */
  receiveEnabled: boolean
  /** How the two wallets find each other before connecting. */
  signaling: 'messagebox' | 'relay'
  /** wss:// signaling relay (ws:// only for localhost). Used when signaling is 'relay'. */
  relayUrl: string
  /**
   * stun: / stuns: servers used to discover this device's public address. Only these are
   * asked: STUN servers in the relay's TURN answer are left out (see {@link onlyOwnStun}).
   */
  stunUrls: string[]
  /**
   * Offer this device's local network address (and IPv6 address) to the other wallet, so
   * wallets on the same network can connect. On unless the user turns it off.
   */
  shareLocalAddress: boolean
  /** Optional TURN server, for testing. */
  turn?: { urls: string; username: string; credential: string }
}

export const DIRECT_PAY_SETTINGS_KEY = 'bsv-desktop-direct-pay-v3'
/** Read only while the v3 key is absent, with relay signaling forced (see the header). Never written. */
export const V2_DIRECT_PAY_SETTINGS_KEY = 'bsv-desktop-direct-pay-v2'
/** Read only while the v3 and v2 keys are absent, with relay signaling and receiving forced on. Never written. */
export const V1_DIRECT_PAY_SETTINGS_KEY = 'bsv-desktop-direct-pay-v1'
/** Every key direct-pay settings were ever stored under, newest first. */
export const ALL_DIRECT_PAY_SETTINGS_KEYS = [DIRECT_PAY_SETTINGS_KEY, V2_DIRECT_PAY_SETTINGS_KEY, V1_DIRECT_PAY_SETTINGS_KEY] as const

/** The public WebRTPay relay, the default way wallets find each other. */
export const DEFAULT_RELAY_URL = 'wss://webrtpay-relay-us-1.bsvblockchain.tech'

const CHANGED_EVENT = 'direct-pay-settings-changed'

export const DEFAULT_DIRECT_PAY_SETTINGS: DirectPaySettings = {
  receiveEnabled: true,
  shareLocalAddress: true,
  signaling: 'relay',
  relayUrl: DEFAULT_RELAY_URL,
  // BSVA's own STUN server only (the user's decision, 2026-10-21): every STUN server
  // learns this device's address and when it connects.
  stunUrls: ['stun:stun-us-1.bsvb.tech:3478']
}

/**
 * The STUN list that was the default until 2026-10-21. Stored settings that still hold it
 * exactly (the user saved other settings and never edited this list) are read with the new
 * default; any other list is the user's own and stays.
 */
export const PREVIOUS_DEFAULT_STUN_URLS: readonly string[] = [
  'stun:stun-us-1.bsvb.tech:3478',
  'stun:stun.l.google.com:19302',
  'stun:stun.cloudflare.com:3478'
]

/**
 * Largest transaction (Atomic BEEF) sent or taken live: 1 MB (the user's decision,
 * 2026-10-21). A larger payment is refused before anything is spent and goes through the
 * message box instead; a payee refuses larger live messages and closes the session.
 */
export const MAX_LIVE_TRANSACTION_BYTES = 1_000_000
/**
 * The largest message an authenticated live session may send this wallet: a `payment` with
 * a {@link MAX_LIVE_TRANSACTION_BYTES} transaction in base64 (a third larger), plus 4096 bytes
 * for the rest of the message, as @bsv/webrtpay counts it (MAX_DIRECT_TRANSACTION_BYTES).
 */
export const MAX_LIVE_MESSAGE_BYTES = 4 * Math.ceil(MAX_LIVE_TRANSACTION_BYTES / 3) + 4096

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

function checkShareLocalAddress(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Connect directly on the same network must be on or off.')
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

/** `value` as a relay URL, or '' when it is none or not valid. */
function validRelayUrl(value: unknown): string {
  try { return checkRelayUrl(value) } catch { return '' }
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

/**
 * Falls back to the default for each stored field that is missing or no longer valid.
 * Without v3 settings, v2 or else v1 settings are used with relay signaling (and v1 with
 * receiving on); see the header.
 */
export function loadDirectPaySettings(): DirectPaySettings {
  const defaults = DEFAULT_DIRECT_PAY_SETTINGS
  let stored: Record<string, unknown> = {}
  try {
    let version = 3
    let text = localStorage.getItem(DIRECT_PAY_SETTINGS_KEY)
    if (text === null) { version = 2; text = localStorage.getItem(V2_DIRECT_PAY_SETTINGS_KEY) }
    if (text === null) { version = 1; text = localStorage.getItem(V1_DIRECT_PAY_SETTINGS_KEY) }
    if (text !== null && version < 3) {
      // Older settings are migrated even when they cannot be read.
      stored = { signaling: 'relay', ...(version === 1 && { receiveEnabled: true }) }
    }
    const parsed: unknown = JSON.parse(text ?? 'null')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const fields = parsed as Record<string, unknown>
      stored = version === 3 ? fields : { ...fields, ...stored }
      // A relay address the user entered stays; none (or one no longer valid) becomes the default.
      if (version < 3) stored.relayUrl = validRelayUrl(fields.relayUrl) || defaults.relayUrl
    }
  } catch { /* corrupt or unreadable storage: the defaults apply */ }

  const field = <T>(check: (value: unknown) => T, value: unknown, fallback: T): T => {
    try { return check(value) } catch { return fallback }
  }

  return withTurn(
    {
      receiveEnabled: field(checkReceiveEnabled, stored.receiveEnabled, defaults.receiveEnabled),
      shareLocalAddress: field(checkShareLocalAddress, stored.shareLocalAddress, defaults.shareLocalAddress),
      signaling: field(checkSignaling, stored.signaling, defaults.signaling),
      relayUrl: field(checkRelayUrl, stored.relayUrl, defaults.relayUrl),
      stunUrls: field(checkStunUrls, previousDefaultStun(stored.stunUrls) ? defaults.stunUrls : stored.stunUrls, [...defaults.stunUrls])
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
      shareLocalAddress: checkShareLocalAddress(input.shareLocalAddress ?? defaults.shareLocalAddress),
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

/**
 * `servers` (the relay's TURN answer) without its STUN entries: the relay passes on the
 * TURN provider's STUN urls (Cloudflare's), and only the settings' STUN list is asked.
 * An entry that lists both keeps its other urls.
 */
export function onlyOwnStun(servers: RTCIceServer[]): RTCIceServer[] {
  const out: RTCIceServer[] = []
  for (const server of servers) {
    const urls = (typeof server.urls === 'string' ? [server.urls] : [...server.urls]).filter(u => !/^stuns?:/i.test(u))
    if (urls.length > 0) out.push({ ...server, urls })
  }
  return out
}

/** True for a stored STUN list that is exactly {@link PREVIOUS_DEFAULT_STUN_URLS}. */
function previousDefaultStun(value: unknown): boolean {
  return Array.isArray(value) && value.length === PREVIOUS_DEFAULT_STUN_URLS.length && value.every((u, i) => u === PREVIOUS_DEFAULT_STUN_URLS[i])
}

/** Calls `fn` after every save (in this window). Returns the unsubscribe function. */
export function subscribeDirectPaySettings(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGED_EVENT, fn)
  return () => window.removeEventListener(CHANGED_EVENT, fn)
}
