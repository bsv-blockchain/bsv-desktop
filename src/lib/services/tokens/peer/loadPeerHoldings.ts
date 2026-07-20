/**
 * loadPeerHoldings — resolve the wallet's spendable token holdings into
 * `TokenSourceRef`s, shared by the in-wallet Peer Tokens page and the
 * `/peerToken/holdings` + `/peerToken/send` HTTP routes.
 *
 * This is the single source of truth for turning on-chain UTXOs into the
 * `source` object the adapters need (including the BRC-29 owner override that
 * makes a peer-received token re-spendable). Keeping it React-free lets the
 * renderer's HTTP bridge (onWalletReady) resolve a holding from just its
 * outpoint — the web page never has to understand key derivation.
 *
 *   - STAS / DSTAS: read from the satellite tables via the `listStasOutputs`
 *     IPC query; the BRC-29 derivation is decoded from the `brc42KeyId` field.
 *   - BSV-21: read from the BSV-21 basket via wallet.listOutputs; the BRC-29
 *     derivation is decoded from customInstructions (scheme:'brc29').
 */
import type { WalletInterface } from '@bsv/sdk';
import { stasQuery } from '../../stas/stasIpc';
import { BSV21_BASKET } from '../../../constants/baskets';
import { parseBsv21LockingScript } from './../bsv21/inscription';
import { decodeBrc29KeyId } from './brc29KeyId';
import type { TokenSourceRef } from './tokenSettlementTypes';

export type ProtocolId = 'stas' | 'dstas' | 'bsv-21';

export interface PeerHolding {
  /** Outpoint `txid.vout` — stable id used to re-resolve the source server-side. */
  key: string;
  protocol: ProtocolId;
  /** Human label, e.g. `STAS · 100 (received)`. */
  label: string;
  /** Token units as a string (STAS/DSTAS = satoshis; BSV-21 = raw amt). */
  amount: string;
  source: TokenSourceRef;
}

function tagValue(tags: string[] | undefined, key: string): string | undefined {
  const hit = (tags ?? []).find((t) => t.startsWith(`${key}:`));
  return hit ? hit.slice(key.length + 1) : undefined;
}

export interface LoadPeerHoldingsArgs {
  wallet: WalletInterface;
  identityKey: string;
  chain: 'main' | 'test';
  originator?: string;
}

export async function loadPeerHoldings(args: LoadPeerHoldingsArgs): Promise<PeerHolding[]> {
  const { wallet, identityKey, chain, originator } = args;
  const next: PeerHolding[] = [];

  // STAS + DSTAS via the satellite-table IPC query.
  try {
    const rows: any[] = (await stasQuery(identityKey, chain, 'listStasOutputs', [])) ?? [];
    for (const o of rows) {
      if (o?.spendable === false) continue;
      const protocol: ProtocolId = (o.protocol as ProtocolId) ?? 'stas';
      if (protocol !== 'stas' && protocol !== 'dstas') continue;
      const sats = Number(o.outputSatoshis ?? o.tokenSatoshis ?? 0);
      const scriptHex = o.lockingScript ?? null;
      if (!scriptHex) continue;
      // A peer-received token stores its BRC-29 owner derivation in the
      // brc42KeyId field; decode it into an explicit owner override so the
      // transfer service can re-spend it (counterparty = original sender).
      const brc29 = decodeBrc29KeyId(o.brc42KeyId ?? '');
      // Ticker (now joined from stas_tokens), an optional name, and a short
      // outpoint tail so two holdings of the same symbol are still tellable apart
      // in the selector — the whole point of showing more than "STAS · <amt>".
      const stasTicker = o.symbol ?? protocol.toUpperCase();
      const stasName = o.name ? ` (${o.name})` : '';
      next.push({
        key: `${o.txid}.${o.vout}`,
        protocol,
        label: `${stasTicker}${stasName} · ${sats}${brc29 ? ' (received)' : ''} · ${String(o.txid).slice(0, 6)}…`,
        amount: String(sats),
        source: {
          txid: o.txid,
          outputIndex: Number(o.vout),
          lockingScriptHex: scriptHex,
          satoshis: sats,
          protocol,
          assetId: o.symbol ?? o.tokenId ?? protocol,
          brc42KeyId: o.brc42KeyId ?? undefined,
          owner: brc29
            ? { keyID: `${brc29.derivationPrefix} ${brc29.derivationSuffix}`, counterparty: brc29.senderIdentityKey, forSelf: true }
            : undefined,
        },
      });
    }
  } catch (e) {
    console.warn('[loadPeerHoldings] listStasOutputs failed', e);
  }

  // BSV-21 via listOutputs on the basket.
  try {
    const res: any = await wallet.listOutputs({
      basket: BSV21_BASKET,
      includeTags: true,
      includeCustomInstructions: true,
      include: 'locking scripts',
      limit: 200,
    }, originator);
    for (const o of res?.outputs ?? []) {
      const [txid, voutStr] = String(o.outpoint ?? '.').split('.');
      const scriptHex = o.lockingScript ?? null;
      if (!scriptHex) continue;
      const parsed = parseBsv21LockingScript(scriptHex);
      const tokenId = tagValue(o.tags, 'id') ?? parsed?.id ?? '';
      const amt = tagValue(o.tags, 'amt') ?? parsed?.amt ?? '0';
      const sym = tagValue(o.tags, 'sym') ?? parsed?.sym;
      let ci: any = {};
      try { ci = o.customInstructions ? JSON.parse(o.customInstructions) : {}; } catch { /* */ }
      // A peer-received BSV-21 stores its BRC-29 owner derivation in
      // customInstructions (scheme:'brc29'); decode it into an owner override
      // (counterparty = sender, forSelf:true) so it's re-spendable.
      const bsv21Brc29 = ci?.scheme === 'brc29' && ci.derivationPrefix && ci.senderIdentityKey
        ? { keyID: `${ci.derivationPrefix} ${ci.derivationSuffix}`, counterparty: ci.senderIdentityKey as string, forSelf: true }
        : undefined;
      next.push({
        key: `${txid}.${voutStr}`,
        protocol: 'bsv-21',
        // Short outpoint tail matches the STAS/DSTAS labels so two holdings of
        // the same BSV-21 symbol are also distinguishable.
        label: `${sym ?? 'BSV-21'} · ${amt}${bsv21Brc29 ? ' (received)' : ''} · ${String(txid).slice(0, 6)}…`,
        amount: String(amt),
        source: {
          txid,
          outputIndex: Number(voutStr),
          lockingScriptHex: scriptHex,
          satoshis: Number(o.satoshis ?? 1),
          protocol: 'bsv-21',
          assetId: tokenId,
          brc42KeyId: ci.keyID ?? ci.brc42KeyId ?? undefined,
          owner: bsv21Brc29,
          tokenId,
          amt,
          dec: tagValue(o.tags, 'dec') ? Number(tagValue(o.tags, 'dec')) : parsed?.dec,
          sym,
          icon: tagValue(o.tags, 'icon') ?? parsed?.icon,
        },
      });
    }
  } catch (e) {
    console.warn('[loadPeerHoldings] listOutputs(bsv-21) failed', e);
  }

  return next;
}
