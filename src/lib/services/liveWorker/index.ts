/**
 * The DirectPayClient the app uses: its WebRTC runs in the live payments worker, a hidden
 * sandboxed window that holds no keys (see remote.ts and electron/liveWorker.ts). Outside
 * Electron (no `window.electronAPI.liveWorker`) clients cannot start, and say so.
 */
import { MAX_LIVE_TRANSACTION_BYTES } from '../../utils/directPaySettings'
import { LiveWorkerLink, remoteClientClass } from './remote'
import type { WorkerLauncher } from './remote'
import type { PortLike } from './rpc'

/** How long the worker may take to start and hand over its port. */
const OPEN_TIMEOUT_MS = 15_000
/** The window message the preload posts the worker's port with (electron/preload.ts). */
export const PORT_MESSAGE = 'bsv-desktop:live-worker-port'

/** The preload's live worker bridge; none outside the Electron renderer (tests, a browser). */
const api = () => (typeof window !== 'undefined' ? window.electronAPI?.liveWorker : undefined)

const electronLauncher: WorkerLauncher = {
  open: () => {
    const live = api()
    if (!live) return Promise.reject(new Error('Live payments need the desktop app'))
    return new Promise<PortLike>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        if (event.source !== window || event.data !== PORT_MESSAGE || !event.ports?.[0]) return
        done()
        resolve(event.ports[0] as unknown as PortLike)
      }
      const timer = setTimeout(() => { done(); reject(new Error('it did not start in time')) }, OPEN_TIMEOUT_MS)
      const done = () => { clearTimeout(timer); window.removeEventListener('message', onMessage) }
      window.addEventListener('message', onMessage)
      live.open().catch(e => { done(); reject(e) })
    })
  },
  close: () => api()?.close(),
  onGone: fn => api()?.onGone(fn) ?? (() => {})
}

export const liveWorkerLink = new LiveWorkerLink(electronLauncher, MAX_LIVE_TRANSACTION_BYTES)

/** Takes DirectPayClient's options and offers the methods the app uses (see remote.ts). */
export const DirectPayClient = remoteClientClass(liveWorkerLink)
export type DirectPayClient = InstanceType<typeof DirectPayClient>
