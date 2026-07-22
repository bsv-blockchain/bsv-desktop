/**
 * DstasTransferService — DSTAS transfer via createAction + signAction.
 *
 * Same architectural shape as StasTransferService: wallet-toolbox owns
 * the tx assembly + funding via createAction; the DSTAS input is signed
 * externally via wallet.createSignature (BRC-42) and the unlocking script
 * is hand-assembled to match the SDK's expected DSTAS witness format
 * (mirror of dxs-bsv-token-sdk's input-builder.ts:91-178 — see
 * buildDstasUnlockingScript.ts for the spec).
 *
 * Output layout (per DSTAS_SCRIPT_INVARIANTS.md §1 — Transfer):
 *   vout 0 = new DSTAS to recipient (spending-type=1, 1-to-1)
 *   vout 1 = BSV change back to funder
 *
 * Funding fragmentation suppressed the same way StasTransferService does
 * (lower default basket's numberOfDesiredUTXOs to 0 around the call,
 * restore on every exit path) — via the ACTIVE storage provider (see
 * walletChangeParams) so it works on remote storage too.
 *
 * Signing:
 *   - DSTAS input (our outpoint): externally via wallet.createSignature
 *     with the BRC-42 derivation that owns the DSTAS — same protocolID
 *     as classic STAS, since the receive namespace is shared.
 *   - BSV input (wallet-owned): the wallet signs it internally during
 *     signAction.
 */

import type { WalletInterface } from '@bsv/sdk'
import { Beef, Transaction } from '@bsv/sdk'
import { fromHex, toHex } from 'dxs-bsv-token-sdk/bsv'
// Leaf-module imports for SDK builders. We use namespace-import on each
// because Rollup's CJS plugin can't see names forwarded through
// __exportStar in the `/bsv` aggregator (same reason dstasParser.ts
// does this for LockingScriptReader). Each path is whitelisted in
// vendor/dxs-bsv-token-sdk/package.json's `exports` field.
import * as DstasLockingBuilderModule from 'dxs-bsv-token-sdk/script/build/dstas-locking-builder'
const { buildDstasLockingScript } = DstasLockingBuilderModule
import { STAS_PROTOCOL_ID, STAS_COUNTERPARTY } from '../../stas/constants'
import { DSTAS_BASKET } from '../../../constants/baskets'
import { parseDstasLockingScript } from '../../stas/dstasParser'
import { buildChainedAtomicBeef } from '../../stas/buildChainedAtomicBeef'
import { StasRegistration } from '../../stas/StasRegistration'
import { createTokenFundingOutput } from '../twoTx/fundingOutput'
import { deriveSelfBrc29P2pkh } from '../twoTx/brc29Address'
import { signP2pkhInput } from '../twoTx/p2pkhInput'
import { broadcastAndInternalizeChange } from '../twoTx/internalizeChange'
import { buildDstasUnlockingScript, DSTAS_SIGHASH_TYPE } from './buildDstasUnlockingScript'
import { tokenLog } from '../tokenLog'

/**
 * Dynamic bsv-js import — same pattern StasTransferService uses.
 * `createRequire('module')` doesn't work in the Vite browser bundle;
 * `await import('bsv')` does, and Vite pre-bundles bsv via optimizeDeps.
 */
async function loadBsvJs(): Promise<any> {
  const mod: any = await import('bsv')
  return mod.default ?? mod
}

const ORIGINATOR = 'admin.dstas-transfer'
const SIGHASH = DSTAS_SIGHASH_TYPE // 0x41 — ALL | FORKID

export interface DstasTransferArgs {
  source: {
    txid: string
    vout: number
    scriptHex: string
    satoshis: number
    brc42KeyId: string
    /**
     * Optional owner-key derivation override for signing the DSTAS input.
     * Defaults to the self-owned scheme (STAS_PROTOCOL_ID, keyID
     * `brc42KeyId`, counterparty 'self'). A token received over a peer
     * channel (BRC-29) is owned under a derivation keyed to the SENDER, so
     * re-spending it requires `keyID = "<prefix> <suffix>"` and
     * `counterparty = senderIdentityKey`. Backward compatible.
     */
    owner?: {
      protocolID?: [number, string]
      keyID: string
      counterparty: string
      /** True for a BRC-29-received token: derive the recipient's OWN key. */
      forSelf?: boolean
    }
  }
  recipientAddress: string
  /**
   * Token amount (satoshis) to send. Defaults to the full `source.satoshis`.
   * When less, the service SPLITS: recipient DSTAS output of `amount` + a
   * sender token-change DSTAS output of the remainder (to `senderChangeHash160`).
   */
  amount?: number
  /** Owner pkh (hex) for the sender's token-change DSTAS output (partial sends). */
  senderChangeHash160?: string
  /** BRC-42 keyId of the sender's change receive key (for createAction tracking). */
  senderChangeKeyId?: string
  /** Token id for the change output's customInstructions. */
  tokenId?: string
}

