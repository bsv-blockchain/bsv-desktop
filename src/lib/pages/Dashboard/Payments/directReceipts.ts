/**
 * What the user is told about direct payments this wallet received: whether a payment is in
 * the wallet or only kept on this device until the wallet can add it (see directPayments.ts),
 * and how to recover a kept payment by hand when retrying stops working.
 */
import { Utils } from '@bsv/sdk'
import type { KeptCount, KeptDirectPaymentInfo } from './directPayments'
import { validAmount } from './paymentProtocol'

const RETRYING = 'it will be added when your wallet can verify it — retrying automatically'

/**
 * The Payments page notice for a direct payment that arrived (by identity key, or over a code
 * exchange). Only `accepted` means the wallet took it; anything else was received and kept on
 * this device, not verified yet, so it is never worded or coloured as a plain success (final
 * review D6). The amount is always given when known, and a requested amount the payment differs
 * from (Ruling 29).
 */
export function receivedNotice(r: { amount?: unknown; status?: unknown; requested?: unknown }): { text: string; severity: 'success' | 'warning' } {
  const amount = validAmount(r.amount) ? `: ${r.amount.toLocaleString()} satoshis.` : '.'
  const requested = validAmount(r.requested) ? ` You requested ${r.requested.toLocaleString()} satoshis.` : ''
  if (r.status === 'accepted') return { severity: 'success', text: `Direct payment added to your wallet${amount}${requested}` }
  return { severity: 'warning', text: `Direct payment received, not yet added${amount}${requested} It is not in your balance yet; ${RETRYING}.` }
}

/** The payee's code-exchange screen once the payment arrived (see DirectReceiptView). */
export function payeeReceipt(status: 'accepted' | 'received'): { added: boolean; heading: string; detail: string } {
  if (status === 'accepted') return { added: true, heading: 'Payment added to your wallet', detail: '' }
  return { added: false, heading: 'Received, not yet added', detail: `It is not in your balance yet and has not been verified. It will be added when your wallet can verify it — retrying automatically. Do not treat it as paid until then.` }
}

/** What the payer is told after delivering a direct payment, from the payee's acknowledgement. */
export function payerReceipt(status: 'accepted' | 'received' | 'rejected'): string {
  if (status === 'accepted') return 'It is in their wallet.'
  return 'Their wallet received it but has not added it yet; it will be added when their wallet can verify it, which it retries automatically.'
}

/** A kept payment's line in the Payments page's list of payments not yet in the wallet. */
export function keptStatusText(p: KeptDirectPaymentInfo): string {
  if (!p.needsAttention) return 'Received, not yet added. It will be added when your wallet can verify it — retrying automatically.'
  const why = p.needsAttention.reason === 'refused' ? 'your wallet refused it' : 'your wallet could not verify it after repeated tries'
  return `Needs attention: your wallet could not add it (${why}). It stays on this device and is tried again from time to time. Copy the recovery details and keep them: with them, this payment can be added to your wallet by hand.`
}

/**
 * Whether the Payments page offers to dismiss a kept payment: only one that needs attention, and
 * only once the user copied its recovery details (`copied`: keys copied in this view), so that
 * dismissing it never leaves the payment with no way back.
 */
export function canDismissKept(p: KeptDirectPaymentInfo, copied: ReadonlySet<string>): boolean {
  return p.needsAttention !== undefined && copied.has(p.key)
}

/** The question before a kept payment is dismissed. */
export function dismissConfirmText(p: KeptDirectPaymentInfo): string {
  return `Dismiss the payment of ${p.amount.toLocaleString()} satoshis from ${p.sender.slice(0, 12)}…? It is removed from this device and your wallet stops trying to add it. After this, only the recovery details you copied can add it to your wallet, so keep them somewhere safe.`
}

/**
 * The Payments page warning when this wallet's kept payments cannot be read (see
 * directPayments.ts): nothing writes over them, so payments the wallet cannot add at once are
 * refused, and their payers keep them.
 */
export const KEPT_UNREADABLE = 'Direct payments kept on this device for this wallet could not be read. They are left as they are. Until they can be read, a direct payment your wallet cannot add at once is refused, and its sender keeps it.'

/** The Payments page note for kept entries this version does not recognise. */
export function keptUnknownText(count: number): string {
  return count === 1
    ? 'One entry in the direct payments kept on this device could not be read by this version of BSV Desktop. It is left as it is.'
    : `${count} entries in the direct payments kept on this device could not be read by this version of BSV Desktop. They are left as they are.`
}

/**
 * Everything needed to add a kept payment by hand, as JSON: the transaction (Atomic BEEF, hex),
 * the output and its BRC-29 derivation, and the payer. Only this device has the derivation,
 * and the payer will not send the payment again.
 */
export function recoveryDetails(p: KeptDirectPaymentInfo, o: { identity: string; chain: string }): string {
  const { token } = p.payment
  return JSON.stringify({
    about: 'A direct BSV payment this wallet acknowledged as received but could not add. Add it with internalizeAction: tx = atomicBEEF, output outputIndex with protocol "wallet payment" and paymentRemittance { senderIdentityKey, derivationPrefix, derivationSuffix }.',
    network: o.chain,
    recipientIdentityKey: o.identity,
    senderIdentityKey: p.sender,
    txid: p.txid,
    outputIndex: token.outputIndex,
    amount: p.amount,
    derivationPrefix: token.customInstructions.derivationPrefix,
    derivationSuffix: token.customInstructions.derivationSuffix,
    atomicBEEF: Utils.toHex(Utils.toArray(token.transaction, 'base64')),
    receivedAt: new Date(p.receivedAt).toISOString(),
    lastError: p.error
  }, null, 2)
}

/**
 * The remove-wallet dialog's note about kept payments (empty when there are none). They stay
 * on this device when the wallet is removed (Ruling 36), so the dialog must not imply they go.
 * Only the open wallet's (`open`) come back when it is opened here again; other wallets' are
 * mentioned apart, and kept payments that cannot be read are said, never counted as none.
 */
export function keptPaymentsRemovalNote(kept: { open: KeptCount; others: KeptCount }, recoveryPhrase: boolean): string {
  const { open, others } = kept
  const notes: string[] = []
  const backup = recoveryPhrase ? 'the same recovery phrase' : 'the same recovery material'
  if (open.count === 1) notes.push(`A direct payment you received (${open.total.toLocaleString()} satoshis) is not in your wallet yet. It stays on this device and is added when you open this wallet here again with ${backup}.`)
  if (open.count > 1) notes.push(`${open.count} direct payments you received (${open.total.toLocaleString()} satoshis in total) are not in your wallet yet. They stay on this device and are added when you open this wallet here again with ${backup}.`)
  if (open.unreadable > 0) notes.push('Some direct payments kept on this device for this wallet could not be read. They stay on this device as they are.')
  if (others.count === 1) notes.push(`Removing this wallet does not touch the direct payment kept for another wallet on this device (${others.total.toLocaleString()} satoshis).`)
  else if (others.count > 1) notes.push(`Removing this wallet does not touch the ${others.count} direct payments kept for other wallets on this device (${others.total.toLocaleString()} satoshis in total).`)
  else if (others.unreadable > 0) notes.push('Removing this wallet does not touch the direct payments kept for other wallets on this device.')
  return notes.join(' ')
}
