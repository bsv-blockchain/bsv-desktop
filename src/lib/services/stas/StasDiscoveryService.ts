/**
 * StasDiscoveryService — the renderer-only orchestrator that closes the
 * receive loop.
 *
 *   enumerate derived owner addresses
 *   → scan WoC for UTXOs at each
 *   → fetch each candidate tx via wallet.getServices() to read its script
 *   → parse as DSTAS and match owner field
 *   → register via StasRegistration (confirmed-only MVP)
 *   → return a structured ScanResult
 *
 * No timer; one scan per invocation. Auto-fired on wallet ready, and re-fired
 * by the dev-only debug panel button.
 */

import { Transaction } from '@bsv/sdk';
import { Address, fromHex } from 'dxs-bsv-token-sdk/bsv';
import { STAS_GAP_LIMIT } from './constants';
import type { ParsedDstas } from './dstasParser';
import type { StasKeyDeriver } from './StasKeyDeriver';
import type { StasRegistration } from './StasRegistration';
import type { ScanProgressFn, WocUtxo } from '../tokens/woc/WocTokenIndexerClient';
import { stasQuery } from './stasIpc';
import { TOKEN_BASKETS, STAS_BASKET, DSTAS_BASKET } from '../../constants/baskets';
import { loadBasketOutpoints } from './basketOutpoints';
import type { TokenProtocolRegistry, ParsedTokenOutput } from '../tokens';

const ORIGINATOR = 'admin.stas-discovery';

/**
 * Adapter-shaped parsed token output the legacy registration expects.
 * Maps the cross-protocol `ParsedTokenOutput` back onto the existing
 * `ParsedDstas`-plus-symbol shape so we don't have to rewrite
 * StasRegistration's payload contract in this PR.
 */
function toRichParsed(parsed: ParsedTokenOutput): ParsedDstas & { symbol?: string } {
  return {
    ownerFieldHash160: parsed.ownerFieldHash160,
    tokenId: parsed.tokenId,
    freezeEnabled: parsed.freezeEnabled ?? false,
    confiscationEnabled: parsed.confiscationEnabled ?? false,
    flagsHex: parsed.flagsHex ?? '',
    serviceFields: parsed.serviceFields ?? [],
    // DSTAS-spend prerequisite fields. The cross-protocol adapter shape
    // doesn't carry these — registration only needs ownership/tokenId
    // metadata — so default to empty/inert values here. The transfer
    // path goes back through `parseDstasLockingScript` directly for the
    // source UTXO it's about to spend.
    optionalData: [],
    actionData: {},
    frozen: false,
    symbol: parsed.symbol,
  };
}

export interface ScanResult {
  scannedAddresses: number;
  /** Total UTXOs the indexer returned across all scanned addresses. */
  candidates: number;
  /** Candidates whose locking script parsed as DSTAS. */
  dstas: number;
  /** DSTAS UTXOs whose owner field matched a derived key. */
  ownedAndDstas: number;
  registered: number;
  /** Owned DSTAS that we deferred (unconfirmed / no merkle proof yet). */
  deferred: number;
  skippedAlreadyKnown: number;
  errors: Array<{ txid?: string; vout?: number; message: string }>;
  /** Set when registration succeeded — outpoints + token info for the UI. */
  registeredOutpoints: Array<{ txid: string; vout: number; tokenId: string }>;
  /**
   * Backfill stat — outputs we flipped from spendable=false → true on this
   * scan. Closes the wallet-toolbox conservative default for any STAS
   * registered before the auto-flip-at-register fix landed.
   */
  spendableFlipped?: number;
}

/**
 * Per-address token indexer the discovery loop pulls from. Satisfied by
 * `WocTokenIndexerClient`, which serves STAS (by base58 address) and DSTAS
 * (by owner hash160) from the same host.
 */
export interface StasDiscoveryIndexer {
  getUtxosForAddresses(
    addresses: string[],
    opts?: { onProgress?: ScanProgressFn }
  ): Promise<Array<{ address: string; utxos: WocUtxo[] }>>;
  getDstasUtxosForOwners(
    ownerHash160s: string[],
    opts?: { onProgress?: ScanProgressFn }
  ): Promise<Array<{ ownerHash160: string; utxos: WocUtxo[] }>>;
}

/** What a scan is doing right now, for a caller that wants to show progress. */
export interface ScanProgress {
  phase: 'stas' | 'dstas' | 'register';
  done: number;
  total: number;
}

export interface ScanOptions {
  onProgress?: (p: ScanProgress) => void;
}

