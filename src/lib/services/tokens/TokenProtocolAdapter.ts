/**
 * TokenProtocolAdapter — single seam between protocol-specific logic
 * (STAS, DSTAS, BSV-21) and the shared pipeline (DB, IPC, UI).
 *
 * Every protocol the wallet recognises is represented by exactly one
 * adapter instance. The adapter answers:
 *   - "is this locking script one of mine?" (parseOutput)
 *   - "which basket do my UTXOs go in?" (basketName)
 *   - "can I build a transfer right now?" (transferSupported)
 *   - "build me a transfer" (transfer, when supported)
 *
 * Adapters are held in a TokenProtocolRegistry and looked up by id.
 */

export type TokenProtocolId = 'stas' | 'dstas' | 'bsv-21';

/**
 * Output-level data every protocol must produce when it recognises one of
 * its scripts. A superset of the existing `ParsedDstas` so DSTAS can keep
 * its current behavior without losing fields. Protocols may omit anything
 * not applicable to them.
 */
export interface ParsedTokenOutput {
  /** Canonical token identifier — what the UI groups by. */
  tokenId: string;
  /** 20-byte owner field (PKH), hex — what ownership recognition matches on. */
  ownerFieldHash160: string;
  /** Display ticker, when known at parse time. */
  symbol?: string;
  /** Protocol-specific flags region, hex. */
  flagsHex?: string;
  /** Bytes-per-token. STAS=1; BSV-21 uses `decimals` instead. */
  satoshisPerToken?: number;
  /** STAS/DSTAS engine feature flags. */
  freezeEnabled?: boolean;
  confiscationEnabled?: boolean;
  /** Raw protocol service fields, hex (DSTAS). */
  serviceFields?: string[];
}

/**
 * Optional context passed to `parseOutput` for protocols that need more
 * than the locking script to identify a token (e.g. classic STAS walks
 * back through tx inputs to find its CreateContract txid).
 */
export interface ParseContext {
  /** Outpoint the script lives at — supplied when known. */
  txid?: string;
  vout?: number;
  /** Wallet interface for SDK calls that need on-chain reads. */
  wallet?: any;
}

export interface TransferArgs {
  source: {
    txid: string;
    vout: number;
    scriptHex: string;
    satoshis: number;
    brc42KeyId: string;
  };
  recipientAddress: string;
  /**
   * Token amount to send (satoshi-denominated for STAS/DSTAS). Omit to send the
   * whole UTXO. When less than `source.satoshis` the transfer SPLITS: the
   * recipient gets `amount` and the remainder returns to the sender as
   * token-change at `senderChangeHash160`. BSV-21 carries its amount via
   * `Bsv21SendExtras` instead (raw bigint string), so it ignores this field.
   */
  amount?: number;
  /** Owner pkh (hex) for the sender's token-change output on a partial send. */
  senderChangeHash160?: string;
  /** BRC-42 keyId of the sender's change receive key (for createAction tracking). */
  senderChangeKeyId?: string;
  /** Canonical tokenId for the change output's metadata. */
  tokenId?: string;
}

export interface TransferResult {
  ok: boolean;
  txid?: string;
  reason?: string;
}

/**
 * One protocol's plug-in. Implementations live alongside this file.
 *
 * The adapter is intentionally narrow: ownership/discovery and transfer.
 * Receive-address generation, key derivation, and indexer choice stay on
 * the shared services for now — they will be lifted into the adapter when
 * BSV-21 lands and needs different keys + a different indexer.
 */
export interface TokenProtocolAdapter {
  readonly id: TokenProtocolId;
  /** Output basket this protocol's UTXOs are stored in. */
  readonly basketName: string;
  /** Human-readable label for the UI badge ("STAS", "DSTAS", "BSV-21"). */
  readonly displayName: string;
  /** Whether `transfer(...)` is implemented yet on this adapter. */
  readonly transferSupported: boolean;

  /**
   * Try to recognise a locking script as one of this protocol's outputs.
   * Returns `null` if the script doesn't belong to this protocol — never
   * throws. Async because some protocols (classic STAS) need to walk back
   * through inputs to find the canonical tokenId.
   */
  parseOutput(scriptHex: string, ctx?: ParseContext): Promise<ParsedTokenOutput | null>;

  /**
   * Build + broadcast a transfer. Only present when `transferSupported`
   * is true — callers must check before invoking.
   */
  transfer?(args: TransferArgs): Promise<TransferResult>;
}
