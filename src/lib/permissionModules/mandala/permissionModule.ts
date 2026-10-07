/**
 * MandalaTokenModule — the `WalletPermissionsManager` P-module for the
 * `'p mandala'` basket (schemeID `'mandala'`).
 *
 * Mirrors `@bsv/btms-permission-module`'s `BasicTokenModule` shape and file
 * organization exactly (admin pass-through, a 60s session-authorization
 * cache keyed by originator, a JSON-encoded prompt message, a generic
 * fallback that never throws on a decode failure) — but decodes Mandala's
 * BRC-162 VALUE output layout via the local `MandalaToken.decode` boundary
 * over `Bsv21Binary` from `@bsv/templates`, NOT BTMS's `PushDrop.decode`:
 * the two token formats are unrelated.
 *
 * Mandala's FT protocol is `[2, 'p mandala token']` (@bsv/mandala 0.4.1), so
 * `WalletPermissionsManager` also routes every wallet call keyed on that
 * protocol here, the same way BTMS's `[0, 'p btms']` reaches
 * `BasicTokenModule`. For a connected app:
 *  - `getPublicKey`/`verifySignature` pass through. A public key cannot
 *    spend, and issuing or sending to yourself needs keys toward `self`/
 *    your own identity key.
 *  - `createSignature` passes only when the digest it signs is the BIP-143
 *    sighash of an input of a transaction this module saw the user approve
 *    (the `createAction` response, captured in `onResponse`). Any other
 *    signature gets its own prompt and never grants a session.
 *  - `encrypt`/`decrypt`/`createHmac`/`verifyHmac` are refused: nothing in
 *    the Mandala lib uses them under the token protocol.
 *
 * Source of truth: offline-settlement-final.md §8.3, plus a set of
 * adversarial-review findings closed here (see the inline notes tagged
 * "adversarial-review finding" throughout this file):
 *  1. [reverted] listOutputs preserves `customInstructions` when requested:
 *     Mandala needs keyID/counterparty bookkeeping to discover issuer assets
 *     and spendable coins. Derivation knowledge alone cannot bypass the
 *     signature gate, which binds signing to approved transactions.
 *  2. [medium/high] createAction that only SPENDS `'p mandala'` INPUTS (no
 *     basketed change output) is now gated too — see `anyInputIsTokenCoin`
 *     and the `wrapCreateActionForTokenInputs` wrapper below.
 *  3. [medium] listActions is now routed the same as listOutputs.
 *  4. [medium] Prompt amounts are grouped by assetId and decimal-formatted.
 *  5. [low] relinquishOutput is its own authorization class.
 */
import { Hash, LockingScript, Transaction, Utils } from '@bsv/sdk'
import type { PermissionsModule } from '@bsv/wallet-toolbox-client'
import { MandalaToken } from './token'
import { MANDALA_BASKET } from './types'

const SESSION_TIMEOUT_MS = 60_000
const SESSION_CLEANUP_INTERVAL_MS = 30_000
/** Approved transactions remembered per originator. A token send signs right
 * after its createAction, so a handful covers any honest app; the cap keeps
 * a looping one from growing the map without bound. */
const MAX_AUTHORIZED_TRANSACTIONS_PER_ORIGINATOR = 8

/** Token-protocol methods the Mandala lib never calls: refused outright. */
const REFUSED_KEY_METHODS = new Set(['encrypt', 'decrypt', 'createHmac', 'verifyHmac'])

/**
 * The digest a `createSignature` call will actually sign: `hashToDirectlySign`
 * as given, otherwise SHA-256 of `data` (what ProtoWallet does). Undefined
 * for anything malformed, which the caller then refuses.
 */
export function signedDigestHex(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const { hashToDirectlySign, data } = args as { hashToDirectlySign?: unknown; data?: unknown }
  const bytes = (value: unknown): number[] | undefined => {
    if (!Array.isArray(value) && !(value instanceof Uint8Array)) return undefined
    const out = Array.from(value as ArrayLike<unknown>)
    return out.every(b => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 255)
      ? (out as number[])
      : undefined
  }
  if (hashToDirectlySign !== undefined) {
    const hash = bytes(hashToDirectlySign)
    return hash !== undefined && hash.length === 32 ? Utils.toHex(hash) : undefined
  }
  const payload = bytes(data)
  return payload !== undefined ? Utils.toHex(Hash.sha256(payload)) : undefined
}

/**
 * The BIP-143 sighash (SIGHASH_ALL|FORKID, what `walletMandalaUnlock` signs
 * by default) of every input of a signable transaction. An input whose
 * source is not in the BEEF cannot be hashed and is skipped: it is not one
 * the wallet can be asked to sign for anyway.
 */
export function authorizedSighashes(atomicBEEF: number[] | Uint8Array): Set<string> {
  const tx = Transaction.fromAtomicBEEF(Array.from(atomicBEEF))
  const digests = new Set<string>()
  for (let i = 0; i < tx.inputs.length; i++) {
    try {
      digests.add(Utils.toHex(Hash.hash256(tx.preimage(i))))
    } catch {
      // No source transaction for this input.
    }
  }
  return digests
}

