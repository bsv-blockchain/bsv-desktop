/**
 * walletChangeParams — the storage-agnostic change-param write.
 *
 * The STAS/DSTAS transfers must suppress wallet-toolbox change fragmentation via
 * the ACTIVE storage provider (so it works on remote), not a local-only IPC.
 * These tests pin the two routing forms and their exact arguments — the
 * regression that broke STAS/DSTAS sends on remote storage was writing to the
 * wrong (local) store.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  setChangeParams,
  SPEC_OP_SET_WALLET_CHANGE_PARAMS,
  DEFAULT_DESIRED_UTXOS,
  DEFAULT_MIN_UTXO_VALUE,
} from '../../src/lib/services/stas/walletChangeParams';

describe('setChangeParams', () => {
  test('prefers the toolbox setWalletChangeParams method (routes to active store)', async () => {
    const setWalletChangeParams = vi.fn(async () => {});
    const listOutputs = vi.fn(async () => ({ totalOutputs: 0, outputs: [] }));
    const wallet: any = { setWalletChangeParams, listOutputs };

    await setChangeParams(wallet, 0, DEFAULT_MIN_UTXO_VALUE, 'admin.stas-transfer');

    expect(setWalletChangeParams).toHaveBeenCalledWith(0, 32);
    // The method form is preferred; the raw spec-op is not used.
    expect(listOutputs).not.toHaveBeenCalled();
  });

  test('falls back to the listOutputs spec-op when the method is absent', async () => {
    const listOutputs = vi.fn(async () => ({ totalOutputs: 0, outputs: [] }));
    const wallet: any = { listOutputs }; // no setWalletChangeParams

    await setChangeParams(wallet, DEFAULT_DESIRED_UTXOS, DEFAULT_MIN_UTXO_VALUE, 'admin.stas-transfer');

    expect(listOutputs).toHaveBeenCalledTimes(1);
    const [args, originator] = listOutputs.mock.calls[0] as any[];
    expect(args.basket).toBe(SPEC_OP_SET_WALLET_CHANGE_PARAMS);
    // Tags are stringified count + satoshis, in order.
    expect(args.tags).toEqual(['144', '32']);
    expect(originator).toBe('admin.stas-transfer');
  });

  test('stringifies the suppression args (0, 32) for the spec-op path', async () => {
    const listOutputs = vi.fn(async () => ({ totalOutputs: 0, outputs: [] }));
    const wallet: any = { listOutputs };

    await setChangeParams(wallet, 0, DEFAULT_MIN_UTXO_VALUE);

    expect((listOutputs.mock.calls[0][0] as any).tags).toEqual(['0', '32']);
  });

  test('propagates a store rejection so the caller can fail the transfer', async () => {
    const wallet: any = {
      setWalletChangeParams: vi.fn(async () => {
        throw new Error('spec-op not supported');
      }),
    };
    await expect(setChangeParams(wallet, 0, 32)).rejects.toThrow(/spec-op not supported/);
  });
});
