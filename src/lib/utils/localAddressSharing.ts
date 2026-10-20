import { loadDirectPaySettings, subscribeDirectPaySettings } from './directPaySettings'

/**
 * Keeps the window's WebRTC address policy in step with the "Connect directly on the same
 * network" setting: sends it now and after every save. Call once when the app starts, before
 * any wallet opens. `apply` is the Electron bridge; without one (a plain browser) nothing is
 * sent. Returns the function that stops following.
 */
export function followLocalAddressSharing(
  apply: ((share: boolean) => Promise<void>) | undefined = typeof window === 'undefined' ? undefined : window.electronAPI?.webrtc?.shareLocalAddress
): () => void {
  if (!apply) return () => {}
  const send = () => {
    apply(loadDirectPaySettings().shareLocalAddress).catch(error => {
      console.warn('[DirectPay] Could not apply the same-network setting:', error)
    })
  }
  send()
  return subscribeDirectPaySettings(send)
}