export interface StasDiscoveryDeps {
  deriver: StasKeyDeriver;
  indexer: StasDiscoveryIndexer;
  registration: StasRegistration;
  /** Wallet exposing `getServices()` (wallet-toolbox Wallet). */
  wallet: any;
  /**
   * Token-protocol adapters, in resolution order. Each candidate locking
   * script is offered to every adapter; the first that recognises it
   * decides the protocol + basket the UTXO is registered under.
   */
  registry: TokenProtocolRegistry;
  gapLimit?: number;
}

export interface RegisterByTxidResult {
  txid: string;
  registered: number;
  outputs: Array<{
    vout: number;
    matched: boolean;
    /** When matched=true: the recv-N keyIndex that owns the output. */
    keyIndex?: number;
    /** When matched=true and register failed: reason string. */
    reason?: string;
    /** Was the wallet successful in registering it? */
    ok?: boolean;
  }>;
  /** Error before per-output processing started (e.g. tx not found). */
  error?: string;
}

export class StasDiscoveryService {
  constructor(private readonly deps: StasDiscoveryDeps) {}

  /**
   * DEMO-ONLY fast-path: register a STAS UTXO directly by txid.
   *
   * The PRIMARY discovery mechanism is `scan()` — enumerate derived
   * receive addresses, query the STAS-aware indexer (Bitails) per-address
   * for owned UTXOs, parse + register. That covers organic receive without
   * the sender having to tell us anything beyond the recipient address.
   *
   * This method exists so a colocated mint flow (dex-shell after a faucet
   * mint) can skip the indexer round-trip and get immediate UI feedback —
   * the wallet fetches the tx directly, parses outputs, and internalizes
   * matches. Useful too as a fallback when the address-based scan is
   * unavailable (e.g. WoC doesn't index custom-script outputs by address).
   */
  /**
   * `opts.symbol`/`opts.name` let a colocated minter supply a friendly label the
   * chain doesn't carry — essential for DSTAS, whose symbol lives nowhere
   * on-chain. When given, it's stored in the output's customInstructions so it
   * renders portably (local + remote). Ignored for STAS, whose real symbol is
   * recovered from the script.
   */
  async registerByTxid(
    txid: string,
    opts?: { symbol?: string; name?: string }
  ): Promise<RegisterByTxidResult> {
    const out: RegisterByTxidResult = { txid, registered: 0, outputs: [] };
    const services: any = (this.deps.wallet as any).getServices?.();
    if (!services) {
      out.error = 'wallet.getServices() unavailable';
      return out;
    }
    let rawTxRes: any;
    try {
      rawTxRes = await services.getRawTx(txid);
    } catch (err) {
      out.error = `getRawTx failed: ${err instanceof Error ? err.message : String(err)}`;
      return out;
    }
    if (!rawTxRes?.rawTx) {
      out.error = rawTxRes?.error?.message ?? 'getRawTx returned no rawTx';
      return out;
    }
    let tx: any;
    try {
      tx = Transaction.fromBinary(rawTxRes.rawTx as number[]);
    } catch (err) {
      out.error = `tx parse failed: ${err instanceof Error ? err.message : String(err)}`;
      return out;
    }

    const hwm = await this.deps.deriver.getHighWaterMark();
    const gap = this.deps.gapLimit ?? STAS_GAP_LIMIT;
    const ownerMap = await this.deps.deriver.enumerateOwnerFields(
      hwm > 0 ? hwm + gap : Math.min(gap, 5)
    );

    for (let vout = 0; vout < tx.outputs.length; vout++) {
      const txout = tx.outputs[vout];
      const lockingScriptHex: string = txout.lockingScript.toHex();

      // Ask the registry: which protocol (if any) recognises this script?
      // STAS / DSTAS adapters are tried in registration order; the first
      // match wins. Each adapter returns its own parsed payload.
      const match = await this.deps.registry.find(lockingScriptHex, {
        txid,
        vout,
        wallet: this.deps.wallet,
      });
      if (!match) {
        out.outputs.push({ vout, matched: false });
        continue;
      }

      const keyIndex = ownerMap.get(match.parsed.ownerFieldHash160);
      if (keyIndex === undefined) {
        out.outputs.push({ vout, matched: false });
        continue;
      }

      const reg = await this.deps.registration.register({
        txid,
        vout,
        tokenSatoshis: txout.satoshis ?? 0,
        ownerFieldHash160: match.parsed.ownerFieldHash160,
        brc42KeyId: `recv ${keyIndex}`,
        parsed: toRichParsed(match.parsed),
        protocol: { id: match.adapter.id, basketName: match.adapter.basketName },
        symbol: opts?.symbol,
        name: opts?.name,
      });
      const ok = !!reg.registered;
      if (ok) out.registered++;
      out.outputs.push({
        vout,
        matched: true,
        keyIndex,
        ok,
        reason: reg.reason,
      });
    }
    return out;
  }

