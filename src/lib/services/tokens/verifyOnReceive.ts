/**
 * verifyAndPersistOnReceive — Back-to-Genesis verification at the moment a token
 * is internalized, not on the next Assets load.
 *
 * The Assets page already verifies holdings when it renders, and persists the
 * verdicts (migration 0004). But a token accepted over MessageBox — or picked up
 * by a background discovery scan — is internalized whether or not Assets is open.
 * Firing verification here, at the registration seam, means the DB already holds
 * the Verified / Counterfeit verdict by the time the user looks, so the badge is
 * instant and the load-time pass finds it in its DB seed and skips the network.
 *
 * Fire-and-forget by contract: this returns void immediately and never throws.
 * It must not block or fail a receive — a WOC hiccup simply leaves the outpoint
 * unverified until the load-time pass retries it. Only SETTLED verdicts are
 * written; `undetermined` is left for a retry, never frozen.
 */

import { BackToGenesisClient, formatGenesisRef, type TokenStd } from './woc/BackToGenesisClient';
import { stasQuery } from '../stas/stasIpc';
import type { TokenProtocolId } from './TokenProtocolAdapter';

const PROTOCOL_TO_STD: Record<TokenProtocolId, TokenStd> = {
  stas: 'stas',
  dstas: 'dstas',
  'bsv-21': 'bsv21',
};

export function verifyAndPersistOnReceive(
  identityKey: string,
  chain: 'main' | 'test',
  outpoint: { txid: string; vout: number; protocol: TokenProtocolId },
  client: BackToGenesisClient = new BackToGenesisClient({ chain })
): void {
  void (async () => {
    try {
      const std = PROTOCOL_TO_STD[outpoint.protocol];
      const res = await client.verify(std, outpoint.txid, outpoint.vout);
      // Leave `undetermined` for the load-time retry — persisting it would freeze
      // a "couldn't decide yet" as if it were a decision.
      if (res.result === 'undetermined') return;
      await stasQuery(identityKey, chain, 'upsertTokenVerification', [
        {
          txid: outpoint.txid,
          vout: outpoint.vout,
          protocol: outpoint.protocol,
          result: res.result,
          genesis: res.genesis ? formatGenesisRef(res.genesis) : null,
          genesisDepth: res.genesisDepth ?? null,
          reason: res.reason ?? null,
          verifiedAt: new Date().toISOString(),
        },
      ]);
    } catch {
      /* best-effort; the Assets load-time pass verifies + persists as a backstop */
    }
  })();
}