/**
 * Normalises an outpoint the same way the SDK's own `Number(...)` coercion
 * of a vout would (mirrors `services/vault/guard.ts`'s own
 * `canonicalOutpoint`, kept as a separate small copy rather than a shared
 * import so Mandala's permission gate does not depend on Vault's module).
 *
 * XR-039: `listMandalaTokenOutpoints`'s Set and an input's own `outpoint`
 * string have to agree on ONE spelling of the same outpoint, or an alternate
 * spelling ("00", "0e0", a differently-cased txid) lets a real token input
 * slip past the `.has()` check unmatched. `undefined` for anything that is
 * not a well-formed `<64-hex-txid>.<vout>` — callers then never match it
 * against anything, which is the safe default.
 */
export function canonicalOutpoint(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value.split('.')
  if (parts.length !== 2 || !/^[0-9a-fA-F]{64}$/.test(parts[0])) return undefined
  const vout = Number(parts[1])
  if (!Number.isSafeInteger(vout) || vout < 0) return undefined
  return `${parts[0].toLowerCase()}.${vout}`
}

/** One `listOutputs`-shaped page, as `listAllOutpoints` needs to see it. */
export interface OutpointListPage {
  outputs: { outpoint: string }[]
  totalOutputs?: number
}

/**
 * Every outpoint a paged listing reports, to completion, canonicalized.
 *
 * XR-039: `listMandalaTokenOutpoints` (WalletContext.tsx) used to read a
 * single capped page and call that the whole basket — a spend of an input
 * past that page read as "not a token input" to every caller of the Set this
 * builds, exactly the same balance-truncation bug `core/localpay/build.ts`'s
 * `listTokenBasket` and `core/mandala/createRuntime.ts`'s `listTokenOutputs`
 * were already fixed for. Same paging discipline here: the wallet's own
 * `totalOutputs` ends the loop when it reports one, a short/empty page ends
 * it otherwise, and `maxPages` is the hard stop against a wallet that ignores
 * `offset` or reports a total it never actually serves.
 *
 * A pure function over an injected `list` rather than a method on the wallet
 * itself so this loop — the actual security-relevant logic, not just glue —
 * is unit-testable without a real wallet/storage stack.
 */
export async function listAllOutpoints(
  list: (limit: number, offset: number) => Promise<OutpointListPage>,
  pageSize = 1000,
  maxPages = 1000
): Promise<Set<string>> {
  const outpoints = new Set<string>()
  let offset = 0
  for (let page = 0; page < maxPages; page++) {
    const { outputs, totalOutputs } = await list(pageSize, offset)
    for (const o of outputs) {
      const canonical = canonicalOutpoint(o.outpoint)
      if (canonical !== undefined) outpoints.add(canonical)
    }
    // An empty page always ends it — that, plus the page ceiling, is what
    // keeps a wallet that ignores `offset` from looping forever.
    if (outputs.length === 0) break
    offset += outputs.length
    if (typeof totalOutputs === 'number') {
      // The wallet's own count is authoritative when it reports one. A SHORT
      // page must not end the loop here: a wallet may cap `limit` below what
      // was asked for, and treating that cap as "end of basket" would
      // re-introduce the truncation this loop exists to remove.
      if (offset >= totalOutputs) break
    } else if (outputs.length < pageSize) {
      break
    }
  }
  return outpoints
}

export interface MandalaAssetMetadata {
  label?: string
  ticker?: string
  /** Base-10 display decimals (e.g. 2 for cents-style tokens). Absent/non-numeric
   * means "unknown" — every amount display falls back to raw base units. */
  decimals?: number
}

export interface MandalaTokenModuleDeps {
  /** Our own app's originator — calls carrying it pass through with zero prompts. */
  adminOriginator: string
  /** Same shape as BTMS's requestTokenAccess: app id + JSON message -> approved? */
  requestTokenAccess: (app: string, message: string) => Promise<boolean>
  /** Optional friendly name/ticker/decimals for the prompt copy. Never gates anything —
   * a throwing or null-returning resolver just means the raw assetId (in base units) is shown. */
  resolveAssetMetadata: (assetId: string) => Promise<MandalaAssetMetadata | null>
  /**
   * Adversarial-review finding (2): every outpoint (`'txid.vout'`) this
   * wallet currently holds in `MANDALA_BASKET`, via the admin-originator
   * wallet's own `listOutputs({basket: MANDALA_BASKET, ...})` — i.e. a call
   * that itself passes through this module with zero prompts (see the
   * admin pass-through branch in `onRequest`). Used to detect a
   * `createAction` that spends token coins purely through `inputs`, which
   * `WalletPermissionsManager`'s basket-routing (keyed on OUTPUTS only,
   * `collectNonPBaskets`) would otherwise miss entirely. A throwing
   * implementation is treated as "no token inputs found" — this dep can
   * only ever ADD a prompt, never remove one that would otherwise fire from
   * the output-side checks, so a fault here fails toward "no extra info",
   * not toward "silently allow".
   */
  listTokenOutpoints: () => Promise<Set<string>>
  /**
   * XR-041: resolves ONE currently-held `MANDALA_BASKET` outpoint to its
   * decoded `{assetId, amount}`, via the admin-originator wallet's own
   * listing — never from anything a caller claims. `null` for an outpoint
   * this device does not currently hold as a Mandala coin (already spent,
   * never was one, or an unresolvable/malformed one) — `promptForRelinquish`
   * fails CLOSED on `null` rather than falling back to unlabeled copy: an
   * app must not be able to get an unnamed holding removed.
   */
  resolveMandalaOutput: (outpoint: string) => Promise<DecodedMandalaOutput | null>
}

