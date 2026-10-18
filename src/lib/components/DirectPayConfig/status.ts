import type { DirectPaySnapshot } from '../../services/DirectPayManager'

/**
 * What the direct-pay snapshot means for the user. An `error` without `via` means no
 * signaler could be set up (no message box, or relay signaling without an address): a
 * gap in the setup that `error` explains, not a failure. With `via`, receiving was set up
 * and failed; the manager keeps trying.
 */
export type DirectPayState = 'off' | 'starting' | 'online_messagebox' | 'online_relay' | 'not_set_up' | 'failed'

export function directPayState(s: Pick<DirectPaySnapshot, 'status' | 'via'>): DirectPayState {
  switch (s.status) {
    case 'starting': return 'starting'
    case 'online': return s.via === 'relay' ? 'online_relay' : 'online_messagebox'
    case 'error': return s.via === null ? 'not_set_up' : 'failed'
    default: return 'off'
  }
}

export const DIRECT_PAY_STATE_COLOR: Record<DirectPayState, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  off: 'default',
  starting: 'info',
  online_messagebox: 'success',
  online_relay: 'success',
  not_set_up: 'warning',
  failed: 'error'
}
