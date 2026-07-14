/**
 * DSTAS locking-script parser.
 *
 * The single import site of `dxs-bsv-token-sdk` for ownership recognition —
 * the rest of bsv-desktop works against the normalized `ParsedDstas` shape and
 * never touches the SDK's reader types directly.
 */

import { ScriptType, toHex } from 'dxs-bsv-token-sdk/bsv';
// `LockingScriptReader` is namespace-imported from the SDK's leaf module
// because Rollup's CommonJS plugin refuses to surface it as a named ESM
// export — neither the `/bsv` aggregator (which uses `__exportStar` to
// forward from ./script) nor the leaf module (which uses the canonical
// `exports.X = X` pattern) trip its static-named-export detection. Vite
// dev (esbuild pre-bundle) sees it; Vite prod (Rollup) doesn't.
//
// The namespace import works because it doesn't ask Rollup to verify any
// specific named export — the bundle just gets the whole module object
// and we pluck the property at module init time. The leaf sub-path is
// whitelisted in the SDK's `exports` field (vendor/.../package.json).
import * as LockingScriptReaderModule from 'dxs-bsv-token-sdk/script/read/locking-script-reader';
const { LockingScriptReader } = LockingScriptReaderModule;

export interface ParsedDstas {
  /** 20-byte owner field (PKH), hex — what ownership recognition matches on. */
  ownerFieldHash160: string;
  /** Redemption / protoID PKH (the token id), hex. */
  tokenId: string;
  freezeEnabled: boolean;
  confiscationEnabled: boolean;
  /** Raw flags region, hex. */
  flagsHex: string;
  /** Service-field byte regions, hex. */
  serviceFields: string[];
  /**
   * Optional-data region, hex per entry. DSTAS_SCRIPT_INVARIANTS.md §7
   * requires byte-exact propagation onto descendant DSTAS outputs that
   * continue the same asset leg — losing this on a transfer breaks
   * subsequent spend validation. Required for DSTAS send.
   */
  optionalData: string[];
  /**
   * Action-data field token. For a freshly-issued or post-transfer DSTAS,
   * this is `{ opCode: OP_0 }` (no action) or `{ opCode: OP_2 }` (frozen).
   * Surface both shapes — `data` for non-empty action bytes,
   * `opCode` for sentinel opcodes — so the transfer builder can echo it
   * or substitute the neutral `OP_0` marker for a fresh transfer.
   */
  actionData: { data?: string; opCode?: number };
  /** True iff the action-data marker indicates frozen state (OP_2 or 0x02 prefix). */
  frozen: boolean;
}

/**
 * Parse a locking script as DSTAS. Returns `null` — never throws — for any
 * script that is not DSTAS or whose owner field is not a 20-byte PKH (other
 * identity-field shapes are not wallet-recognisable and are treated as foreign).
 */
export function parseDstasLockingScript(scriptHex: string): ParsedDstas | null {
  let reader: any;
  try {
    reader = LockingScriptReader.readHex(scriptHex);
  } catch {
    return null;
  }
  if (!reader || reader.ScriptType !== ScriptType.dstas) return null;

  const d = reader.Dstas;
  if (!d || !d.Owner || d.Owner.length !== 20) return null;

  // DSTAS action-data semantics per DSTAS_LOCKING_TEMPLATE_NOTES.md:
  //   - OP_0 (0x00)         → empty action, not frozen
  //   - OP_2 (0x52)          → empty action, frozen
  //   - bytes prefixed 0x02  → non-empty action, frozen
  //   - other bytes          → non-empty action, not frozen
  const actionDataRaw: Uint8Array | undefined = d.ActionDataRaw;
  const actionDataOpCode: number | undefined = d.ActionDataOpCode;
  const frozen =
    actionDataOpCode === 0x52 ||
    (!!actionDataRaw && actionDataRaw.length > 0 && actionDataRaw[0] === 0x02);

  return {
    ownerFieldHash160: toHex(d.Owner),
    tokenId: toHex(d.Redemption),
    freezeEnabled: !!d.FreezeEnabled,
    confiscationEnabled: !!d.ConfiscationEnabled,
    flagsHex: toHex(d.Flags),
    serviceFields: (d.ServiceFields || []).map((f: any) => toHex(f)),
    optionalData: (d.OptionalData || []).map((b: any) => toHex(b)),
    actionData: actionDataRaw
      ? { data: toHex(actionDataRaw) }
      : { opCode: actionDataOpCode },
    frozen,
  };
}