/** The slice of `CreateActionOutput` this module reads. Structural, not the
 * full SDK type, so a test can pass a plain object. */
interface MandalaCreateActionOutputLike {
  lockingScript?: string
  basket?: string
  customInstructions?: string
}

/** True for an output the Mandala lib marks as the payment itself
 * (customInstructions `direction: 'sent'`). In a send to yourself that
 * output stays in the basket, so the basket alone would show it as change. */
function isMarkedSent(output: MandalaCreateActionOutputLike): boolean {
  if (typeof output?.customInstructions !== 'string') return false
  try {
    return (JSON.parse(output.customInstructions) as { direction?: unknown })?.direction === 'sent'
  } catch {
    return false
  }
}
/** The slice of `RelinquishOutputArgs` this module reads. */
interface MandalaRelinquishOutputArgsLike {
  basket?: string
  output?: string
}
/** The slice of `CreateActionInput` this module reads. */
interface MandalaCreateActionInputLike {
  outpoint?: string
}
interface MandalaCreateActionArgsLike {
  outputs?: MandalaCreateActionOutputLike[]
  inputs?: MandalaCreateActionInputLike[]
}

interface MandalaInternalizeOutputLike {
  outputIndex: number
  protocol?: string
  insertionRemittance?: { basket?: string }
}
interface MandalaInternalizeActionArgsLike {
  /** AtomicBEEF — the SDK type allows either representation; both feed
   * `Transaction.fromAtomicBEEF` directly. */
  tx?: number[] | Uint8Array
  outputs?: MandalaInternalizeOutputLike[]
}

export interface DecodedMandalaOutput {
  assetId: string
  amount: number
}

/** One asset's send/change totals for a createAction spend prompt. */
export interface MandalaSpendLine {
  assetId: string
  sendAmount: number
  changeAmount: number
  tokenName?: string
  decimals?: number
  /** Decimal-formatted, e.g. "25.00 USDX"; base units + a short assetId when
   * decimals could not be resolved. */
  display: string
}

/** One asset's credited total for an internalizeAction credit prompt. */
export interface MandalaCreditLine {
  assetId: string
  creditAmount: number
  tokenName?: string
  decimals?: number
  display: string
}

/**
 * Decodes one output's locking script as a Mandala token. Never throws:
 * `MandalaToken.decode` throws on anything that isn't a valid BRC-162
 * P2PKH VALUE output, and every caller here treats "not a Mandala output" the same way
 * whether the script is empty, foreign, or simply malformed.
 */
export function tryDecodeMandalaOutput(lockingScriptHex: string | undefined): DecodedMandalaOutput | null {
  if (!lockingScriptHex) return null
  try {
    const script = LockingScript.fromHex(lockingScriptHex)
    const decoded = MandalaToken.decode(script)
    return { assetId: decoded.assetId, amount: decoded.amount }
  } catch {
    return null
  }
}

/** One `listOutputs`-shaped page carrying locking scripts, as `resolveMandalaOutput` needs them. */
export interface ScriptedOutputPage {
  outputs: { outpoint: string; lockingScript?: string }[]
  totalOutputs?: number
}

/**
 * Finds ONE currently-held outpoint in a paged listing, to completion, and
 * decodes its Mandala token script.
 *
 * XR-041: `promptForRelinquish` used to authorize removing a holding with no
 * more than the bare action name — "wants to remove a Mandala token holding
 * from your wallet" — never which one. This is what lets it name the target:
 * `assetId`/`amount` resolved from the wallet's OWN current listing, never
 * from anything the caller claims. `null` — not found (already spent, never
 * held, or `target` malformed), or the page ceiling was hit without a match —
 * is the caller's signal to fail closed rather than approve an unlabeled
 * removal; same truncation discipline as `listAllOutpoints` (XR-039), because
 * a holding on page two must be just as nameable as one on page one.
 */
