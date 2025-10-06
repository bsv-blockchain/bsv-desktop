import { Beef } from '@bsv/sdk'
import { wocFetch } from './RateLimitedFetch'

export default async function getBeefForTxid(txid: string, chain: 'main' | 'test'): Promise<Beef> {
  const baseUrl = `https://api.whatsonchain.com/v1/bsv/${chain}`

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
  const beef = Beef.fromBinary(Array.from(Buffer.from(beefHex, 'hex')))

  return beef
}
