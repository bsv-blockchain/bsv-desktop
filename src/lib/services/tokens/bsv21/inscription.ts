/**
 * BSV-21 ord-inscription envelope: build + parse.
 *
 * On-chain output layout (hex bytes shown):
 *
 *   00 63                      OP_FALSE OP_IF
 *   03 6f 72 64                push "ord"  (3-byte length-prefixed)
 *   51                         OP_1 — content-type tag (canonical, minimal-push)
 *   12 <ct...>                 push content-type bytes (18 = "application/bsv-20")
 *   00                         OP_0 (separator before content payload)
 *   <push> <json bytes>        push the JSON payload (variable-length)
 *   68                         OP_ENDIF
 *   76 a9 14 <20-byte pkh> 88 ac
 *                              P2PKH owner lock
 *
 * JSON payload shape (transfer):  {"p":"bsv-20","op":"transfer","id":"<txid_vout>","amt":"<int>"}
 * Field order is fixed by our builder so the produced bytes are reproducible,
 * but the parser accepts any order — the wire format is JSON, not byte-significant.
 *
 * Why OP_1 (0x51) for the content-type tag: the canonical Ordinals envelope
 * uses minimal-push encoding (OP_1 for single-byte value 0x01). Earlier
 * versions of this builder emitted the non-minimal `01 01` push, which the
 * 1sat-stack `go-templates/bsv21` decoder rejects as non-canonical — meaning
 * neither JungleBus auto-pickup nor direct `/1sat/bsv21/overlay/submit`
 * would index our outputs. Verified empirically 2026-05-28 against
 * `$NINJAPUNKGIRLS` and other indexed tokens; they all use OP_1.
 *
 * No dependency on @bopen-io/templates; this module talks bytes directly.
 */

import { BSV20_CONTENT_TYPE } from './constants';

const ORD_TAG_HEX = '6f7264'; // "ord"
const OP_FALSE_HEX = '00';
const OP_IF_HEX = '63';
const OP_1_HEX = '51'; // OP_1 — canonical minimal-push of value 0x01
const OP_ENDIF_HEX = '68';
const OP_DUP_HEX = '76';
const OP_HASH160_HEX = 'a9';
const OP_EQUALVERIFY_HEX = '88';
const OP_CHECKSIG_HEX = 'ac';
const PKH_PUSH_LEN_HEX = '14'; // 20-byte hash160 push

export interface Bsv21TransferPayload {
  /** Token id — `<txid>_<vout>` of the deploy+mint output. */
  id: string;
  /** Token amount, stringified bigint (raw integer units). */
  amt: string;
  /** Decimals — only present on deploy+mint per spec, but we tolerate it. */
  dec?: number;
  /** Optional symbol / ticker. */
  sym?: string;
  /** Optional icon outpoint / URL. */
  icon?: string;
}

export interface Bsv21BuildArgs {
  payload: Bsv21TransferPayload;
  /** P2PKH owner — hash160 hex (40 chars). */
  ownerHash160: string;
}

export interface ParsedBsv21Output extends Bsv21TransferPayload {
  /** 20-byte owner field (PKH), hex — the trailing P2PKH owner. */
  ownerHash160: string;
}

/** Convert a UTF-8 string to lowercase hex. */
function utf8ToHex(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let h = '';
  for (const b of bytes) h += b.toString(16).padStart(2, '0');
  return h;
}

/** Encode a Bitcoin pushdata for `bytes` (hex), returning the opcode+length+data hex. */
function encodePushHex(bytesHex: string): string {
  const len = bytesHex.length / 2;
  if (len === 0) return '00'; // OP_0
  if (len <= 0x4b) {
    return len.toString(16).padStart(2, '0') + bytesHex;
  }
  if (len <= 0xff) {
    return '4c' + len.toString(16).padStart(2, '0') + bytesHex;
  }
  if (len <= 0xffff) {
    const lo = len & 0xff;
    const hi = (len >> 8) & 0xff;
    return '4d' + lo.toString(16).padStart(2, '0') + hi.toString(16).padStart(2, '0') + bytesHex;
  }
  // 4-byte length (OP_PUSHDATA4) — BSV-20 payloads should never reach this size.
  const b0 = len & 0xff;
  const b1 = (len >> 8) & 0xff;
  const b2 = (len >> 16) & 0xff;
  const b3 = (len >> 24) & 0xff;
  return (
    '4e' +
    b0.toString(16).padStart(2, '0') +
    b1.toString(16).padStart(2, '0') +
    b2.toString(16).padStart(2, '0') +
    b3.toString(16).padStart(2, '0') +
    bytesHex
  );
}

