import { Beef, Utils } from '@bsv/sdk'
import { wocFetch } from './RateLimitedFetch'
import { wocApiBase } from './woc'

export default async function getBeefForTxid(txid: string, chain: 'main' | 'test' | 'ttn'): Promise<Beef> {
  const baseUrl = wocApiBase(chain)

  // Fetch BEEF from WhatsOnChain's BEEF endpoint
  const beefResponse = await wocFetch.fetch(`${baseUrl}/tx/${txid}/beef`)

  if (!beefResponse.ok) {
    throw new Error(`Failed to fetch BEEF for transaction ${txid}: ${beefResponse.statusText}`)
  }

  const beefHex = await beefResponse.text()

  if (!beefHex || beefHex.includes('error')) {
    throw new Error(`Failed to fetch BEEF for transaction ${txid}`)
  }

  // Parse BEEF from hex
  const beef = Beef.fromBinary(Utils.toArray(beefHex, 'hex'))

  return beef
}
