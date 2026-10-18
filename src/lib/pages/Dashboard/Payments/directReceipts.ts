/**
 * What the user is told about direct payments this wallet received: whether a payment is in
 * the wallet or only kept on this device until the wallet can add it (see directPayments.ts),
 * and how to recover a kept payment by hand when retrying stops working.
 */
import { Utils } from '@bsv/sdk'
import type { KeptDirectPaymentInfo } from './directPayments'

/** A kept payment's line in the Payments page's list of payments not yet in the wallet. */
export function keptStatusText(p: KeptDirectPaymentInfo): string {
  if (!p.needsAttention) return 'Received, not yet added. It will be added when your wallet can verify it — retrying automatically.'
  const why = p.needsAttention.reason === 'refused' ? 'your wallet refused it' : 'your wallet could not verify it after repeated tries'
  return `Needs attention: your wallet could not add it (${why}). It stays on this device and is tried again from time to time. Copy the recovery details and keep them: with them, this payment can be added to your wallet by hand.`
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
 */
export function keptPaymentsRemovalNote(kept: { count: number; total: number }, recoveryPhrase: boolean): string {
  if (kept.count === 0) return ''
  const backup = recoveryPhrase ? 'the same recovery phrase' : 'the same recovery material'
  const total = kept.total.toLocaleString()
  return kept.count === 1
    ? `A direct payment you received (${total} satoshis) is not in your wallet yet. It stays on this device and is added when you open this wallet here again with ${backup}.`
    : `${kept.count} direct payments you received (${total} satoshis in total) are not in your wallet yet. They stay on this device and are added when you open this wallet here again with ${backup}.`
}
