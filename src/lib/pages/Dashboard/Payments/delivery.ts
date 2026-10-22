/**
 * How a wallet (identity) payment reaches its recipient: live, straight to their wallet over a
 * direct connection (see directPayments.ts), or stored in their message box. The Send tab
 * tries live first and asks before using the message box (see payFlow.ts); saved payments can
 * be retried either way.
 */
import type { DirectPaySnapshot } from '../../../services/DirectPayManager'
import { directPayState } from '../../../components/DirectPayConfig/status'

export type Delivery = 'messagebox' | 'direct'

/**
 * Why a payment cannot be delivered the chosen way right now, for the user; empty when it
 * can. Direct sending needs a client with a signaler (`via`), but not receiving.
 */
export function deliveryProblem(delivery: Delivery, o: { messageBoxAvailable: boolean; directPay: Pick<DirectPaySnapshot, 'via' | 'error' | 'notice'> & { client: unknown } }): string {
  if (delivery === 'messagebox') return o.messageBoxAvailable ? '' : 'Connect your message box in Settings to pay a wallet identity. Address payments are available.'
  const { client, via, error, notice } = o.directPay
  if (!client) return error || notice || 'Direct payments are not ready yet. Try again in a moment.'
  if (via === null) return error || notice || 'Direct payments are not set up. Check Direct payments in Settings.'
  return ''
}

export type LiveStatus = { tone: 'on' | 'off' | 'starting' | 'error'; title: string; body: string }

const OPEN = 'People can pay you directly while this screen is open.'

/** The Receive tab's card about receiving live (direct) payments, naming the way it receives. */
export function liveStatus(s: Pick<DirectPaySnapshot, 'status' | 'via' | 'error' | 'notice'> & { relayUnreachable?: boolean }): LiveStatus {
  switch (directPayState(s)) {
    case 'online_relay': return { tone: 'on', title: 'Open to live payments', body: `${OPEN} Connected via relay.` }
    case 'online_messagebox': return { tone: 'on', title: 'Open to live payments', body: `${OPEN} Connected via message box.` }
    case 'online_fallback': return { tone: 'on', title: 'Open to live payments', body: `${OPEN} Connected via message box (relay unreachable).` }
    case 'starting': return { tone: 'starting', title: 'Connecting…', body: 'Getting ready to take live payments.' }
    // No message box to signal through: off, and the notice says why.
    case 'not_set_up': return { tone: 'off', title: 'Live payments are off', body: s.notice }
    case 'failed': return { tone: 'error', title: "Live payments aren't working right now", body: s.error || 'Live payments cannot be received right now.' }
    default: return { tone: 'off', title: 'Live payments are off', body: 'Turn them on in Settings so people can pay you directly while this screen is open.' }
  }
}