export interface DstasTransferResult {
  ok: boolean
  txid?: string
  reason?: string
  /** Signed AtomicBEEF of the transfer (from signAction) — for peer delivery. */
  beef?: number[]
}

export class DstasTransferService {
  constructor(
    private readonly wallet: WalletInterface,
    private readonly identityKey: string,
    private readonly chain: 'main' | 'test'
  ) {}

  async transfer(args: DstasTransferArgs): Promise<DstasTransferResult> {
    const { source, recipientAddress } = args

    let bsvJs: any
    try {
      bsvJs = await loadBsvJs()
    } catch (err) {
      return { ok: false, reason: `load bsv-js failed: ${errMsg(err)}` }
    }

    // 1. Parse + validate the source. parseDstasLockingScript returns
    //    null for non-DSTAS scripts, surfaces frozen state via the
    //    action-data marker. We reject frozen UTXOs here (per
    //    DSTAS_SCRIPT_INVARIANTS.md — frozen STAS can't be spent under
    //    spendingType=1; freeze flow is its own surface).
    const parsed = parseDstasLockingScript(source.scriptHex)
    if (!parsed) {
      return {
        ok: false,
        reason: `source.scriptHex doesn't parse as DSTAS — prefix "${source.scriptHex.slice(0, 24)}…"`,
      }
    }
    if (parsed.frozen) {
      return {
        ok: false,
        reason: 'source DSTAS UTXO is frozen — cannot transfer under spendingType=1',
      }
    }

    // 2. Owner pubkey via BRC-42 derivation. DSTAS shares STAS's
    //    receive namespace (see StasKeyDeriver) so the protocolID is
    //    the same.
    // Effective owner-key derivation. Defaults to the self-owned scheme; a
    // BRC-29 peer-received token overrides keyID + counterparty so it stays
    // spendable.
    const ownerDerivation = {
      protocolID: (source.owner?.protocolID ?? STAS_PROTOCOL_ID) as any,
      keyID: source.owner?.keyID ?? source.brc42KeyId,
      counterparty: (source.owner?.counterparty ?? STAS_COUNTERPARTY) as any,
      forSelf: source.owner?.forSelf === true,
    }

    let ownerPubKeyHex: string
    try {
      const { publicKey } = await this.wallet.getPublicKey(
        {
          protocolID: ownerDerivation.protocolID,
          keyID: ownerDerivation.keyID,
          counterparty: ownerDerivation.counterparty,
          forSelf: ownerDerivation.forSelf,
        } as any,
        ORIGINATOR
      )
      ownerPubKeyHex = publicKey
    } catch (err) {
      return { ok: false, reason: `getPublicKey: ${errMsg(err)}` }
    }

    // 3. Recipient hash160 (bsv-js parses base58check + extracts).
    let recipientPkhHex: string
    try {
      const addr = bsvJs.Address.fromString(recipientAddress, 'livenet')
      recipientPkhHex = addr.hashBuffer.toString('hex')
    } catch (err) {
      return { ok: false, reason: `invalid recipient: ${errMsg(err)}` }
    }

    // 4. Build the new DSTAS output locking script via the SDK's pure
    //    builder. ownerPkh = recipient's hash160. Everything else
    //    propagates from the source (redemptionPkh, flags,
    //    serviceFields, optionalData byte-exact per §7 invariant).
    //    Fresh transfer → actionData: null, frozen: false.
    // Resolve send amount vs. token change (SPLIT). Full-value keeps the
    // single-output path; partial adds a sender token-change DSTAS output.
    const sendAmt = args.amount ?? source.satoshis
    const changeAmt = source.satoshis - sendAmt
    if (!Number.isInteger(sendAmt) || sendAmt < 1 || changeAmt < 0) {
      return { ok: false, reason: `invalid amount ${sendAmt} (must be 1..${source.satoshis})` }
    }
    if (changeAmt > 0 && !args.senderChangeHash160) {
      return { ok: false, reason: 'partial DSTAS transfer requires senderChangeHash160' }
    }

    let newDstasScriptHex: string
    let changeDstasScriptHex: string | null = null
    try {
      const flagsBytes = fromHex(parsed.flagsHex || '00')
      const serviceFields = parsed.serviceFields.map((s) => fromHex(s))
      const optionalData = parsed.optionalData.map((s) => fromHex(s))
      const buildFor = (ownerPkhHex: string) => toHex(buildDstasLockingScript({
        ownerPkh: fromHex(ownerPkhHex),
        redemptionPkh: fromHex(parsed.tokenId),
        flags: flagsBytes,
        serviceFields,
        optionalData,
        actionData: null,
        frozen: false,
      }))
      newDstasScriptHex = buildFor(recipientPkhHex)
      if (changeAmt > 0 && args.senderChangeHash160) {
        changeDstasScriptHex = buildFor(args.senderChangeHash160)
      }
    } catch (err) {
      return { ok: false, reason: `build new DSTAS locking script: ${errMsg(err)}` }
    }

    // ===== Storage-agnostic 2-tx transfer (mirrors StasTransferService) =======
    // TX1 creates a dedicated self-owned funding output; TX2 spends
    // [token, funding] → [recipient, (token-change), one explicit BSV change],
    // signing both inputs client-side. No auto-funding ⇒ no server-side change
    // fragmentation ⇒ works on local AND remote storage.

    // 5. Token input ancestry BEEF (for TX2 SPV).
    let tokenBeef: number[]
    try {
      const built = await buildChainedAtomicBeef({ wallet: this.wallet, txid: source.txid })
      tokenBeef = built.beef
    } catch (err) {
      return { ok: false, reason: `inputBEEF assembly: ${errMsg(err)}` }
    }

    // 6. Self-owned BRC-29 address for TX2's single BSV change output.
    let changeDeriv: { scriptHex: string; pkhHex: string; derivationPrefix: string; derivationSuffix: string }
    try {
      changeDeriv = await deriveSelfBrc29P2pkh({ wallet: this.wallet, chain: this.chain, originator: ORIGINATOR })
    } catch (err) {
      return { ok: false, reason: `change derivation: ${errMsg(err)}` }
    }

    // 7. TX1: funding output sized to TX2's fee (over-estimate; the single
    //    change output absorbs the remainder so the fee is never underpaid).
    const FEE_RATE = 1 // sat/byte
    const estTx2Size =
      5500 /* DSTAS unlock */ + 120 /* P2PKH unlock */ + 200 /* overhead */ +
      Math.ceil(newDstasScriptHex.length / 2) +
      (changeDstasScriptHex ? Math.ceil(changeDstasScriptHex.length / 2) : 0) +
      34 /* change output */
    const tx2Fee = Math.ceil(estTx2Size * FEE_RATE)
    const fundingSats = tx2Fee + 500
    let funding: Awaited<ReturnType<typeof createTokenFundingOutput>>
    try {
      funding = await createTokenFundingOutput({
        wallet: this.wallet, chain: this.chain, satoshis: fundingSats,
        originator: ORIGINATOR, description: 'DSTAS transfer funding',
      })
    } catch (err) {
      return { ok: false, reason: `TX1 funding: ${errMsg(err)}` }
    }
    const changeValue = funding.satoshis - tx2Fee
    if (changeValue < 1) {
      return { ok: false, reason: `funding ${funding.satoshis} below estimated fee ${tx2Fee}` }
    }

    // 8. Assemble TX2: [token(0), funding(1)] → [recipient(0), (token-change), change].
    let tx: any
    try {
      tx = new bsvJs.Transaction()
      tx.from({ txId: source.txid, outputIndex: source.vout, script: source.scriptHex, satoshis: source.satoshis })
      tx.from({ txId: funding.txid, outputIndex: funding.vout, script: funding.scriptHex, satoshis: funding.satoshis })
      tx.addOutput(new bsvJs.Transaction.Output({ script: bsvJs.Script.fromHex(newDstasScriptHex), satoshis: sendAmt }))
      if (changeDstasScriptHex != null) {
        tx.addOutput(new bsvJs.Transaction.Output({ script: bsvJs.Script.fromHex(changeDstasScriptHex), satoshis: changeAmt }))
      }
      tx.addOutput(new bsvJs.Transaction.Output({ script: bsvJs.Script.fromHex(changeDeriv.scriptHex), satoshis: changeValue }))
      // Attach prev-outputs so bsv-js can compute the BIP143 sighash preimages.
      tx.inputs[0].output = new bsvJs.Transaction.Output({ script: bsvJs.Script.fromHex(source.scriptHex), satoshis: source.satoshis })
      tx.inputs[1].output = new bsvJs.Transaction.Output({ script: bsvJs.Script.fromHex(funding.scriptHex), satoshis: funding.satoshis })
    } catch (err) {
      return { ok: false, reason: `TX2 assembly: ${errMsg(err)}` }
    }
    const fundingInputIdx = 1
    const changeVout = tx.outputs.length - 1

    tokenLog.debug(`[dstas-transfer] TX2 inputs=2 (DSTAS 0, funding 1), outputs=${tx.outputs.length}, change=${changeValue}, fee≈${tx2Fee}`)

    // 9. Sighash + signature for the DSTAS input (index 0).
    let sigDer: Uint8Array
    let preimage: Uint8Array
    try {
      const sourceLocking = bsvJs.Script.fromHex(source.scriptHex)
      const satsBN = new bsvJs.crypto.BN(source.satoshis)
      const preimageBuf: Buffer = bsvJs.Transaction.sighash.sighashPreimage(tx, SIGHASH, 0, sourceLocking, satsBN)
      preimage = new Uint8Array(preimageBuf)
      const digestBytes = Array.from(bsvJs.crypto.Hash.sha256sha256(preimageBuf) as Buffer) as number[]
      const sigRes = await this.wallet.createSignature(
        {
          protocolID: ownerDerivation.protocolID,
          keyID: ownerDerivation.keyID,
          counterparty: ownerDerivation.counterparty,
          hashToDirectlySign: digestBytes,
        } as any,
        ORIGINATOR
      )
      sigDer = new Uint8Array(sigRes.signature)
    } catch (err) {
      return { ok: false, reason: `sighash/sign token input: ${errMsg(err)}` }
    }

    // 10. DSTAS unlocking script for input 0 (walks tx outputs + funding outpoint).
    try {
      const unlockingScriptHex = buildDstasUnlockingScript({
        unsignedTx: tx,
        inputIdx: 0,
        fundingInputIdx,
        preimage,
        signatureDer: sigDer,
        publicKey: new Uint8Array(Buffer.from(ownerPubKeyHex, 'hex')),
        spendingType: 1,
      })
      tx.inputs[0].setScript(bsvJs.Script.fromHex(unlockingScriptHex))
    } catch (err) {
      return { ok: false, reason: `assemble DSTAS unlocking script: ${errMsg(err)}` }
    }

    // 11. Sign the funding input (P2PKH) via the two-tx helper.
    try {
      const fundingUnlock = await signP2pkhInput({
        wallet: this.wallet, bsv: bsvJs, tx, inputIndex: 1,
        derivationPrefix: funding.derivationPrefix, derivationSuffix: funding.derivationSuffix,
        sourceScriptHex: funding.scriptHex, sourceSatoshis: funding.satoshis,
        sighashType: SIGHASH, originator: ORIGINATOR,
      })
      tx.inputs[1].setScript(bsvJs.Script.fromHex(fundingUnlock))
    } catch (err) {
      return { ok: false, reason: `sign funding input: ${errMsg(err)}` }
    }

    // 12. Assemble TX2 AtomicBEEF: token ancestry + TX1's own BEEF (from
    //     createAction — it already carries TX1's full ancestry incl. any
    //     unconfirmed txs WoC can't re-serve) + TX2. Use mergeTransaction + the
    //     SDK-computed txid so toBinaryAtomic sets atomicTxid correctly (bsv-js
    //     tx.id can differ, which made validateAtomicBeef reject it).
    let tx2Txid = ''
    let tx2AtomicBeef: number[]
    try {
      const beef = Beef.fromBinary(tokenBeef)
      beef.mergeBeef(Beef.fromBinary(funding.beef))
      const sdkTx2 = Transaction.fromHex(tx.toString())
      beef.mergeTransaction(sdkTx2)
      tx2Txid = sdkTx2.id('hex')
      tx2AtomicBeef = beef.toBinaryAtomic(tx2Txid)
    } catch (err) {
      return { ok: false, reason: `TX2 BEEF assembly: ${errMsg(err)}` }
    }

    // 13. Broadcast TX2 + internalize the sender's BSV change (wallet payment).
    try {
      const r = await broadcastAndInternalizeChange({
        wallet: this.wallet, atomicBeef: tx2AtomicBeef, changeVout,
        derivationPrefix: changeDeriv.derivationPrefix, derivationSuffix: changeDeriv.derivationSuffix,
        originator: ORIGINATOR, description: 'DSTAS transfer', labels: ['peertoken'],
      })
      if (!r.accepted) {
        return { ok: false, reason: 'TX2 broadcast/internalize not accepted by the wallet' }
      }
    } catch (err) {
      return { ok: false, reason: `TX2 broadcast: ${errMsg(err)}` }
    }

    const wocBase = this.chain === 'main' ? 'https://whatsonchain.com/tx/' : 'https://test.whatsonchain.com/tx/'
    tokenLog.info(`[dstas-transfer] BROADCAST ✓ txid: ${tx2Txid}  ${wocBase}${tx2Txid}`)

    // 14. Register the sender's token-change (partial sends) as a basket insertion.
    if (changeDstasScriptHex != null && args.senderChangeHash160) {
      try {
        const parsedChange = parseDstasLockingScript(source.scriptHex)
        const r = await new StasRegistration(this.wallet, this.identityKey, this.chain).register({
          txid: tx2Txid,
          vout: 1,
          tokenSatoshis: changeAmt,
          ownerFieldHash160: args.senderChangeHash160,
          brc42KeyId: args.senderChangeKeyId ?? source.brc42KeyId,
          parsed: {
            ...(parsedChange ?? {}),
            ownerFieldHash160: args.senderChangeHash160,
            tokenId: args.tokenId ?? '',
          } as any,
          protocol: { id: 'dstas', basketName: DSTAS_BASKET },
          atomicBeef: tx2AtomicBeef,
        } as any)
        if (!r.registered && r.reason !== 'already registered') {
          tokenLog.warn(`[dstas-transfer] token-change NOT registered: ${r.reason} (scan will recover)`)
        }
      } catch (err) {
        tokenLog.warn(`[dstas-transfer] token-change registration threw: ${errMsg(err)} (scan will recover)`)
      }
    }

    return { ok: true, txid: tx2Txid, beef: tx2AtomicBeef }
  }
}

