/**
 * Set the wallet's automatic change-generation parameters through the ACTIVE
 * storage provider (local better-sqlite3 OR a remote StorageClient), so the
 * change it takes effect on whichever store `createAction` funds from.
 *
 * Why this exists: the STAS/DSTAS on-chain templates require exactly one BSV
 * P2PKH change output, but wallet-toolbox splits change into up to 8 outputs to
 * build a pool toward the `default` basket's `numberOfDesiredUTXOs` (144).
 * Lowering that to 0 around a transfer keeps the tx at a single change output.
 * The earlier approach wrote the basket row via a local-SQLite-only Electron IPC
 * (`setDefaultBasketUTXOTarget`), which never reached a remote `StorageClient` —
 * the root cause of STAS/DSTAS sends failing on remote storage while working on
 * local. `Wallet.setWalletChangeParams` performs the same update via a
 * `listOutputs` spec-op that routes to the active store, so it works on both.
 */

import type { WalletInterface } from '@bsv/sdk';

/**
 * Spec-op basket id that makes `listOutputs` update the default basket's change
 * params instead of listing (wallet-toolbox `sdk/types` `specOpSetWalletChangeParams`).
 */
export const SPEC_OP_SET_WALLET_CHANGE_PARAMS =
  'a4979d28ced8581e9c1c92f1001cc7cb3aabf8ea32e10888ad898f0a509a3929';

/** wallet-toolbox seeds the 'default' basket with these (StorageReaderWriter). */
export const DEFAULT_DESIRED_UTXOS = 144;
export const DEFAULT_MIN_UTXO_VALUE = 32;

/**
 * Update the default change basket's target UTXO count + minimum value via the
 * active store. Prefers the toolbox `Wallet.setWalletChangeParams` method;
 * falls back to the raw `listOutputs` spec-op for any wallet exposing only the
 * BRC-100 surface. Throws if the store rejects it — the caller decides whether
 * that is fatal (suppress = fatal, restore = best-effort).
 */
export async function setChangeParams(
  wallet: WalletInterface,
  count: number,
  satoshis: number,
  originator?: string
): Promise<void> {
  const w = wallet as any;
  if (typeof w.setWalletChangeParams === 'function') {
    await w.setWalletChangeParams(count, satoshis);
    return;
  }
  await wallet.listOutputs(
    {
      basket: SPEC_OP_SET_WALLET_CHANGE_PARAMS,
      tags: [String(count), String(satoshis)],
    } as any,
    originator
  );
}
