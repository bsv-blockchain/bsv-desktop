/**
 * BRC-162 token-script boundary for the wallet.
 *
 * A drop-in for the old `MandalaToken` (8-chunk PushDrop) from `@bsv/templates`
 * 1.x, over `Bsv21Binary` from `@bsv/templates` 2.x. `decode` yields
 * `{ assetId, amount, pubKeyHash }` for a VALUE-role output only (deploy and
 * authority outputs are not coins) and throws on anything else, exactly as the
 * old decoder did, so every call site keeps its `try/catch` shape.
 */
import { LockingScript, type WalletCounterparty, type WalletInterface, type WalletProtocol } from '@bsv/sdk'
import { Bsv21Binary, tokenIdToString } from '@bsv/templates'

export class MandalaToken {
  private readonly inner: Bsv21Binary

  constructor(wallet?: WalletInterface, originator?: string) {
    this.inner = new Bsv21Binary(wallet, originator)
  }

  static decode(script: LockingScript | string): { assetId: string; amount: number; pubKeyHash: number[] } {
    const ls = LockingScript.fromHex(typeof script === 'string' ? script : script.toHex())
    const d = Bsv21Binary.decode(ls)
    if (d.role !== 'value' || d.tokenId == null) throw new Error(`not a BRC-162 value output (role ${d.role})`)
    if (d.restPubKeyHash == null) throw new Error('BRC-162 output is not P2PKH-locked')
    if (d.amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('BRC-162 amount exceeds 2^53-1')
    return { assetId: tokenIdToString(d.tokenId), amount: Number(d.amount), pubKeyHash: d.restPubKeyHash }
  }

  /** A value coin of `assetId` locked to `pubKeyHash`. */
  lock(assetId: string, amount: number, pubKeyHash: readonly number[]): LockingScript {
    return LockingScript.fromHex(this.inner.lock(assetId, BigInt(amount), pubKeyHash).toHex())
  }

  /** A value coin locked to hash160 of the wallet-derived (BRC-29 style) key. */
  async lockBRC29(
    assetId: string,
    amount: number,
    protocolID: WalletProtocol,
    keyID: string,
    counterparty: WalletCounterparty
  ): Promise<LockingScript> {
    const s = await this.inner.lockBRC29(assetId, BigInt(amount), protocolID, keyID, counterparty)
    return LockingScript.fromHex(s.toHex())
  }
}