export async function resolveMandalaOutput(
  list: (limit: number, offset: number) => Promise<ScriptedOutputPage>,
  target: string,
  pageSize = 1000,
  maxPages = 1000
): Promise<DecodedMandalaOutput | null> {
  const canonicalTarget = canonicalOutpoint(target)
  if (canonicalTarget === undefined) return null
  let offset = 0
  for (let page = 0; page < maxPages; page++) {
    const { outputs, totalOutputs } = await list(pageSize, offset)
    for (const o of outputs) {
      if (canonicalOutpoint(o.outpoint) === canonicalTarget) return tryDecodeMandalaOutput(o.lockingScript)
    }
    // An empty page always ends it — that, plus the page ceiling, is what
    // keeps a wallet that ignores `offset` from looping forever.
    if (outputs.length === 0) break
    offset += outputs.length
    if (typeof totalOutputs === 'number') {
      // The wallet's own count is authoritative when it reports one. A SHORT
      // page must not end the loop here: a wallet may cap `limit` below what
      // was asked for, and treating that cap as "end of basket" would
      // re-introduce the truncation this loop exists to remove.
      if (offset >= totalOutputs) break
    } else if (outputs.length < pageSize) {
      break
    }
  }
  return null
}

/** A short, human-scannable form of a long `'<64-hex>.<vout>'` assetId. */
function shortAssetId(assetId: string): string {
  if (!assetId || assetId.length <= 16) return assetId
  return `${assetId.slice(0, 8)}…${assetId.slice(-6)}`
}

/**
 * "25.00 USDX" when decimals are known (clamped to a sane 0-18 range,
 * mirroring common token-decimals conventions); "2500000 a1b2c3d4…ef01.0"
 * (raw base units + a short assetId form) when they are not — adversarial-
 * review finding (4): never show raw base units next to a resolved ticker,
 * and never guess a decimals value we were not actually given.
 */
function formatTokenAmount(
  baseUnits: number,
  decimals: number | undefined,
  tokenName: string | undefined,
  assetId: string
): string {
  if (typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18) {
    const scaled = baseUnits / 10 ** decimals
    const unit = tokenName || shortAssetId(assetId)
    return `${scaled.toFixed(decimals)} ${unit}`
  }
  return `${baseUnits} ${shortAssetId(assetId)}`
}

/**
 * Adversarial-review finding (2): the P-label `WalletPermissionsManager`'s
 * `listActions`/`createAction` label-routing keys on. Two independent uses:
 *  - `wrapCreateActionForTokenInputs` (below) injects it onto a createAction
 *    call whose INPUTS spend `'p mandala'` coins but whose outputs carry no
 *    `'p mandala'`-basket output — the manager's own basket-only routing
 *    would otherwise never call `onRequest` for such a call at all.
 *  - It also then persists as a real label on the resulting action, so it
 *    doubles as the "Mandala action" label finding (3) calls for: apps that
 *    build Mandala createAction calls directly (rather than through the
 *    wrapper) should add this same label so `listActions({labels:[...]})`
 *    P-routes to this module too — label-routing is `listActions`' ONLY
 *    signal, `MANDALA_BASKET` alone does not make a listActions call route
 *    here. This module cannot enforce that from inside `onRequest` (it never
 *    sees the call before the manager decides whether to route it at all);
 *    it is a wiring requirement on every Mandala action-creation call site.
 */
export const MANDALA_ACTION_LABEL = 'p mandala token-spend'

export class MandalaTokenModule implements PermissionsModule {
  private readonly deps: MandalaTokenModuleDeps

  /**
   * Session-authorization cache — same shape as BasicTokenModule's: a
   * time-limited (60s) grant per originator, refreshed by every prompt this
   * module shows (spend/credit/access alike), consulted only by the
   * once-per-session access checks (`listOutputs`/`listActions`).
   * `relinquishOutput` deliberately does NOT read or write this cache —
   * adversarial-review finding (5): it is its own authorization class.
   */
  private readonly sessionAuthorizations: Map<string, number> = new Map()
  /** Per originator: the input sighashes of each transaction the user
   * approved through `promptForSpend`/`promptGeneric`, newest last. */
  private readonly authorizedTransactions: Map<string, { digests: Set<string>; timestamp: number }[]> = new Map()
  private readonly cleanupTimer: ReturnType<typeof setInterval>