  async scan(opts: ScanOptions = {}): Promise<ScanResult> {
    const result: ScanResult = {
      scannedAddresses: 0,
      candidates: 0,
      dstas: 0,
      ownedAndDstas: 0,
      registered: 0,
      deferred: 0,
      skippedAlreadyKnown: 0,
      errors: [],
      registeredOutpoints: [],
    };
    const gap = this.deps.gapLimit ?? STAS_GAP_LIMIT;
    const identityKey = this.deps.deriver.identityKey;
    const chain = this.deps.deriver.chain;

    // 1. Enumerate derived owner fields (hash160 -> keyIndex). Memoized in the
    //    deriver, so repeated scans are cheap after the first.
    //
    // Bootstrap mode: when hwm === 0 no receive context has ever been issued,
    // so a full BIP-32-style gap scan is pure waste (and floods WoC). Cap the
    // effective range at a small bootstrap window — enough to cover the
    // "send to recv 1..N without preparation" case but cheap on bandwidth.
    const hwm = await this.deps.deriver.getHighWaterMark();
    const bootstrapGap = 5;
    const effectiveUpTo = hwm > 0 ? hwm + gap : Math.min(bootstrapGap, gap);
    const ownerMap = await this.deps.deriver.enumerateOwnerFields(effectiveUpTo);

    // 2. Convert each hash160 to a base58 address for WoC.
    const addressToHash = new Map<string, string>();
    for (const hash160Hex of ownerMap.keys()) {
      try {
        const address = new Address(fromHex(hash160Hex)).Value as string;
        addressToHash.set(address, hash160Hex);
      } catch {
        // Skip undecodable owner fields; should not happen in practice.
      }
    }
    result.scannedAddresses = addressToHash.size;

    // 3. WOC token UTXO scan. STAS is queried per base58 address; DSTAS per
    //    owner hash160 (WOC's DSTAS endpoint keys on the raw hash160, not
    //    base58). Both are merged into one work-list of {owner, keyIndex,
    //    utxos} so the per-UTXO registration loop below is shared.
    const addresses = [...addressToHash.keys()];
    const stasScanned = await this.deps.indexer.getUtxosForAddresses(addresses, {
      onProgress: (done, total) => opts.onProgress?.({ phase: 'stas', done, total }),
    });

    type OwnerUtxos = {
      ownerHash160Hex: string | undefined;
      ownerKeyIndex: number | undefined;
      utxos: WocUtxo[];
    };
    const work: OwnerUtxos[] = stasScanned.map(({ address, utxos }) => {
      const owner = addressToHash.get(address);
      return {
        ownerHash160Hex: owner,
        ownerKeyIndex: owner ? ownerMap.get(owner) : undefined,
        utxos,
      };
    });

    {
      const dstasScanned = await this.deps.indexer.getDstasUtxosForOwners([...ownerMap.keys()], {
        onProgress: (done, total) => opts.onProgress?.({ phase: 'dstas', done, total }),
      });
      for (const { ownerHash160, utxos } of dstasScanned) {
        if (utxos.length === 0) continue;
        work.push({
          ownerHash160Hex: ownerHash160,
          ownerKeyIndex: ownerMap.get(ownerHash160),
          utxos,
        });
      }
    }

    // 4. Walk each UTXO: parse the output script (from the indexer's
    //    scriptHex when present, else fetch the tx), match ownership, register.
    const services = (this.deps.wallet as any).getServices?.();
    if (!services) {
      result.errors.push({ message: 'wallet.getServices() unavailable' });
      return result;
    }
    const txCache = new Map<string, Transaction>();

    // Idempotency source: outpoints already tracked in the token baskets
    // (STAS + DSTAS share the receive namespace). Read once from the ACTIVE
    // store so re-scans skip tokens already held — the old per-UTXO satellite
    // check (findStasOutputByOutpoint) was local-SQLite only and re-registered
    // everything on remote storage each scan.
    const knownOutpoints = new Set<string>([
      ...(await loadBasketOutpoints(this.deps.wallet, STAS_BASKET, ORIGINATOR)),
      ...(await loadBasketOutpoints(this.deps.wallet, DSTAS_BASKET, ORIGINATOR)),
    ]);

    // Each work entry is bound to one owner hash160 by construction (the
    // indexer was queried per-derived-address / per-owner). That mapping is
    // the ownership fallback: if an adapter's parse can't recover an owner
    // hash160, the binding still tells us which key owns the UTXO.
    for (const { ownerHash160Hex, ownerKeyIndex, utxos } of work) {
      for (const utxo of utxos) {
        result.candidates++;
        try {
          // Idempotency pre-check — saves fetching tx/proof for known outpoints.
          // Counts already-known UTXOs into dstas + ownedAndDstas too, so the
          // panel reflects "tokens the wallet recognises at the scanned range"
          // rather than just "newly registered this scan". Field names are
          // legacy STAS-era; treat as "recognised tokens" / "matched to a key".
          if (knownOutpoints.has(`${utxo.txid}.${utxo.vout}`)) {
            result.dstas++;
            result.ownedAndDstas++;
            result.skippedAlreadyKnown++;
            continue;
          }

          // Prefer the indexer-supplied locking script (WOC `?script=true`)
          // to skip a per-txid getRawTx just for parsing. Registration still
          // fetches the BEEF / merkle proof via wallet.getServices() below.
          let lockingScriptHex: string;
          if (utxo.scriptHex) {
            lockingScriptHex = utxo.scriptHex;
          } else {
            // Fetch tx once per txid.
            let tx = txCache.get(utxo.txid);
            if (!tx) {
              const rawTxRes = await services.getRawTx(utxo.txid);
              if (!rawTxRes?.rawTx) {
                result.errors.push({
                  txid: utxo.txid,
                  vout: utxo.vout,
                  message: rawTxRes?.error?.message ?? 'getRawTx returned no rawTx',
                });
                continue;
              }
              tx = Transaction.fromBinary(rawTxRes.rawTx as number[]);
              txCache.set(utxo.txid, tx);
            }

            const out = tx.outputs[utxo.vout];
            if (!out) {
              result.errors.push({
                txid: utxo.txid,
                vout: utxo.vout,
                message: 'output index out of range',
              });
              continue;
            }
            lockingScriptHex = out.lockingScript.toHex();
          }

          // Ask the registry to recognise the script. Each adapter is asked
          // in registration order; the first that returns a parsed payload
          // owns the registration (and decides the destination basket).
          const match = await this.deps.registry.find(lockingScriptHex, {
            txid: utxo.txid,
            vout: utxo.vout,
            wallet: this.deps.wallet,
          });
          if (!match) continue;

          // Ownership: the script's owner field is authoritative when the
          // adapter recovered one (DSTAS / classic STAS — both always do).
          // The indexer-address binding is only used as a fallback for
          // adapters that can't recover an owner field from the script
          // bytes alone — important defense: if an adapter DID parse an
          // owner field and it doesn't match any derived key, the UTXO is
          // NOT ours, even when the indexer places it at our address (e.g.
          // a malicious sender forges the address-binding side).
          const parsedOwner = match.parsed.ownerFieldHash160;
          const matchedOwnerHash160 = parsedOwner || ownerHash160Hex || '';
          const keyIndex = parsedOwner
            ? ownerMap.get(parsedOwner)
            : ownerKeyIndex;

          result.dstas++;
          if (keyIndex === undefined) continue;
          result.ownedAndDstas++;

          // Mempool tolerance: previously this branch deferred when the
          // indexer reported height 0. Bitails surfaces unconfirmed STAS too,
          // and Task 4c's buildChainedAtomicBeef walks back through inputs to
          // a confirmed ancestor, so mempool UTXOs are no longer special-cased.

          const reg = await this.deps.registration.register({
            txid: utxo.txid,
            vout: utxo.vout,
            tokenSatoshis: utxo.value,
            ownerFieldHash160: matchedOwnerHash160,
            brc42KeyId: `recv ${keyIndex}`,
            parsed: toRichParsed(match.parsed),
            protocol: {
              id: match.adapter.id,
              basketName: match.adapter.basketName,
            },
          });

          if (reg.registered) {
            result.registered++;
            result.registeredOutpoints.push({
              txid: utxo.txid,
              vout: utxo.vout,
              tokenId: match.parsed.tokenId,
            });
          } else if (reg.reason === 'already registered') {
            result.skippedAlreadyKnown++;
          } else if (reg.reason?.includes('merkle proof') || reg.reason?.includes('deferred')) {
            result.deferred++;
          } else if (reg.reason) {
            result.errors.push({ txid: utxo.txid, vout: utxo.vout, message: reg.reason });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({ txid: utxo.txid, vout: utxo.vout, message });
        }
      }
    }

    // Backfill: flip spendable=true on every token basket's outputs that are
    // still marked false. Runs once per protocol so DSTAS holdings (now in
    // their own basket) get the same treatment classic STAS used to get.
    try {
      let total = 0;
      for (const basket of TOKEN_BASKETS) {
        const bf: any = await stasQuery(
          identityKey,
          chain,
          'backfillSpendableForBasket',
          [basket]
        );
        if (bf && typeof bf.updated === 'number') total += bf.updated;
      }
      result.spendableFlipped = total;
    } catch {
      /* best effort */
    }

    return result;
  }
}
