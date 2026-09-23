/**
 * Default network service endpoints, keyed by chain.
 *
 * ChainTracks is served by the Arcade deployments, so a chain has one base URL
 * and ChainTracks lives under `/chaintracks/v1` on it (the `/v1` segment is
 * required — the bare `/chaintracks` path 404s).
 *
 * Keep in sync with electron/endpoints.ts (main-process copy); the two
 * roots compile separately, and test/endpoints.test.ts asserts they match.
 */

export type EndpointChain = 'main' | 'test' | 'ttn'

/** Arcade base URL per chain. */
export const ARCADE_URLS: Record<EndpointChain, string> = {
  main: 'https://arcade-v2-us-1.bsvblockchain.tech',
  test: 'https://arcade-v2-testnet-us-1.bsvblockchain.tech',
  ttn: 'https://arcade-v2-ttn-us-1.bsvblockchain.tech'
}

/** Arcade base URL for the chain (no trailing slash). */
export function arcadeUrl(chain: EndpointChain): string {
  return ARCADE_URLS[chain]
}

/** ChainTracks service base URL for the chain (no trailing slash). */
export function chaintracksUrl(chain: EndpointChain): string {
  return `${ARCADE_URLS[chain]}/chaintracks/v1`
}