  constructor(deps: MandalaTokenModuleDeps) {
    if (!deps || typeof deps.requestTokenAccess !== 'function') {
      throw new Error('requestTokenAccess callback is required')
    }
    if (!deps.adminOriginator || typeof deps.adminOriginator !== 'string') {
      throw new Error('adminOriginator is required')
    }
    this.deps = deps
    this.cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), SESSION_CLEANUP_INTERVAL_MS)
    // Never keep a test runner or RN's timer host alive just for this sweep.
    ;(this.cleanupTimer as unknown as { unref?: () => void }).unref?.()
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now()
    for (const [originator, timestamp] of this.sessionAuthorizations.entries()) {
      if (now - timestamp > SESSION_TIMEOUT_MS) {
        this.sessionAuthorizations.delete(originator)
      }
    }
    for (const originator of this.authorizedTransactions.keys()) this.liveAuthorizedTransactions(originator)
  }

  /** This originator's unexpired approved transactions; prunes the rest. */
  private liveAuthorizedTransactions(originator: string): { digests: Set<string>; timestamp: number }[] {
    const now = Date.now()
    const live = (this.authorizedTransactions.get(originator) ?? []).filter(t => now - t.timestamp <= SESSION_TIMEOUT_MS)
    if (live.length === 0) this.authorizedTransactions.delete(originator)
    else this.authorizedTransactions.set(originator, live)
    return live
  }

  private hasSessionAuthorization(originator: string): boolean {
    const timestamp = this.sessionAuthorizations.get(originator)
    if (!timestamp) return false
    if (Date.now() - timestamp > SESSION_TIMEOUT_MS) {
      this.sessionAuthorizations.delete(originator)
      return false
    }
    return true
  }

  private grantSessionAuthorization(originator: string): void {
    this.sessionAuthorizations.set(originator, Date.now())
  }

  /**
   * THE ONLY MANDALA-SPECIFIC LINE (per spec §8.3): our own app's lib calls
   * always carry `adminOriginator` (the wallet's `withAdminOriginator`
   * wrapper) — auto-approve them with no prompt, preserving "no review
   * screen, the CTA is the confirmation". Everyone else is a paired external
   * caller and is prompted, exactly like BTMS.
   */
  async onRequest(req: { method: string; args: object; originator: string }): Promise<{ args: object }> {
    const { method, args, originator } = req

    if (!method || typeof method !== 'string') throw new Error('Invalid method')
    if (!originator || typeof originator !== 'string') throw new Error('Invalid originator')
    if (!args || typeof args !== 'object') throw new Error('Invalid args')

    if (originator === this.deps.adminOriginator) {
      return { args }
    }

    switch (method) {
      case 'listOutputs':
        await this.promptOnceForAccess(originator, 'listOutputs')
        break
      case 'listActions':
        // Adversarial-review finding (3): same once-per-session gate as
        // listOutputs. Reaching this handler at all depends on the calling
        // action carrying a 'p mandala ...' label — see MANDALA_ACTION_LABEL's
        // doc above.
        await this.promptOnceForAccess(originator, 'listActions')
        break
      case 'relinquishOutput':
        await this.promptForRelinquish(args as MandalaRelinquishOutputArgsLike, originator)
        break
      case 'createAction':
        await this.promptForSpend(args as MandalaCreateActionArgsLike, originator)
        break
      case 'internalizeAction':
        await this.promptForCredit(args as MandalaInternalizeActionArgsLike, originator)
        break
      case 'createSignature':
        await this.authorizeSignature(args, originator)
        break
      default:
        if (REFUSED_KEY_METHODS.has(method)) {
          throw new Error(`Mandala token keys cannot be used for ${method}`)
        }
        // getPublicKey/verifySignature, and any method a future manager
        // version routes here, pass through.
        break
    }

    return { args }
  }

  /**
   * After an approved `createAction` (`onRequest` threw otherwise), remembers
   * the input sighashes of the transaction the wallet built, so the app's
   * `createSignature` calls for exactly that transaction need no second
   * prompt. A response that cannot be hashed is passed on unchanged and
   * simply leaves those signatures to `authorizeSignature`'s own prompt.
   */
  async onResponse(res: unknown, context: { method: string; originator: string }): Promise<unknown> {
    if (context.method !== 'createAction' || context.originator === this.deps.adminOriginator) return res
    const tx = (res as { signableTransaction?: { tx?: number[] | Uint8Array } } | null)?.signableTransaction?.tx
    if (tx === undefined) return res
    let digests: Set<string>
    try {
      digests = authorizedSighashes(tx)
    } catch {
      return res
    }
    const live = this.liveAuthorizedTransactions(context.originator)
    live.push({ digests, timestamp: Date.now() })
    this.authorizedTransactions.set(context.originator, live.slice(-MAX_AUTHORIZED_TRANSACTIONS_PER_ORIGINATOR))
    return res
  }

  /**
   * `createSignature` under the token protocol from a connected app. Signing
   * an input of a transaction the user just approved goes ahead; anything
   * else (an unrouted createAction, an expired approval, a digest that is not
   * one of that transaction's) is asked about on its own. The prompt never
   * grants a session: one approval is one signature.
   */
  private async authorizeSignature(args: object, originator: string): Promise<void> {
    const digest = signedDigestHex(args)
    if (digest === undefined) throw new Error('Invalid createSignature args')
    if (this.liveAuthorizedTransactions(originator).some(t => t.digests.has(digest))) return
    const approved = await this.deps.requestTokenAccess(originator, JSON.stringify({ type: 'mandala_signature' }))
    if (!approved) {
      throw new Error('User denied permission to sign with a Mandala token key')
    }
  }

  /** listOutputs / listActions — once per 60s session, like BTMS's promptForBTMSAccess. */
  private async promptOnceForAccess(originator: string, action: 'listOutputs' | 'listActions'): Promise<void> {
    if (this.hasSessionAuthorization(originator)) return

    const message = JSON.stringify({ type: 'mandala_access', action })
    const approved = await this.deps.requestTokenAccess(originator, message)
    if (!approved) {
      throw new Error('User denied permission to access Mandala tokens')
    }
    this.grantSessionAuthorization(originator)
  }

  /**
   * Adversarial-review finding (5): relinquishOutput is its own
   * authorization class. It is never satisfied by an existing
   * spend/credit/access session (no `hasSessionAuthorization` check), and it
   * never grants one either (no `grantSessionAuthorization` call) — removing
   * a holding from the wallet is consequential enough that every call must
   * show its own prompt, and approving it must not silently unlock
   * listOutputs/listActions for the rest of the session window.
   *
   * XR-041: the prompt used to say only "wants to remove a Mandala token
   * holding from your wallet" — never which one, or how much. `args.output`
   * is resolved against this device's OWN current listing (never trusted
   * from the caller) into `{assetId, amount}` before anything is shown, and
   * an unresolved target fails the whole call closed — a consequential,
   * irreversible-feeling removal must never be approved uninformed.
   */
  private async promptForRelinquish(args: MandalaRelinquishOutputArgsLike, originator: string): Promise<void> {
    const outpoint = typeof args?.output === 'string' ? args.output : undefined
    let resolved: DecodedMandalaOutput | null = null
    if (outpoint) {
      try {
        resolved = await this.deps.resolveMandalaOutput(outpoint)
      } catch {
        resolved = null
      }
    }
    if (!resolved) {
      throw new Error('Could not identify the Mandala holding to be removed')
    }
    const { tokenName, decimals } = await this.resolveAssetDisplay(resolved.assetId)
    const message = JSON.stringify({
      type: 'mandala_access',
      action: 'relinquishOutput',
      assetId: resolved.assetId,
      tokenName,
      amount: resolved.amount,
      display: formatTokenAmount(resolved.amount, decimals, tokenName, resolved.assetId),
      outpoint
    })
    const approved = await this.deps.requestTokenAccess(originator, message)
    if (!approved) {
      throw new Error('User denied permission to access Mandala tokens')
    }
  }

  /**
   * createAction with an output in `'p mandala'` — always prompts (mirrors
   * BTMS's `handleCreateAction`, which never skips on an existing session;
   * only the access checks above do that), then refreshes the session so a
   * following listOutputs/listActions within the window does not re-prompt.
   *
   * Adversarial-review finding (2): also gates on INPUTS. Basket-routing
   * only ever reaches this method via a `'p mandala'`-basketed/decodable
   * OUTPUT (see `extractOutputAmountsByAsset`) or the `MANDALA_ACTION_LABEL`
   * the `wrapCreateActionForTokenInputs` wrapper injects — a spend with no
   * such output (e.g. a full-balance spend with no change) could otherwise
   * decode to zero here even once routed. `anyInputIsTokenCoin` is a second,
   * independent signal so this method still emits a `'mandala_spend'`
   * prompt (never the fully-generic fallback) whenever any input is a known
   * token coin, even if no output tells us how much.
   */
  private async promptForSpend(args: MandalaCreateActionArgsLike, originator: string): Promise<void> {
    const totals = this.extractOutputAmountsByAsset(args?.outputs)

    if (totals.size === 0 && !(await this.anyInputIsTokenCoin(args?.inputs))) {
      // Nothing decodable (every output failed to decode, or none present)
      // and no input is a known token coin either — fall back to a generic
      // prompt rather than guessing. Mirrors BasicTokenModule's
      // promptForGenericAuthorization fallback.
      await this.promptGeneric(originator, 'spend')
      return
    }

    const lines = await this.buildSpendLines(totals)
    // Back-compat top-level fields mirror the FIRST/primary asset (today's
    // single-asset behavior, unchanged); `lines` carries the full,
    // decimal-formatted, one-entry-per-asset breakdown (finding 4).
    // `JSON.stringify` drops `undefined` values, so an empty `lines` array
    // (token-input-only, nothing decodable) naturally omits them.
    const primary = lines[0]
    const message = JSON.stringify({
      type: 'mandala_spend',
      sendAmount: primary?.sendAmount,
      changeAmount: primary?.changeAmount,
      assetId: primary?.assetId,
      tokenName: primary?.tokenName,
      lines
    })
    const approved = await this.deps.requestTokenAccess(originator, message)
    if (!approved) {
      // Exact BTMS wording (spec §8.6): denial "throws the same shape as
      // BTMS ('User denied permission to spend tokens')".
      throw new Error('User denied permission to spend tokens')
    }
    this.grantSessionAuthorization(originator)
  }

  /** internalizeAction inserting into `'p mandala'` — an app crediting ITSELF. */
  private async promptForCredit(args: MandalaInternalizeActionArgsLike, originator: string): Promise<void> {
    const insertions = (args?.outputs ?? []).filter(
      o => o?.protocol === 'basket insertion' && o?.insertionRemittance?.basket === MANDALA_BASKET
    )

    const totals = new Map<string, number>()
    if (insertions.length > 0 && args?.tx) {
      try {
        const tx = Transaction.fromAtomicBEEF(args.tx)
        for (const insertion of insertions) {
          const output = tx.outputs[insertion.outputIndex]
          const decoded = output?.lockingScript ? tryDecodeMandalaOutput(output.lockingScript.toHex()) : null
          if (decoded) {
            totals.set(decoded.assetId, (totals.get(decoded.assetId) ?? 0) + decoded.amount)
          }
        }
      } catch {
        // Unparseable AtomicBEEF -- fall through to the zero-amount branch
        // below rather than throw; a decode failure is never fatal here.
      }
    }

    if (totals.size === 0) {
      await this.promptGeneric(originator, 'credit')
      return
    }

    const lines = await this.buildCreditLines(totals)
    const primary = lines[0]
    const message = JSON.stringify({
      type: 'mandala_credit',
      creditAmount: primary?.creditAmount,
      assetId: primary?.assetId,
      tokenName: primary?.tokenName,
      lines
    })
    const approved = await this.deps.requestTokenAccess(originator, message)
    if (!approved) {
      throw new Error('User denied permission to credit Mandala tokens')
    }
    this.grantSessionAuthorization(originator)
  }

  private async promptGeneric(originator: string, context: 'spend' | 'credit'): Promise<void> {
    const message = JSON.stringify({ type: 'mandala_generic', context })
    const approved = await this.deps.requestTokenAccess(originator, message)
    if (!approved) {
      throw new Error('User denied permission to spend Mandala tokens')
    }
    this.grantSessionAuthorization(originator)
  }

  /**
   * Sums send vs. change over every Mandala-decodable output, GROUPED BY
   * assetId (adversarial-review finding 4 — a createAction touching more
   * than one asset previously collapsed every asset's amounts into one
   * running total under whichever assetId was seen first). An output that
   * carries the `'p mandala'` basket is change (stays with us) unless the lib
   * marks it as the payment (a send to yourself); one that does not is the
   * recipient's (Mandala payer outputs are otherwise never basketed).
   * A script that fails to decode is silently skipped, not fatal —
   * `tryDecodeMandalaOutput` never throws.
   */
  private extractOutputAmountsByAsset(
    outputs: MandalaCreateActionOutputLike[] | undefined
  ): Map<string, { sendAmount: number; changeAmount: number }> {
    const totals = new Map<string, { sendAmount: number; changeAmount: number }>()

    for (const output of outputs ?? []) {
      const decoded = tryDecodeMandalaOutput(output?.lockingScript)
      if (!decoded) continue
      const entry = totals.get(decoded.assetId) ?? { sendAmount: 0, changeAmount: 0 }
      // An app can only make the prompt show more as sent this way, never less:
      // an output outside the basket always counts as sent.
      if (output.basket === MANDALA_BASKET && !isMarkedSent(output)) {
        entry.changeAmount += decoded.amount
      } else {
        entry.sendAmount += decoded.amount
      }
      totals.set(decoded.assetId, entry)
    }

    return totals
  }

  /**
   * Adversarial-review finding (2): resolves each input outpoint against
   * `deps.listTokenOutpoints()` (the admin-originator wallet's own
   * `'p mandala'`-basket listing) and reports whether any of them is a
   * token coin this wallet holds. A throwing/failing `listTokenOutpoints`
   * is treated as "no token inputs found" — this is a pure ADD-a-prompt
   * signal on top of the output-side checks, so failing open here never
   * removes a prompt the output side would otherwise have shown.
   */
  private async anyInputIsTokenCoin(inputs: MandalaCreateActionInputLike[] | undefined): Promise<boolean> {
    if (!inputs || inputs.length === 0) return false
    let tokenOutpoints: Set<string>
    try {
      tokenOutpoints = await this.deps.listTokenOutpoints()
    } catch {
      return false
    }
    return inputs.some(input => {
      const outpoint = canonicalOutpoint(input?.outpoint)
      return outpoint !== undefined && tokenOutpoints.has(outpoint)
    })
  }

  private async buildSpendLines(
    totals: Map<string, { sendAmount: number; changeAmount: number }>
  ): Promise<MandalaSpendLine[]> {
    const lines: MandalaSpendLine[] = []
    for (const [assetId, { sendAmount, changeAmount }] of totals) {
      const { tokenName, decimals } = await this.resolveAssetDisplay(assetId)
      lines.push({
        assetId,
        sendAmount,
        changeAmount,
        tokenName,
        decimals,
        display: formatTokenAmount(sendAmount, decimals, tokenName, assetId)
      })
    }
    return lines
  }

  private async buildCreditLines(totals: Map<string, number>): Promise<MandalaCreditLine[]> {
    const lines: MandalaCreditLine[] = []
    for (const [assetId, creditAmount] of totals) {
      const { tokenName, decimals } = await this.resolveAssetDisplay(assetId)
      lines.push({
        assetId,
        creditAmount,
        tokenName,
        decimals,
        display: formatTokenAmount(creditAmount, decimals, tokenName, assetId)
      })
    }
    return lines
  }

  private async resolveAssetDisplay(assetId: string | undefined): Promise<{ tokenName?: string; decimals?: number }> {
    if (!assetId) return {}
    try {
      const meta = await this.deps.resolveAssetMetadata(assetId)
      return {
        tokenName: meta?.ticker || meta?.label || undefined,
        decimals: typeof meta?.decimals === 'number' ? meta.decimals : undefined
      }
    } catch {
      // resolveAssetMetadata is caller-injected and may be a stub or may
      // fail (network, missing registry entry) — never let that block or
      // fail a permission prompt; the assetId alone is still shown.
      return {}
    }
  }
}

