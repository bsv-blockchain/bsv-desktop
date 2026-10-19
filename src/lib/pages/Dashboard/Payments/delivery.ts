/**
 * How a wallet (identity) payment reaches its recipient: stored in their message box, or
 * delivered straight to their wallet over a direct connection (see directPayments.ts).
 */
import type { DirectPaySnapshot } from '../../../services/DirectPayManager'
import { directPayState } from '../../../components/DirectPayConfig/status'

export type Delivery = 'messagebox' | 'direct'

export const DELIVERY_HELP: Record<Delivery, string> = {
  messagebox: "Message box · waits in the recipient's message box, so it arrives even if they're offline",
  direct: "Direct · connects to the recipient's wallet first; nothing is spent if they're offline. A direct payment reveals your IP address to their wallet."
}

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

/**
 * Why face-to-face codes (Nearby → Direct) cannot be used right now, for the user; empty when
 * they can. They need a client but no signaler.
 */
export function codeExchangeProblem(directPay: Pick<DirectPaySnapshot, 'error'> & { client: unknown }): string {
  if (directPay.client) return ''
  return directPay.error || 'Direct payments are not ready yet. Try again in a moment.'
}

export type LiveStatus = { tone: 'on' | 'off' | 'starting' | 'error'; title: string; body: string }

/** The Receive tab's card about receiving live (direct) payments. */
export function liveStatus(s: Pick<DirectPaySnapshot, 'status' | 'via' | 'error' | 'notice'>): LiveStatus {
  switch (directPayState(s)) {
    case 'online_messagebox':
    case 'online_relay': return { tone: 'on', title: 'Open to live payments', body: 'People can pay you directly while this app is open.' }
    case 'starting': return { tone: 'starting', title: 'Connecting…', body: 'Getting ready to take live payments.' }
    // No message box to signal through: off, and the notice says why.
    case 'not_set_up': return { tone: 'off', title: 'Live payments are off', body: s.notice }
    case 'failed': return { tone: 'error', title: "Live payments aren't working right now", body: s.error || 'Live payments cannot be received right now.' }
    default: return { tone: 'off', title: 'Live payments are off', body: 'Turn them on in Settings so people can pay you directly while this app is open.' }
  }
}
