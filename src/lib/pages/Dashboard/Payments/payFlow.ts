/**
 * Paying a wallet identity: live (direct) first, the message box second. The user never picks
 * a route; when the live attempt stopped before anything was made (a {@link NotSentError}
 * whose dial failed because the recipient is offline, not receiving, or the link did not come
 * up), the page asks before sending it to their message box instead. One payment is always
 * one transaction: a failure after the payment was made is never offered the fallback, since
 * that would build a second one (it stays in Saved payments for a retry).
 */
import { NotSentError } from './directPayments'

export const NETWORK_FAILED = "Couldn't reach the payment network — check your connection."

export type PayOutcome =
  | { kind: 'paid_live'; ackStatus: string }
  | { kind: 'paid_messagebox' }
  | { kind: 'ask_fallback'; reason: 'offline' | 'link_failed' }
  | { kind: 'failed'; message: string }

const messageOf = (error: unknown) => (error instanceof Error && error.message) || 'The payment could not be sent.'

/**
 * Runs `direct` when given, else `messageBox`. A direct attempt that could not reach the
 * recipient asks for the message box fallback when `messageBox` is given; the caller runs it
 * after the user agrees (call again without `direct`).
 */
export async function payIdentity(o: {
  direct?: () => Promise<{ ackStatus: string }>
  messageBox?: () => Promise<void>
  /** Who is being paid, for the message when there is no message box to fall back to. */
  name?: string
}): Promise<PayOutcome> {
  if (o.direct) {
    try {
      const { ackStatus } = await o.direct()
      return { kind: 'paid_live', ackStatus }
    } catch (error) {
      if (!(error instanceof NotSentError)) return { kind: 'failed', message: messageOf(error) }
      switch (error.failure) {
        case 'offline':
        case 'not_receiving':
          if (o.messageBox) return { kind: 'ask_fallback', reason: 'offline' }
          return { kind: 'failed', message: `${o.name || 'The recipient'} isn't online right now. Nothing was spent. Connect a message box in Settings to pay people who are offline.` }
        case 'link_failed':
          if (o.messageBox) return { kind: 'ask_fallback', reason: 'link_failed' }
          return { kind: 'failed', message: `Couldn't connect to ${o.name || 'the recipient'} directly. Nothing was spent.` }
        case 'network':
          return { kind: 'failed', message: NETWORK_FAILED }
        default:
          return { kind: 'failed', message: messageOf(error) }
      }
    }
  }
  if (!o.messageBox) return { kind: 'failed', message: 'Connect your message box in Settings to pay a wallet identity. Address payments are available.' }
  try {
    await o.messageBox()
    return { kind: 'paid_messagebox' }
  } catch (error) {
    return { kind: 'failed', message: messageOf(error) }
  }
}

/** The fallback prompt for `reason`, naming the recipient. */
export function fallbackPrompt(reason: 'offline' | 'link_failed', name: string): string {
  return reason === 'offline'
    ? `${name} isn't online right now. Send it to their message box? They'll get it next time they open their wallet.`
    : `Couldn't connect to ${name} directly. Send it to their message box instead?`
}
