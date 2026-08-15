/**
 * stasOutputMetadata — the single codec for STAS/DSTAS token metadata carried on
 * the standard wallet output record (customInstructions + tags).
 *
 * Why this exists. STAS/DSTAS historically stored token metadata in local-only
 * satellite tables (stas_tokens / stas_outputs), which don't exist under remote
 * ("cloud") storage — so those tokens were invisible there. BSV-21 never had this
 * problem because it stores everything on the standard output record, whose
 * `customInstructions` (a string) and `tags` (string[]) are first-class BRC-100
 * fields that live wherever the output lives and sync across storage providers.
 *
 * This module makes STAS/DSTAS use the same portable model. Registration ENCODES
 * the metadata onto the output at internalize time; the read paths (Assets page,
 * peer holdings, the /stas HTTP routes) DECODE it back from listOutputs. Both
 * sides go through here so the write shape and the read shape cannot drift.
 *
 * Design notes:
 *  - Everything is a scalar or a short array; the whole blob is well under any
 *    practical customInstructions size and each tag well under the 300-byte cap.
 *  - Token-level fields (symbol, name, freeze/confiscation, redemptionPkh) are
 *    denormalized onto every output of the token — exactly as BSV-21 repeats
 *    sym/amt/dec on each output. The aggregate "token" view is regrouped at read
 *    time, so no separate token table is needed.
 *  - `brc42KeyId` carries the BRC-29 owner derivation for received tokens (the
 *    `brc29|prefix|suffix|sender` packing produced by brc29KeyId.ts), unchanged.
 */

export type StasKind = 'stas' | 'dstas';

export interface StasOutputMetadata {
  kind: StasKind;
  tokenId: string;
  /** BRC-42 keyID, or the packed BRC-29 derivation for a received token. */
  brc42KeyId?: string;
  ownerFieldHash160?: string;
  symbol?: string;
  name?: string | null;
  flagsHex?: string;
  freezeEnabled?: boolean;
  confiscationEnabled?: boolean;
  redemptionPkh?: string;
  issuerIdentityKey?: string;
  /** STAS/DSTAS are satoshi-denominated: 1 sat = 1 unit. */
  satoshisPerToken?: number;
  serviceFields?: string[];
  frozen?: boolean;
  confiscated?: boolean;
}

/** Marks a customInstructions blob as one we wrote (vs BSV-21's `kind:'bsv-21'`). */
const KINDS: StasKind[] = ['stas', 'dstas'];

export interface EncodedStasOutput {
  customInstructions: string;
  tags: string[];
}

/**
 * Encode metadata for `internalizeAction` / `createAction`.
 *
 * `tags` mirror BSV-21's for parity and cheap filtering: the protocol kind, the
 * token id, and (when known) the symbol. The basket already encodes the protocol
 * too, but the tag keeps listOutputs tag-filtering uniform across standards.
 */
export function encodeStasOutputMetadata(m: StasOutputMetadata): EncodedStasOutput {
  const tags: string[] = [m.kind, `id:${m.tokenId}`];
  if (m.symbol) tags.push(`sym:${m.symbol}`);
  return { customInstructions: JSON.stringify(m), tags };
}

/**
 * Decode metadata from a stored output's `customInstructions` (+ `tags`).
 *
 * `fallbackKind` is the protocol the CALLER already knows — supply it when
 * decoding a row you fetched from a specific token basket (stas-tokens /
 * dstas-tokens). Basket membership is authoritative: an output living in the
 * DSTAS basket IS a DSTAS token even if its stored blob predates the `kind`
 * field and its tags didn't survive a storage sync. Only when NO kind can be
 * established at all (no ci.kind, no protocol tag, no fallback) do we return
 * null — meaning "not a STAS/DSTAS output we can render".
 */
export function decodeStasOutputMetadata(
  customInstructions?: string | null,
  tags?: string[] | null,
  fallbackKind?: StasKind
): StasOutputMetadata | null {
  let ci: any = null;
  if (customInstructions) {
    try {
      ci = JSON.parse(customInstructions);
    } catch {
      ci = null;
    }
  }

  // Reject a blob that positively declares a DIFFERENT kind (e.g. BSV-21's
  // `kind:'bsv-21'`) — that's genuinely not ours even inside a token basket.
  if (ci && typeof ci.kind === 'string' && !KINDS.includes(ci.kind)) return null;

  // Prefer the explicit `kind`; then a protocol tag (older records wrote
  // customInstructions as {tokenId, brc42KeyId, flagsHex, serviceFields} with a
  // [protocol.id] tag); then the caller's known basket. Only truly unknown → null.
  const tagKind = (tags ?? []).find((t) => t === 'stas' || t === 'dstas') as StasKind | undefined;
  const kind: StasKind | undefined =
    (ci && KINDS.includes(ci.kind) ? ci.kind : undefined) ?? tagKind ?? fallbackKind;
  if (!kind) return null;

  const tokenId: string = ci?.tokenId ?? tagValue(tags, 'id') ?? '';
  const symbol: string | undefined = ci?.symbol ?? tagValue(tags, 'sym');

  return {
    kind,
    tokenId,
    brc42KeyId: ci?.brc42KeyId,
    ownerFieldHash160: ci?.ownerFieldHash160,
    symbol,
    name: ci?.name ?? null,
    flagsHex: ci?.flagsHex,
    freezeEnabled: ci?.freezeEnabled,
    confiscationEnabled: ci?.confiscationEnabled,
    redemptionPkh: ci?.redemptionPkh,
    issuerIdentityKey: ci?.issuerIdentityKey,
    satoshisPerToken: ci?.satoshisPerToken ?? 1,
    serviceFields: Array.isArray(ci?.serviceFields) ? ci.serviceFields : [],
    frozen: ci?.frozen ?? false,
    confiscated: ci?.confiscated ?? false,
  };
}

/** Read a `key:value` tag (e.g. `sym:CSTAS`) — same convention BSV-21 uses. */
export function tagValue(tags: string[] | undefined | null, key: string): string | undefined {
  const hit = (tags ?? []).find((t) => t.startsWith(`${key}:`));
  return hit ? hit.slice(key.length + 1) : undefined;
}
