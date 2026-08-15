/**
 * BSV21KeyDeriver — BRC-42 derivation of BSV-21 receive keys.
 *
 * Symmetric with `StasKeyDeriver` but keyed under the `bsv-21 token
 * ownership` protocolID, persisted into the `bsv21_receive_contexts`
 * table. Keeping the namespaces separate so a wallet's STAS receive
 * range never collides with its BSV-21 range.
 */

import type { WalletInterface } from '@bsv/sdk';
import { hash160, toHex, fromHex } from 'dxs-bsv-token-sdk/bsv';
import { BSV21_PROTOCOL_ID, BSV21_COUNTERPARTY, bsv21KeyId } from './constants';

export interface DerivedBsv21ReceiveKey {
  index: number;
  keyId: string;
  /** Compressed public key, hex. */
  publicKey: string;
  /** hash160(publicKey), hex — the P2PKH owner hash. */
  ownerFieldHash160: string;
}

export interface Bsv21ReceiveContextRow {
  profileIdentityKey: string;
  keyIndex: number;
  keyId: string;
  ownerFieldHash160: string;
  derivedPublicKey: string;
  createdAt: string;
}

export class BSV21KeyDeriver {
  private readonly _ownerFields = new Map<string, number>();
  private _enumeratedUpTo = 0;

  constructor(
    private readonly wallet: WalletInterface,
    private readonly _identityKey: string,
    private readonly _chain: 'main' | 'test' | 'ttn'
  ) {}

  get identityKey(): string { return this._identityKey; }
  get chain(): 'main' | 'test' | 'ttn' { return this._chain; }

  async deriveReceiveKey(index: number): Promise<DerivedBsv21ReceiveKey> {
    const keyId = bsv21KeyId(index);
    const { publicKey } = await this.wallet.getPublicKey({
      protocolID: BSV21_PROTOCOL_ID,
      keyID: keyId,
      counterparty: BSV21_COUNTERPARTY,
    });
    const ownerFieldHash160 = toHex(hash160(fromHex(publicKey)));
    return { index, keyId, publicKey, ownerFieldHash160 };
  }

  async enumerateOwnerFields(upTo: number): Promise<Map<string, number>> {
    for (let i = this._enumeratedUpTo + 1; i <= upTo; i++) {
      const k = await this.deriveReceiveKey(i);
      this._ownerFields.set(k.ownerFieldHash160, i);
    }
    if (upTo > this._enumeratedUpTo) this._enumeratedUpTo = upTo;
    return this._ownerFields;
  }

  async getHighWaterMark(): Promise<number> {
    const res = await this.query('getBsv21ReceiveHighWaterMark', [this._identityKey]);
    return res === undefined ? 0 : (res as number);
  }

  async createNextReceiveContext(): Promise<Bsv21ReceiveContextRow> {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.stas) {
      throw new Error('BSV-21 query channel unavailable — cannot persist receive context');
    }
    const next = (await this.getHighWaterMark()) + 1;
    const k = await this.deriveReceiveKey(next);
    const row: Bsv21ReceiveContextRow = {
      profileIdentityKey: this._identityKey,
      keyIndex: next,
      keyId: k.keyId,
      ownerFieldHash160: k.ownerFieldHash160,
      derivedPublicKey: k.publicKey,
      createdAt: new Date().toISOString(),
    };
    await this.query('insertBsv21ReceiveContext', [row]);
    return row;
  }

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
