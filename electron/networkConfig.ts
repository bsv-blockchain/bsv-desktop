import { arcadeUrl, chaintracksUrl, type EndpointChain } from './endpoints.js'

/** Nonsecret service preferences. Kept equivalent across the two build roots. */
export type WalletNetwork = EndpointChain
export interface NetworkSettings {
  arcadeUrl: string
  chaintracksUrl: string
  whatsOnChainUrl: string
  messageBoxUrl: string
  /** Message Box can be disabled independently of its default URL. */
  useMessageBox?: boolean
  /** Empty means the wallet data stays on this device. */
  storageUrl: string
  backupStorageUrls: string[]
  /**
   * Mandala issuer overlays for this network. Empty refuses Mandala assets
   * (fail closed); the wallet never invents an overlay.
   */
  mandalaOverlays: MandalaOverlaySetting[]
}
export interface MandalaOverlaySetting {
  url: string
  /** Lowercase compressed identity key of the overlay operator. */
  identityKey: string
}
export type NetworkSettingsMap = Record<WalletNetwork, NetworkSettings>
export const DEFAULT_MESSAGE_BOX_URL = 'https://messagebox.bsvblockchain.tech'
export const NETWORKS: ReadonlyArray<{ id: WalletNetwork; label: string; description: string }> = [
  { id: 'main', label: 'Mainnet', description: 'Real BSV payments' },
  { id: 'test', label: 'Testnet', description: 'Try payments with test coins' },
  { id: 'ttn', label: 'TeraTestNet', description: 'Large scale testing' },
  { id: 'tstn', label: 'Tera Scaling', description: 'TSTN · configure your services' },
]
export function isWalletNetwork(value: unknown): value is WalletNetwork {
  return NETWORKS.some(network => network.id === value)
}
export function defaultNetworkSettings(chain: WalletNetwork): NetworkSettings {
  return {
    arcadeUrl: arcadeUrl(chain),
    chaintracksUrl: chaintracksUrl(chain),
    whatsOnChainUrl: chain === 'main' || chain === 'test'
      ? `https://api.whatsonchain.com/v1/bsv/${chain}`
      : chain === 'ttn' ? 'https://api.woc-ttn.bsvblockchain.tech/v1/bsv/test' : '',
    messageBoxUrl: DEFAULT_MESSAGE_BOX_URL,
    useMessageBox: true,
    storageUrl: '',
    backupStorageUrls: [],
    mandalaOverlays: [],
  }
}
export function defaultNetworkSettingsMap(): NetworkSettingsMap {
  return Object.fromEntries(NETWORKS.map(({ id }) => [id, defaultNetworkSettings(id)])) as NetworkSettingsMap
}
function serviceUrl(value: unknown, label: string, required: boolean): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a URL`)
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    if (required) throw new Error(`${label} is required for this network`)
    return ''
  }
  let url: URL
  try { url = new URL(trimmed) } catch { throw new Error(`${label} must be a valid HTTP or HTTPS URL`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error(`${label} must be an HTTP or HTTPS URL without credentials, query or fragment`)
  }
  return trimmed
}
export function normalizeMessageBoxUrl(value?: string | null): string {
  return serviceUrl(value ?? '', 'Message Box URL', false) || DEFAULT_MESSAGE_BOX_URL
}
export const MAX_MANDALA_OVERLAYS = 4
const IDENTITY_KEY = /^0[23][0-9a-f]{64}$/
function mandalaOverlay(value: unknown): MandalaOverlaySetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mandala overlay settings are invalid')
  const entry = value as Partial<Record<keyof MandalaOverlaySetting, unknown>>
  const url = serviceUrl(entry.url, 'Mandala overlay URL', true)
  const identityKey = typeof entry.identityKey === 'string' ? entry.identityKey.trim().toLowerCase() : ''
  if (!IDENTITY_KEY.test(identityKey)) throw new Error('Mandala overlay identity key must be a 66-character compressed public key in hex')
  return { url, identityKey }
}
/**
 * Strict rejects the whole list on any bad entry. Lenient (restoring saved
 * settings) keeps the valid entries: first of a duplicate key wins, capped at 4.
 */
export function normalizeMandalaOverlays(value: unknown, strict: boolean): MandalaOverlaySetting[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    if (strict) throw new Error('Mandala overlay settings are invalid')
    return []
  }
  if (strict && value.length > MAX_MANDALA_OVERLAYS) throw new Error(`At most ${MAX_MANDALA_OVERLAYS} Mandala overlays`)
  const overlays: MandalaOverlaySetting[] = []
  for (const item of value) {
    if (overlays.length === MAX_MANDALA_OVERLAYS) break
    let overlay: MandalaOverlaySetting
    try { overlay = mandalaOverlay(item) } catch (error) {
      if (strict) throw error
      continue
    }
    if (overlays.some(existing => existing.identityKey === overlay.identityKey)) {
      if (strict) throw new Error('Each Mandala overlay identity key may appear once')
      continue
    }
    overlays.push(overlay)
  }
  return overlays
}
export function normalizeNetworkSettings(chain: WalletNetwork, settings: Partial<NetworkSettings>, requireServices = true): NetworkSettings {
  if (!isWalletNetwork(chain)) throw new Error('Choose a supported BSV network')
  const merged = { ...defaultNetworkSettings(chain), ...settings }
  if (!Array.isArray(merged.backupStorageUrls)) throw new Error('Backup storage settings are invalid')
  return {
    arcadeUrl: serviceUrl(merged.arcadeUrl, 'Arcade URL', requireServices),
    chaintracksUrl: serviceUrl(merged.chaintracksUrl, 'ChainTracks URL', requireServices),
    whatsOnChainUrl: serviceUrl(merged.whatsOnChainUrl, 'Address explorer API URL', false),
    messageBoxUrl: normalizeMessageBoxUrl(merged.messageBoxUrl),
    useMessageBox: merged.useMessageBox !== false,
    storageUrl: serviceUrl(merged.storageUrl, 'Wallet storage URL', false),
    backupStorageUrls: merged.backupStorageUrls.map(url => url === 'LOCAL_STORAGE' ? url : serviceUrl(url, 'Backup storage URL', true)),
    mandalaOverlays: normalizeMandalaOverlays(merged.mandalaOverlays, requireServices),
  }
}
export function restoreNetworkSettings(value: unknown): NetworkSettingsMap {
  const settings = defaultNetworkSettingsMap()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const { id } of NETWORKS) {
      const saved = (value as Partial<NetworkSettingsMap>)[id]
      if (saved) settings[id] = normalizeNetworkSettings(id, saved, false)
    }
  }
  return settings
}
