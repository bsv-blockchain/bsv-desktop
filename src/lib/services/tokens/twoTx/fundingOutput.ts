/**
 * createTokenFundingOutput — TX1 of the 2-tx token transfer.
 *
 * Creates a single dedicated P2PKH output at a wallet-protocol (BRC-29) address
 * we derive ourselves (`counterparty:'anyone', forSelf:true` — the LegacyBridge
 * self-funding scheme), sized to cover TX2's fee. Because we chose the
 * derivation prefix/suffix, we can sign this output as TX2's only funding input
 * (see p2pkhInput.ts) and re-internalize its change — so TX2 never relies on the
 * wallet's auto-funding/auto-change, which is what breaks on remote storage.
 *
 * This is a normal BSV `createAction` (change fragmentation on TX1 is harmless —
 * TX1's outputs are plain P2PKH). Returns the funding outpoint + the derivation
 * needed to spend it + TX1's AtomicBEEF for chaining into TX2's inputBEEF.
 */

import type { WalletInterface } from '@bsv/sdk';
import { PublicKey, P2PKH, createNonce } from '@bsv/sdk';
import { BRC29_PROTOCOL_ID } from './p2pkhInput';

export interface TokenFundingOutput {
  txid: string;
  vout: number;
  satoshis: number;
  scriptHex: string;
  derivationPrefix: string;
  derivationSuffix: string;
  /** TX1 AtomicBEEF — merge into TX2's inputBEEF so TX2 can spend this output. */
  beef: number[];
}

export async function createTokenFundingOutput(args: {
  wallet: WalletInterface;
  chain: 'main' | 'test';
  /** Satoshis to lock into the funding output (TX2 fee budget + dust margin). */
  satoshis: number;
  originator: string;
  description?: string;
}): Promise<TokenFundingOutput> {
  const { wallet, chain, satoshis, originator } = args;

  const derivationPrefix = await createNonce(wallet, 'self', originator);
  const derivationSuffix = await createNonce(wallet, 'self', originator);

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

  const res: any = await wallet.createAction(
    {
      description: args.description ?? 'token transfer funding',
      outputs: [
        {
          lockingScript: scriptHex,
          satoshis,
          outputDescription: 'token tx funding',
          // Record the derivation so this output is recoverable/spendable.
          customInstructions: JSON.stringify({ derivationPrefix, derivationSuffix, forSelf: true }),
        },
      ],
      // Our funding output is declared first; wallet change (if any) follows.
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
    } as any,
    originator,
  );

  const txid: string = res.txid;
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) {
    throw new Error(`funding createAction returned no txid (got ${JSON.stringify(res?.txid)})`);
  }
  const beef: number[] = Array.isArray(res.tx) ? res.tx : [];

  // randomizeOutputs:false + our output declared first ⇒ vout 0. Guard anyway.
  return { txid, vout: 0, satoshis, scriptHex, derivationPrefix, derivationSuffix, beef };
}
