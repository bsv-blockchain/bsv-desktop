/**
 * StasKeyDeriver — BRC-42 derivation of STAS receive keys.
 *
 * Derives owner keys via `wallet.getPublicKey` (public keys only — safe to call
 * from the renderer) and manages the monotonic receive-key counter through the
 * `stas:query` IPC channel (the `stas_receive_contexts` table).
 *
 * Derivation is pure and deterministic, so `enumerateOwnerFields` is memoized
 * and only extended as the scan range grows.
 */

import type { WalletInterface } from '@bsv/sdk';
import { hash160, toHex, fromHex } from 'dxs-bsv-token-sdk/bsv';
import { STAS_PROTOCOL_ID, STAS_COUNTERPARTY, stasKeyId } from './constants';

export interface DerivedReceiveKey {
  index: number;
  keyId: string;
  /** Compressed public key, hex. */
  publicKey: string;
  /** hash160(publicKey), hex — the DSTAS owner field. */
  ownerFieldHash160: string;
}

export interface ReceiveContextRow {
  profileIdentityKey: string;
  keyIndex: number;
  keyId: string;
  ownerFieldHash160: string;
  derivedPublicKey: string;
  createdAt: string;
}

export class StasKeyDeriver {
  private readonly _ownerFields = new Map<string, number>();
  private _enumeratedUpTo = 0;

  constructor(
    private readonly wallet: WalletInterface,
    private readonly _identityKey: string,
    private readonly _chain: 'main' | 'test' | 'ttn'
  ) {}

  /** Identity key of the wallet root (hex). */
  get identityKey(): string { return this._identityKey; }
  /** Chain this deriver is scoped to. */
  get chain(): 'main' | 'test' | 'ttn' { return this._chain; }

  /** Derive the Nth receive key. Pure — no DB access. */
  async deriveReceiveKey(index: number): Promise<DerivedReceiveKey> {
    const keyId = stasKeyId(index);
    const { publicKey } = await this.wallet.getPublicKey({
      protocolID: STAS_PROTOCOL_ID,
      keyID: keyId,
      counterparty: STAS_COUNTERPARTY,
    });
    const ownerFieldHash160 = toHex(hash160(fromHex(publicKey)));
    return { index, keyId, publicKey, ownerFieldHash160 };
  }

  /**
   * Owner-field -> keyIndex map for `recv 1..upTo`, memoized. BRC-42 derivation
   * is deterministic, so the cache is only ever extended.
   */
  async enumerateOwnerFields(upTo: number): Promise<Map<string, number>> {
    for (let i = this._enumeratedUpTo + 1; i <= upTo; i++) {
      const k = await this.deriveReceiveKey(i);
      this._ownerFields.set(k.ownerFieldHash160, i);
    }
    if (upTo > this._enumeratedUpTo) this._enumeratedUpTo = upTo;
    return this._ownerFields;
  }

  /** Highest issued receive-key index (0 if none / if the STAS query channel is unavailable). */
  async getHighWaterMark(): Promise<number> {
    const res = await this.query('getReceiveHighWaterMark', [this._identityKey]);
    return res === undefined ? 0 : (res as number);
  }

  /** Derive and persist the next receive context; returns the stored row. */
  async createNextReceiveContext(): Promise<ReceiveContextRow> {
    // Pre-check the IPC channel directly. The previous `if (res === undefined)`
    // check after the insert was a false positive — INSERT queries return void
    // through the IPC layer, so a successful write yields `res.result === undefined`
    // (same shape as channel-absent). A direct channel probe is unambiguous.
    if (typeof window === 'undefined' || !(window as any).electronAPI?.stas) {
      throw new Error('STAS query channel unavailable — cannot persist receive context');
    }
    const next = (await this.getHighWaterMark()) + 1;
    const k = await this.deriveReceiveKey(next);
    const row: ReceiveContextRow = {
      profileIdentityKey: this._identityKey,
      keyIndex: next,
      keyId: k.keyId,
      ownerFieldHash160: k.ownerFieldHash160,
      derivedPublicKey: k.publicKey,
      createdAt: new Date().toISOString(),
    };
    await this.query('insertReceiveContext', [row]);
    return row;
  }

  /**
   * Invoke a `stas:query` over IPC. Returns `undefined` when the channel is not
   * present (non-Electron environments such as unit tests); throws on a query
   * error reported by the main process.
   */
  private async query(method: string, args: any[]): Promise<any> {
    const api =
      typeof window !== 'undefined' ? (window as any).electronAPI?.stas : undefined;
    if (!api) return undefined;
    const res = await api.query(this._identityKey, this.chain, method, args);
    if (!res || !res.success) {
      throw new Error(`stas:query ${method} failed: ${res && res.error}`);
    }
    return res.result;
  }
}
