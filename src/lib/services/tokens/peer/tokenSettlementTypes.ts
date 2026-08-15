/**
 * The TokenSettlementAdapter contract now ships in @bsv/message-box-client
 * (>=2.1), so this file no longer mirrors it — it re-exports the published
 * types and adds the one field bsv-desktop needs that upstream leaves to the
 * adapter's discretion.
 *
 * Upstream's `TokenSourceRef` carries an index signature (`[key: string]:
 * unknown`) for exactly this: standard-specific extras it passes through to the
 * adapter without interpreting. We use it for `owner` — the BRC-29 derivation
 * override under which a *received* token is held. Typing it here keeps the
 * adapters type-safe instead of casting `unknown` at every read.
 */
import type { TokenSourceRef as UpstreamTokenSourceRef } from '@bsv/message-box-client';

export type {
  TokenSettlementArtifact,
  TokenAdapterContext,
  TokenBuildResult,
  TokenAcceptResult,
  TokenSettlementAdapter,
  Termination,
} from '@bsv/message-box-client';

/**
 * Owner-key derivation for a token the wallet RECEIVED over a peer channel.
 * Such a UTXO is locked to our key derived with `counterparty = the original
 * sender` (BRC-29), not to our plain self-derived receive key — so re-spending
 * it requires replaying that derivation with `forSelf: true`.
 */
export interface TokenOwnerOverride {
  protocolID?: [number, string];
  keyID: string;
  counterparty: string;
  /** True for a BRC-29-received token: derive the recipient's OWN key. */
  forSelf?: boolean;
}

export interface TokenSourceRef extends UpstreamTokenSourceRef {
  owner?: TokenOwnerOverride;
}