/**
 * Build a BSV-21 transfer locking-script (hex). The payload's `op` is
 * forced to `"transfer"` and `id`/`amt` are required. `dec`, `sym`, `icon`
 * are optional and included only if defined.
 */
export function buildBsv21Transfer(args: Bsv21BuildArgs): string {
  const { payload, ownerHash160 } = args;
  if (!/^[0-9a-fA-F]{40}$/.test(ownerHash160)) {
    throw new Error(`buildBsv21Transfer: ownerHash160 must be 40 hex chars (got ${ownerHash160.length})`);
  }

  // Construct the BSV-20 JSON. Field order is fixed for reproducible bytes.
  // EVERY value must serialize as a JSON string — 1sat-stack's
  // `go-templates/bsv21` Decode unmarshals into `map[string]string`, so a
  // numeric `dec` (e.g. `"dec": 10`) breaks `json.Unmarshal` and the
  // topic-manager rejects the output with no error surfacing to us.
  // `amt` is already a stringified bigint per spec; `dec` arrives as a
  // JS number from the basket tag, so we coerce here.
  const obj: Record<string, string> = {
    p: 'bsv-20',
    op: 'transfer',
    id: payload.id,
    amt: payload.amt,
  };
  if (payload.dec !== undefined) obj.dec = String(payload.dec);
  if (payload.sym !== undefined) obj.sym = payload.sym;
  if (payload.icon !== undefined) obj.icon = payload.icon;
  const jsonHex = utf8ToHex(JSON.stringify(obj));

  // ord envelope.
  const ordTagPush = encodePushHex(ORD_TAG_HEX); // 03 6f 72 64
  // Content-type field tag: OP_1 (0x51), the canonical minimal-push of value 1.
  // Was previously the non-minimal 01 01 form, which 1sat-stack's go-templates
  // bsv21 decoder rejects as non-canonical.
  const fieldIdContentType = OP_1_HEX;
  const ctPush = encodePushHex(utf8ToHex(BSV20_CONTENT_TYPE));
  const separator = '00'; // OP_0
  const contentPush = encodePushHex(jsonHex);

  const envelope =
    OP_FALSE_HEX +
    OP_IF_HEX +
    ordTagPush +
    fieldIdContentType +
    ctPush +
    separator +
    contentPush +
    OP_ENDIF_HEX;

  const p2pkh =
    OP_DUP_HEX +
    OP_HASH160_HEX +
    PKH_PUSH_LEN_HEX +
    ownerHash160.toLowerCase() +
    OP_EQUALVERIFY_HEX +
    OP_CHECKSIG_HEX;

  return envelope + p2pkh;
}

/**
 * Reader over a hex-encoded script. Tracks a byte offset (in hex pairs)
 * and exposes a tiny pushdata reader used by the parser.
 */
class HexReader {
  pos = 0;
  constructor(public readonly hex: string) {}
  remaining(): number { return (this.hex.length - this.pos) / 2; }
  readByteHex(): string | null {
    if (this.pos + 2 > this.hex.length) return null;
    const b = this.hex.substring(this.pos, this.pos + 2);
    this.pos += 2;
    return b;
  }
  readBytesHex(n: number): string | null {
    if (this.pos + n * 2 > this.hex.length) return null;
    const out = this.hex.substring(this.pos, this.pos + n * 2);
    this.pos += n * 2;
    return out;
  }
  /** Read the next pushdata's payload bytes (hex), advancing past the opcode + length. */
  readPushHex(): string | null {
    const op = this.readByteHex();
    if (op === null) return null;
    const code = parseInt(op, 16);
    if (code === 0) return ''; // OP_0
    if (code >= 0x01 && code <= 0x4b) {
      return this.readBytesHex(code);
    }
    if (code === 0x4c) {
      const lenHex = this.readByteHex();
      if (lenHex === null) return null;
      return this.readBytesHex(parseInt(lenHex, 16));
    }
    if (code === 0x4d) {
      const b1 = this.readByteHex(); const b2 = this.readByteHex();
      if (b1 === null || b2 === null) return null;
      const len = parseInt(b2 + b1, 16); // LE
      return this.readBytesHex(len);
    }
    if (code === 0x4e) {
      const b1 = this.readByteHex(); const b2 = this.readByteHex();
      const b3 = this.readByteHex(); const b4 = this.readByteHex();
      if (!b1 || !b2 || !b3 || !b4) return null;
      const len = parseInt(b4 + b3 + b2 + b1, 16);
      return this.readBytesHex(len);
    }
    return null; // non-push opcode
  }
}