/**
 * Adversarial-review finding (2), second half: `WalletPermissionsManager`
 * only ever routes a `createAction` call through a P-module when the call's
 * OUTPUTS or LABELS name a `'p '`-scheme (`collectNonPBaskets`/
 * `splitLabelsByPermissionModule`, confirmed against
 * `@bsv/wallet-toolbox-client`'s `WalletPermissionsManager.js`) — INPUTS are
 * never scanned. A createAction that spends `'p mandala'` inputs with no
 * basketed/decodable Mandala output (e.g. a full-balance spend with no
 * change) therefore never reaches `MandalaTokenModule.onRequest` at all, no
 * matter what that method does internally.
 *
 * This wraps the PUBLISHED `WalletPermissionsManager` (or anything
 * shaped like it) so that a `createAction` call whose inputs reference a
 * known `'p mandala'` outpoint gets `MANDALA_ACTION_LABEL` injected into its
 * `labels` BEFORE the manager's own routing decision runs — which makes the
 * manager's label-routing pick up the module exactly as if the caller had
 * labeled the action itself (see `MANDALA_ACTION_LABEL`'s doc). Every other
 * method/property passes through untouched. `adminOriginator` calls are
 * short-circuited with zero work: the module already grants those a
 * zero-prompt pass-through unconditionally (see the class doc), so injecting
 * the label there would only add a `listTokenOutpoints()` round-trip to
 * EVERY admin createAction call — including the app's own everyday,
 * non-Mandala spends — for no gating benefit at all.
 *
 * WIRING: desktop wraps the raw manager in
 * `PermissionQueueManager.createPermissionsManager` before exposing it to
 * app callers. Every future manager entry point must apply this wrapper too,
 * or full-balance token spends can miss P-module routing.
 */
