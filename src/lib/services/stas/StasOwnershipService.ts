/**
 * StasOwnershipService — recognises whether a DSTAS locking script's owner
 * field belongs to one of the wallet's BRC-42-derived keys.
 *
 * Scans derived owner keys from `recv 1` up to the persisted high-water mark
 * plus a gap limit, matching the parsed owner field by hash160.
 */

import { StasKeyDeriver } from './StasKeyDeriver';
import { parseDstasLockingScript } from './dstasParser';
import { STAS_GAP_LIMIT } from './constants';

export interface OwnershipResult {
  owned: boolean;
  /** The receive-key index that owns the output, when `owned` is true. */
  keyIndex?: number;
}

export class StasOwnershipService {
  constructor(
    private readonly deriver: StasKeyDeriver,
    private readonly gapLimit: number = STAS_GAP_LIMIT
  ) {}

  /**
   * Is this DSTAS locking script owned by a wallet-derived key?
   *
   * @param lockingScriptHex  the candidate locking script, hex
   * @param highWaterMark     optional explicit high-water mark; when omitted it
   *                          is read from the persisted receive contexts
   */
  async isOwnedByWallet(
    lockingScriptHex: string,
    highWaterMark?: number
  ): Promise<OwnershipResult> {
    const parsed = parseDstasLockingScript(lockingScriptHex);
    if (!parsed) return { owned: false };

    const hwm =
      highWaterMark !== undefined
        ? highWaterMark
        : await this.deriver.getHighWaterMark();
    const ownerFields = await this.deriver.enumerateOwnerFields(hwm + this.gapLimit);

    const keyIndex = ownerFields.get(parsed.ownerFieldHash160);
    return keyIndex !== undefined ? { owned: true, keyIndex } : { owned: false };
  }
}
