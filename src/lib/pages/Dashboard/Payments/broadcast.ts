/** Shared by every way this wallet pays a wallet identity: the BRC-29 payment protocol and the broadcast of a saved payment. */
import { WalletInterface } from '@bsv/sdk'

export const PAYMENT_PROTOCOL: [2, string] = [2, '3241645161d8']

/** Broadcasts a payment created with noSend, so a retry can reuse the same transaction. */
export async function broadcastPayment(wallet: WalletInterface, txid: string, originator: string): Promise<void> {
  const result = await wallet.createAction({ description: 'Broadcast saved payment', options: { sendWith: [txid] } }, originator)
  const status = result.sendWithResults?.find(result => result.txid === txid)?.status
  if (!status || status === 'failed') throw new Error('Broadcast is pending. Retry when you are connected.')
}
