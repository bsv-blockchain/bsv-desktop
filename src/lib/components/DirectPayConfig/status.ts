import type { DirectPaySnapshot } from '../../services/DirectPayManager'

/**
 * What the direct-pay snapshot means for the user. `not_set_up`: receiving is off because
 * there is nothing to signal through (no message box); the snapshot's `notice` explains
 * it, and it is not a failure. `failed`: a real error, explained by `error`: relay
 * signaling without an address, or receiving set up and failing (the relay is down; its
 * signaler keeps trying).
 */
export type DirectPayState = 'off' | 'starting' | 'online_messagebox' | 'online_relay' | 'not_set_up' | 'failed'

export function directPayState(s: Pick<DirectPaySnapshot, 'status' | 'via' | 'notice'>): DirectPayState {
  switch (s.status) {
    case 'starting': return 'starting'
    case 'online': return s.via === 'relay' ? 'online_relay' : 'online_messagebox'
    case 'error': return 'failed'
    default: return s.notice ? 'not_set_up' : 'off'
  }
}

export const DIRECT_PAY_STATE_COLOR: Record<DirectPayState, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  off: 'default',
  starting: 'info',
  online_messagebox: 'success',
  online_relay: 'success',
  not_set_up: 'default',
  failed: 'error'
}
