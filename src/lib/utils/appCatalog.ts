import { AppCatalog } from 'metanet-apps'
import type { PublishedApp } from 'metanet-apps/src/types'
import type { WalletInterface } from '@bsv/sdk'

/**
 * Mainnet overlay hosts that run ls_apps (the service metanetapps.com reads).
 * The library default also lists users.bapp.dev, which answers 400 for ls_apps.
 */
export const APP_CATALOG_HOSTS = [
  'https://overlay-us-1.bsvb.tech',
  'https://overlay-eu-1.bsvb.tech',
  'https://overlay-ap-1.bsvb.tech',
]

const LOOKUP_TIMEOUT_MS = 15000

/**
 * Loads the Discover catalog from ls_apps.
 *
 * The network is passed explicitly: without it the library asks a fresh
 * WalletClient for the network, which from inside the wallet has no substrate
 * to talk to. On mainnet every catalog host is queried and the results merged,
 * because a single SLAP-picked host can return a partial catalog.
 */
export async function loadAppCatalog(chain: string): Promise<PublishedApp[]> {
  const mainnet = chain === 'main'
  // Lookups never use the wallet; an empty one stops the library creating a WalletClient.
  const catalog = new AppCatalog({ networkPreset: mainnet ? 'mainnet' : 'testnet', wallet: {} as WalletInterface })
  if (!mainnet) return catalog.findApps()

  const { apps, diagnostics } = await catalog.findAppsAcrossHosts({}, { hosts: APP_CATALOG_HOSTS, timeout: LOOKUP_TIMEOUT_MS })
  if (apps.length) return apps
  if (diagnostics.hosts.every(host => !host.ok)) {
    // Every known host is down: fall back to SLAP discovery before giving up.
    return catalog.findApps()
  }
  return apps
}
