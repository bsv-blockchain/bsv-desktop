import { PeerPayClient } from '@bsv/message-box-client'
import { P2PKH, PublicKey, Random, Transaction, Utils, WalletInterface } from '@bsv/sdk'
import { PAYMENT_PROTOCOL } from './nearbyProtocol'
import { identityKey, validAmount } from './paymentProtocol'
export interface OutgoingPayment {
  txid: string
  recipient: string
  amount: number
  host?: string
  createdAt: number
  delivered: boolean
  request?: { requestId: string; messageId: string }
  token: { transaction: number[]; amount: number; outputIndex: number; customInstructions: { derivationPrefix: string; derivationSuffix: string } }
}
/** Persist the signed token before any broadcast or delivery, so retry never pays twice. */
export async function prepareMessageBoxPayment(wallet: WalletInterface, recipient: string, amount: number, originator: string, host: string | undefined, persist: (payment: OutgoingPayment) => void): Promise<OutgoingPayment> {
  recipient = identityKey(recipient)
  if (!validAmount(amount)) throw new Error('Enter a positive amount.')
  const derivationPrefix = Utils.toBase64(Random(16)), derivationSuffix = Utils.toBase64(Random(16))
  const { publicKey } = await wallet.getPublicKey({ protocolID: PAYMENT_PROTOCOL, keyID: `${derivationPrefix} ${derivationSuffix}`, counterparty: recipient, forSelf: false }, originator)
  let reference: string | undefined, saved = false
  try {
    const result = await wallet.createAction({ description: 'Sent BSV', labels: ['peerpay', 'outbound', recipient], outputs: [{ lockingScript: new P2PKH().lock(PublicKey.fromString(publicKey).toAddress()).toHex(), satoshis: amount, outputDescription: 'BSV payment', customInstructions: JSON.stringify({ derivationPrefix, derivationSuffix, type: 'BRC29' }) }], options: { noSend: true, signAndProcess: false, randomizeOutputs: false } }, originator)
    reference = result.signableTransaction?.reference
    const signed = result.tx ? result : reference ? await wallet.signAction({ reference, spends: {}, options: { noSend: true } }, originator) : null
    if (!signed?.tx || !signed?.txid) throw new Error('The wallet did not return a payment transaction.')
    if (Transaction.fromAtomicBEEF(signed.tx).outputs[0]?.satoshis !== amount) throw new Error('The wallet returned an unexpected amount.')
    const payment: OutgoingPayment = { txid: signed.txid, recipient, amount, host, createdAt: Date.now(), delivered: false, token: { transaction: Array.from(signed.tx), amount, outputIndex: 0, customInstructions: { derivationPrefix, derivationSuffix } } }
    persist(payment); saved = true; return payment
  } catch (error) {
    if (reference && !saved) {
      try { const aborted = await wallet.abortAction({ reference }, originator); if (!aborted.aborted) throw new Error('The wallet refused to release the inputs.') } catch (abortError) { throw new Error(`${(error as Error).message} Reserved inputs could not be released: ${(abortError as Error).message}`) }
    }
    throw error
  }
}
export async function deliverMessageBoxPayment(client: PeerPayClient, payment: OutgoingPayment): Promise<void> {
  await client.sendMessage({ recipient: payment.recipient, messageBox: 'payment_inbox', body: JSON.stringify(payment.token) }, payment.host)
}
