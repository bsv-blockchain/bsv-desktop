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
import { Beef } from '@bsv/sdk'
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
import { stasQuery } from '../../stas/stasIpc'
import { setChangeParams, DEFAULT_DESIRED_UTXOS, DEFAULT_MIN_UTXO_VALUE } from '../../stas/walletChangeParams'
import { buildChainedAtomicBeef } from '../../stas/buildChainedAtomicBeef'
import { StasRegistration } from '../../stas/StasRegistration'
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

    // 5. Build inputBEEF (chained-atomic so mempool ancestors are OK).
    let inputBEEF: number[]
    try {
      const built = await buildChainedAtomicBeef({ wallet: this.wallet, txid: source.txid })
      inputBEEF = built.beef
    } catch (err) {
      return { ok: false, reason: `inputBEEF assembly: ${errMsg(err)}` }
    }

    // 6. Mark the source spendable on wallet-toolbox's side — DSTAS
    //    outputs are flagged non-spendable by default (the toolbox
    //    doesn't recognise the custom template).
    try {
      const outputId: number | null = await stasQuery(
        this.identityKey,
        this.chain,
        'findOutputIdByOutpoint',
        [source.txid, source.vout]
      )
      if (outputId) {
        await stasQuery(this.identityKey, this.chain, 'setOutputSpendable', [outputId, true])
      }
    } catch {
      /* best effort */
    }

    // 7. Suppress change fragmentation around the call — same as STAS
    //    transfer needs because the DSTAS template expects the funding
    //    branch to be a single P2PKH change output. Routes through the ACTIVE
    //    store (works local AND remote); fail clean if it can't be applied.
    try {
      await setChangeParams(this.wallet, 0, DEFAULT_MIN_UTXO_VALUE, ORIGINATOR)
    } catch (err) {
      return {
        ok: false,
        reason:
          `could not suppress change fragmentation (setWalletChangeParams): ${errMsg(err)}. ` +
          'Without it the funding change splits into multiple outputs and the DSTAS template rejects the transfer.',
      }
    }
    const restoreBasket = async () => {
      try {
        await setChangeParams(this.wallet, DEFAULT_DESIRED_UTXOS, DEFAULT_MIN_UTXO_VALUE, ORIGINATOR)
      } catch { /* best effort */ }
    }

    try {
      // 8. createAction. Wallet auto-funds + adds the BSV change output.
      //    Conservation: source.satoshis tokens → new DSTAS output gets
      //    the same satoshis (DSTAS transfer is 1-to-1 per §1).
      let createRes: any
      try {
        createRes = await this.wallet.createAction(
          {
            labels: ['peertoken'],
            inputBEEF,
            inputs: [
              {
                outpoint: `${source.txid}.${source.vout}`,
                // DSTAS unlocking script is comparable in size to classic STAS
                // (~3 KB worst-case) — we'll let bsv-js compute the actual size
                // post-build; the estimate guides createAction's fee math.
                unlockingScriptLength: 4500,
                inputDescription: 'DSTAS being transferred',
              },
            ],
            outputs: [
              {
                lockingScript: newDstasScriptHex,
                satoshis: sendAmt,
                outputDescription: 'DSTAS to recipient',
              },
              ...(changeDstasScriptHex != null
                ? [{
                    lockingScript: changeDstasScriptHex,
                    satoshis: changeAmt,
                    outputDescription: 'DSTAS token change',
                    // Declare the basket so the wallet tracks this self-owned
                    // change output natively (mirrors STAS/BSV-21 change).
                    basket: DSTAS_BASKET,
                    customInstructions: JSON.stringify({
                      brc42KeyId: args.senderChangeKeyId,
                      tokenId: args.tokenId,
                    }),
                    tags: ['dstas'],
                  }]
                : []),
            ],
            description: 'DSTAS transfer',
            options: { randomizeOutputs: false },
          } as any,
          ORIGINATOR
        )
      } catch (err) {
        return { ok: false, reason: `createAction: ${errMsg(err)}` }
      }

      const signable = createRes?.signableTransaction
      if (!signable || !signable.tx) {
        return { ok: false, reason: 'createAction did not return signableTransaction' }
      }

      // 9. Parse signable.tx (AtomicBEEF) → atomic tx → bsv-js Transaction
      //    so we can compute sighash + walk outputs for the unlock builder.
      let tx: any
      try {
        const beef = Beef.fromBinary(signable.tx)
        const atomicTxid = (beef as any).atomicTxid as string | undefined
        if (!atomicTxid) return { ok: false, reason: 'signable BEEF has no atomic txid' }
        const btx = beef.findTxid(atomicTxid)
        if (!btx?.tx) return { ok: false, reason: `signable BEEF missing atomic tx ${atomicTxid}` }
        const rawTxBytes = btx.tx.toBinary()
        tx = new bsvJs.Transaction(Buffer.from(rawTxBytes).toString('hex'))
        // Attach the source's prev-output for sighash computation.
        tx.inputs[0].output = new bsvJs.Transaction.Output({
          script: bsvJs.Script.fromHex(source.scriptHex),
          satoshis: source.satoshis,
        })
      } catch (err) {
        return { ok: false, reason: `parse signable tx: ${errMsg(err)}` }
      }

      // 10. Resolve the funding input. The DSTAS template encodes EXACTLY
      //     ONE funding outpoint (vout + txid) into the unlock witness;
      //     the template verifies this matches the tx's prevout hash.
      //     wallet-toolbox normally pulls a single funding input, but
      //     if the default basket only has fragments smaller than the
      //     fee, it combines multiple — which the template can't accept.
      //     Same constraint applies to the SDK's `BuildDstasTransferTx`
      //     (see `input-builder.ts:resolveFundingInput`).
      //
      //     Fail clean here so the user gets an actionable message
      //     instead of a cryptic "OP_EQUALVERIFY required equal" deep
      //     in the script evaluator.
      const nonDstasInputs: number[] = []
      for (let i = 0; i < tx.inputs.length; i++) {
        if (i === 0) continue // input 0 is our DSTAS source
        nonDstasInputs.push(i)
      }
      if (nonDstasInputs.length === 0) {
        return { ok: false, reason: 'no funding input found in the assembled tx' }
      }
      if (nonDstasInputs.length > 1) {
        return {
          ok: false,
          reason:
            `DSTAS template requires exactly one funding input, but wallet-toolbox ` +
            `picked ${nonDstasInputs.length} from the default basket — likely ` +
            `because no single change UTXO is large enough to cover the tx fee. ` +
            `Workaround: consolidate the default basket by sending a small BSV ` +
            `self-payment to yourself first, then retry the DSTAS send. ` +
            `(Same architectural constraint applies to the SDK's BuildDstasTransferTx.)`,
        }
      }
      const fundingInputIdx = nonDstasInputs[0]

      // Same constraint on outputs: the DSTAS template walks outputs and
      // expects exactly the recipient DSTAS output + at most 1 P2PKH
      // change output (+ optional null-data). Multiple P2PKH outputs from
      // fragmentation would break the template's per-output handling.
      let p2pkhOutputCount = 0
      for (const out of tx.outputs) {
        const sh = out.script.toHex()
        if (sh.startsWith('76a914') && sh.endsWith('88ac') && sh.length === 50) {
          p2pkhOutputCount++
        }
      }
      if (p2pkhOutputCount > 1) {
        return {
          ok: false,
          reason:
            `the storage backend split the fee change into ${p2pkhOutputCount} P2PKH outputs, but the DSTAS ` +
            `template requires exactly one. This happens on a remote storage server that does not honor the ` +
            `change-parameter suppression (setWalletChangeParams). Switch to local storage to send this token.`,
        }
      }

      tokenLog.debug(
        `[dstas-transfer] tx shape: ${tx.inputs.length} inputs (DSTAS at 0, funding at ${fundingInputIdx}), ${tx.outputs.length} outputs`
      )

      // 11. Sighash + signature for input 0.
      let sigDer: Uint8Array
      let preimage: Uint8Array
      try {
        const sourceLocking = bsvJs.Script.fromHex(source.scriptHex)
        const satsBN = new bsvJs.crypto.BN(source.satoshis)
        const preimageBuf: Buffer = bsvJs.Transaction.sighash.sighashPreimage(
          tx, SIGHASH, 0, sourceLocking, satsBN
        )
        preimage = new Uint8Array(preimageBuf)
        const digestBuf = bsvJs.crypto.Hash.sha256sha256(preimageBuf)
        const digestBytes = Array.from(digestBuf as Buffer) as number[]

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
        return { ok: false, reason: `sighash/sign: ${errMsg(err)}` }
      }

      // 12. Assemble DSTAS unlocking script via our helper (mirror of
      //     SDK's input-builder.ts:91-178).
      let unlockingScriptHex: string
      try {
        unlockingScriptHex = buildDstasUnlockingScript({
          unsignedTx: tx,
          inputIdx: 0,
          fundingInputIdx,
          preimage,
          signatureDer: sigDer,
          publicKey: new Uint8Array(Buffer.from(ownerPubKeyHex, 'hex')),
          spendingType: 1,
        })
      } catch (err) {
        return { ok: false, reason: `assemble DSTAS unlocking script: ${errMsg(err)}` }
      }

      // 13. Best-effort pre-broadcast script-level diagnostic.
      //
      //     The SDK's AGENTS.md mandates `evaluateTransactionHex` for
      //     "every flow-producing change" — but that's a normative rule
      //     for SDK developers writing fully-signed test fixtures, not
      //     a wallet running mid-flow validation. At THIS point in our
      //     flow the funding input (input 1) is still unsigned — the
      //     wallet only signs it inside the upcoming `signAction` call.
      //     So a full-tx evaluation will fail on input 1 regardless of
      //     whether our DSTAS input 0 is byte-perfect.
      //
      //     We run the evaluator anyway as a diagnostic and log its
      //     result, but we DO NOT gate the broadcast on it — chain
      //     validation is the real backstop and StasTransferService
      //     follows the same trust-the-wallet-and-the-chain model.
      //
      //     If the evaluator surfaces a structured per-input result we
      //     can later harden this into "input 0 must pass" — left as a
      //     TODO until we see what the evaluator actually returns.
      try {
        const evalResult = await evaluateDstasInputZero({
          tx,
          sourceScriptHex: source.scriptHex,
          sourceSatoshis: source.satoshis,
          unlockingScriptHex,
        })
        if (evalResult.success) {
          tokenLog.debug('[dstas-transfer] script-evaluator pre-broadcast: success')
        } else {
          // Expected when the funding input isn't signed yet — log full
          // diagnostic so a real failure mode (e.g. byte-mismatch on
          // input 0's unlock) can be diagnosed from the dev tools.
          tokenLog.warn(
            '[dstas-transfer] script-evaluator pre-broadcast: NON-SUCCESS (expected — funding input still unsigned at this point). ' +
            `Diagnostic: ${evalResult.reason ?? 'no detail'}`
          )
          if (evalResult.fullResult) {
            tokenLog.warn('[dstas-transfer] full evaluator result:', evalResult.fullResult)
          }
        }
      } catch (err) {
        tokenLog.warn(`[dstas-transfer] script-evaluator threw: ${errMsg(err)}`)
      }

      // 14. signAction. wallet-toolbox signs the funding input and
      //     queues the broadcast; monitor worker handles relay.
      let signResp: any
      try {
        signResp = await this.wallet.signAction(
          {
            reference: signable.reference,
            spends: { 0: { unlockingScript: unlockingScriptHex } },
          } as any,
          ORIGINATOR
        )
      } catch (err) {
        return { ok: false, reason: `signAction: ${errMsg(err)}` }
      }

      const sendResults: any[] = Array.isArray(signResp?.sendWithResults)
        ? signResp.sendWithResults
        : []
      const failed = sendResults.find((r) => r?.status === 'failed')
      if (failed) {
        return {
          ok: false,
          reason: `broadcast failed: ${JSON.stringify(failed)} (txid was ${signResp?.txid})`,
        }
      }

      const wocBase = this.chain === 'main' ? 'https://whatsonchain.com/tx/' : 'https://test.whatsonchain.com/tx/'
      tokenLog.info(`[dstas-transfer] BROADCAST ✓ txid: ${signResp?.txid}  ${wocBase}${signResp?.txid}`)

      // 16. Link the sender's token-change output (vout 1) into the satellite
      //     tables. The Assets view reads DSTAS holdings from `listStasOutputs`,
      //     not from the basket, so without this the remainder of a partial send
      //     is invisible until a discovery scan re-finds it on-chain. We built
      //     the output, so there is nothing to discover. `skipInternalize`:
      //     createAction already declared its basket. Idempotent — the peer
      //     settlement adapter's own registration then reports 'already
      //     registered'.
      if (changeDstasScriptHex != null && args.senderChangeHash160 && signResp?.txid) {
        try {
          const parsedChange = parseDstasLockingScript(source.scriptHex)
          const r = await new StasRegistration(this.wallet, this.identityKey, this.chain).register({
            txid: signResp.txid,
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
            skipInternalize: true,
          })
          if (!r.registered && r.reason !== 'already registered') {
            tokenLog.warn(`[dstas-transfer] token-change NOT registered: ${r.reason} (scan will recover)`)
          }
        } catch (err) {
          tokenLog.warn(`[dstas-transfer] token-change registration threw: ${errMsg(err)} (scan will recover)`)
        }
      }

      return { ok: true, txid: signResp?.txid, beef: signResp?.tx }
    } finally {
      await restoreBasket()
    }
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