function hexToUtf8(hex: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substring(i, i + 2), 16));
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return '';
  }
}

/**
 * Parse a locking script as a BSV-21 transfer (or deploy+mint) output.
 * Returns null for non-BSV-21 scripts — never throws.
 *
 * Recognises both `OP_1 (0x51)` and `push-of-0x01` for the ord field-id
 * marker, since toolboxes in the wild emit both shapes — including our own
 * older outputs before the canonical-form fix.
 */
export function parseBsv21LockingScript(scriptHex: string): ParsedBsv21Output | null {
  if (typeof scriptHex !== 'string' || scriptHex.length < 60) return null;
  const lower = scriptHex.toLowerCase();
  // Must start with OP_FALSE OP_IF.
  if (!lower.startsWith(OP_FALSE_HEX + OP_IF_HEX)) return null;

  const r = new HexReader(lower);
  r.pos = 4; // past OP_FALSE OP_IF

  // First push: "ord".
  const tag = r.readPushHex();
  if (tag !== ORD_TAG_HEX) return null;

  // Field id: 0x01 (content-type marker) — accept OP_1 (0x51) or push-of-1-byte-0x01.
  const peek = lower.substring(r.pos, r.pos + 2);
  if (peek === '51') {
    r.pos += 2;
  } else {
    const fieldIdBytes = r.readPushHex();
    if (fieldIdBytes !== '01') return null;
  }

  // Content-type push.
  const ctHex = r.readPushHex();
  if (ctHex === null) return null;
  const ct = hexToUtf8(ctHex);
  if (ct !== BSV20_CONTENT_TYPE) return null;

  // OP_0 separator.
  const sep = r.readByteHex();
  if (sep !== '00') return null;

  // Content payload — the BSV-20 JSON.
  const contentHex = r.readPushHex();
  if (contentHex === null) return null;
  const jsonText = hexToUtf8(contentHex);
  let payload: any;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!payload || payload.p !== 'bsv-20') return null;

  // OP_ENDIF.
  const endIf = r.readByteHex();
  if (endIf !== OP_ENDIF_HEX) return null;

  // Trailing P2PKH lock.
  const dup = r.readByteHex();
  const hash160Op = r.readByteHex();
  const pushLen = r.readByteHex();
  if (dup !== OP_DUP_HEX || hash160Op !== OP_HASH160_HEX || pushLen !== PKH_PUSH_LEN_HEX) {
    return null;
  }
  const ownerHash160 = r.readBytesHex(20);
  if (!ownerHash160) return null;
  const equalVerify = r.readByteHex();
  const checkSig = r.readByteHex();
  if (equalVerify !== OP_EQUALVERIFY_HEX || checkSig !== OP_CHECKSIG_HEX) return null;

  // Map JSON payload into our parsed shape. `op` may be 'transfer' or
  // 'deploy+mint'; transfers have an `id`, mints don't (the deploy outpoint
  // IS the id). Surface both — the caller picks what it needs.
  const isMint = payload.op === 'deploy+mint';
  const id: string | undefined = isMint ? undefined : payload.id;
  const amt: string | undefined = payload.amt;
  if (!amt) return null;

  // `dec` is a string per spec ("0".."18") but we also accept a JS number
  // for legacy outputs written before the canonical-form fix.
  let dec: number | undefined;
  if (typeof payload.dec === 'number' && Number.isFinite(payload.dec)) {
    dec = payload.dec;
  } else if (typeof payload.dec === 'string' && /^\d+$/.test(payload.dec)) {
    const n = parseInt(payload.dec, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 18) dec = n;
  }

  return {
    // Mints don't have id in the payload; the caller resolves it from the
    // outpoint at registration time.
    id: id ?? '',
    amt,
    dec,
    sym: typeof payload.sym === 'string' ? payload.sym : undefined,
    icon: typeof payload.icon === 'string' ? payload.icon : undefined,
    ownerHash160,
  };
}
