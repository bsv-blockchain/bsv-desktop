
import { Services, ChaintracksServiceClient } from '@bsv/wallet-toolbox-client'
import { arcadeUrl, chaintracksUrl, type EndpointChain } from '../constants/endpoints'

const IDENTITY_KEY = /^0[23][0-9a-fA-F]{64}$/

/**
 * The token Arcade scopes a wallet's status events by: the first 32 hex
 * characters of the identity key, as bsv-wallet derives it. Must match
 * arcadeCallbackToken in electron/arcade.ts (test/arcade.test.ts checks).
 */
export function arcadeCallbackToken(identityKey: string): string {
  if (!IDENTITY_KEY.test(identityKey)) {
    throw new Error('An Arcade callback token is derived from a compressed identity key')
  }
  return identityKey.substring(0, 32)
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
 * Pass the wallet's identity key so that anything this instance does send to
 * Arcade reports into the wallet's SSE stream.
 */
export function createServices(chain: EndpointChain, identityKey?: string): Services {
  const options = Services.createDefaultOptions(chain)
  options.chaintracks = new ChaintracksServiceClient(chain, chaintracksUrl(chain))
  options.arcadeUrl = arcadeUrl(chain)
  options.arcadeConfig = {
    deploymentId: options.arcConfig?.deploymentId,
    callbackToken: identityKey ? arcadeCallbackToken(identityKey) : undefined,
    headers: { 'X-FullStatusUpdates': 'true' }
  }
  return new Services(options)
}
