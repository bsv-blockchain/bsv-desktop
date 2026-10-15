import { arcadeUrl, chaintracksUrl, type EndpointChain } from './constants/endpoints'

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
