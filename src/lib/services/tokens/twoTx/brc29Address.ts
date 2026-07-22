/**
 * deriveSelfBrc29P2pkh — derive a self-owned BRC-29 P2PKH address/script.
 *
 * Shared by TX1's funding output and TX2's single change output. The output is
 * owned by our own key (`counterparty:'anyone', forSelf:true`) so we can both
 * sign it (signP2pkhInput) and re-internalize it (`wallet payment`). Returns the
 * locking script, the owner pkh (needed for the STAS engine's payment segment),
 * and the derivation prefix/suffix to record.
 */

import type { WalletInterface } from '@bsv/sdk';
import { PublicKey, P2PKH, createNonce } from '@bsv/sdk';
import { BRC29_PROTOCOL_ID } from './p2pkhInput';

export interface SelfBrc29Output {
  scriptHex: string;
  /** hash160 of the owner pubkey (hex) — the `76a914 <pkh> 88ac` middle 20 bytes. */
  pkhHex: string;
  derivationPrefix: string;
  derivationSuffix: string;
}

export async function deriveSelfBrc29P2pkh(args: {
  wallet: WalletInterface;
  chain: 'main' | 'test';
  originator: string;
  /** Optional: reuse existing nonces instead of minting fresh ones. */
  derivationPrefix?: string;
  derivationSuffix?: string;
}): Promise<SelfBrc29Output> {
  const { wallet, chain, originator } = args;
  const derivationPrefix = args.derivationPrefix ?? (await createNonce(wallet, 'self', originator));
  const derivationSuffix = args.derivationSuffix ?? (await createNonce(wallet, 'self', originator));

  const { publicKey } = await wallet.getPublicKey(
    {
      protocolID: BRC29_PROTOCOL_ID,
      keyID: `${derivationPrefix} ${derivationSuffix}`,
      counterparty: 'anyone',
      forSelf: true,
    } as any,
    originator,
  );
  const address = PublicKey.fromString(publicKey).toAddress(chain === 'main' ? 'mainnet' : 'testnet');
  const scriptHex = new P2PKH().lock(address).toHex();
  // P2PKH script is 76a914 <20-byte pkh> 88ac → pkh is hex chars 6..46.
  const pkhHex = scriptHex.substring(6, 46);

  return { scriptHex, pkhHex, derivationPrefix, derivationSuffix };
}