export function wrapCreateActionForTokenInputs<
  T extends { createAction: (args: any, originator: string) => Promise<unknown> }
>(manager: T, listTokenOutpoints: () => Promise<Set<string>>, adminOriginator?: string): T {
  return new Proxy(manager, {
    get(target, prop, receiver) {
      if (prop === 'createAction') {
        return async (args: MandalaCreateActionArgsLike & { labels?: string[] }, originator: string) => {
          const routedArgs =
            originator === adminOriginator
              ? args
              : await injectMandalaLabelIfTokenInputsPresent(args, listTokenOutpoints)
          return target.createAction(routedArgs, originator)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  }) as T
}

async function injectMandalaLabelIfTokenInputsPresent(
  args: MandalaCreateActionArgsLike & { labels?: string[] },
  listTokenOutpoints: () => Promise<Set<string>>
): Promise<MandalaCreateActionArgsLike & { labels?: string[] }> {
  const inputs = args?.inputs
  if (!Array.isArray(inputs) || inputs.length === 0) return args

  const labels = Array.isArray(args.labels) ? args.labels : []
  if (labels.includes(MANDALA_ACTION_LABEL)) return args

  let tokenOutpoints: Set<string>
  try {
    tokenOutpoints = await listTokenOutpoints()
  } catch {
    // XR-039: forwarding `args` UNCHANGED here is how a full-balance (no
    // basketed change) Mandala spend hit by a transient listing fault used to
    // reach the manager's generic, no-token-amount-awareness review instead
    // of this module's own. `MANDALA_ACTION_LABEL` is the ONLY thing that
    // routes an input-only Mandala spend to `MandalaTokenModule.onRequest` at
    // all — with no reliable read on whether these inputs spend a token coin,
    // fail closed and force it, same as a confirmed match below. Worst case
    // (a plain, non-Mandala action) still resolves to `promptForSpend`'s own
    // generic fallback, which is a real, interactive approval — never a
    // silent one.
    return { ...args, labels: [...labels, MANDALA_ACTION_LABEL] }
  }

  const spendsTokenInput = inputs.some(input => {
    const outpoint = canonicalOutpoint(input?.outpoint)
    return outpoint !== undefined && tokenOutpoints.has(outpoint)
  })
  if (!spendsTokenInput) return args
  return { ...args, labels: [...labels, MANDALA_ACTION_LABEL] }
}
