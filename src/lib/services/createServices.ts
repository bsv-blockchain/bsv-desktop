import { Services, ChaintracksServiceClient } from '@bsv/wallet-toolbox-client'
import { chaintracksUrl, type EndpointChain } from '../constants/endpoints'

/**
 * Services factory with ChainTracks pointed at the Arcade deployments.
 *
 * The toolbox defaults still resolve main/test ChainTracks to the retired
 * babbage.systems hosts, so every renderer-side Services instance goes through
 * here rather than calling `new Services(chain)` directly.
 */
export function createServices(chain: EndpointChain): Services {
  const options = Services.createDefaultOptions(chain)
  options.chaintracks = new ChaintracksServiceClient(chain, chaintracksUrl(chain))
  return new Services(options)
}
