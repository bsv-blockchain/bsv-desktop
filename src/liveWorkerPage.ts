/**
 * The live payments worker's page (electron/liveWorker.ts): it runs @bsv/webrtpay's
 * DirectPayClient for the wallet window, over the port the preload hands it. It holds no
 * keys, has no Node and no network of its own; see src/lib/services/liveWorker/host.ts.
 */
import { DirectPayClient, WebRTPayError } from '@bsv/webrtpay'
import { serveLiveWorker } from './lib/services/liveWorker/host'
import type { PortLike } from './lib/services/liveWorker/rpc'

const PORT_MESSAGE = 'bsv-desktop:live-worker-port'

// One port per wallet window connection (a reloaded wallet window connects again).
window.addEventListener('message', event => {
  if (event.source !== window || event.data !== PORT_MESSAGE || event.ports.length !== 1) return
  serveLiveWorker(event.ports[0] as unknown as PortLike, { DirectPayClient, WebRTPayError })
})
