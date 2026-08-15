/**
 * broadcastAndInternalizeChange — post TX2 and track the sender's BSV change.
 *
 * `internalizeAction` posts the given tx to the network (via
 * processAction → attemptToPostReqsToNetwork) AND internalizes the declared
 * output(s). We declare only the sender's own BSV change output (a P2PKH at a
 * BRC-29 self-address) as a `wallet payment`, exactly as LegacyBridge /
 * WalletFundingFlow internalize inbound funds. The token recipient output rides
 * on-chain in the same tx and is delivered to the peer via the returned BEEF;
 * the sender's token-change (partial sends) is registered separately as a
 * basket insertion by the transfer service.
 *
 * The `senderIdentityKey` MUST be the privkey-1 public key to match how the
 * change output was derived (`counterparty:'anyone', forSelf:true`).
 */

import type { WalletInterface, InternalizeActionArgs } from '@bsv/sdk';
import { PrivateKey } from '@bsv/sdk';

export async function broadcastAndInternalizeChange(args: {
  wallet: WalletInterface;
  /** Fully-signed TX2 AtomicBEEF (with ancestry). */
  atomicBeef: number[];
  changeVout: number;
  derivationPrefix: string;
  derivationSuffix: string;
  originator: string;
  description?: string;
  labels?: string[];
}): Promise<{ accepted: boolean }> {
  const {
    wallet, atomicBeef, changeVout,
    derivationPrefix, derivationSuffix, originator,
  } = args;

  const iargs: InternalizeActionArgs = {
    tx: atomicBeef,
    description: args.description ?? 'token transfer change',
    labels: args.labels ?? ['token', 'change'],
    outputs: [
      {
        outputIndex: changeVout,
        protocol: 'wallet payment',
        paymentRemittance: {
          // Matches the 'anyone'/forSelf:true derivation used to lock it.
          senderIdentityKey: new PrivateKey(1).toPublicKey().toString(),
          derivationPrefix,
          derivationSuffix,
        },
      },
    ],
  };

  const res: any = await wallet.internalizeAction(iargs as any, originator);
  return { accepted: !!res?.accepted };
}