/**
 * Apply the unlocking script to tx.inputs[0] and run the SDK's
 * evaluator. Returns `{ success, reason? }`. The evaluator wants the
 * source's prev-output supplied via a resolver callback so it can look
 * up the locking script and satoshis during script execution.
 *
 * Imported via the leaf-module path (whitelisted in the SDK's exports)
 * to bypass Rollup's __exportStar blindness — same pattern dstasParser
 * uses for LockingScriptReader.
 */
async function evaluateDstasInputZero(args: {
  tx: any
  sourceScriptHex: string
  sourceSatoshis: number
  unlockingScriptHex: string
}): Promise<{ success: boolean; reason?: string; fullResult?: any }> {
  let evaluateTransactionHex: any
  try {
    const evalMod: any = await import(
      'dxs-bsv-token-sdk/script/eval/script-evaluator'
    )
    evaluateTransactionHex = evalMod.evaluateTransactionHex
  } catch {
    /* fall through to no-op */
  }
  if (typeof evaluateTransactionHex !== 'function') {
    return { success: true, reason: 'evaluator unavailable in this environment' }
  }
  try {
    args.tx.inputs[0].setScript(args.unlockingScriptHex)
    const txHex: string = args.tx.toString()
    const result = evaluateTransactionHex(txHex, (txid: string, vout: number) => {
      const sourcePrevTxIdHex: string =
        typeof args.tx.inputs[0].prevTxId === 'string'
          ? args.tx.inputs[0].prevTxId
          : Buffer.from(args.tx.inputs[0].prevTxId).toString('hex')
      if (txid === sourcePrevTxIdHex && vout === args.tx.inputs[0].outputIndex) {
        return {
          LockingScript: new Uint8Array(Buffer.from(args.sourceScriptHex, 'hex')),
          Satoshis: args.sourceSatoshis,
        }
      }
      // Funding input's prev-output: we don't have it cached here, so the
      // evaluator may report a resolver miss. That's expected — we want
      // input 0's result, not the full-tx pass.
      return null
    })
    // Surface a structured summary plus the full result for the caller
    // to log. The SDK's `evaluateTransactionHex` historically returns
    // `{ success, results: InputResult[], failureReason? }`; field names
    // vary across versions so we keep `fullResult` opaque for diagnostics.
    const reason = result?.failureReason
      ?? result?.results?.find?.((r: any) => r && r.success === false)?.reason
      ?? (result?.success ? undefined : 'evaluator returned non-success (see fullResult)')
    return {
      success: !!result?.success,
      reason,
      fullResult: result,
    }
  } catch (err) {
    return { success: false, reason: errMsg(err) }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

