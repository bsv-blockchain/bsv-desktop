// WhatsOnChain endpoint helpers, keyed by BSV chain.
//
// TeraTestNet ('ttn') uses a dedicated WoC-compatible host and reuses the
// testnet path segment. mainnet/testnet use the public whatsonchain.com API.

export type Chain = 'main' | 'test' | 'ttn' | 'tstn'
let configured: Partial<Record<Chain, string>> = {}

/** Called when the wallet restores or changes its nonsecret service settings. */
export function setWocEndpoints(settings: Partial<Record<Chain, { whatsOnChainUrl: string }>>): void {
  configured = Object.fromEntries(Object.entries(settings).map(([chain, value]) => [chain, value.whatsOnChainUrl]))
}

/** WhatsOnChain REST API base for the given chain (no trailing slash). */
export function wocApiBase(chain: Chain): string {
  if (configured[chain]) return configured[chain]
  if (chain === 'tstn') throw new Error('Set an address explorer API URL for TSTN in Network settings first.')
  return chain === 'ttn'
    ? 'https://api.woc-ttn.bsvblockchain.tech/v1/bsv/test'
    : `https://api.whatsonchain.com/v1/bsv/${chain}`
}

/** WhatsOnChain explorer base for transaction links. */
export function wocExplorerBase(chain: Chain): string {
  // The mobile wallet publishes API roots, but no Tera explorer web URLs.
  if (chain === 'ttn' || chain === 'tstn') return ''
  return chain === 'main' ? 'https://whatsonchain.com' : 'https://test.whatsonchain.com'
}
