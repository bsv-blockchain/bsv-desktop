/**
 * Default network service endpoints, keyed by chain.
 *
 * ChainTracks is served by the Arcade deployments, so a chain has one base URL
 * and ChainTracks lives under `/chaintracks/v1` on it (the `/v1` segment is
 * required — the bare `/chaintracks` path 404s).
 *
 * Keep in sync with src/lib/constants/endpoints.ts (renderer copy); the two
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

/*
 * Fallback providers, tried only after Arcade. These are the same hosts the
 * mobile wallet (bsv-wallet, packages/expo-wallet-toolbox) falls back to, so both
 * apps reach the same services on every chain. Main-process only: the renderer
 * never broadcasts.
 *
 * bsv-wallet also lists https://arc-teratest.taal.com for ttn; that name does not
 * resolve (NXDOMAIN), so ttn has no ARC fallback here.
 */

/** TAAL ARC, by chain. Serves `POST /v1/tx`; an API key is needed for it to accept. */
export const TAAL_ARC_URLS: Record<EndpointChain, string | undefined> = {
  main: 'https://arc.taal.com',
  test: 'https://arc-test.taal.com',
  ttn: undefined
}

/** GorillaPool ARC, by chain (mainnet only). Serves `POST /v1/tx`. */
export const GORILLAPOOL_ARC_URLS: Record<EndpointChain, string | undefined> = {
  main: 'https://arc.gorillapool.io',
  test: undefined,
  ttn: undefined
}

/** WhatsOnChain API root, by chain. ttn has its own deployment on the test API layout. */
export const WHATSONCHAIN_URLS: Record<EndpointChain, string> = {
  main: 'https://api.whatsonchain.com/v1/bsv/main',
  test: 'https://api.whatsonchain.com/v1/bsv/test',
  ttn: 'https://api.woc-ttn.bsvblockchain.tech/v1/bsv/test'
}
