// WhatsOnChain endpoint helpers, keyed by BSV chain.
//
// TeraTestNet ('ttn') uses a dedicated WoC-compatible host and reuses the
// testnet path segment. mainnet/testnet use the public whatsonchain.com API.

export type Chain = 'main' | 'test' | 'ttn'

/** WhatsOnChain REST API base for the given chain (no trailing slash). */
export function wocApiBase(chain: Chain): string {
  return chain === 'ttn'
    ? 'https://api.woc-ttn.bsvblockchain.tech/v1/bsv/test'
    : `https://api.whatsonchain.com/v1/bsv/${chain}`
}

/** WhatsOnChain explorer base for transaction links. */
export function wocExplorerBase(chain: Chain): string {
  // TeraTestNet has no public WoC explorer; fall back to the testnet explorer.
  return chain === 'main' ? 'https://whatsonchain.com' : 'https://test.whatsonchain.com'
}
