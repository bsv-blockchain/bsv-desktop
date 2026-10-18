/**
 * How a wallet (identity) payment reaches its recipient: stored in their message box, or
 * delivered straight to their wallet over a direct connection (see directPayments.ts).
 */
import type { DirectPaySnapshot } from '../../../services/DirectPayManager'
import { directPayState } from '../../../components/DirectPayConfig/status'

export type Delivery = 'messagebox' | 'direct'

export const DELIVERY_HELP: Record<Delivery, string> = {
  messagebox: "Message box · waits in the recipient's message box, so it arrives even if they're offline",
  direct: "Direct · connects to the recipient's wallet first; nothing is spent if they're offline"
}

/**
 * Why a payment cannot be delivered the chosen way right now, for the user; empty when it
 * can. Direct sending needs a client with a signaler (`via`), but not receiving.
 */
export function deliveryProblem(delivery: Delivery, o: { messageBoxAvailable: boolean; directPay: Pick<DirectPaySnapshot, 'via' | 'error'> & { client: unknown } }): string {
  if (delivery === 'messagebox') return o.messageBoxAvailable ? '' : 'Connect your message box in Settings to pay a wallet identity. Address payments are available.'
  if (!o.directPay.client) return 'Direct payments are not ready yet. Try again in a moment.'
  if (o.directPay.via === null) return o.directPay.error || 'Direct payments are not set up. Check Direct payments in Settings.'
  return ''
}

/** The Receive tab's line about receiving direct payments. */
export function directStatusLine(s: Pick<DirectPaySnapshot, 'status' | 'via' | 'error'>): { severity: 'success' | 'info' | 'warning' | 'error'; text: string } {
  switch (directPayState(s)) {
    case 'online_messagebox': return { severity: 'success', text: 'Direct payments: online via the message box.' }
    case 'online_relay': return { severity: 'success', text: 'Direct payments: online via the relay server.' }
    case 'starting': return { severity: 'info', text: 'Direct payments: starting…' }
    case 'not_set_up': return { severity: 'warning', text: `Direct payments: not set up. ${s.error || 'Check Direct payments in Settings.'}` }
    case 'failed': return { severity: 'error', text: s.error || 'Direct payments cannot be received right now.' }
    default: return { severity: 'info', text: 'Direct payments: off — enable in Settings.' }
  }
}
