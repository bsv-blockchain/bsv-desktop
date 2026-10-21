
import { Services, ChaintracksServiceClient } from '@bsv/wallet-toolbox-client'
import { Hash, Utils, type KeyDeriverApi } from '@bsv/sdk'
import type { EndpointChain } from '../constants/endpoints'
import { normalizeNetworkSettings, type NetworkSettings } from '../networkConfig'

/**
 * The token Arcade scopes a wallet's status events by, derived exactly as
 * bsv-wallet derives it (packages/expo-wallet-toolbox, deriveCallbackToken):
 * the SHA-256 of the wallet's BRC-42 private key for protocol
 * [2, 'arcade callback token'], key ID '1', counterparty 'self', as its first
 * 32 hex characters. A wallet open on both devices therefore shares one event
 * stream, each profile has its own, and restoring a wallet restores its token.
 * test/arcade.test.ts pins it to the same known-answer vectors as bsv-wallet.
 *
 * Only the renderer holds the key, so it hands the result to the main process
 * and the monitor worker (assertArcadeCallbackToken in electron/arcade.ts).
 */
export function deriveArcadeCallbackToken(keyDeriver: Pick<KeyDeriverApi, 'derivePrivateKey'>): string {
  const key = keyDeriver.derivePrivateKey([2, 'arcade callback token'], '1', 'self')
  // Hashed unpadded, as bsv-wallet hashes it: a key with a leading zero byte is 31 bytes.
  return Utils.toHex(Hash.sha256(key.toArray())).slice(0, 32)
}

/**
 * Services factory with ChainTracks and Arcade pointed at the Arcade deployments.
 *
 * The toolbox defaults still resolve main/test ChainTracks to the retired
 * babbage.systems hosts, so every renderer-side Services instance goes through
 * here rather than calling `new Services(chain)` directly.
 *
 * The renderer does not broadcast — local storage broadcasts from the main
 * process (electron/arcade.ts), remote storage from its server — but it does
 * look up proofs, and those should come from Arcade first, as they do there.
 * Pass the wallet's callback token (deriveArcadeCallbackToken) so that anything
 * this instance does send to Arcade reports into the wallet's SSE stream.
 */
export function createServices(chain: EndpointChain, callbackToken?: string, settings?: Partial<NetworkSettings>): Services {
  const resolved = normalizeNetworkSettings(chain, settings || {})
  const options = Services.createDefaultOptions(chain)
  options.chaintracks = new ChaintracksServiceClient(chain, resolved.chaintracksUrl)
  options.arcadeUrl = resolved.arcadeUrl
  options.arcadeConfig = {
    deploymentId: options.arcConfig?.deploymentId,
    callbackToken,
    headers: { 'X-FullStatusUpdates': 'true' }
  }
  const services = new Services(options)
  // The toolbox keeps provider URLs on the instance. Always point address
  // lookups at the selected chain's configured explorer.
  if (resolved.whatsOnChainUrl) (services.whatsonchain as any).URL = resolved.whatsOnChainUrl
  return services
}
